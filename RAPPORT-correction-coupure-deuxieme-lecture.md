# Correction — la deuxième lecture redevient interruptible

> Suite de `RAPPORT-diagnostic-coupure-deuxieme-lecture.md` (verdict : cause (b),
> le **moment** de la mesure ; aggravée par (d), le verrou `declenche`).
> Correctif `c678bf5` conservé. Aucun seuil de décision n'a changé de valeur.

---

## 0. Résumé en six lignes

1. **Cause principale corrigée** : la référence de lecture (résidu d'écho **et**
   référence du secours) ne se prend plus sur la fenêtre d'ouverture entière
   (`BARGE_IN_CALIBRATION_MS` = 600 ms) mais sur l'**attaque du son**, les
   `BARGE_IN_MIN_MS` (200 ms) premières millisecondes — **une constante déjà
   présente**, dont la valeur n'a pas bougé.
2. Le reste de la fenêtre **continue d'interdire de couper** (le son de Pilot
   n'est pas jugé avant que son seuil existe) mais **n'émet plus aucune mesure**.
3. Ce n'est pas un second mécanisme : **une seule mesure, une seule référence,
   une seule décision par lecture**. Le correctif `c678bf5` est fusionné, pas
   dupliqué — son secours s'appuie désormais sur une référence **propre**.
4. **Défaut n° 2 corrigé** : le verrou `declenche` n'est plus hérité d'une
   réflexion interrompue ; la garde est remise à zéro **aux deux** transitions de
   lecture et à la fin d'une réflexion.
5. **Effet pour l'utilisateur, dit à l'oral** : une voix franche et continue fait
   taire Pilot à **chaque** lecture — la deuxième, la troisième, la dixième comme
   la première — et non plus seulement la première d'une session.
6. **Défaut n° 3 non corrigé, volontairement** : le `return` sur `voiceActive`
   (`src/js/super-agent.js:4711`) reste en l'état ; c'est une décision du
   propriétaire (§6).

---

## 1. Ce qui a changé, et où

`src/js/vocal-mic.js` — **un seul fichier de code** touché (+47 / −25).

### 1.1 La mesure se prend sur l'attaque (`stepSpeechGate`, branche « calibrage »)

```js
if (suivant.calibreMs - dt < BARGE_IN_MIN_MS) {
  suivant.residuel = Math.max(suivant.residuel, m);
  suivant.refSecours = Math.max(suivant.refSecours, m);
}
```

Avant, ces deux lignes s'exécutaient sur **toute** la fenêtre. Conséquence, telle
que mesurée par le diagnostic : à la **première** lecture le moteur de voix est
froid, le son arrive **après** la fenêtre, la fenêtre est du silence ⇒ résidu
faible ⇒ garde armée ⇒ la voix coupe en 200 ms. À la **deuxième**, le moteur est
chaud, le son de Pilot démarre dans la fenêtre et la voix de l'utilisateur
par-dessus ⇒ `residuel` = `refSecours` = 0,2–0,4 ⇒ garde désarmée **et**
référence du secours égale à la voix elle-même ⇒ aucune voix ne peut dépasser son
propre double ⇒ plus jamais coupable.

**Pourquoi l'attaque** : c'est la seule portion de la fenêtre où le son entendu ne
peut pas encore être une **réaction** de l'utilisateur — il vient juste
d'entendre Pilot commencer. Après, tout ce qui monte est au mieux un mélange.

**Aucune constante n'a changé** : `BARGE_IN_CALIBRATION_MS` reste 600 (durée de la
fenêtre où l'on ne coupe jamais), `BARGE_IN_MIN_MS` reste 200 (durée de voix
continue exigée, et désormais **aussi** durée de la mesure),
`BARGE_IN_MIN_LEVEL` 0,05, `BARGE_IN_RESIDUAL_MAX` 0,03 (0,01 sans preuve),
`BARGE_IN_FALLBACK_MS` 1000, marges 1,8 et 2. Aucune constante nouvelle.

### 1.2 Une mesure neuve à chaque lecture, jamais de verrou hérité

- `setSpeaking(actif)` (`vocal-mic.js:827`) remet la garde à zéro (`garde =
  emptySpeechGate(); dernierTemps = 0;`) à **chaque** changement d'état, début
  comme fin de lecture. Avant, seule la **fin** remettait à zéro.

### 1.3 Le verrou de la réflexion ne survit plus (défaut n° 2)

