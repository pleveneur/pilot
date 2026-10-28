# RAPPORT — Diagnostic des deux défauts visuels de l'écran Vocal

**Mission** : lecture seule. Répondre aux 8 questions de `vocal-defauts-visuels.md`, dire
pour chaque défaut s'il est déjà couvert par un lot à venir, puis chiffrer ce qui reste.
Date : 28 octobre 2026. Projet : `G:\IA_PL\pilot`.

**Ce que je n'ai pas fait** : aucune ligne de code écrite, aucun style, aucune couleur,
aucun seuil de coupure, aucun délai d'envoi, aucune dictée, aucune lecture à voix haute,
aucun réglage. Aucune batterie de tests lancée. Aucun outil listant les sessions d'agents
appelé. Seul fichier produit : celui-ci.

---

## 1. Les 8 questions, avec preuves

### Q1 — Un halo existe-t-il autour du cercle pendant la parole (CSS) ?

**Oui, il existe, et il est activé.** Ce n'est pas une lueur floue : c'est un **dégradé
radial** sur le pseudo-élément `::before`.

| Preuve | Contenu |
|---|---|
| `src/css/style.css:11637` | `.vocal-orb::before {` — l'élément existe |
| `style.css:11640` | `inset: -18px;` → la boîte du dégradé **déborde** du disque |
| `style.css:11641-11646` | `background: radial-gradient(closest-side, color-mix(in srgb, var(--vocal-state) 22%, transparent) 0%, transparent 100%)` — **22 % au centre, 0 % au bord** |
| `style.css:11651-11655` | `.pilot-vocal.vocal-state-speaking .vocal-orb::before { opacity: 1; animation: vocal-halo 1.6s … }` |
| `style.css:11825-11828` | `@keyframes vocal-halo` — opacité qui ondule |

`grep` de `box-shadow`, `filter`, `blur` entre `style.css:11595` et `11850` : **aucune
occurrence**. Il n'y a donc ni ombre portée ni flou : rien qui ressemble à une lueur
lumineuse. La seule « lumière » est ce dégradé.

### Q2 — Trop discret ? (taille, opacité, couleur réelle, clair et sombre)

**Invisible par construction**, et c'est chiffrable. Le calcul, posé une fois :

- `.vocal-orb` fait **168 × 168 px** avec `border: 2px` (`style.css:11620-11632`) ;
  `box-sizing: border-box` est global (`style.css:48`) → la *padding box* mesure **164 px**,
  rayon **82 px** ; l'extérieur du disque est à **rayon 84 px**.
- `inset: -18px` → boîte du `::before` = **200 × 200 px**, rayon **100 px**, dégradé
  `closest-side` = **100 px**.
- L'alpha du dégradé est **maximal au centre (r = 0)** et **nul à r = 100 px**. Or le centre
  est **caché sous le disque opaque**. La seule partie visible est la couronne
  **r = 84 → 100 px**, où l'alpha brut n'est déjà plus que de `22 % × (1 − 84/100)` =
  **3,52 %**, et il décroît vers 0.
  *(Note de précision : le document de conception annonce un rayon de **102 px** pour
  cette boîte — il compte depuis la border-box de 168 px. `inset` se résout sur la **padding
  box** (164 px, à cause de `border-box` global), donc 100 px. L'écart ne change rien : au
  bord du disque l'alpha passerait de 3,52 % à 3,88 %, toujours sous 3 % une fois l'opacité
  appliquée.)*
- L'animation multiplie encore par une opacité de **0,45 à 0,85** (`style.css:11825-11828`).

| Rayon | alpha brut | alpha effectif (op. 0,85) | Contraste sur le fond — thème sombre | thème clair |
|---|---|---|---|---|
| 84 px (bord du disque) | 3,52 % | **2,99 %** | **1,044 : 1** | **1,041 : 1** |
| 88 px | 2,64 % | 2,24 % | 1,033 : 1 | 1,031 : 1 |
| 92 px | 1,76 % | 1,50 % | 1,025 : 1 | 1,017 : 1 |
| 96 px | 0,88 % | 0,75 % | 1,009 : 1 | 1,008 : 1 |
| 100 px | 0 % | 0 % | 1,000 : 1 | 1,000 : 1 |

