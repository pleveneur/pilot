# Rapport — la voix imitée du propriétaire (service local VoiceStudio)

**Date** : 2026-11-14
**Mission** : faire parler Pilot avec **la voix imitée du propriétaire**,
produite par le service **VoiceStudio 0.5.7** déjà installé sur la machine,
**sans remplacer ni casser** la voix locale Piper (qui reste la voix par défaut
et le repli).

**Livré** : branchement d'un **troisième moteur** derrière le point de synthèse
existant, un choix de plus dans le réglage de voix (mémorisé), découpage en
groupes de phrases avec préparation du morceau suivant, repli **visible** sur
Piper, préchauffage sur geste, tests et documentation.

---

## 0. Reprise de l'état réel (mission interrompue puis terminée)

La première mission a été interrompue alors que le code était **déjà écrit sur le
disque mais pas vérifié**. À la reprise, le disque ne correspondait plus à la
consigne (« code non commité, aucun rapport ») : le travail avait entre-temps été
**commité** sous `2263a7f` (`feat(voix): lecture avec la voix imitée de
l'utilisateur (service local VoiceStudio)`), et le rapport existait déjà. La
reprise n'a donc **pas** été refaite de zéro : l'existant a été **relu et vérifié**
pièce par pièce (code machine, code fenêtre, réglage, tests, documentation), les
contrôles ont été **réellement ré-exécutés** (voir § 7), et **une chose manquait** :
l'invariant annoncé dans l'en-tête de `voicestudio-voice.js` (« la fenêtre ne joint
jamais `127.0.0.1`, verrouillé par test ») n'était tenu par **aucun** test. Il l'est
désormais (`voix-imitee-voicestudio.test.js` § 7, deux contrôles de plus).

---

## 1. Le problème

Pilot savait lire une réponse avec **deux** moteurs : la voix du système
(`speechSynthesis`) et la **voix locale Piper** (exécutable + modèle ONNX, quatre
voix françaises). Le propriétaire possède par ailleurs une **voix clonée**,
enregistrée dans son service local **VoiceStudio** (`http://127.0.0.1:3900`,
profil `id="a772c1b0"`, `name="Lucie"`, `kind="clone"`).

Demande : que Pilot **parle avec cette voix-là**, sans que rien de l'existant ne
bouge.

Contraintes fermes du propriétaire :

| Contrainte | Mise en œuvre |
|---|---|
| Aucun moteur téléchargé ni embarqué | Pilot **appelle le service déjà installé**, rien d'autre n'est récupéré |
| Le son est produit sur la machine, jamais par la fenêtre | la synthèse passe par une **commande de l'application** ; la fenêtre ne joint **jamais** `127.0.0.1` |
| Aucun flux audio / temps réel / mot à mot | découpage en **groupes de phrases**, le suivant préparé pendant la lecture |
| Aucun fichier audio sur le disque | WAV en **base64** en mémoire (`data:audio/wav;base64,…`) |
| Piper reste défaut **et** repli | Piper **intact** ; tout échec de la voix imitée **continue** avec Piper |
| Le choix est mémorisé | même champ unique `read_aloud_voice`, valeur `local:voicestudio:<profil>` |

---

## 2. Ce qui a été construit

### 2.1 Côté machine — `src-tauri/src/tts_voicestudio.rs` (nouveau)

Module **frère** de `tts_local.rs`, qui n'est **pas touché** d'une ligne.

- **Adresse unique et locale** : `BASE_URL = "http://127.0.0.1:3900"`. Aucun appel
  sortant, aucune clef, aucun compte.
- **Liveness** : `GET /health` (`/v1/health` répond `404` — mesuré, ce n'est pas
  une panne). Réponse : `{"status":"ok","device":"cuda …","version":"0.5.7"}`.
- **Voix disponibles** : `GET /profiles` → liste de profils (`id`, `name`).
- **Synthèse** : `POST /v1/audio/speech` avec
  `{"model":"tts-1","voice":"<profil>","input":"<texte>","response_format":"wav"}`.
  - Corps **UTF-8**, sérialisé par `serde_json` : un corps non UTF-8 fait
    répondre `400` au service (piège mesuré, accentué : `é`).
  - Réponse **vérifiée** avant d'être rendue (`is_wav` : `RIFF` … `WAVE`) : une
    réponse JSON d'erreur ne devient jamais un « son ».
  - Délais bornés : connexion **3 s**, requête **30 s**.
