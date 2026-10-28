# Rapport — Écran Vocal : la MESURE du micro en premier

**Date** : 2026-02-XX · **Périmètre** : `src/js/vocal-mic.js`, `src/js/vocal-conversation.js`,
`src/js/super-agent.js` (écran Vocal), tests, `spec_modes_ecran_vocal.md`,
`spec_pilot.md`, `help/overview.md`, `README.md`.

---

## 1. Le défaut corrigé

Deux captures micro coexistaient dans l'écran Vocal : la **mesure du niveau**
(longueur du trait, état « écoute », prise de parole) et la **dictée**
(transcription). Le commit `f81897e` avait **inversé leur ordre** : la dictée
s'ouvrait ~350 ms après l'entrée, la mesure seulement au **premier geste**.

Conséquences mesurées :

| Situation | Avant | Après |
|---|---|---|
| Le pilote audio refuse la **seconde** capture | c'était la **mesure** qui échouait : trait figé + « Le micro est occupé par une autre application » alors que **la dictée fonctionnait** → panne fantôme permanente | la mesure ouvre **la première** : une panne de mesure est **une panne de mesure**, la dictée ne s'arme pas derrière elle |
| La **dictée** échoue | mélange des deux pannes dans la même ligne | panne de dictée **visible**, la mesure et le trait continuent de fonctionner |
| Deux clients sur le même périphérique | l'annulation d'écho de la mesure pouvait être dégradée **silencieusement** (garde de coupure désarmée sans le dire) | la mesure s'installe **seule** avant que la dictée n'ouvre sa capture |
| Projet 🔒 (sensible) | la sensibilité était relue en **asynchrone** : l'armement pouvait partir avant la réponse | **aucun armement** tant que la réponse n'est pas arrivée, et relecture à **chaque** changement de projet |

## 2. L'ordre obtenu

```
entrée dans le mode Vocal
  1. createVocalMic(...)                      (le moteur, inerte)
  2. requestVocalMeasure("entree")            ← LA MESURE, une seule demande
  3. refreshVocalSensitivity()                ← la question « projet 🔒 ? » part
  4. applyVocalState() → vocalSyncConversation()
        └─ decideVocalDictation(état)
             ├─ sensibiliteConnue !== true → désarmée   (règle 7b : on ATTEND)
             ├─ mesureOuverte    !== true → désarmée   (règle 7c : la mesure d'abord)
             └─ sinon → ARMÉE après 350 ms (600 ms après une lecture)
  5. à l'ouverture réelle de la mesure : vocalSetListening(true) → applyVocalState()
        └─ la décision repasse et arme la dictée (rien n'est demandé deux fois)
```

- **Une seule voie de demande** dans tout le fichier : `requestVocalMeasure(origine)`
  → `vocalMic.demander()`. Deux origines seulement : `"entree"` (automatique) et
  `"geste"` (le bouton **« Autoriser le micro »**, après un échec). L'ancien
  écouteur de geste (`onVocalFirstGesture`, `pointerdown` + `keydown`) a été
  **supprimé** : il ne servait qu'à ouvrir un second chemin pour la même demande.
- La garde `shouldAskVocalMic` accepte désormais `entree: true` (en plus de
  `geste: true`), refuse toujours une seconde demande (`dejaDemande`) et un micro
  déjà ouvert (`microActif`).
- **Aucune phrase nouvelle, aucun bouton nouveau, aucun réglage** : les messages
  sont ceux de `vocal-mic.js` (« Le micro est fermé. », « Le micro est occupé par
  une autre application. », …) et le bouton de reprise est celui qui existait.
- **Le trait continue d'animation pendant la dictée** : la mesure n'est ni
  suspendue ni partagée avec la dictée.
- **Rien n'a changé** pour les seuils de coupure (`BARGE_IN_*`), les phrases de
  l'écran (`vocalStatusText`) ni l'écran nu.

## 3. Décisions pures ajoutées (une seule, déjà existante, étendue)

`decideVocalDictation` reçoit deux faits de plus (`sensibiliteConnue`,
`mesureOuverte`) et deux règles de plus, **placées juste avant l'armement** :

