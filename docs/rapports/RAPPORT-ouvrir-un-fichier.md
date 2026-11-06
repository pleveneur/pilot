# Rapport — l'Assistant ouvre un fichier (tâche 394)

**Date** : 2026-11-16
**Demande (propriétaire)** : permettre à l'Assistant d'**ouvrir lui-même un fichier réel du
disque** (produit par un agent, ou dont la conversation parle), de deux façons selon le
type : dans un **onglet de Pilot** s'il sait l'afficher, sinon avec le **programme par
défaut du système**. Refuser proprement ce qui ne peut pas être ouvert. **Ne jamais
exécuter de commande arbitraire.**
**Commit de départ** : `ced6312` (arbre de travail propre).

---

## 1. L'existant, d'abord (rien n'a été dupliqué)

| Besoin | Ce qui existait déjà | Réutilisé tel quel |
|---|---|---|
| Ouvrir un fichier avec le programme par défaut | `files.rs` : `pub fn open_in_browser(path) -> Result<(), String>` → `open::that(&path)` ; enregistrée dans `lib.rs` ; déjà appelée par `feedback.js`, `preview.js`, `sidebar.js` | **oui** (aucun nouveau lanceur) |
| Ouvrir un fichier dans un onglet de Pilot | `tabs.js` : `TabsManager.openFile(path, mode, …)` — route PDF → `_openPdf`, images → `_openImage`, CSV → `_openCsv`, texte → `read_file_content` + onglet, déduplication + `recordRecentFile`) | **oui** (aucun second mécanisme d'onglet) |
| Canal d'action de l'Assistant | sentinelle + `ctx.ui.confirm`/`ctx.ui.input` dans `pilot-assistant-actions.ts` → `handleSuperAgentExtensionUiRequest` → `respondSuperAgent` | **oui** (même motif que `QUEUE_REMOVE`, `MEMORY_SAVE`) |
| Espace de travail de l'Assistant | `agent_service::assistant_workspace()` = `<dossier personnel>/.pilot/assistant` | **oui** (annoncé par Rust, jamais deviné par la fenêtre) |
| Projets connus | `list_open_projects` (projets ouverts) et `list_super_agent_projects` (projets suivis) | **oui** |

**Constat** : avant cette tâche, l'Assistant n'avait **aucun moyen** d'ouvrir un fichier —
`open_in_browser` ne servait qu'au Feedback et à la prévisualisation, et `tabs.openFile`
n'était appelé que par l'interface. C'est ce chaînon manquant qui est ajouté.

---

## 2. Ce qui a été ajouté

| Fichier | Rôle |
|---|---|
| `src/js/ouvrir-fichier.js` **(nouveau, PUR)** | La **décision** : quel mode selon le type, et quand refuser. Aucun DOM, aucune I/O, aucun import Tauri. |
| `src/js/ouvrir-fichier-action.js` **(nouveau)** | Le **point unique de l'ACTION** : `runOpenFileAction({ info, invoke, tabs, projectPath })`. |
| `src-tauri/extensions/pilot-assistant-actions.ts` | Outil **`open_file`** (`ctx.ui.input` + sentinelle `PILOT_ASSISTANT_OPEN_FILE::<JSON>`). |
| `src-tauri/src/files.rs` + `lib.rs` | Commande **`inspect_open_path`** : constate `{ exists, is_file, is_dir, size, assistant_root }`. **Elle n'ouvre rien.** |
| `src/js/super-agent.js` | Branche d'interception + `runSuperAgentOpenFile` (délègue au point unique) + ligne de conversation. |
| `src/js/ouvrir-un-fichier.test.js` **(nouveau)** | Verrou : décision, action, câblage (20 tests). |
| `spec_super_agent.md`, `README.md`, `AGENTS.md`, `help/handbook.md` (généré) | Documentation + bloc `<!-- HELP:super-agent-ouvrir-fichier -->`. |

### Les deux modes (décidés par le type, jamais par l'appelant)

| Type du fichier | Mode | Mécanisme |
|---|---|---|
| Texte / code (liste blanche), Markdown, JSON, YAML, `.env`, `Makefile`, `Dockerfile`… | `tab` → `edit` | `tabs.openFile` |
| PDF | `tab` → `pdf` | `tabs.openFile` |
| Image (png, jpg, gif, webp, svg, bmp, ico, tiff, avif) | `tab` → `image` | `tabs.openFile` |
| CSV / TSV | `tab` → `csv` | `tabs.openFile` |
| Tout le reste (archive, binaire, format d'un autre logiciel…) | `system` | `open_in_browser` (`open::that`) |

La liste du texte est une **liste blanche** : un binaire inconnu n'est jamais lu comme du
texte (la lecture échouerait) — il part au programme par défaut.

### Les refus (ordre de `decideOpenFile` = ordre de la spec)

1. chemin vide → `chemin-vide` ;
2. chemin qui **ressemble à une commande** (`looksLikeCommand`) → `chemin-commande` ;
3. chemin relatif sans dossier de travail → `chemin-non-absolu` ;
4. **hors périmètre** (projets ouverts + projets suivis + espace de l'Assistant, frontière de
   dossier exigée : `<projet>-annexe` n'est pas `<projet>`) → `hors-perimetre` ;
5. inspection indisponible → `inspection-impossible` ;
6. fichier absent → `fichier-absent` ;
7. dossier → `dossier` ;
8. fichier vide → `fichier-vide`.

Dans **tous** ces cas, **rien n'est ouvert et rien n'est lancé**, et le message dit pourquoi.
Aucune commande n'est jamais exécutée : les deux modes n'ouvrent qu'un fichier **existant**.

### Ce qui est dit dans la conversation

Une ligne est écrite à côté de la réponse :
« 📂 « rapport.md » est ouvert dans un onglet de Pilot. » ou
« 📂 « export.zip » est ouvert avec le programme par défaut de cet ordinateur. »
Le nom du fichier seulement — jamais le chemin complet.

---

## 3. Preuve par mutation (le test échoue sur le code d'avant / sur une règle retirée)

| Mutation appliquée | Résultat de `src/js/ouvrir-un-fichier.test.js` |
|---|---|
| Remplacer la règle de type par « toujours un onglet » | **ÉCHEC** — `expected 'tab' to be 'system'` |
| Retirer le contrôle de périmètre | **ÉCHEC** — `hors-perimetre` attendu, ouverture constatée |
| Retirer le `if (!decision.ok) return …` du point d'action | **ÉCHEC** — `open_in_browser` appelé alors que la décision refuse |
| Neutraliser le dispatch (onglet) avec `if (false)` | **ÉCHEC** — `tabs.openFile` jamais appelé |
| Neutraliser la branche avec `false && title.startsWith(…)` | **ÉCHEC** — la branche est mesurée en début de ligne, pas par simple présence de texte |

Sur le code d'**avant** la tâche, le test ne peut pas même s'exécuter : `ouvrir-fichier.js`,
`ouvrir-fichier-action.js`, l'outil `open_file` et la commande `inspect_open_path` n'existent
pas.

---

## 4. Résultats exacts des tests

```
npm test
  Test Files  305 passed (305)        ← 304 avant (+1 : ouvrir-un-fichier.test.js)
       Tests  5673 passed (5673)     ← 5653 avant (+20)
     Duration  14,58 s

cargo test --manifest-path src-tauri/Cargo.toml --lib
  cargo test: 916 passed, 3 ignored (1 suite, 10.61s)   ← 912 avant (+4 : inspect_open_path)
```

Aucun test existant n'a été **assoupli**. Deux ajustements ont été nécessaires dans le
nouveau fichier de test, chacun justifié :

1. `openFileExtension("…/.env")` rend `""` (pas d'extension) et `.env` est donc reconnu par la
   **liste des noms sans extension** — le test a été écrit sur ce comportement réel, et
   `.env` / `.gitignore` / `.editorconfig`… ont été ajoutés à cette liste (sinon un `.env`
   serait parti au programme système au lieu de l'éditeur).
2. Le découpage de source du test de câblage utilise **`sliceSource`**
   (`src/js/source-slice.js`) au lieu d'un `slice(indexOf(…))` : le verrou d'inventaire
   `source-slice.test.js` interdit — à raison — un découpage non vérifié, qui rendrait une
   assertion négative vraie par construction.

---

## 5. Interdits respectés

- **Un seul fichier par appel** : l'outil ne prend qu'un `path` ; sa description impose de
  demander d'abord pour plusieurs fichiers.
- **Aucune fenêtre de réglage, aucun nouveau réglage utilisateur** : le mode est décidé par
  le type, il n'y a rien à configurer.
- **Aucune publication**, aucun numéro de version, aucun workflow touché.
- **Aucun autre chantier** modifié (clôture des tâches, renommage d'onglet : intacts).
- **Aucune commande exécutée** : `ouvrir-fichier.js` et `ouvrir-fichier-action.js` ne
  contiennent ni `child_process`, ni `spawn`, ni `exec` (mesuré par le test).

---

## 6. Commit

Commit de la tâche (HEAD au moment du rapport, branche `main`) :

`feat(assistant): ouvrir un fichier — onglet de Pilot ou programme par defaut (tache 394)`

Fichiers : `src/js/ouvrir-fichier.js`, `src/js/ouvrir-fichier-action.js`,
`src/js/ouvrir-un-fichier.test.js`, `src/js/super-agent.js`,
`src-tauri/src/files.rs`, `src-tauri/src/lib.rs`,
`src-tauri/extensions/pilot-assistant-actions.ts`, `spec_super_agent.md`, `README.md`,
`AGENTS.md`, `help/handbook.md` (généré), ce rapport.
