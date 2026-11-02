# Conception — le cercle-égaliseur et le halo d'écoute de l'écran Vocal

> **Révision 4 — 28 octobre 2026.** Remplace les révisions 1 à 3 (même fichier,
> même objet). Elle intègre **cinq décisions fermes du propriétaire** (§1) : les
> trois de la révision 2, la **quatrième** — *le trait du niveau est remplacé par
> un halo qui remplit l'intérieur du cercle* — et la **cinquième**, qui décide ce
> que la révision 3 laissait en suspens : *chaque lueur a SA couleur, une par
> voix, prise dans le thème*.
>
> Elle corrige, du même coup, **deux points** de la révision 3 : la teinte des
> afficheurs de voix ne suit plus **l'état** mais **la voix** (§7.2), et
> l'enveloppe de parole devient le **repli** du contour, jamais son doublon
> (§7.3). Elle lève aussi l'ambiguïté du mot « halo » (§6.0).
>
> Proposition écrite, applicable **sans interprétation**, lot par lot.
> **Aucun fichier de code n'est modifié par ce document.** Aucun test, aucun
> build n'a été lancé pour l'écrire : chaque affirmation technique porte sa
> preuve `fichier:ligne`, vérifiée sur le disque à cette date. Les contrastes
> sont **mesurés** (WCAG 2.x, `(L1+0,05)/(L2+0,05)`) et non estimés.

---

## 0. Ce qui change par rapport à la révision 2

| Point | Révision 2 | Révision 3 (décision 4) | Révision 4 (décision 5) |
|---|---|---|---|
| Afficheur de **la voix de l'utilisateur** | le **trait** de 200 × 3 px sous le disque | **le halo d'écoute** : un remplissage translucide **dans** le disque, du centre vers le bord | inchangé, mais sa teinte est celle **de la voix** et non de l'état : `--vocal-listen` (§7.2) |
| Afficheur de **la voix de Pilot** | le **contour** (32 zones) | **inchangé** | inchangé, teinte **`--vocal-speak`** (§7.2) ; l'enveloppe n'en est plus qu'un **repli** (§7.3) |
| Le trait | conservé, mais réduit à la seule voix de l'utilisateur | **supprimé** — il n'en reste rien : ni nœud, ni `.vocal-level`, ni pourcentage | inchangé |
| Deux animations décoratives du trait | supprimées au lot 2 | supprimées **avec le trait**, dans le même commit | inchangé |
| **L'enveloppe de parole** (`.vocal-orb::before`, ex-« halo de la parole ») | conservée | conservée, **renommée** pour qu'un seul mot désigne **une seule** chose (§6.0) | **repli** : éteinte dès que le contour est peint — plus jamais deux afficheurs pour la même voix (§7.3) |
| Le mot « **halo** » | désignait la lueur **extérieure** | devient « enveloppe de parole » | désigne désormais **l'intérieur** ; pour la lueur extérieure il est une **erreur**, pas un raccourci (§6.0) |
| Couleur des afficheurs de voix | `var(--vocal-state)`, donc la teinte de l'**état** | idem | **une teinte par voix**, trois épingles, **aucun pixel changé** (§7.2) |
| Rythme vertical sous le disque | disque → 24 px → trait → 24 px → texte | disque → **24 px** → texte (le bloc est 27 px plus court) | inchangé |
| Lots | 4 | 4, **redécoupés** : le halo et le retrait du trait sont **un seul** lot (§11) | **toujours 4** : B gagne trois lignes sans effet visuel, C gagne une classe et une règle (§11) |

Le crux de la révision 2 ne change pas et reste la base du contour : **la voix
locale de Pilot est analysable sans micro ; la voix du système ne l'est pas.**
Ce qui change ici, c'est l'autre canal : la voix de l'utilisateur passe du
**trait** au **halo**, sans changer de source (le même niveau mesuré), sans
changer de seuils, sans changer une seule phrase de l'écran.

---

## 1. Décisions du propriétaire (28 octobre 2026)

Cinq décisions, reproduites telles quelles, **fermes**. Elles ne sont pas
rouvertes dans ce document ; elles sont traduites en contraintes.

### Décision 1 — « 32 zones toutes différentes, pas un miroir »

> Le propriétaire veut **32 zones distinctes sur tout le tour**, et **pas** un
> contour en miroir.

**Traduction.** 32 zones angulaires de 11,25°, chacune avec **sa** valeur.
Conséquences : 32 bandes de fréquences distinctes (§5.2), un seul sens de
lecture (aucun aller-retour), une couture invisible par construction (§5.4), et
la suppression du lissage **spatial** entre zones voisines.

### Décision 2 — « cercle pour sa voix, second afficheur pour la mienne »

> Le propriétaire accepte que **le contour bouge pendant que Pilot lit**, avec
> une répartition de sens : le **cercle** pour **la voix que Pilot prononce**,
> le second afficheur pour **la voix de l'utilisateur (micro)**.

**Traduction, et c'est la règle d'organisation de tout l'écran :**

> **Un afficheur, une voix. Un état, un mouvement.**

| Afficheur | Voix qu'il montre | Bouge quand | Sa couleur, et d'où elle vient (décision 5) |
|---|---|---|---|
| Le **contour du cercle** (32 zones) | celle de **Pilot** | Pilot **parle** *et* son son est **analysable** (§2) | `--vocal-speak`, le jeton de **cette** voix (§7.2) |
| Le **halo d'écoute** (§6, décision 4) | celle de l'**utilisateur** | l'état est **écoute**, c'est-à-dire quand le micro **mesure** réellement quelque chose (§6.5) | `--vocal-listen`, le jeton de **cette** voix (§7.2) |
| L'**enveloppe de parole** (repli du contour) | celle de **Pilot**, quand elle n'est pas analysable | Pilot parle *et* le contour ne peut pas être peint (§7.3) | `--vocal-speak`, la même que le contour |

Elle interdit, et c'est donc retiré de l'écran : faire bouger le cercle avec le
micro ; faire bouger l'afficheur de l'utilisateur avec la voix de Pilot ; le
faire bouger au rythme de rien du tout pendant la réflexion.

### Décision 3 — amplitude du contour : 16 px, sauf collision

> Le propriétaire n'a pas tranché l'amplitude et demande de **garder la
> recommandation (16 px)**, sauf si les 32 zones créent une collision.

**Traduction.** 16 px **est conservée**. Vérification au §5.7 : les 32 zones sont
les **sommets d'une seule ligne de 2 px**, qui ne peut pas se chevaucher
elle-même. Aucune collision.

### Décision 4 — **le trait disparaît, remplacé par un halo intérieur** (nouvelle, 28 octobre 2026)

> Le propriétaire : *« Au lieu du trait pour la voix de l'utilisateur, n'est-il
> pas possible de faire un système qui remplit l'intérieur du cercle (sans
> déborder) avec une couleur translucide et jolie qui irait avec le thème
> choisi ? »* Puis, sur la forme : **un halo qui part du centre et s'étend vers
> le bord — plus la voix est forte, plus le halo s'étend.**

**Traduction, en cinq contraintes fermes :**

1. **le trait est retiré** — pas déplacé, pas réduit, pas caché : retiré (§9) ;
2. **le halo remplit l'intérieur** du disque, **jamais** au-delà du bord (§6.3) ;
3. sa **couleur vient du thème** et **de la voix qu'il montre** — jamais de l'état (§6.4, §7.2), sans nouveau réglage ;
4. sa **taille** suit le niveau du micro **déjà mesuré**, du centre vers le bord
   (§6.2) ;
5. au **silence il n'y a rien** — pas un rond gris, pas un résidu (§6.6).

**Conséquence de calendrier, ferme aussi** : le retrait du trait et l'arrivée du
halo sont **un seul lot** (§11, lot B). Il ne doit **jamais** exister une version
de l'écran où la voix de l'utilisateur n'a **aucun** afficheur.

### Décision 5 — « chaque lueur a SA couleur » (nouvelle, 28 octobre 2026)

> Le propriétaire : *« chaque lueur a SA couleur, prise dans les couleurs du
> thème sélectionné. Deux voix, deux couleurs, donc on sait toujours qui parle
> sans lire une phrase. »*

**Traduction, en quatre contraintes fermes :**

1. **une teinte par voix** : le halo d'écoute (vous) et le contour (Pilot) ne
   lisent pas la même variable ;
2. la teinte vient des **jetons de thème déjà existants** — aucun jeton créé,
   aucune valeur en dur, aucune couleur écrite dans une règle (§7.2) ;
3. **aucun réglage** : ni cinquième couleur à choisir, ni case dans Paramètres ;
4. les deux teintes restent **distinctes et lisibles** dans les deux thèmes
   (clair, sombre) et sur les quatre états — **mesuré**, pas supposé (§7.2).

**Ce que la décision ne change pas, et c'est volontaire:** l'anneau et le
remplissage du disque continuent de suivre **l'état** (`--vocal-state`) : c'est
le repère des quatre états, et il se trouve qu'il vaut le jeton de la voix dans
les deux seuls états où une voix existe. Rien ne s'ajoute à l'écran.

---

## 2. Faisabilité, franche et prouvée : les deux voix de Pilot

La décision 2 déplace la source du contour : il faut analyser **la voix que
Pilot prononce**. Pilot a **deux** moteurs de lecture, et ils ne se valent pas.

| | Voix **locale** (Piper, `local:piper`) | Voix **du système** (`speechSynthesis`) |
|---|---|---|
| Qui produit le son | un **fichier WAV** fabriqué par le moteur local, **joué par la fenêtre** | le moteur de synthèse **du système**, hors de la page |
| Preuve | `src/js/local-voice.js:782` (`new AudioCtor(url)`), `:789` (`audio.play()`), `:158` (`LOCAL_AUDIO_PREFIX = "data:audio/wav;base64,"`), `src-tauri/src/tts_local.rs:620-626` | `src/js/read-aloud.js:913` (`synth.speak(utterance)`) : aucun élément audio, aucun flux |
| Le signal est-il dans la page ? | **OUI** — les échantillons sont en JavaScript **avant** d'être joués | **NON** |
| Analysable **sans micro** ? | **OUI** (§2.1) | **NON** (§2.2) |
| Ce que ça donne à l'écran | le contour **bouge**, fidèlement | le contour **reste au repos** ; l'enveloppe de parole et le mot « Je réponds. » portent la parole |

### 2.1 Voix locale : analysable, et voici exactement comment

Le son est un `data:audio/wav;base64,…` que Pilot **tient déjà en mémoire**
(`local-voice.js:158`, `tts_local.rs:620-626`). On ne l'écoute pas : on **relit
les nombres qu'on lui donne à jouer**. Vrai par construction : ça marche **au
casque**, **sans son**, **sans la moindre capture**.

- **Route retenue — décoder le WAV nous-mêmes** : le module pur
  `vocal-equalizer.js` (§5), aucune API audio.
- **Route écartée — `createMediaElementSource` + `AnalyserNode`** : (1) une
  fois l'élément raccordé au graphe, un contexte suspendu ou fermé **coupe le
  son** — une animation d'affichage ne doit **jamais** rendre l'application
  muette ; (2) elle exige un `AudioContext` temps réel, donc la carte son ;
  (3) elle **n'unifie rien**, la voix du système n'étant pas routable.

### 2.2 Voix du système : **pas** analysable — et je ne fais pas semblant

`read-aloud.js:913` remet le texte au moteur du système et n'en reçoit **aucun**
son ; le projet le dit déjà : « la voix de la synthèse n'est pas capturable par
le navigateur » (`spec_modes_ecran_vocal.md:164`).

**La seule façon d'animer le contour sur la voix du système serait d'écouter les
haut-parleurs par le micro.** Je le dis net et je ne le propose pas : au casque
il n'y a rien à capter ; en haut-parleurs le micro capterait un mélange et
**volerait** le micro de l'utilisateur — c'est-à-dire exactement le canal que la
décision 4 vient d'occuper (le halo). Le halo montre **le micro**, jamais la
voix du système.

**Comportement retenu.** Le contour s'anime **si et seulement si** le son est
réellement lisible ; sinon le cercle reste exactement ce qu'il est aujourd'hui —
un anneau net — et l'enveloppe de parole + le mot « Je réponds. » portent la
parole. On ne montre pas une voix qu'on n'entend pas.

