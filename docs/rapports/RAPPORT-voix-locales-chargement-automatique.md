# Rapport — L'état des voix locales se charge tout seul (Paramètres → Assistant)

> Demande : « là faut juste charger en automatique ». La section « Lecture des
> réponses » doit afficher **d'elle-même** l'état du moteur de voix locale et la
> liste des voix, sans aucun clic, dès qu'elle devient visible.

## Cause (3 lignes)

1. La liste ne propose les voix locales que si un **état du moteur** est fourni
   (`read-aloud.js` → `voiceChoiceOptions`, `if (local)`).
2. Or l'état n'était demandé que si le réglage enregistré était **déjà** une voix
   locale (`settings.js`, ancienne garde `model ? … : null`) : avec le défaut
   `read_aloud_voice: ""` (« Automatique », `src-tauri/src/lib.rs`),
   `localVoiceModelFor("")` vaut `null` → **aucun** appel `tts_local_status`.
3. Résultat : 4 voix locales invisibles et une ligne bloquée sur « vérification
   du moteur en cours… ». Régression introduite par `52eb3ab`, publiée v0.4.46 et
   v0.5.0 (analyse : `RAPPORT-diag-voix-locales-absentes.md`).

## Ce qui a changé (fichier par fichier)

### `src/js/settings.js`

- **`refreshReadAloudVoice(choice, options)`** : l'état fourni au rendu est
  toujours celui de la voix **choisie**, sinon celui de la voix locale **par
  défaut** (`DEFAULT_LOCAL_VOICE_MODEL`) — le seul état qui permette d'afficher
  le catalogue. La garde fautive (`localVoiceStatusFor(model) : null`) est
  supprimée.
- **Vérification SANS clic** : `ensureLocalVoiceChecked(...)` est appelé dès ce
  rendu (ouverture des Paramètres **et** affichage de l'onglet Assistant), avec
  `localVoiceAutoChecked` remis à `false` dans `resetSettingsContent` → **au plus
  une vérification automatique par ouverture**, jamais par rendu, jamais en
  boucle, **aucune minuterie** (`setInterval`/`setTimeout` absents de ce chemin).
  L'état mémorisé ne dispense pas de vérifier à la première ouverture (modèle
  déposé à la main, supprimé, autre version).
- **`checkLocalVoiceStatus(value)`** : **le seul chemin de vérification** —
  exactement ce que faisait le bouton « Vérifier à nouveau » : relire l'état du
  dernier téléchargement (`refreshLocalVoiceDownloadState`), puis
  `refreshLocalVoiceStatus` pour la voix concernée (ou la voix par défaut), puis
  re-rendre en **conservant le choix affiché**. Le bouton, le chargement
  automatique et le choix d'une voix l'appellent tous : aucun second mécanisme,
  **aucune commande Rust nouvelle** (mêmes `tts_local_status` /
  `tts_local_download_state`, `src-tauri/src/lib.rs` et
  `src-tauri/src/tts_local_download.rs`).
- **Une seule demande en vol** (`localVoiceCheckInFlight`) ; un **geste** (choix
  dans la liste) reste une vérification à la demande pour **sa** voix, même après
  la vérification automatique (sinon le choix serait perdu).
- `localVoiceNoteText` (ancienne formulation locale) **supprimée** : une seule
  source pour la phrase affichée.

### `src/js/local-voice.js`

- `localVoiceSectionNote(local)` : **seule** source de la ligne d'état —
  attente / état inconnu / état réel (dossier, moteur partagé). Jamais vide.
