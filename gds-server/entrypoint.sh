#!/bin/sh
# gds-server/entrypoint.sh — démarrage du conteneur tout-en-un GDS.
#
# Périmètre des micro-tâches L2.3 (« base à partir d'un volume vide »), L2.5
# (« dépôts git : utilisateur git, racine, clefs autorisées »), L2.6
# (« service SSH : sshd, clefs d'hôte persistantes, coquille git ») et L2.7
# (« conteneur unique + supervision des trois processus ») :
#   1. création de l'INSTANCE PostgreSQL sur le volume (`initdb`) si le datadir
#      est VIDE — un datadir déjà initialisé est CONSERVÉ tel quel (aucune
#      réinitialisation, les données du volume ne sont jamais effacées) ;
#   2. mise en route de l'instance si elle n'écoute pas encore ;
#   2bis. L2.8 — ouverture de l'accès DIRECT (par MOT DE PASSE) à la base depuis
#      les plages déclarées dans `GDS_PG_ALLOWED_NETWORKS` : `initdb` n'ouvre par
#      défaut que la boucle locale (`127.0.0.1/32`), or une connexion qui arrive
#      par le port PUBLIÉ du conteneur présente la passerelle du réseau Docker
#      comme source — elle serait refusée (« no pg_hba.conf entry ») et le poste
#      ne pourrait pas « parler en direct à la base » (décision figée du lot) ;
#   3. préparation de la base de service par le socle, via le binaire :
#      `gds-server --init-db` (création du rôle et de la base `pilot_gds` s'ils
#      sont absents, puis migrations embarquées — idempotent) ;
#   4. préparation des dépôts git par le socle, via le binaire :
#      `gds-server --init-ssh` (compte système `git` sans mot de passe
#      utilisable, coquille de connexion restreinte à `git-shell`, `~git/.ssh`
#      en 700, `~git/.ssh/authorized_keys` en 600, racine des dépôts confiée à
#      `git`, puis RÉGÉNÉRATION du fichier des clefs autorisées depuis la base —
#      source de vérité : les clefs enregistrées deviennent utilisables et les
#      clefs révoquées disparaissent ; les dépôts bare annoncés en base sont
#      matérialisés, cf. `gds_core::git::ensure_project_bares`). Idempotent : un
#      fichier déjà conforme n'est pas réécrit ;
#   5. préparation du service SSH : clefs d'hôte générées dans le VOLUME
#      (`$GDS_SSH_HOST_KEYS_DIR`, défaut /etc/ssh/host_keys) si elles manquent —
#      jamais écrasées, donc empreinte stable après reconstruction —, modèle
#      `sshd_config` rendu avec le port interne (`GDS_SSH_PORT`) et validé
#      (`sshd -t`). Authentification par clef uniquement, compte `git`
#      uniquement, coquille `git-shell` ;
#   6. L2.7 — fin du bootstrap : l'instance PostgreSQL de BOOTSTRAP est arrêtée
#      (sinon elle se disputerait le port avec le postmaster surveillé), puis le
#      script se REMPLACE par `supervisord`, qui devient le processus du
#      conteneur (PID 1) et surveille les TROIS services : instance PostgreSQL,
#      sshd et `gds-server` (API HTTP + jobs de maintenance, qui continue de
#      rafraîchir `authorized_keys` et de matérialiser les dépôts bare
#      périodiquement). Chacun est redémarré s'il tombe ; un échec répété est
#      annoncé en FATAL dans les journaux, donc jamais silencieux.
#
# Décision figée du lot L2 : conteneur TOUT-EN-UN, base de données DANS l'image,
# supervision INTERNE (aucun socket du moteur Docker n'est monté, le conteneur ne
# pilote jamais le moteur qui l'héberge).
#
# Hors périmètre (micro-tâches suivantes, à ne pas traiter ici) : orchestration
# compose et publication des ports (L2.8 — `docker-compose.yml`, dont ce script
# complète l'accès direct à la base), exposition publique (L2.9).
#
# Variables reconnues : `PGDATA` (défaut /var/lib/postgresql/data),
# `POSTGRES_PASSWORD` (secret du compte d'administration, cf. spec §6.4),
# `GDS_DB_ADMIN_USER` (défaut « postgres »), `GDS_DB_ADMIN_PASSWORD` (défaut
# POSTGRES_PASSWORD), `GDS_DB_ADMIN_HOST` (défaut GDS_DB_HOST puis localhost),
# `GDS_DB_PORT` (défaut 5432), `GDS_PG_ALLOWED_NETWORKS` (défaut 0.0.0.0/0 :
# plages CIDR, séparées par des virgules, autorisées à joindre la base par MOT DE
# PASSE depuis le port publié, cf. `ensure_pg_hba` — jamais de `trust` en TCP),
# `GDS_REPOS_ROOT` (défaut /srv/git/repos : racine des
# dépôts bare, sur volume), `GDS_SSH_PORT` (défaut 22 : port INTERNE de sshd, le
# port publié 2222 étant un réglage du conteneur), `GDS_SSH_HOST_KEYS_DIR`
# (défaut /etc/ssh/host_keys : dossier des clefs d'hôte, sur volume),
# `GDS_SSHD_CONFIG_SRC` (modèle sshd_config à rendre, sinon celui livré à côté de
# ce script), `GDS_SSHD_CONFIG` (fichier rendu, défaut /etc/ssh/sshd_config.gds),
# `GDS_SUPERVISORD_CONFIG` (configuration du superviseur, défaut
# /etc/gds/supervisord.conf), `GDS_PG_BIN` / `GDS_SSHD_BIN` (chemins absolus des
# binaires fournis au superviseur, résolus automatiquement).
# Aucun secret n'est journalisé.