### 2.3 Le micro existant n'est pas touché — promesse vérifiable

- Une seule capture dans toute l'application : `vocal-mic.js:413`
  (`createVocalMic`), `:606` (`demander`), un seul `getUserMedia` (`:618-620`).
  **Rien n'y est ajouté, rien n'y est retiré.** Un seul `AnalyserNode` (`:585`).
- Les tests qui **interdisent** l'audio dans l'écran restent verts :
  `ecran-vocal-lot2.test.js:241,470-471`, `ecran-vocal-lot3.test.js:407`,
  `vocal-mesure-en-premier.test.js:268`.
- Le halo consomme **le même chiffre** que le trait consommait : le niveau lissé
  de `vocal-mic.js:534`. **Aucune seconde mesure, aucun second lissage.**

---

## 3. Ce que j'ai vérifié dans l'existant (preuves)

| Fait | Preuve |
|---|---|
| Le micro est ouvert **une seule fois**, par `vocal-mic.js` | `:413`, `:606`, `:618`, `:620` |
| Un analyseur est branché à demeure sur ce flux | `:566`, `:584`, `:585-586`, `:590-591` |
| La mesure tourne image par image tant que le micro est ouvert | `:524`, `:527`, `:542`, `:688`, arrêt `:462`, `:478` |
| Le niveau est lissé (montée 0,5 / descente 0,12) | `vocal-mic.js:97-105`, appliqué en `:534` |
| Le niveau était projeté en longueur de trait (8 → 100 %) | `vocal-mic.js:108-123` (`levelToWidth`), `:132-136` (`planLevel`) |
| L'écran ne pose qu'une variable de style, jamais de micro | `src/js/super-agent.js:4103-4122` (`vocalSetLevel`), `:4121` (`--vocal-level`) |
| L'état affiché vient du **niveau réel**, à deux seuils | `super-agent.js:577-578` (`0,06` / `0,03`), `:585` (`vocalCapte`), `:598` (`vocalVoiceStep`), `:4259` (`applyVocalState`) |
| « Pilot parle » a une seule source : l'état de lecture | `read-aloud.js:124` (`READ_ALOUD_STATE_EVENT`), `:766` ; écouté en `super-agent.js:4296`, `:4915-4933` |
| Le disque : **168 px**, anneau **2 px**, remplissage radial 18 % | `src/css/style.css:11620-11633` |
| **Enveloppe de parole** (ex-« halo de la parole », §6.0) : `inset: -18px` → rayon **102 px** | `style.css:11637-11655` |
| Arc de la **réflexion** : `inset: -6px`, masque 82-84 % → rayon **76-90 px** | `style.css:11656-11679` |
| **Le trait** : 200 × 3 px, rayon 2 px, `width: 8%`, `var(--vocal-level, 8%)` en écoute | `style.css:11687-11711` |
| Les **deux animations décoratives du trait** | `style.css:11712-11717`, `@keyframes` `:11829-11837` |
| Mouvement réduit : halo/arc éteints, trait **figé** 8/45/20/70 % | `style.css:11795-11811`, `super-agent.js:611` |
| Le trait n'a **pas** de fond de piste, ni de bordure | `style.css:11687-11694` |
| Les quatre teintes, contrastes mesurés dans les deux thèmes | `style.css:385-388` (sombre : 6,97 / 10,84 / 5,78 / 11,32 — **exacts**) et `:488-491` (clair : le commentaire annonce 5,47 / 5,09 / 6,81 / 4,81 ; les trois dernières sont mesurées sur le fond de One Light `#fafafa`, la première sur le fond clair de base `#f4f5f7` — sur ce dernier, les quatre valent **5,47 / 4,87 / 6,51 / 4,60**, §7.2) |
| **Dix palettes** : cinq sous-thèmes sombres, cinq sous-thèmes clairs | `style.css:566-605` (`one-dark`), `:608-629` (dracula), `:632-653` (nord), `:656-677` (tokyo-night), `:680-701` (github), `:704-725` (one-light), `:728-749` (solarized), `:752-773` (tokyo-day) |
| **Les jetons de voix suivent `var(--success)`/`var(--warning)` en sombre, mais sont des hexadécimaux fixes en clair** — asymétrie voulue, commentée | `style.css:386-388` contre `style.css:482-491` (« en theme CLAIR, --success (2,89:1) et --warning (1,87:1) echouent meme le seuil de 3:1 … on reprend donc les MEMES teintes, ASSOMBRIES ») |
| Aucune couleur en dur dans l'objet : uniquement `--vocal-state` | `style.css:11612-11615`, `11626`, `11629`, `11644`, `11663`, `11700` |
| **La teinte suit l'ÉTAT, pas la voix** — y compris sur les afficheurs de voix | `style.css:11613` / `:11615` (l'état vaut la voix), `:11644` (enveloppe) ; le lot C aurait recopié `--vocal-state` sur le contour (§5.1, rév. 3) |
| L'anneau change de couleur en 0,3 s | `style.css:11626` (`border-color`), `:11632` (`transition: … var(--transition-smooth)`), `:312` (`0.3s`) |
| L'enveloppe est **déjà** éteinte en mouvement réduit | `style.css:11804-11807` |
| Durées existantes | `style.css:312` (`--transition-smooth: 0.3s`), `:313` (`--transition: 0.18s`), `:11703` (`width 80ms linear`) |
| L'écran est **nu** : l'objet, le trait, la ligne d'état, la saisie | `src/js/ecran-vocal-nu.test.js:57-73`, `super-agent.js:4198-4223` |
| Fenêtre minimale : 800 × 500 | `src-tauri/tauri.conf.json:47-48` |

**Conclusion.** Rien n'est à démonter d'autre que le trait. Il manque **une
chose** pour le contour : lire un spectre — celui du fichier que Pilot joue. Il
manque **une chose** pour le halo : dessiner le niveau déjà mesuré, à
l'intérieur du disque.

---

## 4. Le chemin du signal, de bout en bout

Deux chaînes, deux sources réellement distinctes — c'est ce qui rend la
répartition honnête et pas seulement jolie.

```
VOIX DE PILOT (contour)
  tts_local.rs ──WAV base64──► local-voice.js ──┬─► HTMLAudioElement (le son, inchangé)
                                                └─► vocal-equalizer.js (pur : WAV → 32 bandes × 30 img/s)
                                                        │ onSpectrum(timeline, i)
                                                        ▼
                                                  super-agent.js : vocalSetSpectrum → spectrumPlan → <path d="…">

VOIX DE L'UTILISATEUR (halo)
  vocal-mic.js ──AnalyserNode (existant)──► onLevel(niveau LISSÉ) ──► super-agent.js : vocalSetLevel
                                                                        └─► --vocal-heard (0..1)
                                                                            └─► .vocal-halo (dégradé radial)
```

Ce qui est **ajouté** à la chaîne du bas : une case de plus dans le plan de
niveau, et **une propriété de style** — pas un nœud d'analyse, pas un capteur,
pas une boucle.

Trois propriétés qui découlent de ce dessin :

1. **la boucle d'animation du contour** vit à côté du son (`local-voice.js`) et
   meurt avec le morceau : aucune horloge au repos ;
2. **le halo n'a aucune boucle propre** : il est repeint par le niveau, qui
   n'existe que micro ouvert (`vocal-mic.js:542`, `:688`) ;
3. **l'écran ne connaît aucun mot de l'audio** : il reçoit des nombres.

---

## 5. Le contour exact : 32 zones, chiffré

### 5.1 Géométrie (aucune valeur inventée)

| Grandeur | Valeur | D'où elle vient |
|---|---|---|
| Disque | 168 × 168 px, anneau 2 px **inclus** | `style.css:11620-11626` |
| Rayon de l'anneau (ligne médiane) | **R0 = 83 px** | 168 / 2 − 1 |
| Amplitude | **A = 16 px** | décision 3 |
| Rayon maximal | **Rmax = 99 px** | 83 + 16 |
| Boîte SVG | **216 × 216 px**, `inset: -24px`, `viewBox="0 0 216 216"` | 168 + 2 × 24 |
| Centre | **(108, 108)** | 216 / 2 |
| Marge de sécurité | **9 px** de chaque côté | 108 − 99 |
| Épaisseur du trait | **2 px** (= l'anneau), `linecap`/`linejoin: round`, `fill: none` | `style.css:11624` |
| Couleur | **`var(--vocal-speak)`** — le jeton de la voix de **Pilot**, épinglé (§7.2). Jamais `var(--vocal-state)` : la couleur dit **qui** parle, pas dans quel état on est. | `style.css:388`, `:491` ; mesures §7.2 |
| Contraste de cette teinte (contour **opaque**) | **11,32:1** (sombre) / **4,60:1** (clair) | mesuré §7.2 |
| Opacité | **1** | contraste garanti |

> **Écart corrigé (rév. 3).** La révision 3 annonçait pour cette ligne « 5,78:1
> (sombre) / 6,81:1 (clair) » : ce sont les deux valeurs de **`--vocal-think`**
> (la réflexion), pas de `--vocal-speak`. Les valeurs justes sont **11,32:1** et
> **4,60:1**, et elles sont meilleures — le contour est donc encore plus lisible
> que le document ne le promettait.

Au silence, la position zéro de chaque zone **est** l'anneau : le contour n'est
alors rien de plus que le cercle — et, depuis la décision 5, il est **de la même
couleur** que lui (§7.2) : au silence, on ne voit littéralement que le cercle.

### 5.2 Les 32 zones : bandes, ordre, sens, couture

**Les bandes.** 32 bandes **géométriques** (l'oreille est logarithmique) :

- borne basse `SPECTRUM_LOW_HZ = 200` ;
- borne haute `SPECTRUM_HIGH_HZ = min(8000, 0,45 × sampleRate)` — **lue dans
  l'en-tête du WAV**, jamais dans une constante (les modèles `low` de Piper sont
  en 16 kHz, les `medium` en 22 050 Hz ; la table `LOCAL_VOICE_MODELS`
  (`local-voice.js:54-59`) ne porte ni taux ni spectre) ;
- largeur d'une bande : `40^(1/32) = 1,122`, soit **+0,5 dB** de puissance par zone.

**Bande → cases de la FFT.** FFT de **512** points, fenêtre de Hann,
`Δf = sampleRate / 512` (43,07 Hz à 22 050 Hz, 31,25 Hz à 16 000 Hz) :

```
début(0) = round(200 / Δf)
début(k) = max(début(k-1) + 1, round(f(k) / Δf))          // strictement croissant
fin(k)   = min(Nyquist, début(k+1) - 1)                    // contigu, jamais vide
```

**Aucune bande vide, aucune case comptée deux fois** : les 32 valeurs sont
réellement distinctes — la décision 1 est tenue par la mesure.

**Où commence la zone la plus grave.** La **bande 1 est centrée exactement à
6 heures** : l'œil trouve les graves là où il les attend.

**Sens de lecture : horaire, une seule fois.** Angle mesuré depuis 12 heures :

```
α(k) = 180° + 11,25° × k        (k = 0 → 31)
x(k) = 108 + r(k) × sin α(k)
y(k) = 108 − r(k) × cos α(k)
```

Repères : `k = 0` → (108, 191) = **6 h** ; `k = 8` → (25, 108) = **9 h** ;
`k = 16` → (108, 25) = **12 h** ; `k = 31` → juste à droite de 6 h.

**La couture** (entre la zone 32 et la zone 1, à 174,375°, 11,25° comme les
autres) est invisible pour trois raisons : la courbe est **fermée** (le segment
32→1 est tracé par la même formule), il n'y a **aucun raccord droit** (que des
`C`), et elle tombe **en bas**, entre la bande la plus aiguë et la plus grave.
Si un défaut se voyait, le seul remède autorisé est de **décaler le départ d'une
demi-zone** (`α(k) = 174,375° + 11,25°k`) — jamais un miroir.

### 5.3 De la mesure au rayon

Par image (30 par seconde), et par bande `k` :

1. `P(k) = Σ |X(b)|² / nbCases(k)` ;
2. `dB(k) = 10 × log10(P(k) + 1e-12)` ;
3. `v(k) = clamp((dB(k) − FLOOR) / (CEIL − FLOOR), 0, 1)` avec
   `SPECTRUM_FLOOR_DB = -80`, `SPECTRUM_CEIL_DB = -30` ;