(Composition alpha sur `--bg-app` : `#0f1115` sombre `style.css:333`, `#f4f5f7` clair
`style.css:446` ; teinte `--vocal-speak` = `--warning` : `#fbbf24` sombre, `#b45309` clair.
Contraste WCAG calculé par la formule de luminance relative.)

**Le maximum est 1,044 : 1.** Le seuil de perception d'un aplat voisin est de l'ordre de
**1,05 : 1** : l'enveloppe extérieure est **en dessous**. Ajoutez qu'elle est **exactement
de la même teinte** que l'anneau qu'elle entoure (l'anneau est `var(--vocal-state)`,
`style.css:11626`, et en parole `--vocal-state: var(--vocal-speak)`, `style.css:11615`) :
aucun bord, aucune séparation, donc aucun « halo » perceptible même à contraste égal.

**Ce qui est réellement visible en parole** — et c'est le point important : le `::before`
est un **enfant** du disque, il est donc peint **au-dessus** du remplissage. Son effet réel
se produit **à l'intérieur**, sur le remplissage à 18 % :

| Thème | remplissage au repos/écoute | en parole (opacité 0,85) | écart perçu |
|---|---|---|---|
| sombre | `rgb(57,48,24)` | `rgb(93,75,26)` | **1,545 : 1** |
| clair | `rgb(232,216,204)` | `rgb(222,191,168)` | **1,248 : 1** |

Autrement dit : en parole, **le disque s'éclaircit légèrement et respire**, sans aucune
enveloppe autour de lui. C'est très probablement ce que l'œil retient — ou plutôt ce qu'il
ne retient pas, puisque rien ne se détache du fond.

**Verdict Q1+Q2 : ni absent, ni « jamais activé », ni simplement timide — mal orienté.** La
lumière est posée là où le disque la cache, et la seule partie extérieure reste sous 3 %
d'alpha. Ce n'est pas un réglage à pousser : c'est la géométrie du dégradé qui est à
l'envers.

### Q3 — Un réglage existant peut-il l'éteindre ?

**Oui, un seul, et il l'éteint complètement : le mouvement réduit.**

- `vocalReducedMotion` (`src/js/super-agent.js:612`) = `prefers-reduced-motion` **et** le
  réglage « Animer l'ouverture des modales » (`window._pilotModalAnimations !== true`).
- La classe est posée **à la construction** de l'écran : `super-agent.js:4221`
  (`if (vocalReducedMotion()) ov.classList.add("vocal-reduced")`).
- `style.css:11804-11807` : en `vocal-reduced`, `.vocal-orb::before` et `::after` reçoivent
  **`opacity: 0`** — le halo n'existe plus du tout.

Donc : **si le poste du propriétaire est en réduction de mouvement, le défaut 1 est
entièrement expliqué par ce seul fait** (et le halo de parole n'a *aucun* signe visuel
propre : il ne reste que l'anneau ambre, le mot « Je réponds. », et le trait figé à 70 %,
`style.css:11808-11811`). C'est la **première mesure à faire** (§6).

### Q4 — L'état « parole » est-il réellement atteint à l'écran ?

**Oui.** Chaîne complète, chaque maillon vérifié :

