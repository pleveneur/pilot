# RAPPORT — Cercle-égaliseur, **lot A seulement** : « les maths, invisibles »

Date : 28 octobre 2026. Projet : `G:\IA_PL\pilot`.
Document de référence : `CONCEPTION-cercle-equaliseur.md`.
Périmètre : **le calcul pur**, et rien d'autre. Aucun branchement, aucun écran, aucun style
touché, aucun réglage modifié. À l'usage, **rien ne change** : le module n'est importé par
personne (et un test le vérifie).

---

## 1. Ce qui a été écrit

| Fichier | Nature | Contenu |
|---|---|---|
| `src/js/vocal-equalizer.js` | **nouveau**, 1 module pur | lecture d'un WAV en mémoire, calcul des 32 bandes, géométrie des 32 zones, chemin fermé, lissage, décision d'affichage |
| `src/js/vocal-equalizer.test.js` | **nouveau**, 33 tests | WAV construit **à la main** + tous les points exigés du lot A |

Aucun autre fichier n'a été modifié : `git status --porcelain` ne montre que ces deux
ajouts (`??`), zéro `M`.

### Les exports du module (l'API que les lots suivants utiliseront)

Calcul :
`wavFromBase64`, `spectrumHighHz`, `spectrumBandBins`,
`spectrumTimelineFromSamples`, `spectrumTimelineFromDataUrl`,
`spectrumFrameInto`, `spectrumSmooth`.

Géométrie et dessin :
`spectrumZoneAngle`, `spectrumZoneRadius`, `spectrumZonePoint`, `spectrumPath`.

**L'unique décision d'affichage : `spectrumPlan`.**

Constantes (chiffres du document, exportées pour que les lots suivants n'aient pas à les
recopier) : `SPECTRUM_ZONES` 32, `SPECTRUM_LOW_HZ` 200, `SPECTRUM_HIGH_HZ` 8000,
`SPECTRUM_HIGH_RATIO` 0,45, `SPECTRUM_FPS` 30, `SPECTRUM_FFT` 512,
`SPECTRUM_FLOOR_DB` −80, `SPECTRUM_CEIL_DB` −30, `SPECTRUM_SILENCE` 0,03,
`SPECTRUM_RADIUS` 83, `SPECTRUM_AMPLITUDE` 16, `SPECTRUM_BOX` 216,
`SPECTRUM_CENTER` 108, `SPECTRUM_RISE` 0,5, `SPECTRUM_FALL` 0,12,
`SPECTRUM_HANN_GAIN` 0,5.

### « Un état, un mouvement »

`spectrumPlan(etats)` est la **seule** fonction qui décide, et elle décide de tout :

```js
spectrumPlan({ etat, enParole, reduit, valeurs })
  -> { dessiner, chemin, lueur, porteur }
```

- `porteur` vaut `"contour"`, `"lueur"`, `"enveloppe"` ou `""` : **une voix, un afficheur**.
- `dessiner && lueur` est **structuralement impossible** (la lueur n'existe que si le
  contour ne peint rien) et un test le vérifie sur toutes les combinaisons d'états et de
  valeurs (fourchettes × mouvement réduit).
- Le contrat du document (`{ dessiner, chemin }`) est rendu **tel quel** ; `lueur` et
  `porteur` sont **additifs** — rien du document n'est renommé.
- Le repli du §7.3 est appliqué : en parole, si le son n'est pas analysable (silence), le
  contour est retiré et c'est l'**enveloppe** qui porte la voix.

### « Aucune allocation par image »

- `spectrumFrameInto(timeline, index, cible)` écrit dans la **cible fournie** et **rend
  cette cible** (identité vérifiée par test `toBe`). Aucun `new`, aucun `.slice`, aucun
  `Array.from` dans son corps — un test lit son corps avec `sliceSource` et le prouve.
- `spectrumSmooth(etat, valeurs)` écrit dans l'**état fourni**, même garantie.
- L'analyse coûteuse (FFT) est faite **une seule fois** à la construction de la ligne de
  temps ; le travail par image se réduit à recopier 32 nombres (mesuré : **0,12 µs**).
- Mesure du tas sur 20 000 images : delta **négatif** (bruit du ramasse-miettes), aucune
  croissance. Le seul objet alloué par image est la chaîne du chemin SVG, inévitable pour
  écrire l'attribut `d`.

