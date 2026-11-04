# Rapport — le halo se figeait sur une parole longue

> **Demande** : « le halo bouge quand Pilot parle, mais il se fige quand la parole
> dure longtemps, alors que la voix continue ». Nommer la cause, corriger pour que
> le halo suive la voix **du début à la fin, quelle que soit la durée**, vérifier
> les **deux** sources (voix locale du poste et voix du système), et vérifier
> qu'un **silence réel** donne bien un halo au repos (aucun mouvement inventé).
>
> État : **corrigé**. Aucun numéro de version touché. Aucun test existant
> assoupli. L'apparence voulue du halo (taille, couleurs, forme, peintre) est
> inchangée : seule la **source d'énergie** est réparée.

---

## 0. Ce que le halo est, en deux lignes

`super-agent.js` ne décide rien : il reçoit une valeur 0..1 et pose **une classe**
(`.vocal-envelope-live`) et **deux variables** (`--vocal-envelope-scale`,
`--vocal-envelope-alpha`). Dès que la classe est posée, le CSS **éteint
l'animation** (`animation: none`) : le halo ne bouge plus que par ces deux
variables. Donc :

> **un halo figé = des variables figées** — ni un problème de CSS, ni une
> animation oubliée.

---

## 1. La cause, nommée

### 1.1 Les trois hypothèses du départ, tranchées une par une

