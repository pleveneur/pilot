# RAPPORT — « En mode vocal, à un moment donné, le micro est coupé »

Défaut signalé par le propriétaire. Deux temps : **CAUSE**, puis **CORRECTION**.

---

## 0. Le symptôme, mot pour mot

> « En mode vocal, à un moment donné, le micro est coupé. Du coup quand je parle,
> ça détecte bien ma voix, mais ça dit "la dictée vocale n'a pas fonctionné…".
> J'active le micro (via le bouton à côté de la zone de saisie) et quand je parle
> ensuite ça refonctionne, mais le micro se désactive ensuite. Au début, ça
> répond bien sur un bon début de discussion. Ça arrive à un moment donné, je ne
> sais pas pourquoi. »

Lecture utile du symptôme : **le son est toujours capté** (l'enveloppe suit la
voix) mais **la reconnaissance ne produit plus rien**. Ce sont deux choses
distinctes dans le code :

| Ce qui marche encore | Ce qui est mort |
|---|---|
| le **micro de MESURE** (`vocal-mic.js` : flux, analyseur, niveau) | la **session de DICTÉE** (`SpeechRecognition`, dans `startVoiceInput`) |

La panne est donc du côté de la **session de dictée** — et elle est **réarmée par
rien du tout** après un certain point. Ce rapport établit lequel.

---

## 1. CAUSE

### 1.1 Ce qui termine la session de dictée en cours de discussion

Une seule chose, et c'est **normal** : le moteur de reconnaissance du système
(WebView2 / Edge) **termine lui-même la session** quand il estime la phrase
finie, et en particulier quand **on ne parle pas** pendant quelques secondes. La
fin arrive alors par `rec.onerror` avec `error = "no-speech"` (ou `"aborted"`),
puis par `rec.onend`.

- `src/js/super-agent.js:3938` — `rec.onerror = (ev) => { … voiceActive = false; voiceRec = null; … }`
- `src/js/super-agent.js:3958` — `rec.onend = () => { … }` (fin de session)

Aucun autre déclencheur ne coupe la dictée dans une conversation qui marche :
pendant la lecture de Pilot et pendant son travail c'est **voulu**
(`decideVocalDictation`, règles 3 et 4), et après ces états elle se réarme
(règle 8, 350 ms au repos / 600 ms après la lecture).

**Conclusion 1.1 : la session meurt de mort « normale » (silence), c'est-à-dire
plusieurs fois par conversation.** Ce n'est pas la panne en soi.

### 1.2 Pourquoi, une fois terminée, elle n'est PAS relancée

`rec.onend` réapplique l'état (`src/js/super-agent.js:3986` →
`applyVocalState()` → `vocalSyncConversation()`), qui réarmerait la dictée 350 ms
plus tard — **sauf si un verrou est posé**. Un seul verrou est en jeu ici : le
**plafond des sessions vides**.

La chaîne exacte :

1. `rec.onend` appelle `vocalNoteEmptySession(fin, { erreurAffichee, arretDemande })`
   — `src/js/super-agent.js:3987`.
2. Ce compteur ne compte pas lui-même : il demande à
   `isSilentEmptyVoiceEnd(fin, contexte)` (`src/js/voice-auto-send.js:120`) si la
   fin « alimente » le plafond, puis pose le chiffre avec
   `noteEmptyVocalSession` (`src/js/vocal-conversation.js`, seuil
   `VOCAL_EMPTY_SESSION_LIMIT = 3` en `30 000 ms`).
3. Or `isSilentEmptyVoiceEnd` rend **`true` pour TOUTE fin vide sans erreur
   affichée et sans arrêt demandé** — donc **aussi pour une fin de silence
   parfaitement normale** (`no-speech`, ou fin normale sans texte). C'est
   exactement ce que le dernier correctif (« garde 2 »,
   `docs/rapports/RAPPORT-vocal-deux-gardes-finales.md`, commit `2fc52e0`) a
   introduit pour rendre le plafond *atteignable*.
4. Trois fins vides en moins de 30 s ⇒ `vocalSessionsVides` atteint 3 ⇒
   `vocalDicteeSuspendue = true` (`src/js/super-agent.js:4711`).
5. La décision pure refuse alors l'armement **définitivement** :
   `src/js/vocal-conversation.js:287-289` (règle 5c) →
   `{ action: HOLD, raison: "sessions-vides" }`, et **rien ne lève ce verrou
   avec le temps** : seuls un geste 🎙️ (`src/js/super-agent.js:3861-3862`) ou
   une nouvelle entrée dans le mode le lèvent.

