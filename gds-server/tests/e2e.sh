#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# gds-server/tests/e2e.sh — test de bout en bout du serveur GDS
# (refonte GDS, micro-tâche L7.6).
#
# PARCOURS (depuis un VOLUME VIERGE, jusqu'à un service qui répond encore après
# un redémarrage) :
#   1. banc d'essai jetable démarré (`docker-compose.test.yml`) ;
#   2. `POST /api/gds/setup`            → compte administrateur créé ;
#   3. `POST /api/gds/users/login`      → jeton d'administration ; une seconde
#      initialisation est refusée (409 : verrou à usage unique) ;
#   4. `POST /api/gds/admin/users`      → compte développeur actif ;
#   5. projet + dépôt écrits EN BASE (aucune route HTTP ne crée un projet : le
#      poste écrit en direct, décision 11) ; le développeur est ensuite CONNECTÉ
#      et lit la liste des projets du serveur (décision 2026-09 : avoir un compte
#      suffit, aucun rattachement par projet) ;
#   6. clef SSH de test générée, écrite EN BASE (même décision 11), puis
#      `POST /api/gds/admin/ssh-keys/refresh` → `authorized_keys` régénéré ;
#   7. dépôt bare matérialisé (`gds-server --init-ssh`), puis `git push` RÉEL en
#      SSH avec cette clef, et vérification que l'objet est arrivé côté serveur ;
#   8. `GET /api/gds/admin/audit`       → le journal contient les actions du
#      parcours ;
#   9. `GET /api/gds/admin/service` puis `POST /api/gds/admin/service/restart`
#      → le PID de `gds-server` change et la santé reste verte ;
#  10. suppression TOTALE (conteneur, volumes, image de test) — rien d'autre.
#
# ISOLATION — ce script ne touche QUE le banc d'essai :
#   projet Compose `pilot-gds-e2e`, image `pilot-gds:e2e-local`, conteneur
#   `pilot-gds-e2e`, volumes `pilot-gds-e2e_*`, ports 18080 / 12222 / 55432.
#   Il ne lit JAMAIS `gds-server/.env` (le fichier de composition de test porte
#   ses propres valeurs en clair), ne monte JAMAIS le socket Docker, ne pousse ni
#   n'étiquette aucune image. Un contrôle final (`verify_isolation`) vérifie
#   qu'aucun conteneur ni volume PRÉEXISTANT n'a bougé.
#
# PRÉREQUIS : `docker` + `docker compose` v2, `curl`, `git`, `ssh-keygen` dans le
# PATH. La construction de l'image (sautée si `pilot-gds:e2e-local` existe déjà)
# est le seul moment qui peut demander plusieurs minutes.
#
# OPTIONS : E2E_REBUILD=1 force la reconstruction de l'image ; E2E_KEEP=1 laisse
# le banc d'essai en place en cas d'échec (dépannage) au lieu de tout supprimer.
#
# Sortie : code 0 si TOUT le parcours passe, 1 au premier échec.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Sous Git Bash (Windows), les arguments qui ressemblent à des chemins POSIX sont
# réécrits avant d'atteindre les programmes natifs (docker, curl) : on désactive
# cette conversion. Sans effet sur Linux / macOS.
export MSYS_NO_PATHCONV=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.." # gds-server/ : les fichiers Compose sont relatifs à ce dossier

COMPOSE_FILE="docker-compose.test.yml"
CONTAINER="pilot-gds-e2e"
IMAGE="pilot-gds:e2e-local"
COMPOSE=(docker compose -f "${COMPOSE_FILE}")

HTTP_PORT="18080"
SSH_PORT="12222"
BASE_URL="http://127.0.0.1:${HTTP_PORT}"
SSH_URL_BASE="ssh://git@127.0.0.1:${SSH_PORT}"

DB_NAME="pilot_gds"
DB_ADMIN_USER="postgres"
SUPERVISORD_CONF="/etc/gds/supervisord.conf"

PROJECT="e2e-projet"
REPO_ON_SERVER="/srv/git/repos/${PROJECT}.git"
ADMIN_EMAIL="e2e-admin@example.test"
ADMIN_PASSWORD="E2eAdmin-Passw0rd-1"
DEV_EMAIL="e2e-dev@example.test"
DEV_PASSWORD="E2eDev-Passw0rd-1"