- **Voix inconnue détectée AVANT l'appel** : le service répond **`200` en
  jouant sa voix par défaut** quand la voix demandée n'existe pas (mesuré :
  `91382` octets pour un nom inventé). `voice_error(voice, profils)` refuse donc
  la demande, avec un message explicite ; le mensonge du service ne peut pas
  passer pour le bon résultat.
- **Journal** : `[voix imitée] …` ajouté au journal **existant**
  (`voix-locale.log`), avec la même rotation — aucun second journal.
- **Commandes** : `tts_voicestudio_status`, `tts_voicestudio_synthesize`,
  `tts_voicestudio_warmup`, `tts_voicestudio_log` — les trois premières sont
  `pub async fn` + `tauri::async_runtime::spawn_blocking` : **aucun blocage du
  thread principal** pendant une synthèse (1,1 s par phrase, ~6 s au démarrage à
  froid).
- `src-tauri/src/lib.rs` : `mod tts_voicestudio;` + enregistrement des quatre
  commandes.

### 2.2 Côté fenêtre — `src/js/voicestudio-voice.js` (nouveau)

**Source unique** de la voix imitée :

- valeur du réglage : `voiceStudioChoiceValue(id)` → `local:voicestudio:<id>` ;
  **l'identifiant**, jamais le nom (deux profils de même nom → `409`) ;
- libellés : « Ma voix imitée — Lucie (VoiceStudio) », et
  `voiceStudioUnavailableLabel` quand le service ne peut pas annoncer le choix
  mémorisé (« service injoignable », « voix introuvable », « service non
  vérifié ») ;
- **découpage** : `groupSentencesForVoiceStudio` — premier morceau = **une
  phrase** (le son arrive vite), puis des groupes d'au plus **4 phrases / 700
  caractères**, et **jamais** une phrase coupée (une phrase trop longue reste
  seule) ;
- dialogue avec la machine : uniquement les commandes de l'application ;
- état du service : `refreshVoiceStudioStatus` (ne lève **jamais**),
  `keepKnownProfiles` (une panne ne fait pas disparaître le choix mémorisé de la
  liste), `voiceStudioKnowsProfile` (détecte une voix retirée du service) ;
- synthèse : WAV → **base64 en mémoire**, aucune écriture disque.

### 2.3 Lecture — `src/js/read-aloud.js` (modifié, intégration minimale)

- Une **branche de plus** dans `speak()`, **avant** la branche Piper : elle
  réutilise `playLocalChunks` de `local-voice.js` (donc **pas** de seconde
  boucle de lecture) avec un `synthesize` qui appelle la machine et **prépare le
  groupe suivant** pendant la lecture du premier (aucun trou audible).
- **Repli en chaîne**, tout visible : voix imitée → `voicestudio-fallback` →
  **Piper** → `local-fallback` → voix du système. Chaque maillon écrit une ligne
  au journal et affiche **une seule ligne** à côté du bouton « 🔊 Écouter »
  (`readAloudVoiceStudioFallbackNotice`), jamais une fenêtre, un bandeau ou une
  pastille.
- `READ_ALOUD_SPEAKING_STATES` gagne `voicestudio-fallback` : pendant ce repli
  **Pilot parle**, donc le micro du mode Vocal reste protégé (même règle, aucun
  cas particulier).
- `voiceChoiceOptions(voices, local, voicestudio, wanted)` : les **quatre voix
  Piper** restent proposées, **une** entrée imitée s'ajoute, et un choix
  mémorisé que le service n'annonce pas **reste dans la liste** — sinon un
  enregistrement écraserait le réglage dans le dos de l'utilisateur.
- `voiceChoiceStatus(…, voicestudio)` : quatre issues distinctes et lisibles —
  `ok`, `voicestudio-unknown`, `voicestudio-down`, `voicestudio-missing`.
- L'aperçu « ▶ Écouter » passe par le **chemin existant** (`previewVoice` →
  `createSpeaker`, phrase d'exemple commune) : aucun second chemin de lecture.

### 2.4 Réglage — `src/js/settings.js` (modifié)

- La section « Lecture des réponses » lit l'état du service et l'affiche dans la
  **même** liste que les voix Piper (le choix reste un **seul** réglage).
- Sur **geste** de sélection d'une voix imitée : `warmupVoiceStudio` (le service
  démarre à froid en ~6 s) — préchauffage **non bloquant**, jamais automatique,
  échec silencieux.
