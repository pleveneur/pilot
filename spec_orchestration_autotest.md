# Auto-test post-modification (E2) — Spécifications

> **Statut : ✅ Implémenté (2026-07-29)** — évolution du Mode Orchestration V2/V3.
> Spécification fonctionnelle et technique. Voir aussi
> [`spec_orchestration.md`](./spec_orchestration.md) (notamment §11.3
> « Linting-in-the-loop ») et
> [`spec_orchestration_observability.md`](./spec_orchestration_observability.md).

---

## 1. Objectif

Aujourd'hui, après chaque tâche du codeur, le Mode Orchestration ne valide que
la **syntaxe** (`check_syntax` : `eslint` / `py_compile` / `cargo check`). Un
code qui compile mais qui casse un test existant, ou qui produit un résultat
faux, passe la gate sans souci et n'est rattrapé qu'en escalade (tardive et
coûteuse).

**E2** remplace/étend cette vérification par une **vraie exécution des tests du
projet** après chaque tâche, puis injecte le résultat dans la boucle de
correction locale (SELF_FIX in-session) et dans les métriques observées par la
révision mid-plan et l'escalade.

C'est la boucle TDD : l'agent écrit → exécute → voit l'échec → corrige, sans
intervention humaine.

---

## 2. Décisions validées

| # | Question | Décision |
|---|----------|----------|
| 1 | Portée des tests | **Hybride** : tests **ciblés** après chaque tâche (fichiers modifiés), tests **complets** en vérification finale (§4.6b de `spec_orchestration.md`, déjà existant via `buildFinalReviewPrompt`). |
| 2 | Comportement par défaut | **Opt-in** : case à cocher « Lancer les tests après chaque tâche » dans les Paramètres (Mode Orchestration). Désactivé par défaut — un `cargo test` sur un gros projet peut mettre plusieurs minutes par tâche et casser l'expérience par défaut. On étudiera un bascule en défaut ON une fois le mode ciblé fiable. |
| 3 | Fallback si aucun runner détecté | **Retomber sur `check_syntax` actuel** (linting-in-the-loop §11.3) — sans régression. Le linting reste le filet de sécurité minimal. |
| 4 | Si runner détecté mais tests en échec avant toute modif | Ne pas bloquer : mémoriser l'état de base (baseline) au démarrage de l'orchestration. On ne corrige que les **régressions** introduites par la tâche, pas l'héritage. |
| 5 | Timeout | Timeout dédié `orchestration_test_timeout_ms` (défaut 60 000 ms), distinct du timeout d'inactivité du codeur. Au-delà → traité comme échec (renvoyer au codeur « tests trop longs / timeout »). |
| 6 | Override manuel | Champ optionnel `orchestration_test_command` : si renseigné, **surchasse** la détection automatique (ex: `npm run test:unit`, `pytest -x --timeout=30`). |

---

## 3. Détection du test runner

Fonction **pure** côté frontend (`orchestration.js`), à partir de l'arborescence
projet (déjà filtrée et mémoïsée par plan, voir `getCachedProjectTree`) et des
fichiers manifestes lus via `read_file_content`.

| Détection | Runner | Commande par défaut | Scope ciblé |
|---|---|---|---|
| `package.json` avec script `test` non vide | npm | `npm test` (override possible) | `npm test -- <testFiles>` si heuristique applicable, sinon `npm test` complet |
| `Cargo.toml` présent | cargo | `cargo test` | `cargo test --lib <module>` (heuristique : nom du module dérivé du chemin fichier) ; fallback `cargo test` |
| `pytest.ini` / `pyproject.toml` (`[tool.pytest]`) / `conftest.py` / `requirements*.txt` contenant `pytest` | pytest | `pytest` | `pytest <testFiles>` (chemins absolus projet) |
| `go.mod` présent | go | `go test ./...` | `go test <packages>` |
| `pom.xml` / `build.gradle` | (jvm) | détecté mais **non supporté en V1** → fallback `check_syntax` | — |
| Aucun manifeste reconnu | — | **Fallback `check_syntax`** (comportement actuel inchangé) | — |

**Override manuel** : si `orchestration_test_command` est renseigné dans la
config, il est utilisé **tel quel** (scope complet uniquement — pas de ciblage
automatique possible sur une commande arbitraire).

