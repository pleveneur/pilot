# Vérification du lot 13bis — baseline vérifiée (2026-11-18, correctif)

La première annexe était **fausse** : le run dit « baseline » utilisait le cache/target Cargo
partagé et le binaire du code courant. Preuve corrigée ci-dessous, avec extraction du checkpoint
vérifiée par hash et **target Cargo dédié**.

- HEAD : `6d57ddd119fbb173bf962eb2f7400e7e6ea6ca87`, branche `review/claude-audit-2026-11-16`, aucun commit.
- Extraction : `/home/drass/.hermes/jobs/pilot-review-20261116/baseline-verified-lot13bis` depuis `checkpoint-lot13bis-20261118/sources.tar`.
- `gds-server/src/main.rs` baseline sha256 `e51a75438b98ad8ef4961c3f259dc162e778ad594ba9e909dfaecdc851cc61e8` — test `comp01_server_ctx…` absent : `True`.
- `gds-server/src/main.rs` courant sha256 `090b51bdc7d37cdfe6c78b5e1ad4264b446f03827137b5b50000cec3f18581e8` — test présent : `True`.
- Target Cargo baseline dédié : `/home/drass/.hermes/jobs/pilot-review-20261116/rust-target-baseline-lot13bis` (cache de dépendances partagé `/home/drass/.hermes/jobs/pilot-review-20261116/rust-cargo-cache`, aucun artifact courant réutilisé).
- Run `20261118-111248-442012` : `34` tests annoncés, totaux `{"passed": 32, "failed": 2, "ignored": 0, "measured": 0, "filtered_out": 0}`, marqueurs `[]`.
- Échecs baseline : `['tests::admin_screen_projects_purge_audit_and_ssh_revoke_end_to_end', 'tests::any_account_reads_and_any_dev_publishes_on_real_db']` aux lignes `['1879', '2927']` (courant : lignes 2106/3154).
- Cleanup `True`, skip marker `None`, URL `{"PILOT_GDS_TEST_URL": "postgresql://postgres@localhost/pilot_gds_test_seed?host=/tmp/pilot-gds-postgres", "PILOT_GDS_HTTP_TEST_URL": "postgresql://postgres@localhost/pilot_gds_test_seed?host=/tmp/pilot-gds-postgres", "PILOT_GDS_TEST_REQUIRED": "1"}`.
- Échecs identiques avant/après : **True** ; le diff ne touche ni `git.rs`, ni `gds_project_create`, ni ces tests.
- Journal exact : `/home/drass/.hermes/jobs/pilot-review-20261116/validation-logs/20261118-111248-442012-cargo-tests.log`.

Conclusion : les 2 échecs `bare_created` sont **préexistants** au lot 13bis (fixtures `repo_bare_path`
vs `bare_path_in_root`). Aucun échec nouveau introduit par le lot.