**Et trois fins vides en 30 s sont le régime NORMAL d'une conversation dans cet
écran**, pas une anomalie : la dictée se réarme 350 ms après chaque fin, et le
moteur referme la session à chaque plage de silence. Un utilisateur qui réfléchit
ou qui écoute la réponse de Pilot produit ces trois fins en quelques dizaines de
secondes. Le verrou se pose donc **tôt** dans une discussion (« ça répond bien
sur un bon début de discussion »), puis ne se relève plus.

**Conclusion 1.2 : la dictée n'est pas relancée parce qu'un compteur de sécurité
compte les SILENCES NORMAUX comme des pannes, et que le verrou qu'il pose est
définitif.** C'est le défaut : une fin normale a été traitée comme une panne.

### 1.3 Pourquoi le message « la dictée vocale n'a pas fonctionné » s'affiche

Le verrou est traduit en une phrase de la ligne d'état :

- `src/js/super-agent.js:4597` — `if (raison === "sessions-vides") return VOCAL_MESSAGE_DICTEE_ECHEC;`
- `src/js/vocal-conversation.js:200` — `VOCAL_MESSAGE_DICTEE_ECHEC = "La dictée n'a pas fonctionné : écrivez votre demande."`

Donc : **du son est parfaitement capté** (le micro de mesure, lui, n'est pas
concerné), et l'écran annonce une « dictée qui n'a pas fonctionné » alors que la
seule chose qui s'est produite est **un silence** — c'est-à-dire une fin normale
comptée à tort comme un échec. **Conclusion 1.3 : oui, une fin normale était
traitée comme une panne**, à deux titres : elle alimentait le compteur, et le
compteur parle le langage de l'échec.

### 1.4 Pourquoi le bouton de la zone de saisie relance, mais seulement un temps

`toggleVoiceInput` est le **seul** endroit qui efface les deux verrous avant de
démarrer : `vocalSessionsVides = []` et `vocalDicteeSuspendue = false`
(`src/js/super-agent.js:3861-3862`), puis `startVoiceInput()`. C'est la
différence exacte avec le chemin automatique, qui ne les efface jamais.

Ce que le bouton **ne change pas**, c'est le **comptage** : les trois silences
suivants sont recomptés, le plafond se repose, et l'écoute remeurt. D'où le
verdict du propriétaire : « ça refonctionne, mais le micro se désactive ensuite ».
**Conclusion 1.4 : le geste répare l'état, pas la cause.**

### 1.5 Ce qui n'est PAS la cause (vérifié)

- Le **micro de mesure** n'est pas en cause : `vocal-mic.js` n'est pas touché par
  ce défaut, et l'enveloppe continue de suivre la voix (le propriétaire le
  constate lui-même).
- Le **projet sensible** n'est pas en cause : il n'empêche l'armement que si le
  projet est marqué 🔒 ou non vérifié, et alors l'écran dit l'autre phrase
  (`VOCAL_MESSAGE_SENSIBILITE_INCONNUE`).
- La **permission micro** n'est pas en cause : un refus produit `not-allowed` →
  phrase « Micro refusé… », une phrase différente.
- L'**envoi sur silence** n'est pas en cause : il n'annule l'armement d'aucune
  façon (`decideVocalSilenceSend` ne décide que d'un envoi).

---

## 2. CORRECTION

Règle du propriétaire, appliquée telle quelle :

> En mode Vocal, tant qu'il est en mode Vocal, la dictée doit se réarmer seule
> après **chaque** fin de session — y compris après une réponse lue, après un
> silence, après une demande envoyée. Rien ne doit la laisser morte en silence.

### 2.1 Une fin normale n'alimente plus le plafond (durée mesurée)

Le plafond n'existe que pour **une** chose : arrêter une **boucle** où le moteur
rend la main **instantanément** sans rien transcrire (micro rouvert sans arrêt,
écran muet). Une session qui a **réellement écouté plusieurs secondes** puis s'est
terminée en silence n'est **pas** cette boucle : c'est une pause.

- `src/js/voice-auto-send.js` : nouvelle constante
  `VOICE_EMPTY_SESSION_INSTANT_MS = 1000` (raison **mesurée** : un moteur qui
  rend la main en moins d'une seconde n'a pas pu écouter ; les fins de silence
  des moteurs de reconnaissance arrivent, elles, après plusieurs secondes).
- `isSilentEmptyVoiceEnd(fin, contexte)` : si `contexte.dureeMs` est fourni et
  **≥ ce seuil**, la fin **n'alimente pas** le plafond (c'est une fin normale).
  Durée absente ou plus courte : comportement inchangé (une fin instantanée
  compte, comme avant) — aucune régression pour les appelants existants.
- `src/js/super-agent.js` : la durée est **mesurée** à la seule fin d'écoute
  (`debutSession` posé au démarrage de la session, `dureeMs` calculé dans
  `rec.onend`) et transmise via `vocalNoteEmptySession`.

