# gds-server/Dockerfile — image unique du serveur GDS (refonte GDS, lot L2.7)
#
# DÉCISION FIGÉE (micro-tâche L2.7) : le serveur GDS est livré comme un
# conteneur TOUT-EN-UN. La base de données vit DANS l'image (instance
# PostgreSQL créée sur un volume au premier démarrage), et les trois processus
# — instance PostgreSQL, sshd (dépôts git par SSH) et gds-server (API HTTP +
# jobs) — sont surveillés DANS le conteneur par `supervisord`
# (`gds-server/supervisord.conf`). Le socket du moteur Docker n'est JAMAIS monté :
# la supervision est interne, le conteneur ne pilote pas le moteur qui l'héberge.
#
# Conséquence pratique de cette décision : l'image contient TOUT le nécessaire
# pour démarrer seule (PostgreSQL 16, sshd, git, le binaire gds-server). Elle ne
# contient NI l'application desktop Tauri, NI le frontend Vite : la compilation
# est confinée à l'étage « builder », jeté ensuite. C'est ce que garantissent la
# construction multi-étages ci-dessous et le fichier `/.dockerignore` à la racine
# du dépôt (sans lui, l'image embarquerait le dépôt entier, `target/` inclus).
#
# Contexte de construction = RACINE du dépôt :
#   docker build -f gds-server/Dockerfile -t pilot-gds:local .
# (le manifeste racine du workspace déclare `src-tauri` comme membre, et le
# binaire dépend du socle `gds-core/` : le contexte ne peut pas être réduit à
# `gds-server/` — cf. `04-plan-developpement.md` §2.9).
#
# Hors périmètre de cette micro-tâche : orchestration compose et publication des
# ports (L2.8), exposition publique et Tailscale (L2.9).

# Les images de base sont paramétrables pour permettre un miroir de registre ou
# une copie hors ligne sur un poste sans accès à Docker Hub (mêmes références par
# défaut, rien d'autre à changer).
ARG RUST_IMAGE=rust:1-bookworm
ARG RUNTIME_IMAGE=postgres:16-bookworm

# ═══════════════════════════════════════════════════════════════════════════
# ÉTAGE 1 — builder : compilation du binaire seul (jeté après coup)
# ═══════════════════════════════════════════════════════════════════════════
FROM ${RUST_IMAGE} AS builder

WORKDIR /build

# Le contexte est filtré par `/.dockerignore`. On copie l'arborescence utile au
# workspace Cargo : manifestes, verrou de dépendances, socle partagé
# `gds-core/`, serveur `gds-server/` et membre `src-tauri/` (requis pour que le
# workspace se résolve — seul son manifeste et ses sources sont lus, il n'est
# jamais compilé ici).
COPY Cargo.toml Cargo.lock ./
COPY gds-core ./gds-core
COPY gds-server ./gds-server
COPY src-tauri ./src-tauri

# `--locked` : la construction utilise EXACTEMENT le verrou du dépôt, donc aucune
# résolution de dépendances en ligne et un binaire reproductible. Les deux caches
# BuildKit (registre cargo et répertoire de compilation) accélèrent les
# reconstructions et survivent à un `COPY` modifié ; ils ne font PAS partie de
# l'image. Le binaire est recopié hors du cache monté, sinon il serait perdu avec
# lui.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo build --release --locked -p gds-server \
 && cp /build/target/release/gds-server /build/gds-server.bin

# ═══════════════════════════════════════════════════════════════════════════
# ÉTAGE 2 — image finale : PostgreSQL 16 + sshd + git + supervisord + gds-server
# ═══════════════════════════════════════════════════════════════════════════
# L'image officielle PostgreSQL 16 est retenue comme base : elle fournit déjà
# `initdb`, `pg_ctl`, `pg_isready`, `psql`, le compte système `postgres` et le
# point de montage `/var/lib/postgresql/data`. C'est exactement le socle décrit
# par `03-spec-cible.md` §4.1 ; seuls sshd, git et le superviseur sont ajoutés.
FROM ${RUNTIME_IMAGE}

