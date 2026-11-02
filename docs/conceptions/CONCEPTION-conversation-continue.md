# Conception — la conversation continue du mode Vocal

> **Statut : conception écrite, aucun code écrit.** Ce document est le seul livrable
> de la mission. Il décrit *ce qui existe déjà*, *ce qui manque*, *comment le faire
> en réutilisant l'existant*, et *découpe le travail en lots livrables séparément*.
>
> Toutes les affirmations sont appuyées sur le code réel, avec `fichier:ligne`.
> Les numéros de ligne sont ceux de l'arbre actuel ; ils peuvent glisser de
> quelques lignes après une modification, la fonction ou l'ancre nommée à côté
> reste juste.

---

## 0. En dix lignes

- Aujourd'hui, en mode Vocal : Pilot lit sa réponse, puis se tait et attend. Pour
  reprendre la parole, il faut **appuyer sur le micro** (`toggleVoiceInput`).
- Le propriétaire a tranché le 2026-10-28 : **couper en parlant**, **micro ouvert
  dès l'entrée**, **écran nu**. Les deux premières ne sont pas encore tenues
  ensemble : on peut couper en parlant (lot 4a/4b livrés), mais après la coupure
  **personne n'écoute les mots qui suivent**.
- La conversation continue tient en **une seule idée** : la dictée déjà écrite
  (`toggleVoiceInput`, `voice-auto-send.js`) est **armée toute seule** aux bons
  moments, et **désarmée** pendant que Pilot parle ou réfléchit.
- Aucun second lecteur, aucun second mécanisme d'arrêt, aucun nouveau réglage,
  aucun nouveau bouton, aucun nouvel écran.
- Un seul module **pur** nouveau (`vocal-conversation.js`) décide *quand* armer.
  Tout le reste est du branchement sur de l'existant.
- 5 lots, chacun vérifiable seul et laissant le projet vert, + 1 lot optionnel
  (dictée locale) laissé à la décision du propriétaire.
- Trois questions fermées à la fin, chacune avec une recommandation.

---

## 1. Périmètre : ce qui ne bouge pas

| Élément | Décision | Preuve que rien ne change |
|---|---|---|
| Contenu de l'écran, place des éléments | ne pas rouvrir | `buildVocalOverlay` `src/js/super-agent.js:3997` |
| Le logo-bouton des trois modes | ne pas rouvrir | `body.pilot-vocal-active #mode-logo` `src/css/style.css:2086`, posé par `super-agent.js:4150` |
| La ligne d'état unique et ses quatre phrases | ne pas rouvrir | `vocalStatusText` `src/js/super-agent.js:510` |
| Le lecteur de réponse | ne pas rouvrir | un seul lecteur : `createSpeaker` `read-aloud.js:896` |
| L'arrêt de la lecture | ne pas rouvrir | `stopReading()` `read-aloud.js:594`, seule voie |
| Les réglages | **aucun nouveau** | `spec_read_aloud.md` §2, clé unique `read_aloud_voice` |
| Le mode Vocal hors conversation | inchangé | `screen-mode.js`, trois modes, un bouton |

Ce document **ajoute** une chose et une seule : entre deux tours, l'oreille reste
tendue sans geste.

---

## 2. Les trois décisions fermes, traduites en règles

| Décision du propriétaire (2026-10-28) | Règle de code |
|---|---|
| Parler pendant la lecture **ou** la réflexion coupe et prend la main | déjà livré : `vocalInterruptTarget` `:496`, `vocalBargeIn` `:4095` |
| Le micro s'ouvre **dès l'entrée** dans le mode | **pas encore** : aujourd'hui la permission part au premier geste (`enterVocal` `:4162-4185`, verrouillé par un test) → **lot 1** |
| L'écran est nu, aucun échange affiché | déjà livré : `spec_modes_ecran_vocal.md` §2, aucun historique dans l'écran |

La troisième règle a une conséquence directe sur cette conception : **ce que Pilot
capte ne peut pas être montré**. Donc tout ce qui compte doit être dit par la
**ligne d'état existante** ou par le **trait de niveau existant**, jamais par un
nouvel élément.

---

## 3. Où en est le code, exactement

### 3.1 Ce qui existe et qu'on réutilise tel quel