STEP=0
# ── Journalisation ─────────────────────────────────────────────────────────
log() { STEP=$((STEP + 1)); printf '\n\033[1m── étape %d : %s\033[0m\n' "${STEP}" "$*"; }
ok()  { printf '   \033[32m✔\033[0m %s\n' "$*"; }
info(){ printf '     %s\n' "$*"; }
die() { printf '\n\033[31m✘ ÉCHEC : %s\033[0m\n' "$*" >&2; exit 1; }

# Exécute un psql d'administration DANS le conteneur (socket local, `trust`).
psql_admin() { # SQL
  docker exec -i "${CONTAINER}" psql -U "${DB_ADMIN_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 "$@" </dev/null
}

# ── Outils HTTP ────────────────────────────────────────────────────────────
# Le corps de la dernière réponse est TOUJOURS dans ${BODY_FILE} ; `http` renvoie
# le code de statut sur la sortie standard.
BODY_FILE=""
TOKEN=""
http() { # METHOD PATH [JSON]
  local method="$1" path="$2" data="${3:-}"
  local args=(-sS -o "${BODY_FILE}" -w '%{http_code}' -X "${method}" "${BASE_URL}${path}")
  if [ -n "${TOKEN}" ]; then args+=(-H "Authorization: Bearer ${TOKEN}"); fi
  if [ -n "${data}" ]; then args+=(-H 'Content-Type: application/json' --data-binary "${data}"); fi
  curl "${args[@]}" || die "requête curl impossible : ${method} ${path}"
}

# Extrait une valeur simple (chaîne ou nombre) d'un champ de premier niveau.
jf() { tr -d '\n' < "${BODY_FILE}" | sed -n "s/.*\"$1\":[ ]*\([^,}]*\).*/\1/p" | head -n1 | tr -d '"'; }

expect_status() { # attendu obtenu libellé
  if [ "$1" != "$2" ]; then
    printf '\n   corps de la réponse : '
    cat "${BODY_FILE}"
    printf '\n'
    die "$3 : statut attendu $1, obtenu $2"
  fi
  ok "$3 (HTTP $2)"
}
assert_non_empty() { [ -n "$2" ] || die "$1 est vide"; ok "$1 renseigné"; }
assert_contains() { # fichier motif libellé
  if ! grep -q -- "$2" "$1"; then
    printf '\n   contenu : '
    head -c 800 "$1"
    printf '\n'
    die "$3"
  fi
  ok "$3"
}

# ── Supervision interne ────────────────────────────────────────────────────
# PID annoncé par le superviseur pour `gds-server`. VIDE tant que le programme
# n'est pas encore « RUNNING » : pendant `startsecs`, supervisord affiche
# « STARTING » sans aucun PID (course possible juste après le démarrage).
server_pid_now() {
  docker exec "${CONTAINER}" supervisorctl -c "${SUPERVISORD_CONF}" status gds-server 2>/dev/null \
    | awk '{for(i=1;i<=NF;i++) if($i=="pid") print $(i+1)}' | tr -d ',' || true
}

# Attend (jusqu'à 60 s) que le superviseur annonce un PID : le programme tourne
# alors réellement, et non plus seulement en cours de démarrage.
read_server_pid() {
  local deadline=$((SECONDS + 60)) pid=""
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    pid="$(server_pid_now)"
    if [ -n "${pid}" ]; then printf '%s' "${pid}"; return 0; fi
    sleep 2
  done
  return 1
}

# ── Nettoyage et contrôle d'isolation ──────────────────────────────────────
PRE_CONTAINERS=""; PRE_VOLUMES=""
snapshot_docker() {
  PRE_CONTAINERS="$(docker ps -a --format '{{.Names}}' | sort)"
  PRE_VOLUMES="$(docker volume ls --format '{{.Name}}' | sort)"
}

verify_isolation() {
  printf '\n\033[1m── contrôle d’isolation\033[0m\n'
  local name missing=0
  while IFS= read -r name; do
    [ -z "${name}" ] && continue
    docker ps -a --format '{{.Names}}' | grep -qx -- "${name}" || { printf '   ✘ conteneur préexistant DISPARU : %s\n' "${name}"; missing=1; }
  done <<< "${PRE_CONTAINERS}"
  while IFS= read -r name; do
    [ -z "${name}" ] && continue
    docker volume ls --format '{{.Name}}' | grep -qx -- "${name}" || { printf '   ✘ volume préexistant DISPARU : %s\n' "${name}"; missing=1; }
  done <<< "${PRE_VOLUMES}"
  [ "${missing}" -eq 0 ] && ok "tous les conteneurs et volumes préexistants sont intacts"
  if [ "${E2E_KEEP:-0}" != "1" ]; then
    docker ps -a --format '{{.Names}}' | grep -qx -- "${CONTAINER}" && die "le conteneur de test ${CONTAINER} subsiste"
    docker volume ls --format '{{.Name}}' | grep -q -- '^pilot-gds-e2e_' && die "des volumes de test subsistent"
    ok "aucun reste du banc d’essai (conteneur et volumes de test supprimés)"
  fi
  printf '\n   conteneurs présents APRÈS :\n'
  docker ps -a --format '   {{.Names}} ({{.Image}})' || true
  printf '   volumes présents APRÈS :\n'
  docker volume ls --format '   {{.Name}}' || true
}