set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
GDS_DB_ADMIN_USER="${GDS_DB_ADMIN_USER:-postgres}"
GDS_DB_ADMIN_PASSWORD="${GDS_DB_ADMIN_PASSWORD:-${POSTGRES_PASSWORD:-}}"
GDS_DB_ADMIN_HOST="${GDS_DB_ADMIN_HOST:-${GDS_DB_HOST:-localhost}}"
GDS_DB_PORT="${GDS_DB_PORT:-5432}"
# L2.8 — réseaux autorisés à joindre la base EN DIRECT (mot de passe) sur le port
# publié. Une connexion qui arrive par ce port vient de la passerelle du réseau
# Docker (ex. 172.18.0.1) et non de 127.0.0.1 : sans cette ouverture, le poste est
# refusé. Le défaut (0.0.0.0/0) autorise « tout ce qui ATTEINT le port publié » —
# le filtrage réel est la PUBLICATION des ports côté hôte (docker-compose.yml,
# plages LAN/Tailscale uniquement) ; restreindre est possible (ex.
# « 192.168.1.0/24,100.64.0.0/10 »).
GDS_PG_ALLOWED_NETWORKS="${GDS_PG_ALLOWED_NETWORKS:-0.0.0.0/0}"
# Racine des dépôts bare (volume monté). Explicité ici : la valeur alimente la
# préparation du compte `git` (L2.5) et sera réutilisée par la création des
# dépôts (L2.6).
GDS_REPOS_ROOT="${GDS_REPOS_ROOT:-/srv/git/repos}"
# L2.6 — port INTERNE de sshd (le port publié 2222 est un réglage du conteneur,
# cf. compose en L2.8). Les clefs d'hôte vivent sur un volume : sans lui,
# l'empreinte du serveur changerait à chaque reconstruction.
GDS_SSH_PORT="${GDS_SSH_PORT:-22}"
GDS_SSH_HOST_KEYS_DIR="${GDS_SSH_HOST_KEYS_DIR:-/etc/ssh/host_keys}"
# Fichier rendu (port substitué) : sshd le reçoit par `-f`, avec `-D -e` pour
# que ses journaux arrivent sur la sortie d'erreur — le conteneur n'a pas de
# démon syslog, et `docker logs` doit rester exploitable.
GDS_SSHD_CONFIG="${GDS_SSHD_CONFIG:-/etc/ssh/sshd_config.gds}"
# L2.7 — configuration du superviseur : elle décrit les TROIS processus
# surveillés et reçoit du script d'entrée le port PostgreSQL et les chemins
# absolus des binaires (supervisord n'accepte pas de commande ambiguë).
GDS_SUPERVISORD_CONFIG="${GDS_SUPERVISORD_CONFIG:-/etc/gds/supervisord.conf}"
# Chemins absolus fournis au superviseur : valeurs de repli, remplacées par la
# résolution réelle juste avant de lancer supervisord.
GDS_PG_BIN="${GDS_PG_BIN:-postgres}"
GDS_SSHD_BIN="${GDS_SSHD_BIN:-/usr/sbin/sshd}"
export PGDATA GDS_DB_ADMIN_USER GDS_DB_ADMIN_PASSWORD GDS_DB_ADMIN_HOST GDS_DB_PORT GDS_REPOS_ROOT
export GDS_PG_ALLOWED_NETWORKS
export GDS_SSH_PORT GDS_SSH_HOST_KEYS_DIR GDS_SSHD_CONFIG GDS_SUPERVISORD_CONFIG
export GDS_PG_BIN GDS_SSHD_BIN