- `LOCAL_VOICE_PENDING_HINT` (« vérification de l'état du moteur en cours… ») et
  `LOCAL_VOICE_UNKNOWN_HINT` (« État du moteur de voix locale inconnu : cliquez
  sur « Vérifier à nouveau »… »).
- `normalizeLocalVoiceStatus` expose `unknown` (défaut `false`) ;
  `refreshLocalVoiceStatus` en échec renvoie **`unknown: true`** au lieu d'un
  « non installé » inventé (la cause technique ne va que dans la console).

### `src/js/read-aloud.js`

- `voiceChoiceStatus` : nouveau cas **`local-unknown`** (état conservé, phrase
  dédiée). Placé de façon à ne pas masquer les replis qui ne dépendent pas du
  moteur (voix du système disparue → `missing` ; aucune voix du système et aucun
  état → `empty`, cas existant inchangé).

### Tests et documentation

- **Nouveau** : `src/js/voix-locales-chargement-automatique.test.js` (14 tests).
- `spec_read_aloud.md` : nouvelle § 2 ter « État du moteur : chargement AUTOMATIQUE
  de la section » + ligne du tableau `#read-aloud-local-note` + couverture.
- `help/overview.md` : une puce utilisateur (« La section se remplit toute
  seule ») → `npm run build:handbook` relancé (`help/handbook.md` régénéré).

## Le test ajouté, et la preuve qu'il mord

Contrôles (extraits) :

- la ligne d'état n'est **jamais vide** (attente / inconnu / absent / présent /
  moteur partagé) ;
- un échec de vérification donne `unknown: true` **mémorisé pour ce modèle** (pas
  de boucle) et **jamais** attribué à un autre modèle ;
- **le contrôle qui mord** : le corps de `refreshReadAloudVoice` contient
  `ensureLocalVoiceChecked(` et `else if (!localVoiceAutoChecked) …`, l'état est
  toujours passé au rendu, et l'ancienne garde fautive ne peut pas revenir ;
- un **seul** chemin de vérification : le gestionnaire du bouton appelle
  `checkLocalVoiceStatus(` et **pas** `refreshLocalVoiceStatus(` ;
- le drapeau d'ouverture est remis à `false` dans `resetSettingsContent` ;
- ce chemin ne télécharge rien (`downloadLocalVoiceModel` /
  `startReadAloudDownload` absents).

**Preuve avant/après (neutralisation réelle)** :

| Neutralisation | Résultat |
|---|---|
| appel automatique retiré (`ensureLocalVoiceChecked(...)` → commentaire) | **FAIL 1** — `expected … to contain 'ensureLocalVoiceChecked('` |
| `localVoiceSectionNote` renvoyant `""` pour un état inconnu | **FAIL 1** — `expected '' to be 'État du moteur de voix locale inconnu…'` |
| code final rétabli | **PASS 3031 / FAIL 0** |

## Comptes de tests (`npx vitest run`)

- **Avant** la tâche (HEAD `794b6c3`, sans les nouveaux tests) : **PASS 3017 / FAIL 0**.
- **Après** (avec le nouveau fichier de 14 tests) : **PASS 3031 / FAIL 0**.

Aucun test existant supprimé ni modifié ; le découpage de source du nouveau test
passe par `sliceSource` (inventaire `source-slice.test.js` : zéro découpage non
protégé).

## Coût réel de la vérification (ce qu'elle déclenche)

Au plus **une fois par ouverture** des Paramètres (et non une seconde fois à
l'affichage de l'onglet Assistant de la même ouverture) :

1. `tts_local_download_state` — **lecture** de l'état du dernier téléchargement
   (`src-tauri/src/tts_local_download.rs`, aucun réseau, aucun fichier écrit) ;
2. `tts_local_status` — **lecture** de présence des fichiers du moteur et du
   modèle (`src-tauri/src/tts_local.rs` : `resolve_engine_root` puis
   `status_for_dir_with_engine`, aucun `Command::new` de synthèse) ;
3. un rendu de la section.

Aucun téléchargement, aucune synthèse, aucun appel réseau, aucune écriture
disque sur ce chemin.

## Points à essayer dans l'application

1. ⚙️ Paramètres → onglet **Assistant** (réglage sur « Automatique ») : la liste
   affiche **les 4 voix locales** et la ligne d'état donne le dossier, **sans
   clic**.
2. Choisir une voix locale dont le modèle manque : la note dit « pas encore
   installée » + « Vérifier à nouveau » ; choisir une voix dont le modèle est
   présent : note « prête ».
3. Fermer/rouvrir les Paramètres : la section se remplit de nouveau seule (une
   seule vérification par ouverture).
4. Basculer plusieurs fois entre les onglets des Paramètres puis revenir à
   **Assistant** : pas de vérifications répétées (compteur de commandes).
5. Déposer un modèle à la main **puis** rouvrir les Paramètres : l'état le voit
   **sans cliquer** « Vérifier à nouveau ».
6. Le bouton « Vérifier à nouveau » fonctionne comme avant (même traitement).

## VERDICT : l'état du moteur et la liste des voix locales se chargent désormais tout seuls à l'ouverture de la section (une vérification par ouverture, même chemin que le bouton, jamais un vide), avec 14 tests qui mordent et une suite complète verte (3031/0).
