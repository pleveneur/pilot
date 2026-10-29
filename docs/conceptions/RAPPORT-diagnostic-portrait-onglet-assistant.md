# Diagnostic — le portrait du personnage actif ne s'affiche pas

**Date :** 2026-10-29
**Demande :** « le portrait du personnage actif ne s'affiche pas dans l'onglet de
l'assistant, ni dans le mode "assistant only". Le personnage actif est Sylvie,
activé via Présences ; son portrait a bien été déposé par l'outil d'activation,
mais l'écran ne le montre pas. »
**Portée :** Pilot uniquement. Présences n'est **pas** modifié (lecture seule),
ses données pas davantage.

---

## 1. Ce que le code de Pilot attend

| Élément | Emplacement | Contenu |
|---|---|---|
| Dossier lu | `src-tauri/src/persona.rs:139-144` | `app.path().app_data_dir()` puis `persona_dir()` (`src-tauri/src/persona.rs:60-62`) |
| Sous-dossier | `src-tauri/src/persona.rs:29-34` | `PERSONA_DIR = ".pilot"`, `PERSONA_SUBDIR = "portrait"` |
| Fichiers | `src-tauri/src/persona.rs:33-36` | `nom.txt` (nom) et `portrait.png` (image, PNG obligatoire, ≤ 8 Mio) |
| Encodage | `persona.rs::png_data_url` | le PNG est rendu en `data:image/png;base64,…` |
| Côté front | `src/js/assistant-persona.js:24-31` | mêmes noms, mêmes bornes ; `normalizePersona` / `personaPortraitSrc` |
| Affichage | `src/js/tabs.js:3038` (onglet 🧭), `src/js/super-agent.js:2371-2377` (mode « Assistant seul »), `src/js/super-agent.js:2126-2136` (écran Vocal) | trois surfaces, une seule source en mémoire (`getAssistantPortrait()`) |

