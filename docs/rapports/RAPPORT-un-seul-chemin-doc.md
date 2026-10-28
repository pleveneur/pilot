# Un seul chemin pour répondre sur la documentation

Micro-tâche : retirer le **doublon** du mécanisme de réponse aux questions de
mode d'emploi de l'assistant. Décision du propriétaire : **un seul mécanisme**,
l'outil `answer_from_documentation`.

---

## 1. Les deux chemins qui existaient

| # | Chemin | Ce qu'il faisait | Ce qui le portait |
|---|---|---|---|
| 1 | **L'outil** (conservé) | Reçoit la question, répond depuis le **corpus embarqué** (`HANDBOOK`, `include_str!`), **1 appel par tour**, refuse explicitement un 2ᵉ appel, répond « la documentation ne dit rien » quand il ne sait pas | `src-tauri/extensions/pilot-assistant-doc.ts` (outil) → relais `src/js/super-agent.js` (`PILOT_ASSISTANT_DOC::` → `invoke("ask_help_doc")`) → socle Rust `help::answer_from_handbook` |
| 2 | **La copie disque + bloc de prompt** (retiré) | Au démarrage, découpait le handbook par thème et l'écrivait dans `<app_data_dir>/aide/` (1 fichier par thème + `index.md`) ; le prompt système de l'assistant portait le **chemin exact** de ce dossier et les consignes pour que l'assistant **lise lui-même** ces fichiers avec `read` | `src-tauri/src/help.rs` (`write_startup_docs` + tout le découpage) appelé depuis le `setup` de `run()` (`lib.rs`) ; `src-tauri/src/super_agent.rs` (`SUPER_AGENT_DOC_PROMPT`, `doc_guideline`, champ `doc_dir`) |

Deux chemins pour la même question ⇒ ils **divergent** à la première évolution, et
le bloc alourdissait le prompt système à **chaque** message (donc chaque échange
coûtait plus cher).

---

## 2. Vérification préalable exigée : le bloc était-il le SEUL consommateur ?

Le retrait de l'écriture disque n'était autorisé que si son unique consommateur
était le bloc de prompt. Vérifié **avant** de retirer :

```
grep -rn "write_startup_docs\|doc_dir\|DOC_DIR_NAME\|handbook_topics\|doc_files_of\|HELP-TOPIC"
     src src-tauri/src src-tauri/extensions scripts
```

Résultat : **aucun** appelant autre que (a) le `setup` de `run()`, (b) le bloc de
prompt de `super_agent.rs`, (c) les tests du mécanisme lui-même. Rien dans
`src/js/` ni dans `web/js/` ne lisait ce dossier, et aucune autre extension ne le
nommait. Le seul autre endroit mentionnant les marqueurs `<!-- HELP-TOPIC:… -->`
est un **commentaire** de `scripts/build-handbook.js` (mis à jour, voir §5) — pas
un consommateur.

⇒ Condition remplie : l'écriture disque a été retirée.

---

## 3. Ce qui a été retiré, ce qui a été gardé

### Retiré

| Fichier | Retiré |
|---|---|
| `src-tauri/src/help.rs` | Le bloc « Documentation de Pilot LISIBLE sur disque » **entier** : `handbook_topics`, `push_topic`, `doc_file_name`, `doc_title`, `doc_files_of`, `write_doc_files`, `doc_dir_for`, `doc_dir`, `write_startup_docs`, les constantes `DOC_DIR_NAME` / `DOC_INDEX_FILE` / `TOPIC_MARKER_PREFIX`, plus les imports devenus inutiles (`std::path::{Path, PathBuf}`, `tauri::Manager`) |
| `src-tauri/src/lib.rs` | L'appel `help::write_startup_docs(&handle);` du `setup` de `run()` et son commentaire (6 lignes) |
| `src-tauri/src/super_agent.rs` | `SUPER_AGENT_DOC_PROMPT` (le bloc lui-même), `doc_guideline`, `SUPER_AGENT_DOC_PATH_SAMPLE`, le champ `doc_dir` de `SuperAgentPromptBlocks`, son `push_str` dans l'assemblage, et le calcul de `doc_dir` dans `do_send_super_agent_prompt` — **retour au contenu d'avant le bloc** |

### Gardé (explicitement non touché)

