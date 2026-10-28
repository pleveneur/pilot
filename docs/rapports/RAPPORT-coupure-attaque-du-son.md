# Rapport — « Pilot se coupe au début de la lecture » : la fenêtre s'ouvre sur le début du son

> ## § 0 — Constat de reprise de mission (28/10, vérification disque AVANT toute écriture)
>
> La mission a été **relancée** alors que le correctif était **déjà en place,
> testé, documenté et commité** (`44c7f65`, « fix(vocal): la fenetre de mesure
> s'ouvre sur le debut du son, pas sur l'annonce »). Conformément à la consigne
> (« si la correction est déjà en place et testée, ne la refais pas »), **rien
> n'a été réécrit** : ce § 0 est le seul ajout, et il consigne l'état réel
> relevé sur le disque.
>
> **Ce qui atteste que le correctif est complet :**
>
> | Exigence de la mission | État vérifié sur le disque |
> |---|---|
> | Fenêtre de mesure ouverte sur le **vrai début du son** | `vocal-mic.js:872` `setSoundStarted()` (`garde = emptySpeechGate(); dernierTemps = 0;`, une seule fois par lecture) |
> | Signal émis par le lecteur au premier échantillon audible | `read-aloud.js:148` `READ_ALOUD_SOUND_EVENT`, émis par `annoncerSon()` (`read-aloud.js:803`) sur `utterance.onstart` / démarrage réel de la voix locale |
> | Branchement complet | `super-agent.js:5043` (abonnement) → `vocalMic.setSoundStarted()` ; désabonnement `super-agent.js:5513` |
> | **Une seule** piste retenue | option **(b)**, justifiée au § 2 (l'option (a) rendrait la détection circulaire et exigerait un seuil de plus) |
> | Aucun seuil de décision déplacé | `ecran-vocal-lot4a.test.js` « aucun seuil de décision n'a changé de valeur » (600 / 200 / 0,05 / 0,03 / 0,01 / 1000, marges 1,8 et 2) : **vert sans retouche** |
> | Les **trois** tests exigés existent | (i) `vocal-son-commence.test.js` § 1 « son demarre a 1500 ms » × echo `true`/`false`/`null` ⇒ **0 coupure** ; (ii) § 2 « son immediat puis voix de l'utilisateur » ⇒ **1 coupure**, motif `voix-detectee` ; (iii) § 3 « dix lectures d'affilee : dix coupures » + « un signal tardif ne rouvre PAS la fenetre » |
> | Docs à jour | `spec_read_aloud.md:77-82` et `spec_modes_ecran_vocal.md:262-264` décrivent la fenêtre ouverte sur le début du son ; `npm run build:handbook` **ne produit aucun diff** (handbook déjà à jour) |
> | Un seul commit | `44c7f65` |
>
> **Preuve rouge refaite à l'instant** (neutralisation de `setSoundStarted` : le
> drapeau est posé mais la fenêtre n'est plus rouverte), puis restauration
> (`git status` vide sur le fichier) :
>
> ```
> # neutralisé          → PASS (11) FAIL (4)
>   AssertionError: expected [ { …(3) } ] to have a length of +0 but got 1   (echo=true)
>   AssertionError: expected [ { …(3) } ] to have a length of +0 but got 1   (echo=false)
>   AssertionError: expected [ { …(3) } ] to have a length of +0 but got 1   (echo=null)
>   AssertionError: expected 'function setSoundStarted() {\n    if …' to match /garde = emptySpeechGate\(\)/
> # restauré           → PASS (15) FAIL (0)
> ```
>
> *(traduction : sans le correctif, le son de Pilot tardif déclenche **une**
> prise de parole — il se coupe lui-même.)*
>
> **Compteurs RECOMPTÉS ce jour** (aucun chiffre repris d'un contexte antérieur) :
>
> ```
> npx vitest run src/js/vocal-son-commence.test.js                      → PASS (15) FAIL (0)
> batterie vocale ciblée (10 fichiers)                                  → PASS (280) FAIL (0)
> npx vitest run  (suite front complète)                                → PASS (3993) FAIL (0)
> ```
>
> Conclusion : **rien à corriger**, aucun fichier de code touché par cette
> reprise. Le corps ci-dessous est le rapport d'origine, conservé tel quel.

**Mission** : corriger la réserve du rapport de vérification de la coupure à la
deuxième lecture (verdict READY pour l'essai du propriétaire, avec une réserve
chiffrée), **sans** changer aucun seuil de décision.
**Périmètre** : `src/js/read-aloud.js`, `src/js/local-voice.js`,
`src/js/vocal-mic.js`, `src/js/super-agent.js`, un fichier de tests dédié, deux
specs, l'aide intégrée. Un seul commit.

---

## 1. Le défaut — le miroir exact de celui corrigé en `6883eab`

Le correctif précédent avait rendu la 2ᵉ lecture coupable en limitant la mesure
du son de Pilot à l'**attaque du son** (200 ms) au lieu des 600 ms de la fenêtre.
Il restait un défaut symétrique : **cette fenêtre s'ouvrait sur l'annonce, pas
sur le son**.

Chronologie réelle d'une lecture (`read-aloud.js`) :

| Instant | Ce qui se passe |
|---|---|
| t = 0 | `notify("speaking")` → l'écran croit « Pilot parle » → `vocalMic.setSpeaking(true)` → **fenêtre de 600 ms ouverte** |
| t = 0 → 1500 ms | `ensureVoices(synth, waitMs)` attend le chargement des voix (jusqu'à **1500 ms**) |
| t = variable | voix locale (Piper) : le premier morceau est **synthétisé par un processus** avant de sonner |
| t ≫ 600 ms | **le premier son sort enfin** |

Quand le son démarre après la fenêtre — **première lecture à froid**, et **voix
locale** de façon systématique — la référence mesurée pendant l'attaque est du
**silence** :

- résidu mesuré = 0 → seuil normal = `max(0,05 ; 0 × 1,8)` = **0,05** ;
- référence de secours = 0 → seuil de secours = `max(0,05 ; 0 × 2)` = **0,05**.

Le son de Pilot, constant et seul en cause, dépasse alors un seuil posé au
plancher : il se coupe **lui-même**. Voie normale : 200 ms de son continu
suffisent ; voie de secours : 1000 ms. C'est exactement le symptôme rapporté
(« Pilot se coupe au début de la lecture »), et il est **pire** avec la voix
locale (synthèse plus longue que la fenêtre) qu'avec la voix du système.

Aucune valeur de seuil n'était en cause : c'est le **moment** de la mesure qui
était faux.

---

## 2. La solution retenue — option (b) : le lecteur dit « le son commence »

Deux options étaient proposées. **J'ai retenu la (b)**, et une seule des deux :

> (b) `read-aloud.js` émet un signal « le son commence », au tout premier
> échantillon audible ; la garde du micro rouvre sa fenêtre de mesure à cet
> instant-là.

### Pourquoi (b) et pas (a)

- **(a) — ouvrir la fenêtre sur le premier son détecté *dans* `stepSpeechGate` —
  est un contresens.** Le signal du micro ne sait pas distinguer « le son de
  Pilot commence » de « l'utilisateur parle » : c'est précisément la question que
  la garde doit trancher. Faire dépendre l'ouverture de la fenêtre de la grandeur
  qu'on veut mesurer rendrait la détection **circulaire** : une voix qui parle
  dans la première seconde rouvrirait la fenêtre et s'auto-protégerait. Il
  faudrait introduire un seuil de « début de son » — donc **une valeur de plus**,
  ce que la mission interdit.
- **(b) ne consomme aucun seuil** : l'information vient du **lecteur**, qui sait
  exactement quand il commence à sonner. Elle traverse un évènement dédié, sans
  toucher à la garde pure (`stepSpeechGate` est inchangée au caractère près),
  sans second lecteur, sans seconde capture du micro.
- **(a) serait aussi inapplicable hors mode Vocal** : le micro n'y est pas
  ouvert, alors que le lecteur, lui, existe partout — le signal doit venir du
  lecteur.

### Ce qui a été implémenté

1. `read-aloud.js` — nouvel évènement **`READ_ALOUD_SOUND_EVENT`**
   (`"pilot-read-aloud-sound"`), émis **une seule fois par lecture**
   (`annoncerSon`, verrou `sonAnnonce` + `token.stopped`) :
   - voix du système : `utterance.onstart` (le premier `onstart` réellement
     émis) ;
   - voix locale : `playLocalChunks({ onSoundStart })` → `local-voice.js`
     `playUrl(..., onSoundStart)`, qui l'appelle à l'évènement `playing` **ou** à
     la résolution de `play()` — deux signaux, un seul annoncement (drapeau
     `debutAnnonce`).
2. `vocal-mic.js` — **`setSoundStarted()`** : rouvre la fenêtre de mesure
   (`garde = emptySpeechGate()`, `dernierTemps = 0`) **à cet instant**, une seule
   fois par lecture (drapeau `sonCommence`), et seulement pendant une lecture
   (`if (!parlant) return`). `setSpeaking` et `liberer` remettent `sonCommence` à
   `false`. `bargeInReport()` expose `sonCommence` (chiffre d'essai).
3. `super-agent.js` — abonnement à `READ_ALOUD_SOUND_EVENT` → `vocalMic.setSoundStarted()`,
   désabonnement à la sortie de l'écran, à côté de l'abonnement existant à
   `READ_ALOUD_STATE_EVENT` (aucun second mécanisme de lecture ni de capture).

L'annonce **garde** sa fenêtre provisoire : si un moteur ne dit jamais « je
parle », le comportement reste celui d'avant — le correctif **ajoute** un
ancrage, il n'en retire aucun.

---

## 3. Ce qui n'a PAS changé

- **Aucune valeur de seuil** : `600` (`BARGE_IN_CALIBRATION_MS`), `200`
  (`BARGE_IN_MIN_MS`), `0,05` (`BARGE_IN_MIN_LEVEL`), `0,03`
  (`BARGE_IN_RESIDUAL_MAX`), `0,01` (`BARGE_IN_RESIDUAL_UNPROVEN_MAX`), `1000`
  (`BARGE_IN_FALLBACK_MS`), marges `1,8` et `2` (`vocalEchoThreshold(0,05) = 0,09`
  et `fallbackThreshold(0,1) = 0,2` inchangés). Le test qui les gèle
  (`ecran-vocal-lot4a.test.js:788`) est **vert**, et un test de plus verrouille la
  **liste des constantes exportées** (aucune ajoutée, aucune renommée).
- **La logique de coupure** : `stepSpeechGate` est inchangée au caractère près ;
  une voix franche et continue coupe toujours, la 2ᵉ, la 3ᵉ, la 10ᵉ comme la
  première ; le son de Pilot seul ne se coupe jamais ; un claquement d'une image
  ou une voix faible ne coupe pas.
- **L'apparence de l'écran Vocal** (objet lumineux, trait, teintes, barre de
  saisie déplacée), le cercle, les couleurs, le délai d'envoi, la longueur des
  réponses, le bouton « Outils » : **rien** n'a été touché.
- **Aucun réglage nouvel utilisateur**, **aucune dépendance**, **aucun test
  supprimé**, aucun fichier créé à la racine du projet, aucun autre fichier
  modifié (les modifications non commitées des autres missions — fenêtres noires,
  file de tâches — n'ont pas été approchées).

---

## 4. Les tests ajoutés — `src/js/vocal-son-commence.test.js` (15 tests)

Sources lues avec normalisation CRLF (piège CI Windows, `AGENTS.md` §3.4).

| # | Ce qui est prouvé |
|---|---|
| 1 | **son qui démarre 1500 ms APRÈS l'annonce** (1ʳᵉ lecture à froid, voix locale), pour `echoCancellation` = `true`, `false` **et** `null` : **aucune** coupure automatique ; la référence vaut bien le son de Pilot (0,35) et le seuil est au-dessus |
| 1 bis | ce même son tardif : une **vraie** voix par-dessus coupe quand même |
| 2 | son qui démarre **tout de suite** puis voix de l'utilisateur : **une** coupure, `voix-detectee`, pas d'auto-coupure avant |
| 3 | **dix lectures d'affilée, chacune ouverte sur le son → dix coupures** (une par lecture) |
| 3 bis | un **signal tardif** ne rouvre pas la fenêtre : une seule coupure, référence inchangée |
| 3 ter | hors lecture, le signal ne fait **rien** |
| 4 | `read-aloud.js` émet le signal **après** l'annonce et **une seule fois** sur trois morceaux |
| 4 bis | une synthèse qui n'émet jamais `onstart` → **aucun** signal (rien n'a sonné) |
| 4 ter | voix locale : le signal part au **démarrage de la lecture audio**, pas à la synthèse |
| 5 | liste des constantes `BARGE_IN_*` inchangée, `calibreMs - dt < BARGE_IN_MIN_MS` toujours présent une seule fois, `setSoundStarted` ne nomme **aucun** seuil, branchement complet (read-aloud → écran → micro), **une seule** capture micro, `200` / `1000` inchangés |

### Preuve par neutralisation (les tests échouent sans le correctif)

Neutralisation 1 — `setSoundStarted` marque le signal mais **ne rouvre pas** la
fenêtre :

```
 ❯ src/js/vocal-son-commence.test.js (15 tests | 3 failed)
   × 1. … son demarre a 1500 ms, echo=true : aucune coupure automatique
     → expected [ { …(3) } ] to have a length of +0 but got 1
   × 1. … son demarre a 1500 ms, echo=false : aucune coupure automatique
     → expected [ { …(3) } ] to have a length of +0 but got 1
   × 1. … son demarre a 1500 ms, echo=null : aucune coupure automatique
     → expected [ { …(3) } ] to have a length of +0 but got 1
```

*(traduction : le son de Pilot déclenche **une** prise de parole — il se coupe
lui-même — exactement le défaut rapporté.)*

Neutralisation 2 — plus de `utterance.onstart = () => annoncerSon()` :

```
 ❯ src/js/vocal-son-commence.test.js (15 tests | 2 failed)
   × 4. … l'annonce part AVANT le son, le signal « son » apres, et une seule fois
     → expected -1 to be greater than 0
   × 5. … le signal est branche de bout en bout (read-aloud -> ecran -> micro)
     → expected '// read-aloud.js — Lecture a voix hau…' to match /utterance\.onstart = \(\) => annoncer…/
```

Les deux fichiers ont été restaurés ensuite (`git diff` ne montre que les
modifications voulues).

---

## 5. Ce qui reste incertain (à vérifier à l'essai du propriétaire)

1. **Le premier `onstart` n'est pas l'échantillon zéro.** Certaines plateformes
   l'émettent quelques dizaines de millisecondes après le début réel du son. La
   fenêtre s'ouvrirait alors un peu **après** le tout premier son ; la partie
   perdue est antérieure à la fenêtre, donc **non mesurée** — mais l'attaque
   mesure alors un son déjà établi, ce qui est le cas favorable. À confirmer en
   WebView2 par le journal `[vocal] prise de parole : residu=… seuil=…` et par le
   nouveau chiffre `sonCommence` de `bargeInReport()`.
2. **Voix locale** : le signal part de la résolution de `play()` (et/ou de
   `playing`). Si WebView2 résolvait `play()` **avant** l'émission du son (cas de
   certains buffers), la fenêtre s'ouvrirait quelques millisecondes trop tôt —
   conséquence bornée : le résidu mesuré serait un peu plus faible, jamais nul,
   puisque l'écart est de l'ordre du tampon audio et non de 1500 ms.
3. **Un moteur qui n'émettrait jamais `onstart`** (ni `playing`, ni résolution de
   `play()`) retombe sur le comportement antérieur (fenêtre ouverte à l'annonce).
   C'est un **repli assumé**, pas une régression : rien n'est pire qu'avant.
4. **Tout futur chemin de lecture** doit émettre `READ_ALOUD_SOUND_EVENT`, sinon
   il retombe dans le défaut. C'est verrouillé par le test 5 (branchement) mais
   seulement pour les chemins **actuels** : la règle est écrite dans les deux
   specs pour la suite.
5. Le ressenti (« Pilot se coupe-t-il encore au début ? ») ne se prouve pas en
   test unitaire : il demande l'essai réel avec haut-parleurs, micro intégré, puis
   casque — c'est l'objet de l'essai du propriétaire.

---

## 6. Non-régression — chiffres réels (après écriture de ce rapport)

Batterie ciblée (les suites vocales + la nouvelle), lancée avant la longue suite :

```
npx vitest run src/js/vocal-son-commence.test.js \
  src/js/ecran-vocal-lot4a.test.js src/js/ecran-vocal-lot3.test.js \
  src/js/ecran-vocal-lot2.test.js src/js/vocal-correctifs-revue.test.js \
  src/js/voix-locale.test.js src/js/voix-locale-choix.test.js \
  src/js/read-aloud.test.js src/js/reglage-voix-onglet-assistant.test.js \
  src/js/speech-text.test.js
→ PASS (280) FAIL (0)          dont 15 tests nouveaux
```

Batterie complète du front :

```
npx vitest run
→ PASS (3993) FAIL (0)
   (216 fichiers de tests : 210 src/js + 6 scripts — 3993 tests, 0 échec, 0 ignoré)
```

Aucun test existant n'a été modifié ni supprimé ; `src/js/ecran-vocal-lot4a.test.js`
(purge des constantes, garde pure, preuve d'annulation d'écho) et
`src/js/voix-locale.test.js` (lecture des morceaux locaux) sont **verts sans
retouche**, et `local-voice.js` ne change que la signature interne de `playUrl`
(4ᵉ paramètre optionnel : un appel à trois arguments se comporte exactement comme
avant).

### Vérification manuelle conseillée à l'essai (mode Vocal, haut-parleurs)

1. **Lecture à froid** (Pilot vient de démarrer) : lancer 🔊 sur une réponse
   longue, ne rien dire → la lecture va **jusqu'au bout**, elle ne se coupe plus
   seule.
2. **Voix locale** (⚙️ Options → Assistant → voix française locale) : même essai,
   la synthèse démarre après la fenêtre → **aucune** auto-coupure.
3. **Parler franchement par-dessus**, à la 1ʳᵉ, la 2ᵉ, la 3ᵉ lecture → **coupe
   chaque fois**.
4. **Claquer des doigts / dire un mot bref** → ne coupe pas.
5. Console : `[vocal] prise de parole : residu=… seuil=…` doit montrer un
   `residu` **non nul** (≈ le son de Pilot), pas `0`.
