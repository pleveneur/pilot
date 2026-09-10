-- GDS Phase C1.1 — suivi fusionné (spec_gds.md §6, §2.2)
--
-- Tables du suivi (clients, projects, tasks, decisions) alignées sur le schéma
-- SQLite du super-agent (~/.pilot/super-agent.db). `updated_at` sert de clé de
-- résolution de divergence (Option A : « dernier écrit gagne » + log des
-- conflits, §6.1). La table `projects` existe déjà (0001_init.sql, dépôts git
-- GDS) : on l'étend avec les colonnes du suivi (path, client_id) SANS toucher
-- aux colonnes existantes. NE PAS toucher à 0001/0002/0003 (migration
-- incrémentale).

-- clients
CREATE TABLE IF NOT EXISTS clients (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    notes      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- projects (suivi) : étend la table GDS existante (0001) avec les colonnes du
-- suivi. `path` = chemin local du projet (clé naturelle du suivi SQLite).
-- Index unique partiel : les projets GDS (git) ont path NULL (plusieurs NULL
-- autorisés), les projets de suivi ont un path unique.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS path TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES clients(id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_path_key ON projects(path) WHERE path IS NOT NULL;

-- tasks
CREATE TABLE IF NOT EXISTS tasks (
    id             BIGSERIAL PRIMARY KEY,
    project_id     BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'demande',
    deadline       TEXT NOT NULL DEFAULT '',
    blocker_reason TEXT NOT NULL DEFAULT '',
    source_task_id BIGINT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- decisions
CREATE TABLE IF NOT EXISTS decisions (
    id             BIGSERIAL PRIMARY KEY,
    project_id     BIGINT REFERENCES projects(id) ON DELETE CASCADE,
    task_id        BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
    summary        TEXT NOT NULL,
    source_session TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