| Étape | Preuve |
|---|---|
| lecture déclenchée automatiquement en mode Vocal | `super-agent.js:3851` → `autoReadVocalReply()` (`:4915`) → clic sur le dernier `.agent-read-btn` |
| la lecture annonce son état | `src/js/read-aloud.js:817` `notify("speaking")` → `broadcastState` (`read-aloud.js:766`) |
| évènement | `READ_ALOUD_STATE_EVENT` (`read-aloud.js:124`) |
| réception | `super-agent.js:4962` (`onVocalReadAloudState`), enregistré `:4977` |
| décision | `isReadAloudSpeaking` (`read-aloud.js:142-156`, états `speaking`/`local-fallback`/`system-fallback`) → `vocalSpeaking` (`super-agent.js:4968`) |
| application | `applyVocalState()` si changement (`:4975` → `:4276`) → `classList.add(vocalStateClass(etats))` (`:4293`), priorité parole > réflexion > écoute > repos (`:516-521`) |
| effet visible | couleur de l'anneau vers l'ambre, transition 0,3 s (`style.css:11632`) + le mot « Je réponds. » |

La voix **locale** (Piper) passe par le même état : `notify("speaking")` est émis dans
`speak()` **avant** la lecture des morceaux WAV, donc avant les deux chemins. Aucune
configuration ne « rate » la classe.

**Conclusion** : le défaut 1 n'est **pas** un problème de branchement. Le branchement est
complet et testé (`ecran-vocal-lot2.test.js:467`, `:161-170`).

### Q5 — Le niveau du micro est-il utilisé à l'intérieur du cercle, ou seulement pour le trait ?

**Seulement pour le trait.**

- Une seule variable de niveau existe : `--vocal-level`, écrite par `vocalSetLevel`
  (`super-agent.js:4120-4139`, écriture `:4138`, retrait `:4144`), alimentée par
  `createVocalMic({ onLevel: vocalSetLevel })` (`:4790-4791`).
- **Un seul consommateur dans toute la feuille de style** :
  `style.css:11709-11711` → `.pilot-vocal.vocal-state-listening .vocal-level-bar { width: var(--vocal-level, 8%); }`.
- `.vocal-orb` (`style.css:11620`) ne lit **aucune** variable de niveau ; le JS ne le touche
  **jamais** : une seule occurrence de `vocal-orb` dans tout `super-agent.js`
  (`:4229`, sa création dans `buildVocalOverlay`). Aucun `transform`, aucune écriture de
  propriété.