Donc, en clair : **Pilot cherche `<app_data_dir>/.pilot/portrait/portrait.png`**,
où `app_data_dir` est le dossier de données **Tauri** de l'application, soit sous
Windows `%APPDATA%\<identifiant>` (`src-tauri/tauri.conf.json:5` :
`com.pilot.editor`), donc
`C:\Users\pldistance\AppData\Roaming\com.pilot.editor\.pilot\portrait\`.

## 2. Ce qui existe réellement sur le disque

Deux dossiers portent les fichiers, et ce ne sont pas les mêmes images :

| Chemin | `nom.txt` | `portrait.png` | Date de modification |
|---|---|---|---|
| `C:\Users\pldistance\.pilot\portrait\` | 6 o — `Sylvie` | **1 684 940 o**, PNG 1024 × 1024 RGB | **2026-10-29 15:41:42** |
| `C:\Users\pldistance\AppData\Roaming\com.pilot.editor\.pilot\portrait\` | 6 o — `Sylvie` | 1 554 772 o, PNG 1024 × 1024 RGB | 2026-10-29 15:32:38 |
| `C:\Users\pldistance\AppData\Roaming\com.pilot.editor.dev\.pilot\` | — | — | **absent** (la version de développement ne lit rien du tout) |

Les deux images sont valides (signature PNG exacte `89 50 4E 47 0D 0A 1A 0A`,
`file` : « PNG image data, 1024 x 1024, 8-bit/color RGB, non-interlaced »), bien
en dessous du plafond de 8 Mio. Les tailles diffèrent (1 684 940 ≠ 1 554 772
octets) : ce ne sont **pas** des copies l'une de l'autre.

## 3. Ce que Présences dépose réellement — la cause

Présences, projet voisin `G:\IA_PL\Presences` (lecture seule ici) :

- `src/chemins.ts:196-203` — `dossierPilot()` rend `join(homedir(), ".pilot")`,
  soit `C:\Users\<utilisateur>\.pilot` sous Windows (ou `PRESENCES_PILOT_DIR`
  s'il est défini) ;
- `src/chemins.ts:205-216` — `dossierPortraitDepot()` = `<dossier Pilot>/portrait`,
  `cheminPortraitDepot()` = `<dossier Pilot>/portrait/portrait.png`,
  `cheminNomPortraitDepot()` = `<dossier Pilot>/portrait/nom.txt` ;
- `docs/DECISIONS.md:250-263` (décision **D23**, 28/10/2026) le dit mot pour mot :
  « **Pilot lit déjà un dossier de portrait** : `<dossier applicatif de
  Pilot>/portrait/`, soit `~/.pilot/portrait/` par défaut
  (`C:\Users\<utilisateur>\.pilot\portrait\` sous Windows). »

**Cause tranchée :** les deux projets ne parlent pas du même dossier.

- ce que Présences dépose : `C:\Users\pldistance\.pilot\portrait\` (dossier
  « applicatif de Pilot » **dans le dossier personnel**, tel que défini par
  `Presences/src/chemins.ts:196-203`) ;
- ce que Pilot lit : `C:\Users\pldistance\AppData\Roaming\com.pilot.editor\.pilot\portrait\`
  (**dossier de données Tauri**, `src-tauri/src/persona.rs:141`).

Une seule différence — le dossier parent — suffit à tout expliquer. Le nom, le
sous-dossier, les noms de fichiers, la casse et l'extension sont **identiques**
(`portrait.png`, `nom.txt`) : ces axes-là ne sont pas en cause.

Preuve matérielle : les fichiers les plus récents, seuls déposés par l'outil
d'activation, sont dans `~/.pilot/portrait` (15:41:42). Ceux de `%APPDATA%`
datent de 15:32:38 et ne sont pas le dépôt courant. Et la version de
développement (`com.pilot.editor.dev`) n'a **aucun** dossier `.pilot` : elle ne
peut donc rien afficher, quel que soit le contenu du dépôt.

## 4. Vérification des autres blocages possibles

Rien d'autre ne bloque — vérifié point par point :

1. **La commande est bien exposée :** `persona::read_assistant_persona` est
   enregistrée dans `generate_handler!` (`src-tauri/src/lib.rs:3721`).
2. **Le contenu est bien accepté :** signature PNG valide, taille 1,6 Mio
   (< 8 Mio), base64 ≈ 2,07 M caractères pour une borne front de
   11 184 811 caractères (`assistant-persona.js:113-115`). Rien n'est rejeté.
3. **Le portrait présent en mémoire est bien rendu,** sans drapeau ni
   redémarrage :
   - onglet 🧭 : `_renderTabButton` lit `getAssistantPortrait()` à chaque
     rendu (`src/js/tabs.js:3038`), et `updateSuperAgentLabel`
     (`src/js/tabs.js:793-800`) **re-rend le bouton** ; il est appelé au
     démarrage (`src/js/main.js:591`), à l'ouverture de l'onglet
     (`src/js/super-agent.js:3527`) et à chaque retour de focus
     (`src/js/main.js:593`, `src/js/super-agent.js:3531-3533`) ;
   - mode « Assistant seul » : le héros est réécrit à chaque entrée
     (`src/js/super-agent.js:4770-4773`, appel de `applyAssistantPersonaUi()`),
     et par les mêmes retours de focus ;
   - écran Vocal : `applyVocalPortrait` est appelé par le même point
     d'application (`src/js/super-agent.js:2353`).
   Aucun de ces trois chemins n'est donc en cause : ils ne voyaient simplement
   jamais d'image, parce que la lecture rendait zéro octet.
4. **Aucune écriture de Pilot dans `.pilot/portrait`** : `persona.rs` ne fait que
   lire (aucun `create_dir_all`, `write`, `remove`) — les fichiers ne peuvent
   pas être « effacés » par Pilot.

Il reste **un défaut secondaire, sans lien avec la panne**, relevé au passage et
corrigé avec le reste : dans le mode « Assistant seul », `applyAssistantPersonaUi`
réaffectait `mark.src` à chaque appel (`src/js/super-agent.js:2374`), donc à
chaque retour de focus — soit la re-décodification d'une image base64 de 2 Mo à
chaque fois. Et le portrait, une fois affiché, restait dessiné à 40 px dans un
rond de 66 px (`src/css/style.css:11304-11308`).

## 5. Correction retenue

Au plus simple, sans aucun réglage nouveau, sans second drapeau, sans chemin en
dur :

1. **Côté socle (`src-tauri/src/persona.rs`)** — Pilot lit désormais **le dossier
   que Présences dépose**, en gardant les anciens emplacements en repli :
   1. `PRESENCES_PILOT_DIR/portrait` si cette variable d'environnement est
      définie (c'est ainsi que Présences désigne un autre dossier, rien de neuf
      côté Pilot) ;
   2. `<dossier personnel>/.pilot/portrait` — **l'emplacement réel du dépôt**
      (D23 de Présences), via `app.path().home_dir()` : portable
      Windows/macOS/Linux, aucune valeur en dur ;
   3. `<app_data_dir>/.pilot/portrait` — l'ancien emplacement, conservé pour
      qu'aucun autre hôte ne perde l'affichage.

   Le premier dossier qui contient **au moins un** des deux fichiers est retenu
   **tel quel** : aucune fusion entre deux dossiers (le nom ne peut pas venir
   d'un dépôt et l'image d'un autre). Dossier vide ou absent partout =
   `Persona::default()` : nom et icône habituels, fail-open inchangé.
   Ce qui est déjà là ne bouge pas : `persona_dir()`, `read_persona()`,
   `normalize_name()`, `png_data_url()` et leurs tests restent identiques.
2. **Côté interface (`src/js/super-agent.js` + `src/css/style.css`)** — l'image
   du personnage remplit désormais le rond du héros en mode « Assistant seul »
   (classe d'état `sa-immersive-hero-mark--portrait`, `object-fit: cover`), et
   la même source n'est plus réaffectée quand elle ne change pas. Sans
   personnage, la classe est retirée et le logo Pilot garde exactement sa
   taille d'origine.
3. **Au passage**, `enterImmersive` provoque une relecture **seulement si**
   aucun portrait n'est encore en mémoire — le cas du démarrage directement en
   mode « Assistant seul ». Aucun second mécanisme : c'est le même
   `refreshAssistantPersonaAndApply()`.
4. **Documents alignés** dans le même commit, parce qu'ils décrivaient l'ancien
   emplacement et seraient devenus faux : `AGENTS.md` (deux lignes :
   `assistant-persona.js` et `persona.rs`) et `spec_super_agent.md`
   (§ « Technique — nom et portrait du personnage actif »). Aucun bloc `HELP`
   ne cite de chemin : le manuel utilisateur n'avait rien à changer
   (`npm run build:handbook` ne produit aucune différence).

Aucun autre fichier n'est touché : ni Présences ni ses données, ni les décisions
fermes de l'écran vocal, ni la version du projet.

## 6. Vérifications exécutées

| Commande | Résultat exact |
|---|---|
| `npx vitest run` | **`PASS (4633) FAIL (0)`** — aucun test rouge, donc aucun rouge PRÉEXISTANT non plus (la suite était déjà à zéro échec au commit `0e4b845`) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **`813 passed; 0 failed; 1 ignored`** (dont les 8 tests `persona` existants, inchangés, et **3 ajoutés**) |
| `cargo test --workspace` | **986 passed; 0 failed** (139 + 34 + 813) |
| `npm run build:handbook` | aucun changement (`help/handbook.md` identique : les blocs `HELP` ne citent aucun chemin) |

Total vitest : **4633**, identique au total attendu avant la correction (aucun
fichier de test vitest ajouté, modifié ou supprimé). Les 3 tests ajoutés sont des
tests **Rust**, dans `persona.rs`.

Contrôle de bout en bout du chemin de données, avec le fichier réellement déposé
par Présences (`~/.pilot/portrait/`) et les fonctions pures du front :

```
dossier lu        : C:\Users\pldistance/.pilot/portrait
nom retenu        : "Sylvie"
nom affiche       : "Sylvie"
png octets        : 1684940 <= 8 Mio : true
portrait accepte  : true | longueur data URL : 2246610
```

Aucune de ces valeurs n'est rejetée par `personaPortraitSrc` (borne : 11 184 811
caractères), donc l'image arrive entière jusqu'à l'affichage.

## 7. Commit

Un seul commit, `e54fce6493f1137fc6a73589a249e2c7941af92b` —
`fix(assistant): le portrait du personnage actif s'affiche enfin`.

Il contient exactement six fichiers : `src-tauri/src/persona.rs`,
`src/js/super-agent.js`, `src/css/style.css`, `AGENTS.md`,
`spec_super_agent.md` et ce rapport. Aucune version bump, aucune publication,
aucun fichier de Présences.

> Le hash ci-dessus est celui du commit avant l'amendement qui n'ajoute que ce
> paragraphe au rapport : le contenu livré est identique.

## 8. Ce qui reste à faire

- Rien de fonctionnel. La version de développement (`com.pilot.editor.dev`) n'a
  aucun dossier `.pilot` : elle lira désormais le même dépôt que la version
  installée, `~/.pilot/portrait`, donc elle affichera le portrait elle aussi.
- Après le correctif, un simple retour de focus sur la fenêtre de Pilot suffit
  (aucun redémarrage) : la relecture est faite au démarrage, à l'ouverture de
  l'onglet 🧭 et à chaque retour de focus.