dump_logs() {
  if docker ps -a --format '{{.Names}}' | grep -qx -- "${CONTAINER}"; then
    printf '\n\033[1m── journaux du conteneur (200 dernières lignes)\033[0m\n'
    docker logs --tail 200 "${CONTAINER}" 2>&1 || true
    printf '\n── état des processus internes ──\n'
    docker exec "${CONTAINER}" supervisorctl -c "${SUPERVISORD_CONF}" status 2>&1 || true
  fi
}

cleanup() {
  local rc=$?
  if [ "${E2E_KEEP:-0}" = "1" ]; then
    printf '\n\033[33mE2E_KEEP=1 : banc d’essai conservé (conteneur %s, image %s)\033[0m\n' "${CONTAINER}" "${IMAGE}"
  else
    printf '\n── nettoyage : suppression du banc d’essai ──\n'
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
    docker rmi "${IMAGE}" >/dev/null 2>&1 || true
  fi
  verify_isolation
  rm -rf "${WORK:-}" >/dev/null 2>&1 || true
  exit "${rc}"
}
trap 'dump_logs' ERR
trap cleanup EXIT

# ── 0. Prérequis ───────────────────────────────────────────────────────────
log "prérequis (docker, compose v2, curl, git, ssh-keygen)"
for tool in docker curl git ssh-keygen; do
  command -v "${tool}" >/dev/null 2>&1 || die "outil manquant dans le PATH : ${tool}"
done
docker info >/dev/null 2>&1 || die "le moteur Docker ne répond pas"
docker compose version >/dev/null 2>&1 || die "la sous-commande « docker compose » (v2) est indisponible"
ok "tous les outils sont présents"
snapshot_docker
info "conteneurs préexistants : $(echo "${PRE_CONTAINERS}" | tr '\n' ' ')"
info "volumes préexistants (comptés) : $(echo "${PRE_VOLUMES}" | grep -c . ) "

WORK="$(mktemp -d)" || die "mktemp -d impossible"
if command -v cygpath >/dev/null 2>&1; then WORK="$(cygpath -m "${WORK}")"; fi
BODY_FILE="${WORK}/body.json"
info "espace de travail temporaire : ${WORK}"

# ── 1. Banc d'essai jetable ────────────────────────────────────────────────
log "banc d’essai jetable (volume vierge, ports 18080 / 12222 / 55432)"
"${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
if [ "${E2E_REBUILD:-0}" = "1" ] || ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  info "construction de l’image de test (peut prendre plusieurs minutes)…"
  "${COMPOSE[@]}" build || die "construction de l’image de test impossible"
  ok "image ${IMAGE} construite"
else
  info "image ${IMAGE} déjà présente (E2E_REBUILD=1 pour la reconstruire)"
  ok "image ${IMAGE} réutilisée"
fi
"${COMPOSE[@]}" up -d || die "démarrage du banc d’essai impossible"
ok "conteneur ${CONTAINER} démarré"

log "attente de la santé (base prête + route publique)"
deadline=$((SECONDS + 240))
healthy=0
health_status="?"
health_code="?"
while [ "${SECONDS}" -lt "${deadline}" ]; do
  health_status="$(docker inspect -f '{{.State.Health.Status}}' "${CONTAINER}" 2>/dev/null || echo starting)"
  health_code="$(curl -sS -o "${BODY_FILE}" -w '%{http_code}' "${BASE_URL}/api/gds/health" 2>/dev/null || true)"
  if [ "${health_status}" = "healthy" ] && [ "${health_code}" = "200" ]; then healthy=1; break; fi
  sleep 3
done
[ "${healthy}" = "1" ] || die "banc d’essai non sain en 240 s (santé=${health_status}, /health=${health_code})"
ok "santé du conteneur : healthy, /api/gds/health : 200"
info "rapport de santé : $(cat "${BODY_FILE}")"