**Conséquence directe, et c'est le cœur du défaut 2** : en écoute, l'intérieur du cercle ne
fait **que** changer de couleur (classe d'état, transition 0,3 s, `style.css:11632`). Rien
en lui ne varie avec la voix. La seule amplitude vivante est la barre de 200 × 3 px **sous**
le cercle (`style.css:11688`, dimensions verrouillées `ecran-vocal-lot2.test.js:221-233`).

### Q6 — D'où vient le niveau, et qui le consomme ?

| Question | Réponse | Preuve |
|---|---|---|
| mesure | RMS sur 1024 échantillons temporels WebAudio | `src/js/vocal-mic.js:481-491` (`rmsOf`), `:640` (`getFloatTimeDomainData`), `:692` (`fftSize = 1024`) |
| lissage | montée 0,5 / descente 0,12 (≈ 30 ms / ≈ 470 ms à 60 fps) | `vocal-mic.js:111-120` (`smoothLevel`), appliqué `:640` |
| transport | `onLevel(niveau)` → `vocalSetLevel` | `vocal-mic.js:640` → `super-agent.js:4120` |
| forme affichée | échelle en racine carrée, 8 % → 100 % | `vocal-mic.js:132-137` (`levelToWidth`) |
| écriture DOM | `--vocal-level` sur l'overlay, en % | `super-agent.js:4138` |
| consommation | **unique** : la largeur du trait, en écoute | `style.css:11709-11711` |

Rien d'autre ne lit le niveau : ni le disque, ni la ligne d'état, ni le mot. Le niveau est
donc **mesuré, transporté, et consommé une seule fois, à un seul endroit** — sous le cercle.

### Q7 — L'amplitude est-elle assez large pour être lisible ?

**Oui techniquement, deux réserves à mesurer** (et je ne les tranche pas par lecture) :

1. L'état « écoute » n'existe qu'au-dessus de **0,06 RMS** (`super-agent.js:578`) et retombe
   sous **0,03** (`:579`, hystérésis `vocalCapte` `:586`). Quand le trait est visible, sa
   largeur est donc **déjà ≥ 30,5 %** et peut monter à 100 % : la plage *affichée* n'est pas
   étroite. Le vrai inconnu est le **gain réel du micro** : `MIC_CONSTRAINTS`
   (`vocal-mic.js:180-190`) demande `autoGainControl`, donc la valeur RMS dépend du
   périphérique. Non prouvable par lecture.
2. **Sous 0,06 rien ne s'affiche** : l'écran est au repos, trait à 8 %. Une voix calme fait
   donc passer l'afficheur de 8 % à 30 %+ — c'est visible, mais c'est un **seuil**, pas une
   progression continue depuis zéro.

### Q8 — L'écran a-t-il été pensé pour un casque ?

**Pour les visuels : non, et ce n'est pas le problème.** Aucune partie du dessin ne dépend de
l'acoustique : les quatre états, la teinte, le trait, le halo donneraient **exactement le
même rendu au casque**. Le défaut 1 ne disparaîtrait pas avec un casque.

**L'acoustique, elle, est traitée — mais ailleurs, et pour la coupure, pas pour l'affichage** :
`MIC_CONSTRAINTS` demande `echoCancellation`/`noiseSuppression` (`vocal-mic.js:180-190`),
`echoCancellationOf` relit ce que la piste dit avoir appliqué (`:239-260`), la garde
anti-auto-coupure existe (`bargeInArmed`). Le document de conception traite le cas des
haut-parleurs (§6.9).

**Un point faible propre aux haut-parleurs existe côté affichage, et n'est traité nulle
part** : à la fin d'une lecture, `vocalSpeaking` retombe (`super-agent.js:4971-4975`) et
**rien** n'empêche l'état d'écoute de s'allumer sur l'écho que le micro vient d'entendre —
la décision d'état (`vocalCapte`, `:586`) ne connaît que le niveau, et `vocalApresLecture`
(`:4971`) ne retarde que l'**armement de la dictée**, pas l'affichage. Résultat possible :
un bref flash « écoute » / trait qui remonte après chaque réponse, **si** l'annulation d'écho
du périphérique est insuffisante. **Incertain** (dépend de l'AEC), **mesurable** (§6, mesure 3).

---

## 2. Chaque défaut : déjà prévu, à corriger, ou les deux ?

Référence : `docs/conceptions/CONCEPTION-cercle-equaliseur.md` (révision 4) et
`docs/rapports/RAPPORT-cercle-lot-a-maths.md` (lot A livré : maths pures, **non branchées**).

### Défaut 1 — le halo de la parole → **(c) : une partie est couverte, une partie ne l'est pas**

**Ce qui EST couvert (lot C, §7.3)** : le document donne à la parole un **autre afficheur**,
le contour à 32 zones, et fait de l'`::before` un simple **repli**, jamais un doublon. Si le
contour est peint, l'enveloppe est éteinte : le défaut disparaît **parce que l'élément
disparaît**. C'est propre.

**Ce qui N'EST PAS couvert** — et c'est le point que je ne peux pas classer « déjà prévu » :

- Avec la **voix du système** (le réglage par défaut : aucune voix locale installée), il n'y
  a pas de WAV à analyser, donc pas de contour : `spectrumPlan` rend alors
  `porteur: "enveloppe"` (`src/js/vocal-equalizer.js:551-566`, cas `else if (enParole)`).
  **L'enveloppe invisible EST l'afficheur de la parole** dans cette configuration. Le lot C
  ne le corrige pas, il s'appuie dessus.
- **Aucune section du document ne mesure ni ne change la visibilité de l'enveloppe** : le
  §6.0 ne fait que la **renommer** (`@keyframes vocal-halo` → `vocal-speak-glow`) ;
  `inset: -18px`, les 22 %, l'orientation du dégradé ne sont touchés par **aucune** ligne ;
  le §6.2 chiffre le halo **intérieur** (qui n'existe pas encore), pas celui-ci. Le §7.3
  parle d'« une lueur qui respire » sans jamais vérifier qu'elle se voit.
- Détail qui va dans le même sens : `spec_modes_ecran_vocal.md:142` annonce pour la parole
  « halo de 1,6 s + enveloppe du trait ». La promesse est écrite ; le rendu ne la tient pas.

**Donc** : la *structure* est prévue (l'enveloppe devient un repli), la *visibilité* ne l'est
pas. Un lot à venir ne répare ce défaut **que** sur les installations en voix locale.

### Défaut 2 — l'intérieur du cercle en écoute → **(c) : le gros est couvert par le lot B, le reste non**

**Ce qui EST couvert (lot B, §6, décision 4)** :

- un élément **`.vocal-halo` ajouté à l'intérieur du disque** (§6.1), piloté par une variable
  propre (`--vocal-heard`, `levelToHalo(niveau) = √niveau` → rayon 0 → 82 px), teinté
  `--vocal-listen` (§6.2) ;
- le **trait est retiré** dans le même lot (§9.2) : la critique « la barre en dessous n'est
  pas convaincante » est donc réglée par **disparition**, pas par embellissement ;
- la position décide du sens : intérieur ≤ 82 px = **voix de l'utilisateur**, extérieur
  ≥ 84 px = **voix de Pilot** (§6.0) — c'est la correction du mélange que le rapport décrit.

**Ce qui N'EST PAS couvert par B, C ni D** — trois points, tous chiffrés au §6.3/§6.8 du
document, aucun traité comme un défaut :

1. **L'amplitude réelle.** Le rayon 0 → 82 px donne, d'après la table du document
   (`CONCEPTION-cercle-equaliseur.md:559-573`) :
   **40 px de diamètre à 0,06** (le seuil), **52 px à 0,10**, **82 px à 0,25** — dans un
   disque intérieur de 164 px. C'est plus vivant qu'un trait de 3 px, mais cela reste une
   tache de **25 à 50 %** du diamètre. Le seul levier est la courbe (`√`, volontairement
   plate) : elle se change **au lot D**, sans réglage utilisateur. À décider **après mesure**
   du gain réel, pas avant.
2. **Mouvement réduit** : le halo est **figé à 0,55** (rayon 45 px), il ne suit plus la voix
   du tout (§6.8, et `spectrumPlan` renvoie déjà `lueur` dans ce cas). Assumé par le
   document — mais si le poste du propriétaire est en réduction de mouvement, le défaut 2
   **reste entier après le lot B**. Même mesure que le défaut 1.
3. **Le flash d'écho de fin de lecture** (Q8) : hors du périmètre du document.

**Donc** : le défaut 2 est **réellement prévu** (lot B), correctement localisé, et le trait
disparaît. Ce qui reste n'est pas un oubli de conception mais un **chiffre à mesurer** avant
le lot D, plus un cas (mouvement réduit) à trancher.

---

## 3. Ce qu'il reste à corriger, chiffré

Aucun réglage utilisateur n'est nécessaire pour aucun des trois points.

### A. Enveloppe de parole réellement visible — *défaut 1*

> **Correction minimale, en une phrase** : inverser le dégradé de `.vocal-orb::before` pour
> que la lumière soit **au bord** de la boîte (pic sur la couronne extérieure, transparent
> vers l'intérieur) et remonter son alpha au bord à **≥ 30 %**, pour que le seul élément
> visible soit celui qui déborde du disque — ou, décision plus honnête et gratuite,
> **supprimer** l'enveloppe et assumer que « parole sans voix locale » se dit par l'anneau
> et le mot.

- Fichiers : `src/css/style.css` uniquement.
- Volume : **4 à 6 lignes** (arrêts du dégradé `11641-11646`, alpha du bord, éventuellement
  `inset`).
- Risque de régression : **moyen**. Un test touche ce bloc (`ecran-vocal-lot2.test.js:243-252` :
  « aucune couleur en dur dans `.vocal-orb::before` » → il faudra rester sur
  `var(--vocal-state)`), et le §7.3 veut à terme l'épingler sur `--vocal-speak` (sans effet
  aujourd'hui, même jeton). **Rien** ne verrouille `inset: -18px`, les `22 %`, ni
  `@keyframes vocal-halo` (vérifié par `grep` dans **tous** les tests de l'écran :
  `ecran-vocal-lot2`, `lot3`, `lot4a`, `ecran-vocal-nu`, `trois-modes-ecran`,
  `logo-bouton-trois-modes`, `vocal-correctifs-revue` — seul `ecran-vocal-lot2` cite
  `::before`, et seulement pour interdire les couleurs en dur). La boîte
  passerait de 200 à ~204 px dans une scène de 800 px : aucun débordement.
- Si l'option « supprimer » est choisie : **2 lignes** retirées, même risque.

### B. Mesure préalable, qui peut annuler A — *défaut 1*

Ce n'est pas une correction : c'est **une ligne dans la console** pendant que Pilot lit
(§6, mesure 1). Si `vocal-reduced` est présent, le halo est **éteint par le réglage** et A ne
le rendra pas visible. Aucun fichier.

### C. Amplitude du halo d'écoute — *défaut 2, lot D déjà prévu*

> **Correction minimale** : garder la racine carrée mais lui ajouter un **plancher de rayon**
> (ou un exposant plus pentu) une fois le niveau réel relevé.

- Fichiers : `src/js/vocal-mic.js` (`levelToHalo`, **à créer** — voir la remarque ci-dessous).
- Volume : **2 à 3 lignes**.
- Risque : **faible**. Un test à mettre à jour : `ecran-vocal-lot3.test.js:595-597`
  (`--vocal-level`), qui deviendra `--vocal-heard`.
- ⚠️ **Constat à signaler** : le lot A **n'a pas** livré `levelToHalo` ni étendu `planLevel`
  (`vocal-mic.js:146-150` rend encore `{ ecrire, largeur }`) — le rapport du lot A le dit
  (« `vocal-mic.js` intact », §5). Le lot B devra donc créer cette fonction avant de brancher
  quoi que ce soit.

### D. Flash « écoute » sur l'écho de fin de lecture — *défaut 2/Q8, non couvert*

> **Correction minimale** : ne pas laisser le niveau allumer l'état d'écoute pendant
> `VOCAL_ARM_AFTER_READ_MS` (600 ms) après la fin d'une lecture — la variable
> `vocalApresLecture` existe déjà (`super-agent.js:4971`), elle n'est simplement pas lue par
> l'affichage.

- Fichiers : `src/js/super-agent.js` (`vocalSetLevel` `:4120` ou `applyVocalState` `:4276`).
- Volume : **3 lignes** + 1 test.
- Risque : **moyen-faible** — cela touche la machine d'état, verrouillée par
  `ecran-vocal-lot3.test.js` et `vocal-mesure-en-premier.test.js`.
- **À ne faire que si la mesure 3 le montre** : aujourd'hui c'est une hypothèse, pas un fait.

---

## 4. Tests existants, et ce qui manque pour que ce soit tenu par un test

### Ce qui est déjà verrouillé (donc intouchable sans le dire)

| Test | Ce qu'il tient |
|---|---|
| `ecran-vocal-lot2.test.js:212-219` | disque 168 px, anneau 2 px `var(--vocal-state)`, remplissage 18 % au centre / 0 % aux bords |
| `ecran-vocal-lot2.test.js:221-233` | trait 200 × 3 px, rayon 2 px, `gap: 24px` |
| `ecran-vocal-lot2.test.js:235-241` | la longueur du trait vient de `var(--vocal-level, 8%)` |
| `ecran-vocal-lot2.test.js:243-252` | **aucune couleur en dur** dans `.vocal-orb`, `.vocal-level-bar`, `.vocal-orb::before`, `.vocal-orb::after` |
| `ecran-vocal-lot2.test.js:292-305` | mouvement réduit : les 4 cas de `vocalReducedMotion`, trait figé 8/45/20/70, `animation: none` |
| `ecran-vocal-lot2.test.js:161-170`, `:467` | état → classe, état → jeton, `speaking: vocalSpeaking` dans `applyVocalState` |
| `ecran-vocal-lot3.test.js:595-597`, `:611-626` | `--vocal-level` écrit par `vocalSetLevel` ; micro sans lecteur ; `planLevel` en mouvement réduit |
| `ecran-vocal-nu.test.js:57-73`, `:186-192` | la liste exacte des nœuds de l'écran et leurs mesures |
| `vocal-mesure-en-premier.test.js:282-288` | titres/commentaires seulement (assertions inchangées) |

### Ce qui manque, précisément

1. **« Le halo se voit en parole »** — **aucun** test ne lit la géométrie de
   `.vocal-orb::before`. `grep` de `-18px`, `22%`, `vocal-halo` dans les cinq tests de
   l'écran : **zéro occurrence**. Un test existe sur l'élément (`:248`) mais seulement pour
   interdire les couleurs en dur.
   **Ce qu'il faudrait** : un test qui recompose la couronne visible du dégradé (rayons 84 →
   fin de boîte) et exige un **alpha composité ≥ un plancher** (par exemple 25 %). L'alpha
   n'est pas une impression : c'est un nombre, calculable comme au §1 — le test peut porter
   la même formule que ce rapport. Et un second, trivial : sous `.vocal-state-speaking`,
   `.vocal-orb::before` a `opacity: 1` et une animation, **et pas** `opacity: 0`.
2. **« L'intérieur suit la voix »** — aujourd'hui **impossible à écrire** : rien ne le fait.
   Après le lot B, deux tests doivent exister : (a) `.vocal-halo` lit la variable de niveau
   et elle est écrite par `vocalSetLevel` en écoute ; (b) `levelToHalo` est **pure et
   monotone** (0 → 0, 1 → 1) — c'est le test du lot A qui **n'existe pas**, puisque la
   fonction n'existe pas.
3. **L'invariant « le cercle ne lit jamais le niveau »** — la décision 2 du document dit que
   le **halo intérieur** est l'afficheur de l'utilisateur ; aujourd'hui c'est un **trait**.
   Un test d'invariant bon marché le verrouillerait :
   `expect(bloc(CSS, ".vocal-orb {")).not.toMatch(/vocal-level|vocal-heard/)` — vrai
   aujourd'hui, faux après le lot B, donc à écrire **en même temps que le lot B**.

---

## 5. Verdict par défaut, en trois lignes

- **Défaut 1 — halo de parole** : **présent, activé, invisible.** Branchement complet
  (`read-aloud.js:817` → `super-agent.js:4968` → `:4293`), mais la lumière du dégradé est au
  **centre, sous le disque**, et la couronne extérieure ne dépasse pas **2,99 % d'alpha /
  1,044 : 1**. Ce n'est ni « absent », ni « jamais atteint » : c'est **la géométrie à
  l'envers**. Cause concurrente à écarter d'abord : **mouvement réduit** (`style.css:11804`).
  **Couverture** : (c) — le lot C le contourne quand la voix locale est installée, aucune
  section ne le corrige pour la voix du système.
- **Défaut 2 — intérieur en écoute** : **vrai défaut, déjà prévu.** Le niveau n'a qu'**un**
  consommateur, la barre de 3 px (`style.css:11710`) ; le disque ne lit rien et le JS n'y
  touche jamais (`super-agent.js:4229`). Le commentaire `style.css:11677-11679` (« le disque
  ne bouge pas, il suit le micro (lot 3) ») est **faux** : l'intention a été écrite, pas
  implémentée. **Couverture** : (c) — le lot B le corrige (halo intérieur + retrait du
  trait), restent l'amplitude (lot D, après mesure), le mouvement réduit (halo figé), et le
  flash d'écho (hors document).

---

## 6. Les trois mesures qui tranchent (1 minute, aucune modification)

1. **Pendant que Pilot lit** : `document.querySelector('.pilot-vocal').className` — si
   `vocal-reduced` y figure, le halo est **éteint par le réglage** : défaut 1 expliqué, et
   la correction A ne servirait à rien.
2. **Pendant que vous parlez** : `getComputedStyle(document.querySelector('.pilot-vocal')).getPropertyValue('--vocal-level')`
   et la même chose `'::before'` → `opacity` — cela donne la **plage réelle** du niveau
   (question 7) et l'opacité effective de l'enveloppe.
3. **Juste après la fin d'une lecture, sans parler** : la classe de l'overlay devient-elle
   `vocal-state-listening` ? Si oui, l'écho est visible → correction D justifiée ; si non,
   D est à écarter.

---

## 7. Ce que ce rapport ne prouve pas

- **La perception à l'œil** : les contrastes sont **calculés** (formule WCAG), pas regardés.
  Un humain peut voir un 1,04 : 1 d'une teinte très saturée sur une grande surface lisse ;
  je ne le crois pas, mais je ne le prouve pas.
- **Le gain réel du micro** : `autoGainControl` demandé (`vocal-mic.js:180-190`) rend toute
  conversion niveau → amplitude dépendante du périphérique.
- **La valeur d'`echoCancellation` sur le poste du propriétaire** : `echoCancellationOf`
  (`vocal-mic.js:239-260`) existe mais n'est **pas** appelée à l'affichage ; le flash d'écho
  (D) reste une hypothèse.
- **Aucun test lancé, aucun build** : les invariants cités sont **lus** dans le source et
  listés avec leur fichier:ligne, pas ré-exécutés.

---

**DONE** : diagnostic des deux défauts visuels de l'écran Vocal, en lecture seule — halo de
parole **présent et activé mais invisible par construction** (dégradé à 22 % au centre caché
sous le disque ; couronne extérieure ≤ 2,99 % d'alpha, contraste mesuré 1,044 : 1 sombre /
1,041 : 1 clair ; même teinte que l'anneau ; aucun `box-shadow` ni `filter`), avec le
**mouvement réduit** comme cause concurrente (`style.css:11804`) ; état « parole » réellement
atteint (chaîne `read-aloud.js:817` → `super-agent.js:4968` → `:4293`) ; intérieur du cercle
en écoute **non piloté** (`--vocal-level` n'a qu'un consommateur, `style.css:11710`, le JS ne
touche jamais `.vocal-orb`, `super-agent.js:4229`) et commentaire CSS `:11677-11679` faux ;
classements honnêtes — défaut 1 = (c) le lot C le contourne seulement en voix locale, aucune
section ne le corrige ; défaut 2 = (c) le lot B le corrige, restent amplitude (lot D, après
mesure), mouvement réduit, flash d'écho ; corrections chiffrées (A : 4-6 lignes de
`style.css`, risque moyen ; C : 2-3 lignes, risque faible, `levelToHalo` **absent** du lot A ;
D : 3 lignes, seulement si la mesure le montre) ; **aucun réglage utilisateur** ; ce qui
manque aux tests est nommé (aucune assertion sur la géométrie du halo, `levelToHalo` non
testable car inexistante, invariant « le cercle ne lit pas le niveau » à écrire avec le lot
B) ; trois mesures qui tranchent données ; rapport écrit dans
`docs/rapports/RAPPORT-diagnostic-defauts-visuels-vocal.md`, aucun code modifié, aucun test
lancé, commit du seul rapport.