4. `v(k) = √v(k)` (compression d'affichage) ;
5. lissage **temporel** `smoothLevel` (montée 0,5 / descente 0,12,
   `vocal-mic.js:97-105`) **bande par bande** — **aucun lissage spatial** ;
6. `r(k) = 83 + 16 × v(k)`.

`FLOOR` et `CEIL` sont les **deux seules valeurs non dérivables** : elles se
mesurent au lot D sur les quatre voix livrées. Ce sont des bornes de **dessin** :
aucun seuil d'état, aucune phrase, aucun réglage.

### 5.4 Le chemin SVG (formule exacte)

32 points `P(k)`, Catmull-Rom uniforme convertie en Bézier cubiques, indices
modulo 32 (donc courbe fermée) :

```
C1(k) = P(k)   + (P(k+1) − P(k−1)) / 6
C2(k) = P(k+1) − (P(k+2) − P(k))   / 6
d = "M" P(0) puis, pour k = 0…31 : "C" C1(k) C2(k) P(k+1)   puis "Z"
```

Coordonnées arrondies à **0,1 px** ; chaîne d'environ **0,9 Ko** ; un seul
`path.setAttribute("d", chemin)` par image.

### 5.5 Le silence est le cercle exact

- si `max(v) < 0,03` → l'attribut `d` est **retiré** : on revoit l'anneau pur ;
- à la **fin** de la lecture, `d` est retiré **immédiatement** (aucune retombée
  animée : le son s'arrête au même instant) ;
- entre deux morceaux d'une même phrase, `d` **n'est pas retiré** : l'état reste
  « parole » et le contour enchaîne.

### 5.6 Coûts (ordres de grandeur, à confirmer au lot D)

| Étape | Coût | Quand |
|---|---|---|
| décodage base64 + en-tête + PCM | ~1-2 ms (132 Ko pour 3 s) | au début du morceau |
| 32 bandes × 90 images (FFT 512) | ~3-8 ms | idem |
| mémoire | ≈ 11,5 Ko de bandes + 264 Ko de PCM, **libérés à la fin du morceau** | — |
| peinture | 1 `setAttribute` de ~0,9 Ko, **30 /s** | pendant le morceau |
| hors mode Vocal / sans voix locale | **zéro** | toujours |

### 5.7 Vérification des collisions (la question de la décision 3)

| Question | Réponse chiffrée |
|---|---|
| Deux zones voisines se chevauchent-elles ? | **Non** : 32 **sommets d'une seule ligne de 2 px**, qui ne se chevauche pas elle-même. |
| L'écart angulaire suffit-il ? | **Oui** : 11,25°, soit **16,3 px** d'arc à R0 et **19,4 px** à Rmax, pour 16 px de dénivelée maximale (pente ~44°). |
| Le contour sort-il de sa boîte ? | **Non** : Rmax 99 px dans une boîte de 216 px → **9 px de marge**. |
| Rencontre-t-il le halo d'écoute (rayon ≤ 82 px) ? | **Jamais** : le halo s'arrête à 82 px, le contour commence à 83 px (§6.3). |
| Rencontre-t-il l'enveloppe de parole (102 px) ? | **Jamais en même temps** : elle est éteinte dès que le contour vit (§7). |
| Rencontre-t-il l'arc de réflexion (76-90 px) ? | **Jamais en même temps** : l'arc n'existe qu'en réflexion. |
| Tient-il dans la fenêtre 800 × 500 ? | **Oui** : boîte de 216 px, centrée. |

**Conclusion : 16 px est conservée.** Seul risque visuel assumé : un contour
« hérissé » sur les attaques ; le remède défini est **uniquement** de relever la
descente du lissage temporel de 0,12 à 0,18 — jamais de réduire le nombre de
zones.

---

## 6. Le halo d'écoute, au chiffre près

C'est le remplacement du trait. Tout ce qui suit est contenu dans **un seul
élément** ajouté à l'écran, **à l'intérieur** du disque.

### 6.0 Un mot, une chose (nettoyage de vocabulaire, sans effet visuel)

Le disque porte aujourd'hui deux pseudo-éléments :

| Pseudo-élément | Ce qu'il fait | Nom dans ce document |
|---|---|---|
| `.vocal-orb::before` (`style.css:11637-11655`, `@keyframes vocal-halo` `:11825-11828`) | enveloppe **extérieure** qui ondule pendant que Pilot lit | **enveloppe de parole** (renommer le `@keyframes` en `vocal-speak-glow`) |
| `.vocal-orb::after` (`:11656-11673`) | arc qui tourne pendant la réflexion | **arc de réflexion** (inchangé) |
| `.vocal-halo` (**nouveau**) | remplissage **intérieur** qui suit la voix de l'utilisateur | **halo d'écoute** |

Un seul mot doit désigner une seule chose : sinon le prochain lecteur croira que
« le halo » est la même chose dans les deux cas. Le renommage du `@keyframes` ne
change **rien** au rendu et n'est cité par **aucun test** (vérifié : `vocal-halo`
n'apparaît que dans `style.css`).

**La règle d'emploi, et elle est ferme.** La décision 5 fait entrer un second mot
dans l'écran ; l'ambiguïté n'est donc plus une gêne de lecture, elle devient un
risque de confusion entre **deux afficheurs de deux voix différentes**. Trois
règles suffisent :

1. **« halo » ne désigne jamais la lueur extérieure** — dans le code comme dans
   la doc. On dit « halo d'**écoute** » pour l'intérieur (vous) et
   « **enveloppe de parole** » pour l'extérieur (Pilot). Un mot qui pourrait
   désigner l'un **ou** l'autre n'est pas un raccourci : c'est une erreur, et
   c'est celle que la révision 3 commettait en appelant « halo » la lueur de
   Pilot.
2. **la position tranche toujours** : à l'intérieur du disque (rayon ≤ 82 px,
   §6.1) c'est vous ; à l'extérieur (rayon ≥ 84 px) c'est Pilot, ou la
   réflexion. Les deux ne se rencontrent jamais (§5.7).
3. **l'enveloppe n'est plus un afficheur de la parole, c'est son repli** : elle
   est éteinte dès que le contour est peint (§7.3) — ce qui est précisément la
   raison pour laquelle elle ne peut pas redevenir, en silence, un second
   afficheur de Pilot.

**Où le mot « halo » traîne encore sur le disque** (à corriger au lot B : aucune
ligne de comportement, aucun pixel) :

| Endroit | Ce qu'il dit aujourd'hui | Ce qu'il doit dire |
|---|---|---|
| `style.css:11634-11636` (commentaire) | « Halo de la PAROLE » | « Enveloppe de parole » |
| `style.css:11825` (`@keyframes vocal-halo`) | anime l'**enveloppe**, mais porte le nom du **halo d'écoute** | `vocal-speak-glow` |
| ce document, partout | « halo de la parole », « halo » seul | voir les trois règles ci-dessus |
| ce document, **à partir du §6** | « le halo » — forme courte | **autorisée** : le nom est défini ici, une seule fois, et aucun autre objet du document ne s'appelle « halo ». Elle ne l'est **pas** si elle peut se lire comme la lueur extérieure : dans ce cas on écrit « enveloppe de parole ». |

**La vérification tient en un `grep`**, et c'est ce qui rend la règle 1 vérifiable
autant que les autres : `vocal-halo` ne doit apparaître que sur `.vocal-halo`
(le `<span>` intérieur, §6.1) ; s'il apparaît sur `::before`, `::after` ou dans un
nom de `@keyframes`, c'est la lueur extérieure qui porte le nom du halo d'écoute —
l'erreur exacte que le lot B corrige.

> **Hors de ce livrable, mais à signaler** : `spec_modes_ecran_vocal.md:142`
> décrit encore la parole comme « halo 1,6 s + enveloppe du trait » — deux mots
> périmés (le halo de la parole n'existe plus, le trait non plus) ;
> `README.md:120-121` et `help/overview.md:444` annoncent encore « un trait de
> niveau juste dessous ». Ces trois textes ne sont **pas** modifiés ici : ce
> document est le seul livrable, et leur correction relève des lots B et C (§11).

### 6.1 Structure et position (pourquoi il ne peut pas déborder)

```
.vocal-orb          position: relative ; 168 × 168 px ; border: 2px solid
└── span.vocal-halo position: absolute ; inset: 0 ; border-radius: 50 %
```

| Grandeur | Valeur | Preuve / calcul |
|---|---|---|
| Boîte de l'anneau | 168 × 168 px, bordure de **2 px** | `style.css:11623-11626` |
| Boîte de référence du halo (padding box) | **164 × 164 px** | 168 − 2 × 2 ; un enfant `position:absolute; inset:0` est placé dans le *padding box* |
| Rayon de référence du halo | **82 px** | 164 / 2 |
| Rayon de l'anneau | 82 → 84 px | idem |
| Rayon **maximal** du halo | **82 px, jamais plus** | le fond est découpé par `border-radius: 50 %` **de sa propre boîte**, et le dégradé s'arrête au plus tard à **100 % de `closest-side`** = 82 px |

**Preuve de non-débordement, en trois points :**

1. **par la boîte** : `inset: 0` dans le *padding box* → le halo ne peut pas
   dépasser 164 px de large, quoi qu'il arrive ;
2. **par le découpage** : `border-radius: 50 %` découpe **aussi le fond** (pas
   seulement la bordure) → la peinture est un disque de 82 px de rayon ;
3. **par le dégradé** : `radial-gradient(closest-side, …)` a un rayon de
   **min(82, 82) = 82 px**, et le dernier arrêt est à
   `calc(var(--vocal-halo) × 100 %)`, avec `--vocal-halo ∈ [0, 1]` → au plus
   **82 px**.

Résultat : **le halo s'arrête exactement sur le bord intérieur de l'anneau.**
Il ne le recouvre pas (`border` est peinte avant les enfants, mais il n'y a même
pas de recouvrement géométrique), et il ne peut pas atteindre le contour, qui
commence à **83 px**.

> **Aucun `overflow: hidden` n'est posé sur `.vocal-orb`.** C'est volontaire :
> un `overflow: hidden` découperait aussi l'enveloppe de parole (`inset: -18px`)
> et l'arc de réflexion (`inset: -6px`), qui vivent **dehors** et doivent rester
> visibles. Le confinement du halo vient de **sa propre boîte**, pas d'un
> couvercle sur le disque.

### 6.2 Ce qui s'étend : rayon, opacité, dégradé (chiffres exacts)

Le halo est **un seul dégradé radial** de trois arrêts, tous **proportionnels à
une seule valeur** `--vocal-halo ∈ [0, 1]` :

```css
.vocal-halo {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
  --vocal-halo: var(--vocal-heard, 0);   /* 0 = absent (valeur jamais posée) */
  background: radial-gradient(
    closest-side,
    color-mix(in srgb, var(--vocal-listen) 42%, transparent) 0%,
    color-mix(in srgb, var(--vocal-listen) 22%, transparent)
      calc(var(--vocal-halo) * 62%),
    color-mix(in srgb, var(--vocal-listen) 0%, transparent)
      calc(var(--vocal-halo) * 100%)
  );
  opacity: 0;
  transition: opacity 160ms linear;
}
```

| Élément | Valeur | Pourquoi ce chiffre |
|---|---|---|
| Opacité au **centre** | **42 %** du jeton de la voix de l'utilisateur (`--vocal-listen`, §7.2) | visible sur les deux thèmes, encore translucide (« joli », pas un aplat) — les contrastes mesurés sont au §7.2 |
| Opacité au **62 %** du rayon du halo | **22 %** | la décroissance est douce, sans auréole dure |
| Opacité au **bord** du halo | **0 %** de la même teinte | aucun bord net, aucun liseré, **aucun gris** (`color-mix` avec 0 % de la même teinte, jamais le mot-clé `transparent` seul) |
| Rayon du halo | `--vocal-halo × 82 px` | décision 4 : « part du centre, s'étend vers le bord » |
| Épaisseur de la décroissance | 38 % du rayon du halo | un noyau plein (0→62 %) et une retombée (62→100 %) |

**Pourquoi trois arrêts et non deux.** Un dégradé à deux arrêts (42 % → 0 %)
donne soit un disque à bord mou mais centre plat et terne, soit un bord visible.
Trois arrêts gardent un **centre lumineux** (42 %), une **transition douce**
(22 % à 62 %) et un **bord invisible** (0 %). C'est ce qui fait « halo » et non
« rond coloré ».

**Pourquoi `color-mix` avec 0 % de la même teinte au bord.** Le mot-clé
`transparent` est un noir transparent : mal interpolé, il fait un **liseré
gris**. Le projet emploie déjà `color-mix(in srgb, … , transparent)`
(`style.css:11629`, `:11644`) ; ici le bord est écrit avec **0 % de la teinte**,
ce qui garantit une disparition dans **la** couleur, donc aucun résidu.

### 6.3 L'échelle avec le niveau du micro (le niveau existant, jamais une autre mesure)

`--vocal-heard` **est** le niveau lissé du micro, projeté sur `[0, 1]` par une
fonction **pure** de racine carrée — exactement la même échelle que l'ancien
trait (`levelToWidth`, `vocal-mic.js:118-123`, racine carrée) :

```
levelToHalo(niveau) = round( sqrt(clamp(niveau, 0, 1)) × 1000 ) / 1000
```

**Aucun seuil ajouté, aucune mesure ajoutée** : `niveau` est la valeur déjà
livrée par `onLevel` (`vocal-mic.js:534-536`), telle que l'écran la reçoit
aujourd'hui.

Rayon du halo = `levelToHalo(niveau) × 82 px` :

| Niveau RMS | `--vocal-heard` | Rayon du halo | Diamètre | Où on en est |
|---|---|---|---|---|
| 0 | 0,000 | **0 px** | 0 | rien (le dégradé est replié sur lui-même) |
| 0,01 | 0,100 | 8,2 px | ~16 px | un souffle à peine perceptible |
| **0,03** | **0,173** | **14,2 px** | ~28 px | **seuil bas** (sortie d'écoute, `VOCAL_VOICE_OFF`) |
| **0,06** | **0,245** | **20,1 px** | ~40 px | **seuil haut** (entrée en écoute, `VOCAL_VOICE_ON`) |
| 0,10 | 0,316 | 25,9 px | ~52 px | voix normale, posée |
| 0,25 | 0,500 | 41,0 px | 82 px | parole franche |
| 0,50 | 0,707 | 58,0 px | 116 px | voix forte |
| 0,75 | 0,866 | 71,0 px | 142 px | voix très forte |
| 1,00 | 1,000 | **82,0 px** | **164 px** | maximum : le halo touche le bord **intérieur** de l'anneau |

La racine carrée est indispensable : une échelle linéaire collerait le halo au
centre sur une voix normale (0,10 × 82 = 8 px) au lieu de 26 px.

### 6.4 La couleur du halo : **celle de la voix**, et rien d'autre

Le halo ne lit plus `var(--vocal-state)` : il lit le jeton de **la voix de
l'utilisateur**, `var(--vocal-listen)` — c'est la décision 5. Le raisonnement
complet, les quatre états, les dix palettes et les contrastes mesurés sont au
**§7.2** ; cette section ne garde que ce qui concerne le halo lui-même.

| Ce que le halo doit suivre | Mécanisme | Preuve |
|---|---|---|
| La teinte **de sa voix** | `var(--vocal-listen)`, aux trois arrêts du dégradé | `style.css:386` (sombre), `:489` (clair) ; §6.2 |
| Le **thème sombre** | `--vocal-listen` = `var(--success)` = `#4ade80` | `style.css:386` |
| Le **thème clair** | `--vocal-listen` = `#1f7a4d` | `style.css:489` |
| La **translucidité** | `color-mix(… N%, transparent)` | `style.css:11629`, `:11644` (méthode existante) |

- **Aucune couleur en dur, aucun jeton nouveau.** Le halo n'écrit qu'une
  variable, et elle existait déjà (`:386`, `:489`). Il n'écrit plus
  `--vocal-state` : la couleur dit **qui** parle, pas **dans quel état** on est.
- **Aucun pixel ne change pour autant.** En écoute, `--vocal-state` **vaut**
  `--vocal-listen` (`:11613`) : le halo reçoit exactement la teinte qu'il
  recevait hier. Seul le **nom** de la variable change — et c'est ce qui rend la
  règle vérifiable par simple lecture du CSS (§7.2).
- **Aucun nouveau réglage.** `--vocal-heard` n'est **pas** un réglage : c'est la
  même plomberie que `--vocal-level` aujourd'hui (une valeur posée par le code,
  invisible dans Paramètres). Rien n'est ajouté à l'écran de réglages.
- **Contraste : mesuré, pas supposé.** La révision 3 affirmait qu'un halo à 42 %
  de ce vert « est franchement visible » sur fond clair. C'est vrai à l'œil, et
  **faux au chiffre** : 1,80:1 seul sur le fond, 2,13:1 par-dessus le remplissage
  du disque, contre **3,72:1** en sombre. Le halo est donc **redondant par
  construction** : l'écoute est dite par l'anneau (4,87:1 clair / 10,84:1
  sombre), par le mot et par la classe d'état. La valeur d'ajustement, si le
  propriétaire veut que le halo porte l'information seul, est chiffrée au §7.2
  (**67 %** en clair) — et c'est le seul chiffre que le lot D ajuste déjà à
  l'œil.

### 6.5 Quand il existe : un seul état, et c'est « écoute »

```css
.pilot-vocal.vocal-state-listening .vocal-halo { opacity: 1; }
.pilot-vocal:not(.vocal-state-listening) .vocal-halo { --vocal-halo: 0; }
```

| État | Halo | Pourquoi |
|---|---|---|
| **repos** | **absent** (opacité 0) | personne ne parle ; micro ouvert dans le silence = repos (`spec_modes_ecran_vocal.md:153`) |
| **écoute** | **présent**, rayon = niveau mesuré | le micro capte vraiment (deux seuils, `super-agent.js:577-585`) |
| **réflexion** | **absent** | le micro peut être ouvert, mais rien de la voix de l'utilisateur n'est affiché — c'est l'arc qui dit « je travaille » |
| **parole** | **absent** | c'est Pilot qui parle : le canal de l'utilisateur doit être muet |

C'est **exactement le périmètre de l'ancien trait** (`style.css:11709-11711` :
la longueur n'était lue qu'en écoute). Le remplacement est donc **un pour un**,
et la règle « un afficheur, une voix » devient une règle de feuille de style,
pas une intention.

**Pourquoi les deux gardes sont redondantes (opacité + valeur 0).** L'opacité
dit « la voix de l'utilisateur est-elle à l'écran » ; la valeur 0 dit « le
dégradé est-il replié ». Les deux tombent ensemble : aucun état intermédiaire ne
peut laisser un rond gris. Ce n'est pas une ceinture de sécurité de trop, c'est
la raison pour laquelle la contrainte « halo absent au silence » est **vérifiable
par lecture du CSS** et non par confiance.

### 6.6 Au silence : rien, et pas un résidu

Trois situations, toutes vérifiables :

| Situation | `--vocal-heard` | Rendu |
|---|---|---|
| micro **fermé / refusé / en panne** | **jamais posé** → `var(--vocal-heard, 0)` = 0 | les trois arrêts du dégradé sont à **0 %** → la zone au-delà du dernier arrêt prend la couleur du dernier arrêt, soit **0 % de la teinte** = **rien**. L'opacité est de plus à 0 hors écoute. |
| micro ouvert, **pièce silencieuse** | le niveau lissé retombe (`descente 0,12`, `vocal-mic.js:101`) et l'état repasse en **repos** sous 0,03 (`super-agent.js:578`) | le halo se replie, puis **s'éteint avec l'état** (fondu de 160 ms, §6.7) |
| sortie du mode | l'overlay est détruit (`exitVocal`) | rien |

**Aucun « résidu gris » possible** : le dernier arrêt est la teinte de l'état à
**0 %**, pas le mot-clé `transparent`, et l'absence de valeur (`0`) replie le
dégradé au centre.

### 6.7 Vitesses : cohérentes avec le reste, sans second lissage

| Ce qui bouge | Commande | Chiffre | Pourquoi |
|---|---|---|---|
| **L'extension** | le niveau, déjà lissé **en amont** (`smoothLevel`, montée **0,5** / descente **0,12**, appliqué en `vocal-mic.js:534`) | **aucun** lissage supplémentaire, **aucune** transition CSS sur le dégradé | un second lissage doublerait le retard ; et une propriété personnalisée non enregistrée ne s'interpole pas : une transition sur le dégradé ne ferait que « sauter » |
| **L'attaque** | montée 0,5 / image | **50 % du chemin en 1 image, 88 % en 3 images ≈ 50 ms à 60 img/s** | la voix se voit « en direct » |
| **La retombée** | descente 0,12 / image | **sous le seuil bas (0,03) en ~28 images ≈ 470 ms** | même lenteur que l'ancien trait : aucune saute d'humeur |
| **L'apparition / disparition** | `opacity 160ms linear` — **seule** durée ajoutée | 160 ms | l'ancien trait faisait `width 80ms linear` (`style.css:11703`) ; le halo double parce qu'il occupe une grande surface. On n'emprunte **pas** `--transition` (0,18 s, `ease-spring` : réservée au mouvement d'interface, pas à un signal) ni `--transition-smooth` (0,3 s : trop lent pour une voix) |

**Pourquoi une durée en dur ici est acceptable.** C'est **une** valeur, dans
**une** règle, au même endroit que celle qu'elle remplace (`width 80ms linear`).
Aucun jeton nouveau, aucun réglage.

### 6.8 Mouvement réduit : figé, comme l'était le trait

L'écran lit **le même drapeau** que les animations (`vocalReducedMotion`,
`super-agent.js:611` ; `prefers-reduced-motion` **et** le paramètre
« Animer l'ouverture des modales »). Aujourd'hui : plus aucune animation, et le
trait **figé** à 8 / 45 / 20 / 70 % (`style.css:11795-11811`).

Demain, **une** valeur figée, dans le seul état où une voix de l'utilisateur
existe :

```css
/* dans la liste des sélecteurs déjà neutralisés (:11795-11803) : ajouter
   `.pilot-vocal.vocal-reduced .vocal-halo` → animation et transition coupées */
.pilot-vocal.vocal-reduced.vocal-state-listening .vocal-halo { --vocal-halo: 0.55; }
```

| État, mouvement réduit | Halo |
|---|---|
| repos | absent |
| **écoute** | **présent, rayon fixe = 0,55 × 82 = 45,1 px** (diamètre ~90 px) : « quelque chose est entendu », sans mouvement |
| réflexion | absent |
| parole | absent |

**45,1 px** plutôt qu'une autre valeur : c'est un halo d'environ **un tiers de
la surface** du disque — visible, manifestement immobile, et assez loin du bord
pour ne pas ressembler à un halo bloqué au maximum.

`planLevel` renvoie déjà `ecrire: false` en mouvement réduit
(`vocal-mic.js:134`) : **rien n'est posé en ligne**, donc la règle CSS gagne.
Aucune ligne de JavaScript supplémentaire n'est nécessaire.

> **Note de cascade, à ne pas inverser.** La valeur posée par le code est sur
> **l'overlay** (donc héritée) ; la règle de mouvement réduit est sur
> **`.vocal-halo` lui-même**. Une déclaration directe gagne toujours sur une
> valeur héritée : la règle figée s'applique donc même si une valeur traînait.

### 6.9 Le halo et la voix de l'utilisateur : ce qu'il ne fait jamais

| Piège | Réponse de la conception |
|---|---|
| Montrer la **voix de Pilot** (écho des haut-parleurs) | impossible en état « parole » : la garde `:not(.vocal-state-listening)` met `--vocal-halo: 0` **et** `opacity: 0`. Le micro peut entendre l'écho, l'écran ne le dessine pas. |
| Montrer le **bruit de la pièce** | le niveau doit franchir **0,06** pour que l'état passe en écoute (`super-agent.js:577`) ; en dessous, l'état reste au repos et le halo est éteint. |
| Clignoter pendant une phrase | hystérésis existante (0,06 / 0,03) + retombée lente : **une** bascule par silence, pas par syllabe. |
| Doubler l'affichage | le trait est **retiré** dans le même lot (§9) : un seul afficheur de la voix de l'utilisateur. |
| Ajouter un capteur | aucune ligne ajoutée dans `vocal-mic.js` (§2.3). |

**Prise de parole (barge-in), ordre réel des opérations.** Le niveau est livré à
l'écran (`vocal-mic.js:536`, `surNiveau`) **avant** la garde de prise de parole
(`:540`, `mesurerParole`). L'écran bascule donc en « écoute » — et le halo
s'allume — au moment même où la lecture est coupée (`vocalBargeIn` →
`stopReading`). Il n'existe **aucune** image où le halo montre une voix pendant
que l'écran affirme encore « Pilot parle ».

---

## 7. Les deux afficheurs, jamais concurrents — et chacun dans SA couleur

Trois questions, dans l'ordre : **qui bouge** (7.1), **dans quelle couleur**
(7.2), et **ce que devient l'enveloppe** maintenant que le contour porte la
voix de Pilot (7.3).

### 7.1 Qui bouge, quand

| Situation | Le **contour** (voix de Pilot) | Le **halo d'écoute** (voix de l'utilisateur) |
|---|---|---|
| **Pilot lit, voix locale** (analysable) | **il bouge** : 32 zones, 30 img/s | **absent** (état parole, garde §6.5) |
| **Pilot lit, voix du système** (non analysable) | **pas dessiné** (`d` retiré, §5.5) ; l'enveloppe de parole (1,6 s, repli §7.3) et le mot « Je réponds. » le disent | **absent** |
| **L'utilisateur parle** (état écoute) | **immobile** : `spectrumPlan({ enParole: false })` → `d` retiré, anneau net | **il s'étend** : rayon = niveau mesuré, 0 → 82 px |
| **L'utilisateur parle par-dessus Pilot** | il s'arrête : la lecture est coupée, donc plus de spectre | il s'allume **au moment** de la bascule en écoute, c'est-à-dire quand la lecture est déjà coupée |
| **Pilot réfléchit** | **l'arc** tourne (3 s) — du travail, pas une voix | **absent** |
| **Repos** | respiration du disque (4 s) | **absent** |

**Ce que fait le halo pendant que Pilot parle : rien.** Il est éteint par une
règle de style, pas par une intention.

**Ce que fait le contour quand l'utilisateur parle : rien.** Il est retiré par
la décision pure `spectrumPlan` (`enParole` faux), donc il n'y a même pas de
chemin à peindre.

| État | L'unique chose qui bouge | Ce qu'elle dit | Sa couleur (décision 5) |
|---|---|---|---|
| repos | la respiration du disque | « je suis là » | aucune voix affichée (anneau `--vocal-rest`) |
| écoute | **le halo d'écoute** | **la voix de l'utilisateur** | `--vocal-listen` (§7.2) |
| réflexion | l'arc qui tourne | « je travaille » | aucune voix affichée (anneau `--vocal-think`) |
| parole | **le contour** — ou l'enveloppe + le mot s'il n'y a rien à analyser | **la voix de Pilot** | `--vocal-speak` (§7.2), les deux afficheurs |

### 7.2 Couleurs des deux voix — une teinte par voix, prise au thème

**La règle, reproduite** (décision 5, §1) : *« chaque lueur a SA couleur, prise dans
les couleurs du thème sélectionné. Deux voix, deux couleurs. »*

**Le défaut que ça corrige, dit net.** Jusqu'à la révision 3, les deux afficheurs
de voix lisaient `var(--vocal-state)` : la teinte de **l'état**, pas celle d'une
**voix**. Ça tombe juste aujourd'hui par accident — l'état « écoute » vaut
`--vocal-listen` (`style.css:11613`) et l'état « parole » vaut `--vocal-speak`
(`:11615`) — mais rien ne l'empêche de dériver : il suffit qu'un afficheur de voix
vive dans un autre état pour qu'il prenne la couleur d'une voix qui n'est pas la
sienne. La décision 5 remplace un accord **accidentel** par une garantie
**écrite**.

**Les trois épingles.** Chaque afficheur de voix nomme **son** jeton. Une ligne
chacune, aucun jeton créé, aucune valeur en dur.

| Afficheur | Lisait (rév. 3) | Lit (rév. 4) | Où c'est écrit |
|---|---|---|---|
| **halo d'écoute** (voix de l'utilisateur) | `var(--vocal-state, var(--vocal-rest))` | **`var(--vocal-listen)`** | §6.2, aux trois arrêts du dégradé (lot B) |
| **contour** (voix de Pilot) | `var(--vocal-state)` | **`var(--vocal-speak)`** | §5.1 — le SVG n'existe pas encore (lot C) |
| **enveloppe de parole** (repli de la voix de Pilot) | `var(--vocal-state, var(--vocal-rest))` | **`var(--vocal-speak)`** | `style.css:11644` (lot B, sans effet visuel) |
| **anneau + remplissage 18 % du disque** | `var(--vocal-state)` | **inchangé** : c'est le repère d'**état**, pas une voix | `style.css:11626`, `:11629` |

