# Rapport — la documentation de Pilot devient lisible par l'assistant

Date : 2026-10-25 · Projet : `G:\IA_PL\pilot`

## 0. Vérification de la tâche

C'est bien **cette** tâche qui a été traitée : rendre la documentation de Pilot
lisible en **fichiers sur disque** pour que l'**Assistant (🧭)** la consulte,
sans retirer l'aide. Aucune des tâches voisines (bande haute, coin haut droit,
barre du bas, voix locales, suivi multi-projets, sous-thèmes, renommage
« Options ») n'a été touchée.

**Écart constaté, et traité sans rien casser** : la demande parle de « ne pas
retirer le bouton/onglet Aide ». Dans **ce** dépôt, cet écran a **déjà** été
retiré lors d'une tâche précédente : `spec_help.md` §9, plus de `#btn-help` dans
`index.html`, `src/js/help.js` supprimé, verrou `src/js/retrait-ecran-aide.test.js`.
Je n'ai donc **rien retiré** (il n'y avait plus rien à retirer) et **rien
réintroduit** : la demande « ne rien retirer de plus » est respectée. Le réglage
`help_model` (repli de la Revue) est resté intact, la Revue aussi.

## 1. Geste 1 — la documentation devient des fichiers, au démarrage

| Point | Décision |
|---|---|
| Emplacement | `<app_data_dir>/aide/` — chemin **fixe et connu** (`help::DOC_DIR_NAME`) |
| Contenu | `index.md` (sommaire) + **un fichier par thème** (`overview.md`, `agent-pi.md`, `super-agent.md`…) |
| Source du contenu | Le handbook **déjà embarqué** (`include_str!("../../help/handbook.md")`) : aucun nouveau contenu, aucune duplication |
| Découpage | Sur les marqueurs `<!-- HELP-TOPIC:<slug> -->` ajoutés par `scripts/build-handbook.js` devant chaque bloc |
| Moment | **Au démarrage** : `setup` de `run()` → `help::write_startup_docs(&handle)` |
| Idempotence | Fichier identique → **aucune** écriture (0 écriture au 2ᵉ passage) |
| Panne | Fail-open : message `eprintln`, le démarrage n'échoue **jamais** |
| Réseau | Aucun |

Pourquoi les marqueurs : le séparateur `---` du handbook **ne peut pas** servir de
frontière — un bloc en contient légitimement (mesuré : 48 découpes `---` pour 45
thèmes). Le marqueur est produit par le **même** script que le handbook : une
seule source, un seul mécanisme.

Deux blocs déclarent le même thème (`orchestration`) : ils sont **fusionnés** dans
`orchestration.md` (aucun écrasement silencieux). Le slug d'un thème est réduit
aux caractères sûrs : un thème ne peut pas fabriquer un chemin (`../../etc/passwd`
→ `etc-passwd.md`).

## 2. Geste 2 — le prompt de l'assistant dit le chemin et les deux règles

Bloc figé `SUPER_AGENT_DOC_PROMPT` dans `super_agent.rs`, injecté par
`assemble_super_agent_system_prompt` à chaque message. Le chemin n'est pas
recopié à la main : il vient de `help::doc_dir(app)`, **la même fonction** que
celle qui écrit les fichiers — impossible d'annoncer un chemin faux.

Les deux règles, mot pour mot dans le prompt :

1. « une question de mode d'emploi se répond **DIRECTEMENT** ici, avec ce que dit
   la documentation — tu ne la **délègues JAMAIS** à un agent » ;
2. « si la documentation **ne dit rien** sur le point demandé, dis-le clairement
   **au lieu d'inventer** ».

Plus l'usage explicite de l'outil de lecture : « `index.md` : `…`. Ouvre-la avec
`read` quand une question porte sur le fonctionnement de Pilot. »

## 3. Geste 3 — garde-fou mémoire

La mémoire de suivi n'est écrite que par les **outils de l'Assistant lui-même**
(`update_session_memory`, `create_task`, `add_decision`, `add_milestone`…).
Aucun code de Pilot ne décide d'y écrire à sa place : la voie la **plus simple et
la plus sûre** est donc la règle explicite dans le prompt (option prévue par la
demande), sans second mécanisme :

> « Une question de mode d'emploi ne laisse **RIEN** dans la mémoire de suivi :
> aucune tâche, aucune décision, aucune note de projet, aucune mémoire de session
> ni utilisateur. »

Aucune ligne du code d'écriture de la mémoire n'a été modifiée.

## 4. Geste 4 — rien d'autre ne bouge

- Bouton / onglet / module d'aide : inchangés (déjà retirés, aucune régression).
- `help_model` en configuration : inchangé (repli de la Revue).
- Revue de code : non touchée.
- Contenu de la documentation : les blocs HELP ne sont pas réécrits ; seule la
  **forme générée** du handbook gagne des marqueurs, et l'aide s'enrichit d'une
  phrase exacte (« écrite au démarrage… correspond toujours à la version
  installée »).

## 5. Budget du prompt (avant / après)

