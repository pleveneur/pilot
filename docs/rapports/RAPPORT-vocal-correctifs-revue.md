# Correctifs de revue — écran Vocal (commit `f81897e`)

Date : 2026-10-26 · Périmètre : écran Vocal uniquement. **Aucun mécanisme
nouveau** : la lecture garde `read-aloud.js`, la dictée garde
`vocal-conversation.js` + `voice-auto-send.js`, le micro garde `vocal-mic.js`
(**non modifié**), et l'écran garde son apparence (aucun bouton, aucun réglage).

## 1. Les deux défauts constatés

### Défaut 1 — un repli de voix n'était pas « Pilot parle »

`src/js/read-aloud.js` émet l'état de lecture `local-fallback` (voix locale
choisie mais indisponible) et `system-fallback` (voix du système en repli)
lignes 839 et 864. `src/js/super-agent.js` ne considérait « Pilot parle » que
sur l'état exactement égal à `"speaking"` (ligne 4561) :

```js
vocalSpeaking = etat === "speaking";
```

Conséquence pendant tout un repli : `vocalSpeaking` restait `false`, donc

- la **dictée s'armait pendant la lecture** (`pilotParle: vocalSpeaking === true`
  à `false`) — le micro transcrivait la voix de Pilot, la demande partait, Pilot
  répondait, se lisait, réarmait… **boucle** ;
- la **coupure de parole n'était plus armée** (`vocalMic.setSpeaking(false)`) :
  parler par-dessus un repli ne faisait plus taire Pilot ;
- `exitVocal()` ne coupait pas la lecture d'un repli en quittant l'écran.

### Défaut 2 — « dictée indisponible » existait mais n'était branché nulle part

`src/js/vocal-conversation.js` décide déjà `raison: "sans-transcription"`
(règle 7) et possède la phrase `VOCAL_MESSAGE_SANS_DICTEE`. Mais la ligne d'état
de `applyVocalState` ne regardait que `vocalMicFerme` :

```js
const texte = state === "idle" && vocalMicFerme ? vocalMicFerme : vocalStatusText(state);
```

Résultat : quand `transcription === false` (poste sans reconnaissance vocale),
l'écran affichait « Je vous écoute. » — une promesse fausse, rien ne s'armait et
rien ne le disait.

## 2. Corrections (une décision, un branchement)

| Correction | Où (source unique) |
|---|---|
| **C1** « Pilot parle » = une seule fonction pure `isReadAloudSpeaking(state)`, vraie pour `speaking`, `local-fallback` et `system-fallback` (et pour eux seuls) | `read-aloud.js` (nouvelle), appelée **une fois** par `super-agent.js` |
| **C2** la ligne d'état dit la phrase prévue quand la décision dit « pas de transcription » | `super-agent.js`, `vocalStatusLine()` appelée par `applyVocalState` (le point unique existant) |
| **C3** plafond des sessions vides : ≥ 3 fins d'écoute sans texte en moins de 30 s ⇒ plus d'armement automatique **jusqu'au prochain geste** (bouton 🎙️ ou nouvelle entrée dans le mode) | décision pure `noteEmptyVocalSession()` + règle `sessions-vides` dans `vocal-conversation.js` ; verrou posé dans `super-agent.js` |

### C1 — pourquoi une fonction, et pas un `||` dans l'appelant

`vocalSpeaking` est la **seule** source de « Pilot parle » de l'écran : elle
alimente à la fois l'armement de la dictée (`pilotParle`), la garde du micro
(`vocalSyncMicSpeaking` → `setSpeaking`), la coupure (`vocalInterruptTarget`) et
la sortie du mode (`exitVocal` → `stopReading`). Corriger un seul de ces quatre
chemins laissait les trois autres faux. La liste des états « Pilot parle » est
donc écrite **une fois**, dans le module qui émet ces états, et l'appelant ne
compare plus de chaîne. Aucun second mécanisme, aucune seconde décision.

Effets, sans une ligne de plus :