**Pourquoi l'anneau reste sur l'état, et pourquoi ce n'est pas une exception.**
L'anneau est le seul élément continu de l'écran : il dit **dans quel état** on est,
et les quatre états sont plus nombreux que les deux voix (repos et réflexion n'ont
aucune voix). Il se trouve que `--vocal-state` **vaut** le jeton de la voix dans
les deux seuls états où une voix existe : l'anneau et l'afficheur de voix sont donc
toujours de la **même** couleur, et cette couleur ne peut pas se contredire. C'est
exactement l'effet cherché : le tour **et** la lueur changent ensemble, en 0,3 s
(`border-color`, `style.css:11626`, `:11632`, `--transition-smooth` = `0.3s`
`:312`).

**Les deux valeurs, et leur provenance.**

| Voix | Jeton | Sombre | Clair | Preuve |
|---|---|---|---|---|
| **L'utilisateur** (halo) | `--vocal-listen` = `var(--success)` en sombre, hexadécimal fixe en clair | `#4ade80` (teinte 149,6°) | `#1f7a4d` (teinte 155,2°) | `style.css:386` / `:489` |
| **Pilot** (contour, enveloppe) | `--vocal-speak` = `var(--warning)` en sombre, hexadécimal fixe en clair | `#fbbf24` (teinte 83,3°) | `#b45309` (teinte 56,5°) | `style.css:388` / `:491` |