- `setThinking(actif)` (`vocal-mic.js:847`) remet la garde **entièrement** à zéro
  à la fin d'une réflexion ; il ne réinstalle plus `declenche` d'un état à
  l'autre. Un utilisateur qui parle pendant la réflexion (ce qui coupe le tour —
  fonctionnalité voulue) ne laisse plus une lecture suivante **incoupable**.
  Dans la réflexion elle-même, le réarmement « quand la voix retombe » (§6.2 de
  la spec) est intact.

### 1.4 Ce qui n'a pas bougé

- Le module micro ne fait **toujours qu'une seule** capture (`getUserMedia` une
  seule fois dans le fichier), ne crée aucun lecteur, ne prend aucune seconde
  mesure.
- Aucune protection anti-écho retirée : la preuve d'annulation reste demandée,
  relue à chaque lecture, et son `false` interdit toujours la voie normale.
- L'écran Vocal, ses phrases visibles, son apparence, l'objet lumineux, le délai
  d'envoi et la brièveté des réponses : **inchangés**.
- Les seuils, durées et marges : **inchangés** (§0.1).

---

## 2. Ce qui est gardé de `c678bf5`

`c678bf5` (« relecture de la preuve d'annulation d'écho à chaque lecture » +
« garantie de secours ») est **nécessaire et conservé tel quel** :

- la preuve d'annulation est **relue** à chaque début de lecture, sur la piste
  déjà ouverte (`echoCancellationOf`) — aucune seconde capture ;
- la **garantie de secours** existe toujours et reste prioritaire sur l'échec
  silencieux : quand le résidu dépasse la tolérance, une voix qui dépasse le
  **double** de la référence et le tient 1000 ms coupe quand même.

Ce qui change pour elle : **sa référence**. Elle ne se prend plus sur la fenêtre
entière (où la voix de l'utilisateur pouvait entrer et devenir « le son de
Pilot »), mais sur l'attaque du son. Une référence qui ne peut plus être
polluée par celui qui veut couper. C'est exactement le point que le diagnostic
désignait comme « insuffisant » dans `c678bf5`, et il est corrigé ici plutôt que
contourné : aucune duplication, aucun second mécanisme, un seul calcul.

---

## 3. Les cinq vérifications demandées

Toutes les vérifications sont **au niveau de la garde elle-même** (fonction pure
`stepSpeechGate`, images de 16 ms, même code que la production). Elles **ne
prouvent pas** le niveau d'écho réel d'une pièce : c'est le seul point qui reste
à relever au vrai micro (§5).