| Hypothèse | Verdict |
|---|---|
| **A. L'horloge s'arrête** (la boucle `requestAnimationFrame` meurt) | **NON.** Le mètre tourne tant qu'il est armé ; `planifier()` se réarme à chaque image, et rien ne l'annule pendant une lecture (seul `exitVocal` / la fin de lecture l'arrêtent). |
| **B. L'animation n'est pas relancée** | **NON.** En `.vocal-envelope-live`, le CSS fait `animation: none` : il n'y a **aucune** animation à relancer. Le mouvement vient exclusivement des variables écrites par le code. |
| **C. La source d'énergie se tarit — le plan de rythme n'a plus rien à dire** | **OUI. C'est la cause.** |

### 1.2 Le mécanisme exact

Pour la **voix du système** (`speechSynthesis`), la page ne reçoit **aucun flux
audio** : le halo ne peut pas mesurer la voix, il **simule** un rythme à partir
du texte (`speechRhythmUnits` + `rhythmIntensity`, `vocal-enveloppe-aigu.js`).
Ce plan a une **durée totale** (`total`) construite sur une hypothèse de débit :

```
RHYTHM_SYLLABLE_MS = 190 ms par syllabe   (+ accent final, + pauses de ponctuation)
```

`rhythmIntensity(units, position)` rend **0 au-delà de la dernière unité** — et
c'est voulu : après la fin du texte, c'est du silence, donc le repos. Le mètre
avance la position avec le temps réel de parole (`performance.now`) :

```js
energie = smoothEnvelopeEnergy(energie, rhythmIntensity(units, maintenant() - debut));
```

**Dès que la lecture réelle dure plus longtemps que le plan**, la position passe
la fin du texte, l'intensité tombe à 0 **et y reste** jusqu'à la fin de la
lecture : le halo se pose au repos, immobile, **alors que la voix continue**.
Plus la réponse est longue, plus la queue figée est longue. C'est exactement le
symptôme rapporté.

Facteur aggravant (même direction, quelques secondes) : l'état « Pilot parle »
part à l'**annonce**, c'est-à-dire **avant le premier son** (`ensureVoices` peut
attendre jusqu'à 1,5 s, puis le moteur démarre). L'horloge du rythme consommait
donc du texte **avant** que la voix ne commence.

### 1.3 La preuve chiffrée : le plan est une **hypothèse**, et elle est fausse

Voix installée mesurée : **Microsoft Hortense (fr-FR)**, celle que `speechSynthesis`
utilise dans WebView2 sur ce poste — même moteur SAPI, même débit par défaut.
Protocole : le texte est découpé **exactement comme Pilot le lit**
(`splitSentences(textForSpeech(texte))`, morceaux de 180 caractères au plus), puis
chaque morceau est prononcé dans un WAV dont on lit la taille du bloc `data`
rapportée au débit d'octets de l'en-tête RIFF → durée réelle au millième.

| Texte | Morceaux | Plan (`total`) | Voix réelle | Écart | Conséquence |
|---|---|---|---|---|---|
| Prose courte (235 car.) | 1 | 18 266 ms | 15 327 ms | plan **19 % trop long** | aucun figeage (le halo court encore quand la voix s'arrête) |
| Prose naturelle (633 car.) | 5 | 49 186 ms | 41 675 ms | plan **18 % trop long** | aucun figeage |
| **Extrait de spec** (816 car. : chemins de fichiers, tableaux, dates, mots anglais) | 5 | 59 458 ms | **80 464 ms** | voix **35 % plus longue** | **halo figé sur les 21 dernières secondes** (26 % de la lecture) |
| En-tête de spec (255 car. : « §8 », « 2026-07 », « wry »…) | 2 | 16 558 ms | **27 039 ms** | voix **63 % plus longue** | **halo figé sur les 10,5 dernières secondes** (39 %) |

Deux régimes, et c'est tout le problème : sur de la **prose simple**, le plan est
**trop long** (aucun figeage, léger avance) ; sur du **texte technique** — ce que
lit le plus souvent l'assistant : noms de fichiers, identifiants, chiffres,
anglais, sigles — le moteur **épelle** et la lecture réelle **dépasse le plan de
35 à 63 %**. La position arrive au bout, l'intensité reste à 0, le halo se fige.

### 1.4 Et la voix locale du poste ?

**Aucun figeage de ce type** — et c'est vérifié, pas supposé : la voix locale
(Piper / VoiceStudio) **livre le son**, donc le mètre du **son** mesure la bande
haute (≥ 4 kHz) du flux réellement joué (`createMediaElementSource` +
`AnalyserNode`). L'espion du son (`setLocalVoiceAudioTap`) est tendu **à chaque
élément audio créé** (`local-voice.js`, `playUrl`) : chaque morceau re-arme
l'analyseur et la boucle, sans limite de durée. Le seul artefact visible est un
**retour au repos à la frontière de deux morceaux** (le mètre publie 0 quand le
morceau finit) : c'est le silence réel entre deux phrases, donc il est **juste**
— il ne faut pas l'effacer (§ 4).

Les deux sources sont verrouillées par test (§ 6).

---

## 2. La correction (minimale, une seule décision de source)

Règle tenue : **une seule source pilote l'enveloppe à la fois**
(`planSpeechEnvelopeSource`), aucune valeur posée en mouvement réduit, jamais de
mouvement sans mesure ni sans texte.

### 2.1 Le plan de rythme ne peut plus s'épuiser pendant que la voix parle

`createSpeechRhythmMeter` (le mètre du rythme) garde désormais `total` et
**ramène la position dans le texte** :

```js
// tant que la parole dure, le motif du texte continue de respirer
const position = total > 0 ? ecoule % total : ecoule;
```

Le motif du texte est donc **rejoué** autant de fois que la lecture l'exige : le
halo respire du premier au dernier mot, **quelle que soit la durée**. Rien
d'autre ne change : mêmes unités, même intensité (`rhythmIntensity` est
intacte), même amplitude, même lissage, même peintre. En particulier le
**retour au repos** entre deux unités (pause de ponctuation) et à la **fin de la
lecture** est conservé : un silence réel donne toujours un halo au repos.

### 2.2 L'horloge du rythme part avec le **premier son**, pas avec l'annonce

`READ_ALOUD_SOUND_EVENT` — l'instant du premier échantillon audible, déjà émis par
`read-aloud.js` et déjà écouté par l'écran pour la coupure de parole — **recale**
l'horloge du rythme (`reancrer()`), au lieu de laisser le plan consommer du texte
pendant la préparation du moteur. Le signal existant est réutilisé : **aucun
second mécanisme de lecture**, aucun nouveau seuil.

---

## 3. Ce qui change à l'écran

| Situation | Avant | Après |
|---|---|---|
| Lecture courte (prose) | halo qui suit la voix | **identique** |
| Lecture longue, voix du système | halo **figé** dès la fin du plan (jusqu'à 39 % de la lecture) | halo qui **respire jusqu'au dernier mot** |
| Pause de ponctuation, silence entre deux phrases | repos | **identique** (repos) |
| Fin de lecture, silence, changement d'écran | repos | **identique** (repos) |
| Voix locale (Piper / VoiceStudio) | mesurée sur le son réel | **identique** |
| Mouvement réduit | aucune valeur posée | **identique** |
| Taille, couleur, forme, transparence du halo | — | **identiques** (aucune ligne de CSS modifiée) |

---

## 4. Ce que cette correction ne fait pas (assumé, écrit noir sur blanc)

- **Le débit reste une hypothèse.** Le motif avance à 190 ms/syllabe : sur un
  texte technique lu lentement, le halo ne bat pas *au même rythme* que la voix,
  il bat **tout le temps** et **sans jamais s'arrêter**. C'est le contrat de
  cette source (« la voix du système ne livre aucun son : Pilot dit *ça parle*,
  pas *ça dit ce mot* »), et c'est déjà ce que documentait
  `RAPPORT-halo-suivant-le-son.md` § 9.4. On ne corrige pas un débit inventé par
  un autre débit inventé.
- **Le repos entre deux morceaux de voix locale est conservé** : c'est du silence
  réel, l'effacer serait inventer du mouvement (§ 4 de la demande).

---

## 5. Verrous ajoutés

| Verrou | Ce qu'il interdit |
|---|---|
| `vocal-enveloppe-rythme.test.js` § 6 — « au-delà de la fin du plan, l'enveloppe CONTINUE de bouger » | le retour au repos figé quand la lecture dépasse le plan (échoue sur le code d'avant : la fenêtre des 1,5 dernières secondes ne contient que des 0) |
| `vocal-enveloppe-rythme.test.js` § 6 — « l'arrêt ramène le repos » | un halo qui continue de bouger après la fin de la lecture |
| `vocal-enveloppe-rythme.test.js` § 6 — « l'horloge repart du premier son » | le retour du décalage annonce → son |
| `vocal-enveloppe-aigu.test.js` § 6 — « une lecture locale longue (plusieurs morceaux) ne fige jamais l'analyseur » | la perte de l'espion du son au deuxième morceau (l'autre source, vérifiée) |

---

## 6. Preuves exécutées (chiffres réels)

| Commande | Résultat |
|---|---|
| `npx vitest run src/js/vocal-enveloppe-aigu.test.js` | **34** tests, **0** échec |
| `npx vitest run src/js/vocal-enveloppe-rythme.test.js` | **25** tests, **0** échec |
| `npm test` (suite front complète) | **300** fichiers, **5584** tests, **0** échec |

**Le verrou échoue bien sur le code d'avant** — preuve faite en remettant
`return ecoule;` à la place de `return ecoule % total;` :

```
× 6. une parole PLUS LONGUE que le plan ne fige jamais le halo
  > au-dela de la fin du plan, l'enveloppe CONTINUE de respirer
AssertionError: expected 8.563537453803482e-13 to be greater than 0.1
→ 1 failed | 24 passed
```

C'est **exactement** le symptôme rapporté, chiffré : l'enveloppe vaut
8,6 × 10⁻¹³ — c'est-à-dire **au repos, immobile** — alors que la lecture dure
toujours. Aucun test existant n'a été modifié ni assoupli, et aucun numéro de
version n'a été touché.

---

## 7. Commandes

```bash
npx vitest run src/js/vocal-enveloppe-rythme.test.js src/js/vocal-enveloppe-aigu.test.js
npm test          # suite front complète
```

---

## 8. Re-vérification du 2026-11-04 (chiffres réels, mutation rejouée)

Le correctif est en place au commit `6850cb2` (`fix(vocal): le halo ne se fige
plus sur une parole longue`). Nouvelle passe de vérification, sans rien changer
au code :

| Point vérifié | Preuve |
|---|---|
| La position est bien ramenée dans le texte | `src/js/vocal-enveloppe-aigu.js:845` → `return ecoule % total;` |
| L'horloge repart du premier son | `src/js/super-agent.js:7799` → `vocalRhythmMeter.reancrer()` dans `onVocalReadAloudSound` |
| Le verrou échoue sur le code d'avant | mutation temporaire `return ecoule;` → **1 failed \| 24 passed** (« au-delà de la fin du plan, l'enveloppe CONTINUE de respirer » : `expected 8.56e-13 to be greater than 0.1`), puis fichier restauré (`git status` propre, la ligne `% total` est revenue) |
| Tests ciblés | `npx vitest run src/js/vocal-enveloppe-rythme.test.js src/js/vocal-enveloppe-aigu.test.js` → **59** tests, **0** échec (25 rythme + 34 aigu) |
| Suite front complète | `npm test` → **300** fichiers, **5594** tests, **0** échec |
| Suite Rust complète | `cargo test --workspace` → **1075** passés, **14** ignorés, **0** échec (6 suites) |
| Aide intégrée | `npm run build:handbook` → 48 blocs, 343 347 octets, **aucun diff** : la précision ajoutée à `spec_modes_ecran_vocal.md` vit hors des blocs `<!-- HELP:* -->`, l'aide utilisateur reste donc inchangée |

Aucun numéro de version, aucun tag, aucune publication touchés ; aucun test
existant modifié ou assoupli ; aucun seuil audio changé ; apparence du halo
(taille, couleurs, forme, peintre) inchangée.