# ── 2. Initialisation de l'administrateur ──────────────────────────────────
log "initialisation du compte administrateur (POST /api/gds/setup)"
BODY_SETUP="{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}"
status="$(http POST /api/gds/setup "${BODY_SETUP}")"
expect_status 200 "${status}" "compte administrateur créé"
info "réponse : $(cat "${BODY_FILE}")"

log "le verrou d’initialisation est effectif (second setup refusé)"
status="$(http POST /api/gds/setup "${BODY_SETUP}")"
expect_status 409 "${status}" "second appel /api/gds/setup refusé"

# ── 3. Connexion de l'administrateur ───────────────────────────────────────
log "connexion de l’administrateur (POST /api/gds/users/login)"
status="$(http POST /api/gds/users/login "${BODY_SETUP}")"
expect_status 200 "${status}" "connexion réussie"
TOKEN="$(jf token)"
assert_non_empty "jeton d’administration" "${TOKEN}"
[ "$(jf role)" = "admin" ] || die "rôle inattendu porté par le jeton : $(jf role)"
ok "rôle porté par le jeton : admin"

log "lecture de l’état du service (GET /api/gds/admin/service)"
status="$(http GET /api/gds/admin/service)"
expect_status 200 "${status}" "état du service lu"
assert_contains "${BODY_FILE}" '"pid"' "état contenant un PID"
assert_contains "${BODY_FILE}" 'gds-server' "programme gds-server supervisé"
assert_contains "${BODY_FILE}" 'RUNNING' "programme gds-server en marche"
PID_BEFORE="$(read_server_pid)" || die "gds-server ne tourne pas : aucun PID annoncé par le superviseur"
assert_non_empty "PID de gds-server avant redémarrage" "${PID_BEFORE}"

# ── 4. Création du développeur ─────────────────────────────────────────────
log "création d’un compte développeur actif (POST /api/gds/admin/users)"
BODY_DEV="{\"email\":\"${DEV_EMAIL}\",\"name\":\"E2E Dev\",\"password\":\"${DEV_PASSWORD}\",\"role\":\"dev\"}"
status="$(http POST /api/gds/admin/users "${BODY_DEV}")"
expect_status 200 "${status}" "compte développeur créé"
DEV_ID="$(jf id)"
assert_non_empty "identifiant du développeur" "${DEV_ID}"
[ "$(jf status)" = "active" ] || die "le compte développeur n’est pas actif : $(jf status)"
ok "compte développeur actif (id=${DEV_ID})"

# psql imprime, pour un INSERT, la ligne de résultat PUIS l’étiquette de commande
# (`INSERT 0 1`) : on ne garde que la première ligne purement numérique.
psql_scalar() { # SQL
  psql_admin -t -A -c "$1" | tr -d '\r' | grep -E '^[0-9]+$' | head -n1
}

# ── 5. Projet + accès du développeur ──────────────────────────────────────
# Aucune route HTTP ne crée un projet : le poste écrit projet et dépôt
# DIRECTEMENT en base (décision 11). Le script fait de même. Décision 2026-09 :
# le rattachement par projet a été SUPPRIMÉ ; un simple compte serveur accède à
# tous les projets. On vérifie donc la liste des projets vue par le dev.
log "écriture du projet et de son dépôt en base (décision 11)"
PROJECT_ID="$(psql_scalar "INSERT INTO projects (name, repo_name, repo_url, path_on_server, status, description) VALUES ('${PROJECT}', '${PROJECT}.git', '${SSH_URL_BASE}${REPO_ON_SERVER}', '${REPO_ON_SERVER}', 'active', 'banc d essai L7.6') RETURNING id;")"
psql_admin -c "INSERT INTO git_repos (project_id, path_on_server, bare_path) VALUES (${PROJECT_ID}, '${REPO_ON_SERVER}', '${REPO_ON_SERVER}');" >/dev/null
ok "projet « ${PROJECT} » (id=${PROJECT_ID}) et son dépôt écrits en base"

log "connexion du développeur (POST /api/gds/users/login)"
status="$(http POST /api/gds/users/login "{\"email\":\"${DEV_EMAIL}\",\"password\":\"${DEV_PASSWORD}\"}")"
expect_status 200 "${status}" "développeur connecté"
DEV_TOKEN="$(jf token)"
[ -n "${DEV_TOKEN}" ] || die "le serveur n'a pas renvoyé de jeton pour le développeur"

