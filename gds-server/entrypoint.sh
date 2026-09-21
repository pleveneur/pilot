#!/bin/sh
# gds-server/entrypoint.sh — démarrage du conteneur tout-en-un GDS.
#
# Périmètre des micro-tâches L2.3 (« base à partir d'un volume vide »), L2.5
# (« dépôts git : utilisateur git, racine, clefs autorisées ») et L2.6
# (« service SSH : sshd, clefs d'hôte persistantes, coquille git ») :
#   1. création de l'INSTANCE PostgreSQL sur le volume (`initdb`) si le datadir
#      est VIDE — un datadir déjà initialisé est CONSERVÉ tel quel (aucune
#      réinitialisation, les données du volume ne sont jamais effacées) ;
#   2. mise en route de l'instance si elle n'écoute pas encore ;
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
#      (`sshd -t`), puis démarrage de sshd. Authentification par clef uniquement,
#      compte `git` uniquement, coquille `git-shell` ;
#   6. lancement du service HTTP (`gds-server`, micro-tâche L2.1), qui continue de
#      rafraîchir `authorized_keys` et de matérialiser les dépôts bare
#      périodiquement (le poste enregistre ses clefs et ses projets directement
#      en base, donc sans notification possible).
#
# Hors périmètre (micro-tâches suivantes, à ne pas traiter ici) : supervision
# complète des processus et assemblage de l'image (L2.7), orchestration compose
# (L2.8). Le démarrage de l'instance PostgreSQL (étape 2) et de sshd (étape 5)
# sera repris par le superviseur en L2.7.
#
# Variables reconnues : `PGDATA` (défaut /var/lib/postgresql/data),
# `POSTGRES_PASSWORD` (secret du compte d'administration, cf. spec §6.4),
# `GDS_DB_ADMIN_USER` (défaut « postgres »), `GDS_DB_ADMIN_PASSWORD` (défaut
# POSTGRES_PASSWORD), `GDS_DB_ADMIN_HOST` (défaut GDS_DB_HOST puis localhost),
# `GDS_DB_PORT` (défaut 5432), `GDS_REPOS_ROOT` (défaut /srv/git/repos : racine des
# dépôts bare, sur volume), `GDS_SSH_PORT` (défaut 22 : port INTERNE de sshd, le
# port publié 2222 étant un réglage du conteneur), `GDS_SSH_HOST_KEYS_DIR`
# (défaut /etc/ssh/host_keys : dossier des clefs d'hôte, sur volume),
# `GDS_SSHD_CONFIG_SRC` (modèle sshd_config à rendre, sinon celui livré à côté de
# ce script). Aucun secret n'est journalisé.

set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
GDS_DB_ADMIN_USER="${GDS_DB_ADMIN_USER:-postgres}"
GDS_DB_ADMIN_PASSWORD="${GDS_DB_ADMIN_PASSWORD:-${POSTGRES_PASSWORD:-}}"
GDS_DB_ADMIN_HOST="${GDS_DB_ADMIN_HOST:-${GDS_DB_HOST:-localhost}}"
GDS_DB_PORT="${GDS_DB_PORT:-5432}"
# Racine des dépôts bare (volume monté). Explicité ici : la valeur alimente la
# préparation du compte `git` (L2.5) et sera réutilisée par la création des
# dépôts (L2.6).
GDS_REPOS_ROOT="${GDS_REPOS_ROOT:-/srv/git/repos}"
# L2.6 — port INTERNE de sshd (le port publié 2222 est un réglage du conteneur,
# cf. compose en L2.8). Les clefs d'hôte vivent sur un volume : sans lui,
# l'empreinte du serveur changerait à chaque reconstruction.
GDS_SSH_PORT="${GDS_SSH_PORT:-22}"
GDS_SSH_HOST_KEYS_DIR="${GDS_SSH_HOST_KEYS_DIR:-/etc/ssh/host_keys}"
# Fichier rendu (port substitué) et journal de sshd : le conteneur n'a pas de
# démon syslog, sshd écrit donc dans un fichier.
GDS_SSHD_CONFIG="${GDS_SSHD_CONFIG:-/etc/ssh/sshd_config.gds}"
GDS_SSHD_LOG="${GDS_SSHD_LOG:-/var/log/gds-sshd.log}"
export PGDATA GDS_DB_ADMIN_USER GDS_DB_ADMIN_PASSWORD GDS_DB_ADMIN_HOST GDS_DB_PORT GDS_REPOS_ROOT
export GDS_SSH_PORT GDS_SSH_HOST_KEYS_DIR GDS_SSHD_CONFIG GDS_SSHD_LOG

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

# 1. Instance PostgreSQL : créée sur un volume VIDE, conservée sinon.
ensure_database_instance() {
    if [ -s "$PGDATA/PG_VERSION" ]; then
        log "instance PostgreSQL déjà présente dans $PGDATA : données conservées"
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
                     /usr/local/share/gds/sshd_config; do
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

# Démarre sshd en arrière-plan (il se détache de lui-même) ; idempotent : un
# sshd déjà en cours n'est pas relancé. Le superviseur reprendra ce démarrage en
# L2.7.
start_ssh_service() {
    if command -v pgrep >/dev/null 2>&1 && pgrep -x sshd >/dev/null 2>&1; then
        log "service SSH déjà en cours"
        return 0
    fi
    if ! resolve_sshd; then
        log "sshd absent de l'image : service SSH non démarré"
        return 1
    fi
    log "démarrage du service SSH (port interne $GDS_SSH_PORT, clefs uniquement)"
    "$SSHD_BIN" -f "$GDS_SSHD_CONFIG" -E "$GDS_SSHD_LOG"
}

# 3-6. Préparation de la base, préparation des dépôts git, service SSH puis
# service HTTP. Sans binaire (image non encore assemblée, micro-tâche L2.7), on
# s'arrête sans laisser croire à un démarrage.
if command -v gds-server >/dev/null 2>&1; then
    log "préparation de la base de service (gds-server --init-db)"
    gds-server --init-db
    log "préparation du compte git, de la racine des dépôts et des clefs autorisées (gds-server --init-ssh)"
    gds-server --init-ssh
    if command -v ssh-keygen >/dev/null 2>&1; then
        # Un échec de génération laisse le service HTTP démarrer : le diagnostic
        # reste dans les journaux au lieu de rendre le conteneur inutilisable.
        if ensure_ssh_host_keys && render_sshd_config; then
            start_ssh_service || log "service SSH non démarré (voir $GDS_SSHD_LOG)"
        else
            log "service SSH non démarré (clefs d'hôte ou configuration sshd indisponibles)"
        fi
    else
        log "ssh-keygen absent de l'image : service SSH non démarré"
    fi
    log "lancement du service gds-server"
    exec gds-server
fi
log "binaire gds-server absent de l'image : rien à lancer (assemblage de l'image en L2.7)"
