# Rapport — verrous de livraison, lot B

Date : 2026-11-16
Périmètre : publication (`release.yml`, scripts de version) et verdict des tests.
Référence de l'audit : `docs/rapports/RAPPORT-voies-de-contournement-livraison.md` (fiches C1–C10).
Lot A (déjà livré) : `docs/rapports/RAPPORT-verrous-livraison-lot-a.md` — **non touché**.

## Règle commune aux six verrous

Chaque trou est fermé par **une décision pure à un seul endroit** et par **un test qui
échoue si on retire le verrou**. Les décisions pures vivent dans :

| Module | Décisions qu'il porte |
|---|---|
| `scripts/release-gates.js` (nouveau) | changelog obligatoire, livraison complète, tag déjà publié, chemin du changelog |
| `src/js/test-verdict.js` (nouveau) | vert / rouge / non lancé / non vérifié, causes obligatoires, phrases affichables |

Les deux workflows n'ont **pas** été réécrits : `release.yml` garde exactement sa
topologie (à une dépendance près, celle du trou 1) et le contrôle des propositions
est un fichier séparé.

---

## 1. La Release ne peut plus partir avant un verdict de tests

- **Trou** : `create-release` n'avait aucune dépendance. Sur un tag dont les tests
  échouaient, la Release était créée **publiée** (`draft: false`) pendant que `build`
  restait bloqué : une version annoncée aux utilisateurs installés alors que la suite
  était rouge.
- **Verrou** : `create-release` déclare `needs: [test]`. Rien d'autre n'a bougé :
  `build` attend toujours `[create-release, test]`, `latest-json` ne dépend toujours
  que de `build`, Linux reste hors du chemin critique.
- **Test** : `scripts/release-workflow.test.js`, bloc
  « release.yml — aucun publication sans verdict de tests » (trois cas : dépendance
  présente, ordre inchangé, chaîne complète `test → create-release → build → latest-json`).
- **Preuve par mutation** : retirer `needs: [test]` → les deux cas de dépendance
  deviennent rouges ; remise → vert.

## 2. Le changelog est obligatoire

- **Trou** : le script retombait sur `` `Pilot ${VERSION}` `` et la Release pouvait
  partir avec une note d'une ligne, voire sans contenu lisible.
- **Verrou** : `evaluateReleaseNotes()` décide, et **deux** scripts l'appellent :
  `create-release.js` (porte 0, **avant** que la Release existe et avant les trois
  fabrications) et `gen-latest-json.js` (le fichier a pu disparaître entre-temps).
  Un fichier réduit à un titre Markdown n'est pas un changelog (`hasReadableNotes`).
  Le chemin `release-notes/<version>.md` n'existe qu'une fois (`notesPathForTag`).
- **Test** : `scripts/release-gates.test.js` — « changelog obligatoire » (titre seul,
  contenu réel, refus nommant le fichier, acceptation tracée) et, dans le bloc de
  câblage, « create-release.js refuse AVANT que la Release existe » + « le chemin du
  changelog n'est écrit qu'à un seul endroit ».
- **Preuve par mutation** : (a) remettre `` || `Pilot ${VERSION}` `` dans
  `gen-latest-json.js` → rouge ; (b) neutraliser la porte 0 dans `create-release.js`
  → rouge. Remises → vert.
- **Sortie de secours** : `ALLOW_MISSING_RELEASE_NOTES=1`, tracée en `::warning::`.

## 3. Republier un tag existant : refus net et visible

- **Trou** : le script faisait `console.log("✓ Release … existe déjà, rien à créer")`
  et sortait en succès — y compris sur la course `POST → 422 already_exists`. Un tag
  republié réécrivait donc les assets du même numéro, en silence.