**Fonction pure** :

```javascript
// orchestration.js
export function detectTestRunner(projectTree, manifestContents) {
  // retourne { runner: 'npm'|'cargo'|'pytest'|'go'|null,
  //            command: string,           // commande par défaut (scope complet)
  //            canTarget: boolean,        // scope ciblé supporté ?
  //            targetArgs: (files) => string[] }  // ou null si non supporté
}
```

---

## 4. Heuristique de ciblage (scope ciblé)

Après une tâche, on connaît les **fichiers modifiés** (`changedFiles` issu de
`applySearchReplaceBlocks`, déjà disponible dans `handleOrchestrationAgentEnd`).
On dérive les fichiers de test à lancer :

| Runner | Heuristique |
|---|---|
| pytest | Pour chaque `src/foo/bar.py` modifié → `tests/foo/test_bar.py` ou `test_bar.py` si présent. Fallback : `pytest tests/` si aucun test direct trouvé. |
| cargo | `cargo test --lib` (tests unitaires dans le crate) — le ciblage par module est fragile en Rust, on reste sur `--lib` qui est rapide. |
| npm | Heuristique fragile (varie selon framework : jest, vitest, mocha) → **pas de ciblage en V1**, on lance `npm test` complet (ou l'override). |
| go | `go test ./...` (le compilo est rapide, le ciblage par package est complexe) → pas de ciblage en V1. |

**Règle** : si l'heuristique ne trouve **aucun** fichier de test évident, on
retombe sur la commande **complète** (scope complet). Mieux vaut lancer trop que
rien.

---

## 5. Workflow (intégration dans `handleOrchestrationAgentEnd`)

```
Codeur répond DONE (+ blocs SEARCH/REPLACE/CREATE appliqués)
  │
  ▼
1. changedFiles = applySearchReplaceBlocks(...)        [existant]
  │
  ▼
2. Si auto-test activé ET runner détecté :
     args = runner.canTarget ? runner.targetArgs(changedFiles) : []
     result = invoke('run_project_tests', { command, args, cwd, timeout_ms })
     ┌─ exit 0 + output ───────────────────▶ valider la tâche (comme aujourd'hui)
     ├─ exit ≠ 0 + output ─────────────────▶ boucle de correction (étape 3)
     └─ timeout ────────────────────────────▶ boucle de correction (message « timeout »)
   Sinon (désactivé ou pas de runner) :
     ▼  retomber sur check_syntax actuel (comportement V2 inchangé)
  │
  ▼
3. Boucle de correction (SELF_FIX) :
     - incrémente testCorrections (max `orchestration_test_max_corrections`, défaut 3)
     - renvoie au codeur : NEED_HELP: Tests en échec\n<output tronqué>
       (prompt construit par buildTestFailurePrompt dans orchestration.js)
     - relance le codeur (même tâche, même session re-clearée)
     - si corrections épuisées → subdivision puis escalade (workflow existant)
```

**Compatibilité SELF_FIX existant** : le Mode Orchestration V3 a déjà un
mécanisme SELF_FIX in-session (3 tentatives). E2 s'insère **avant** l'escalade :
la gate de test est une cause supplémentaire de SELF_FIX, au même titre que le
linting. On unifie le compteur de corrections pour ne pas doubler les retries :
`testCorrections` et `lintCorrections` partagent un budget commun
`max_corrections` (défaut 3) — qu'il s'agisse d'une erreur de syntaxe ou d'un
test en échec, c'est la même boucle.

---

## 6. Baseline (tests en échec avant toute modif)

**Problème** : si le projet a déjà des tests rouges au démarrage de
l'orchestration, E2 les signalerait à chaque tâche et bloquerait le plan.

**Solution** : au démarrage du Mode Orchestration (quand auto-test est activé
et un runner détecté), lancer une fois la commande complète et mémoriser :
- `baselineFailures` : ensemble des noms de tests en échec (parsés depuis
  l'output, heuristique par runner — voir §7).
- `baselineExit` : code de sortie de référence.

Après une tâche, la gate de test compare :
- **Nouveaux échecs** (tests en échec qui ne l'étaient pas dans la baseline) →
  régression introduite par la tâche → boucle de correction.
- **Échecs hérités** (présents dans la baseline) → **ignorés**, ne bloquent pas.
- **Échecs disparus** (présents dans la baseline, maintenant au vert) → bonus,
  n'affecte pas la gate (mais métrique enregistrée).

Si la baseline ne peut pas être calculée (commande explose / timeout au
démarrage), on désactive silencieusement E2 pour ce plan + warning dans le chat
(« tests du projet injoignables, auto-test désactivé pour ce plan »).

---

## 7. Parsing des résultats

Le parsing des tests sert à :
1. Comparer à la baseline (§6).
2. Construire un message de correction **utile** au codeur (nom du test +
   assertion + traceback, pas 5000 lignes de stdout brut).

| Runner | Heuristique de parsing |
|---|---|
| pytest | Lignes `FAILED tests/foo/test_bar.py::test_name - AssertionError: ...` |
| cargo | Blocs `test foo::bar::test_name ... FAILED` + `panicked at ...` |
| npm (jest/vitest) | `FAIL tests/foo.test.js` + bloc `● test_name › sous-cas` |
| go | `--- FAIL: TestFoo (0.00s)` + bloc d'erreur |

**Troncature** : l'output renvoyé au codeur est tronqué à ~4 000 caractères
(les premiers échecs sont les plus pertinents ; on garde un suffixe « … (N échecs,
output tronqué) »). Les logs complets sont conservés dans le journal
d'observabilité (§9).

Fonction pure :

```javascript
// orchestration.js
export function parseTestFailures(runner, stdout, stderr) {
  // retourne { failures: [{ name, file, message }], exitInherited: boolean }
}
export function buildTestFailurePrompt(failures, baselineFailures) {
  // retourne le texte NEED_HELP: ... injecté au codeur
}
```

---

## 8. Configuration (`AppConfig`)

Nouveaux champs (tous opt-in, défauts non disruptifs) :

```rust
#[serde(default)]
orchestration_test_enabled: bool,           // défaut false (opt-in)
#[serde(default = "default_test_timeout_ms")]
orchestration_test_timeout_ms: u32,         // défaut 60 000
#[serde(default = "default_test_max_corrections")]
orchestration_test_max_corrections: u32,    // défaut 3 (budget commun lint+test)
#[serde(default)]
orchestration_test_command: String,         // override manuel, "" = auto-détection
#[serde(default = "default_test_scope")]
orchestration_test_scope: String,           // "targeted" (défaut) | "full"
```

`orchestration_test_scope = "full"` désactive le ciblage et lance toujours la
commande complète (utile pour les petits projets ou les commandes override).

UI : section « Auto-test » dans le panneau Mode Orchestration des Paramètres
(case à cocher + 3 champs : timeout, max corrections, commande override +
sélecteur scope).

---

## 9. Observabilité (extension de `spec_orchestration_observability.md`)

Le journal des tentatives par tâche (déjà existant via `logTaskAttempt`) est
étendu avec :

```json
{
  "task_id": 2,
  "attempt": 1,
  "marker": "DONE",
  "reason": "tests_failed",
  "duration_ms": 18340,
  "files_changed": ["src/app.py"],
  "test_result": {
    "runner": "pytest",
    "exit": 1,
    "new_failures": ["tests/test_app.py::test_get_tasks"],
    "inherited_failures": [],
    "fixed_failures": [],
    "output_excerpt": "FAILED tests/test_app.py::test_get_tasks - AssertionError: ..."
  }
}
```

La synthèse agrégée (`summarizeTaskAttempts`) ajoute une ligne « 🧪 tests » :
nb de tâches ayant déclenché une boucle de correction sur tests, nb de
régressions détectées, nb de tests réparés. Cette synthèse est injectée dans la
révision mid-plan (point N) et l'escalade — l'orchestrateur sait que le codeur
casse des tests, et peut décider de découper plus fin ou de changer d'approche.

---

## 10. Commande Tauri (`run_project_tests`)

```rust
#[tauri::command]
async fn run_project_tests(
    window: &Window,
    command: String,        // commande pré-construite côté JS (détection ou override)
    args: Vec<String>,      // args ciblés (peut être vide = scope complet)
    cwd: String,            // = project_path (résolu côté JS)
    timeout_ms: u32,
) -> Result<TestRunResult, String> {
    // exécute avec tokio::process::Command + timeout
    // capture stdout + stderr (limités à ~256 Ko chacun pour éviter OOM)
    // retourne { exit_code: Option<i32>, stdout: String, stderr: String, timed_out: bool, duration_ms: u32 }
}
```

**Sécurité** : la commande n'est pas un shell libre — on exécute `command` +
`args` via `Command::new(command).args(args)` (pas de `shell=true`), donc pas
d'injection shell. Le `cwd` est forcé au projet ouvert. Le timeout est
impératif (tokio `tokio::time::timeout`).

Réutilise le pattern de `run_captured` (déjà présent pour `git status` / C1).

---

## 11. Fichiers impactés

| Fichier | Changement |
|---|---|
| `src-tauri/src/lib.rs` | 5 champs `AppConfig` + commande `run_project_tests` (+ setters pour la config) |
| `src/js/orchestration.js` | Fonctions pures : `detectTestRunner`, `parseTestFailures`, `buildTestFailurePrompt`, `deriveTestScope` |
| `src/js/agent-pi.js` | Branchement dans `handleOrchestrationAgentEnd` (gate de test après `applySearchReplaceBlocks`), boucle de correction unifiée (lint+test), baseline au démarrage de l'orchestration, injection dans `task_metrics` |
| `src/js/settings.js` + `index.html` | Section « Auto-test » dans le panneau Mode Orchestration |
| `src/css/style.css` | Style du bloc de résultat de tests dans le panneau d'observabilité |
| `spec_orchestration.md` | Référence croisée vers cette spec (§11.6) |
| `spec_orchestration_observability.md` | Extension du journal (§9 ci-dessus) |
| `AGENTS.md` | Ligne dans la table de navigation |
| `plan_dev.md` | Mise à jour de l'état |

**Aucune modification de `rpc_manager.rs`** — E2 est purement frontend +
commande Tauri, comme le reste de l'orchestration.

---

## 12. Plan d'implémentation

| Phase | Tâche | Fichiers |
|---|---|---|
| 1 | Commande `run_project_tests` (Rust) + tests unitaires sur le parsing | `lib.rs` |
| 2 | Fonctions pures `detectTestRunner` / `parseTestFailures` / `buildTestFailurePrompt` + tests | `orchestration.js` |
| 3 | Baseline au démarrage de l'orchestration + branche gate dans `handleOrchestrationAgentEnd` + boucle de correction unifiée | `agent-pi.js` |
| 4 | Extension du journal d'observabilité (`test_result` dans `logTaskAttempt` + synthèse) | `agent-pi.js`, `orchestration.js` |
| 5 | UI Paramètres (section Auto-test) + persistance config | `settings.js`, `index.html`, `style.css` |
| 6 | Mise à jour docs (`spec_orchestration.md` §11.6, `spec_orchestration_observability.md`, `AGENTS.md`, `plan_dev.md`) | specs |

---

## 13. Rétrocompatibilité

- **Auto-test désactivé** (défaut) : comportement **strictement identique** à
  aujourd'hui (linting-in-the-loop §11.3). Aucune régression.
- **Auto-test activé mais pas de runner détecté** : retombe sur `check_syntax`.
- **Runner détecté mais baseline injoignable** : E2 désactivé silencieusement
  pour ce plan + warning, le plan continue avec `check_syntax`.
- **`orchestration_test_command` vide** : auto-détection. Renseigné : override
  (scope complet uniquement).
- Le budget de corrections est **unifié** (lint + test partagent
  `orchestration_test_max_corrections`) — pas de double retry.

---

## 14. Limites connues (V1)

- **Ciblage fragile** : l'heuristique de mapping « fichier source → fichier de
  test » échoue sur les conventions non standard. Fallback scope complet.
- **Parsing runner-spécifique** : un framework de test exotique (ex: `nox`,
  `tox`, `bun test`) ne sera pas reconnu. Override manuel via
  `orchestration_test_command` couvre ces cas.
- **JVM non supporté** : Maven/Gradle détectés mais pas supportés en V1
  (lancement trop lent, output verbeux). Fallback `check_syntax`.
- **Tests avec side-effects** : un test qui écrit sur disque ou lance un serveur
  peut casser les exécutions suivantes. Hors-scope V1 — l'utilisateur peut
  désactiver E2 sur ces projets.

---

*Dernière mise à jour : 2026-07-29*