# Rapport — nom et portrait du personnage actif dans l'onglet Assistant

Date : 2026-10-28 · Projet : `G:\IA_PL\pilot` (front-end Tauri + JS, tests Vitest + cargo)
Demande : le projet **Présences** dépose le portrait et le nom d'un personnage
dans un dossier ; Pilot doit les lire et les afficher à la place de son nom et
de son icône habituels (🧭), sans jamais écrire dans ce dossier.

---

## 1. Ce que j'ai trouvé (état AVANT)

Vérifié sur le disque : **aucune** occurrence de « portrait » ni de
« personnage » dans `src/js/` et `src-tauri/src/` (hors `plface`, qui parle
d'avatars PLface — sans rapport). Rien n'existait donc.

| Élément | Où il vit aujourd'hui | Ce que ça fait |
|---|---|---|
| Nom affiché | `superAgentDisplayLabel()` — `src/js/super-agent.js:1976` | rend `configCache.name` (⚙️ → Assistant → Nom), repli `"Assistant"` |
| Nom de l'onglet | `tabs.updateSuperAgentLabel(label)` — `src/js/tabs.js:790` | re-rend le bouton d'onglet avec `tab.name = label` |
| Icône de l'onglet | `_renderTabButton()` — `src/js/tabs.js:3031` | `"🧭 "` en dur pour `mode === "superagent"` |
| Nom dans le plein écran « Assistant seul » | `immersiveAssistantName()` — `src/js/super-agent.js:4008` | `superAgentDisplayLabel()` |
| Image du plein écran | `.sa-immersive-hero-mark img` — `src/js/super-agent.js:4039` | `/logo_pilot_vector.svg` |
| Dossier de données de l'application | `app.path().app_data_dir()` (Rust, ex. `src-tauri/src/lib.rs:1305`) | c'est `<app_data_dir>/.pilot/...` (base de suivi, voix locale, etc.) |
| Affichage d'images dans le WebView | base64 → `data:` URL (ex. `src/js/preview.js`, `pdf-preview.js`) | pas de protocole `asset:` déclaré dans `capabilities/default.json` |

Il n'existe **aucune** commande Tauri exposant le dossier de données à JS : la
lecture du dossier doit donc se faire côté Rust (voir §3).

## 2. Le contrat (repris tel quel, non inventé)

- dossier lu : `<dossier de données de l'application Pilot>/.pilot/portrait/` ;
- nom : `nom.txt` dans ce dossier ;
- image : `portrait.png` dans ce dossier ;
- **fichier absent = aucun personnage actif** → nom et icône habituels
  (`Assistant` / 🧭), sans erreur, sans message, sans bruit console ;
- Pilot **lit** seulement : il ne crée ni le dossier, ni les fichiers, il ne
  les nettoie jamais, il ne les modifie pas.

## 3. Décision : lecture côté RUST, commande Tauri (choix tranché)

**Voie choisie : une commande Rust `read_assistant_persona`, qui renvoie
`{ name, portrait }`.**

Pourquoi, et pourquoi pas l'autre voie :

1. **Le dossier n'est atteignable QUE depuis Rust.** `app_data_dir()` est une
   API Tauri/Rust ; aucune commande existante ne l'expose à JS. Faire lire JS
   obligerait à ajouter d'abord une commande « donne-moi le dossier de
   données », donc plus de code, pour un résultat identique.
2. **Les API déjà utilisées par le projet** pour lire un fichier hors projet
   sont bien des commandes Tauri (`files::read_file_content`, `tts_local_*`
   …). Une commande unique remplace trois appels JS (dossier, `nom.txt`,
   `portrait.png`) et un encodage base64 côté JS.
3. **Chemin portable par construction** : `PathBuf::join` côté Rust, aucun
   `\` ni `/` écrit à la main, donc Windows / macOS / Linux sans branche.
4. **L'image voyage en `data:image/png;base64,…`** : c'est déjà la convention
   d'affichage d'image du WebView dans ce projet (pas de scope `asset:` à
   ouvrir, rien à ajouter dans `capabilities/default.json`).
5. Le repli est **décidé côté Rust** (fichier absent, vide, illisible, trop
   gros → `null`), et JS ne fait qu'afficher : une seule autorité.

## 4. Ce que j'ajoute

### 4.1 Rust — nouveau module `src-tauri/src/persona.rs`

- `persona_dir(app_data_dir: &Path) -> PathBuf` = `<app_data_dir>/.pilot/portrait`.
- `read_persona(dir: &Path) -> Persona` (**pure vis-à-vis de Tauri**, testable
  sur un dossier temporaire) :
  - `nom.txt` : lu, **première ligne**, espaces rognés, caractères de contrôle
    retirés, **borné à 60 caractères** ; vide / illisible / non UTF-8 → `None` ;
  - `portrait.png` : lu **seulement si c'est un fichier** et si sa taille est
    `> 0` et `<= 8 Mio` ; signature PNG vérifiée ; encodé en
    `data:image/png;base64,…` ; sinon `None` ;
  - aucune écriture, aucune création de dossier, aucune erreur remontée
    (`Result` → `Persona` toujours valide).
- `#[tauri::command] read_assistant_persona(app: AppHandle) -> Persona` :
  résout `app_data_dir()` ; chemin non résoluble → `Persona::default()`
  (fail-open).
- Enregistrement dans `tauri::generate_handler!` de `src-tauri/src/lib.rs`.
- Tests unitaires Rust : nom présent, nom absent, nom vide, nom trop long,
  image présente, image absente, image vide, dossier absent.

### 4.2 JS — nouveau module `src/js/assistant-persona.js` (source unique)

- constantes du contrat : `PERSONA_DIR_NAME = "portrait"`,
  `PERSONA_NAME_FILE = "nom.txt"`, `PERSONA_IMAGE_FILE = "portrait.png"`,
  `DEFAULT_ASSISTANT_NAME = "Assistant"`, `DEFAULT_ASSISTANT_ICON = "🧭"` ;
- pures : `normalizePersonaName`, `personaDisplayName`,
  `personaPortraitSrc` (n'accepte qu'un `data:image/…;base64,` borné ; tout le
  reste → `""`), `normalizePersona` ;
- état **mémoire seulement** (aucune persistance, aucun réglage nouveau) :
  `getAssistantPersona()`, `getAssistantPortrait()`, `setAssistantPersona()`,
  `resetAssistantPersona()` ;
- I/O : `refreshAssistantPersona(deps)` → `invoke("read_assistant_persona")`,
  **fail-open** (toute erreur → persona vide = repli), `invoke` injectable
  pour les tests.

### 4.3 Branchements

| Fichier | Ligne (après) | Rôle |
|---|---|---|
| `src/js/super-agent.js` | `superAgentDisplayLabel()` | nom du personnage s'il existe, sinon le nom réglé, sinon `Assistant` |
| `src/js/super-agent.js` | `createSuperAgent()` | relecture **à l'ouverture de l'onglet** puis application (nom d'onglet + plein écran) |
| `src/js/super-agent.js` | `window.addEventListener("focus", …)` + retrait dans `unlisten` | relecture **quand la fenêtre reprend le focus** (changer de personnage sans redémarrer), aucune fuite à la fermeture de l'onglet |
| `src/js/super-agent.js` | `applyAssistantPersonaUi()` | pousse le nom à l'onglet et, si le plein écran est ouvert, le titre « Bonjour, je suis … » + l'image du cercle |
| `src/js/tabs.js` | `_renderTabButton()` | pour `mode === "superagent"` : `<img class="tab-avatar">` à la place de `🧭 ` quand le portrait existe, nom échappé (`esc`) |
| `src/js/tabs.js` | `updateSuperAgentLabel()` | inchangé dans sa signature : le re-rendu relit le portrait → l'icône suit le nom sans second mécanisme |

Aucune commande, aucun bouton, aucun réglage nouveau : l'absence de fichier
laisse l'interface exactement comme aujourd'hui.

### 4.4 Tests

- `src/js/assistant-persona.test.js` (nouveau) : nom présent → nom affiché ;
  nom absent → nom habituel ; image présente → `data:` ; image absente →
  `""` (icône habituelle) ; contenu vide ou illisible → repli, **jamais
  d'exception** ; `invoke` en échec → repli ; vérification des branchements
  (`superAgentDisplayLabel`, `_renderTabButton`, écouteur `focus` + son
  retrait) par lecture de source protégée (`sliceSource`).
- `src-tauri/src/persona.rs` : tests unitaires sur dossier temporaire.

### 4.5 Documentation

- `spec_super_agent.md` : nouvelle section « Nom et portrait du personnage
  actif » + bloc `<!-- HELP:super-agent-personnage -->` (visible utilisateur).
- `npm run build:handbook` régénère `help/handbook.md`.

## 5. Ce que je ne touche pas

- Le projet `G:\IA_PL\Presences` (aucune lecture, aucune écriture).
- Le dossier `~/.pilot/portrait` réel : les tests travaillent dans des dossiers
  **temporaires**, et Pilot ne fait que lire.
- Le nom réglé dans ⚙️ → Assistant (il reste le repli quand aucun personnage
  n'est actif).
- Tout le reste de l'onglet Assistant (chat, délégations, modes d'écran).

## 6. Vérifications

Résultats **recomptés** à la fin de la mission (détail brut :
`docs/rapports/RESULTATS-assistant-nom-du-personnage.txt`, aucun chiffre recopié
à la main) :

| Vérification | Commande | Résultat |
|---|---|---|
| Frontend, suite complète | `npx vitest run` | **4160 passés, 0 échec** |
| Fichier de test dédié | `npx vitest run src/js/assistant-persona.test.js` | **13 passés, 0 échec** |
| Rust, module du personnage | `cargo test --manifest-path src-tauri/Cargo.toml --lib persona` | **8 passés, 0 échec** |
| Rust, bibliothèque complète | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **807 passés, 0 échec**, 1 ignoré |
| Aide intégrée | `npm run build:handbook` | 46 blocs, handbook régénéré, topic `super-agent-personnage` présent |

- **Rien n'est cassé** : la suite frontend complète (4160 tests) et la suite Rust
  complète (807 tests) passent **après** les modifications.
- **Aucun test n'utilise le vrai dossier** `~/.pilot/portrait` : les tests Rust
  créent un dossier **temporaire** nommé d'après le pid, y déposent leurs
  fichiers, et vérifient explicitement que le dossier n'est **pas créé** quand il
  est absent (Pilot ne crée rien).
- Les tests de compilation lancés en arrière-plan (sortie redirigée vers un
  fichier) sont **terminés** : aucun n'était encore en vol à la fin de la
  mission.

## 7. Journal d'exécution

- Rapport écrit sur le disque **avant** toute ligne de code (consigne).
- Aucun fichier n'existait avant (aucune occurrence de « portrait » /
  « personnage » côté `src/js` et `src-tauri/src`) : vérifié avant d'écrire.
- `src-tauri/src/persona.rs` créé, `mod persona;` + enregistrement de
  `read_assistant_persona` dans `generate_handler!` (`src-tauri/src/lib.rs`).
- `src/js/assistant-persona.js` créé (état mémoire, fonctions pures,
  `refreshAssistantPersona` fail-open).
- Branchements : `src/js/super-agent.js` (nom d'onglet, relecture à l'ouverture
  et au focus, application au plein écran, retrait de l'écouteur) et
  `src/js/tabs.js` (portrait à la place de 🧭, nom échappé). `src/css/style.css` :
  la seule règle nouvelle (`.tab .tab-name .tab-avatar`, 14 px, rond) — aucune
  autre couleur, taille ou marge n'est touchée.
- **Trois allers-retours réels pendant la mission** (dits ici plutôt que masqués) :
  1. `cargo test` a refusé `normalize_name` (`E0716`, valeur temporaire libérée) →
     liaison intermédiaire ajoutée ;
  2. un test Rust a ensuite échoué : un `nom.txt` qui **commence** par un
     caractère de contrôle voyait sa première ligne « gagner » et le nom
     disparaître → les caractères de contrôle sont désormais retirés **avant**
     le choix de la ligne utile (le cas est verrouillé par un test) ;
  3. `superAgentDisplayLabel` a d'abord porté la règle de priorité en ligne ;
     elle a été déplacée dans la fonction pure `personaDisplayName` pour que le
     test vérifie la **vraie** règle et non une copie (aucun test tautologique).
- Choix consigné (§3) : **commande Rust** plutôt que JS, et pourquoi.
- Aucune publication, aucun tag, aucune opération git destructive ; le dépôt
  `G:\IA_PL\Presences` n'a pas été ouvert.