- armement de la dictée : `pilotParle: vocalSpeaking === true` devient vrai
  pendant un repli ⇒ **désarmement** (plus d'auto-transcription) ;
- coupure de parole : `vocalMic.setSpeaking(true)` ⇒ **garde réarmée** ; une voix
  continue par-dessus un repli fait taire Pilot comme pendant une lecture
  normale (mêmes seuils, mêmes 200 ms, `vocal-mic.js` intact) ;
- sortie du mode : une lecture en repli est arrêtée comme les autres ;
- retour au repos : la séquence `speaking → local-fallback → ended` ne fait plus
  croire à une « fin de lecture » au passage en repli (`parlait && !vocalSpeaking`
  n'est vrai qu'à la vraie fin) : le réarmement après lecture garde sa marge de
  600 ms et ne part pas au milieu de la réponse.

### C2 — pourquoi au point unique existant

`applyVocalState` reste le **seul** endroit qui écrit la ligne d'état. Il appelle
désormais `vocalStatusLine(state)`, qui rend : la phrase de l'état visuel, ou —
**au repos seulement** — le message du micro fermé (inchangé), sinon la phrase
que la décision pure a prévue pour la raison courante :

- `sans-transcription` ⇒ `VOCAL_MESSAGE_SANS_DICTEE`
  (« La dictée n'est pas disponible sur ce poste : écrivez votre demande. ») ;
- `sessions-vides` ⇒ `VOCAL_MESSAGE_DICTEE_ECHEC`
  (« La dictée n'a pas fonctionné : écrivez votre demande. »), phrase qui
  existait déjà pour la panne de dictée — **aucune phrase nouvelle** ;
- toute autre raison ⇒ les trois phrases de l'écran, inchangées.

Aucune seconde source : la fonction interroge `decideVocalDictation` (la même
décision pure que `vocalSyncConversation`), elle ne réimplémente aucune règle.
La parole et la réflexion gardent la priorité (la ligne d'état d'un état non
`idle` n'est jamais remplacée).

### C3 — plafond des sessions vides

Le cycle redouté : le moteur rend la main sans rien transcrire (`no-speech`),
`onend` réapplique l'état, la dictée se réarme 350 ms plus tard, et cela
indéfiniment — micro rouvert en boucle, permission redemandée, rien à l'écran.

- `noteEmptyVocalSession(sessions, maintenant)` (pure) : garde les fins d'écoute
  **vides** de la fenêtre de 30 s, ajoute celle qui vient d'arriver, et rend
  `{ sessions, suspendu }` avec `suspendu = (nombre ≥ 3)`.
- La règle `sessions-vides` (nouvelle, placée juste après `arret-manuel`, avant
  `erreur`) rend `HOLD` : rien ne s'arme, et un armement déjà programmé est
  annulé (`plan.couper`), sans fermer une dictée ouverte par un geste.
- Le verrou est **mémorisé** (`vocalDicteeSuspendue`) : il ne se lève pas par
  simple écoulement du temps — seule une action de l'utilisateur le lève, comme
  demandé : **clic sur 🎙️** (`toggleVoiceInput`, branche de démarrage) ou
  **nouvelle entrée dans le mode** (`enterVocal`). Les deux remettent aussi
  l'historique à zéro.
- Comptage **réservé au mode Vocal** (`vocalOverlay` ouvert) et aux fins
  **normales** (`applyVoiceEnd` → `VOICE_END_EMPTY`, donc jamais une erreur,
  jamais un arrêt manuel, jamais une reprise en main) : hors de l'écran Vocal,
  aucun comportement ne change.

## 3. Branchements (qui appelle quoi, une seule fois)

| Symbole | Source | Appelé par |
|---|---|---|
| `isReadAloudSpeaking` | `read-aloud.js` | `onVocalReadAloudState` (unique affectation de `vocalSpeaking`) |
| `noteEmptyVocalSession` | `vocal-conversation.js` | `vocalNoteEmptySession` (depuis `rec.onend`, après `applyVoiceEnd`) |
| règle `sessions-vides` | `decideVocalDictation` | `vocalConversationState()` (état unique) |
| `vocalStatusLine` | `super-agent.js` | `applyVocalState` (point unique existant) |
| `VOICE_END_EMPTY` | `voice-auto-send.js` | `vocalNoteEmptySession` (aucune seconde détection du vide) |

## 4. Documentation réalignée

- `spec_modes_ecran_vocal.md` § 5 : le micro de **mesure** se demande au premier
  geste, mais la **dictée** (seconde capture) s'ouvre pendant tout le mode, sauf
  pendant la lecture et la réflexion, et se referme aux trois sorties.
- `spec_modes_ecran_vocal.md` § 6.1 : un repli de voix est « Pilot parle ».
- `spec_modes_ecran_vocal.md` § 6bis : plafond des sessions vides + phrase
  « dictée indisponible » réellement affichée.
- `README.md` : mêmes vérités, en langage utilisateur.
- `help/overview.md` (bloc `HELP:modes-ecran`, source du handbook) : la phrase
  « micro demandé au premier geste, jamais à l'ouverture » devient vraie pour le
  seul micro de mesure ; le handbook est **régénéré**.

## 5. Tests et vérifications

### Nouveau verrou

`src/js/vocal-correctifs-revue.test.js` (20 tests) — lève si l'un des trois
defauts revient :

| Bloc | Ce qui est tenu |
|---|---|
| 1 | `isReadAloudSpeaking` est **vraie pour les trois états** (lecture + deux replis) et **fausse pour tout le reste** (aucun piège de vérité : `null`, `0`, `{}`, `""`…) ; le bouton de la bulle juge déjà comme elle (contre-épreuve de cohérence) |
| 2 | une **seule** affectation depuis l'événement (`vocalSpeaking = isReadAloudSpeaking(etat)`), et les seules affectations du module sont déclaration / événement / remise à zéro ; aucune comparaison `=== "speaking"` ne subsiste ; les **quatre** chemins (armement, garde du micro, coupure, sortie) lisent bien `vocalSpeaking` |
| 3 | `sans-transcription` **désarme** la dictée et sa phrase est celle qui existe déjà ; `vocalStatusLine` l'affiche au repos ; la parole et la réflexion gardent la priorité |
| 4 | plafond : 2 fins vides = rien, la 3ᵉ suspend ; fenêtre de 30 s ; **pureté** (entrée jamais modifiée) ; priorité (après l'arrêt manuel, avant l'erreur) ; annulation d'un armement en attente sans fermer une dictée ouverte ; comptage réservé au mode et aux fins **vides normales** ; levée par le **geste** 🎙️ et par l'entrée dans le mode, jamais par le temps ; aucune horloge ni stockage dans le module de décision |
| 5 | la spec, le README et l'aide embarquée disent la même chose que le code |

Le test compte sur le source **commentaires neutralisés** (`neutraliserSource`) dès
qu'il s'agit de compter une occurrence : une prose qui nomme la règle ne peut pas
satisfaire le verrou (quality-gate 3.4).

### Trois verrous existants réécrits (et pourquoi)

Trois tests décrivaient le code **d'avant** le correctif ; ils ne pouvaient pas
rester verts sans interdire la correction. Chacun garde son intention, seule la
forme vérifiée change :

| Fichier | Avant | Après | Pourquoi |
|---|---|---|---|
| `ecran-vocal-lot4a.test.js` | `vocalSpeaking = etat === "speaking"` | `vocalSpeaking = isReadAloudSpeaking(etat)` **et** absence de l'ancienne écriture | c'est précisément le défaut 1 ; le test le **verrouillait** |
| `ecran-vocal-lot3.test.js` | `state === "idle" && vocalMicFerme` dans `applyVocalState` | même priorité, vérifiée dans `vocalStatusLine` (le point d'écriture reste `applyVocalState`) | la ligne ne peut plus promettre « Je vous écoute » sans transcription |
| `ecran-vocal-nu.test.js` | la même expression ternaire | `const texte = vocalStatusLine(state);` + même priorité dans `vocalStatusLine` | même raison ; l'interdiction de tout texte de conversation est conservée |
| `envoi-auto-fin-dictee.test.js` | import littéral `{ applyVoiceEnd }` | import nommé **contenant** `applyVoiceEnd` | `super-agent.js` importe aussi `VOICE_END_EMPTY` (une seule détection du vide) ; le module reste le même |

Aucun test n'a été supprimé, aucun n'a été affaibli sur son intention : ceux du
lôt 3 et de l'écran nu continuent d'interdire la conversation dans la ligne
d'état, et celui du lôt 4a continue d'exiger que la garde du micro soit armée
par l'état de lecture.

### Résultats

| Commande | Résultat |
|---|---|
| `npx vitest run src/js/vocal-correctifs-revue.test.js` | **20 passés** |
| `npm test` | **205 fichiers, 3728 tests — tous verts** |
| `npm run build:handbook` | handbook régénéré (46 blocs, `help/handbook.md`) |
| `npm run build` | build front OK (avertissements de découpage de chunks préexistants, sans rapport) |
| `cargo test --workspace` | **non lancé, et sans objet** : aucun fichier Rust touché |

## 6. Ce qui n'a pas été fait (et pourquoi)

- **Aucun réglage, aucun bouton, aucun écran nouveau.** Les trois corrections
  réutilisent des phrases, des décisions et des points d'écriture qui existaient.
- **`vocal-mic.js` n'est pas modifié** : la garde anti-auto-coupure garde ses
  seuils et son calibrage. Le correctif 1 ne fait que lui fournir la bonne valeur
  de « Pilot parle ».
- **Le plafond ne coupe pas une dictée ouverte par un geste** : il empêche
  l'armement *automatique* ; si l'utilisateur a cliqué 🎙️, sa dictée reste
  ouverte (et ce clic a de toute façon remis le compteur à zéro).
