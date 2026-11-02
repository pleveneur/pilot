# Rapport — « J'entends toujours Hortense » (voix locale choisie jamais utilisée)

Symptôme : dans Paramètres → Assistant → Lecture des réponses, le choix de la voix
française locale fonctionne (il est enregistré, l'interface répond), mais chaque
clic sur « 🔊 Écouter » lit avec la voix du système (Hortense).

## Étape 0 — rapport ouvert

Ce fichier a été créé avant toute analyse, puis complété au fil du travail :
Étape 1 (preuves `fichier:ligne`), Étape 2 (correction), Étape 3 (test qui mord +
mesures réelles), Étape 4 (documentation et commit).

## Étape 1 — cause, preuves sur le poste

### 1.1 Deux dossiers de données, un seul contient le moteur

| Dossier de données | `voix/` (modèles) | `piper/` (moteur) |
|---|---|---|
| `C:\Users\pldistance\AppData\Roaming\com.pilot.editor\voix-locale`
  (version **installée**) | `fr_FR-siwis-medium.onnx` = **63 201 294 o** + `.onnx.json` = 4 875 o | **présent** : `piper/piper.exe` = **509 952 o**, DLL, `espeak-ng-data/` |
| `C:\Users\pldistance\AppData\Roaming\com.pilot.editor.dev\voix-locale`
  (mode **test** / dev) | `fr_FR-siwis-medium.onnx` = 63 201 294 o, `fr_FR-tom-medium.onnx` = **63 511 038 o** (+ leurs `.onnx.json`) | **absent** (aucun dossier `piper/`) |

Les tailles des `.onnx` du dossier dev sont **exactement** celles de la table
`VOICES` (`src-tauri/src/tts_local.rs:70-95`) : les modèles ont bien été récupérés
par le bouton « Télécharger » de Pilot, dans le dossier réellement utilisé.

### 1.2 Le réglage enregistré est bien la voix locale choisie

`C:\Users\pldistance\AppData\Roaming\com.pilot.editor.dev\config.json:133` :

```json
"read_aloud_voice": "local:piper:fr_FR-tom-medium",
```

(dans la version installée : `com.pilot.editor/config.json:157` →
`"local:piper"`, et là le moteur **et** le modèle sont présents.)

Donc : valeur attendue, correctement relue (aucun modèle inconnu, aucun repli
« voix par défaut » dû à la valeur).

### 1.3 Le journal de repli dit exactement pourquoi

`C:\Users\pldistance\AppData\Roaming\com.pilot.editor.dev\voix-locale\voix-locale.log`
(dossier réellement utilisé), 3 lignes réelles :

```
2026-10-24 23:37:00 Voix francaise locale non installee (Voix française locale non installée : il manque le moteur Piper (piper.exe). Le bouton « Télécharger » récupère le modèle depuis Internet, une seule fois et sur votre demande ; vous pouvez aussi déposer ces fichiers dans « C:\Users\pldistance\AppData\Roaming\com.pilot.editor.dev\voix-locale » (voir l'aide). En attendant, la lecture utilise la voix du système.) : repli sur la voix du systeme.
2026-10-24 23:37:39 … (idem)
2026-10-24 23:38:12 … (idem)
```

(Le journal du dossier installé, plus ancien — 22:32 → 22:34 —, est au format
d'avant le commit `52eb3ab` et listait aussi le modèle manquant : il date de
l'installation à la main.)

### 1.4 Cause retenue

**Le moteur Piper manque dans le dossier de données réellement utilisé par le
mode test (`com.pilot.editor.dev`), et Pilot n'offre aucun moyen de l'installer.**

Chaîne exacte :

1. `tts_local_status` lit `<app_data_dir>/voix-locale` (`src-tauri/src/tts_local.rs:151-160`
   `local_voice_root`, puis `:487-495`), donc `…\com.pilot.editor.dev\voix-locale`
   en dev et `…\com.pilot.editor\voix-locale` dans la version installée.
2. `status_for_dir` exige moteur **et** modèle **dans ce même dossier**
   (`src-tauri/src/tts_local.rs:245-292`) : `engine_present = piper.exe.is_file()`.
   Le moteur installé à la main pour la version installée est donc **invisible**
   en dev. `installed = false`.
3. `read-aloud.js` teste `local.installed` **au moment de lire**
   (`src/js/read-aloud.js:672-700`) : faux → ligne de journal + `notify("local-fallback")`
   → lecture par `speechSynthesis` avec la voix du système = Hortense.
4. Le seul bouton réseau (`tts_local_download.rs`) ne télécharge **que** le modèle
   (`VOICES_BASE_URL` + `file_url`, `src-tauri/src/tts_local_download.rs:39`,
   `:119-135`, `:336-380`) : **jamais le moteur**. Sur ce poste, cliquer
   « Télécharger » a donc produit les `.onnx` (tailles exactes § 1.1) sans jamais
   rendre la voix utilisable. Pire, ce chemin répond `outcome: "done"` avec
   « Le modèle … est déjà installé » (`tts_local_download.rs:311-325`) et
   `settings.js` affichait alors « Modèle … installé : lecture hors ligne
   disponible » alors que rien ne fonctionnait : **succès mensonger, repli muet
   côté interface**.

### 1.5 Causes écartées (et pourquoi)

- **Valeur de réglage mal reconnue / modèle inconnu** : écartée. La valeur
  `local:piper:fr_FR-tom-medium` est exactement celle du catalogue
  (`LOCAL_VOICE_MODELS`, `src/js/local-voice.js:52-57`), le modèle est présent
  avec la bonne taille, et le journal parle du **moteur**, pas du modèle.
- **Cache d'état périmé au moment de la lecture** : écarté. `localVoiceStatusFor`
  est mémorisé **par modèle** (`src/js/local-voice.js:283-345`) et
  `read-aloud.js:675-676` rafraîchit l'état si le modèle n'a jamais été vérifié ;
  le journal est écrit à chaque clic (3 lignes à 3 clics), donc le chemin de
  lecture consulte bien l'état réel à chaque lecture.
- **Mauvais chemin du moteur quand il existe** : écarté. Dans la version
  installée (moteur présent), `installed` est vrai et la lecture passe par le
  moteur local.

## Étape 2 — correction (minimale, à la bonne hauteur)

La cause n'est **pas** un état périmé côté interface, ni une valeur mal relue :
c'est un **moteur jugé absent**. Deux défauts, deux corrections ciblées.

### 2.1 Le moteur est un bien du PRODUIT, pas d'un identifiant de version

`src-tauri/src/tts_local.rs` :

| Ajout | Rôle |
|---|---|
| `product_identifier("com.pilot.editor.dev")` → `"com.pilot.editor"` | la version installée et la version de test sont **le même produit** ; un suffixe `.dev` ne crée pas un second moteur |
| `is_product_data_dir(name, product)` | n'accepte que `com.pilot.editor` ou `com.pilot.editor.dev…` — **jamais** le dossier d'une autre application |
| `engine_candidate_roots(own_root, product)` | dossier courant **d'abord**, puis les dossiers de données des autres versions de Pilot (triés, sous le même dossier parent) |
| `resolve_engine_root(own_root, product)` | retient le premier candidat qui contient réellement `piper.exe` → `(dossier du moteur, partagé ?)` |
| `status_for_dir_with_engine(root, engine_root, model)` | l'état lit le **moteur** dans son dossier et le **modèle** dans le dossier de données courant |

- **Lecture seule** : `is_file()` uniquement — aucune copie, aucun déplacement,
  **aucune suppression** ; les modèles ne changent pas de dossier.
- **Partage visible** : `LocalVoiceStatus` gagne `engine_dir` (chemin réel du
  moteur) et `engine_shared` (vrai si le moteur vient d'une autre version) ;
  `ready_hint_shared` écrit « le moteur déjà installé pour Pilot sur cet
  ordinateur est réutilisé (« … ») : rien n'a été copié ni supprimé ».
- `synthesize_base64_with_engine` fait tourner **ce** binaire
  (`run_piper(root, engine_root, …)`, `current_dir` = dossier du moteur pour que
  DLL et `espeak-ng-data` restent trouvables) avec **le modèle du dossier
  courant**.
- Les commandes (`tts_local_status`, `tts_local_synthesize`) passent par un seul
  helper `roots_for(&app)` : **un seul endroit** décide quel moteur est utilisé.

Conséquence sur ce poste : en dev, `own_root` =
`…\com.pilot.editor.dev\voix-locale` (sans `piper.exe`) → candidat suivant
`…\com.pilot.editor\voix-locale\piper\piper.exe` (**509 952 o**, présent) →
`engine_root` = dossier installé, `engine_shared = true`, modèle
`fr_FR-tom-medium.onnx` (**63 511 038 o**) trouvé dans le dossier dev →
`installed = true` → **la voix d'homme choisie est réellement utilisée**.

### 2.2 Plus de succès mensonger quand seul le modèle est là

- `downloadProgressText(state, status)` et la nouvelle fonction pure
  `downloadDoneMessage(state, status, model)` (`src/js/local-voice.js`) ne disent
  « installé / lecture hors ligne » **que si `status.installed` est vrai après
  vérification**. Sinon : « Modèle téléchargé, mais la voix locale n'est pas encore
  utilisable : il manque le moteur de lecture (dossier « piper »). La lecture
  utilise la voix du système. »
- `settings.js` réaffiche la ligne d'état **avec le nouvel état du moteur**, met le
  message en **avertissement**, et l'**écrit dans le journal** (`tts_local_log`) :
  le repli n'est plus muet nulle part.
- L'ancien texte « Modèle … installé : lecture hors ligne disponible » est
  supprimé (vérifié par test).

### 2.3 Le repli est dit en clair et sans jargon

`missing_hint` (Rust) et `localVoiceMissingHint` (JS) disent la **même chose**,
non technique, avec **ce qu'il faut faire** selon ce qui manque :

- **moteur absent** : « La voix locale n'est pas encore installée sur cet
  ordinateur (dossier utilisé : « … ») : il manque le moteur de lecture. Déposez le
  dossier « piper » (page officielle de Piper) dans ce dossier, puis cliquez sur
  « Vérifier à nouveau ». En attendant, la lecture utilise la voix du système. » —
  et il est écrit que le moteur n'est **jamais téléchargé automatiquement**.
- **modèle absent** (moteur présent) : même première phrase + « cliquez sur
  « Télécharger » … ».

Aucun terme technique (`onnx`, `.exe`, `espeak`, code d'erreur) dans ce que voit
l'utilisateur ; le chemin affiché est le **chemin réel renvoyé par le moteur**.

### 2.4 Ce qui n'a PAS été fait (interdits respectés)

- Aucun **repli muet** : chaque cas manquant produit une phrase visible + une
  ligne de journal.
- **Aucune suppression** de fichier : rien n'est effacé dans
  `com.pilot.editor\voix-locale` ni dans `com.pilot.editor.dev\voix-locale`.
- **Aucun téléchargement automatique** : Pilot ne télécharge pas le moteur (il ne
  sait pas le faire) et les modèles ne partent que d'un geste — le correctif ne
  déclenche **aucun** réseau à la lecture (test existant conserve).
- Aucune conclusion « c'est normal » / « réinstaller » : la cause est corrigée dans
  le code et tenue par un test.
- Aucun bump de version, tag, publication, installation ni lancement ; aucun
  fichier `voix-locale` existant modifié ; aucun autre chantier embarqué (relances
  programmées et ménage des rappels : non touchés).

## Étape 3 — le test qui mord

### 3.1 Tests ajoutés

**Rust** (`src-tauri/src/tts_local.rs`, module `tests`) :

- `le_moteur_de_l_autre_version_de_pilot_est_reutilise` — construit deux dossiers
  de données frères (`com.pilot.editor` **avec** `piper/piper.exe`,
  `com.pilot.editor.dev` **avec** le modèle `fr_FR-tom-medium`) et vérifie :
  `resolve_engine_root` renvoie le dossier **installé** (+ `shared = true`), la voix
  **choisie** devient `installed = true`, `voice = fr_FR-tom-medium`,
  `gender = homme`, `engine_shared = true`, le chemin du moteur est **dans la
  phrase**, et `dir` reste le dossier **courant** ;
- `un_dossier_voisin_etranger_n_est_jamais_utilise` — garde-fou : un
  `com.autre.appli/voix-locale/piper/piper.exe` présent à côté **n'est pas** pris ;
- `le_produit_regroupe_les_identifiants_de_pilot` — `.dev` retiré, `.dev` seul
  refusé, `com.pilot.editorial` et autre produit refusés ;
- `dossier_vide_moteur_non_installe_et_le_dit` renforcé : « pas encore installée »,
  chemin du dossier réel, « voix du système », et la phrase disant que le moteur
  n'est **jamais téléchargé automatiquement** ;
- `synthese_sans_moteur_journalise_le_repli` aligné sur la nouvelle phrase (le
  repli est **toujours** journalisé).

**JS** (`src/js/voix-locale-choix.test.js`, 3 nouveaux blocs, 8 tests) :

1. *moteur déjà installé pour l'autre version de Pilot* — avec un état
   `engine_shared`, la voix **choisie** est réellement parlée :
   `tts_local_synthesize` reçoit `model = fr_FR-tom-medium`, **aucune** voix du
   système n'est prononcée (`synth.spoken.length === 0`) et l'état ne passe pas à
   `local-fallback` (**c'est le test du symptôme exact**) ; le partage est visible
   (`engine_dir` / `dir` distincts) ; côté source, `resolve_engine_root` et
   `status_for_dir_with_engine` existent et aucun `copy(` n'est introduit.
2. *fin de téléchargement : jamais de succès mensonger* — modèle téléchargé +
   moteur absent ⇒ `warning`, sans « est installé : » ni « hors ligne », avec
   « pas encore utilisable » et « voix du système » ; voix réellement utilisable ⇒
   `success` + d'où vient le moteur ; arrêt ⇒ `warning`, panne ⇒ `error` ; et
   `settings.js` n'affiche plus l'ancien succès inconditionnel et **journalise**
   tout message non-succès.
3. *note du moteur local : claire et non technique* — « pas encore installée »,
   « Vérifier à nouveau », chemin du dossier, « voix du système », et **aucun**
   `onnx` / `.exe` / `espeak` / `DLL` / `RuntimeError`.

### 3.2 Neutralisation / restauration (preuve que les tests mordent)

| Neutralisation appliquée | Résultat observé |
|---|---|
| `resolve_engine_root` forcé à `(own_root, false)` (retour immédiat) | `le_moteur_de_l_autre_version_de_pilot_est_reutilise` **FAILED** — `left: …\com.pilot.editor.dev\voix-locale`, `right: …\com.pilot.editor\voix-locale` (`16 passed; 1 failed`) |
| `downloadDoneMessage` forcé à `{ level: "success", … }` | 2 tests JS **échoués** (« modèle téléchargé mais moteur absent », « voix réellement utilisable ») — `21 passed; 2 failed` |

Restauration : copie de la sauvegarde prise **avant** neutralisation, puis
vérification `grep -c NEUTRALISATION` = **0** dans les deux fichiers, et suites
complètes relancées (chiffres ci-dessous). Aucune trace de neutralisation ne
subsiste dans le commit.

### 3.3 Mesures réelles (après restauration)

```
npm test
  Test Files  159 passed (159)
       Tests  2739 passed (2739)        # 2731 avant ce chantier → +8 tests

cargo test --manifest-path src-tauri/Cargo.toml --lib
  test result: ok. 717 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out
```

### 3.4 Vérification sur le poste (dossiers réels)

```
…\com.pilot.editor\voix-locale\piper\piper.exe                    498 Ko   ← moteur (une seule fois)
…\com.pilot.editor.dev\voix-locale\voix\fr_FR-tom-medium.onnx      60,6 Mo  ← modèle choisi
…\com.pilot.editor.dev\voix-locale\voix\fr_FR-tom-medium.onnx.json  4,8 Ko
…\com.pilot.editor.dev\config.json:133  "read_aloud_voice": "local:piper:fr_FR-tom-medium"
```

Résolution avec la correction : `engine_root` = `…\com.pilot.editor\voix-locale`
(partagé, affiché dans la section), modèle dans
`…\com.pilot.editor.dev\voix-locale\voix` → `installed = true` → **la voix d'homme
choisie est utilisée**, plus Hortense.

## Étape 4 — documentation et commit

- `spec_read_aloud.md` : § 4.3 (moteur partagé par le **produit**, lecture seule,
  partage dit), § 4.4 (« le moteur n'est jamais téléchargé » + `downloadDoneMessage`),
  § 4.6 (phrase non technique, quoi faire selon ce qui manque, état relu à chaque
  clic), § 6 (couverture : nouveaux tests Rust/JS + preuve par neutralisation).
- Bloc `<!-- HELP:lire-reponses -->` (`help/overview.md`) : deux puces ajoutées —
  le moteur installé une fois est **réutilisé** par toutes les versions de Pilot
  (rien n'est copié) ; un modèle téléchargé sans moteur est annoncé franchement
  (« téléchargé, mais la voix locale n'est pas encore utilisable »). Puis
  `npm run build:handbook` (45 blocs, `help/handbook.md` régénéré) **dans le même
  commit** que le code.
- **Un seul** commit local, borné à ce chantier. Les `RAPPORT-*.md` (y compris
  celui-ci) restent **hors du commit** ; aucun bump de version, tag, publication,
  installation ni lancement.

### Commandes à taper

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run build:handbook   # déjà fait avant le commit
```
