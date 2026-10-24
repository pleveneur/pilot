# Rapport — Écouter les voix proposées dans les Paramètres (aperçu avant de choisir)

Demande du propriétaire : `Paramètres → Assistant → Lecture des réponses` liste
des noms de voix, mais on choisit **à l'aveugle** — on ne découvre le rendu qu'en
cliquant « Écouter » sur une vraie réponse. Il faut pouvoir **écouter chaque voix
proposée** avant de la choisir.

Contraintes tenues (cadre de la mission) :

- **un seul chemin de lecture** : l'aperçu passe par la **même** logique que le
  bouton « Écouter » des réponses (`createSpeaker(...).speak(...)`), aucun second
  moteur, aucun second nettoyage de texte ;
- **une seule lecture à la fois** : lancer un aperçu arrête le précédent, quitter
  les Paramètres ou fermer la fenêtre arrête la lecture en cours ;
- **modèle non téléchargé** : l'aperçu ne joue **jamais** la voix du système à la
  place — il le dit et propose le téléchargement (aucun téléchargement
  automatique) ;
- **repli visible et journalisé** (chemin commun existant), **jamais d'exception**,
  les Paramètres restent utilisables ;
- hors périmètre (autre mission) : le fait que « la voix choisie n'est pas
  utilisée à la lecture ». Rien n'est changé dans la logique de choix de voix.

---

## État AVANT (constat)

| Fichier | État |
|---|---|
| `src/js/read-aloud.js` | `createSpeaker().speak()` = **le** chemin de lecture (nettoyage `textForSpeech`, découpage, choix de la voix, repli journalisé, une seule lecture via `currentPlayback`). Aucune notion d'aperçu. |
| `src/js/settings.js` | Section « Lecture des réponses » : `#setting-read-aloud-voice` (liste des voix via `voiceChoiceOptions`), ligne d'état, note du moteur local, téléchargement du modèle. **Aucun moyen d'écouter une voix.** |
| `index.html` | Section `#settings-section-read-aloud` : sélecteur + 3 lignes de texte + 3 boutons de téléchargement. Aucun conteneur d'aperçu. |
| `src/css/style.css` | Styles du bouton « Écouter » des bulles (`.agent-read-btn`), rien pour les Paramètres. |

## État APRÈS (ce qui a été fait)

1. `src/js/read-aloud.js` — ajout de l'**aperçu**, mince et unique :
   - `VOICE_PREVIEW_SAMPLE` : phrase d'exemple **courte** (deux phrases, français
     neutre, ni pub ni jargon) ;
   - `previewVoice(choice, options)` : crée un lecteur par `createSpeaker` (le
     même que la bulle) avec `voiceName = <valeur du réglage>` puis `speak()` —
     donc même nettoyage, même découpage, même voix, même repli journalisé, même
     règle « une seule lecture à la fois ». Toute erreur devient un état affiché
     (`unavailable`), jamais une exception ;
   - `previewNotInstalledHint(label)` : message court quand le modèle d'une voix
     locale manque (dit clairement **pas encore installée** et **où cliquer pour
     télécharger**, sans jamais lire la voix du système à la place).
2. `src/js/settings.js` — une **rangée d'écoute par voix proposée**, construite
   à partir de la **même** liste que le sélecteur (`voiceChoiceOptions`) :
   même bouton `Écouter` ↔ `Arrêter`, message court sur la rangée en cas
   d'échec ou de repli, arrêt de tout aperçu avant d'en lancer un autre ;
   `stopReading()` à la fermeture de la modale (Annuler et Enregistrer) et sur
   `pagehide`.
3. `index.html` — conteneur `#read-aloud-voice-previews` dans la section
   existante (aucun identifiant existant renommé).
4. `src/css/style.css` — styles des rangées d'aperçu (aucune règle existante
   modifiée).
5. Test `src/js/apercu-voix-parametres.test.js` (voir § Vérifications).
6. Documentation : `spec_read_aloud.md`, bloc `<!-- HELP:lire-reponses -->`
   (`help/overview.md`), `README.md`, puis `help/handbook.md` **régénéré**
   (`npm run build:handbook`) dans le même commit.

### Ce qui n'a PAS été fait (interdits respectés)

- Aucun réglage de voix ajouté, déplacé ou dupliqué ; la valeur
  `read_aloud_voice` et la résolution de la voix sont **inchangées** (autre
  mission).
- Aucun second moteur de lecture, aucun second nettoyage de texte.
- Aucun téléchargement automatique (le seul geste reste « Télécharger le
  modèle ») ; aucun fichier supprimé.
- Aucun bump de version, aucun tag, aucune publication, aucune installation,
  aucun lancement de l'application ; aucune commande Git de nettoyage.

---

## Vérifications — chiffres réels

```
npm test
  Test Files  160 passed (160)
       Tests  2760 passed (2760)
    Duration  9.87s

cargo test --manifest-path src-tauri/Cargo.toml --lib
  cargo test: 721 passed, 1 ignored (1 suite, 10.51s)
```