### « Silence »

`spectrumPath(valeurs)` rend `""` dès que `max(v) < 0,03` : **aucun chemin**, donc aucun
contour, le cercle reste **net** (§5.5). Testé au silence exact, sous le seuil (0,029), au
seuil, juste au-delà (0,031), avec une zone seule allumée, et avec des entrées
inutilisables (`null`, `[]`, tableau trop court, `NaN`) — jamais d'exception.

---

## 2. Chiffres repris du document (aucune valeur inventée)

| Ce que dit le document | Où | Repris tel quel dans le module |
|---|---|---|
| disque 168 px, anneau 2 px ⇒ rayon médian **R0 = 83 px** | §5.1 | `SPECTRUM_RADIUS = 83` |
| amplitude **A = 16 px** (décision 3) ⇒ Rmax = 99 px | décision 3 | `SPECTRUM_AMPLITUDE = 16` |
| boîte **216 × 216 px**, centre **(108, 108)**, marge 9 px | §5.1 | `SPECTRUM_BOX`, `SPECTRUM_CENTER` |
| **32 zones**, 11,25° par zone, `α(k) = 180° + 11,25° × k`, `x = 108 + r·sin α`, `y = 108 − r·cos α` | §5.2 | `spectrumZoneAngle`, `spectrumZonePoint` |
| bandes **200 Hz → min(8000, 0,45 × fs)**, largeur **40^(1/32) = 1,122** | §5.2 | `SPECTRUM_LOW_HZ`, `SPECTRUM_HIGH_RATIO`, `SPECTRUM_HIGH_HZ` |
| **FFT 512** points, fenêtre de **Hann**, Δf = fs/512 | §5.2 | `SPECTRUM_FFT`, plan de FFT (fenêtre calculée une fois) |
| **−80 dB** plancher, **−30 dB** plafond, compression **racine carrée** | §5.3 | `SPECTRUM_FLOOR_DB`, `SPECTRUM_CEIL_DB`, `Math.sqrt` |
| lissage **montée 0,5 / descente 0,12**, **aucun lissage spatial** | §5.3 | `SPECTRUM_RISE`, `SPECTRUM_FALL` + test « une zone ne contamine pas ses voisines » |
| `r = 83 + 16 × v` | §5.3 | `spectrumZoneRadius` |
| chemin **fermé**, Catmull-Rom uniforme → Bézier, **indices modulo 32**, arrondi **0,1 px** | §5.4 | `spectrumPath` |
| silence `max(v) < 0,03` ⇒ rien | §5.5 | `SPECTRUM_SILENCE` |
| analyse **30 images/s** (coût placé « au début du morceau ») | §5.6 | `SPECTRUM_FPS`, ligne de temps précalculée |

Repères vérifiés par test (ce sont les chiffres du document, pas les miens) :
`k = 0` → (108, **191**) = 6 h ; `k = 8` → (**25**, 108) = 9 h ; `k = 16` → (108, **25**) = midi ;
`R(0) = 83`, `R(1) = 99`, marge haute `108 − 99 = 9 px`.

---

## 3. Écarts constatés, et pourquoi

### 3.1 Le document est en **révision 4**, pas 3

La consigne parle de « révision 3 ». Le fichier sur disque est **`révision 4 — 28 octobre
2026`**, qui remplace explicitement les révisions 1 à 3 et intègre **cinq décisions fermes**
du propriétaire (32 zones toutes différentes ; cercle pour la voix de Pilot **et** second
afficheur pour celle de l'utilisateur ; le trait remplacé par un **halo intérieur** ; chaque
lueur a **sa** couleur tirée du thème). **J'ai appliqué la révision 4** : c'est la version
faisant foi, et les lots suivants en dépendent. Aucun chiffre de la révision 3 n'a été
réintroduit.

### 3.2 L'échelle absolue des puissances (le seul vrai écart de calcul)

La formule du §5.3 donne une **somme brute** de `|X|²` sur les cases d'une bande. Telle
quelle, elle est décalée de `20·log10(512/2) = +48 dB` par rapport à une échelle pleine
échelle : **tout son audible saturerait à v = 1**, et les deux seules valeurs que le lot D
doit **mesurer** (−80 / −30 dB) ne voudraient plus rien dire.

