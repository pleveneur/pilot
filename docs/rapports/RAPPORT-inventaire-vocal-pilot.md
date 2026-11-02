# RAPPORT — Ce que Pilot sait faire à la voix (inventaire, lecture seule)

> Audit en **lecture seule**. Aucun fichier de code modifié, rien compilé, rien lancé,
> rien installé, rien téléchargé. Seul fichier écrit : celui-ci.
> Chaque affirmation porte une preuve (fichier + ligne, ou commande + sortie).
> Quand quelque chose ne se vérifie pas sans écran ni micro, j'écris **non vérifié**.
> Quand un document et le code se contredisent, **le code gagne** et je le dis.

---

## Réponse courte (10 lignes)

1. **Écouter : existe**, mais avec l'oreille du navigateur (Web Speech API), donc la
   reconnaissance part chez Google/Microsoft. Aucune clé, aucune configuration.
2. **Lire : existe vraiment**, sous chaque réponse, avec arrêt immédiat, et **quatre
   voix françaises locales installées sur ce poste** (moteur Piper présent).
3. **Le réglage de la voix est unique** : un seul endroit, Paramètres → Assistant.
4. **Répondre en texte : le signal de fin de réponse existe et est déjà utilisé**
   (notification de fin, son de fin, lecture automatique côté web distant).
5. **Le liant est absent** sur ordinateur : rien ne se lit tout seul, et la dictée
   ne s'envoie pas toute seule. Il faut **deux gestes clavier** par échange.
6. **On ne peut pas couper Pilot en parlant** : aucun module n'écoute pendant qu'il parle.
7. **Ni mot d'appel, ni écoute permanente, ni détection de silence** dans le code.
8. Le document de conception **prévoit tout cela et le tranche déjà** ; ses numéros de
   ligne ont vieilli, mais ses constats restent justes, sauf **une omission** (point E).
9. **Le plus petit premier pas utile** : envoyer automatiquement à la fin de la dictée.
   Le second, presque aussi petit : lire tout seul la réponse finale à la fin du tour.
10. **Obstacle principal** : la dictée dépend d'un service en ligne — donc « tout local »
    exige d'abord de remplacer l'oreille, ce qui n'existe nulle part dans le dépôt.

---

## A. Écouter (la dictée)

### A.1 Existe-t-elle vraiment dans le produit livré ? — **OUI, dans le code**