#  - openssh-server : sshd + ssh-keygen — accès aux dépôts git par clef (L2.6) ;
#  - git            : création et lecture des dépôts bare (socle `gds_core::git`) ;
#  - supervisor     : surveillance des trois processus (cette micro-tâche).
# `--no-install-recommends` + suppression des listes apt : image finale minimale.
# (`apt-get` n'est utilisé qu'à la construction ; le conteneur n'a besoin
# d'aucun accès réseau entrant pour installer quoi que ce soit.)
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server git supervisor \
 && rm -rf /var/lib/apt/lists/*

# ── Emplacements du serveur (identiques à ceux du script d'entrée) ──────────
#  - /var/lib/postgresql/data   : données PostgreSQL (volume, cf. VOLUME plus bas)
#  - /srv/git/repos             : racine des dépôts bare (volume)
#  - /etc/ssh/host_keys         : clefs d'hôte sshd (volume : empreinte stable)
ENV PGDATA=/var/lib/postgresql/data \
    GDS_REPOS_ROOT=/srv/git/repos \
    GDS_SSH_HOST_KEYS_DIR=/etc/ssh/host_keys \
    GDS_SSH_PORT=22 \
    GDS_DB_PORT=5432 \
    GDS_SSHD_CONFIG=/etc/ssh/sshd_config.gds \
    GDS_SSHD_CONFIG_SRC=/etc/gds/sshd_config \
    GDS_SUPERVISORD_CONFIG=/etc/gds/supervisord.conf
# Volontairement ABSENT : `GDS_DB_ADMIN_HOST`. Le script d'entrée le résout
# (`GDS_DB_ADMIN_HOST`, sinon `GDS_DB_HOST`, sinon `localhost`) et l'exporte aux
# processus surveillés. Le figer ici court-circuiterait cette chaîne de repli et
# empêcherait de viser une base hors du conteneur sans reconstruire l'image.

# ── Binaire et fichiers de service ─────────────────────────────────────────
# Le binaire `gds-server` (modes `--init-db`, `--init-ssh` et service HTTP) est
# le seul artefact repris de l'étage builder : ni sources Rust, ni dépendances de
# compilation, ni toolchain ne sont conservés.
COPY --from=builder /build/gds-server.bin /usr/local/bin/gds-server
COPY gds-server/entrypoint.sh /usr/local/bin/gds-entrypoint
COPY gds-server/sshd_config /etc/gds/sshd_config
COPY gds-server/supervisord.conf /etc/gds/supervisord.conf

# ── Notice de licence (MIT) — obligatoire dans TOUTE redistribution ────────
# Le projet est publié sous licence MIT : l'avis de copyright doit accompagner
# toute copie, image comprise. Copiée SEULE, depuis le contexte de construction
# (racine du dépôt) et non depuis l'étage builder : la notice n'a rien à voir
# avec la compilation. `/.dockerignore` ne l'exclut pas (verrouillé par
# `src/js/gds-image-license.test.js`). Emplacement d'usage : chaque distribution
# Linux y place les documents d'un logiciel (consultable sans rien installer).
COPY LICENSE /usr/share/doc/pilot-gds/LICENSE

RUN chmod 0755 /usr/local/bin/gds-server /usr/local/bin/gds-entrypoint \
 && mkdir -p /etc/ssh/host_keys /srv/git/repos /run/sshd /var/log/supervisor \
 && test -s /usr/local/bin/gds-server \
 && test -x /usr/local/bin/gds-entrypoint \
 && test -s /usr/share/doc/pilot-gds/LICENSE \
 && grep -q "MIT License" /usr/share/doc/pilot-gds/LICENSE \
 && supervisord --version >/dev/null \
 && printf '%s\n' \
      "verification de la recette : postgres=$(command -v postgres)" \
      "verification de la recette : sshd=$(command -v sshd)" \
      "verification de la recette : git=$(command -v git)" \
      "verification de la recette : supervisord=$(command -v supervisord)"

# ── Volumes : l'ETAT vit hors de l'image, le CONTENU vit dedans ────────────
# Ces trois volumes sont ce qui rend la décision « base DANS l'image » utilisable :
# les données survivent à la reconstruction de l'image, mais tout le logiciel
# (PostgreSQL, sshd, binaire) est dans l'image — aucun montage de socket Docker,
# aucun service externe à installer sur le poste.
# Les ports ne sont pas publiés par l'image (L2.8) : `EXPOSE` n'est qu'une
# indication de documentation des ports internes.
VOLUME ["/var/lib/postgresql/data", "/srv/git/repos", "/etc/ssh/host_keys"]

EXPOSE 5432 22 8080

# Le script d'entrée fait le bootstrap (base, migrations, dépôts git, clefs
# d'hôte, configuration sshd) puis remplace son propre processus par
# `supervisord` : le superviseur devient le processus du conteneur (PID 1),
# reçoit SIGTERM et arrête proprement les trois services.
ENTRYPOINT ["/usr/local/bin/gds-entrypoint"]