log "le développeur (sans aucun rattachement) voit le projet (GET /api/gds/projects)"
DEV_SAVED_TOKEN="${TOKEN}"
TOKEN="${DEV_TOKEN}"
status="$(http GET /api/gds/projects)"
TOKEN="${DEV_SAVED_TOKEN}"
expect_status 200 "${status}" "projets lus par le développeur"
assert_contains "${BODY_FILE}" "${PROJECT}" "un compte serveur accède à tous les projets du serveur"

log "les routes d'attribution ont disparu (404 pour l'administrateur)"
status="$(http POST /api/gds/admin/projects/assign "{\"project_id\":${PROJECT_ID},\"email\":\"${DEV_EMAIL}\"}")"
expect_status 404 "${status}" "route d'attribution supprimée"

# ── 6. Clef SSH du développeur ─────────────────────────────────────────────
log "enregistrement d’une clef SSH (en base, décision 11)"
KEY="${WORK}/id_ed25519"
ssh-keygen -q -t ed25519 -N '' -C 'e2e@pilot' -f "${KEY}" || die "génération de la clef SSH impossible"
PUBKEY="$(cat "${KEY}.pub")"
info "clef publique de test : $(echo "${PUBKEY}" | cut -d' ' -f1,2 | cut -c1-40)…"
psql_admin -c "INSERT INTO ssh_keys (user_id, public_key) VALUES (${DEV_ID}, '${PUBKEY}');" >/dev/null
ok "clef enregistrée en base pour le développeur"

log "régénération du fichier des clefs autorisées (POST /api/gds/admin/ssh-keys/refresh)"
status="$(http POST /api/gds/admin/ssh-keys/refresh)"
expect_status 200 "${status}" "régénération des clefs autorisées"
KEYS="$(jf keys)"
assert_non_empty "nombre de clefs prises en compte" "${KEYS}"
[ "${KEYS}" -ge 1 ] || die "aucune clef prise en compte par la régénération (keys=${KEYS})"
ok "clefs autorisées régénérées (keys=${KEYS}, rewritten=$(jf rewritten))"
info "chemin du fichier : $(jf path)"

log "liste des clefs SSH du serveur (GET /api/gds/admin/ssh-keys)"
status="$(http GET /api/gds/admin/ssh-keys)"
expect_status 200 "${status}" "liste des clefs lue"
assert_contains "${BODY_FILE}" "${DEV_EMAIL}" "la clef est rattachée au développeur"

# ── 7. Dépôt bare + git push en SSH ───────────────────────────────────────
log "matérialisation du dépôt bare (gds-server --init-ssh)"
if ! docker exec "${CONTAINER}" gds-server --init-ssh > "${WORK}/init-ssh.log" 2>&1; then
  sed 's/^/     /' "${WORK}/init-ssh.log"
  die "gds-server --init-ssh a échoué"
fi
sed 's/^/     /' "${WORK}/init-ssh.log"
docker exec "${CONTAINER}" test -d "${REPO_ON_SERVER}" || die "le dépôt bare ${REPO_ON_SERVER} n’existe pas"
docker exec "${CONTAINER}" test -f "${REPO_ON_SERVER}/HEAD" || die "${REPO_ON_SERVER} n’est pas un dépôt bare valide"
ok "dépôt bare créé : ${REPO_ON_SERVER}"

log "git push RÉEL en SSH (clef du développeur)"
REPO_DIR="${WORK}/depot"
git init -q "${REPO_DIR}"
git -C "${REPO_DIR}" config user.email "${DEV_EMAIL}"
git -C "${REPO_DIR}" config user.name "E2E Dev"
printf '# Projet E2E\n\nContenu poussé par tests/e2e.sh.\n' > "${REPO_DIR}/README.md"
git -C "${REPO_DIR}" add README.md
git -C "${REPO_DIR}" commit -q -m "commit e2e initial"
git -C "${REPO_DIR}" remote add origin "${SSH_URL_BASE}${REPO_ON_SERVER}"
export GIT_SSH_COMMAND="ssh -i ${KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${WORK}/known_hosts -o BatchMode=yes"
export GIT_TERMINAL_PROMPT=0
if ! push_out="$(git -C "${REPO_DIR}" push -q origin HEAD:refs/heads/main 2>&1)"; then
  printf '%s\n' "${push_out}" | sed 's/^/     /'
  die "git push SSH a échoué"
fi
[ -n "${push_out}" ] && printf '%s\n' "${push_out}" | sed 's/^/     /'
ok "push SSH accepté par le serveur"