| Besoin | Ce qui existe déjà | Où |
|---|---|---|
| Ouvrir/fermer le micro de l'écran | `createVocalMic` (`demander`, `fermer`, `estActif`) | `src/js/vocal-mic.js:405` |
| Savoir si Pilot parle | événement `pilot-read-aloud-state` | `read-aloud.js:124`, écouté en `super-agent.js:4332` |
| Couper la lecture | `stopReading()` | `read-aloud.js:594` |
| Couper la réflexion | `stopSuperAgentTurn()` (chemin du bouton Stop) | `super-agent.js:4377`, appelé en `:4120` |
| Dictée vocale (voix → texte) | `toggleVoiceInput` | `super-agent.js:3537` |
| Arrêter la dictée | `stopVoiceInput` | `super-agent.js:3516` |
| Envoyer tout seul à la fin d'une dictée | `applyVoiceEnd` / `decideVoiceAutoSend` | `src/js/voice-auto-send.js:74` et `:108` |
| Écrire la demande dans le tour | `send()` | `super-agent.js:4470-4520` |
| Lire la réponse tout seul | `autoReadVocalReply` (clic sur le bouton existant) | `super-agent.js:4276`, appelée en `:3652` |
| Garde anti-larsen | calibrage du résidu + `bargeInArmed` | `vocal-mic.js:247`, `:283`, `:735` |
| Message clair d'une panne micro | `vocalMicFailure` + `micFailureMessage` | `super-agent.js:3968`, `vocal-mic.js:63` |
| Les trois sorties de l'écran | logo, Échap, fermeture d'onglet | `:4350`, `:4312`, `:4765` |

### 3.2 Ce qui manque, et rien d'autre

1. **Personne n'arme la dictée après la réponse.** `autoReadVocalReply` fait une
   seule chose : cliquer le dernier bouton d'écoute déjà présent (`:4276-4290`).
   Quand la lecture finit, `vocalSpeaking` retombe (`:4326`), `applyVocalState()`
   est appelée — et rien ne rouvre l'oreille. C'est verrouillé par un test : la
   fonction ne doit **jamais** relancer une lecture (`ecran-vocal-lot4a.test.js:455`).
2. **Personne n'arme la dictée après une coupure.** `vocalBargeIn` arrête la
   lecture ou la réflexion (`:4107-4120`), puis rend la main — les mots qui
   suivent la coupure ne sont pas transcrits.
3. **Personne ne la désarme.** Si la dictée tournait pendant que Pilot lit, Pilot
   se transcrirait lui-même, et le texte partirait comme une demande. C'est le
   vrai danger de ce chantier, et il n'a qu'une réponse : **jamais de dictée
   pendant la parole de Pilot**.
