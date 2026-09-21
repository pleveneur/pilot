#!/bin/sh
# gds-server/entrypoint.sh — démarrage du conteneur tout-en-un GDS.
#
# Périmètre de la micro-tâche L2.3 (« initialisation de la base à partir d'un
# volume vide ») :
#   1. création de l'INSTANCE PostgreSQL sur le volume (`initdb`) si le datadir
#      est VIDE — un datadir déjà initialisé est CONSERVÉ tel quel (aucune
#      réinitialisation, les données du volume ne sont jamais effacées) ;
#   2. mise en route de l'instance si elle n'écoute pas encore ;
#   3. préparation de la base de service par le socle, via le binaire :
#      `gds-server --init-db` (création du rôle et de la base `pilot_gds` s'ils
#      sont absents, puis migrations embarquées — idempotent) ;
#   4. lancement du service HTTP (`gds-server`, micro-tâche L2.1).
#
# Hors périmètre de L2.3 (micro-tâches suivantes, à ne pas traiter ici) :
# utilisateur système `git` et `authorized_keys` (L2.5), sshd + dépôt bare
# automatique (L2.6), supervision complète des processus et assemblage de
# l'image (L2.7), orchestration compose (L2.8). Le démarrage de l'instance
# PostgreSQL fait ici (étape 2) sera repris par le superviseur en L2.7.
#
# Variables reconnues : `PGDATA` (défaut /var/lib/postgresql/data),
# `POSTGRES_PASSWORD` (secret du compte d'administration, cf. spec §6.4),
# `GDS_DB_ADMIN_USER` (défaut « postgres »), `GDS_DB_ADMIN_PASSWORD` (défaut
# POSTGRES_PASSWORD), `GDS_DB_ADMIN_HOST` (défaut GDS_DB_HOST puis localhost),
# `GDS_DB_PORT` (défaut 5432). Aucun secret n'est journalisé.

set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
GDS_DB_ADMIN_USER="${GDS_DB_ADMIN_USER:-postgres}"
GDS_DB_ADMIN_PASSWORD="${GDS_DB_ADMIN_PASSWORD:-${POSTGRES_PASSWORD:-}}"
GDS_DB_ADMIN_HOST="${GDS_DB_ADMIN_HOST:-${GDS_DB_HOST:-localhost}}"
GDS_DB_PORT="${GDS_DB_PORT:-5432}"
export PGDATA GDS_DB_ADMIN_USER GDS_DB_ADMIN_PASSWORD GDS_DB_ADMIN_HOST GDS_DB_PORT

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

# 3-4. Préparation de la base puis service HTTP. Sans binaire (image non encore
# assemblée, micro-tâche L2.7), on s'arrête sans laisser croire à un démarrage.
if command -v gds-server >/dev/null 2>&1; then
    log "préparation de la base de service (gds-server --init-db)"
    gds-server --init-db
    log "lancement du service gds-server"
    exec gds-server
fi
log "binaire gds-server absent de l'image : rien à lancer (assemblage de l'image en L2.7)"