log() { echo "entrypoint: $*"; }

# Une commande explicite (ex. `docker run … bash`) est exécutée telle quelle : le
# conteneur reste utilisable pour le diagnostic, sans effet de bord.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

# Exécute une commande sous le propriétaire du cluster : `initdb` et `pg_ctl`
# refusent de tourner en root.
as_cluster_owner() {
    if [ "$(id -u)" -ne 0 ]; then
        "$@"
        return $?
    fi
    if id postgres >/dev/null 2>&1 && command -v runuser >/dev/null 2>&1; then
        runuser -u postgres -- "$@"
        return $?
    fi
    log "ERREUR : impossible d'exécuter « $1 » en tant que propriétaire du cluster (droits root sans runuser)"
    return 1
}

# L2.8 — Accès DIRECT à la base depuis le port publié (`pg_hba.conf`).
#
# `initdb` n'écrit que les entrées de la boucle locale ; une connexion arrivant
# par le port publié du conteneur est vue comme venant de la passerelle du réseau
# Docker (ex. 172.18.0.1) : elle est refusée tant qu'aucune ligne ne la couvre.
# Le bloc ci-dessous ouvre l'accès par MOT DE PASSE (`scram-sha-256`, jamais
# `trust` en TCP) aux plages de `GDS_PG_ALLOWED_NETWORKS`. Il est RÉÉCRIT à
# chaque démarrage entre ses deux marqueurs (modifier la variable suffit ; une
# modification manuelle de ce bloc est écrasée, le reste du fichier est
# conservé). Sans fichier `pg_hba.conf`, on ne fait rien : l'instance gérée hors
# du conteneur n'est jamais modifiée.
ensure_pg_hba() {
    hba="$PGDATA/pg_hba.conf"
    if [ ! -s "$hba" ]; then
        return 0
    fi
    tmp="$(mktemp)"
    # Le fichier est TRONQUÉ, jamais recréé : son propriétaire (`postgres`) et ses
    # droits (600) sont conservés, sinon le moteur ne pourrait plus le relire.
    sed '/^# GDS:acces-direct/,/^# GDS:fin$/d' "$hba" >"$tmp"
    {
        echo "# GDS:acces-direct — bloc réécrit au démarrage, ne pas éditer"
        for net in $(printf '%s' "$GDS_PG_ALLOWED_NETWORKS" | tr ',' ' '); do
            # Garde-fou : une plage est un CIDR/une adresse, jamais une ligne
            # ajoutée par surprise au fichier (même discipline que la validation
            # des clefs SSH du socle).
            case "$net" in
                "") continue ;;
                *[!0-9a-fA-F:./]*) log "plage ignorée (format inattendu) : $net"; continue ;;
            esac
            echo "host all all $net scram-sha-256"
        done
        echo "# GDS:fin"
    } >>"$tmp"
    cat "$tmp" >"$hba"
    rm -f "$tmp"
    log "accès direct à la base (mot de passe) ouvert pour : $GDS_PG_ALLOWED_NETWORKS"
    # À chaud (instance déjà à l'écoute), le moteur doit relire le fichier ; un
    # démarrage normal le lit de toute façon au lancement du postmaster.
    if command -v pg_isready >/dev/null 2>&1 && pg_isready -h 127.0.0.1 -p "$GDS_DB_PORT" -q 2>/dev/null; then
        as_cluster_owner pg_ctl --pgdata="$PGDATA" reload >/dev/null 2>&1 || true
    fi
}