Décision prise **dans le module, et signalée ici** : les puissances sont ramenées en
**dBFS**, avec deux facteurs qui découlent de choix **déjà écrits au document** :
le gain cohérent de la fenêtre de Hann (**0,5**, §5.2) et le facteur **2** du spectre
unilatéral. Aucune valeur nouvelle n'est inventée : ce sont les unités de la formule qui
changent, pas ses seuils.

Vérification chiffrée (1 000 Hz, 22 050 Hz) :

- sinusoïde **pleine échelle** → bande du 1 000 Hz à **1,00** (plafond), bandes lointaines à 0 ;
- sinusoïde à **−40 dBFS** → cette bande à **0,86**, les 31 autres à 0.

### 3.3 `fin(31)` n'est pas définie par le document

Le §5.2 définit `fin(k) = min(Nyquist, debut(k+1) − 1)`, ce qui laisse la **dernière** bande
sans borne. Je l'ai fermée par `debut(32) − 1`, bornée aux cases utiles de la FFT. Résultat
mesuré, contigu et sans trou :

- à **22 050 Hz** : cases **5 → 185** (215 Hz → 7 970 Hz) ;
- à **16 000 Hz** : cases **6 → 229** — borne haute **7 200 Hz**, parce que `0,45 × 16 000`
  est plus petit que 8 000. Le document est donc bien respecté par construction, pas par
  hasard.

### 3.4 Constat gênant : à pleine échelle, quatre zones saturent

Un son pur à pleine échelle ne dessine pas une **pointe** mais un **plateau** de 3 à 4 zones
à 1,00 : la fenêtre de Hann est large devant des bandes de 2 à 3 cases dans les aigus, et la
fenêtre de dessin ne fait que **50 dB** (−80 → −30). Ce n'est **pas** un bug, c'est le
résultat honnête des chiffres du document — mais c'est un point à trancher **au lot D**
(élargir la fenêtre de dB, ou normaliser par image). Le lot A n'a **pas** tranché à la place
du propriétaire.

### 3.5 Le seuil de silence 0,03 vaut, en pratique, « silence numérique »

