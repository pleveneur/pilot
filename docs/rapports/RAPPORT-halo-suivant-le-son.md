# RAPPORT — le halo (enveloppe de parole) suit le SON de Pilot

Date : 12/11 (session de realisation). Projet : `G:\IA_PL\pilot`.
Base : 4 034 tests verts, commit de depart `400be3e`.
Demandes traitees (trois, du proprietaire) :

1. **le halo suit la voix reelle de Pilot** (mesure de l'aigu par un analyseur
   audio), et non plus une pulsation decorative ;
2. **le trait de niveau sous le cercle est supprime** (decision qui revient sur
   l'avenant du 28/10) ;
3. **le halo passe a ~32 px** au-dela du cercle, sans deborder sur la ligne
   d'etat.

## 0. Travail trouve au depart — dit sans detour

La consigne de la mission annoncait la tete `400be3e`, un arbre propre et
« une tentative precedente qui s'est arretee sans rien ecrire ». **Ce n'est pas
ce que le disque montrait** :

- la tete etait `87330ae` (un commit **de plus** que `400be3e`),
  `fix(vocal): l'enveloppe de parole suit le son de Pilot, le trait de niveau
  disparait` — c'est-a-dire les points **1 (voix locale), 2 (trait supprime) et
  3 (32 px)** deja ecrits, testes et documentes ;
- l'arbre **n'etait pas propre** : trois fichiers modifies non committes
  (`src/js/vocal-enveloppe-aigu.js`, `src/js/read-aloud.js`,
  `src/js/super-agent.js`) et un fichier de test **non suivi**
  (`src/js/vocal-enveloppe-rythme.test.js`) — la **deuxieme source** (le rythme
  de la phrase lue) etait commencee, et **2 de ses 21 tests echouaient**.

Choix fait, et assume : **je n'ai rien jete**, mais je ne l'ai pas repris en
silence non plus. J'ai **verifie** chaque morceau trouve, **corrige** ce qui
etait faux, **termine** ce qui manquait, puis **refait moi-meme toutes les
preuves** (morsures comprises) sur l'etat final. Les deux defauts trouves dans le
travail en cours, et corriges :

1. `countSpeechSyllables` comptait un **`r`** comme une voyelle (la chaine
   `VOYELLES` avait ete corrompue par une sequence `... \u00fc\u00ffer\u00ff ...`),
   donc « voiture » tombait sur **2** syllabes au lieu de **3** (`voi-tu-re`
   fusionnait en `voi-ture`). La chaine est desormais exacte, sans aucune
   consonne, et `y` compte comme voyelle.
2. un texte **fait d'espaces ou de sauts de ligne** produisait **une pause** au
   lieu d'**aucune unite** : le metre se serait arme pour ne rien dire. Il rend
   maintenant `{ units: [], total: 0 }` des qu'il n'y a pas une seule syllabe.

Et un test du fichier en cours a ete **corrige** (il attendait 3 syllabes pour
« maison », qui en compte 2 : `mai-son`) : le mot de reference est devenu
« voiture », ou le compte est verifiable a l'oreille.

---

## 1. Vocabulaire (inchange, et important ici)

| Nom | Element | Qui parle |
|---|---|---|
| **halo** (d'ecoute) | `.vocal-halo`, **dans** le disque | la voix de l'UTILISATEUR (micro) |
| **enveloppe de parole** | `.vocal-orb::before`, **autour** du disque | la voix de PILOT (lecture) |

La demande dit « le halo doit suivre le son ». La cible est donc l'**enveloppe de
parole** (`::before`) : c'est le seul element qui s'allume quand Pilot parle. Le
halo d'ecoute (`.vocal-halo`) n'est **pas touche** : il continue de suivre le
niveau du micro, avec ses deux seuils et son hysteresis intacts.

Ce que le fichier nomme donc : `src/js/vocal-enveloppe-aigu.js` (aucun « halo »
dans le code — un seul mot par chose).

---

## 2. Ce qui est MESURABLE, et ce qui ne l'est pas (dit franchement)

- **Voix LOCALE (Piper)** : Pilot joue un vrai element `Audio` (WAV synthetise).
  La page peut l'ecouter : `createMediaElementSource` + `AnalyserNode` donnent un
  vrai spectre. **C'est le cas couvert pour de vrai**, et c'est celui par defaut
  depuis que les voix locales existent.
- **Voix du SYSTEME (`speechSynthesis`, la voix par DEFAUT chez le
  proprietaire)** : la page **ne recoit aucun flux audio**. Aucun analyseur ne
  peut la voir ; il n'existe pas d'API pour cela (ni `MediaStream`, ni
  `AudioContext` sur `speechSynthesis`, qui ne rend rien). **Interdit de faire
  semblant** : aucune frequence n'est inventee. Ce que Pilot connait, lui, c'est
  le **TEXTE qu'il lit**, et il s'en sert : l'enveloppe est pilotee par le
  **RYTHME REEL de la phrase lue** (voir §6bis).

Consequence concrete, ecrite noir sur blanc : **quel que soit le moteur qui
parle**, l'enveloppe suit la voix. Avec la voix locale, elle suit le **timbre**
(la bande haute reelle). Avec la voix du systeme, elle suit le **rythme du texte
lu** (syllabes, pauses de ponctuation) — jamais une pulsation aveugle. Une seule
des deux sources peint a la fois (§6bis.1).

---

## 3. La mesure (decisions PURES, testables sans DOM)

Tout vit dans `src/js/vocal-enveloppe-aigu.js`. Aucune API audio n'y est
appelee en dehors du metre, et aucune decision n'est prise dans le DOM.

1. **Bande haute** : l'energie de la voix qui fait « respirer » est celle de la
   bande **au-dessus de 4 kHz** (consonnes, sibilantes), jusqu'au plafond
   d'analyse du projet (`min(8000, 0,45 x taux)` — meme regle que le contour).
   - `highBandBins(taux, cases)` traduit cette bande en **cases d'analyseur**
     (aucun indice en dur : 22,05 kHz et 48 kHz tombent sur des cases
     differentes pour les memes frequences).
   - `highBandEnergy(donnees, taux)` : moyenne de ces cases (0..1), moins le
     plancher de silence (`0,03`), racine carree (meme famille de compression que
     le contour). Silence -> **0** ; aigu riche -> **proche de 1** ; son grave ->
     **0**.
2. **Lissage** : `smoothEnvelopeEnergy` — montee `0,5`, retombee `0,12` (les
   facteurs du projet, `smoothLevel`). Le silence **ramene au repos** au lieu de
   faire pulser : aucune valeur inventee.
3. **Projection** : `envelopeFromEnergy` — extension **18 px** (repos) a
   **32 px** (pleine voix), intensite **0,8** a **1**. `scale` est le facteur de
   la **boite entiere** (la boite fait 232 px, du centre a 116 px) :
   `scale = (84 + extension) / 116`, soit **0,8793** au repos et **1** a pleine
   voix. Diviser l'extension par 32 aurait donne 0,5625, ce qui ramene le bord a
   65 px — **sous l'anneau de 84 px**, donc invisible : c'est le piege que la
   formule evite. Verifie par calcul : 0 -> rayon 102 px (couronne 18 px),
   1 -> rayon 116 px (couronne 32 px).
4. **Qui a le droit d'afficher** : `planSpeechEnvelope({ energy, reduit,
   contourPeint, disponible })`. Trois refus : le contour spectral peint deja
   (`.vocal-spectrum-live`), mouvement reduit, aucune mesure disponible.

Point unique de mesure : **un** `AnalyserNode`, monte sur **le** son que Pilot
joue lui-meme. Il n'y a pas de second chemin audio, donc pas de second chiffre.

---

## 4. Le branchement (un seul, sans nouvelle dependance)

- `local-voice.js` gagne **une** fonction : `setLocalVoiceAudioTap(fn)`. Il tend
  l'element audio **au moment de sa creation** (`playUrl`) et ne sait pas ce
  qu'on en fait. Hors mode Vocal, personne n'ecoute (`audioTap` vaut `null`) :
  cout nul.
- `super-agent.js` cree le metre **a l'entree du mode** (`enterVocal`) et
  l'arrete **a la sortie** (`exitVocal` : espion debranche, boucle annulee,
  analyseur lache). Il ne pose ensuite que **deux variables de style** et **une
  classe** (`.vocal-envelope-live`) — aucun noeud cree, aucune animation ajoutee.
- Aucun reglage, aucun `localStorage`, aucune dependance npm, aucune ligne Rust,
  aucune permission supplementaire. La mesure du **micro** n'est pas touchee.
- `read-aloud.js` : **aucune decision** n'y est prise, **aucun seuil** n'y est
  touche. Il **joint** seulement a son evenement d'etat deux faits qu'il
  connait deja : le **texte reellement lu** (`text`) et le **moteur** qui parle
  (`engine` : local / systeme, replis compris). C'est la seule modification, et
  elle est purement additive (les valeurs existaient deja pour l'affichage).

---

## 5. Le trait de niveau est SUPPRIME (renversement du 28/10)

L'avenant du 28/10 disait « la petite barre reste ». **Decision du 12/11 : elle
part.** Sont donc supprimes :

- le noeud `.vocal-level` / `.vocal-level-bar` dans `buildVocalOverlay` ;
- les regles CSS `.vocal-level`, `.vocal-level-bar`, les deux animations
  (`vocal-think-pulse`, `vocal-speak-envelope`) et les quatre largeurs figees du
  mouvement reduit (8 / 45 / 20 / 70 %) ;
- la pose de `--vocal-level` par `vocalSetLevel` (et son retrait).

Ce qui **reste** : la mesure du micro, qui allume l'etat « ecoute » (deux seuils
`0,06` / `0,03`, hysteresis) et remplit le **halo interieur** (`--vocal-heard`).
Rien d'autre ne change dans `vocal-mic.js` (aucune ligne touchee).

La pile de l'ecran devient : **disque 168 px -> 32 px -> ligne d'etat** (le `gap`
de `.vocal-stage` passe de 24 a 32 px : c'est exactement la place de l'enveloppe).

---

## 6. Le halo passe a 32 px (au lieu de 18)

`.vocal-orb::before` : `inset: -18px` -> **`inset: -32px`** (boite 232 x 232 px,
`closest-side` = 116 px). L'anneau du disque est a 84 px : la couronne lumineuse
s'etend donc de 84 a 116 px = **32 px au-dela du disque**, et le `gap` de 32 px
l'empeche de toucher le texte. Le degrade est **le meme** (arrets 0 / 72 / 84 /
92 / 100 %, alpha au bord 34 %) : aucune retouche de couleur, aucune mesure de
contraste a refaire (2,28:1 sombre, 1,60:1 clair).

En **mouvement reduit** : la regle `.vocal-reduced ... ::before { opacity: 1;
animation: none }` est conservee — l'enveloppe est **fixe mais visible**, a sa
taille pleine. Le code ne pose **aucune** valeur dans ce cas (`planSpeechEnvelope`
refuse `reduit`), donc rien ne peut la contredire.

---

## 6bis. La voix du SYSTEME : le rythme de la phrase lue (deuxieme source)

### 6bis.1 Une seule source a la fois

`planSpeechEnvelopeSource({ reduit, contourPeint, mesure, rythme })` (PURE) est le
seul juge, et **son ordre EST la regle** :

1. mouvement reduit → **personne** (le CSS tient l'enveloppe fixe mais visible) ;
2. contour spectral peint → **personne** (il peint deja cette voix, §7.3 de la
   conception du cercle) ;
3. mesure reelle disponible → **`son`** ;
4. sinon, texte lu connu → **`rythme`** ;
5. sinon → **rien** (`vocal-speak-glow` reste le repli de ce cas-la).

Cote ecran, `vocalApplyEnvelopeEnergy(energie, source)` verifie le proprietaire
avant d'ecrire : si le proprietaire n'est pas la source qui appelle, il n'ecrit
**rien**, et la mesure reelle **fait taire** le rythme (`vocalStopRhythmMeter`)
— jamais les deux ensemble. Il n'y a **qu'un** afficheur (`.vocal-orb::before`),
qu'une classe (`.vocal-envelope-live`) et deux variables de style.

### 6bis.2 Le decoupage (`speechRhythmUnits`, PURE)

- Un **mot** est decoupe en **syllabes** par groupes de voyelles (accents
  compris ; `y` compte comme voyelle). La **derniere** syllabe du mot est
  **accentuee** (`accent` 1), les autres valent `0,55`.
- La **ponctuation** ouvre des **pauses** : courte **220 ms** (`,` `;` `:` `–`
  `—`), longue **420 ms** (`.` `!` `?` `…`), paragraphe **560 ms** (ligne vide).
  Deux ponctuations qui se suivent **ne cumulent pas** : la plus longue l'emporte.
- Les unites sont **contigues** (`at` puis `duration` s'enchainent sans trou) :
  une position de lecture tombe **toujours** dans une unite.
- Un texte **vide** (ou fait d'espaces / sauts de ligne) ne produit **aucune
  unite** : le metre ne tourne pas pour ne rien dire.
- **Aucun aleatoire**, aucune dependance au DOM : le meme texte donne toujours
  exactement les memes unites.

### 6bis.3 L'intensite (`rhythmIntensity`, PURE)

Position de lecture (ms) → **0..1** :

- **pause** de ponctuation → **0** (l'enveloppe est au repos pendant qu'on
  reprend souffle) ;
- **silence** avant le debut ou apres la fin du texte → **0** ;
- **syllabe** → une bosse lisse (sinus de la duree de la syllabe), avec un
  **plancher de 0,2** (l'enveloppe ne s'eteint pas entre deux syllabes, elle
  respire), multipliee par l'accent : creux de mot **0,55**, fin de mot **1**.

Puis le **meme lissage que le son** (`smoothEnvelopeEnergy`, montee 0,5 /
retombee 0,12) : le mouvement est lisse, jamais un saut.

Deux phrases de longueurs differentes ont des unites de nombre et de duree
differents, donc des **mouvements differents** — verifie par test (la courbe
echantillonnee de « Oui. » differe de plus de 0,15 de celle d'une phrase longue).

### 6bis.4 Le metre du rythme (`createSpeechRhythmMeter`)

Meme contrat que le metre du son — `demarrer(texte)` / `arreter()` / `actif()` /
`mesure()` / `position()` — pour que l'afficheur n'ait qu'un branchement a
connaitre. Il ne mesure **aucun** son : il avance une position avec l'horloge
(`performance.now`, `requestAnimationFrame`) et lit l'intensite du texte. Il
n'ouvre aucune API audio, ne touche ni au DOM ni au micro, et ne laisse **aucune
image en attente** apres `arreter()` (qui publie une derniere valeur **0**).

### 6bis.5 Le fait qui declenche la source (aucune invention)

`read-aloud.js` joint a son evenement d'etat deux **faits** (jamais une
consigne) : `text` (le texte **reelement** lu, deja nettoye et decoupe par
`speech-text.js`) et `engine` (`READ_ALOUD_ENGINE_LOCAL` = Piper, son mesurable ;
`READ_ALOUD_ENGINE_SYSTEM` = voix du systeme, y compris ses **deux replis**
`local-fallback` et `system-fallback`). `super-agent.js` s'en sert a **un seul
endroit**, `vocalSyncEnvelopeSource` : moteur systeme → le rythme s'arme avec le
texte lu ; moteur local → le rythme se tait (la mesure du son parle). Le metre
du rythme **s'arrete avec le mode** (`exitVocal`), aucune horloge ne continue
derriere l'ecran.

### 6bis.6 Le cercle, la ligne d'etat, les modes : inchanges

Rien d'autre n'a bouge : le disque, l'arc de reflexion, le halo interieur, la
ligne d'etat, les trois modes, la barre de saisie sont ceux de `400be3e`.

---

## 7. Tests adaptes (nommes) et test ajoute

Tests **ajoutes** :

- `src/js/vocal-enveloppe-aigu.test.js` (31 tests) — aigu vs grave, silence -> 0,
  monotonie, bornes de la bande selon le taux, lissage montee/retombee, extension
  bornee a 32 px, pas de pulsation au repos, non-duplication avec
  `.vocal-spectrum-live` (decision + ordre CSS), mouvement reduit fixe et
  visible, branchement entree/sortie, absence d'API audio dans `super-agent.js` ;
- `src/js/vocal-enveloppe-rythme.test.js` (21 tests) — decoupage en unites
  (syllabes, accents, ponctuation, contiguite, texte vide), intensite (pause au
  repos, silence avant/apres, bornes, accent), **deux textes -> deux
  mouvements**, aucun aleatoire, **une seule source a la fois**, metre du rythme
  (images, lissage, arret sans image restante, aucune API audio / DOM / micro),
  branchement (`read-aloud.js` -> faits `text` + `engine`, `super-agent.js` ->
  arme / tait), mouvement reduit ou aucune valeur n'est posee.

Tests **adaptes** (chacun pour la suppression du trait ou les 32 px ; aucun test
supprime sans remplacement) :

| Fichier | Test | Ce qui change |
|---|---|---|
| `src/js/vocal-halo-parole.test.js` | « la petite barre sous le cercle est CONSERVEE » -> « a ETE RETIREE (12/11) » | exige l'**absence** (CSS, DOM, `--vocal-level`) + `gap: 32px` |
| `src/js/ecran-vocal-lot2.test.js` | « le trait du niveau fait 200 x 3 px, rayon 2 px » -> « a DISPARU : aucun noeud, aucune regle » | exige l'absence |
| `src/js/ecran-vocal-lot2.test.js` | « le trait est a 24 px du disque » -> « le disque et la ligne d'etat sont a 32 px » | 24 -> 32 px |
| `src/js/ecran-vocal-lot2.test.js` | « en ecoute, le trait suit le niveau MESURE » -> « la mesure reste, sans trait » | `--vocal-heard`, pas de `--vocal-level` |
| `src/js/ecran-vocal-lot2.test.js` | « aucune couleur en dur » | `.vocal-level-bar` retire de la liste |
| `src/js/ecran-vocal-lot2.test.js` | « le CSS fige alors le trait : 8 / 45 / 20 / 70 % » -> « ne fige plus aucun trait » | les 4 largeurs disparaissent, le halo 0,55 reste |
| `src/js/ecran-vocal-lot2.test.js` | « le contenu de l'ecran est l'objet, le trait, ... » | le trait n'est plus un contenu |
| `src/js/ecran-vocal-nu.test.js` | « l'ecran nu : l'objet, le trait, ... » + « ce que l'ecran nu doit garder » | absence du trait exigee |
| `src/js/ecran-vocal-lot3.test.js` | « le micro ne tient AUCUN lecteur » | `--vocal-heard` au lieu de `--vocal-level` |
| `src/js/ecran-vocal-lot3.test.js` | « le CSS fige toujours l'ecoute a 45 % » -> « ne dessine plus de trait, meme fige » | halo 0,55 |

---

## 8. Garde-fous verifies (aucun seuil vocal touche)

- **Aucune decision vocale touchee** : `vocal-mic.js` **n'est pas modifie** (pas
  une ligne : seuils `VOCAL_VOICE_ON 0,06` / `VOCAL_VOICE_OFF 0,03`, plancher
  `0,01` / `0,03`, marges `1,8` et `2`, `stepSpeechGate`, garde anti-echo, coupure
  de la parole du lot 4a). Dans `read-aloud.js`, la modification est
  **purement additive et sans aucune decision** : l'evenement d'etat transporte
  deux **faits** de plus (`text`, `engine`) ; la lecture, ses seuils, ses replis et
  son ordre font exactement ce qu'ils faisaient.
- `1000`, `600`, `200` (fenetres et delais) : intacts.
- Disque (32 zones, arc de reflexion, lueur interieure), ligne d'etat, trois
  modes d'ecran, barre de saisie : inchanges.
- Aucun fichier `.rs`, aucun reglage, aucun `localStorage`, aucune dependance,
  aucune publication, aucun bump de version.

---

## 9. Preuves (sorties brutes) — refaites sur l'etat final

Toutes les preuves ci-dessous ont ete **refaites** apres corrections, sur
l'arbre tel qu'il est committe (rien n'est recopie d'un essai precedent).

### 9.1 Suite complete

```
$ npx vitest run
PASS (4087) FAIL (0)
```

- **4 034** au depart (`400be3e`, chiffre de la mission) ;
- **+31** pour `vocal-enveloppe-aigu.test.js` et **+1** pour un test scinde en
  deux (commit `87330ae`) = **4 066** ;
- **+21** pour `vocal-enveloppe-rythme.test.js` (cette session) = **4 087**.
- Aucun test supprime sans remplacement ; **aucun fichier `.rs`** touche
  (`git diff --name-only | grep -c '\.rs'` -> **0**).

### 9.2 Morsures — UNE a la fois, jamais en parallele

Protocole identique aux trois : copie de reference du fichier, morsure posee,
test cible, restauration, **verification que le fichier est identique**
(`sha256sum`) **et que `git diff` est identique** (`git diff | sha256sum`), puis
test cible de nouveau vert.

Reference avant toute morsure :

```
sha256sum src/js/vocal-enveloppe-aigu.js -> 9b8c6d4f...de2e
sha256sum src/css/style.css              -> cbe12ae8...693e
git diff | sha256sum                    -> a5ce516d...7bcc
```

**(a) La mesure de l'aigu neutralisee** (`highBandBins` rendu « toutes les
cases » : le grave compte comme de l'aigu) — la promesse « l'aigu mene, le grave
ne fait rien » tombe.

```
PASS (50) FAIL (2)
1. ... la bande commence au-dessus de 4 kHz et s'arrete au plafond d'analyse
   AssertionError: expected 0 to be greater than 0