# 1. Instance PostgreSQL : créée sur un volume VIDE, conservée sinon.
ensure_database_instance() {
    if [ -s "$PGDATA/PG_VERSION" ]; then
        log "instance PostgreSQL déjà présente dans $PGDATA : données conservées"
        # L2.8 : le bloc d'accès direct est réécrit même sur un volume DÉJÀ
        # initialisé (mise à jour d'une installation existante).
        ensure_pg_hba
        return 0
    fi
    if ! command -v initdb >/dev/null 2>&1; then
        log "initdb absent : instance PostgreSQL gérée hors du conteneur"
        return 0
    fi
    log "datadir vide : création de l'instance PostgreSQL dans $PGDATA"
    mkdir -p "$PGDATA"
    chown postgres:postgres "$PGDATA" 2>/dev/null || true
    chmod 700 "$PGDATA" 2>/dev/null || true
    if [ -n "$GDS_DB_ADMIN_PASSWORD" ]; then
        # Mot de passe du superutilisateur fourni par le fichier temporaire
        # (jamais en argument de commande, donc jamais visible dans `ps`).
        pwfile="$(mktemp)"
        printf '%s\n' "$GDS_DB_ADMIN_PASSWORD" >"$pwfile"
        chmod 600 "$pwfile"
        chown postgres "$pwfile" 2>/dev/null || true
        as_cluster_owner initdb --pgdata="$PGDATA" \
            --username="$GDS_DB_ADMIN_USER" --pwfile="$pwfile" \
            --auth-local=trust --auth-host=scram-sha-256
        rm -f "$pwfile"
    else
        # Sans secret d'administration, seules les connexions par la socket
        # locale sont ouvertes : le service doit alors utiliser
        # GDS_DB_ADMIN_HOST=/var/run/postgresql.
        export GDS_DB_ADMIN_HOST="/var/run/postgresql"
        as_cluster_owner initdb --pgdata="$PGDATA" \
            --username="$GDS_DB_ADMIN_USER" \
            --auth-local=trust --auth-host=scram-sha-256
        log "aucun mot de passe d'administration fourni : administration par la socket locale uniquement"
    fi
    log "instance PostgreSQL créée (superutilisateur $GDS_DB_ADMIN_USER)"
    ensure_pg_hba
}

# 2. Mise en route de l'instance si elle n'écoute pas encore.
start_database_instance() {
    if command -v pg_isready >/dev/null 2>&1 && pg_isready -h 127.0.0.1 -p "$GDS_DB_PORT" -q; then
        log "instance PostgreSQL déjà à l'écoute sur le port $GDS_DB_PORT"
        return 0
    fi
    if ! command -v pg_ctl >/dev/null 2>&1; then
        log "pg_ctl absent : instance PostgreSQL démarrée hors du conteneur"
        return 0
    fi
    log "démarrage de l'instance PostgreSQL (port $GDS_DB_PORT)"
    as_cluster_owner pg_ctl --pgdata="$PGDATA" --wait --timeout=60 \
        --log="$PGDATA/postgresql.log" \
        --options="-c listen_addresses=0.0.0.0 -p $GDS_DB_PORT" start
    log "instance PostgreSQL démarrée"
}

