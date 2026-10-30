# Rapport — personnage actif : activation, désactivation complète, ancien dossier de données

Date : 2026-11-14 · Projet : `G:\IA_PL\pilot` · Branche : `main` (HEAD au départ `fc62d92`)
Demande : le personnage actif de l'Assistant (déposé par **Présences** : `nom.txt` +
`portrait.png`) doit **apparaître** à l'activation et **disparaître entièrement** à la
désactivation, **sans redémarrer Pilot**, et une vieille image du dossier de données de
Pilot ne doit **plus jamais** reprendre la main quand le dossier personnel déclare
explicitement « aucun personnage ».

---

## 1. Symptômes reproduits (preuves disque)

| Constat | Preuve |
|---|---|
| Le dossier **personnel** `C:\Users\pldistance\.pilot\portrait` ne contient **que** `nom.txt` (16 octets) = « Aucun personnage » (vérifié en hexadécimal), **aucun** `portrait.png` | `ls`, `xxd` |
| L'**ancien** dossier de données de Pilot `%APPDATA%\com.pilot.editor\.pilot\portrait` contient encore `nom.txt` = « Sylvie » **et** `portrait.png` (1 538 214 octets) | `ls -l` |
| `%APPDATA%\com.pilot.editor.dev` et `%APPDATA%\.pilot` : inexistants | `ls` |
| `PRESENCES_PILOT_DIR` non définie (ni User ni Machine) | `[Environment]::GetEnvironmentVariable` |
| À l'écran : photo de Sylvie toujours affichée, nom « Sylvie » toujours sur l'onglet 🧭 | constat utilisateur |

## 2. Cause exacte (trois défauts distincts, tous nécessaires)

### 2.1 L'état n'était relu qu'à trois moments — jamais à chaud

`src/js/main.js` (HEAD `fc62d92`, l. 597-601) et `src/js/super-agent.js`
(l. 4000-4011) ne relisaient le personnage qu'au **démarrage**, à **l'ouverture de
l'onglet 🧭** et au **retour de focus** de la fenêtre.
Or, quand le propriétaire reste dans Pilot (écran Vocal, « Assistant seul »), la
fenêtre **ne perd jamais le focus** : aucun des trois moments ne se produit. La photo
et le nom restaient donc ceux chargés au démarrage — **exactement** les deux symptômes
« la photo reste », « le nom reste sur l'onglet », alors que les fichiers sur le disque
avaient déjà changé.

`tabs.updateSuperAgentLabel()` (`src/js/tabs.js` l. 793) **recalcule** bien le bouton
d'onglet à partir de `superAgentDisplayLabel()` ; il n'était simplement **jamais
appelé** après une activation/désactivation.

### 2.2 « Aucun personnage » était traité comme un NOM

`src-tauri/src/persona.rs` (HEAD `fc62d92`, `normalize_name` l. 134) renvoyait la
première ligne non vide de `nom.txt` **sans filtrer** la phrase par laquelle Présences
déclare l'absence de personnage. Dès qu'une relecture avait lieu, la valeur
« Aucun personnage » devenait donc le nom affiché dans l'onglet.

### 2.3 Le repli sur l'ancien dossier de données pouvait fournir une IMAGE

`src-tauri/src/persona.rs` (HEAD `fc62d92`, `read_persona_from` l. 120) retenait le
**premier dossier contenant au moins un des deux fichiers**, sans distinguer un dépôt
**personnel** d'un dépôt **historique**. Un dossier personnel ne contenant que
`nom.txt` (ou rien) laissait donc `%APPDATA%\com.pilot.editor\.pilot\portrait` gagner —
avec son `portrait.png` de 1,5 Mo. C'est le mécanisme par lequel une **ancienne image
résiduelle** pouvait réapparaître à l'écran, alors que le dossier personnel disait qu'il
n'y avait plus de personnage.

## 3. Changements

### 3.1 Socle Rust — autorité unique de la lecture (`src-tauri/src/persona.rs`)

| Élément | Rôle |
|---|---|
| `PERSONA_NO_CHARACTER_MARKERS` (l. 87) | phrases d'absence reconnues : « aucun personnage », « aucun personnage actif », « pas de personnage », « no character » |
| `PersonaDepot { Personal, Legacy }` + `PersonaSource` | chaque dossier candidat porte son **rôle** |
| `persona_sources` (l. 146) | liste ORDONNÉE et **typée** des candidats : `PRESENCES_PILOT_DIR/portrait` (personnel) → `<dossier personnel>/.pilot/portrait` (personnel) → `<app_data_dir>/.pilot/portrait` (**historique**) |
| `read_persona_from_sources` (l. 188) | applique la règle de priorité (voir §4) ; un dépôt **historique** ne fournit **que le nom** |
| `declares_no_character` (l. 225) | reconnaissance PURE de la déclaration d'absence (casse, accents, ponctuation de fin neutralisés) |
| `normalize_name` (modifié) | refuse désormais une déclaration d'absence (elle n'est pas un nom) |
| `persona_stamp_from_sources` (l. 279) + commande `read_assistant_persona_stamp` (l. 409) | **empreinte légère** (existence du dossier + date et taille des deux fichiers, **contenu jamais lu**) : elle dit **quand** relire, elle ne remplace pas la lecture |

`read_persona_from` (nom conservé) reste le point d'entrée des tests existants ; il
traite tous les dossiers reçus comme **personnels** (aucun repli implicite).
La commande `read_assistant_persona` est inchangée côté contrat (`{ name, portrait }`)
et la nouvelle commande est enregistrée dans `src-tauri/src/lib.rs` (l. 3722).

