-- GDS Phase A3 — clefs SSH serveur (spec_gds.md §4)
--
-- Table `ssh_keys` : clefs publiques des devs, associées à un utilisateur
-- (email) de la base. La clef publique est UNIQUE (une clef = un dev).
-- ON DELETE CASCADE : la suppression d'un user nettoie ses clefs.
-- NE PAS toucher à 0001_init.sql / 0002_project_locks.sql (migration incrémentale).

CREATE TABLE IF NOT EXISTS ssh_keys (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
