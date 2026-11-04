# Rapport — les trois défauts de l'écran Vocal (micro, halo, position de la conversation)

Date : 2026-11-04 · Portée : écran « Vocal » (`src/js/super-agent.js`), capture du
micro (`src/js/vocal-mic.js`), enveloppe de parole
(`src/js/vocal-enveloppe-aigu.js`) et position de la conversation au retour
(`src/js/conversation-scroll.js`). Commit vérifié : `9609277`.

## 0. Ce que cette mission a trouvé, en une phrase

Les trois défauts ont **déjà leur cause établie et leur correctif en place** dans
l'historique du dépôt, livrés le même jour :

| Défaut | Correctif en place | Rapport d'origine |
|---|---|---|
| 1. le micro s'arrête tout seul | `0f0ce3b` (18:24) | `RAPPORT-micro-arret-mode-vocal.md` |
| 2. le halo se fige sur une parole longue | `6850cb2` (18:46) | `RAPPORT-halo-parole-longue.md` |
| 3. la conversation repart en haut au retour | `f102bf8` (18:56) | `RAPPORT-retour-mode-conversation-en-bas.md` |

Cette mission **re-vérifie** les trois : cause relue dans le code d'aujourd'hui,
correctif présent au point de branchement exact, et — la seule preuve qui compte —
**chaque verrou échoue quand on neutralise le correctif** (§ 5). Aucun code n'a été
modifié : il n'y avait rien à réparer, et ajouter un second mécanisme aurait créé
le défaut suivant. Aucune version n'est touchée, aucune disposition d'écran n'est
changée, aucun seuil audio n'est déplacé.

---

## 1. DÉFAUT 1 — « le micro s'arrête tout seul, et je dois parfois le rouvrir à la main »

### 1.1 Cause réelle, lue dans le code

La capture de l'écran Vocal était ouverte **une seule fois, par l'appelant**, et
`demander()` refusait toute demande suivante (`vocalMicDemande`). Les quatre
sorties possibles de la capture — `fermer()`, le `catch` de la mesure, la piste
`ended`, l'analyseur muet — passaient par `liberer()` + un message, et **rien ne
la rouvrait** :

- perte passagère (casque débranché, micro changé dans Windows, autre application
  qui prend le micro, session audio interrompue) → micro fermé **pour de bon** ;
- la dictée consomme le **même** flux (robinet `setAudioTap`) : elle tombait avec
  lui, et son erreur verrouillait en plus tout réarmement (règle 6 de
  `vocal-conversation.js`), donc plus aucune transcription ;
- seule la voie « Autoriser le micro » ramenait le son — d'où le geste manuel.

Ce n'était **ni** un seuil de sensibilité (0,06 / 0,03 inchangés), **ni** la garde
anti-auto-coupure, **ni** la garde du nom : c'était l'absence de reprise.

### 1.2 Correctif en place (dans le seul module autorisé à ouvrir le micro)

`src/js/vocal-mic.js` — et nulle part ailleurs :

- `setKeepOpen(true)` à l'entrée du mode, `setKeepOpen(false)` + `fermer()` à la
  sortie : **l'écran tient le micro**, et cette intention est la seule à autoriser
  une reprise ;
- un **point unique** de panne (`panneCapture`) : il dit la panne, puis programme
  la reprise ;
- reprise **automatique** des causes **passagères** uniquement, 400 ms → 800 → 1600
  → 3200 → plafond 5 s, **une seule capture à la fois** (`demandeEnCours`),
  `fermer()` annule toute reprise en attente ;
- une cause **définitive** (refus explicite, aucun périphérique, API absente)
  n'est **jamais** redemandée — aucune boucle de permission ;
- décisions pures et testables séparément : `micFailureIsRecoverable`,
  `micReopenDelay`, `shouldReopenVocalMic` ;
- côté écran : la phrase « le micro est fermé » est **retirée** au retour de la
  capture (`vocalSetListening(true)`), l'erreur de **dictée** reste affichée, et
  une panne de dictée dont la cause est la capture **ne verrouille plus**
  l'armement.