Ce sont les jetons des **deux seuls états où une voix existe**
(`spec_modes_ecran_vocal.md:140`, `:142`). Aucun cinquième jeton n'est créé :
`--vocal-rest` (le bleu du repos) aurait lié la voix de l'utilisateur à « personne
ne parle », `--superagent-accent` (le violet) à « Pilot travaille ».

**Aucun pixel ne change aujourd'hui — et c'est ce qui prouve que l'épinglage est
sûr.** En écoute, `--vocal-state` **est** `--vocal-listen` (`:11613`) : le halo
reçoit exactement la teinte qu'il recevait hier. En parole, `--vocal-state` **est**
`--vocal-speak` (`:11615`) : le contour et l'enveloppe aussi. Les épingles changent
un **nom**, jamais un rendu — et c'est précisément ce qui rend la règle vérifiable
par simple lecture du CSS, sans connaître l'ordre des états.

**Une asymétrie du disque qu'il faut connaître avant de lire les chiffres.** En
**sombre**, les deux jetons de voix sont `var(--success)` et `var(--warning)`
(`:386-388`) : ils **suivent** chaque sous-thème (Dracula `#50fa7b`, Nord
`#a3be8c`, Tokyo Night `#9ece6a`…). En **clair**, ce sont des **hexadécimaux
fixes** (`:489`, `:491`), et c'est voulu : le commentaire du fichier dit que, sur
fond clair, `--success` (2,89:1) et `--warning` (1,87:1) « echouent meme le seuil
de 3:1 » (`:482-487`). Les cinq palettes claires partagent donc **la même paire de
voix**, et seule la **teinte du fond** change. Ce n'est pas la décision 5 qui
l'impose : c'est déjà écrit, et c'est une chance pour nous (voir les chiffres).
Le jeton du **repos**, lui, suit `var(--accent-text)` dans les deux thèmes
(`:385`, `:488`) : il change donc dans **chaque** palette — c'est sans importance
ici, puisqu'il ne porte aucune voix.

#### Distinctes l'une de l'autre — mesuré dans les dix palettes du projet

| Palette | Fond (`--bg-app`) | Repos | **Écoute (vous)** | Réflexion | **Parole (Pilot)** | Écart de teinte | ΔE\*ab | Seuil 3:1 |
|---|---|---|---|---|---|---|---|---|
| sombre (base) | `#0f1115` | 6,97 | **`#4ade80` 10,84** | 5,78 | **`#fbbf24` 11,32** | 66,3° | 80,6 | tenu |
| One Dark | `#282c34` | 6,27 | `#98c379` 6,94 | 4,28 | `#e5c07b` 8,10 | 46,4° | 33,1 | tenu |
| Dracula | `#282a36` | 6,52 | `#50fa7b` 10,38 | 4,35 | `#f1fa8c` 12,74 | 35,4° | 51,4 | tenu |
| Nord | `#2e3440` | 6,95 | `#a3be8c` 6,13 | **3,82** | `#ebcb8b` 8,00 | 43,5° | **26,7** | tenu |
| Tokyo Night | `#1a1b26` | 6,79 | `#9ece6a` 9,35 | 5,22 | `#e0af68` 8,55 | 48,7° | 42,2 | tenu |
| clair (base) | `#f4f5f7` | 5,47 | **`#1f7a4d` 4,87** | 6,51 | **`#b45309` 4,60** | 98,8° | 82,1 | tenu |
| GitHub Light | `#f6f8fa` | 5,54 | `#1f7a4d` 4,99 | 6,67 | `#b45309` 4,72 | 98,8° | 82,1 | tenu |
| One Light | `#fafafa` | 5,93 | `#1f7a4d` 5,09 | 6,81 | `#b45309` 4,81 | 98,8° | 82,1 | tenu |
| Solarized Light | `#fdf6e3` | 6,40 | `#1f7a4d` 4,93 | 6,59 | `#b45309` 4,66 | 98,8° | 82,1 | tenu |
| Tokyo Night Day | `#e1e2e7` | 5,14 | `#1f7a4d` 4,11 | 5,49 | `#b45309` **3,88** | 98,8° | 82,1 | tenu |

*(Contrastes WCAG 2.x de la teinte **opaque** sur le fond de l'application, mesurés
au script ; ΔE\*ab et teintes en CIELAB, D65.)*

**Résultat, sans détour : les deux voix sont distinctes et lisibles dans les dix
palettes.** Le pire cas est **3,88:1** (parole, Tokyo Night Day) et **3,82:1**
(réflexion, Nord) : le seuil de 3:1 d'un élément graphique non textuel est tenu
de **1,27× à 4,2×** selon la palette, et **neuf palettes sur dix** dépassent même
4,5:1. La paire la plus proche est Nord (ΔE 26,7) — un vert sauge contre un sable —
et elle reste franchement séparée : **26,7 est très au-dessus du seuil de
confusion** (ΔE < 2 pour deux teintes confondues, < 10 pour « proches »).

**Les deux couleurs ne sont jamais à l'écran au même instant** (§7.1) : la
question n'est donc pas de les distinguer côte à côte, mais de savoir si **le
passage de l'une à l'autre se voit**. Il se voit, pour deux raisons : l'écart de
teinte va de 35,4° à 98,8°, et la bascule est un changement de couleur de
**l'anneau en 0,3 s** (`:11632`) — plus court qu'une phrase. Le seul instant où
les deux teintes coexistent est ce fondu de 300 ms, et il n'y a jamais deux
marques de deux voix : le contour est retiré **immédiatement** (`spectrumPlan`,
§5.5) pendant que l'anneau change de couleur.

#### Le cas critique : le halo est translucide

Un halo, par définition, n'a pas de bord : son contraste est **maximal au
centre** et tend vers 1:1 à son bord. Il faut donc lire les chiffres **au centre**,
qui est le **meilleur** cas, pas le pire :

