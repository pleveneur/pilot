-- GDS — refonte L6 : suppression du verrou projet.
--
-- Le verrou global projet (Phase B) est retiré : il est remplacé par
-- l'appartenance au projet (project_members) et la règle « dernier qui écrit
-- gagne » avec journalisation d'audit des conflits (spec cible §8.2). La table
-- n'est plus référencée par le code.
--
-- NE PAS renommer ni renuméroter 0002_project_locks.sql : les noms de fichiers
-- déterminent les versions appliquées par sqlx, et une renumérotation casserait
-- les bases existantes. La table est simplement supprimée ici.

DROP TABLE IF EXISTS project_locks;