- L'outil `answer_from_documentation` et son **plafond d'1 appel/tour** ;
- Le socle documentaire : `answer_from_handbook`, `finish_help_answer`,
  `resolve_help_doc_model`, marqueur `DOCUMENTATION_INSUFFISANTE`, plafond de
  sortie, commandes `ask_help_doc` / `ask_help` / `get_handbook` ;
- `help/handbook.md` et `scripts/build-handbook.js` (voir §5) ;
- Le réglage `help_model`, les styles `.help-*` partagés, la Revue, l'écran Aide
  (déjà retiré) ;
- **Aucun fichier ni aucune donnée utilisateur n'est supprimé** : les fichiers
  déjà écrits dans `<app_data_dir>/aide/` sur une machine restent en place ; on
  arrête simplement de les écrire.

---

## 4. Budget du prompt : mesuré avant / après

Mesures refaites **ici**, sur le prompt réel assemblé par
`assemble_super_agent_system_prompt` (test `--nocapture`), pas recopiées.

| | Textes fixes du prompt assistant | Plafond `SUPER_AGENT_FIXED_PROMPT_BUDGET` |
|---|---|---|
| **Avant** | **6 213** caractères (dont le bloc doc) | 6 250 |
| **Après** | **5 532** caractères | **5 850** |

- Gain : **681 caractères** en moins sur **chaque** message, soit **−11 %** du
  prompt fixe.
- Le plafond n'est pas « baissé au hasard » : il est **recalculé sur la mesure
  réelle** → 5 532 + 5 % = 5 808,6, arrondi au multiple de 50 supérieur = **5 850**
  (le garde-fou reste donc utile : il rougit si une consigne regonfle).