4. **La dictée ne se ferme pas à la sortie du mode.** `exitVocal` (`:4216`) coupe
   le flux de mesure et la lecture, mais n'appelle jamais `stopVoiceInput`.
   Aujourd'hui c'est sans effet (on quitte rarement l'écran en pleine dictée) ;
   avec la conversation continue, ce serait une fuite.
5. **Le projet sensible n'est pas respecté ici.** L'onglet agent π refuse la
   dictée cloud sur un projet sensible (`agent-pi.js:945`, `is_project_sensitive`
   `:886`) ; l'onglet Assistant ne connaît pas cette garde (`super-agent.js`
   n'a aucune occurrence de « sensible »). Armer la dictée **tout seul** dans un
   projet sensible serait une faute : la règle est donc posée dès le socle (lot 2).

---

## 4. Le principe : une décision pure, un seul point d'application

### 4.1 Le module pur (nouveau, et c'est le seul)

`src/js/vocal-conversation.js` — zéro DOM, zéro Tauri, testable seul :

```js
// Délais (millisecondes). Justifiés au §5.
export const VOCAL_ARM_DELAY_MS = 350;        // repos -> dictée
export const VOCAL_ARM_AFTER_READ_MS = 600;   // fin de lecture -> dictée (queue d'écho)

// « Faut-il armer la dictée maintenant ? » — l'ordre des règles EST la règle.
export function decideVocalDictation(etats = {}) { /* -> { action, raison, delai } */ }

// « Peut-on armer juste après une lecture ? » — réutilise le verdict anti-écho.
export function shouldArmAfterReading(rapport) { /* -> { armer, delai, raison } */ }

// Traduction d'un code d'erreur de reconnaissance en une phrase claire.
export function vocalDictationMessage(code) { /* -> string */ }
```

Règles, **dans cet ordre** (le premier qui répond gagne) :

| # | Condition | Action | Raison |
|---|---|---|---|
| 0 | **projet sensible** (`is_project_sensitive`) | désarmer | `projet-sensible` |
| 1 | le mode Vocal n'est pas ouvert | désarmer | `hors-mode` |
| 2 | **Pilot parle** (`vocalSpeaking`) | désarmer | `pilot-parle` |
| 3 | Pilot réfléchit ou le backend est occupé | désarmer | `tour-en-cours` |
| 4 | la dictée est déjà ouverte | ne rien faire | `deja-ouverte` |
| 5 | une erreur de reconnaissance est survenue | désarmer | `erreur` |
| 6 | sinon | **armer** (avec délai) | `au-repos` |

La règle 0 vient en tête parce qu'elle est une promesse faite à l'utilisateur,
pas une préférence : sur un projet marqué sensible, l'audio ne part pas. Elle
s'appuie sur le précédent déjà écrit pour l'onglet agent π (`agent-pi.js:945`) et
sur la même commande (`is_project_sensitive`, `agent-pi.js:886`), rafraîchie par
l'évènement `pilot-project-sensitivity` (`:905`).

La règle 2 est la règle d'or. Elle est la **première protection contre le
larsen** : la dictée ne peut pas transcrire la voix de Pilot puisqu'elle est
fermée pendant qu'il parle.

### 4.2 Le point d'application unique

`super-agent.js` : une fonction `vocalSyncConversation()` appelée **une seule
fois**, à la fin de `applyVocalState()` (`:4025`). Pourquoi là : `applyVocalState`
est déjà le point où convergent *tous* les changements d'état de l'écran
(`vocalSetLevel` `:3921`, `vocalSetListening` `:3952`, `vocalMicFailure` `:3968`,
`superSetReflecting` `:3333`, `onVocalReadAloudState` `:4323`, `vocalBargeIn`
`:4095`, `enterVocal` `:4134`). L'écran et l'oreille ne peuvent donc jamais
diverger. C'est la même discipline que `vocalSyncMicSpeaking` (`:4057`), déjà
appelée depuis un seul endroit.

Conséquence utile : **`vocalBargeIn` n'est pas modifiée**. Elle appelle déjà
`applyVocalState()` (`:4125`) — la reprise de l'écoute part donc de la
coupure sans toucher au code de la coupure, et le test « aucune reprise
automatique après une coupure » (`ecran-vocal-lot4a.test.js:455`) reste vert : ce
qui n'est **jamais** repris automatiquement, c'est la **lecture**. Seule l'écoute
repart.

### 4.3 Une seule voie de démarrage de la dictée

`toggleVoiceInput` (`:3537`) contient aujourd'hui deux choses : les gardes
(`mic non supporté`, `assistant occupé`) et le démarrage. On extrait le démarrage
en `startVoiceInput()` et on garde **une seule** voie :

| Fonction | Qui l'appelle | Message si occupé |
|---|---|---|
| `toggleVoiceInput()` | le bouton 🎙️ (clic, `:4558`) | oui, comme aujourd'hui |
| `armVoiceInput()` | `vocalSyncConversation()` | **non**, silencieux |

Aucun second mécanisme de dictée : même `SpeechRecognition`, même langue, même
`onresult`, même `onend`, même `applyVoiceEnd`, même envoi (`send`).

**Une règle existe déjà, on l'étend au lieu d'en écrire une autre.** `send()`
coupe la lecture si l'écran Vocal est ouvert (`:4445`) : « une seule voix à la
fois ». La conversation continue applique exactement la même règle au chemin
parlé : pas de dictée pendant que Pilot parle.

---

## 5. La boucle, tour par tour, avec les délais

| Instant | État de l'écran (existant) | Ce que fait l'oreille (nouveau) |
|---|---|---|
| Entrée dans le mode | « Je vous écoute. » | le flux de mesure s'ouvre (lot 1) **et** la dictée s'arme (350 ms) |
| L'utilisateur parle | « Je vous écoute… » (niveau ≥ 0,06) | la dictée transcrit |
| Silence après la phrase | « Je vous écoute. » | fin de dictée → `applyVoiceEnd` envoie (règle du 2026-10-26) |
| Pilot réfléchit | « Je réfléchis… » | **dictée fermée** (règle 3) ; `send()` l'a déjà fermée (`:4481`) |
| Pilot lit | « Je réponds. » | **dictée fermée** (règle 2) ; seule la garde anti-écho écoute |
| Fin de lecture (`onVocalReadAloudState` `:4323`) | « Je vous écoute. » | réarmement après **600 ms** de silence (queue d'écho) |
| L'utilisateur parle par-dessus | la lecture s'arrête | réarmement après **350 ms** (rien ne joue plus) |
| Pilot réfléchit, l'utilisateur parle | la réflexion s'arrête | réarmement **quand le tour est vraiment fini** (`agent_end`, `:3648`) |

Les deux délais ne sont pas décoratifs :

- **600 ms après une lecture** : `read-aloud.js` lit par morceaux de 180
  caractères (`SPEECH_MAX_CHUNK`, `:98`) et prévient `ended` juste après le
  dernier. La pièce referme sa queue ; la reconnaissance du navigateur, elle, a
  sa propre capture (dont on ne règle pas les contraintes). On laisse donc la
  pièce se vider avant d'ouvrir l'oreille.
- **350 ms au repos** : le temps que le démarrage du moteur de reconnaissance
  (~200-300 ms, observé) ne coupe pas le premier mot.

---

## 6. L'anti-larsen, en réutilisant la garde existante

**Le problème, dit simplement.** La voix de Pilot sort des haut-parleurs, rentre
dans le micro, et peut (a) couper Pilot tout seul, (b) être transcrite et partir
comme une demande de l'utilisateur.

**Ce qui existe déjà et qui règle (a)** — `vocal-mic.js` :

1. l'annulation d'écho est **demandée** dans les contraintes (`MIC_CONSTRAINTS`,
   `:158`) puis **relue** sur la piste réellement obtenue (`echoCancellationOf`,
   `:201`) ;
2. le résidu d'écho est **mesuré** au début de chaque lecture pendant 600 ms
   (`BARGE_IN_CALIBRATION_MS`, `:172`), et le seuil de coupure est posé
   **au-dessus** de ce résidu mesuré (`vocalEchoThreshold`, `:232`) ;
3. si l'annulation n'est pas avérée **ou** si le résidu dépasse 0,03
   (`BARGE_IN_RESIDUAL_MAX`, `:178`), la détection n'est **pas armée**
   (`bargeInArmed`, `:247`) : **Pilot lit jusqu'au bout, il ne se coupe pas**.

**Ce qui manque pour (b), et qui ne demande aucun nouveau mécanisme.** On
n'invente pas une seconde garde : on **lit le verdict existant**.

```
fin de lecture (onVocalReadAloudState, :4323)
        │
        ├─ AVANT vocalSyncMicSpeaking()  →  vocalMic.bargeInReport()   (:735)
        │     { echoCancellation, residuel, seuil, arme, motif }
        │
        └─ shouldArmAfterReading(rapport)  →  armer ? avec quel délai : jamais
```

L'ordre compte et c'est un point de vigilance du lot 3 : `vocalSyncMicSpeaking()`
remet la mesure à zéro (`setSpeaking`, `vocal-mic.js:701`) ; il faut donc
**échantillonner le rapport avant**, sinon on lit des zéros.

| Cas mesuré | Ce que fait Pilot |
|---|---|
| annulation d'écho avérée (`arme: true`) | réarme l'oreille après 600 ms |
| résidu mesuré négligeable (navigateur muet sur l'AEC) | réarme après 600 ms + le délai du résidu |
| annulation **absente** ou résidu élevé | **ne réarme pas** : la dictée reste au bouton 🎙️. Aucune coupure surprise, aucune transcription de sa propre voix |

**Ce qu'on n'ajoute pas** : pas de pré-écoute permanente pendant la lecture. Elle
transcrirait Pilot (c'est exactement ce que le calibrage mesure), et elle
obligerait à décider *a posteriori* ce qui était de l'écho — c'est-à-dire un
second mécanisme, refusé.

---

## 7. La file de missions : où va la demande, que devient le travail interrompu

Question posée, réponse **vérifiée dans le code**, sans rien changer :

| Situation | Ce qui se passe réellement |
|---|---|
| Pilot réfléchit, l'utilisateur parle | `abort_super_agent` (`src-tauri/src/super_agent.rs:1812`) envoie `{"type":"abort"}` à la session de l'assistant ; il refuse proprement si elle n'est pas active et **ne la redémarre jamais**. La nouvelle demande part comme un tour normal (`send`, `:4470`). |
| Une mission de projet était déjà lancée | elle vit **dans son propre processus** (`start_assistant_agent_process`, `agents-bus.js:3793`), pas dans celui de l'assistant : l'abandon du tour ne l'arrête pas. Son compte rendu est écrit en base puis remis quand l'assistant est libre — la ligne n'est marquée livrée que sur **accusé du moteur** (`injection_ack`, `super_agent.rs:4249`, `MAX_INJECTION_ACK_ATTEMPTS = 5`, `:4209`), et le rejeu part à la fin du tour suivant (`flushPendingSuperAgentReports`, `super-agent.js:3648`). |
| La nouvelle demande vise un projet déjà occupé | elle est **mise en file** par le mécanisme existant : une seule mission à la fois par projet, ordre d'arrivée, démarrage automatique (`decideMissionAdmission`, `super-agent.js:987` ; `enqueueMissionForProject`, `:816` ; `project-task-queue.js:3`). Rien n'est perdu, rien ne double. |
| L'utilisateur veut **arrêter la mission** elle-même | ce n'est pas la parole : c'est le geste d'arrêt de l'agent (ou `/file`). `project-queue-view.js:143` refuse explicitement de retirer la mission **en cours** : « l'arrêter est l'arrêt de l'agent, autre geste ». |

**Conséquence de conception** : la conversation continue **n'ajoute aucune règle de
file**. Elle apporte des demandes plus vite ; la file les ordonne comme les
autres. C'est voulu : deux mécanismes d'ordre auraient divergé.

---

## 8. Les cas moches

| Cas | Aujourd'hui | Après (lot) | Ce que voit l'utilisateur |
|---|---|---|---|
| Micro refusé | message + bouton « Autoriser le micro » (`vocalMicFailure` `:3968`, `:4186`) | inchangé, **et** la dictée ne s'arme pas (règle 5) | la ligne dit « Le micro est fermé. » + le bouton |
| Projet sensible (🔒) | la garde n'existe **pas** dans l'onglet Assistant | la dictée **ne s'arme jamais** (règle 0) | rien de nouveau : le mode reste utilisable à la saisie |
| Micro pris par une autre application | `MIC_OCCUPE` (`vocal-mic.js:55`) | inchangé | la ligne le dit |
| Micro débranché en cours d'écoute | piste `ended` → `surPanne` (`vocal-mic.js:663`) | idem + la dictée tombe (`audio-capture`) → **même ligne** (lot 4) | la ligne le dit, le mode reste utilisable |
| Panne de la reconnaissance (réseau, `not-allowed`) | message dans la conversation — **invisible en mode Vocal** (`:3580`) | routé vers `vocalMicFailure` (lot 4) | la ligne le dit ; pas de réarmement |
| Silence prolongé | — | l'oreille se referme, puis se rouvre selon la décision | rien de nouveau à l'écran : la ligne reste « Je vous écoute. » (voir question 1) |
| Réponse très longue | lue en entier, coupable à tout moment (garde 4a) | **inchangé**, aucun nouveau réglage | « Je réponds. » ; parler coupe |
| Assistant occupé au moment de l'envoi | le texte reste dans la zone, la conversation le dit (`:4470`) | idem + la dictée se réarme | **limite assumée** : en mode Vocal, ce message est invisible ; le texte n'est pas perdu |
| Pilot lit et l'écho n'est pas maîtrisé | Pilot lit jusqu'au bout (`bargeInArmed` false) | idem, **et** pas de réarmement automatique | la ligne reste « Je réponds. » ; une fois la lecture finie, le bouton 🎙️ reste la voie |

---

## 9. Les sorties : suffisantes, avec un trou à boucher

Les trois sorties existent et convergent toutes vers `exitVocal` :

| Sortie | Preuve |
|---|---|
| Le logo-bouton des modes | `onScreenModeApply` `:4350` → `exitVocal` |
| La touche Échap | `onVocalKeydown` `:4312` |
| La fermeture de l'onglet Assistant | `:4763-4766` (`stopReading()` puis `exitVocal()`) |

**Verdict : suffisantes pour l'utilisateur.** Il manque une chose, technique :
`exitVocal` (`:4216`) coupe le flux de mesure et la lecture, mais pas la dictée.
Avec la conversation continue, quitter l'écran laisserait une reconnaissance
ouverte. → **lot 5**, deux lignes.

---

## 10. Avant / après, pour l'utilisateur

| Moment | Aujourd'hui | Après |
|---|---|---|
| Entrer dans le mode | rien ne s'ouvre ; il faut cliquer | le micro s'ouvre seul |
| Parler pour la première fois | un clic sur 🎙️ | parler, c'est tout |
| Après la réponse lue | il faut recliquer 🎙️ | parler, c'est tout |
| Couper Pilot en pleine phrase | marche (lot 4a/4b) | marche, **et la fin de la phrase est captée** |
| Enchaîner trois échanges | 3 clics | 0 clic |
| Sortir du mode | le micro se ferme | le micro se ferme, **la dictée aussi** |
| Voir ce qui a été compris | la zone de saisie, en bas | inchangé (l'écran reste nu) |

---

## 11. Les lots

Chaque lot est **livrable seul**, laisse `npm test` et `cargo test --workspace`
verts, et se vérifie à la main sans les suivants. Ordre imposé : 2 fournit la
décision utilisée par 3, 4 et 5.

| Lot | Titre | Ce que l'utilisateur gagne | Fichiers |
|---|---|---|---|
| **1** | Le micro s'ouvre à l'entrée | zéro geste pour parler | `super-agent.js`, `vocal-mic.js`, 1 test, 1 spec |
| **2** | Le socle + la reprise après la réponse | enchaîner après chaque réponse | `vocal-conversation.js` (nouveau), `super-agent.js`, 2 tests |
| **3** | Couper en parlant, puis enchaîner | la fin de la phrase est captée | `vocal-conversation.js`, `super-agent.js`, 1 test |
| **4** | Les cas moches | une panne est dite, jamais muette | `vocal-conversation.js`, `super-agent.js`, 1 test |
| **5** | Les sorties | rien ne reste ouvert | `super-agent.js`, 1 test |
| **6** | *(option)* dictée locale | le son ne sort plus de la maison | chantier séparé (voir question 2) |

### Lot 1 — Le micro s'ouvre à l'entrée (décision ferme)

- **Quoi** : dans `enterVocal` (`:4162-4185`), remplacer l'armement des deux
  écouteurs de geste (`pointerdown`, `keydown`) par un appel direct à
  `vocalMic.demander()`. Supprimer `onVocalFirstGesture` (`:3981`) et son
  `removeEventListener` (`:4235`).
- **Réutilise** : `demander()` est déjà idempotent et déjà faute-tolérante
  (`vocal-mic.js:405`) ; le bouton « Autoriser le micro » (`:4186`) et
  `vocalMicFailure` (`:3968`) restent la voie de reprise.
- **Ne touche pas** : la garde de lecture, la coupure, la dictée.
- **Preuve à la main** : entrer dans le mode → témoin micro de Windows allumé,
  ligne « Je vous écoute. », aucun clic. Refuser le micro dans Windows →
  « Le micro est fermé. » + bouton.
- **Test à mettre à jour (assumé)** : `ecran-vocal-lot3.test.js:253-285` verrouille
  aujourd'hui « au premier geste, jamais à l'entrée ». Il devient « une seule
  demande, à l'entrée ; le bouton relance ».
- **Doc** : `spec_modes_ecran_vocal.md` §5 + bloc `<!-- HELP:modes-ecran -->`.
- **Risque** : sur macOS/Linux (WebKit), une demande à l'entrée peut afficher une
  autorisation système. Sur Windows, le correctif `src-tauri/vendor/wry` autorise
  le micro sans dialogue (`spec_voice_input.md` §8).

### Lot 2 — Le socle pur + la reprise après la réponse

- **Quoi** : créer `src/js/vocal-conversation.js` (§4.1) ; extraire
  `startVoiceInput()` de `toggleVoiceInput` (`:3537`) ; ajouter
  `vocalSyncConversation()` et l'appeler en fin de `applyVocalState` (`:4025`) ;
  lire `is_project_sensitive` à l'entrée du mode et le rafraîchir sur
  `pilot-project-sensitivity` (même commande et même évènement que
  `agent-pi.js:886` et `:905`) pour nourrir la règle 0.
- **Effet visible** : après la fin de la lecture (`pilot-read-aloud-state` ≠
  `speaking`), la dictée s'arme seule au bout de 600 ms. Elle se ferme dès que
  Pilot parle ou réfléchit.
- **Preuve à la main** : en mode Vocal, poser une question, laisser lire, puis
  parler sans rien toucher → la demande part. Puis, pendant la lecture suivante,
  vérifier que le micro ne transcrit pas Pilot (aucun texte ne s'écrit tout seul).
- **Tests** : `vocal-conversation.test.js` (pur : les 7 règles, l'ordre,
  l'idempotence) + `conversation-continue-lot2.test.js` (branchement : une seule
  voie de démarrage, `vocalSyncConversation` appelée une seule fois, aucun second
  lecteur, aucun `SpeechRecognition` ailleurs).
- **Doc** : `spec_modes_ecran_vocal.md` §6 (nouveau) + `spec_voice_input.md`
  (la dictée peut démarrer sans geste) + handbook.

### Lot 3 — Couper en parlant, puis enchaîner

- **Quoi** : échantillonner `vocalMic.bargeInReport()` **avant**
  `vocalSyncMicSpeaking()` dans `onVocalReadAloudState` (`:4323`) et le passer à
  `shouldArmAfterReading` (§6). Pour la réflexion : n'armer que lorsque
  `reflectingActive === false` **et** `backendBusy === false` (le tour est
  vraiment fini — `agent_end`, `:3648`).
- **Réutilise** : `bargeInReport` (`vocal-mic.js:735`), `bargeInArmed` (`:247`),
  `stopReading`, `stopSuperAgentTurn`. **Aucune modification de `vocalBargeIn`.**
- **Preuve à la main** : laisser Pilot lire, parler par-dessus → il se tait, et la
  fin de la phrase devient la demande suivante. Puis, avec un casque débranché
  (écho non maîtrisé), vérifier qu'il lit jusqu'au bout et que la dictée ne
  s'arme pas seule.
- **Tests** : `vocal-conversation.test.js` (cas `arme:false`, AEC inconnue,
  résidu élevé) + un test de branchement sur l'ordre
  `bargeInReport` → `vocalSyncMicSpeaking`.
- **Doc** : `spec_modes_ecran_vocal.md` §6 + `spec_read_aloud.md` (rien ne change
  pour la lecture).

### Lot 4 — Les cas moches

- **Quoi** : router les erreurs de reconnaissance (`rec.onerror`, `:3580`) vers
  `vocalMicFailure` **en mode Vocal seulement** (hors mode, le message reste dans
  la conversation) ; `vocalDictationMessage(code)` traduit `not-allowed`,
  `audio-capture`, `network`, `service-not-allowed` en une phrase simple ;
  mémoriser la dernière erreur pour que la règle 5 empêche le réarmement.
- **Preuve à la main** : couper le réseau pendant une dictée automatique → la
  ligne le dit, le mode reste utilisable, la dictée ne s'acharne pas.
- **Tests** : `vocal-conversation.test.js` (traductions, règle 5) + test de
  branchement (aucun `appendSystemMessage` de dictée en mode Vocal).
- **Doc** : `spec_modes_ecran_vocal.md` §6 + `spec_voice_input.md`.

### Lot 5 — Les sorties

- **Quoi** : dans `exitVocal` (`:4216`), ajouter `if (voiceActive)
  stopVoiceInput();` et l'annulation du minuteur d'armement. Les trois sorties en
  bénéficient (elles passent toutes par là).
- **Preuve à la main** : entrer en Vocal, laisser la dictée s'armer, sortir par
  Échap → le témoin micro s'éteint, rien ne s'écrit dans la zone de l'onglet.
- **Tests** : un test qui vérifie que `exitVocal` contient `stopVoiceInput` et
  qu'aucun chemin de sortie ne contourne `exitVocal` (`:4312`, `:4350`, `:4765`).
- **Doc** : `spec_modes_ecran_vocal.md` §3 (les trois sorties).

### Lot 6 (option, hors périmètre) — la dictée locale

La dictée actuelle envoie le son chez Microsoft sous Windows (`spec_voice_input.md`
§3, `agent-pi.js:848`). Ces 5 lots bornent l'exposition : la reconnaissance n'est
ouverte qu'en fenêtres courtes, jamais pendant que Pilot parle, et se ferme à la
sortie. Passer à une reconnaissance **locale** (comme la voix Piper, déjà
embarquée) est un chantier séparé, à décider — question 2.

---

## 12. Ce que cette conception ne fait pas

| Tentation | Pourquoi on ne le fait pas |
|---|---|
| Une pré-écoute permanente pendant la lecture | transcrirait Pilot ; il faudrait trier après coup — second mécanisme (§6) |
| Reprendre la **lecture** tout seul après une coupure | interdit depuis le lot 4a, et c'est juste : on a coupé pour parler |
| Un mot d'éveil (« Pilot… ») | nouveau réglage, nouveau moteur, hors sujet |
| Un bouton, une pastille, un compteur | l'écran est nu (décision ferme) |
| Arrêter la mission d'un projet en parlant | autre geste, autre décision (§7) |
| Répondre plus vite | hors sujet : la lenteur vient de l'agent |

---

## 13. Trois questions fermées

### Question 1 — Après un silence, jusqu'où Pilot tend-il l'oreille ?

Contexte : la reconnaissance du navigateur se referme d'elle-même après quelques
secondes sans voix. Trois politiques possibles.

- **A. Toujours** : elle se réarme sans limite tant que l'écran est ouvert.
  Aucun geste, jamais. *Recommandé* — c'est la seule qui tienne la décision
  « le micro s'ouvre dès l'entrée », et le silence ne coûte rien en réseau (le
  moteur ne transmet pas de silence).
- **B. Trois fenêtres** : au-delà, l'oreille se repose et il faut toucher 🎙️.
  Plus économe, mais l'utilisateur ne sait pas pourquoi ça ne répond plus.
- **C. Une fenêtre par réponse** : la plus stricte, un clic dès qu'on a laissé
  passer un silence.

**Recommandation : A**, et ça se voit avec **l'existant seulement** : la ligne
reste « Je vous écoute. » (prête) et passe à « Je vous écoute… » quand le trait
bouge.

### Question 2 — La dictée reste-t-elle celle du navigateur (cloud) pour ces lots ?

- **A. Oui, bornée** : la reconnaissance ne s'ouvre qu'en fenêtres courtes, jamais
  pendant que Pilot parle, jamais sur un projet sensible (🔒), et se ferme à la
  sortie. Le flux de niveau, lui, reste **local**. On livre en 5 lots.
  *Recommandé.*
- **B. Non, d'abord la dictée locale** : on ne livre rien tant que le moteur local
  n'existe pas. Plus long, mais le son ne sort plus jamais de la maison.

**Recommandation : A**, avec le lot 6 comme chantier suivant. C'est le seul ordre
où l'on peut essayer la conversation continue **cette semaine**.

### Question 3 — Les premiers mots d'une coupure sont perdus (~0,2 à 0,6 s) : accepté ?

Contexte : la coupure est décidée sur une voix **continue** de 200 ms
(`BARGE_IN_MIN_MS`, `vocal-mic.js:182`), puis le moteur de reconnaissance met
~200-300 ms à démarrer. Ce qui a déclenché la coupure n'est donc pas transcrit.

- **A. Accepté** : on parle une phrase entière, donc on répète naturellement le
  début. Rien à coder. *Recommandé.*
- **B. Inacceptable** : il faudrait écouter **pendant** la lecture et trier
  l'écho après coup — c'est-à-dire le second mécanisme refusé au §6, avec le
  risque de se transcrire soi-même.

**Recommandation : A**, et le dire franchement dans la spec et le handbook.

---

## 14. VERDICT

**Prêt à appliquer, pour les lots 1 à 5.** Tout ce qu'il faut existe déjà :

- la décision de couper est prise par la garde du micro, pas par l'écran (§6) ;
- la lecture a une seule voie d'arrêt (`stopReading`) et un seul état publié
  (`pilot-read-aloud-state`) ;
- la dictée, son envoi automatique et sa décision d'envoi existent
  (`toggleVoiceInput`, `applyVoiceEnd`, `decideVoiceAutoSend`) ;
- la file des projets ordonne déjà tout ce qui arrive (§7) ;
- les trois sorties convergent vers `exitVocal` (§9).

Ce qui reste nouveau tient en **un module pur** et **quatre branchements**.

**Reste à décider** (section 13, trois questions fermées) : la politique de
silence, le maintien de la dictée cloud, l'acceptation des ~0,5 s perdues à la
coupure.

**Non vérifiable ici, à mesurer au banc** (aucune de ces mesures ne change la
conception, elles changent les délais) :

1. le niveau mesuré continue-t-il pendant que la reconnaissance tourne ? Si non,
   la ligne reste à « Je vous écoute. » — on ne crée **pas** une seconde source
   d'état (§5).
2. combien de temps la reconnaissance reste-t-elle ouverte en silence sur
   WebView2 ? Cela fixe le nombre de réarmements de la question 1.
3. la queue d'écho réelle après le dernier morceau lu : 600 ms suffisent-ils, ou
   faut-il 900 ms ?

DONE: conception écrite dans CONCEPTION-conversation-continue.md — 5 lots applicables + 1 option, 3 questions fermées, aucun fichier de code modifié.