- Une panne du service pendant l'aperçu affiche `voicestudio-fallback` **sur la
  rangée concernée** (même ligne d'état que les autres replis).

---

## 3. Tests

### Nouveaux — `src/js/voix-imitee-voicestudio.test.js` (22 contrôles)

| Ce qui est tenu | Contrôle |
|---|---|
| Service **absent** → la lecture **continue** avec Piper | état `voicestudio-fallback` émis et **publié** avec `engine: "local"`, puis `tts_local_synthesize` réellement appelé, lecture terminée `true` |
| Repli **jamais silencieux** | une ligne `[voix imitée] … repli sur la voix locale` est écrite au journal |
| Choix **non réécrit** par un repli | la valeur mémorisée reste `local:voicestudio:<id>` |
| Découpage | premier morceau = 1 phrase ; morceau suivant = plusieurs phrases ; toutes les phrases présentes une fois, dans l'ordre ; phrase trop longue **seule et entière** ; texte vide → rien |
| **Accents UTF-8** | `éàçù`, `Élise` traversent la frontière **intacts** ; côté machine le corps est bâti par `serde_json` (donc UTF-8) |
| **Voix inconnue signalée** | `voicestudio-missing` + phrase claire, valeur conservée ; `voicestudio-down` quand le service ne répond pas ; `ok` quand tout va bien ; côté machine la voix est vérifiée **avant** l'appel |
| **Non bloquant** | les trois commandes sont `pub async fn` + `spawn_blocking` (aucun `pub fn`) |
| Les **4 voix Piper** intactes | la liste contient toujours 4 entrées `local:piper*`, **une seule** entrée imitée, libellé portant le nom et le service ; service sans profil → **aucune** entrée inventée ; choix mémorisé conservé quand le service est éteint, sans doublon |
| Une **seule porte** vers le service (§ 7, ajouté à la reprise) | aucun `fetch`, aucun `XMLHttpRequest`, aucune `WebSocket` dans `voicestudio-voice.js`, `read-aloud.js` et `settings.js` ; l'adresse `127.0.0.1:3900` n'existe qu'à **deux** endroits de `voicestudio-voice.js` (son commentaire d'en-tête et sa constante), et n'est recopiée nulle part ailleurs |

### Test existant mis à jour (intention préservée, pas affaibli)

`src/js/vocal-correctifs-revue.test.js` :
« CES TROIS états » → **« CES QUATRE états »**, avec `voicestudio-fallback` ajouté
à la liste attendue **et** à la vérification « l'écran juge comme le bouton de la
bulle ». Le test exigeait explicitement qu'un nouvel état de lecture soit
**ajouté là en connaissance de cause** : c'est exactement ce qui est fait. Aucune
assertion n'a été retirée ni assouplie.

### Rust — `tts_voicestudio::tests`

