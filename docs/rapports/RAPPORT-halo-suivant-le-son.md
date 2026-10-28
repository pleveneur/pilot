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
- **Voix du SYSTEME (`speechSynthesis`)** : la page **ne recoit aucun flux
  audio**. Aucun analyseur ne peut la voir ; il n'existe pas d'API pour cela
  (ni `MediaStream`, ni `AudioContext`, et `speechSynthesis` ne rend rien).
  **Dans ce cas l'animation existante (`vocal-speak-glow`, 1,6 s) reste le
  repli**, et le code ne prétend rien mesurer : aucune classe n'est posee, aucune
  valeur n'est inventee. C'est un repli **assume**, pas une mesure degradee.

Consequence concrete, ecrite noir sur blanc : si votre voix choisie n'est pas
installee et que Pilot bascule sur la voix du systeme, l'enveloppe **respire au
rythme de l'animation** (comme avant) au lieu de suivre les mots. Des que la voix
locale parle, elle suit le son.

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

## 7. Tests adaptes (nommes) et test ajoute

Test **ajoute** : `src/js/vocal-enveloppe-aigu.test.js` (31 tests) — aigu vs
grave, silence -> 0, monotonie, bornes de la bande selon le taux, lissage
montee/retombee, extension bornee a 32 px, pas de pulsation au repos,
non-duplication avec `.vocal-spectrum-live` (decision + ordre CSS), mouvement
reduit fixe et visible, branchement entree/sortie, absence d'API audio dans
`super-agent.js`.

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

- Seuils intacts : `VOCAL_VOICE_ON 0,06` / `VOCAL_VOICE_OFF 0,03`, plancher
  `0,01` / `0,03`, marges `1,8` et `2`, `stepSpeechGate`, garde anti-echo,
  coupure de la parole (lot 4a) : **aucune ligne** de `vocal-mic.js` ni de
  `read-aloud.js` n'est modifiee.
- `1000`, `600`, `200` (fenetres et delais) : intacts.
- Disque (32 zones, arc de reflexion, lueur interieure), ligne d'etat, trois
  modes d'ecran, barre de saisie : inchanges.
- Aucun fichier `.rs`, aucun reglage, aucun `localStorage`, aucune dependance,
  aucune publication, aucun bump de version.

---

## 9. Preuves (sorties brutes)

**Suite complete** : `npx vitest run` -> `PASS (4066) FAIL (0)` (219 fichiers),
contre **4 034** au depart : +31 tests (le nouveau fichier) et un test scinde en
deux, aucun test supprime sans remplacement. Aucun fichier `.rs` touche
(`git show --name-only HEAD | grep -c '\.rs'` -> **0**).

**Morsure 1 — la mesure de l'aigu neutralisee** (`highBandBins` remplace par
« toutes les cases ») :

```
× 1. ... aigu riche -> fort (proche du maximum)
× 1. ... son GRAVE -> quasi rien : l'enveloppe ne suit pas le volume
× 1. ... les octets aberrants sont ignores, jamais propages
Tests 3 failed | 28 passed (31)
```

Retablissement : `Tests 31 passed (31)`.

**Morsure 2 — la suppression du trait annulee** (noeud `.vocal-level` remis dans
`buildVocalOverlay` + regles `.vocal-level` / `.vocal-level-bar` remises dans la
feuille de style) :

```
× vocal-halo-parole.test.js  5. ... aucune regle de trait ne subsiste
× ecran-vocal-lot2.test.js   4. ... le trait du niveau a DISPARU (12/11)
× ecran-vocal-lot2.test.js   6. ... le contenu de l'ecran
× ecran-vocal-nu.test.js     1. ... l'ecran nu
× ecran-vocal-nu.test.js     6. ... le trait n'existe plus
```

Retablissement verifie **a l'identique** : `sha256sum -c` sur les trois fichiers
modifies -> `OK`, et `git diff` apres morsures **identique octet pour octet** a
celui d'avant (`cmp` sur 38 741 octets) ; suite complete de nouveau verte.

**Construction du front** : `node node_modules/vite/bin/vite.js build` ->
`built in 14.14s` (aucune dependance nouvelle, import resolu).