Aucune fermeture légitime n'est silencieuse : `vocalMicFailure` alimente la ligne
d'état **et** le bouton « Autoriser le micro » (`.vocal-mic-fix`), qui relance la
**même** demande (`requestVocalMeasure("geste")`).

### 1.3 Preuve

`src/js/micro-reste-ouvert-mode-vocal.test.js` — 19 tests, 7 sections (décision
pure, reprise réelle, `fermer()` jamais défait, aucune capture doublée, garde posée
et retirée aux deux bons endroits, phrase retirée, réarmement après lecture).

---

## 2. DÉFAUT 2 — « le halo bouge, puis se fige alors que la voix continue »

### 2.1 Cause réelle, lue dans le code

Le halo de parole n'est pas une animation décorative : c'est l'**enveloppe** qui
suit la voix, alimentée par **une seule des deux sources** (`planSpeechEnvelopeSource`) :

- voix **locale** (Piper) : le son que Pilot joue lui-même est **mesurable** (un
  `AnalyserNode`, bande haute ≥ 4 kHz) → source « son » ;
- voix du **système** : aucun flux audio accessible à la page → source « rythme »
  du texte lu.

Le défaut était dans la source « rythme », et à deux endroits :

1. `rhythmIntensity(units, position)` vaut **0 au-delà de la dernière unité** ; or
   le plan de rythme est une **hypothèse de débit** (190 ms/syllabe) que la lecture
   réelle **dépasse de 35 à 63 %** sur du texte technique que le moteur épelle. La
   position sortait donc du texte, l'intensité tombait à 0 et l'enveloppe **se
   posait au repos** — halo figé — alors que la voix continuait ;
2. l'horloge du rythme partait de l'**annonce** de lecture, qui précède
   `ensureVoices` (jusqu'à 1 500 ms) et le démarrage du moteur : le plan consommait
   du texte **avant** le premier son.

### 2.2 Correctif en place

- la position de lecture est **ramenée dans le texte** tant que la lecture dure
  (`ecoule % total`) : le motif continue de respirer, **quelle que soit la durée** ;
- l'horloge **repart du premier son** (`READ_ALOUD_SOUND_EVENT` → `reancrer()`),
  jamais de l'annonce ;
- rien d'autre n'a bougé : l'apparence voulue est intacte (extension 36 px au repos
  → 88 px à pleine voix pour le disque de 336 px, opacité 0,80 → 1, dégradé et
  couronne inchangés, aucun seuil audio touché), et les deux sources ne se
  remplacent jamais l'une l'autre.

### 2.3 Preuve

`src/js/vocal-enveloppe-rythme.test.js` — 25 tests, dont la section 6 (« une
lecture LONGUE que le débit prévu ne couvre pas continue de faire respirer le
halo ») qui **échoue sur le code d'avant**.

---

## 3. DÉFAUT 3 — « au retour, la conversation repart tout en haut »

### 3.1 Cause réelle, lue dans le code

Sortir d'un plein écran **remet les nœuds du chat à leur place** dans le DOM, et
déplacer un nœud défilable **remet son `scrollTop` à 0** : la conversation
réapparaissait en haut. Trois causes successives, toutes dans le code :

1. aucune photographie de la position n'était prise avant le déplacement ;
2. la photographie de sortie est **trop tardive** : le cycle du logo traverse
   « Assistant seul », dont l'entrée **force le bas** (issue #82) — pour qui
   relisait, la photographie dit « il était en bas »… parce qu'on l'y a mis ;
3. à l'instant de la sortie, la mise en page de « Détaillé » peut être
   **transitoire** (barre de saisie, rangée des questions et nœuds réinsérés dans
   le même tour) : si le contenu est alors mesuré comme non débordant, la décision
   rend 0 → conversation écrite **tout en haut**, sans rien pour la corriger.

### 3.2 Correctif en place

