# Registre exhaustif des constats — audit Pilot 2026-11-16/18

Branche `review/claude-audit-2026-11-16`, HEAD `6d57ddd119fbb173bf962eb2f7400e7e6ea6ca87` (inchangé), 32 suivis modifiés, 50 non suivis. Aucun commit, stage, push, PR ni déploiement.

Source : les 2 rapports initiaux (`RAPPORT-revue-claude-2026-11-16.md`, `RAPPORT-revue-complementaire-claude-2026-11-16.md`) et les rapports des lots 1-16. Les verdicts historiques sont conservés ; la colonne « état courant » est vérifiée sur le code/tests actuels.

## Constats initiaux et suites

| ID | Constat | Lots | État courant (vérifié) | Preuve | Décision future PR |
|---|---|---|---|---|---|
| AST-01 | Lecture seule Assistant non garantie techniquement | lot5 | partiel : outils fichier filtrés ; Bash non gardé, liens durs et compat '..' non couverts ; pi non exercé | R5 | décision : limite assumée, doc corrigée (DOC-01) |
| COMP-01 | Compte désactivé garde l'accès SSH | lots12,13bis | corrigé et testé (marqueur COMP01_SERVER_CTX_EXECUTED) ; validate reste non couvert | R12,R13b | reliquat : régénérer aussi sur users/validate |
| COMP-02 | SSH ne vérifie ni rôle, ni dépôt, ni portage | lot12 (analyse) | ouvert, décision métier Patrick | — | à décider, aucune règle inventée |
| COMP-03 | Prise en main ouverte à tout rôle, renouvelable | lot12 (analyse) | ouvert, décision métier | — | à décider |
| COMP-04 | Inscription : email non validé, mot de passe vide | — | non traité | — | à décider |
| COMP-05 | Ajout de projet avec identité inconnue | — | non traité | — | à décider |
| COMP-06 | XSS tableau de bord (noms de fichiers) | lot1 | corrigé, testé | R1 | — |
| COMP-07 | html:true historique/revue/notes | lot1 | corrigé, testé | R1 | — |
| COMP-08 | Plafonds tours/boucles/inactivité au démontage UI | — | non traité | — | à décider |
| COMP-09 | Confirmation MCP non appliquée techniquement | — | non traité | — | à décider |
| COMP-10 | Telegram : filtre par discussion, pas par personne | — | non traité | — | à décider |
| COMP-11 | Telegram : messages modifiés rejoués | — | non traité | — | à décider |
| COMP-12 | Tests DB sautent en silence | helpers mission | partiel : helpers exigent PILOT_GDS_TEST_REQUIRED en mission ; CI inchangée | — | à décider (CI) |
| COMP-13 | mcp.json écrit sans atomicité | lot2 | corrigé, testé | R2 | — |
| COMP-14 | Commentaire persona promet un intercepteur absent | — | non traité (documentation) | — | à décider |
| GDS-01 | Admin premier arrivé | — | ouvert (dépend déploiement) | — | à décider |
| GDS-02 | Rôle du jeton conservé si base injoignable | — | ouvert | — | à décider |
| LNK-01 | Liens de prévisualisation ouvrent tout schéma | — | non traité | — | à décider |
| ORC-01 | Agents readonly restreints par texte de mission | — | non traité | — | à décider |
| RPC-01 | UTF-8 coupé entre lectures | lot3 | corrigé, testé | R3 | — |
| RPC-02 | Délai PDF→Markdown jamais appliqué | lot3 | corrigé, testé | R3 | — |
| RPC-03 | ID RPC 32 bits, collision | — | non traité | — | à décider |
| RPC-04 | Entrée pending non retirée après délai | — | non traité | — | à décider |
| RPC-05 | Tampon de ligne non borné, quadratique | — | non traité | — | à décider |
| SQL-01 | super_agent_db_query filtre par préfixe SELECT | — | non traité | — | à décider |
| VLT-01 | Coffre réécrit sans atomicité | lot2 | corrigé, testé ; sauvegarde .bak reportée ; autres écritures hors lot | R2 | reliquat rétention |
| WEB-01 | Lecture seule distante laisse passer des mutations | lot4 | corrigé, testé (garde unique) | R4 | — |
| WEB-02 | validate_within résolu depuis le cwd | — | non traité | — | à décider |
| WEB-03 | Édition distante sans détection de conflit | — | non traité | — | à décider |
| WEB-04 | Jeton WS dans l'URL, CSP/anti-iframe absents | — | non traité | — | à décider |
| XSS-01 | Prévisualisation Markdown pilote les commandes | lots1,10,11 (tests) | REPORTÉ par décision Drass ; ni DOMPurify ni désactivation HTML | decision-preview-deferred.json | ne pas corriger sans décision |
| PURGE-01 | Purge projet supprimait un autre chemin | lot16 | corrigé, testé (remove_bare_in_root) | R16 | — |
| HYG-01 | Tests L45/L2 ne restauraient pas PILOT_GIT_USER_HOME | lot15 | corrigé (GitHomeSandbox) | R15/R16 | — |
| HYG-02 | Fixture projet-l45-b masquait la purge | lot15 | corrigé : assertion de purge réelle | R15/R16 | — |
| DOC-01 | spec/handbook promettaient une lecture seule stricte | lot15 | corrigé : texte factuel, handbook régénéré | R15 | — |

