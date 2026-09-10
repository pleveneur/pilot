-- GDS Phase C2.3 — tickets (spec_gds.md §2.2, §8)
--
-- Modèle de demandes/tickets : tickets + commentaires + événements (audit de
-- visibilité). `source` distingue l'origine ('web' | 'interne' | 'assistant').
-- `status` ∈ 'ouvert' | 'en cours' | 'en correction' | 'fermé' ; `priority` ∈
-- 'low' | 'medium' | 'high'. Index sur `tickets.status` / `tickets.client_id`
-- (spec §10.1). NE PAS toucher à 0001/0002/0003/0004 (migration incrémentale).

-- tickets
CREATE TABLE IF NOT EXISTS tickets (
    id                BIGSERIAL PRIMARY KEY,
    project_id        BIGINT REFERENCES projects(id) ON DELETE CASCADE,
    client_id         BIGINT REFERENCES clients(id) ON DELETE SET NULL,
    reporter_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'ouvert',
    priority          TEXT NOT NULL DEFAULT 'medium',
    source            TEXT NOT NULL DEFAULT 'assistant',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_client_id_idx ON tickets(client_id);

-- ticket_comments
CREATE TABLE IF NOT EXISTS ticket_comments (
    id            BIGSERIAL PRIMARY KEY,
    ticket_id     BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    body          TEXT NOT NULL,
    author_label  TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ticket_events (audit visibilité)
CREATE TABLE IF NOT EXISTS ticket_events (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    actor       TEXT NOT NULL DEFAULT '',
    action      TEXT NOT NULL DEFAULT '',
    detail      TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