2. ... la selection suit le TAUX d'echantillonnage (aucun indice en dur)
   AssertionError: expected +0 not to be +0 // Object.is equality
```

Restauration : hash du fichier **identique** (`9b8c6d4f...de2e`), `git diff`
**identique** (`a5ce516d...7bcc`), tests -> `PASS (52) FAIL (0)`.

**(b) La suppression du trait annulee** (regles `.vocal-level` /
`.vocal-level-bar` remises dans `src/css/style.css`) — le renversement du 28/10
redevient un ajout, et les tests qui exigent l'**absence** doivent mordre.

```
PASS (112) FAIL (4)
1. le trait du niveau a DISPARU (12/11) : aucun noeud, aucune regle
2. le niveau mesure ne dessine plus de trait, meme fige
3. l'objet et la saisie gardent leurs mesures, le trait n'existe plus
4. aucune regle de trait ne subsiste : ni conteneur, ni barre
```

Restauration : hash **identique** (`cbe12ae8...693e`), `git diff` **identique**
(`a5ce516d...7bcc`), tests -> `PASS (116) FAIL (0)`.

**(c) Le rythme neutralise** (`rhythmIntensity` rendu constant a `0,5`) — la
promesse « la pause est au repos, deux textes bougent differemment » tombe.

```
PASS (17) FAIL (4)
1. deux textes de longueurs differentes donnent DEUX mouvements differents
2. une pause de ponctuation est AU REPOS (aucune pulsation pendant le souffle)
3. le silence AVANT et APRES la lecture est le repos
4. l'intensite est bornee a 0..1 et jamais nulle au coeur d'une syllabe
```

Restauration : hash **identique** (`9b8c6d4f...de2e`), `git diff` **identique**
(`a5ce516d...7bcc`), tests -> `PASS (21) FAIL (0)`.

### 9.3 Autres verifications

- **Garde-fou d'inventaire** (`src/js/source-slice.test.js`) : il a mordu pour de
  vrai pendant cette session — le nouveau fichier de test contenait un
  `MODULE.slice(MODULE.indexOf(...))`, refuse par l'inventaire
  (`1 decoupage(s) non protege(s) mesure(s), releve 0`). Corrige en
  `sliceFrom(MODULE, "...", 200)` : un decoupage **verifie** qui **echoue** si
  l'ancre disparait, au lieu de rendre l'assertion negative vraie par
  construction.
- **Aide integree** : `npm run build:handbook` -> `46 blocs`, `295 200 octets`,
  topic `modes-ecran` present.
- **Construction du front** : `node node_modules/vite/bin/vite.js build` ->
  `built in 12.59s` (aucune dependance nouvelle).

### 9.4 Ce qui n'a PAS ete verifie (dit franchement)

- **Aucune ecoute a l'oreille** : je n'ai pas de haut-parleurs ni de micro dans
  cette session. Le rythme et l'aigu sont prouves par des decisions **pures**
  testees, pas par une observation de l'ecran en marche.
- **La voix du systeme n'a pas ete entendue dans l'application** : le
  branchement est prouve (faits `text` + `engine` transmis par `read-aloud.js`,
  source choisie par `planSpeechEnvelopeSource`), mais le rendu visuel reel dans
  WebView2 avec une voix systeme n'a pas ete regarde. **A verifier a l'oeil** :
  en mode Vocal, laisser la voix par defaut (systeme) et lire une reponse.
- **Les latences reelles** du moteur (`speechSynthesis`) ne sont pas connues de
  la page : la position de lecture avance avec le **temps de parole effectif**
  (debut / fin reels). Si une voix systeme parle sensiblement plus vite ou plus
  lentement que l'hypothese de duree par syllabe, le mouvement sera
  globalement juste mais pas **synchronise a la milliseconde**. C'est assume :
  aucune API ne donne cette information.
- **Le cas d'un texte lu tres long** : le metre suit `positionMs` sans borne
  duree cote code ; aucun test au-dela de quelques phrases.
