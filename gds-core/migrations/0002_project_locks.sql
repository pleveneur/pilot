-- GDS Phase B — verrous de projet (spec_gds.md §5)
--
-- UN verrou global par projet (project_id UNIQUE). TTL/lease via expires_at
-- (epoch millis) pour récupérer les verrous orphelins (crash du dev). Mode
-- urgent (urgent BOOL) pour passer outre un verrou (réservé à la personne
-- désignée). ON DELETE CASCADE : la suppression d'un projet/user nettoie ses
-- verrous. NE PAS toucher à 0001_init.sql (migration incrémentale).

CREATE TABLE IF NOT EXISTS project_locks (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email      TEXT NOT NULL DEFAULT '',
    locked_at  BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    urgent     BOOLEAN NOT NULL DEFAULT false,
    reason     TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL
);