- **Verrou** : `evaluateExistingRelease()` pour les **trois** chemins (GET 200,
  POST 422, GET 404) via un point unique `applyExistingRelease()` ; refus = code de
  sortie `2` (distinct d'une panne, `1`) + `::error::` dans le résumé du run.
- **Test** : `scripts/release-gates.test.js` — « tag deja publie » (les quatre cas de
  décision, code de sortie distinct, lecture tolérante du drapeau) et « create-release.js
  passe par la porte, et ne dit plus « rien a creer » » (les trois appels présents).
- **Preuve par mutation** : remettre le log silencieux sur le chemin POST 422 → rouge.
- **Conséquence opérationnelle, assumée** : un re-run du workflow pour **le même** tag
  (reprise après un échec de fabrication) est désormais refusé ; la reprise passe par
  `ALLOW_EXISTING_RELEASE=1`. Le refus nomme la variable dans sa phrase.

## 4. Une livraison incomplète est un échec explicite

- **Trou** : un artefact manquant sur une plateforme n'était qu'un `::warning::` ; le
  `latest.json` était écrit et publié en l'état, donc les utilisateurs de la
  plateforme concernée ne recevaient plus jamais de mise à jour, sans rien de rouge.
- **Choix retenu (le plus simple)** : **échouer**, pas « publier partiellement ».
  Un demi-`latest.json` est plus dangereux qu'un run rouge : il ne se rattrape pas
  côté utilisateur.
- **Verrou** : `evaluateDelivery()` est consultée **avant** `fs.writeFileSync(OUT)` et
  avant tout upload. Les cibles exigées sont celles du **chemin critique** fabriqué
  par le job `build` (Windows + les deux macOS). Linux n'est **pas** exigée : sa
  fabrication est un job séparé, optionnel, qui ne doit jamais retarder `latest-json`
  (topologie verrouillée par `scripts/release-workflow.test.js`) — l'exiger ferait
  échouer **toutes** les publications. Son absence est dite, pas fatale.
- **Test** : `scripts/release-gates.test.js` — « livraison incomplete » (cible
  présente, une manquante nommée, toutes nommées, Linux hors des cibles exigées,
  acceptation tracée) + ordre « refus **avant** écriture » dans le bloc de câblage.
- **Preuve par mutation** : neutraliser `if (!delivery.ok) refuse(...)` → rouge.
- **Sortie de secours** : `ALLOW_INCOMPLETE_RELEASE=1`, tracée en `::warning::`.

## 5. « Tests non lancés » n'est plus un vert ; le style ne passe plus en douce

- **Trou** : la porte d'auto-test rendait `{ ran: false }` depuis six chemins **sans
  dire pourquoi** ; l'appelant ne distinguait donc pas « rien n'a tourné » de « tout
  est vert ». Le contrôle de style rendait `{ ok: true, hadChecker: false }` quand le
  linter était en panne — un vert qui n'avait rien vérifié.
- **Verrou** (`src/js/test-verdict.js`, branches dans `src/js/agent-pi.js`) :
  - `notRun(cause)` est la **seule** façon d'écrire `ran: false` ; les six retours de
    `runTestGate` nomment chacun une cause distincte (`NOT_RUN_CAUSES`) ;
  - `testVerdict()` n'est vert que si `ran === true` **et** `ok === true` ;
  - `lintVerdict()` : `hadChecker === false` n'est jamais vert, c'est « non vérifié » ;
    les trois retours de `runLintCheck` portent une cause et ne disent plus `ok: true` ;
  - la décision gouverne la correction (`testGateVerdict.state === TEST_VERDICT_RED`) et
    le « non lancé » est **dit** à l'écran (`testVerdictLabel` / `lintVerdictLabel`),
    avec une ligne de journal (`tests_not_run`, `syntax_unverified`).
- **Test** : `src/js/verdict-tests-jamais-silencieux.test.js` — décision pure (deux
  étages) + câblage vérifié sur la source, commentaires retirés.
- **Preuve par mutation** : (a) remettre `return { ran: false };` dans `runTestGate`
  → rouge ; (b) remettre `{ ok: true, hadChecker: false, output }` dans `runLintCheck`
  → rouge. Remises → vert.
- **Ce qui n'a pas changé, volontairement** : une erreur d'exécution ne bloque toujours
  pas la tâche (comportement historique). Seul le **verdict** est désormais honnête.

## 6. Contrôle automatique des propositions de modification et de `main`

- **Trou** : aucun workflow ne tournait sur une proposition de modification ni sur une
  poussée vers `main` (seuls `release.yml` sur tag `v*` et une image GDS manuelle). Une
  suite rouge pouvait vivre sur la branche principale jusqu'au tag.
- **Verrou** : `.github/workflows/quality-gate.yml` — déclenché par `pull_request` et
  par `push` sur `main`, il lance **les deux** suites (`npm test` et
  `cargo test --manifest-path src-tauri/Cargo.toml --lib`), sans aucun
  `continue-on-error`, sans `secrets.`, avec `permissions: contents: read`. Il ne
  fabrique rien, ne signe rien, ne publie rien. Fichier séparé : la topologie de
  `release.yml` reste décrite à un seul endroit.
- **Test** : `scripts/quality-gate-workflow.test.js` — existence, déclencheurs, les deux
  suites, absence de `continue-on-error` et d'étape conditionnée, absence de permission
  d'écriture / secret / release / tag, et non-régression de la topologie de
  `release.yml`.
- **Preuve par mutation** : (a) ajouter `continue-on-error: true` au job → rouge ;
  (b) retirer le déclencheur `pull_request` → rouge.

---

## Vérifications finales

| Contrôle | Résultat |
|---|---|
| `npx vitest run` (suite front complète) | vert, aucun échec |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | vert, aucun échec |
| `.github/workflows/release.yml` analysé (YAML) | valide ; jobs et dépendances : `test` ← ∅, `create-release` ← `[test]`, `build` ← `[create-release, test]`, `build-linux` ← `[create-release, test]`, `latest-json` ← `build`, `latest-json-linux` ← `[latest-json, build-linux]` |
| `.github/workflows/quality-gate.yml` analysé (YAML) | valide ; un job `tests` ; déclencheurs `pull_request`, `push` |
| Ordre des jobs « comme avant » | oui, une seule dépendance ajoutée (`create-release` ← `test`) |
| Publication déclenchée | **aucune** : ni bump, ni tag, ni push, ni build de release |

Fins de ligne : toutes les lectures de source des nouveaux tests normalisent
(`.replace(/\r\n/g, "\n")`) ; constaté sur place que le worktree est bien en CRLF pour
`release.yml` et en LF pour les scripts — les verrous passent dans les deux cas.

## Ce qui n'a pas été fermé (et pourquoi)

1. **macOS reste toléré** (`continue-on-error` sur la matrice `test`). C'est une
   décision de topologie antérieure (une machine macOS indisponible ne doit pas publier
   un Windows absent). Conséquence assumée : un échec macOS **seul** ne bloque pas la
   publication. Le changer demande de revoir la topologie entière, pas un verrou.
2. **Pas de retrait automatique des artefacts déjà attachés.** Si la livraison est
   incomplète, le run devient rouge et `latest.json` n'est pas publié — mais la Release
   créée et les installateurs déjà déposés restent sur la page GitHub. Un « dé-publier
   proprement » (suppression de Release, remise en brouillon) n'a pas été tenté : c'est
   une opération destructive, hors du périmètre demandé.
3. **Le statut n'est pas encore *exigé* par GitHub.** `quality-gate.yml` fait échouer le
   run ; transformer ce rouge en *blocage de fusion* demande une protection de branche
   côté dépôt (réglage GitHub, pas du code). À faire une fois, dans les réglages du
   dépôt, si on veut un refus de fusion automatique.
4. **Le verdict « tests » de `release.yml` reste celui des trois systèmes** ; le
   nouveau contrôle minimal n'utilise qu'`ubuntu-22.04`, conformément à la demande.
5. **Le reviewer d'orchestration** (`runReviewGate`) garde ses `ran: false` : le trou 5
   portait sur les tests et le contrôle de style. Le même traitement pourrait lui être
   appliqué dans un lot suivant.
6. **`web/` (interface distante)** n'a pas de suite dédiée : elle n'est couverte ni
   avant ni après ce lot.

## Fichiers touchés

- Nouveaux : `scripts/release-gates.js`, `scripts/release-gates.test.js`,
  `scripts/quality-gate-workflow.test.js`, `src/js/test-verdict.js`,
  `src/js/verdict-tests-jamais-silencieux.test.js`,
  `.github/workflows/quality-gate.yml`, ce rapport.
- Modifiés : `.github/workflows/release.yml` (une dépendance), `scripts/create-release.js`,
  `scripts/gen-latest-json.js`, `scripts/release-workflow.test.js` (bloc ajouté, rien
  retiré), `src/js/agent-pi.js` (branchements), `AGENTS.md` (arborescence + section
  « Publication des versions »).

Aucun test existant n'a été supprimé ni assoupli ; `scripts/gen-latest-json-platforms.test.js`
et `src/js/source-slice.test.js` restent verts sans modification (le nouveau test de
workflow utilise `sliceFrom`, conformément à l'inventaire des découpages de source).
