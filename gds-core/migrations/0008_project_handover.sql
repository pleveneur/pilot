-- GDS — mode réseau multi-postes : prise en main (portage) d'un projet — 0008
--
-- Remplace le verrou global supprimé par 0007 par une **prise en main par
-- projet** (PLAN-mode-reseau-multipostes.md §6 a) : un seul porteur actif à la
-- fois, désigné par le couple (user_id, poste_id), renouvelé par une présence
-- toutes les 3 minutes et libéré automatiquement après 15 minutes sans
-- présence. L'expiration est **paresseuse** (évaluée à chaque lecture/écriture
-- sur `expires_at < now()`) : aucun job planifié ne balaie cette table.
--
-- La ligne est **clôturée, jamais supprimée** (`returned_at` renseigné) :
-- l'historique de qui a tenu le projet, quand, et comment le portage a pris fin
-- est conservé.
--
-- NE PAS renuméroter 0001…0007 : les noms de fichiers déterminent les versions
-- appliquées par sqlx, une renumérotation casserait les bases existantes.
-- Ce fichier est écrit en **fins de ligne LF** : le test
-- `db::tests::embedded_migrations_are_lf` échoue si un CR est réintroduit
-- (l'empreinte SHA-384 du registre `_sqlx_migrations` serait invalidée).

CREATE TABLE IF NOT EXISTS project_handovers (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT NOT NULL REFERENCES projects(id),
    user_id       BIGINT NOT NULL REFERENCES users(id),
    poste_id      TEXT NOT NULL,
    taken_at      TIMESTAMPTZ NOT NULL,
    heartbeat_at  TIMESTAMPTZ NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    -- NULL tant que le portage est actif (c'est le marqueur d'ouverture).
    returned_at   TIMESTAMPTZ NULL,
    returned_by   TEXT NULL CHECK (returned_by IN ('self', 'expiration', 'admin')),
    return_reason TEXT NULL,
    -- NULL tant que la restitution n'a pas eu lieu (restitution volontaire).
    sync_at       TIMESTAMPTZ NULL,
    -- Libération forcée : le motif est obligatoire et non vide (traçabilité).
    CONSTRAINT project_handovers_admin_reason_check
        CHECK (returned_by <> 'admin' OR (return_reason IS NOT NULL AND btrim(return_reason) <> ''))
);

-- Un seul porteur actif par projet : c'est la BASE qui garantit l'exclusivité,
-- pas seulement le code. Index partiel : les lignes clôturées ne comptent pas,
-- ce qui rend la reprise après expiration compatible avec la contrainte (la
-- transaction clôture la ligne expirée avant d'insérer la nouvelle).
CREATE UNIQUE INDEX IF NOT EXISTS project_handovers_active_key
    ON project_handovers (project_id)
    WHERE returned_at IS NULL;