- **deux photographies** : `memoizeSuperDetailScroll` (au moment où l'on quitte
  « Détaillé », avant tout déplacement) et `memoizeSuperScroll` (à la sortie) ;
- une **décision pure** entre les deux (`conversationScrollReturnSnapshot`) :
  en bas → le bas (contenu nouveau compris) ; il relisait → son passage ; il a
  remonté la conversation **pendant** le plein écran → sa position du moment ;
  une seule photographie → celle-là, rien d'inventé ;
- un **second temps** de restitution (`replaySuperScrollAfterLayout` +
  `conversationScrollReplayTarget`) : la même décision rejouée **une fois** sur la
  géométrie réelle, au premier signal de rendu (aucun minuteur, aucun défilement
  animé) ;
- `restoreSuperScroll` est la **dernière instruction** de `exitVocal()` **et** de
  `exitImmersive()` : les **trois** voies de sortie passent par `exitVocal` — le
  logo (`onScreenModeApply`), Échap (`onVocalKeydown`), la fermeture de l'onglet
  (`unlisten`) — et se comportent donc à l'identique.

### 3.3 Preuve

`src/js/retour-mode-conversation-en-bas.test.js` + `src/js/conversation-scroll.test.js`
— 36 tests (dont les sections 4 et 5 : photographie prise au bon moment,
restitution à deux photographies, trois sorties).

---

## 4. Ce qui n'a PAS été touché (anti-régression)

- aucun **seuil audio** (0,06 / 0,03) : la reprise du micro ne mesure rien de plus ;
- aucun **second mécanisme** : `vocal-mic.js` reste le seul endroit qui ouvre et
  ferme le micro ; le halo garde **une** source à la fois ; la conversation garde
  **un** module de décision pur ;
- aucune **apparence** de halo changée (taille, couleurs, forme, couronne) ;
- aucune **disposition** des trois écrans (Détaillé · Assistant seul · Vocal) ;
- aucun test existant **assoupli** (aucun `expect` modifié par cette mission) ;
- aucune **version** touchée.

## 5. La preuve qui compte : neutraliser le correctif fait échouer son verrou

Chaque correctif a été **neutralisé temporairement** (fichier restauré aussitôt),
puis son verrou relancé :

| Correctif neutralisé | Verrou relancé | Résultat |
|---|---|---|
| `shouldReopenVocalMic` renvoie toujours `false` | `micro-reste-ouvert-mode-vocal.test.js` | **4 échecs** / 15 réussis (19) |
| la position de rythme n'est plus ramenée dans le texte | `vocal-enveloppe-rythme.test.js` | **1 échec** / 24 réussis (25) |
| la décision ne garde que la photographie de sortie | `retour-mode-conversation-en-bas.test.js` + `conversation-scroll.test.js` | **1 échec** / 35 réussis (36) |

Les trois verrous tiennent donc bien le comportement, et pas seulement la présence
des fonctions.

## 6. Suites complètes (mesures réelles de cette session)

- Front (Vitest, suite complète) : **5594 tests réussis, 0 échec** (300 fichiers).
- Rust (`cargo test --manifest-path src-tauri/Cargo.toml --lib`) : **902 tests
  réussis, 0 échec**, 3 ignorés.
- Aide intégrée régénérée (`npm run build:handbook`) : **aucune différence** —
  `help/handbook.md` était déjà à jour (48 blocs, 343 132 octets).

## 7. Documentation

Rien à ajouter : les trois correctifs sont déjà décrits là où ils vivent.

- `spec_modes_ecran_vocal.md` § 8ter (position de la conversation au retour, les
  trois sorties), § halo/enveloppe (« le halo se fige sur une parole longue ») et
  § micro (« le micro de mesure se rouvre seul ») ;
- `help/overview.md` / `help/handbook.md` : phrase utilisateur sur le micro qui se
  rouvre seul et sur le halo qui suit la voix jusqu'au bout ;
- `AGENTS.md` : les trois verrous sont nommés dans la ligne de navigation de
  l'écran Vocal.
