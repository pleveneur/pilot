-- GDS refonte L3.1 — rôles et statuts des utilisateurs (contraintes CHECK)
--
-- `0001_init.sql:12-13` ne posait que des valeurs par défaut, SANS contrainte :
-- n'importe quelle valeur de `role` / `status` pouvait être insérée. Ce fichier
-- pose les contraintes de vocabulaire du lot L3.
--
-- Vocabulaire contraint :
--   role   ∈ 'admin' | 'dev' | 'standard'
--   status ∈ 'pending' | 'active' | 'disabled'
--
-- Compatibilité (aucune reprise de données) : les valeurs par défaut de
-- `0001_init.sql` restent `'dev'` / `'pending'` (inchangées) et le socle n'écrit
-- que 'admin' / 'dev' et 'pending' / 'active' ⇒ toutes les lignes existantes
-- satisfont déjà les contraintes, qui sont donc validées à l'ajout.
--
-- NE PAS toucher aux migrations 0001…0005 ni 0007 (migration incrémentale).
-- NE PAS transformer ce fichier en reprise de données (décision du lot L3).

ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'dev', 'standard'));

ALTER TABLE users
    ADD CONSTRAINT users_status_check
    CHECK (status IN ('pending', 'active', 'disabled'));

COMMENT ON COLUMN users.role
    IS 'admin | dev | standard (contrainte users_role_check, L3.1)';
COMMENT ON COLUMN users.status
    IS 'pending | active | disabled (contrainte users_status_check, L3.1)';