| Où | Preuve |
|---|---|
| Agent π (desktop) — bouton | `src/js/agent-pi.js:562` : `<button class="agent-btn agent-mic-btn" data-action="voice" title="Dictée vocale (transcription cloud)">` |
| Agent π (desktop) — logique | `src/js/agent-pi.js:923-999` (`toggleVoiceInput`), appelée au clic `src/js/agent-pi.js:1942` |
| Assistant 🧭 — bouton | `src/js/super-agent.js:2892` (même barre de saisie que l'agent π) |
| Assistant 🧭 — logique | `src/js/super-agent.js:3287-3352`, appelée `src/js/super-agent.js:3647` et `:3768` |
| Web distant — bouton | `web/index.html:77` (`id="prompt-mic"`) |
| Web distant — logique | `web/js/app.js:1790-1866`, état du bouton `web/js/app.js:1768-1782` |

Ce n'est donc pas seulement une spec : le bouton et le code sont là, dans les trois
interfaces.

### A.2 Quel moteur ? Local ou distant ? Une clé ? — **moteur du navigateur, distant, sans clé**

- Le moteur est celui du navigateur, pas de Pilot : `const SR = window.SpeechRecognition || window.webkitSpeechRecognition;` — `src/js/agent-pi.js:931`, même chose `src/js/super-agent.js:3291` et `web/js/app.js:1800`.
- Ce n'est **pas local**, et le code le dit lui-même : commentaire « Sur WebView2 (Windows), l'audio passe par le cloud Microsoft/Google (pas 100% local) » — `src/js/agent-pi.js:843-845`.
- **Aucune clé, aucun compte, aucun réglage** : il n'existe aucune commande ni variable de configuration de reconnaissance vocale dans le dépôt (seule la langue est codée en dur : `const VOICE_LANG = "fr-FR"` — `src/js/agent-pi.js:847`, `src/js/super-agent.js:3268`, `web/js/app.js:1763`).
- Le produit en tient compte : sur un **projet sensible**, la dictée est **refusée** — `src/js/agent-pi.js:926-929` (« la dictée vocale cloud est bloquée (local-first garanti) »).
- Faiblesse prévue par le code : si le service manque dans la fenêtre, le message est explicite (« Edge/WebView2 ne fournit pas le service cloud Web Speech de Chrome ») — `src/js/agent-pi.js:975-976`.
- **Fonctionne-t-elle réellement sur ce poste Windows ? non vérifié** (je n'ai lancé aucune application, je n'ai pas parlé dans un micro).

### A.3 Branchée sur ordinateur de bureau ou seulement sur le web ? — **sur les deux** (la spec dit vrai)

- Desktop : le bouton est dans la fenêtre (`src/js/agent-pi.js:562`, `src/js/super-agent.js:2892`).
- Le micro de la fenêtre est **débloqué par un correctif local** de la bibliothèque d'affichage : `src-tauri/vendor/wry/src/webview2/mod.rs:497-517`, bloc « Permission handler (patched for Pilot) », qui accorde `MICROPHONE` ; branché par `[patch.crates-io] wry = { path = "src-tauri/vendor/wry" }` — `Cargo.toml:25` (le patch doit être à la racine du workspace).
- Web distant : conditionné à HTTPS, sinon le bouton est désactivé — `web/js/app.js:1773-1778` et `:1796-1799`.
- **Le micro s'ouvre-t-il vraiment dans la fenêtre de ce poste ? non vérifié** (constat sur le code seulement).

### A.4 Que se passe-t-il quand on parle ? Où le texte arrive-t-il ? — **dans la zone de saisie, à la fin**

Le texte est écrit **à la fin du champ de saisie**, pas au curseur :
`inputEl.value = preText + sep + transcript;` — `src/js/agent-pi.js:965` (pendant la dictée) et `src/js/agent-pi.js:988` (à l'arrêt). Idem Assistant `src/js/super-agent.js:12901` et `:12919`, web `web/js/app.js:1836` et `:1854`.

Le texte **n'est jamais envoyé** par la dictée : aucune de ces lignes n'appelle l'envoi.

### A.5 Comment la dictée s'arrête-t-elle ? — **à la main, ou quand le moteur s'arrête**

- Second clic sur le micro : `if (voiceActive) { stopVoiceInput(); return; }` — `src/js/agent-pi.js:930`, fonction `stopVoiceInput` `:916-921`.
- Ou quand le moteur rend la main : `rec.onend` — `src/js/agent-pi.js:982-991` (le texte final reste dans le champ).
- **Aucune détection de silence n'est écrite dans Pilot** : recherche `getUserMedia`, `AudioContext`, `createAnalyser`, `echoCancellation`, `VAD` sur `src/js`, `web/js`, `src-tauri/src` (hors tests) → **0 occurrence** pour chacune. Pilot ne mesure jamais le son.

### A.6 Mode d'écoute continue, ou relance à chaque phrase ? — **continu demandé, mais à relancer**

- `rec.continuous = true;` — `src/js/agent-pi.js:935`, `src/js/super-agent.js:3295`, `web/js/app.js:1804` : on demande au moteur de ne pas s'arrêter à chaque phrase.
- Mais **aucune reprise automatique** n'est écrite : `onend` se contente de recopier le texte et d'éteindre le voyant (`src/js/agent-pi.js:982-991`). Si le navigateur coupe au bout d'un silence (ce que la spec prévoit déjà : `spec_voice_input.md:185-187`), **il faut recliquer**.
- **Point bloquant pour un usage vocal seul** : la dictée est **refusée pendant que l'agent travaille** — `src/js/agent-pi.js:925` (« ⏳ Agent en cours, patiente la fin pour dicter. »). On ne peut donc pas parler pendant que Pilot répond.

---

## B. Répondre en texte — le seul point à vérifier : la fin de réponse est-elle exploitable ?

**OUI, et elle est déjà exploitée par d'autres morceaux du programme.** Preuves dans le
traitement de `agent_end` du chat :

| Élément | Preuve |
|---|---|
| Fin de tour reconnue (et distinguée d'une reprise) | `src/js/agent-pi.js:6623` : `if (!isTerminalAgentEnd(payload)) { break; }` |
| Un autre morceau réagit déjà à cette fin (notification si la demande venait du web) | `src/js/agent-pi.js:6633` : `notifyAgentDoneFromRemote({...})` |
| Un autre morceau réagit déjà (notification locale, issue #41) | `src/js/agent-pi.js:6640` |
| Un autre morceau réagit déjà (son de fin, après la dernière frame de rendu) | `src/js/agent-pi.js:6649` : `flushAgentRenderThenSoundIdle();` (défini `:6447`) |
| Côté web distant, la fin de tour déclenche **déjà** une lecture à voix haute | `web/js/app.js:464` : `if (webSpeakEnabled && lastAssistantText) webSpeak(lastAssistantText);` |
| Côté agents d'arrière-plan, il existe aussi une fin de run | `src/js/agents-bus.js:2695-2696` (`agent_settled` = run totalement terminée) |

**Conclusion :** le chaînon « fin de réponse → suite » est disponible et **déjà utilisé**
(notification, son, et même lecture côté web). Ce qui manque n'est pas le signal, c'est
quelqu'un pour l'écouter.

---

## C. Lire à voix haute

### C.1 Lit-elle n'importe quelle réponse, y compris longue ? Sait-elle s'arrêter ? — **OUI**

| Élément | Preuve |
|---|---|
| Bouton sous **chaque** réponse de l'agent | `src/js/read-aloud.js:1099` (`attachReadAloud`), posé par `src/js/agent-pi.js:7885` et `src/js/super-agent.js:2180` |
| Libellés « Écouter » / « Arrêter » | `src/js/read-aloud.js:917-918` |
| Longue réponse : découpage en phrases puis enchaînement | `const chunks = splitSentences(textForSpeech(text));` — `src/js/read-aloud.js:653`, plafond `SPEECH_MAX_CHUNK = 180` (`:95`), enchaînement `speakIndex` (`:747-766`) |
| Voix locale longue : une synthèse d'avance, morceau par morceau | `src/js/local-voice.js:698-752` (commentaire `:701` « pas de trou audible entre deux phrases ») |
| Arrêt immédiat, à tout moment, y compris voix locale | `src/js/read-aloud.js:586-588` (`stopReading`), arrêt réel `:665-676` (`synth.cancel()` + `extraStops` `:669-673`) |
| Une seule lecture à la fois | `src/js/read-aloud.js:658` (`stopReading(); // une seule lecture a la fois`), règle écrite `:10-11` |
| Seule la **réponse finale** est lue (pas le travail interne) | `src/js/read-aloud.js:884` (`finalAnswerSections`) et `:904-913` (`messageTextOf`) |
| État « ça parle / c'est fini » publié | événement `pilot-read-aloud-state` — `src/js/read-aloud.js:121`, émis `:627-631` (`broadcastState`) |

- **Aucune lecture automatique côté desktop**, et c'est une règle écrite : `src/js/read-aloud.js:9` (« AUCUNE lecture automatique : rien ne part sans un clic »), rappelée à l'écran `index.html:1353` (« Rien n'est lu automatiquement »).
- **Qualité d'écoute réelle (voix, débit, trous) : non vérifié** — je n'ai écouté aucun son.

### C.2 Le réglage de la voix est-il unique et à un seul endroit ? — **OUI**

| Élément | Preuve |
|---|---|
| Un seul écran : Paramètres → onglet Assistant → « Lecture des réponses à voix haute » | `index.html:1337-1366`, section `#settings-section-read-aloud` (`index.html:1334`), commentaire « SEUL endroit ou se regle la voix » (`index.html:1332-1333`) |
| Une seule valeur de configuration écrite | `src/js/settings.js:2874` : `read_aloud_voice: ...` |
| Une seule lecture de cette valeur | `src/js/read-aloud.js:278-294` (`getPreferredVoiceName` / `applyVoicePreferenceFromConfig`) |
| Côté moteur, un seul champ | `src-tauri/src/lib.rs:702` (`read_aloud_voice: String`), valeur par défaut vide `:1221` |
| Choix de la voix locale par la **même** valeur réservée | `src/js/local-voice.js:41` (`LOCAL_VOICE_VALUE = "local:piper"`), `:173-188` |

Aucun autre endroit du produit n'écrit `read_aloud_voice` (recherche sur `src/js`,
`web/js`, `index.html`, `src-tauri/src` hors tests : seules les lignes ci-dessus).

### C.3 Le moteur local et les quatre voix sont-ils installés sur cette machine ? — **OUI pour l'application installée** (constaté sur le disque)

Dossier de données réel : `%APPDATA%\com.pilot.editor\voix-locale\` (l'identifiant vient de
l'application, pas d'une supposition).

**Moteur présent** — `C:\Users\pldistance\AppData\Roaming\com.pilot.editor\voix-locale\piper\` :

```
piper.exe                    498.0K
onnxruntime.dll                8.8M
onnxruntime_providers_shared.dll  21.9K
piper_phonemize.dll          397.5K
espeak-ng.dll                372.0K
libtashkeel_model.ort          9.8M
espeak-ng-data/  (dossier)
```

**Quatre voix françaises présentes** — `...\voix-locale\voix\` :

| Modèle | Genre / qualité (code) | Fichier sur le disque |
|---|---|---|
| `fr_FR-siwis-medium` | femme, medium (`src-tauri/src/tts_local.rs:76-82`) | `fr_FR-siwis-medium.onnx` 60.3M + `.onnx.json` 4.8K |
| `fr_FR-siwis-low` | femme, low (`:83-89`) | `fr_FR-siwis-low.onnx` 26.8M + `.onnx.json` 4.1K |
| `fr_FR-tom-medium` | homme, medium (`:90-96`) | `fr_FR-tom-medium.onnx` 60.6M + `.onnx.json` 4.8K |
| `fr_FR-gilles-low` | homme, low (`:97-103`) | `fr_FR-gilles-low.onnx` 60.2M + `.onnx.json` 4.1K |

La table du code déclare exactement ces quatre noms et ces quatre tailles —
`src-tauri/src/tts_local.rs:75-104` (voix par défaut `:109` `DEFAULT_MODEL_NAME = "fr_FR-siwis-medium"`).

**Nuance importante, vérifiée sur le disque** : la version **de développement**
(`%APPDATA%\com.pilot.editor.dev\voix-locale\`) n'a **ni dossier `piper\`, ni les quatre
voix** — seulement `fr_FR-siwis-medium.onnx` et `fr_FR-tom-medium.onnx`. Elle
**emprunte** le moteur de la version installée (aucune copie) : `src-tauri/src/tts_local.rs:207-255`
(dossiers candidats + réutilisation entre versions) et `:641-651` (`roots_for`). En
revanche les **modèles** sont cherchés dans le dossier de **sa propre** version
(`:370` `let model_file = model_path(root, voice.model);`), donc en version de dev
`gilles-low` et `siwis-low` seraient déclarées manquantes.

**Et le moteur n'est jamais téléchargé** : `src-tauri/src/tts_local.rs:315-333` (« il
manque le moteur de lecture (…), qui n'est jamais téléchargé automatiquement »). Le
téléchargement n'existe que pour le **modèle** : commandes `tts_local_download`,
`tts_local_cancel_download`, `tts_local_download_state` — `src-tauri/src/lib.rs:3670-3672`.

**Synthèse réelle (aucun son écouté) : non vérifié.**

---

## D. Le liant — le cœur du sujet

### D.1 Existe-t-il un enchaînement « fin de réponse → lecture » ? — **NON sur ordinateur, OUI sur le web distant**

- Ordinateur : le bouton de lecture est **posé**, jamais **cliqué par le programme** —
  `src/js/read-aloud.js:1099-1117` ne fait qu'ajouter le bouton, et la règle
  `src/js/read-aloud.js:9` interdit explicitement la lecture automatique.
- Web distant : **l'enchaînement existe déjà** — `web/js/app.js:464` (à `agent_end`) →
  `webSpeak` (`web/js/app.js:1068-1077`), allumé par le bouton 🔊 de l'écran immersif
  (`web/js/app.js:1096-1103`), **non mémorisé** (variable de session initialisée à `false`,
  `web/js/app.js:1066`).

### D.2 Peut-on interrompre une lecture en parlant ? Y a-t-il un mécanisme de coupure vocale ? — **NON**

- Recherche `getUserMedia` / `AudioContext` / `createAnalyser` / `echoCancellation` / `VAD`
  sur `src/js`, `web/js`, `src-tauri/src` (hors tests) : **0 occurrence** de chacune.
  Pilot n'ouvre donc jamais le micro autrement que par le moteur de dictée du navigateur.
- La **coupure** existe, mais seulement **manuelle** : `stopReading()` (`src/js/read-aloud.js:586`)
  ou le second clic sur le bouton (`:917-918`).
- `agent-stop-funnel.js` sait déjà accueillir un arrêt déclaré **manuel** —
  `src/js/agent-stop-funnel.js:55` (`MANUAL_STOP_MARKER = "R3-EXCEPTION-MANUEL"`) — mais
  **aucun déclencheur vocal** ne l'appelle.

### D.3 Mot d'appel, écoute permanente, détection de silence ? — **AUCUN DES TROIS**

Idem D.2 : aucune analyse du son dans le code. Les trois fichiers prévus par le document
de conception n'existent pas :
`src/js/conversation-loop.js`, `src/js/voice-activity.js`, `src/js/speech-to-text.js` →
`ls` : « No such file or directory » pour les trois.

### D.4 Ce qui manque, concrètement, pour ne jamais toucher le clavier

Dans l'ordre où on le rencontre à l'usage :

1. **Envoyer sans clavier** : la dictée remplit le champ et s'arrête là
   (`src/js/agent-pi.js:988`) ; l'envoi reste Entrée ou le bouton ▶️.
2. **Parler pendant que Pilot travaille** : impossible, la dictée est refusée en cours de
   tour (`src/js/agent-pi.js:925`).
3. **Entendre la réponse sans cliquer** : interdit par la règle écrite
   (`src/js/read-aloud.js:9`), alors que le web sait déjà le faire (`web/js/app.js:464`).
4. **Couper en parlant** : absent (D.2).
5. **Une oreille locale** : absente ; l'oreille actuelle est celle du navigateur, donc
   distante (`src/js/agent-pi.js:843-845`).
6. **Un arrêt franc visible** du mode vocal : rien de tel n'existe (aucun réglage, aucun état
   « micro ouvert » hors du voyant rouge du bouton pendant la dictée, `src/js/agent-pi.js:995`).

Il manque donc **deux automatismes** (envoi après dictée, lecture après réponse) **et une
boucle d'écoute**. Le premier automatisme est une ligne de code dans un `onend` qui existe
déjà ; le troisième est un module entier.

---

## E. Les documents existants

### E.1 Le document de conception — ce qu'il est

`docs/architecture-conversation-vocale-interruptible.md`, **551 lignes** (`wc -l`), daté
`2026-10-24` (`:8`), référencé dans `AGENTS.md`. Il ne contient aucune modification de
code (bandeau `:3-5`).

### E.2 Ce qu'il prévoit

- **Trois options** comparées (§2, lignes 85-197) : (1) relais manuel « appuyer pour
  parler » ; (2) **duplex par la mécanique de la parole** (micro ouvert + détecteur de
  voix + annulation d'écho), avec la recette d'interruption en quatre temps (baisser,
  baisser plus, céder, annuler — `:120-128`) ; (3) modèle temps réel « tout-en-un ».
- **Un découpage en 10 étapes** (§6, lignes 312-416), avec pour chacune « ce qu'on peut
  essayer tout de suite », et un total estimé **« 2 à 4 semaines »** (`:414`, annoncé
  comme estimation).
- **Des pièges nommés** (§7) : l'écho (`:421`), l'auto-interruption en boucle (`:439`), les
  faux déclenchements (`:447`), la dernière phrase perdue (`:454`), les trous entre
  phrases (`:460`), le décalage de la réflexion de l'agent (`:468`), le micro ouvert en
  permanence (`:476`), la fragilité du correctif micro et la licence GPL de Piper (`:483-493`).
- **Des fichiers à créer**, nommés (§8, lignes 494-518) — aucun n'existe (vérifié).

### E.3 Ce qu'il a déjà tranché (à ne pas rediscuter)

| Décision du document | Où | Tenue par le code ? |
|---|---|---|
| **Option 2 recommandée, option 1 comme socle et repli** | `:226-254` | — (rien n'est construit) |
| **Le modèle temps réel est écarté** (« incompatible avec le français ») | `:31-32`, `:191-196`, `:286` | — |
| **La voix reste un moteur séparé qui produit du son** (Piper compatible) | `:273-311` | **Oui** : synthèse WAV en base64 par un programme externe, `src-tauri/src/tts_local.rs:653-670`, lecture `src/js/local-voice.js:712-752` |
| **Le réglage de la voix reste UNIQUE**, le mode conversation doit le réutiliser | `:295-299`, rappel `:511` | **Oui aujourd'hui** (C.2) |
| **Aucun second journal de repli** | `:514-516` | **Oui** : un seul journal, `voix-locale.log` (`src-tauri/src/tts_local.rs:111`) |
| **Ce qui existe ne doit pas être refait** (13 lignes) | `:48-63` | Les éléments cités existent bien (voir A/C) |
| **Ce qui manque « et rien d'autre »** : écouter pendant que ça parle, décider que c'est une interruption, réorienter | `:65-71` | **Exact** (D.2/D.3) |
| **La dictée actuelle n'est pas locale** | `:73-83` | **Exact** (`src/js/agent-pi.js:843-845`) |

### E.4 Ce qu'il laisse ouvert

- **Six questions** (§9, lignes 520-530) : casque ou haut-parleurs ; le son peut-il sortir
  de la maison ; couper = arrêter l'agent ou le laisser finir ; Piper / MeloTTS / voix
  Windows ; version courte parlée + phrase d'attente ; faire ou non le test d'écho d'abord.
- **Six points qu'il déclare lui-même non vérifiés** (§10, lignes 532-549) : le délai de
  coupure (200-400 ms = estimation), l'annulation d'écho dans la fenêtre WebView2, la
  vitesse de Piper sous charge, la qualité de la reconnaissance en français, la mémoire
  vidéo réellement nécessaire, les durées des étapes.
- **Deux idées d'usage qui ne coûtent presque rien** (§4.1, lignes 256-271) : une phrase
  d'attente dès le lancement de l'agent, et lire une version courte plutôt qu'un rapport.

### E.5 Ce document est-il cohérent avec le code ? — **oui sur le fond, avec trois écarts**

1. **Ses numéros de ligne ont vieilli** (le code gagne, les fonctions citées existent bien) :
   - il cite `stopReading()` à `read-aloud.js:549` (§0, ligne `:24`, et tableau §1.1,
     ligne `:53`) ; le code est à **`src/js/read-aloud.js:586`** ;
   - il cite `pilot-read-aloud-state` « même fichier ligne 117 » (§0, ligne `:25`) ;
     le code est à **`:121`** ;
   - il cite la dictée à `agent-pi.js:845` ; le code est à **`:847-848`**.
   Aucune de ces trois fonctions n'a disparu : seul le repère a glissé.
2. **Une omission qui compte** : le document martèle la règle « aucune lecture automatique »
   comme une règle du projet (§6 étape 9, `:410-411`, et §1.1), et prévoit même de la tester.
   Or **le web distant lit déjà automatiquement** à la fin du tour (`web/js/app.js:464`).
   La règle est donc vraie **pour le desktop** (`src/js/read-aloud.js:9`) et **fausse pour
   le web**. Un test écrit tel quel (« aucune lecture automatique ») échouerait sur le
   web. À corriger dans le document, pas dans le code.
3. **Deux affirmations du document que le disque nuance** :
   - « voix locale Piper, **déjà installé** » (`:147`) : vrai **sur ce poste pour
     l'application installée** (`...\com.pilot.editor\voix-locale\piper\piper.exe` présent),
     mais le moteur n'est **jamais téléchargé** par Pilot (`src-tauri/src/tts_local.rs:315-333`) ;
     une machine neuve commence donc **sans** voix locale ;
   - « **le navigateur fournit l'annulation d'écho sans rien écrire** » (`:156`) :
     rien dans le dépôt ne s'en sert aujourd'hui (0 occurrence de `echoCancellation`),
     et **non vérifié** sur ce poste.

Rien, en revanche, de ce que le document décrit comme **existant** n'est inventé : les
dix points de son tableau §1.1 se retrouvent dans le code (preuves en A et C).

---

## F. La synthèse honnête

### F.1 Sur les trois briques

| Brique | État | Pourquoi (preuve) |
|---|---|---|
| **Écouter** | **À moitié faite** | Le chemin existe et remplit le champ (`src/js/agent-pi.js:923-999`), mais l'oreille est **distante** (`:843-845`), il faut **relancer à la main** (`:982-991`), elle est **coupée pendant le travail de l'agent** (`:925`), et il n'existe **aucun** moteur local (0 occurrence de `getUserMedia`) |
| **Répondre en texte** | **Prête** | Rien à faire : le signal de fin de tour est là et déjà consommé (`src/js/agent-pi.js:6623`, `:6633`, `:6640`, `:6649`) |
| **Lire à voix haute** | **Prête sur ordinateur** | Bouton sous chaque réponse, arrêt immédiat, découpage, réglage unique (`src/js/read-aloud.js:1099`, `:586`, `:653`, `index.html:1334`), et **quatre voix françaises sur le disque** de l'application installée |
| **Le liant (la boucle)** | **Absent** | Aucun enchaînement (`src/js/read-aloud.js:9`), aucune écoute pendant la parole, aucun mot d'appel : les trois fichiers prévus n'existent pas |

### F.2 Le plus petit premier pas utile

**Automatiser l'envoi à la fin de la dictée** (et, dans le même geste, lire à voix haute la
réponse finale à `agent_end` sur ordinateur).

Pourquoi celui-là :
- il ne crée **aucun moteur** : le chemin d'envoi et le lecteur existent déjà
  (`src/js/agent-pi.js:988` est le seul endroit à compléter ; `createSpeaker` /
  `stopReading` sont en place, `src/js/read-aloud.js:624`, `:586`) ;
- il supprime **les deux seuls gestes clavier restants** de la boucle « je parle → il
  répond → il me le lit » ;
- il a déjà un précédent **en production, côté web** (`web/js/app.js:464`) : ce n'est donc
  pas une invention, c'est un rapatriement.

**Une réserve à dire clairement** : la lecture automatique **contredit une règle écrite**
du projet (`src/js/read-aloud.js:9`, `index.html:1353`, `spec_read_aloud.md:8`). Ce n'est
donc pas à moi de la renverser : c'est une décision du propriétaire. Si l'on veut un
premier pas **sans toucher à cette règle**, il reste **l'envoi automatique après la
dictée**, qui suffit déjà à piloter Pilot à la voix et à lire les réponses d'un clic sur 🔊.

### F.3 Les obstacles réels (ce qui est mesuré, ce qui ne l'est pas)

| Obstacle | Réalité constatée | Mesuré ? |
|---|---|---|
| **La reconnaissance dépend du réseau** | « l'audio passe par le cloud Microsoft/Google » — `src/js/agent-pi.js:843-845` ; le code prévoit même que le service soit **absent** de la fenêtre (`:975-976`) | non mesuré |
| **Vie privée** | un projet sensible bloque la dictée (`src/js/agent-pi.js:926-929`) ; un micro ouvert en continu ne pourrait pas rester compatible avec cette règle | — |
| **Qualité du français** | aucun réglage de langue autre que `fr-FR` codé en dur (`src/js/agent-pi.js:847`) ; les noms de fichiers et de fonctions sont le point faible attendu (le document le dit aussi, `:376-382`) | **non mesuré** |
| **Temps de réaction** | le délai de coupure du document (200-400 ms) est une **estimation** qu'il déclare lui-même non mesurée (`:534-536`) | non mesuré |
| **Matériel** | rien n'est demandé à la carte graphique aujourd'hui : la voix locale est un programme externe sur le processeur (`src-tauri/src/tts_local.rs:653-670`) | — |
| **Poids sur le disque** | quatre modèles déjà présents, tailles affichées : 60.3M + 60.6M + 60.2M + 26.8M, plus le moteur (≈ 19 M de bibliothèques) | mesuré sur le disque |
| **Le moteur n'est pas installable tout seul** | « jamais téléchargé automatiquement » (`src-tauri/src/tts_local.rs:315-333`) : sur une machine neuve, pas de voix locale sans dépôt manuel du dossier `piper` | constat de code |
| **Écho** | aucune annulation d'écho n'est utilisée par Pilot (0 occurrence) | **non vérifié** |
| **Dépendance de maintenance** | le correctif micro de la fenêtre est à réappliquer à chaque montée de version (`Cargo.toml:16-18`) | constat de code |
| **Pas d'oreille locale dans le dépôt** | aucun moteur voix → texte embarqué : `speech-to-text.js` n'existe pas, et aucune dépendance de reconnaissance n'apparaît | constat de code |

---

## Ce que je n'ai pas pu prouver (à ne pas lire comme acquis)

1. **Que la dictée fonctionne sur ce poste** — je n'ai rien lancé, aucun micro ouvert.
2. **Que le service Web Speech réponde dans la fenêtre WebView2 de ce poste** — le code
   prévoit explicitement qu'il puisse manquer (`src/js/agent-pi.js:975-976`).
3. **Quelles voix du système sont installées** ici (donc si la lecture marche sans Piper).
4. **Que la voix locale sonne bien** : les fichiers sont là, je n'ai écouté aucun son.
5. **La qualité de reconnaissance en français**, le **temps de réaction** réel, la tenue de
   l'**annulation d'écho** : non mesurés, et non mesurables sans écran et sans micro.
6. **Le comportement du web distant en vrai** (dictée + lecture automatique via HTTPS) :
   lu dans le code, jamais exécuté.
7. **Les durées du document** (« 2 à 4 semaines ») : estimation de son auteur, pas une mesure.

---

*Fin du rapport. Constat seulement : aucun fichier de code touché, aucun commit, rien
installé, rien téléchargé, aucun modèle de voix modifié, aucun autre rapport supprimé.*