- Le test de mesure par bloc a été mis à jour en conséquence (les deux lignes
  `DOCUMENTATION LISIBLE` / `documentation lisible` disparaissent de la mesure
  détaillée ; l'égalité « total = somme des blocs mesurés » reste vérifiée).

---

## 5. Documentation (`scripts/build-handbook.js` : commentaire seulement)

Aucun bloc `<!-- HELP:… -->` n'a changé ⇒ `npm run build:handbook` a été relancé
et **`help/handbook.md` est inchangé au bit près** (`git diff` vide après
régénération : 45 blocs, 266 486 octets). Seul un **commentaire** du script
décrivant les marqueurs a été corrigé : il renvoyait à `help::handbook_topics`,
fonction qui n'existe plus. Les marqueurs `<!-- HELP-TOPIC:x -->` restent dans le
handbook généré (provenance des blocs), désormais **sans consommateur** — ils ne
sont pas retirés : cela changerait le contenu généré, hors périmètre.

Specs mises à jour : `spec_help.md` (§ d'en-tête + §4.6 réécrit : les deux
chemins, ce qui a été retiré et pourquoi, ce qui n'est pas nettoyé chez
l'utilisateur, budget recalculé, table des tests) et `spec_super_agent.md`
(bullet « Réponse sur le mode d'emploi : UN SEUL chemin » + plafond de budget).

---

## 6. Tests : retirés, réécrits, ajouté — et pourquoi

### Retirés (4) — ils verrouillaient un chemin qui n'existe plus

| Test (`help.rs`) | Justification du retrait |
|---|---|
| `la_documentation_est_ecrite_en_fichiers_lisibles_au_bon_endroit` | Testait l'écriture dans `<app_data_dir>/aide/`, l'index et son idempotence : le code testé est supprimé. |
| `le_decoupage_par_theme_suit_les_marqueurs_du_handbook` | Testait `handbook_topics` / `doc_files_of` / `write_doc_files` : supprimés. |
| `le_nom_de_fichier_dun_theme_est_sur` | Testait `doc_file_name` (le slug anti-traversée) : supprimé avec lui. |
| `lecriture_au_demarrage_est_branchee_dans_le_setup` | Verrouillait la présence de la ligne `help::write_startup_docs(&handle);` dans `lib.rs` : branchement retiré, le test n'aurait plus eu de sens (il aurait dû échouer). |

Aucun de ces tests ne couvrait l'outil, le socle, le corpus ou le plafond
d'appels : ces garanties sont couvertes ailleurs (`src/js/assistant-outil-doc.test.js`
côté câblage JS, tests du socle côté Rust) et **aucun test de ces familles n'a été
retiré**.

### Réécrit (1) — il verrouillait l'ancien mécanisme

`assistant_prompt_names_readable_docs_path_and_both_rules` exigeait la présence
du **chemin** de la doc, de `index.md`, de `` `read` `` et des deux règles : il
verrouillait le second chemin **à l'envers** du sens voulu aujourd'hui. Il est
remplacé par `assistant_prompt_designates_no_doc_files` (§7).

### Ajouté / conservé

- **Ajouté** : `super_agent::tests::assistant_prompt_designates_no_doc_files` —
  **échoue si le bloc doc revient** ;
- **Conservé** : `super_agent::tests::super_agent_fixed_prompt_stays_under_budget`
  (garde-fou de budget, avec la nouvelle valeur) et
  `super_agent_prompt_is_measured_block_by_block` (mesure par bloc).

---

## 7. Preuve du garde-fou (test fait, pas supposé)

Le nouveau test a été **mis à l'épreuve** : injection temporaire d'un bloc de doc
dans l'assemblage du prompt, exécution du test, puis retrait de l'injection.

```
# injection temporaire : push_str("## Documentation … index.md … lisible sur disque … `read`")
cargo test --lib assistant_prompt_designates_no_doc_files
→ test result: FAILED. 0 passed; 1 failed  (759 filtered out)
→ panicked : le bloc de documentation est revenu dans le prompt (« index.md »)
```

Après retrait de l'injection, la suite repasse **759 passed / 1 ignored (exit 0)**.
Le test ne se contente pas de chercher des mots interdits (`index.md`,
« lisible sur disque », « un fichier par thème », « Ouvre-la avec `read` »,
« documentation ne laisse RIEN ») : il vérifie aussi que, blocs dynamiques vides,
le prompt est **exactement** la concaténation des textes figés connus — donc toute
insertion silencieuse, y compris un bloc de doc reformulé, le fait échouer.

---

## 8. Comptes avant / après (recomptés)

| Mesure | Avant | Après |
|---|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **763** passed, 0 failed, 1 ignored | **759** passed, 0 failed, 1 ignored |
| Écart de tests Rust | — | **−4** = exactement les 4 tests du second chemin (1 réécrit à l'identique en nombre) |
| `npx vitest run` | 3 031 tests / 177 fichiers | 3 031 tests / 177 fichiers (**inchangé**, exit 0) |
| `npm run build` | exit 0, bundle principal 3 934,97 kB | exit 0, bundle principal **3 934,97 kB** (inchangé : aucun code front touché) |
| Textes fixes du prompt assistant | 6 213 car. | **5 532 car.** (−681) |
| Plafond du prompt | 6 250 | **5 850** |
| Fichiers de doc écrits au démarrage | `index.md` + **44** thèmes = **45** fichiers (45 blocs, `orchestration` fusionné) | **0** |
| `help/handbook.md` | 266 486 octets | **266 486 octets** (identique) |
| Fichiers modifiés | — | **6** (`help.rs`, `lib.rs`, `super_agent.rs`, `spec_help.md`, `spec_super_agent.md`, `build-handbook.js`) |
| Compilation | — | aucun nouvel avertissement (rien d'inutilisé laissé derrière) |

---

## 9. Conséquence assumée (dite, pas cachée)

Le bloc retiré portait aussi deux consignes de comportement : « une question de
mode d'emploi se répond **directement**, jamais déléguée à un agent » et le
**garde-fou mémoire** (« une question de mode d'emploi ne laisse rien dans la
mémoire de suivi »). Le retour au contenu d'avant le bloc les retire du prompt.
Elles ne sont **pas réintroduites** ici : ce serait un autre lot (ajouter une
règle, et l'outil reste le point d'entrée unique). La règle « si la documentation
ne dit rien, le dire au lieu d'inventer » est, elle, portée **par l'outil
lui-même** (`pilot-assistant-doc.ts`) et reste donc active.

VERDICT : un seul chemin répond désormais sur la documentation (l'outil `answer_from_documentation`, inchangé) — le second chemin (copie disque + bloc de prompt) est retiré, son unique consommateur vérifié, le prompt passe de 6 213 à 5 532 caractères (plafond recalculé à 5 850), 4 tests du chemin supprimé sont retirés avec justification et un test qui échoue si le bloc revient est ajouté et prouvé, tout est vert (759 tests Rust, 3 031 tests JS, build OK, handbook identique).