### 3.2 Interface — détection du changement, sans second mécanisme (`src/js/assistant-persona.js`)

| Élément | Rôle |
|---|---|
| `isNoCharacterDeclaration` (l. 107) | même reconnaissance que le Rust, **pure** ; `normalizePersonaName` s'en sert (l. 161) pour qu'une déclaration d'absence ne puisse **jamais** atteindre l'onglet |
| `PERSONA_STAMP_COMMAND` / `PERSONA_WATCH_MS` (l. 79-82) | commande d'empreinte · 2 s (constante, **aucun réglage utilisateur**) |
| `createPersonaWatcher` (l. 333) | compare l'empreinte ; **un seul intervalle**, **jamais deux comparaisons simultanées**, **fail-open** (commande absente, réponse d'une autre forme, panne d'IPC → aucune conclusion, aucune exception, aucun message) |
| `startAssistantPersonaWatch` / `stopAssistantPersonaWatch` / `getAssistantPersonaWatch` (l. 418+) | détecteur **unique** de l'application (idempotent) |

Le détecteur **ne lit jamais le personnage** : quand l'empreinte change, il appelle le
mécanisme EXISTANT `refreshAssistantPersonaAndApply` (`src/js/super-agent.js`, l. 2856)
— une seule lecture Rust, une seule application à l'écran. Aucun second mécanisme
concurrent n'est créé.

### 3.3 Câblage

- `src/js/super-agent.js` : `startPersonaWatch()` (l. 2881) branche le détecteur sur
  `refreshAssistantPersonaAndApply` (donc : titre de l'onglet 🧭, liste des agents,
  bouton de relance de l'écran Vocal, portrait et titre du héros repassent tous par la
  même application).
- `src/js/main.js` (l. 609) : démarré **une fois**, au démarrage, à côté de la lecture
  initiale et de l'écouteur `focus` (conservé : les deux se complètent, ils ne se
  doublonnent pas — le focus ne se produit pas dans l'écran Vocal).

## 4. Règles de priorité (désormais explicites et verrouillées)

1. Le premier **dépôt personnel** qui **existe** fait **autorité** et ferme la
   recherche : `PRESENCES_PILOT_DIR/portrait` s'il est défini, sinon
   `<dossier personnel>/.pilot/portrait`. Un dossier qui existe a « parlé », **même
   vide**.
2. « Aucun personnage » dans `nom.txt` est une **déclaration d'absence** : elle donne le
   nom réglé (⚙️ → Assistant → Nom) ou « Assistant », et **aucune image**. Elle n'est
   jamais affichée comme un nom.
3. Le dépôt **historique** `<app_data_dir>/.pilot/portrait` n'est lu que si **aucun**
   dépôt personnel n'existe, et il ne fournit **que le nom** : son `portrait.png` n'est
   **jamais** utilisé, ni affiché, ni copié, ni déplacé.
4. **Pilot n'écrit rien** dans ces dossiers, ne supprime rien, n'écrase rien : l'ancienne
   image est **ignorée franchement** par le code (elle reste sur le disque, intacte).

## 5. Tests réels

| Fichier | Ce qu'il verrouille |
|---|---|
| `src/js/personnage-desactivation-complete.test.js` (10 tests) | A. le nom de l'onglet est **recalculé** (jamais « Sylvie » figé) · B. l'image quitte l'écran (élément masqué, **aucun `src` résiduel**) · C. « Aucun personnage » n'atteint **jamais** l'onglet · D. empreinte changée → onglet + portrait suivent **sans redémarrer** · E. détecteur : une seule relecture par changement, rien quand rien ne bouge, jamais d'exception, un seul intervalle, **câblage de `main.js` verrouillé** |
| `src-tauri/src/persona.rs` (`mod tests`, 5 tests ajoutés) | déclaration d'absence jamais un nom · **le dossier personnel qui déclare l'absence ferme la recherche** (l'image du dossier historique n'est pas utilisée, et reste intacte) · **l'image du dépôt historique n'est jamais utilisée** (nom seul) · un dossier personnel **vide** fait autorité · l'empreinte change à l'activation, au changement de nom, à l'arrivée/au retrait de l'image, et reste stable sinon |

Chacun de ces tests **échoue** sur le code d'avant : `normalize_name` rendait
« Aucun personnage », `read_persona_from` laissait gagner le dossier historique (nom
**et** image), et le détecteur n'existait pas (donc aucun test de câblage ne pouvait
passer).

Résultats RÉELS (machine du propriétaire, 2026-11-14) :

| Commande | Résultat |
|---|---|
| `npx vitest run src/js/personnage-desactivation-complete.test.js` | **10 tests passés** (0 échec) |
| `npm test` | **267 fichiers, 4 968 tests passés**, 0 échec |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **818 passés**, 1 ignoré (dont les 5 tests ajoutés à `persona.rs`) |

## 6. Ce qui n'a pas été touché (missions concurrentes)

- Disposition du cercle et du portrait de l'écran Vocal (`vocal-sides.js`, styles
  `.vocal-portrait`) : **non modifiée**.
- Masquage de la barre du bas (`vocal-chrome.js`) : **non modifié**.
- Aucun fichier n'était en cours de modification par une autre mission au moment des
  éditions (`git status` ne montrait que les cinq fichiers de ce correctif).