ensure_database_instance
start_database_instance

ensure_database_instance
start_database_instance

# ── L2.6 — service SSH (clefs uniquement, compte `git`, coquille git-shell) ──

# Génère les clefs d'hôte MANQUANTES dans le volume et ne touche JAMAIS à une
# clef existante : l'empreinte du serveur reste donc identique après
# reconstruction du conteneur (spec §2.4).
ensure_ssh_host_keys() {
    mkdir -p "$GDS_SSH_HOST_KEYS_DIR"
    chmod 700 "$GDS_SSH_HOST_KEYS_DIR" 2>/dev/null || true
    for type in ed25519 rsa; do
        key="$GDS_SSH_HOST_KEYS_DIR/ssh_host_${type}_key"
        if [ ! -s "$key" ]; then
            log "clef d'hôte $type absente : génération dans $GDS_SSH_HOST_KEYS_DIR (volume)"
            ssh-keygen -q -t "$type" -N '' -f "$key" -C "gds-server host key ($type)"
        else
            log "clef d'hôte $type conservée (empreinte inchangée)"
        fi
        chmod 600 "$key" 2>/dev/null || true
    done
}

# Résout le chemin ABSOLU de sshd (variable globale SSHD_BIN). sshd se ré-exécute
# au démarrage et refuse un chemin relatif (« sshd re-exec requires execution
# with an absolute path ») ; de plus `/usr/sbin` ne figure pas toujours dans le
# PATH du conteneur. Retourne 1 si sshd est absent de l'image.
resolve_sshd() {
    for candidate in /usr/sbin/sshd /usr/local/sbin/sshd /sbin/sshd; do
        if [ -x "$candidate" ]; then
            SSHD_BIN="$candidate"
            return 0
        fi
    done
    SSHD_BIN="$(command -v sshd 2>/dev/null || true)"
    [ -n "$SSHD_BIN" ]
}

# Rend le modèle `sshd_config` avec le port INTERNE puis le valide. Retourne 1
# (sans arrêter le conteneur) si le modèle ou sshd sont absents de l'image :
# l'assemblage de l'image relève de L2.7.
render_sshd_config() {
    src=""
    for candidate in "${GDS_SSHD_CONFIG_SRC:-}" "$(dirname "$0")/sshd_config" \
                     /etc/gds/sshd_config /usr/local/share/gds/sshd_config; do
        if [ -n "$candidate" ] && [ -f "$candidate" ]; then
            src="$candidate"
            break
        fi
    done
    if [ -z "$src" ]; then
        log "modèle sshd_config absent de l'image : service SSH non démarré"
        return 1
    fi
    if ! resolve_sshd; then
        log "sshd absent de l'image : service SSH non démarré"
        return 1
    fi
    # sshd exige son dossier de séparation de privilèges dès la VÉRIFICATION
    # (`sshd -t` échoue sinon par « Missing privilege separation directory ») — et
    # il n'est pas forcément livré par l'image. Créé avant toute invocation.
    mkdir -p /run/sshd 2>/dev/null || true
    # sshd n'étend aucune variable d'environnement : la substitution du port est
    # faite ici, avant validation.
    sed "s/__GDS_SSH_PORT__/$GDS_SSH_PORT/g" "$src" > "$GDS_SSHD_CONFIG"
    chmod 600 "$GDS_SSHD_CONFIG" 2>/dev/null || true
    if ! "$SSHD_BIN" -t -f "$GDS_SSHD_CONFIG"; then
        log "configuration sshd invalide : service SSH non démarré ($GDS_SSHD_CONFIG)"
        return 1
    fi
    log "configuration sshd rendue depuis $src (port interne $GDS_SSH_PORT)"
}