| Palette | halo seul (42 % sur le fond) | halo par-dessus le remplissage 18 % du disque | seuil 3:1 |
|---|---|---|---|
| sombre (base) | 2,80:1 | **3,72:1** | tenu (grâce au disque) |
| Dracula | 3,02:1 | **3,92:1** | tenu |
| Tokyo Night | 2,72:1 | **3,51:1** | tenu |
| One Dark | 2,43:1 | **3,01:1** | tenu de justesse |
| Nord | 2,31:1 | **2,81:1** | **non tenu** |
| clair (base) | 1,80:1 | **2,13:1** | **non tenu** |
| GitHub Light | 1,82:1 | 2,15:1 | non tenu |
| One Light | 1,83:1 | 2,16:1 | non tenu |
| Solarized Light | 1,81:1 | 2,14:1 | non tenu |
| Tokyo Night Day | 1,72:1 | 1,99:1 | non tenu |

**Je ne prétends pas que le halo tienne 3:1 — il ne le tient pas en clair.** La
révision 3 écrivait qu'un halo à 42 % de ce vert « est franchement visible » sur
fond clair : c'est vrai à l'œil, et faux au chiffre. Trois conséquences, dans
l'ordre :

1. **L'information ne dépend pas du halo.** L'écoute est dite par l'anneau
   (4,87:1 clair / 10,84:1 sombre), par le mot (toujours `--text-primary`, 15,4:1
   / 15,6:1, `style.css:11720-11723`) et par la classe d'état. Le halo est
   **redondant** : c'est l'exception prévue par WCAG 2.2 (1.4.11) pour un
   graphique décoratif ou redondant. La **teinte**, elle, survit à la
   translucidité — le halo composé garde la teinte de son jeton (151,9° contre
   149,6° en sombre ; 162,9° contre 155,2° en clair) : un halo vert reste **vert**,
   même pâle, et c'est tout ce que la décision 5 demande.
2. **Si le propriétaire veut que le halo porte l'information seul**, la valeur
   d'ajustement est **l'opacité du centre**, et elle est chiffrée :

   | Palette | alpha minimal, seul sur le fond | alpha minimal, par-dessus le disque 18 % |
   |---|---|---|
   | sombre (base) | 44,5 % | **32,4 %** |
   | Nord | 56,0 % | 46,3 % |
   | clair (base) | 73,0 % | **67,0 %** |
   | Tokyo Night Day | 79,8 % | 75,4 % |

   Je ne la retiens **pas** par défaut : à 67 % en clair, le halo cesse d'être
   translucide et devient un aplat, ce que la décision 4 refuse (« translucide et
   jolie »). Le chiffre est là, prêt, et c'est **le seul réglage que le lot D
   ajuste déjà à l'œil** (§11).
3. **Le mélange avec un autre jeton du thème est écarté, chiffres en main.**
   `color-mix(in srgb, var(--vocal-listen) 68%, var(--text-primary))` remonte
   bien les marques **opaques** (clair 4,87 → 7,22:1) mais **ne sauve pas le
   halo** (2,13 → 2,47:1) et **rapproche les deux voix jusqu'à les confondre**.
   Il détruirait la règle de la décision 5 pour gagner 0,3 point sur une lumière
   décorative : refusé.

**Ce que cette révision ne fait pas aux palettes : rien.** Aucun jeton de thème
n'est modifié, aucun sous-thème n'est retouché. Les deux seuls chiffres que le lot
D peut bouger sont les deux opacités du halo (42 % / 22 %).

### 7.3 Ce que devient l'enveloppe de parole : le repli, jamais un doublon

Les révisions 2 et 3 laissaient l'enveloppe s'afficher **en même temps** que le
contour, comme un second afficheur de la parole. Avec le contour devenu afficheur
de la voix de Pilot, deux afficheurs simultanés pour **une seule voix** : la règle
« un afficheur, une voix » (§1, décision 2) tombe, et la couleur ne sert plus à
rien puisque la même voix serait montrée deux fois. La révision 4 tranche :

> **L'enveloppe de parole est le REPLI du contour.** Elle s'affiche **si et
> seulement si** le contour ne peut pas être dessiné. Jamais en même temps.

| Cas | Contour | Enveloppe | Ce que voit l'utilisateur |
|---|---|---|---|
| parole, **voix locale** (son analysable) | **dessiné** (32 zones, 30 img/s) | **éteinte** | le contour ambre |
| parole, **voix du système** (son non analysable) | **pas dessiné** (`d` retiré, §5.5) | **affichée** (1,6 s) | un anneau ambre **net** + une lueur qui respire + « Je réponds. » |
| parole, **mouvement réduit** | **pas dessiné** (`spectrumPlan`) | **éteinte** (déjà le cas, `style.css:11804-11807`) | un anneau ambre net + le mot — la couleur et le mot portent l'état (`:11792-11793`) |

**Le mécanisme : une classe et une règle.** Le seul code qui sait si le contour
est réellement peint est le peintre. `vocalSetSpectrum` pose donc **une** classe
sur l'overlay — `.vocal-spectrum-live` — et la retire quand il retire le `d`. La
feuille de style s'en sert :

```css
/* Enveloppe = REPLI (§7.3) : éteinte dès que le contour est peint. Quatre
   classes : elle gagne sur la règle d'état (:11651), quel que soit l'ordre. */
.pilot-vocal.vocal-spectrum-live.vocal-state-speaking .vocal-orb::before {
  opacity: 0;
  animation: none;
  transition: none;
}
```

- **quatre classes** contre les trois de `style.css:11651` : la règle gagne **par
  spécificité**, pas par position dans le fichier — un futur déplacement ne peut
  pas la casser ;
- **`animation: none`** parce qu'une animation invisible continue de coûter : sans
  elle, la respiration de 1,6 s (`:11825-11828`) tournerait sous une enveloppe à
  opacité 0 ;
- **`transition: none`** parce que l'enveloppe doit **disparaître au même instant**
  que le contour apparaît — c'est la règle déjà posée au §5.5 pour la fin de la
  lecture (« aucune retombée animée »). Une transition de 0,3 s (`:11648`)
  montrerait deux marques de la même voix pendant trois dixièmes de seconde :
  exactement le doublon que la décision 2 interdit.

**Conséquence de vocabulaire, et elle est ferme.** C'est **parce que** le contour
devient un afficheur de la parole que le renommage du §6.0 n'est plus une
coquetterie : `@keyframes vocal-halo` (`:11825`) anime l'**enveloppe**, alors que
`.vocal-halo` désigne le **halo d'écoute**. Sans renommage, `vocal-halo`
désignerait deux choses dans le même fichier. Le renommage en `vocal-speak-glow`
se fait donc au **lot B** — avant que `.vocal-halo` n'existe.

**Avec la voix du système : contour net, et aucune invitation à installer.** Le
cercle est **net et immobile** — il ne prétend pas suivre une voix qu'on
n'entend pas (§2.2) — l'anneau reste ambre (11,32:1 / 4,60:1), l'enveloppe
reprend son rôle de repli. Le **seul** afficheur dont le mouvement suit une voix
**réellement mesurée** est alors le **halo d'écoute**, qui ne dépend que du micro.
Aucun message, aucun bouton, aucune phrase nouvelle : le §12 (installer la voix
locale, oui ou non) reste la **seule** question ouverte, et cette section ne la
tranche pas — elle dit seulement ce qui s'affiche dans chaque cas.

---

## 8. Les quatre états (rien d'autre ne change)

| État | Afficheur de voix | Sa couleur — sombre / clair | L'anneau (repère d'état) | Mot (inchangé) | Au centre |
|---|---|---|---|---|---|
| repos | **aucun** | — | `--vocal-rest` `#7d97ff` / `#3b57d6` — 6,97 / 5,47 | « Je vous écoute. » | respiration 4 s |
| écoute | **le halo d'écoute** (intérieur) | `--vocal-listen` `#4ade80` / `#1f7a4d` — **10,84 / 4,87** | **la même teinte** | « Je vous écoute… » | anneau net + halo (3,72 / 2,13 au centre, §7.2) |
| réflexion | **aucun** | — | `--vocal-think` `#b06ef7` / `#6d28d9` — 5,78 / 6,51 | « Je réfléchis… » | arc 3 s |
| parole | **le contour** — ou l'enveloppe en repli (§7.3) | `--vocal-speak` `#fbbf24` / `#b45309` — **11,32 / 4,60** | **la même teinte** | « Je réponds. » | contour, ou enveloppe |

**Aucune phrase, aucun libellé, aucun bouton, aucun réglage** n'est ajouté ni
modifié. La colonne « couleur » ne change **rien** à l'écran : c'est la même
teinte qu'hier, désormais nommée **par la voix** au lieu de l'état (§7.2).