| Règle | Raison rendue | Effet |
|---|---|---|
| 7b sensibilité pas encore connue | `sensibilite-inconnue` | désarmée (attendre) |
| 7c mesure pas ouverte | `mesure-fermee` | désarmée (la mesure d'abord) |

Elles passent **après** les règles 5 à 7 pour ne pas changer le motif affiché des
états déjà couverts (parole, travail, dictée déjà ouverte, arrêt manuel, plafond
des sessions vides, erreur, dictée indisponible) : une dictée ouverte par un
**geste explicite** n'est pas refermée par une mesure fermée.

Le geste 🎙️ (`toggleVoiceInput`) n'ouvre pas « au hasard » pendant l'attente de
la sensibilité (`if (!vocalSensibiliteConnue) return;` — aucun message : il n'y a
rien à signaler, l'armement automatique suit dès la réponse).

## 4. Tests

Nouveau fichier : `src/js/vocal-mesure-en-premier.test.js` (18 tests).

| Ce qui est verrouillé | Comment |
|---|---|
| la mesure s'ouvre à l'entrée, **avant** l'armement | `requestVocalMeasure("entree")` précède le dernier `applyVocalState()` de `enterVocal` |
| mesure fermée ⇒ aucune dictée armée | règle `mesure-fermee` (décision + plan) |
| mesure fermée ⇒ aucun armement programmé | `delai === 0`, armement en attente **coupé** |
| sensibilité inconnue ⇒ aucun armement | règle `sensibilite-inconnue` (drapeau absent = refus) |
| sensibilité relue après l'IPC **et** à chaque changement de projet | `refreshVocalSensitivity` + `pilot-project-sensitivity` (ajout et retrait de l'écouteur) |
| une entrée ne demande pas le micro deux fois | `shouldAskVocalMic` + **une seule** occurrence de `vocalMic.demander()` dans le code |
| les verrous existants tiennent | aucune API micro dans `super-agent.js`, `createVocalMic` ne demande rien, un seul `vocalSyncConversation();`, un seul `new SR()` |

Tests **modifiés** (aucun supprimé sans raison écrite en commentaire) :

- `ecran-vocal-lot3.test.js` § 2 : « au PREMIER GESTE, jamais à l'entrée » →
  « la MESURE s'ouvre à l'ENTRÉE, une seule fois » (l'ancienne règle est
  exactement celle que le propriétaire a renversée) ; l'écouteur de geste et son
  retrait ne sont plus testés puisqu'ils n'existent plus ; le point 4 vérifie
  désormais que l'entrée **demande** la mesure.
- `vocal-parler-declenche-une-demande.test.js` : les trois cas qui attendent un
  **armement** passent les deux nouveaux drapeaux (`{ sensibiliteConnue: true,
  mesureOuverte: true }`), avec le motif écrit dans le fichier ; les cas de
  **désarmement** sont inchangés.
- `vocal-correctifs-revue.test.js` : la phrase de documentation verrouillée passe
  de « micro de mesure à votre premier geste » (devenue fausse) à « micro de
  mesure dès l'entrée ».

Résultat : **206 fichiers, 3746 tests, tous verts** (`npm test`) ; `npm run build`
(construction Vite) sans erreur. `npm run build:handbook` régénéré (46 blocs).

## 5. Documentation

- `spec_modes_ecran_vocal.md` § 5 : l'ordre (mesure **puis** dictée), le pourquoi
  (panne fantôme), ce qui se passe si chaque capture échoue, la sensibilité
  attendue et relue. § 6bis : la dictée vient après la mesure, la règle
  `sensibilite-inconnue`, la règle `mesure-fermee`. § « non prouvable par un
  test » mis à jour.
- `spec_pilot.md` : résumé du mode Vocal (« micro de mesure ouvert **en premier**
  dès l'entrée »).
- `help/overview.md` (bloc `HELP:modes-ecran`) : le texte lu par l'utilisateur dit
  la mesure à l'entrée, la panne qui ne se déguise plus et le blocage sur projet
  sensible. `help/handbook.md` régénéré (jamais édité à la main).
- `README.md` : même vérité, en langage utilisateur.