| Mesure | Avant | Après |
|---|---|---|
| Textes fixes mesurés | **5 532** car. | **6 213** car. |
| Plafond `SUPER_AGENT_FIXED_PROMPT_BUDGET` | **5 550** | **6 250** |
| Bloc « documentation lisible » | — | 681 car. |

Le plafond est relevé **explicitement** (il restait 18 caractères libres : le
nouveau bloc ne pouvait pas tenir dedans) et documenté (commentaire de la
constante + `spec_super_agent.md`). Le test de mesure par bloc a été mis à jour :
la somme des blocs reste **exactement** égale au prompt assemblé.

## 6. Tests

### Ajoutés (5, tous côté Rust car tout le geste est côté Rust)

| Test | Ce qu'il verrouille |
|---|---|
| `help::tests::la_documentation_est_ecrite_en_fichiers_lisibles_au_bon_endroit` | (a) fichiers au bon endroit, index dont **chaque lien existe**, contenu réel, idempotence (0 puis 1 écriture) |
| `help::tests::le_decoupage_par_theme_suit_les_marqueurs_du_handbook` | découpage par marqueur (`---` interne non coupant), en-tête hors thème, fusion d'homonymes, handbook sans marqueur → erreur |
| `help::tests::le_nom_de_fichier_dun_theme_est_sur` | aucun chemin ne peut sortir du dossier |
| `help::tests::lecriture_au_demarrage_est_branchee_dans_le_setup` | l'appel `help::write_startup_docs(&handle);` existe **non commenté** dans `lib.rs` |
| `super_agent::tests::assistant_prompt_names_readable_docs_path_and_both_rules` | (b) le prompt contient le **chemin**, `index.md`, `read`, la règle (a), la règle (b), le garde-fou mémoire |

### Preuve que les verrous mordent (geste retiré → test rouge)

- appel de démarrage commenté dans `lib.rs` → `lecriture_au_demarrage_est_branchee_dans_le_setup` **échoue** ;
- ligne d'assemblage du bloc commentée dans `super_agent.rs` → `assistant_prompt_names_readable_docs_path_and_both_rules` **échoue** ;
- les deux lignes restaurées, tout repasse au vert. (Premier jet du verrou de
  branchement : il cherchait la sous-chaîne `help::write_startup_docs(` et
  passait même commenté — corrigé pour exiger la **ligne exacte** non commentée.)

### Aucun test supprimé

`super_agent_prompt_is_measured_block_by_block` et
`super_agent_fixed_prompt_stays_under_budget` sont **mis à jour**, pas supprimés.
`retrait-ecran-aide.test.js`, `assistant-outil-doc.test.js`,
`help-delai-inactivite.test.js` : inchangés et verts.

### Comptes

| Suite | Avant | Après |
|---|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **754** réussis, 1 ignoré | **759** réussis, 1 ignoré |
| `npx vitest run` | **3 012** réussis, 0 échec | **3 012** réussis, 0 échec |

## 7. Fichiers modifiés

| Fichier | Nature |
|---|---|
| `scripts/build-handbook.js` | marqueurs `<!-- HELP-TOPIC:x -->` devant chaque bloc |
| `help/handbook.md` | **régénéré** (`npm run build:handbook`), contenu inchangé hors marqueurs + 1 phrase d'aide |
| `help/overview.md` | 1 phrase dans le bloc `HELP:aide` (doc écrite au démarrage) |
| `src-tauri/src/help.rs` | documentation lisible : découpage, écriture idempotente, chemin, écriture au démarrage + 4 tests |
| `src-tauri/src/lib.rs` | 1 appel dans le `setup` de `run()` (fail-open) |
| `src-tauri/src/super_agent.rs` | bloc `SUPER_AGENT_DOC_PROMPT`, champ `doc_dir`, plafond 5 550 → 6 250, tests mis à jour + 1 verrou |
| `spec_help.md` | nouvelle §4.6 + lignes §8 |
| `spec_super_agent.md` | bullet prompt mis à jour + bullet documentation lisible |

## 8. Limites assumées

- Les fichiers sont **réécrits seulement si leur contenu change** ; un thème
  supprimé du handbook laisse son ancien fichier sur disque (aucune suppression :
  un fichier de documentation n'est jamais effacé par Pilot).
- Le dossier dépend du dossier de données (`app_data_dir`) : le chemin est donc
  propre à chaque poste, mais toujours **annoncé** avec la valeur réelle.
- Le garde-fou mémoire est **une consigne** : il n'y a pas de filtre logiciel qui
  empêcherait l'assistant d'appeler `update_session_memory` de lui-même. C'est la
  voie retenue (simple, sans second mécanisme), et elle est vérifiée par test.

VERDICT : OK — documentation écrite en fichiers lisibles au démarrage (`<app_data_dir>/aide/`, un fichier par thème + `index.md`, idempotente, hors ligne), chemin et les deux règles inscrits dans le prompt de l'assistant, garde-fou mémoire explicite, rien d'autre déplacé (aide, `help_model`, Revue intacts), 759 tests Rust (+5) et 3 012 tests JS au vert.