## Constats nouveaux découverts pendant les corrections

| ID | Constat | Lot | État | Preuve |
|---|---|---|---|---|
| PURGE-01 | La purge de projet supprimait `<racine>/repos/<nom>.git` alors que la création écrit `<racine>/<nom>.git` : `purged:true` sans suppression | lot16 | corrigé (`remove_bare_in_root`), gds-server 35/0 | `20261118-113855-516203` |
| HYG-01 | `PILOT_GIT_USER_HOME` fuyait après deux tests | lot15 | corrigé (`GitHomeSandbox`) | `20261118-113855-516203` |
| HYG-02 | Fixture `projet-l45-b` créait un dépôt hors du chemin de la route, rendant l'assertion de purge vide | lot15 | corrigé | `20261118-113855-516203` |
| DOC-01 | « Lecture seule stricte / garantie technique » alors que Bash n'est pas gardé | lot15 | corrigé (spec + handbook) | build JS 6047/0 |

## Corrigé et testé (état courant)

- COMP-01 (lots12+13bis), COMP-06/07 (lot1), COMP-13/VLT-01 (lot2), RPC-01/02 (lot3), WEB-01 (lot4), PURGE-01 (lot16), HYG-01/02 et DOC-01 (lot15).
- Tests finaux : gds-server PostgreSQL **35/0** (`20261118-113855-516203`, marqueur `COMP01_SERVER_CTX_EXECUTED`, cleanup OK), gds-core **142/0**, workspace **1164/0**, JS/build **6047 réussis + 1 en attente**.
- Verdicts : relectures lot1-12 passées (lot5 via `review_lot5_final-result.json`), lot13 refusé puis **lot13bis validé**, **lot14 validé**, **lot16 validé**. Lot15 : changements appliqués mais run rouge ayant révélé PURGE-01 ; validé via lot16, pas de verdict propre favorable.

## Reporté par décision utilisateur

- **XSS-01** : prévisualisation Markdown reportée ; ni DOMPurify ni désactivation HTML (`decision-preview-deferred.json`).
- **Collègue indisponible** (`decision-colleague-deferred.json`) : aucune règle métier inventée ; COMP-02/COMP-03 restent à trancher.

## À décider (aucune politique inventée)

- COMP-02 (droits SSH par rôle/dépôt/portage), COMP-03 (prise en main), COMP-04, COMP-05, COMP-08, COMP-09, COMP-10, COMP-11, COMP-12 (CI DB), COMP-14, GDS-01, GDS-02, LNK-01, ORC-01, RPC-03/04/05, SQL-01, WEB-02/03/04.
- COMP-01 reliquat : `POST /api/gds/users/validate` ne régénère toujours pas `authorized_keys` ; sessions SSH déjà ouvertes non coupées (comportement voulu, non testé).

## Non lu / non exercé

- Vrai sshd et vrai compte `git` (droits 700/600, propriétaire, refus réel d'une clé retirée).
- Windows, macOS, GUI Tauri, conteneur de production réel.
- Bash de l'Assistant (limite AST-01), prévisualisation Markdown, Telegram, MCP, agents readonly non exercés dans cette mission.
- L'arbre contient des modifications non commitées des lots 1-16 ; aucune revue globale de ces lots n'est refaite ici.

## Preuves principales

- `/home/drass/.hermes/jobs/pilot-review-20261116/lot16-20261118-green.json` (gds-server 35/0, gds-core, workspace).
- `/home/drass/.hermes/jobs/pilot-review-20261116/lot13bis-20261118-baseline-verified.json` (baseline hashée, target dédié, 32/2 préexistants).
- `/home/drass/.hermes/jobs/pilot-review-20261116/validation-logs/` : runs `20261118-111942-162333` (35/0), `20261118-113855-516203` (35/0 après purge), `20261118-105304-024202` ROUGE, `20261118-105319-569546` VERT, `20261118-111248-442012` baseline.
- Rapports : `RAPPORT-corrections/relecture-lot13bis`, `lot14`, `lot15`, `lot16`, `RAPPORT-verification-lot13bis`, `RAPPORT-baseline-lot13bis` (dans `docs/rapports/`).