### 2.2 Une conversation qui écoute vraiment remet le compteur à zéro

`vocalNoteEmptySession` (`src/js/super-agent.js`) efface l'historique des fins
instantanées dès qu'une session a **réellement tenu le micro** (`dureeMs` ≥
seuil) : deux retours instantanés séparés par une vraie conversation ne
s'additionnent plus pour suspendre l'écoute.

### 2.3 Ce qui reste VRAI (inchangé, et testé)

- **Une vraie panne reste une vraie panne** : permission refusée, micro occupé,
  périphérique absent, réseau — chacune garde **sa** phrase et **un seul**
  message, et ne boucle pas (le verrou d'erreur, règle 6, est intact).
- **La boucle instantanée est toujours arrêtée** : trois retours instantanés en
  30 s suspendent l'armement automatique, avec la phrase existante, et le geste
  🎙️ rétablit (comportement inchangé, seuils inchangés).
- **Hors du mode Vocal, rien ne change** : `vocalNoteEmptySession` sort
  immédiatement si l'écran n'est pas affiché ; l'onglet agent π n'est pas
  concerné.
- **Aucun réarmement frénétique** : les temporisations existantes sont
  conservées (350 ms au repos, 600 ms après une lecture), une seule minuterie,
  décision réévaluée à l'échéance, `startVoiceInput` idempotent (jamais deux
  sessions).
- **Le module micro n'est pas touché** : `vocal-mic.js` reste la seule voie du
  niveau sonore ; aucune API audio n'est ajoutée dans `super-agent.js`.

### 2.4 Décisions tranchées (aucune question posée)

1. **Le silence n'est pas un échec** — il ne peut plus produire ni verrou ni
   phrase d'échec. C'est la lecture directe de la règle du propriétaire.
2. **Le seuil de 1 s n'est pas un réglage** : c'est une mesure interne, pas une
   préférence utilisateur ; aucun curseur, aucun champ de configuration.
3. **La boucle instantanée garde son verrou** (elle n'est pas un silence) : la
   règle « un vrai échec reste un vrai échec, et ne boucle pas à l'infini » couvre
   ce cas, et le geste 🎙️ reste le chemin de reprise.

---

## 3. Tests ajoutés / adaptés

Nouveau fichier `src/js/dictee-vocale-se-rearme.test.js` (purs + ancrages de
source) qui verrouille :

- **réarmement après une fin normale** : `isSilentEmptyVoiceEnd` ne compte pas une
  fin de silence d'une durée réelle, le plafond n'est pas atteint, la décision
  rend `armer` ;
- **aucun message pour une fin normale** : `vocalDictationMessage("no-speech")`
  et `("aborted")` restent vides, et la ligne d'état du repos ne peut pas
  afficher la phrase d'échec ;
- **un seul message par vraie panne** : chaque code d'erreur réel rend **une**
  phrase, et la ligne d'état n'a qu'un point d'écriture ;
- **pas de réarmement hors du mode Vocal** : décision `hors-mode`, et le compteur
  sort immédiatement hors de l'écran ;
- **pas de double session** : `startVoiceInput` idempotent, décision
  « déjà ouverte » = `HOLD`, une seule minuterie d'armement ;
- **la boucle instantanée existe encore** (non-régression du correctif
  précédent) : trois fins instantanées vides en 30 s suspendent.

Les fichiers `vocal-correctifs-revue.test.js` et `vocal-deux-gardes-finales.test.js`
sont laissés **intacts** (leurs assertions restent vraies : seuils, verrou,
levée par geste, une seule écriture du verrou).

Aucun chiffre de test attendu n'est figé : le compte est **relevé** à l'exécution
(rapport JSON Vitest dans un fichier de sortie neuf).

### Résultat de l'exécution (relevé, non figé)

| Vérification | Résultat |
|---|---|
| `npx vitest run` (suite complète) | **réussi** — 227 fichiers, 4204 tests, 0 échec (relevé du rapport JSON de la session) |
| Les 4 fichiers concernés (ciblés) | **réussis** — dont le nouveau `dictee-vocale-se-rearme.test.js` |
| `npx vite build` | **réussi** (imports et syntaxe de l'écran validés) |
| Rust | **non modifié** — aucune compilation nécessaire |

---

## 4. Documentation mise à jour

- `spec_modes_ecran_vocal.md` §6bis : le plafond ne compte plus les silences
  normaux (durée mesurée), et dit ce qui reste un vrai échec.
- `spec_voice_input.md` : la même règle, vue de la dictée.
- `help/overview.md` (bloc d'aide intégrée de l'écran Vocal) + régénération de
  `help/handbook.md` par `npm run build:handbook`.
