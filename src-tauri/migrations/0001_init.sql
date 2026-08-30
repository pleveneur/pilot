-- GDS Phase A — fondations serveur (spec_gds.md §2.2)
--
-- Tables de base : users, projects, project_members, git_repos, audit_gds.
-- NE PAS créer project_locks / tickets (phases B/C) — elles seront ajoutées
-- par des migrations sqlx incrémentales plus tard.

CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'dev',
    status        TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'active'
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id             BIGSERIAL PRIMARY KEY,
    name           TEXT NOT NULL UNIQUE,
    repo_name      TEXT NOT NULL DEFAULT '',
    repo_url       TEXT NOT NULL DEFAULT '',
    path_on_server TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'active',
    description    TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- V1 : tous les inscrits accèdent à tous les projets (table prête pour une
-- restriction V2). Remplie « tout le monde » par défaut.
CREATE TABLE IF NOT EXISTS project_members (
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'dev',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS git_repos (
    id             BIGSERIAL PRIMARY KEY,
    project_id     BIGINT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    path_on_server TEXT NOT NULL DEFAULT '',
    bare_path      TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Journal d'audit GDS (étend web_audit pour les actions GDS).
CREATE TABLE IF NOT EXISTS audit_gds (
    ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip      TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    action  TEXT NOT NULL DEFAULT '',
    detail  TEXT NOT NULL DEFAULT '',
    ok      BOOLEAN NOT NULL DEFAULT true
);
