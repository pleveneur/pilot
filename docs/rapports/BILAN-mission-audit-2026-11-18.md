# Bilan de mission — audit et corrections Pilot (2026-11-16/18)

État : branche `review/claude-audit-2026-11-16`, HEAD `6d57ddd119fbb173bf962eb2f7400e7e6ea6ca87`, **aucun commit/push/PR**. 32 fichiers suivis modifiés, 50 non suivis, préservés.

## Corrigé et testé

- Lot 13bis : `ServerCtx` régénère réellement `authorized_keys` après changement de statut ; test de production (vrai routeur, PostgreSQL jetable, marqueur). Baseline préexistante prouvée avec target Cargo dédié.
- Lot 14 : deux fixtures `bare_created` corrigées ; suite gds-server 35/0.
- Lot 15 : hygiène `PILOT_GIT_USER_HOME` (GitHomeSandbox), fixture de purge réelle, documentation « lecture seule » corrigée et handbook régénéré.
- Lot 16 : **défaut réel de purge** découvert par la fixture corrigée — la route supprimait un autre chemin ; `remove_bare_in_root` + test unitaire ; gds-server 35/0, gds-core 142/0, workspace 1164/0, JS 6047/0.

## Reporté (décision utilisateur)

- XSS-01 prévisualisation Markdown : reportée, aucune neutralisation HTML ajoutée.
- Règles métier SSH (COMP-02/03) : non tranchées, collègue indisponible ; risques listés dans le registre.

## À décider

- Voir `REGISTRE-reliquats-2026-11-18.md` : constats encore ouverts (sécurité distante, RPC, Telegram, MCP, GDS, CI DB). Le classement « à décider » ne signifie pas qu'un arbitrage produit soit nécessaire pour chacun : les défauts techniques non traités restent à analyser avant correction.

## Non exercé / limites

- Vrai sshd/compte git, permissions 700/600 et propriétaire ; sessions SSH ouvertes ; Windows/macOS ; GUI ; Bash de l'Assistant (AST-01) ; `users/validate`.

## Preuves

- `REGISTRE-reliquats-2026-11-18.md`, rapports lots 1-16 dans `docs/rapports/`, journaux et résumés dans `/home/drass/.hermes/jobs/pilot-review-20261116/`.