Corps JSON **en UTF-8** avec accents ; voix vide → `default` ; seuls les vrais
WAV acceptés (`RIFF`/`WAVE`, et rejet du vide, du JSON, d'un en-tête tronqué) ;
profils lus par **identifiant et par nom** ; message d'explication d'une voix
inconnue ; phrase d'état qui nomme **toujours** le repli Piper ; texte trop long
refusé.

### Résultats

```
npx vitest run                                   PASS (5134)  FAIL (0)
cargo test --manifest-path src-tauri/Cargo.toml --lib   826 passed, 1 ignored, 0 failed
cargo check --manifest-path src-tauri/Cargo.toml         propre (aucun avertissement du nouveau module)
```

Aucun test existant n'a été retiré, affaibli ou ignoré.

### Vérification sur le service RÉEL (puis retirée du dépôt)

Le chemin complet a été exécuté une fois contre le service réellement démarré
(test temporaire `#[ignore]`, supprimé après la mesure) :

```
reachable=true version=0.5.7 device=cuda (NVIDIA GeForce RTX 5080)
profils=[VoiceStudioProfile { id: "a772c1b0", name: "Lucie" }] known=true
base64 len=256980 prefix=UklGRtbwAgBX
octets=192734 wav=true
voix inconnue -> la voix « VoixQuiNExistePas » n'existe pas dans VoiceStudio (voix connues : Lucie)
```

Autrement dit : liveness lue, profil trouvé, **synthèse réelle avec accents**
(`éàçù`, `œuvre`) rendue en **WAV valide de 192 734 octets** et décodée depuis le
base64, et **voix inconnue refusée** au lieu de laisser le service jouer sa voix
par défaut.

---

## 4. Qualité (quality-gate)

- **Un seul point de synthèse par étage** : machine = `tts_voicestudio.rs`
  (frère de `tts_local.rs`, qui n'est pas modifié) ; fenêtre = la branche de
  `speak()` dans `read-aloud.js`, qui réutilise `playLocalChunks`. Aucun second
  mécanisme de lecture, aucun second journal, aucun second réglage.
- **Une seule liste de voix** : `voiceChoiceOptions` (réglage **et** rangées
  d'écoute, même ordre, même libellé).
- **Aucune duplication de valeur** : la valeur `local:voicestudio:` n'existe que
  dans `voicestudio-voice.js`.
- **Aucun appel réseau sortant** : une seule adresse, locale, et seulement si le
  service est installé. Aucun secret, rien dans le dépôt.
- **Aucun fichier audio écrit** : tout est en mémoire.
- **Aucun travail sur le thread principal** : commandes `async` +
  `spawn_blocking`, tenu par un test.
- **Aucun écran nouveau, aucun réglage nouveau** : l'entrée s'ajoute à la liste
  existante des voix.
- **Aucun découpage de source non protégé** dans le nouveau test (règle
  `source-slice.test.js` : `sliceSource` est utilisé).
- **Mode distant (`web/js/*`) non touché** (aucune référence à la lecture à voix
  haute de ce côté).

---

## 5. Mode d'emploi

1. Démarrer le service **VoiceStudio** sur la machine (il écoute
   `127.0.0.1:3900`). Rien à cloner dans Pilot : la voix imitée est **déjà
   enregistrée** dans le service.
2. Ouvrir **Options → Assistant → « Lecture des réponses »**.
3. Dans la liste des voix, choisir **« Ma voix imitée — Lucie (VoiceStudio) »**.
   Le service est préchauffé à ce moment-là (il peut mettre ~6 s à démarrer : la
   fenêtre n'est jamais bloquée).
4. Cliquer sur **« ▶ Écouter »** à côté de la ligne pour entendre l'exemple, puis
   **Enregistrer**. Le choix est mémorisé et réutilisé aux démarrages suivants.
5. Lire une réponse avec le bouton **« 🔊 Écouter »** sous la bulle : c'est votre
   voix imitée qui parle, par groupes de phrases (le premier son arrive vite, le
   suivant est préparé pendant la lecture).

**Si le service est éteint** : la lecture ne s'arrête pas, elle **continue avec la
voix locale (Piper)** et affiche une ligne courte à côté du bouton. Le choix
enregistré **n'est pas** remplacé ; dès que le service répond, c'est de nouveau
votre voix.

**Si la voix a été retirée du service** : la ligne de la voix l'annonce
(« voix introuvable ») et la lecture se rabat sur Piper. Pilot ne joue **jamais**
une autre voix en la faisant passer pour la vôtre.

**Pour revenir en arrière** : choisir une autre voix dans la même liste
(« Automatique » ou une voix Piper). Aucun réglage n'a été ajouté, aucune
configuration existante n'est invalidée.

---

## 6. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src-tauri/src/tts_voicestudio.rs` | **nouveau** — moteur de voix imitée côté machine (+ tests) |
| `src-tauri/src/lib.rs` | `mod` + enregistrement des 4 commandes |
| `src/js/voicestudio-voice.js` | **nouveau** — valeur, libellés, découpage, état, synthèse |
| `src/js/read-aloud.js` | branche de lecture, repli `voicestudio-fallback`, options et statut de voix |
| `src/js/settings.js` | liste des voix, préchauffage sur geste, aperçu |
| `src/js/voix-imitee-voicestudio.test.js` | **nouveau** — 22 contrôles |
| `src/js/vocal-correctifs-revue.test.js` | 3 états → 4 états (intention préservée) |
| `spec_read_aloud.md` | § 4 quater (voix imitée) + portée + couverture |
| `help/overview.md` | paragraphes utilisateur (voix imitée, repli, vie privée, rapidité) |
| `help/handbook.md` | régénéré par `npm run build:handbook` |
| `AGENTS.md` | table de navigation + arborescence (`tts_voicestudio.rs`, `voicestudio-voice.js`, `read-aloud.js`) |

Aucune version, aucun changelog, aucun tag, aucun push.

---

## 7. Commandes réellement exécutées (reprise, sur l'état livré)

Relancées sur le disque tel qu'il est, après relecture des fichiers, sans rien
désactiver ni filtrer :

| Commande | Résultat exact |
|---|---|
| `npx tsc --noEmit` | `TypeScript: No errors found` (le dépôt n'a pas de `tsconfig.json` : l'outil rend « aucun problème » sur le JavaScript du projet) |
| `npx vitest run src/js/voix-imitee-voicestudio.test.js src/js/vocal-correctifs-revue.test.js` | `PASS (40) FAIL (0)` |
| `npm test` (suite complète, avant l'ajout du verrou) | **277 fichiers** — `5134 passed`, **0 échec**, 14,55 s |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | `826 passed, 1 ignored (1 suite, 10,53 s)`, 0 échec |
| `npm run build:handbook` | `help/handbook.md généré (47 blocs, 320161 octets, …)` — **aucune différence** avec la version du dépôt (l'aide embarquée était déjà à jour) |
| `git status` | propre : tout le travail était déjà commité dans `2263a7f` |

Après l'ajout du verrou § 7 des tests : `npx vitest run
src/js/voix-imitee-voicestudio.test.js` → **`PASS (22) FAIL (0)`** (20 → 22
contrôles), puis `npm test` relancé : **277 fichiers, `5136 passed`, 0 échec**
(14,51 s).

### Ce qui a été vérifié, et comment

- **Un seul point de synthèse par étage** : `tts_voicestudio.rs` (machine) +
  `voicestudio-voice.js` (fenêtre) ; `tts_local.rs` n'apparaît dans **aucun** diff
  de la mission — les voix Piper gardent leur chemin, leur état et leur repli.
- **Aucun appel direct du navigateur au service** : vérifié par lecture
  (`voicestudio-voice.js` n'utilise que `invoke`) **et** désormais tenu par un
  test qui relit les trois fichiers de la fonctionnalité (§ 7 des tests).
- **Aucun appel sortant** : l'adresse `http://127.0.0.1:3900` est la seule ; elle
  est **refusée** hors de sa constante (test), et le client HTTP Rust a les
  redirections **désactivées** (`Policy::none()`), donc il ne peut pas dériver
  vers un autre hôte.
- **Aucun fichier audio** : la réponse WAV est encodée en base64 en mémoire
  (`synthesize_base64`) et consommée directement par l'objet audio de la fenêtre
  (`data:audio/wav;base64,…`) ; aucun `write` de fichier dans le module.
- **Rien sur le thread principal** : les trois commandes sont `pub async fn` +
  `spawn_blocking` (tenu par test, qui refuse aussi un `pub fn`).
- **Le test existant n'a pas été relâché** : diff vérifié ligne à ligne ;
  `vocal-correctifs-revue.test.js` gagne `voicestudio-fallback` dans la liste
  **et** dans l'assertion d'ordre (« ces QUATRE états et pour eux seuls »), plus
  une assertion sur la bascule du bouton. Rien n'a été retiré ni rendu plus
  permissif.

---

## 8. Limites connues (dites franchement)

1. **Le service n'est jamais lancé par Pilot.** S'il est éteint, la voix imitée
   est indisponible : Pilot le dit et lit avec Piper. C'est le comportement
   voulu (Pilot n'installe, ne lance et ne configure rien), mais il faut
   démarrer VoiceStudio soi-même.
2. **Échec en cours de lecture = reprise au début avec Piper.** Si le service
   tombe **entre deux groupes de phrases** (et non au premier), le repli relit la
   réponse **depuis le début** avec la voix locale : on entend les premières
   phrases deux fois. Aucune perte de texte, aucune coupure, aucun silence —
   mais la répétition est possible. Le corriger demanderait de mémoriser la
   position de lecture dans le repli ; ce n'était pas demandé et le remède serait
   plus risqué que le défaut.
3. **Démarrage à froid (~6 s) : l'attente est silencieuse, pas affichée en
   secondes.** Le bouton passe immédiatement à « Arrêter » (donc on voit que la
   lecture est lancée) et l'aide annonce que le premier mot peut demander quelques
   secondes ; il n'y a **pas** de compteur ni de barre de progression. Le
   préchauffage sur le geste de sélection supprime la plupart de ces attentes.
4. **Le nom de la voix n'est pas mémorisé, seulement son identifiant.** Après un
   redémarrage de Pilot avec le service éteint, la ligne du réglage affiche
   l'identifiant (`Ma voix imitée — a772c1b0 (VoiceStudio — service injoignable)`)
   au lieu du nom. Dès que le service répond, le nom revient. Mémoriser le nom
   aurait ajouté un second réglage, ce que la mission interdisait.
5. **Une voix connue par son seul nom** est acceptée par la machine
   (`voice_known`), mais le réglage mémorise toujours l'**identifiant** ; deux
   profils homonymes ne sont donc jamais confondus.
6. **Aucune mesure du service réel dans cette reprise** : la vérification contre
   le service démarré avait été faite lors de la première mission (mesures citées
   au § 3). Elle n'a **pas** été refaite ici (le service n'était pas sollicité
   pendant les tests) ; le chemin est couvert par les tests unitaires Rust et par
   les doublures du test fenêtre.