log "vérification de l’objet reçu côté serveur"
# Le dépôt bare est créé par `git init --bare` : son HEAD pointe encore sur la
# branche par défaut de git (`master`) alors que la poussée a visé `main`. La
# vérification porte donc sur la RÉFÉRENCE POUSSÉE (`refs/heads/main`) et non
# sur HEAD, et compare les empreintes du commit des deux côtés.
REMOTE_LOG="$(docker exec "${CONTAINER}" git --git-dir="${REPO_ON_SERVER}" log --oneline -1 refs/heads/main)"
info "dernier commit du dépôt serveur : ${REMOTE_LOG}"
case "${REMOTE_LOG}" in
  *"commit e2e initial"*) ok "le commit poussé est bien présent dans le dépôt serveur" ;;
  *) die "le dépôt serveur ne contient pas le commit poussé : ${REMOTE_LOG}" ;;
esac
LOCAL_SHA="$(git -C "${REPO_DIR}" rev-parse HEAD)"
REMOTE_SHA="$(docker exec "${CONTAINER}" git --git-dir="${REPO_ON_SERVER}" rev-parse refs/heads/main)"
[ "${LOCAL_SHA}" = "${REMOTE_SHA}" ] || die "empreintes différentes : poste=${LOCAL_SHA} serveur=${REMOTE_SHA}"
ok "empreinte identique des deux côtés (${LOCAL_SHA})"
REMOTE_BRANCH="$(docker exec "${CONTAINER}" git --git-dir="${REPO_ON_SERVER}" branch --list main)"
[ -n "${REMOTE_BRANCH}" ] || die "la branche main n’existe pas côté serveur"
ok "branche main présente côté serveur"
info "HEAD du dépôt serveur : $(docker exec "${CONTAINER}" git --git-dir="${REPO_ON_SERVER}" symbolic-ref HEAD)"

# ── 8. Journal d'audit ─────────────────────────────────────────────────────
log "lecture du journal d’audit (GET /api/gds/admin/audit?scope=all)"
status="$(http GET '/api/gds/admin/audit?scope=all&limit=200')"
expect_status 200 "${status}" "journal d’audit lu"
TOTAL="$(jf total)"
assert_non_empty "total d’entrées d’audit" "${TOTAL}"
[ "${TOTAL}" -ge 4 ] || die "journal trop pauvre : total=${TOTAL}"
ok "entrées d’audit après filtre : ${TOTAL}"
for action in login user_create; do
  assert_contains "${BODY_FILE}" "\"action\":\"${action}\"" "le journal contient l’action « ${action} »"
done

# ── 9. Redémarrage du service ──────────────────────────────────────────────
log "redémarrage du service (POST /api/gds/admin/service/restart)"
restart_code="$(http POST /api/gds/admin/service/restart)"
if [ "${restart_code}" != "200" ] && [ "${restart_code}" != "202" ]; then
  cat "${BODY_FILE}"
  die "redémarrage refusé (HTTP ${restart_code})"
fi
ok "ordre de redémarrage accepté (HTTP ${restart_code})"
info "réponse : $(cat "${BODY_FILE}")"

log "attente du redémarrage effectif (nouveau PID + santé verte)"
deadline=$((SECONDS + 180))
new_pid=""
health_status="?"
while [ "${SECONDS}" -lt "${deadline}" ]; do
  health_status="$(docker inspect -f '{{.State.Health.Status}}' "${CONTAINER}" 2>/dev/null || echo starting)"
  new_pid="$(server_pid_now)"
  if [ "${health_status}" = "healthy" ] && [ -n "${new_pid}" ] && [ "${new_pid}" != "${PID_BEFORE}" ]; then break; fi
  sleep 3
done
[ -n "${new_pid}" ] || die "gds-server n’a pas redémarré (PID introuvable, santé=${health_status})"
[ "${new_pid}" != "${PID_BEFORE}" ] || die "le PID de gds-server n’a pas changé (${PID_BEFORE}) : redémarrage NON effectif"
ok "gds-server redémarré : PID ${PID_BEFORE} → ${new_pid}"

status="$(http GET /api/gds/health)"
expect_status 200 "${status}" "santé publique après redémarrage"
info "réponse de santé : $(cut -c1-200 "${BODY_FILE}")…"

# ── 10. Fin ────────────────────────────────────────────────────────────────
printf '\n\033[1;32m═══════════════════════════════════════════════════════\n'
printf '  PARCOURS DE BOUT EN BOUT : TOUT EST PASSÉ (%d étapes)\n' "${STEP}"
printf '═══════════════════════════════════════════════════════\033[0m\n'