Le seuil s'applique aux valeurs **comprimées** (celles que le lissage et le chemin
manipulent), donc `v = 0,03` correspond à `dB ≈ −79,96` : c'est le plancher. Autrement dit,
un vrai silence d'enregistrement (souffle à −60 dB) **dessine** encore un petit cercle.
J'ai appliqué le chiffre **tel qu'écrit** (la consigne l'exige) et je le signale : si le
propriétaire veut « le cercle net dès que plus personne ne parle », c'est ce chiffre-là qu'il
faut revoir, pas le code.

### 3.6 Choix d'interface (pas un chiffre du document)

Le document ne dit pas **comment** le WAV arrive. Le module prend une chaîne base64
(`data:audio/wav;base64,…`) et accepte un décodeur **fourni** (`{ atob }`), sans supposer
d'`atob` global : c'est ce qui rend le module testable hors navigateur (les tests décodent
avec `Buffer`, et un test vérifie qu'**aucun** `atob` global ne suffit pas). Les canaux
multiples sont ramenés en **mono par moyenne** (jamais par somme, qui doublerait le niveau).

### 3.7 Ce qui a été mesuré, pour information (le document reste la référence)

Analyse de 3 s d'audio (90 images) : **3,8 ms** — dans la fourchette « 3-8 ms » du §5.6.
Chemin SVG : **1 007 octets** par image, **14 µs** par image (0,04 % d'une image à 30 fps).

---

## 4. Tests : ce qui est verrouillé, et les résultats

`src/js/vocal-equalizer.test.js` — **33 tests**, 8 groupes. Le WAV de synthèse est construit
**à la main** (en-tête RIFF, PCM 16 bits, **22 050 Hz**, plus un cas 16 000 Hz, et un cas
stéréo entrelacé) : aucune API audio, aucun fichier, `Buffer` pour le base64.

1. **WAV relu** : taux annoncé, échantillons exacts, `data:` URL, stéréo → mono par moyenne,
   et **refus** propres (chaîne vide, faux base64, en-tête « AAAA », absence d'`atob`).
2. **32 bandes** : borne haute décidée par le document (8 000 / 7 200 / 0), contiguïté
   (`start = précédent.end + 1`), aucune case comptée deux fois (somme des cases = étendue),
   première bande à 200 Hz, dernière à la borne haute, 1 000 Hz dans **sa** bande, une image
   par 1/30 s, constantes de dessin vérifiées une par une.
3. **32 zones toutes différentes** : 11,25° d'écart, modulo 32, repères 6 h / 9 h / midi,
   32 points distincts, rayon borné, tout reste dans la boîte.
4. **Chemin fermé sans segment droit** : `M` … 32 `C` … `Z`, aucun `L`, fermeture exacte
   sur le premier point (aucune couture), produit vectoriel ≠ 0 pour **chacun** des
   32 segments (≈ 7,4 px²), coordonnées à ≤ 1 décimale, longueur ~1 Ko.
5. **Silence** : chemin vide au silence exact, à 0,02, à 0,029, sur `NaN` ; chemin non vide
   à 0,031 et pour une seule zone à 0,04 ; ligne de temps silencieuse → aucun chemin.
6. **Lissage** : 0,5 en montée / 0,12 en descente (valeurs exactes après une image), 88 % du
   chemin en 3 images, descente bien plus lente, **aucun lissage spatial**, jamais hors de
   0..1 même avec `9`, `−9`, `NaN`, `Infinity`.
7. **Décision d'affichage** : les quatre états + mouvement réduit, repli enveloppe, et
   `dessiner && lueur` **jamais vrai** sur toute la matrice testée.
8. **Non-branchement et pureté** : corps de `spectrumFrameInto` sans `new` / `.slice(` /
   `Array.from` ; module sans `import`, sans `document.`, `window.`, `AudioContext`,
   `getUserMedia`, `fetch(`, `localStorage`, `invoke(`, `setInterval`,
   `requestAnimationFrame`, `Date.now` ; et **aucun** de `super-agent.js`, `read-aloud.js`,
   `local-voice.js`, `vocal-mic.js`, `vocal-conversation.js`, `style.css` ne mentionne
   `vocal-equalizer`. Le lot A est donc invisible par construction.

Le test respecte la contrainte du projet : **aucun** découpage non protégé
(`sliceSource` est utilisé), et `source-slice.test.js` reste vert.

### Commandes et résultats

```bash
npx vitest run src/js/vocal-equalizer.test.js
#   ✓ 33 tests (33), 1 fichier — passed

npx vitest run src/js/source-slice.test.js src/js/ecran-vocal-lot3.test.js \
                src/js/ecran-vocal-lot4a.test.js src/js/trois-modes-ecran.test.js
#   PASS (112)  FAIL (0)
```

*(La suite complète `npm test` est lancée juste après la rédaction de ce rapport, comme
demandé.)*

---

## 5. Ce que ce lot ne fait pas (volontairement)

- Aucun branchement : `super-agent.js`, `read-aloud.js`, `local-voice.js`, `vocal-mic.js`,
  `style.css`, `index.html` **intacts**.
- Aucun style, aucune couleur de lueur, aucune animation (lots C et D).
- Aucun réglage, aucun seuil du micro, aucun délai d'envoi, aucun réglage de voix touché.
- Aucun outil listant les sessions d'agents appelé.

## 6. Ce que les lots suivants reçoivent, prêt à l'emploi

- **Lot B** : `spectrumTimelineFromDataUrl(url)` rend une ligne de temps `{ fps, count,
  bands, bandBins }` depuis le WAV déjà en mémoire de la voix locale — rien à recalculer,
  rien à décoder ailleurs.
- **Lot C** : `spectrumPath` rend le `d` du contour, ou `""` (donc : ne rien dessiner) ;
  `spectrumPlan` dit déjà si la **lueur** porte la parole et si l'**enveloppe** est le repli.
- **Lot D** : les deux seules valeurs à **mesurer** sont `SPECTRUM_FLOOR_DB` / 
  `SPECTRUM_CEIL_DB` (−80 / −30), et les deux points à trancher sont §3.4 (saturation des
  zones voisines) et §3.5 (seuil de silence) de ce rapport.

---

**NEED_HELP : rien de bloquant.** Deux décisions appartiennent au propriétaire et sont
signalées (§3.4 plateau à pleine échelle, §3.5 seuil de silence effectif) ; le lot A est
terminé, testé, sans aucun branchement.