**Rythme vertical, chiffré.** Aujourd'hui : disque → **24 px** → trait (3 px) →
**24 px** → texte (`style.css:11607`, `:11693`). Après retrait du trait :
disque → **24 px** → texte. Le bloc perd **27 px** ; comme il est centré dans
l'espace disponible (`justify-content: center`, `style.css:11604`), le disque
descend d'environ **13 px** et la ligne d'état remonte d'environ **13 px**. Rien
d'autre ne bouge, et l'écart de 24 px est **conservé** (la règle `gap` ne change
pas d'un pixel).

**Fenêtre étroite (minimale 800 × 500, `tauri.conf.json:47-48`).** Le halo est
**dans** le disque : il n'ajoute aucune largeur. Le retrait du trait supprime
même le seul élément de 200 px sous le disque, donc **aucun risque** de
débordement horizontal ; les enfants larges restants (ligne d'état 640 px, saisie
`min(720px, 100vw − 32px)` — `style.css:11726`, `:11744`) sont inchangés.

---

## 9. Le trait : exactement ce qu'il faut retirer

### 9.1 Les trois arguments, et pourquoi ils ne tiennent pas

1. **« Le trait est comparable »** (un trait plus long = une voix plus forte,
   facile à comparer d'une seconde à l'autre). **Réponse** : une surface remplie
   se compare aussi bien, et même mieux — on compare des aires, pas des
   extrémités de 3 px.
2. **« Le trait donne un repère permanent de 8 % au repos »**. **Réponse** :
   c'était du mobilier, pas de l'information. Il affichait **8 % aussi bien**
   micro fermé, micro refusé et silence total : il ne distinguait donc **rien**.
   C'est exactement le mensonge que la révision 2 avait supprimé sur les états
   « parole » et « réflexion ».
3. **« Un second afficheur est plus lisible »**. **Réponse** : c'est
   précisément ce que la consigne interdit — **deux afficheurs pour la même
   voix**.

**Ce qu'on perd, dit franchement** : une ligne de 3 px sous l'objet. **Ce qu'on
gagne** : la voix de l'utilisateur devient la **lumière** qui remplit l'objet —
même matière, même métaphore que le reste de l'écran, et un signal lisible de
loin.

**Décision du propriétaire = remplacement.** Rien n'est conservé « au cas où ».

### 9.2 Le retrait, ligne par ligne

| Fichier | Ce qui disparaît | Ligne aujourd'hui |
|---|---|---|
| `src/css/style.css` | `.vocal-level { … }` (200 × 3 px) | `:11687-11694` |
| `src/css/style.css` | `.vocal-level-bar { … }` | `:11695-11704` |
| `src/css/style.css` | `.pilot-vocal.vocal-state-listening .vocal-level-bar { width: var(--vocal-level, 8%) }` | `:11709-11711` |
| `src/css/style.css` | `.pilot-vocal.vocal-state-thinking .vocal-level-bar` (pulsation décorative) | `:11712-11714` |
| `src/css/style.css` | `.pilot-vocal.vocal-state-speaking .vocal-level-bar` (enveloppe décorative) | `:11715-11717` |
| `src/css/style.css` | `@keyframes vocal-think-pulse` et `@keyframes vocal-speak-envelope` | `:11829-11831`, `:11833-11837` |
| `src/css/style.css` | les quatre largeurs figées 8 / 45 / 20 / 70 % | `:11808-11811` |
| `src/css/style.css` | `.vocal-level-bar` dans la liste du mouvement réduit | `:11799` |
| `src/js/super-agent.js` | le nœud `<div class="vocal-level"…><span class="vocal-level-bar"></span></div>` | `:4213` |
| `src/js/super-agent.js` | `--vocal-level` (posé et retiré) | `:4121`, `:4127` |
| `src/js/vocal-mic.js` | `LEVEL_MIN_PCT`, `LEVEL_MAX_PCT`, `levelToWidth` | `:108-123` |
| `src/js/vocal-mic.js` | `planLevel` renvoie `{ ecrire, largeur }` | `:132-136` → `{ ecrire, halo }` |
| Prose (commentaires) | « longueur du trait », « le trait retombe au silence » | `super-agent.js:4099, 4105-4106, 4124` ; `vocal-mic.js:90, 107, 112, 114, 177` |

### 9.3 Ce qui verrouille le trait **aujourd'hui** (preuve, test par test)

Ces tests **échouent** si le trait est retiré sans être mis à jour : ils doivent
donc être modifiés **dans le même commit** que le lot B.

| Fichier de test | Ligne | Ce qu'il verrouille | Ce qu'il doit devenir |
|---|---|---|---|
| `ecran-vocal-nu.test.js` | `:59-73` | la liste des nœuds de l'écran nu **contient `vocal-level`** | `vocal-halo` remplace `vocal-level` |
| `ecran-vocal-nu.test.js` | `:190` | `.vocal-level { width: 200px }` | **supprimé** (le halo n'a pas de mesure propre : il remplit le disque) |
| `ecran-vocal-lot2.test.js` | `:221-228` | `.vocal-level` 200 × 3 px, `.vocal-level-bar` 3 px / rayon 2 px | remplacé par les mesures du halo : `inset: 0`, `border-radius: 50%`, `closest-side` |
| `ecran-vocal-lot2.test.js` | `:230-232` | `gap: 24px` du bloc | **inchangé** (l'écart passe du disque au texte) |
| `ecran-vocal-lot2.test.js` | `:234-242` | en écoute `width: var(--vocal-level, 8%)` | le halo lit `var(--vocal-heard, 0)` ; la seconde assertion (aucune API micro dans `super-agent.js`) **reste** |
| `ecran-vocal-lot2.test.js` | `:244-253` | aucun couleur en dur, liste de sélecteurs incluant `.vocal-level-bar` | même test avec `.vocal-halo` |
| `ecran-vocal-lot2.test.js` | `:294-307` | mouvement réduit **8 / 45 / 20 / 70 %** | un seul cas : halo figé à **0,55** en écoute, éteint dans les trois autres états |
| `ecran-vocal-lot2.test.js` | `:312-319` | le balisage contient `vocal-level` | contient `vocal-halo` |
| `ecran-vocal-lot3.test.js` | `:225-241` | `levelToWidth` (0 → 8, 1 → 100, NaN → 8, monotonie) | **supprimé avec la fonction** ; remplacé par les bornes de `levelToHalo` (0 → 0, 1 → 1, NaN → 0, monotonie) |
| `ecran-vocal-lot3.test.js` | `:396-397` | `vocalSetListening` appelle `vocalClearLevel()` | `vocalClearHeard()` (même rôle : plus aucune valeur posée quand le micro s'arrête) |
| `ecran-vocal-lot3.test.js` | `:596-599` | `vocalSetLevel` pose `--vocal-level` | pose `--vocal-heard` |
| `ecran-vocal-lot3.test.js` | `:604-613` | `planLevel` → `ecrire` / `largeur` / `levelToWidth` | `planLevel` → `ecrire` / `halo` / `levelToHalo` |
| `ecran-vocal-lot3.test.js` | `:621-625` | 45 % figé en écoute (mouvement réduit) | **0,55** figé sur `.vocal-halo` |
| `vocal-mesure-en-premier.test.js` | `:282-288` | intitulé et commentaire « le trait continue d'animation » | intitulé et commentaire « le halo continue de suivre la voix » ; **les assertions restent vraies** (elles portent sur `smoothLevel` et sur l'absence de couplage avec la dictée) |

**Aucun autre verrou** : `vocal-level` n'apparaît nulle part ailleurs
(vérifié sur `src/`, `web/`), et `vocal-halo`, `vocal-think-pulse`,
`vocal-speak-envelope` ne sont cités que dans `style.css`.

### 9.4 La prose utilisateur à corriger (mêmes mots, même sens)

| Fichier | Ligne | Aujourd'hui | Devient |
|---|---|---|---|
| `spec_modes_ecran_vocal.md` | `:24` | « un objet lumineux, un **trait de niveau** » | « un objet lumineux **qui se remplit quand vous parlez** » |
| `spec_modes_ecran_vocal.md` | `:112-115` | disque, puis « 24 px plus bas un trait de niveau de 200 × 3 px » | disque, puis « 24 px plus bas l'unique ligne d'état » |
| `spec_modes_ecran_vocal.md` | `:140` | écoute : « **le trait suit la voix** » | écoute : « **le halo s'étend avec votre voix** » |
| `spec_modes_ecran_vocal.md` | `:142` | parole : « halo de 1,6 s + enveloppe du trait » | parole : « enveloppe de 1,6 s ; **jamais** le halo d'écoute » |
| `spec_modes_ecran_vocal.md` | `:161-163` | « la longueur du trait vient du niveau » | « **le rayon du halo** vient du niveau ; sans mesure, **aucun halo** » |
| `spec_modes_ecran_vocal.md` | `:164-167` | « en parole, le trait ne mesure rien » | « en parole, **l'afficheur de votre voix est éteint** » |
| `spec_modes_ecran_vocal.md` | `:170-171` | « le trait est figé à 8/45/20/70 % » | « le halo est **figé** à 55 % de son rayon en écoute, **éteint** ailleurs » |
| `spec_modes_ecran_vocal.md` | `:217-219` | « projeté sur la longueur du trait » | « projeté sur **le rayon du halo** » |
| `README.md` | `:120-121` | « un **trait de niveau** juste dessous » | « l'objet **se remplit de lumière** quand vous parlez » |
| `README.md` | `:145-146` | « Le **trait de niveau suit votre voix** : il s'allonge… » | « **Le halo suit votre voix** : il s'étend du centre vers le bord et retombe au silence » |
| `help/overview.md` | `:444`, `:451-452` | idem | idem (puis `npm run build:handbook`) |

---

## 10. Ce que la révision ne touche pas (contrôle des contraintes actées)

| Contrainte | Tenue comment |
|---|---|
| **Écran nu** | le halo est un `<span>` **dans** le disque ; le contour ajoute un `<svg>` **dans** le disque. Rien d'autre. La liste de `ecran-vocal-nu.test.js:57-73` s'allonge de deux noms, aucun conteneur n'apparaît. |
| **Quatre états, aucune phrase changée** | §8 : teintes et mots existants, aucun texte ajouté. |
| **Aucun réglage, aucun bouton** | rien à régler : le halo suit le micro réel, le contour suit le son réel. `--vocal-heard` est de la plomberie, pas un réglage. |
| **Mouvement réduit** | même drapeau (`vocalReducedMotion`). En mouvement réduit : **aucun contour**, enveloppe et arc éteints (déjà le cas, `:11804-11807`), **halo figé** 0,55 en écoute et éteint ailleurs, aucune transition. « La couleur et le mot portent l'état » reste la règle. |
| **Rien qui tourne quand rien ne parle** | le halo n'a **aucune boucle** : il est repeint par le niveau, qui n'existe que micro ouvert ; le contour démarre et meurt avec le morceau. |
| **Boucle d'animation au bon endroit** | dans `local-voice.js`, à côté de l'élément qui joue ; l'écran ne demande **aucune** image. |
| **Une seule capture micro** | §2.3 : un seul `getUserMedia`, aucune ligne ajoutée dans `vocal-mic.js`. |
| **Une couleur par voix** | §7.2 : trois épingles, **sans effet visuel** (l'état valait déjà la voix) — halo sur `--vocal-listen`, contour et enveloppe sur `--vocal-speak`, anneau sur `--vocal-state`. Aucun jeton créé, aucune valeur en dur, aucune cinquième couleur à régler. |
| **Jamais de symétrie miroir** | §5.2 : 32 bandes distinctes, un seul sens. |
| **Jamais deux afficheurs pour une voix** | le trait est retiré dans le même lot que le halo (§11) ; la voix de l'utilisateur n'a qu'un seul afficheur. Pour la voix de Pilot, l'enveloppe **s'éteint dès que le contour vit** (§7.3 : une classe, une règle) — l'enveloppe n'est plus qu'un repli. |
| **Contraste** | l'information passe par l'anneau (**4,87:1 clair / 10,84:1 sombre** en écoute) et par le mot (`--text-primary`) ; les marques **opaques** des deux voix tiennent 3:1 dans **les dix palettes** (pire cas 3,88:1, §7.2) ; le halo est **translucide et redondant** par construction : son centre mesure 3,72:1 en sombre et 2,13:1 en clair — suffisant pour une lumière, insuffisant pour un repère, et c'est assumé, chiffré, réglable au lot D (67 % en clair, §7.2). |
| **Thèmes clair et sombre** | §7.2 : chaque afficheur de voix nomme **son** jeton, l'anneau garde `var(--vocal-state)` ; aucun jeton nouveau, aucune couleur en dur ; les dix palettes sont mesurées (contrastes, teintes, ΔE). |
| **Trois plateformes** | ni Web Audio, ni périphérique ouvert : SVG + `color-mix` + `radial-gradient` (Chromium/WebKit depuis 2023). Identique sur Windows, macOS, Linux. |
| **Aucune régression ailleurs** | sans auditeur inscrit, `playLocalChunks` se comporte **exactement** comme avant ; hors mode Vocal, ni halo ni contour ne sont dessinés. |

---

## 11. Fichiers touchés par les lots, et contrat des modules purs

| Fichier | Nature du changement |
|---|---|
| `src/js/vocal-mic.js` | `levelToWidth` → `levelToHalo` ; `planLevel` → `{ ecrire, halo }` ; prose « trait » → « halo ». **Aucune ligne de capture touchée.** |
| `src/js/vocal-equalizer.js` | **nouveau**, pur : aucune API navigateur, aucun import Tauri |
| `src/js/local-voice.js` | `playUrl` (`:767`) reçoit un 4ᵉ paramètre **optionnel** ; `playLocalChunks` (`:812`) construit la boucle `rAF` depuis l'option `onSpectrum`. **Comportement inchangé** sans l'option |
| `src/js/read-aloud.js` | une case d'abonnement (`setReadAloudSpectrumListener`) et son passage à `playLocalChunks` (`:838`) |
| `src/js/super-agent.js` | le `<span class="vocal-halo">` dans le disque (`:4212`) ; `vocalSetLevel` → `--vocal-heard` ; `vocalClearHeard` ; le `<svg>`/`<path>` et `vocalSetSpectrum`, qui pose et retire la classe **`.vocal-spectrum-live`** (repli de l'enveloppe, §7.3) ; abonnement en `enterVocal` (`:4708`), nettoyage en `exitVocal` (`:4797`) |
| `src/css/style.css` | `.vocal-halo` + les deux gardes d'état + le gel du mouvement réduit ; **retrait** de `.vocal-level*`, des deux animations décoratives et des quatre largeurs figées ; renommage du `@keyframes vocal-halo` → `vocal-speak-glow` ; **les trois épingles de teinte** (§7.2 : halo → `--vocal-listen`, enveloppe → `--vocal-speak`, contour → `--vocal-speak`) ; la règle du **repli** `.pilot-vocal.vocal-spectrum-live.vocal-state-speaking .vocal-orb::before` (§7.3) ; `.vocal-spectrum-path` (contour) |
| `src/js/ecran-vocal-nu.test.js`, `ecran-vocal-lot2.test.js`, `ecran-vocal-lot3.test.js`, `vocal-mesure-en-premier.test.js` | les 14 emplacements du §9.3, **dans le même commit que le lot B** |
| `spec_modes_ecran_vocal.md`, `README.md`, `help/overview.md` + `npm run build:handbook` | §9.4 |
| `AGENTS.md` | arborescence : `vocal-equalizer.js` |

**Contrat des modules purs** — testable sous Node, sans navigateur.

`src/js/vocal-mic.js` (modifié) :

```js
export function levelToHalo(niveau)   // 0..1 ; √(niveau) ; NaN → 0
export function planLevel({ niveau, reduit })
  // → { ecrire: true,  halo: levelToHalo(niveau) }
  // → { ecrire: false, halo: 0 }   si reduit === true   (rien n'est posé)
```

`src/js/vocal-equalizer.js` (nouveau) :

```js
export const SPECTRUM_ZONES = 32;
export const SPECTRUM_LOW_HZ = 200;
export const SPECTRUM_HIGH_HZ = 8000;    // bornée par min(8000, 0.45 × sampleRate)
export const SPECTRUM_FPS = 30;
export const SPECTRUM_FFT = 512;
export const SPECTRUM_FLOOR_DB = -80;    // à mesurer au lot D
export const SPECTRUM_CEIL_DB = -30;     // idem
export const SPECTRUM_SILENCE = 0.03;
export const SPECTRUM_RADIUS = 83;
export const SPECTRUM_AMPLITUDE = 16;

wavFromBase64(base64, { atob })              -> { sampleRate, samples } | null
spectrumTimelineFromDataUrl(url, { atob })   -> { fps, count, bands, sampleRate, highHz, bandBins } | null
spectrumFrameInto(timeline, index, cible)    -> cible        // zéro allocation
spectrumSmooth(etat, valeurs)                -> etat         // montée 0,5 / descente 0,12
spectrumZoneAngle(k)                         -> radians      // ordre vérifiable
spectrumPath(valeurs)                        -> "M…C…Z" | "" // "" = silence
spectrumPlan({ enParole, reduit, valeurs })  -> { dessiner, chemin }
```

`spectrumPlan` est la **seule** décision d'affichage du contour, et elle est pure :

```
enParole && !reduit && chemin !== ""  →  { dessiner: true,  chemin }
sinon                                 →  { dessiner: false, chemin: "" }
```

Le halo, lui, n'a **aucune** décision en JavaScript : sa seule décision est une
règle CSS de deux lignes (§6.5). C'est une garantie de plus qu'il ne peut pas
« mentir par programme ».

### Les lots (chacun livrable seul)

| Lot | Ce qui est livré | Visible ? | Précondition | Tests |
|---|---|---|---|---|
| **A** | **Les maths, invisibles** : `vocal-equalizer.js` + son test (WAV de synthèse écrit à la main : en-tête RIFF, 16 bits, 22 050 Hz), 32 bandes, 32 angles, chemin fermé, `spectrumPlan`, `spectrumPath("")` au silence ; `levelToHalo` + `planLevel` étendus | non | **aucune** | `npx vitest run src/js/vocal-equalizer.test.js src/js/ecran-vocal-lot3.test.js` |
| **B** | **LE HALO REMPLACE LE TRAIT — un seul commit, jamais deux.** Ajout de `<span class="vocal-halo">` + `.vocal-halo` (teinté `--vocal-listen`, §7.2) + les deux gardes d'état + le gel du mouvement réduit ; **retrait** de tout le §9.2 ; `vocalSetLevel` → `--vocal-heard` ; `vocalClearHeard` ; **trois lignes sans effet visuel** : renommage `@keyframes vocal-halo` → `vocal-speak-glow`, commentaire « Halo de la PAROLE » → « Enveloppe de parole » (§6.0), et l'enveloppe épinglée `--vocal-speak` (`:11644`, no-op : l'état parole vaut déjà ce jeton) ; les 14 emplacements de tests du §9.3 ; spec + aide + README | **oui**. Le halo apparaît dès que le micro mesure une voix — **et rien d'autre ne change d'un pixel** | **aucune** (le micro existe déjà) | les 4 fichiers du §9.3 + `ecran-vocal-nu.test.js` + `vocal-mesure-en-premier.test.js` |
| **C** | **Le contour suit la voix de Pilot quand elle est analysable** : `onSpectrum` dans `local-voice.js`, abonnement dans `read-aloud.js`, `<svg>`/`<path>` et peinture dans `super-agent.js` (teinté `--vocal-speak`, §7.2), **classe `.vocal-spectrum-live` + règle de repli** (enveloppe éteinte quand le contour vit, §7.3), spec | **oui**, avec la voix locale installée — **et si elle ne l'est pas : le cercle reste net, exactement comme aujourd'hui** (comportement attendu, pas une panne) | voix locale installée (Paramètres → Assistant → Lecture des réponses) | `ecran-vocal-nu`, `lot2`, `lot3`, `lot4a`, `trois-modes` + un test neuf sur la peinture |
| **D** | **La preuve** : mesure de `FLOOR`/`CEIL` sur les quatre voix livrées (au taux réel lu dans chaque WAV), réglage à l'œil des deux opacités (42 % / 22 %) sur les **deux thèmes**, contrôle du mouvement réduit, de la fenêtre 800 × 500, du coût réel par morceau, de l'absence de travail hors mode ; `build:handbook` | non (vérification) | voix locale installée pour la mesure | suite complète + `cargo test` inchangé |

**Pourquoi cet ordre, et pourquoi A et B sont séparés.** A ne change **rien** à
l'écran : c'est de la mesure et des fonctions pures, vérifiables sans micro ni
voix. B est le lot qui **remplace** — il touche l'écran et des verrous, donc il
se livre seul et se vérifie seul. **B ne peut pas être coupé en deux** : retirer
le trait d'abord laisserait l'écran sans aucun signal de la voix de
l'utilisateur (interdit), et ajouter le halo d'abord laisserait deux afficheurs
pour la même voix (interdit). C arrive après, et C ne dépend pas de B : le
contour et le halo se vérifient séparément.

**La décision 5 ne crée aucun lot et n'en scinde aucun.** Les trois épingles de
teinte ne changent pas un pixel : chacune voyage donc avec **le lot qui crée son
afficheur** — B pour le halo et l'enveloppe, C pour le contour. Si un lot partait
seul sans son épinglage, l'écran serait **identique** ; mais le document ne
saurait plus dire « qui parle » en le lisant, et c'est précisément ce que la
décision 5 achète. La seule addition de code est la **règle de repli** de
l'enveloppe (§7.3), qui vit au lot **C** : elle n'a d'effet (et n'est vérifiable)
que lorsque le contour existe.

---

## 12. Ce que je ne peux pas trancher seul (une question, fermée)

La décision 2 laisse **une** conséquence ouverte, que la décision 4 ne change
pas — au contraire : la voix de Pilot n'a plus qu'**un** afficheur possible
(le contour), et il reste immobile sur une installation neuve.

> **Question.** Sur une installation neuve, la voix réglée par défaut est celle
> du **système** ; le contour ne bougera donc **jamais** tant que la voix locale
> n'est pas installée (le halo, lui, fonctionne dès le premier jour — il ne
> dépend que du micro). Acceptez-vous que **le cercle ne bouge jamais** tant que
> la voix locale n'est pas installée — l'enveloppe et le mot « Je réponds. »
> portant alors seuls la parole —, ou voulez-vous qu'une **invitation unique** à
> installer la voix locale apparaisse au premier passage dans l'écran Vocal (une
> ligne dans Options, jamais une fenêtre, aucun nouveau réglage) ?
>
> **A (recommandée)** : cercle immobile, rien d'autre à faire. Honnête, zéro
> travail en plus, et l'écran dit déjà « Pilot parle ».
> **B** : cercle immobile **et** l'invitation unique (un lot de plus).

---

## Verdict

**Prêt à appliquer tel quel.**

1. **Le trait disparaît, entièrement** (§9.2) : le nœud, les deux règles, les
   deux animations décoratives, les quatre largeurs figées, `levelToWidth` et
   ses deux constantes. La liste des 14 emplacements de tests qui le verrouillent
   est donnée avec ce qu'ils deviennent (§9.3) : rien n'est laissé à deviner.
2. **Le halo est décrit au chiffre près** (§6) : il est un enfant du disque
   (`inset: 0`, donc 164 × 164 px et **82 px de rayon**), un dégradé à trois
   arrêts (42 % au centre, 22 % à 62 %, 0 % au bord), et son rayon vaut
   `sqrt(niveau) × 82 px` — de **0 px** au silence à **82 px** au maximum, avec
   les huit valeurs intermédiaires tabulées (§6.3). Le niveau est **le même**
   chiffre qu'avant, aucun capteur n'est ajouté.
3. **Il ne déborde jamais** (§6.1) : trois preuves indépendantes — la boîte
   (`inset: 0` dans le *padding box*), le découpage (`border-radius: 50 %`), le
   dégradé (`closest-side`, arrêt au plus à 100 %). Il s'arrête **sur** le bord
   intérieur de l'anneau (82 px) ; le contour commence à 83 px. **Les deux au
   maximum en même temps** : halo plein jusqu'à 82 px, contour à 99 px — les deux
   sont séparés par l'anneau de 2 px, qui reste le seul élément continu de
   l'écran. Aucun recouvrement, donc aucune ambiguïté.
4. **Une couleur par voix, sans aucun jeton nouveau** (§7.2) : le **halo
d'écoute** lit `--vocal-listen` (`#4ade80` / `#1f7a4d`, `style.css:386`, `:489`),
   le **contour** et l'**enveloppe** lisent `--vocal-speak` (`#fbbf24` /
   `#b45309`, `:388`, `:491`), l'**anneau** garde `var(--vocal-state)`. Trois
   lignes, **aucun pixel changé** — l'état valait déjà la voix — et une garantie
   **écrite** à la place d'un accord accidentel. Mesuré sur les **dix palettes du
   projet** : les deux teintes restent distinctes (écart de teinte 35,4° à 98,8°,
   ΔE 26,7 à 82,1) et lisibles (**3,88:1 au pire**, seuil 3:1 tenu partout) ; le
   halo translucide, lui, ne tient pas 3:1 en clair (2,13:1) — c'est **dit**, avec
   la valeur d'ajustement (67 %) prête au lot D.
5. **Une seule voix par afficheur, et l'enveloppe devient le repli** (§7.3) : le
   contour porte la voix de Pilot ; l'enveloppe de parole s'éteint **dès que le
   contour est peint** (une classe, une règle à quatre classes qui gagne par
   spécificité, `animation: none`, `transition: none`) et ne sert plus que
   lorsque le contour ne peut pas être dessiné. Le mot `vocal-halo` ne désigne
   plus deux choses (§6.0).
6. **Deux voix, zéro mensonge** (§7.1, §6.5) : le halo n'existe **qu'en état
   écoute** — pendant que Pilot parle, une règle CSS le met à zéro, même si le
   micro entend l'écho ; et le contour est retiré par `spectrumPlan` dès que
   l'état n'est pas « parole ».
7. **Les contraintes actées tiennent toutes** (§10), y compris le mouvement
   réduit, désormais porté par un halo **figé à 0,55** (rayon 45,1 px) plutôt
   que par quatre largeurs de trait.
8. **Les lots sont redécoupés** (§11) : **A** les maths invisibles, **B** le
   remplacement du trait par le halo — **un seul commit, non sécable**, parce que
   couper laisserait soit un écran sans aucun signal de la voix de l'utilisateur,
   soit deux afficheurs pour la même voix —, **C** le contour (et la règle de
   repli de l'enveloppe), **D** la preuve. La décision 5 n'ajoute **aucun** lot.

**Reste à décider :** la question unique du §12 (A ou B), inchangée depuis la
révision 2. Aucune invitation à installer la voix locale n'est ajoutée par cette
révision (§7.3) : elle dit seulement ce qui s'affiche dans chaque cas.

**Signalé, non corrigé (hors de ce livrable) :** les trois textes du §9.4 qui
décrivent encore le trait et le « halo de la parole » (`spec_modes_ecran_vocal.md`,
`README.md`, `help/overview.md`) — correction prévue aux lots B et C ; et
`style.css:482-487`, dont le commentaire annonce quatre contrastes mesurés sur
deux fonds différents (5,47 est mesuré sur `#f4f5f7`, les trois autres sur
`#fafafa`). Aucun jeton de thème n'est touché par cette révision.

**Ce que je n'ai pas pu vérifier :** le taux d'échantillonnage réel des quatre
voix livrées (il faut lire les WAV : c'est le lot A/D), les valeurs
`SPECTRUM_FLOOR_DB` / `SPECTRUM_CEIL_DB` (mesure sur les voix : lot D), le rendu
**à l'œil** des deux opacités du halo (42 % / 22 %) sur les deux thèmes — les
contrastes, eux, sont mesurés (§7.2) ; il reste à confirmer visuellement que
3,72:1 (sombre) et 2,13:1 (clair) suffisent, la valeur d'ajustement (67 % en
clair) étant prête au lot D —, et le coût réel de l'analyse par morceau. Aucun
test ni build n'a été lancé pour écrire ce document, et **aucun fichier de code
n'a été modifié**.