# Résout le chemin ABSOLU du postmaster (variable globale GDS_PG_BIN) : le
# superviseur doit lancer le binaire du moteur, pas un synonyme de `PATH`.
resolve_postgres() {
    GDS_PG_BIN="$(command -v postgres 2>/dev/null || true)"
    [ -n "$GDS_PG_BIN" ] || GDS_PG_BIN="postgres"
}

# L2.7 — Arrête l'instance de BOOTSTRAP avant de confier PostgreSQL au
# superviseur. Sans cet arrêt, deux postmasters se disputeraient le port : l'un
# mourrait aussitôt et le conteneur resterait « à moitié mort » sans le dire.
# Le port est vérifié LIBÉRÉ avant de continuer, sinon le postmaster surveillé
# ne pourrait pas démarrer.
stop_bootstrap_database() {
    if ! command -v pg_ctl >/dev/null 2>&1; then
        return 0
    fi
    if ! pg_isready -h 127.0.0.1 -p "$GDS_DB_PORT" -q 2>/dev/null; then
        return 0
    fi
    log "arrêt de l'instance PostgreSQL de bootstrap (le superviseur la relance surveillée)"
    as_cluster_owner pg_ctl --pgdata="$PGDATA" --wait --timeout=60 -m fast stop || true
    i=0
    while [ "$i" -lt 15 ]; do
        pg_isready -h 127.0.0.1 -p "$GDS_DB_PORT" -q 2>/dev/null || break
        i=$((i + 1))
        sleep 1
    done
    if pg_isready -h 127.0.0.1 -p "$GDS_DB_PORT" -q 2>/dev/null; then
        log "AVERTISSEMENT : le port $GDS_DB_PORT répond encore après l'arrêt de l'instance de bootstrap"
    else
        log "instance de bootstrap arrêtée : port $GDS_DB_PORT libre pour le superv"
    fi
}

# 3-6. Préparation (base, dépôts git, clefs d'hôte, configuration sshd) puis
# confiage des TROIS processus au superviseur (L2.7). Sans binaire (image non
# assemblée), on s'arrête sans laisser croire à un démarrage.
if command -v gds-server >/dev/null 2>&1; then
    log "préparation de la base de service (gds-server --init-db)"
    gds-server --init-db
    log "préparation du compte git, de la racine des dépôts et des clefs autorisées (gds-server --init-ssh)"
    gds-server --init-ssh
    if command -v ssh-keygen >/dev/null 2>&1; then
        # Un échec ici n'arrête PAS le conteneur : le superviseur signalera
        # l'absence de sshd (FATAL) et le diagnostic reste dans les journaux,
        # au lieu d'un conteneur inutilisable sans explication.
        if ensure_ssh_host_keys && render_sshd_config; then
            log "configuration SSH prête (sshd sera démarré et surveillé par supervisord)"
        else
            log "configuration SSH indisponible (clefs d'hôte ou modèle sshd) : sshd ne pourra pas démarrer"
        fi
    else
        log "ssh-keygen absent de l'image : sshd ne pourra pas démarrer"
    fi
    # L'instance de bootstrap rend le port : le superviseur relance PostgreSQL
    # comme processus surveillé.
    stop_bootstrap_database
    if command -v supervisord >/dev/null 2>&1; then
        resolve_postgres
        if resolve_sshd; then GDS_SSHD_BIN="$SSHD_BIN"; else GDS_SSHD_BIN="/usr/sbin/sshd"; fi
        export GDS_PG_BIN GDS_SSHD_BIN
        log "confiage des trois processus (PostgreSQL, sshd, gds-server) au superviseur"
        exec supervisord -c "$GDS_SUPERVISORD_CONFIG"
    fi
    log "supervisord absent de l'image : lancement direct de gds-server (SANS supervision)"
    exec gds-server
fi
log "binaire gds-server absent de l'image : rien à lancer (assemblage de l'image en L2.7)"