| # | Ce qui devait être vrai | Test qui le tient | Résultat |
|---|---|---|---|
| 1 | **Voix franche et continue : coupe la 1ʳᵉ ET la 2ᵉ, dix fois de suite** | `6. DEUX lectures d'affilee : la SECONDE doit etre coupable (moteur chaud), et la 3e aussi` + `6. dix lectures d'affilee : la voix franche coupe a CHAQUE fois, meme latence` | ✅ 1ʳᵉ : coupure 200 ms après la voix. 2ᵉ (moteur chaud, son dès la 1ʳᵉ image, voix à 350 ms) : **coupée**. 3ᵉ : coupure à la **même milliseconde** que la 2ᵉ. Dix lectures : 10 coupures, **une seule latence distincte** (jeu de valeurs de taille 1). |
| 2 | **Le son de Pilot SEUL ne coupe jamais, même fort et long** | `6. le son de Pilot SEUL ne coupe jamais, meme fort et long` + contre-épreuve de la 2ᵉ lecture (`6. CONTRE-EPREUVE : la meme 2e lecture SANS voix ne coupe jamais`) | ✅ 15 s à 0,3 (preuve d'écho vraie **et** fausse) : aucune coupure. 10 s à 0,04 avec le son dès la 1ʳᵉ image (le cas de la 2ᵉ lecture, sans voix) : aucune coupure, référence restée à 0,04. Montée modérée 0,04 → 0,07 : aucune coupure. |
| 3 | **Voix douce ou brève : ne coupe pas** | `6. une voix douce ou breve ne coupe pas, meme moteur chaud` | ✅ Voix à 0,045 (sous le plancher 0,05) tenue 3 s : aucune coupure. Claquement d'une image à 0,9 : aucune coupure. |
| 4 | **La réflexion reste interruptible** | `6. la reflexion reste interruptible apres une lecture` + `6. le verrou… / parler pendant la reflexion, puis la lecture` (+ suite existante `vocal-couper-la-reflexion.test.js`, inchangée) | ✅ Réflexion seule : coupure après 200 ms de voix. Réflexion **après** une lecture coupée : coupe encore. Verrou posé pendant la réflexion puis **lecture** : la lecture est coupée (2 prises de parole, pas 1). |
| 5 | **Une seule coupure par lecture** | `6. une seule coupure par lecture, meme si la voix continue` | ✅ 5 s de voix continue au-dessus du seuil : **1** déclenchement. |

Deux tests de **source** verrouillent la forme du correctif (pas seulement son
effet) :

- `6. la reference ne se prend QUE sur l'attaque (lecture du source)` : la
  condition `calibreMs - dt < BARGE_IN_MIN_MS` est présente, la référence du
  secours n'a **qu'une** écriture, une seule capture, aucune constante ajoutée ;
- `7. les remises a zero sont aux memes endroits que les autres (lecture du
  source)` : plus aucun `declenche: garde.declenche`, et la remise à zéro est
  bien dans `setSpeaking` **et** dans `setThinking`.

Et un test de **non-régression des valeurs** : `6. aucun seuil de decision n'a
change de valeur` (600 / 200 / 0,05 / 0,03 / 0,01 / 1000 / marges 1,8 et 2).

---

## 4. Commands et résultats

```bash
cd /g/IA_PL/pilot

# 1. Tests vocaux (les quatre fichiers de la fonctionnalité + les deux voisins)
npx vitest run src/js/ecran-vocal-lot4a.test.js src/js/ecran-vocal-lot3.test.js \
  src/js/vocal-couper-la-reflexion.test.js src/js/vocal-parler-declenche-une-demande.test.js \
  src/js/read-aloud.test.js src/js/envoi-auto-fin-dictee.test.js
# → PASS (202) FAIL (0)

# 2. Preuve que les nouveaux tests attrapent bien l'ancien comportement
#    (correctif neutralisé : mesure sur toute la fenêtre + `declenche` conservé)
npx vitest run src/js/ecran-vocal-lot4a.test.js
# → 5 failed | 39 passed
#    × DEUX lectures d'affilee : la SECONDE doit etre coupable (moteur chaud)…
#    × une seule coupure par lecture, meme si la voix continue
#    × la reflexion reste interruptible apres une lecture
#    × la reference ne se prend QUE sur l'attaque (lecture du source)
#    × les remises a zero sont aux memes endroits que les autres (lecture du source)
#    (correctif restauré ensuite : PASS (44) FAIL (0))

# 3. Aide embarquée régénérée après la mise à jour des specs
npm run build:handbook
# → help/handbook.md généré (46 blocs)

# 4. Suite frontend COMPLÈTE (après rédaction de ce rapport)
npm test
# → Test Files 211 passed (211) | Tests 3895 passed (3895)
```

Un premier passage de la suite complète a signalé **un** échec, dans
`src/js/source-slice.test.js` : le nouveau test de source découpait `MIC` par un
`slice(indexOf(...))` non protégé, ce que l'inventaire du projet interdit (un
découpage faux rendrait l'assertion vraie par construction). Corrigé en
utilisant le garde-fou du projet (`sliceSource`, ancres vérifiées) : la suite
repasse verte, et le plafond de l'inventaire n'a pas été desserré.
```

Aucun test existant n'a été affaibli. Un seul groupe de tests a été **ajouté** au
fichier déjà utilisé pour ces règles (`src/js/ecran-vocal-lot4a.test.js`,
sections 6 et 7) ; aucun test existant n'a été modifié ou supprimé. Aucun test
ne décrivait explicitement l'ancien comportement « la mesure porte sur les 600
ms » : c'est une **documentation** (specs et en-tête du module) qui le disait, et
elle a été corrigée (§5).

---

## 5. Documentation mise à jour

- `spec_read_aloud.md` §1 (garde n° 2) : la référence se prend **sur l'attaque**,
  la fenêtre de 600 ms ne mesure plus ; la raison (froid/chaud) est dite ; ajout
  explicite : **une voix franche et continue coupe chaque lecture,
  indéfiniment**, et aucun verrou ne peut être hérité.
- `spec_modes_ecran_vocal.md` §6.1 : même correction ; ajout de la promesse
  « à chaque lecture » ; §6.1 (garantie de secours) : référence gelée **sur
  l'attaque** ; §7 (tableau des cas voulus et limites) : la limite « vous parlez
  dans les 600 ms » devient **200 ms**, avec la précision que la lecture suivante
  repart d'une mesure propre (limite d'une lecture, pas d'une session).
- `help/overview.md` (bloc utilisateur concerné) : « une voix franche et continue
  finit toujours par le faire taire — **à chaque lecture**, la deuxième comme la
  première ». `help/handbook.md` régénéré.
- **La phrase d'état visible de l'écran Vocal n'a pas changé** (aucun texte
  d'interface modifié).

---

## 6. Ce qui n'est PAS corrigé — décision du propriétaire (défaut n° 3)

`src/js/super-agent.js:4711` :

```js
if (voiceActive) return; // dans vocalBargeIn
```

Tant qu'une session de dictée est marquée ouverte, `vocalBargeIn` sort **sans
rien faire** : aucune lecture n'est coupable, et **aucune ligne de trace n'est
écrite** (la trace est après ce `return`). La règle 3 de `vocal-conversation.js`
ferme bien la dictée pendant la parole de Pilot, mais cette fermeture passe par
`rec.stop()` + attente de `onend` (`vocalCloseForSend`) : si `onend` ne vient pas,
`voiceActive` reste vrai — et le défaut se produit.

**Non corrigé, volontairement** : le diagnostic le classe « possible, non
systématique, indissociable aujourd'hui », et la correction toucherait le
dialogue entre la dictée et la coupure (risque de couper Pilot sur les mots qu'on
lui dicte). **Relevé proposé avant toute décision** : écrire une ligne de trace
**avant** ce `return` (`bargeInReport()` appelé aussi dans ce cas) pour savoir si
ce chemin est réellement emprunté chez le propriétaire ; c'est le seul moyen de
distinguer (b)/(c) si le défaut revenait.

---

## 7. Risque résiduel, chiffré

| Risque | Ampleur | Pourquoi ce n'est pas corrigé |
|---|---|---|
| Vous parlez **dans les 200 premières ms** de la phrase | cette lecture-là n'est pas coupable (la suivante repart propre) | physique : votre voix est indistinguable du son de Pilot à cet instant. **Fenêtre réduite de 600 ms à 200 ms** (risque divisé par 3), pas supprimée. |
| Écho réel au-dessus de `BARGE_IN_RESIDUAL_MAX` (0,03 averé / 0,01 sans preuve) | la coupure passe par le **secours** : voix > **double** de la référence, tenue **1000 ms** | c'est la protection anti-écho : sans elle, Pilot se tairait sur son propre son. Latence mesurée dans les tests : ≈ 1,0 s après le début de la voix, ≈ 1,6 s après le début de la lecture. |
| Haut-parleurs si forts que votre voix ne dépasse jamais le double du son résiduel | aucune coupure possible pendant cette lecture | aucune séparation de sources dans un navigateur : seule une comparaison de niveaux est disponible. Casque = la solution. |
| Le son de Pilot **bondit** à plus du double et **s'y tient une seconde** sans creux | Pilot se coupe lui-même, une fois | prix assumé de la garantie de secours (inchangé depuis `c678bf5`), plus prudent que la voie normale (2× / 1000 ms contre 1,8× / 200 ms). |
| Défaut n° 3 (`voiceActive`) | une session de dictée qui ne se ferme pas rend une lecture incoupable, **sans trace** | §6 : décision du propriétaire, instrumentation proposée. |

**Ce que ces vérifications ne prouvent pas** : la valeur réelle du résidu et de la
preuve d'annulation d'écho sur la machine du propriétaire. Elle n'est lisible que
par `bargeInReport()` (une ligne de console est écrite à chaque coupure :
`[vocal] prise de parole : residu=… seuil=…`). Tant que ce relevé n'est pas fait,
le régime réel (voie normale à 200 ms, ou secours à 1000 ms) reste une
**probabilité**, pas une mesure.

---

VERDICT : la cause systématique du défaut est corrigée au bon endroit — la
référence de lecture se prend désormais sur l'**attaque du son** (`vocal-mic.js`,
une condition, aucune constante touchée) au lieu de la fenêtre entière, et le
verrou d'une prise de parole ne survit plus à la lecture suivante ; la 2ᵉ lecture
est coupable comme la 1ʳᵉ, vérifié dix fois de suite, sans jamais couper sur le
son de Pilot seul, sans affaiblir aucun test existant et sans toucher à l'écran.
`c678bf5` est conservé et son secours s'appuie enfin sur une référence propre. Le
défaut n° 3 (`if (voiceActive) return;`) reste ouvert **par décision**, avec
l'instrumentation qui permettrait de le trancher.