Le fichier `src/js/apercu-voix-parametres.test.js` ajoute **18 tests** (tous
verts) qui portent sur :

1. **le chemin de lecture réutilisé** — `new Utterance(` et `synth.speak(`
   valent **1** dans `read-aloud.js`, `splitSentences(textForSpeech(` vaut **1**,
   le corps de `previewVoice` ne contient ni `textForSpeech(`, ni
   `splitSentences(`, ni `new Utterance`, ni `speechSynthesis` ; `settings.js`
   n'appelle **jamais** `.speak(` ni `SpeechSynthesisUtterance` ni
   `createSpeaker(`, et appelle `previewVoice(` **une seule fois** ;
2. **le comportement de l'aperçu** — l'état `speaking` puis `ended` est bien
   émis par le chemin commun, et le texte parlé est celui du découpage commun ;
3. **un seul aperçu à la fois** — écouter une autre voix coupe la première
   (`cancelCalls >= 1`, état `stopped`, l'ancien énoncé ne relance rien) ;
   phrase d'exemple **courte** (≤ 2 phrases, ≤ 160 caractères, accentuée) ;
4. **l'arrêt en quittant** — `stopReading()` présent avant la fermeture dans
   `btnClose` **et** dans `btnSave`, plus un `pagehide` ;
5. **l'échec non silencieux** — sans synthèse : `unavailable` ; sans voix :
   `no-voice` ; une synthèse qui lève n'échoue pas en exception ; les messages
   sont affichés sur la rangée (`readAloudStateLabel`, `role="status"`) ;
6. **le modèle absent** — le hint nomme la voix, dit « pas encore installée »,
   propose « Télécharger le modèle » et « sans votre geste », sans terme
   technique ; la vérification d'installation est **avant** `previewVoice(` et
   aucun téléchargement n'est lancé par l'aperçu ; le repli local reste affiché ;
7. **une seule liste de voix** — `voiceChoiceOptions(` appelé **1** fois dans
   `renderReadAloudVoice`, aucune liste reconstruite dans `renderVoicePreviews` ;
   conteneur `#read-aloud-voice-previews` unique et présent dans la section
   existante ;
8. **la documentation** — `spec_read_aloud.md` (`previewVoice`, « aper »),
   bloc `HELP:lire-reponses` (« phrase d'exemple ») et `README.md`.

### Neutralisation puis restauration (le test doit échouer sans la correction)

Quatre neutralisations successives, chacune **annulée** ensuite (fichiers
restaurés à l'identique, `git diff` revérifié) :

| Neutralisation | Résultat `npx vitest run src/js/apercu-voix-parametres.test.js` | Après restauration |
|---|---|---|
| **A.** Second chemin de lecture ajouté dans `startVoicePreview` (`new SpeechSynthesisUtterance(...)` + `speechSynthesis.speak(...)`) | **1 échec** : « les Parametres ne parlent jamais directement a la synthese » (`expected 1 to be +0`) | 18/18 verts |
| **B.** `stopReading()` retiré du bouton Annuler | **1 échec** : « quitter les Parametres arrete l'ecoute en cours » (`expected 'btnClose.addEventListener…' to contain 'stopReading()'`) | 18/18 verts |
| **C.** Vérification d'installation du modèle supprimée (on lit toujours, donc repli silencieux sur la voix du système) | **1 échec** : « la verification d'installation PRECEDE toute lecture » (`expected -1 to be greater than -1`) | 18/18 verts |
| **D.** `stopReading()` retiré de `speak()` (règle « une seule lecture à la fois » cassée dans le chemin commun) | **1 échec** : « ecouter une autre voix arrete proprement la precedente » (`expected 0 to be greater than or equal to 1`) | 18/18 verts |

Après restauration complète : `npm test` → 2760 verts, `cargo test --lib` → 721
verts (1 ignoré). Aucun autre test n'est touché.

### Vérification de syntaxe (sans lancer l'application)

Passage du graphe de modules dans `esbuild` (analyse seule, aucun paquet produit) :
les seules erreurs signalées sont **préexistantes** et sans rapport (`?url` de
`pdfjs-dist` dans `pdf-preview.js` et `pdf-to-markdown.js`, géré par Vite).
Aucune erreur sur `previewVoice`, `previewNotInstalledHint` ni `stopReading`.

### Points d'attention (honnêteté)

- Si `speechSynthesis.speak` **lève** une exception, le chemin commun l'encaisse
  (comportement **existant** du bouton « Écouter », non modifié ici) : l'aperçu
  n'échoue pas et ne bloque rien, mais il n'affiche alors pas de message — le
  bouton reste sur « Arrêter » et un clic dessus rend la main. Aucun état
  trompeur n'est affiché.
- L'aperçu **parle du texte** : il ne modifie ni le choix enregistré, ni la voix
  utilisée à la lecture d'une réponse (autre mission).
