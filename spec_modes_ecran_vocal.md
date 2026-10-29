# Pilot — Les trois modes d'écran et l'écran Vocal (spec)

> **Statut : ✅ livré** — lot 1 (`e3f147b`), lot 2 (`944bd0c`), lot 3 (`70fe93e`),
> lot 4a (`174cc45`), lot 4b (couper la réflexion, voir ce fichier §6),
> **conversation parlée** (§6bis : parler déclenche une demande, sans bouton).
>
> Ce document décrit **ce que Pilot fait réellement**, relu dans le code livré.
> Les raisons de conception (mesures de contraste, choix de placement, découpage
> en lots) restent dans `docs/rapports/RAPPORT-trois-modes-ecran-vocal.md`.
> La lecture à voix haute et la coupure de la parole sont détaillées dans
> `spec_read_aloud.md` § 1 ; ici, on décrit **l'écran** et ce qu'il promet.

---

## 1. Trois modes, un seul bouton

Un **seul** bouton fait le tour : **Détaillé** → **Assistant seul** → **Vocal** →
**Détaillé**…

| Mode | Ce que l'on voit | À quoi il sert |
|---|---|---|
| **Détaillé** | l'écran habituel : colonne de gauche (280 px), rangée d'onglets, éditeur, chat | travailler sur les fichiers |
| **Assistant seul** | uniquement la conversation de l'assistant 🧭, en plein écran | suivre et piloter les projets sans le bruit de l'éditeur |
| **Vocal** | un objet lumineux, **une** ligne de texte, la zone de saisie en bas | parler à Pilot et l'écouter |

Un mode d'écran **ne change rien au projet** : ni fichier, ni onglet, ni agent. Il
choisit seulement **ce qui est affiché**. Dans les deux modes plein écran, la
colonne de gauche et la rangée d'onglets sont **recouvertes** (pas masquées, pas
remplacées) ; les trois boutons de fenêtre restent peints **au-dessus**
(`#window-controls`, `z-index 100001`), donc Pilot reste réductible, agrandissable
et fermable.

## 2. Le bouton, et la mémoire du mode

- **Où il vit** : en **haut à gauche**, c'est le **logo Pilot** (`#mode-logo`,
  autour de l'image `#btn-project-logo`, dans le bandeau du nom de projet). Il
  n'y a **aucun** bouton de mode dans la rangée d'onglets, et aucune place n'y est
  réservée.
- **Un seul nœud dans tout le document** : en mode « Assistant seul » puis en mode
  « Vocal », le **même** logo entre dans l'overlay et y prend **la même place**
  que dans « Détaillé » — une seule règle CSS à deux sélecteurs
  (`body.superagent-immersive-active #mode-logo` et
  `body.pilot-vocal-active #mode-logo`, 13 px / 8 px) —, puis il est **restitué
  exactement** à sa place (parent + voisin suivant) à la sortie. Ce ne sont pas
  des copies : il en existe un seul, et aucun second bouton n'a été ajouté
  ailleurs.
- **Ce qu'il dit** : **rien de visible** — ni mot, ni icône, ni **pastille** : le
  logo reste le logo. Seule l'**infobulle** (`title` **et** `aria-label`) parle :
  elle nomme le mode **courant** puis annonce le **suivant** (« Mode d'écran :
  Vocal. Passer à « Détaillé ». »). Le mode où l'on est se lit donc à l'écran,
  qui change du tout au tout.
- **Ce qu'il fait** : un clic fait avancer d'**un** mode dans le cycle. Une
  **garde de 400 ms** (`MODE_CLICK_GUARD_MS`) ignore un second clic trop
  rapproché : le double-clic réflexe qui agrandissait la fenêtre à cet endroit ne
  franchit donc jamais deux modes.
- **Mémoire** : **une seule clé** de stockage local, `pilot_screen_mode`, avec trois
  valeurs `detailed` / `assistant` / `vocal`. Elle est écrite à **chaque** bascule.
- **Migration** : l'ancien réglage **binaire** `pilot_superagent_immersive` (présent
  / absent) est repris **une fois** — clé neuve absente **et** ancienne valeur
  `"1"` ⇒ `assistant`. L'ancienne valeur n'est plus **lue** (elle reste écrite par
  le plein écran de l'assistant, ce qui permet un retour arrière sans perte).
- **Au lancement** : le mode est relu **avant** l'affichage, et un mode plein écran
  fait **ouvrir l'onglet 🧭 Assistant** avant d'être rejoué — sans cela le bouton
  annoncerait un écran qui n'existe pas. Fermer puis rouvrir cet onglet restitue le
  mode mémorisé.
- **Entrer et sortir** : le mode « Assistant seul » n'a **qu'une seule entrée** —
  ce bouton, ou le raccourci **Ctrl+Shift+A** (`Cmd+Shift+A` sur macOS, onglet 🧭
  ouvert). Il n'y a **plus** de bouton ⛶ dans la barre d'outils de l'onglet 🧭, et
  la barre du plein écran n'a **plus** de flèche « retour ». On en sort par le
  **même bouton** (le logo : son infobulle annonce le mode suivant),
  par **Ctrl+Shift+A**, ou en fermant l'onglet 🧭. **Échap** ne sort **pas** du
  mode « Assistant seul » (elle n'en est jamais sortie ; rien n'a été ajouté) :
  elle ne sert qu'à quitter l'écran **Vocal**, et à fermer une modale ouverte.
- **Aucun écran de réglage** n'a été créé pour cela : le choix du mode est un geste
  d'écran, pas une préférence à configurer.

## 3. L'écran Vocal, de haut en bas — un écran nu

Plein écran `.pilot-vocal` (`position: fixed; inset: 0; z-index: 99990`), de la
même famille que celui de l'assistant seul, avec un **fondu de 0,3 s** à l'entrée
et à la sortie (pas de zoom : on change d'écran, on ne déplie pas un panneau).
Aucun cadre, aucune carte, aucune bordure.

**Un écran nu** — décision du propriétaire, 2026-10-28, ferme : on n'y voit que
l'objet, la ligne d'état et la barre de saisie. **Aucun
échange de la conversation ne s'y affiche** : ni bulle, ni texte, ni « les deux
ou trois derniers échanges » en petit sous l'objet, ni par un réglage. La
conversation n'est pas perdue pour autant : elle reste **entière dans l'onglet de
l'agent**, où on la retrouve en quittant le mode.

Comme la réponse ne se lit plus à l'écran, c'est la **lecture à voix haute** qui
la porte (détail : `spec_read_aloud.md` § 1). Elle ne dépend de rien de ce qui
est affiché : elle actionne le bouton « 🔊 Écouter » de la **dernière réponse**,
posé par `read-aloud.js` dans la conversation de l'onglet — même nettoyage du
texte, même découpage, mêmes voix, une seule lecture à la fois. Aucun second
lecteur n'existe pour cet écran, donc rien ne devient muet quand l'écran est nu.

Comment la règle est tenue (trois verrous, aucun réglage) : l'overlay est
**opaque** (`background: var(--bg-app)`) ; la zone des messages de la
conversation est rendue **invisible tant que l'écran Vocal est actif**
(`body.pilot-vocal-active .agent-chat-messages { visibility: hidden }` —
`visibility` et jamais `display: none`, pour ne pas perdre la position de
défilement à la sortie) ; **aucun conteneur de conversation n'est déplacé** dans
l'écran (seuls la barre de saisie et le logo, qui est le bouton des modes, le
sont). Le retour de la conversation sur cet écran est interdit par un test dédié
(`src/js/ecran-vocal-nu.test.js`).

1. **Barre de 44 px**, juste **sous** la bande des trois boutons de fenêtre
   (`margin-top: var(--window-controls-height)`) : elle ne porte **rien** — c'est
   une bande de respiration. Le logo, qui est le bouton des trois modes, se pose
   **au-dessus** d'elle, à la même place que dans les autres modes.
2. **Au centre**, le **disque de 168 px** (anneau plein de 2 px + remplissage
   lumineux de 18 % au centre, 0 % aux bords : aucune image), qui contient un
   **halo intérieur** (`.vocal-halo`, la voix de l'utilisateur, §4). Le bloc suit
   la fenêtre sans calcul, et il ne contient **rien d'autre** (seul le bouton de
   dépannage du micro peut s'y ajouter, masqué par défaut).
3. **Juste au-dessus de la barre de saisie**, l'**unique ligne d'état**
   (`.vocal-status`) : elle n'est plus sous le cercle (28/10). C'est le **même**
   texte, le **même** style, la **même** logique d'état ; seul l'emplacement
   change. Elle est un **enfant direct** de l'écran (entre le bloc du disque et la
   saisie), donc elle ne participe plus au centrage du disque, ne réserve aucune
   place sous lui et ne peut ni pousser la mise en page ni faire défiler l'écran.
   Elle se peint **après** l'enveloppe de parole et n'a **aucun fond** : elle ne
   recouvre ni la lueur ni la saisie, et rien ne la recouvre.
4. **La zone de saisie**, en bas, **toujours visible** et discrète : c'est la barre
   de saisie de l'onglet Assistant, **déplacée** (même nœud, même envoi, même
   dictée 🎙️), 720 px au plus, centrée, 16 px de marge basse, sans filet ni fond
   pleine largeur, plafonnée à **120 px** de haut (au lieu de 200 px dans l'onglet).
   Son texte d'invite y devient **« Écrivez, ou parlez. »** et il est restitué tel
   quel à la sortie.
5. **Un bouton de dépannage, caché par défaut** : « Autoriser le micro »
   (`.vocal-mic-fix`), qui n'apparaît que si le micro est fermé.

**Rien de la conversation n'est affiché** sur cet écran : ni les messages, ni les
outils, ni l'état des agents, ni un résumé des derniers échanges. C'est le
principe même du mode, et il ne dépend d'aucun réglage.

## 4. Les quatre états visuels

**Une seule** classe d'état à la fois sur l'overlay : deux états simultanés sont
impossibles par construction. Priorité : **parole** > **réflexion** > **écoute** >
**repos**. Cette priorité n'est pas qu'un choix de couleur : elle décide aussi de
**ce que la voix interrompt** (§6), par une seule fonction pure
(`vocalInterruptTarget`).

| État | Quand | Teinte (jeton `--vocal-*`) | Mouvement | Ligne d'état |
|---|---|---|---|---|
| **Repos** | personne ne parle, l'agent ne réfléchit pas, rien n'est lu | accent du thème (`--vocal-rest`) | respiration lente de 4 s | « Je vous écoute. » |
| **Écoute** | le micro **capte vraiment** : le niveau mesuré dépasse le seuil **haut** (0,06 RMS) | vert (`--vocal-listen`) | aucun mouvement propre : **le halo intérieur suit la voix** | « Je vous écoute… » |
| **Réflexion** | l'agent réfléchit | violet de l'assistant (`--vocal-think`) | arc de 60° qui tourne en 3 s | « Je réfléchis… » |
| **Parole** | Pilot lit la réponse | ambre (`--vocal-speak`) | lueur extérieure **au bord** du disque (pic à **34 %** d'alpha sur la couronne) qui **suit la voix de Pilot** : le son mesuré quand il l'est, le rythme de la phrase lue sinon (§4) | « Je réponds. » |

**Deux lueurs, deux voix — et deux mots différents.** L'écran n'a qu'un seul
niveau à montrer par voix, et chaque voix a **sa** couleur :

| Ce qu'on voit | Où | Quelle voix | Teinte |
|---|---|---|---|
| le **halo intérieur** (`.vocal-halo`) | dans le disque, jusqu'à 82 px de rayon | **la vôtre** (mesurée) | `--vocal-listen` |
| l'**enveloppe de parole** (`.vocal-orb::before`) | la **couronne extérieure** (84 → **128 px** de rayon, soit **44 px** de débord) | **celle de Pilot** (lue) | `--vocal-speak` |
| le **contour** du disque | l'anneau | **celle de Pilot** (lue) | `--vocal-state` |

Le mot « halo » ne désigne **que** le halo intérieur, celui de votre voix ;
l'enveloppe de Pilot s'appelle « l'enveloppe de parole » (ancien nom de
l'animation : `vocal-speak-glow`). Les deux ne se confondent jamais à l'écran :
le halo ne sort pas du disque, l'enveloppe ne rentre pas dedans.

- **Comment l'écoute est réellement détectée** : ouvrir le micro ne suffit **pas**.
  Le moteur micro ne signale que l'**ouverture** et l'**arrêt** du flux ; il livre
  à part le **niveau mesuré**. L'état « écoute » exige donc **deux** choses : le
  micro ouvert **et** une voix réellement présente. La décision est **pure**
  (`vocalCapte`, `vocalVoiceStep` dans `super-agent.js`) et tient sur **deux
  seuils** — une **hystérésis** : on **entre** en écoute au-dessus de **0,06**
  (RMS du niveau lissé), on **revient au repos** seulement sous **0,03**. Entre
  les deux, rien ne change : un seuil unique, avec la retombée lente du lissage,
  ferait clignoter l'écran autour de la valeur. Conséquences directes : micro
  ouvert dans le silence = **repos** (accent du thème, « Je vous écoute. »,
  respiration) ; une voix = **écoute** (vert, « Je vous écoute… ») ; la voix
  s'arrête, le lissage retombe, le **repos revient** (~0,3 s). Le niveau ne peut
  **jamais** allumer l'état micro fermé (refus, panne, sortie du mode : la
  détection repart du silence).
- **Le texte ne porte jamais la couleur** de l'état (toujours `--text-primary`) :
  la couleur vit dans l'objet. C'est ce qui rend l'écran lisible dans les dix
  palettes du projet.
- **En « écoute », aucun niveau n'est inventé** : le remplissage du halo intérieur
  vient du niveau **réellement mesuré**. Sans mesure (micro fermé, refusé, en
  panne), il retombe au silence (rayon 0), il ne simule rien. **Le trait de niveau
  de 200 × 3 px, lui, a été RETIRÉ le 12/11** : la décision du 28/10 (« la petite
  barre reste ») est renversée par le propriétaire. La mesure, elle, reste
  entière — elle allume l'état « écoute » et remplit le halo intérieur. Rien
  d'autre n'a bougé dans `vocal-mic.js` (aucune ligne touchée).
- **Le halo intérieur** (lot B, `CONCEPTION-cercle-equaliseur.md` §6) remplit le
  **disque** de la même mesure : son rayon vaut **racine(niveau) × 82 px**, donc
  **0 au silence** — aucun rond résiduel. Il n'existe **qu'en écoute** : deux
  gardes tombent ensemble (opacité et valeur 0), si bien que l'écho que le micro
  entend parfois de Pilot **n'est jamais dessiné**. Sa couleur est **toujours**
  `--vocal-listen`, jamais l'état : une couleur par voix, les deux ne se
  confondent pas. C'est désormais le **seul** afficheur de votre voix.
- **L'enveloppe de parole suit la VOIX de Pilot, l'aigu en tête** (12/11,
  `src/js/vocal-enveloppe-aigu.js`) : un **analyseur** est monté sur l'élément
  audio que Pilot joue lui-même, et c'est l'énergie de la **bande haute**
  (au-dessus de **4 kHz**, jusqu'au plafond d'analyse du projet) qui décide de
  l'extension et de l'intensité. Le choix est **pur et testé** : bande → énergie
  0..1 (silence → **0**, aigu riche → **proche de 1**, son grave → **0**), puis
  lissage du projet (montée **0,5**, retombée **0,12**), puis projection :
  **18 px** au repos → **44 px** à pleine voix, opacité **0,80 → 1**. L'extension
  ne peut donc **pas** dépasser 44 px, et le silence **ramène au repos** au lieu
  de faire pulser une lumière toute seule.
- **Deux sources, jamais les deux à la fois** : la décision est **pure et
  testée** (`planSpeechEnvelopeSource`) et son ordre **est** la règle. En
  **mouvement réduit** ou quand le **contour spectral** peint déjà cette voix,
  **personne n'écrit** ; sinon la **mesure du son** l'emporte quand elle existe ;
  sinon le **rythme de la phrase lue** prend la place.
  - **Voix locale (Piper)** : Pilot joue lui-même le son, donc la mesure est
    **réelle** — un seul `AnalyserNode` sur son élément audio.
  - **Voix du système (`speechSynthesis`), qui reste la voix par DÉFAUT** : le
    navigateur ne livre **aucun flux audio** à la page et aucune API ne le
    permet. Le code **ne fait pas semblant** de mesurer. Ce que Pilot connaît,
    lui, c'est le **texte qu'il lit** : il est découpé en **unités de rythme**
    (mots → syllabes, la **dernière accentuée**), la **ponctuation** ouvre des
    **pauses** (courte **220 ms** pour `,` `;` `:` et le tiret ; longue
    **420 ms** pour `.` `!` `?` `…` ; paragraphe **560 ms**), et une **position
    de lecture** avance avec le **temps de parole effectif** (début et fin de
    lecture réels). Position → intensité **0..1** : une **pause** vaut **0**
    (l'enveloppe est au repos pendant qu'on reprend souffle), une syllabe
    **accentuée** vaut **1**, une syllabe ordinaire **0,55** au sommet, avec un
    plancher de **0,2** à l'intérieur d'une syllabe ; puis le **même lissage**
    que le son (montée **0,5** / retombée **0,12**). **Aucun aléatoire** : le
    même texte donne toujours le même mouvement, et **deux phrases de longueurs
    différentes ne bougent pas pareil**.
- **En « parole », rien n'est inventé** : la mesure vient du **son** quand il est
  mesurable, du **texte et du temps de lecture** sinon — jamais d'une pulsation
  aveugle. L'animation `vocal-speak-glow` (1,6 s) ne reste que le **repli** du
  cas où **aucune** des deux sources n'est disponible : dès que l'une écrit
  (classe `.vocal-envelope-live`), elle est éteinte. L'écoute, elle, mesure
  toujours **votre** voix.
- **La lueur de parole est visible au bord, pas cachée au centre**
  (`docs/rapports/RAPPORT-halo-parole.md`, puis
  `docs/rapports/RAPPORT-halo-suivant-le-son.md`). L'enveloppe de parole
  (`.vocal-orb::before`, boîte de **256 × 256 px**, `inset: -44px`) porte un
  dégradé **inversé** : transparent au centre, puis **8 %** au-delà du bord du
  disque (81 % du rayon), **20 %** à 90 % et **34 %** au bord de la boîte (100 %). Le
  pic est donc **sur la couronne extérieure**, la seule partie qui **déborde** du
  disque opaque ; la lumière ne se perd plus sous le disque. Mesuré : contraste
  **2,28 : 1** en thème sombre et **1,60 : 1** en thème clair (avant : 1,044 : 1
  et 1,041 : 1, sous le seuil de perception). **La couronne mesure 44 px** de
  large (84 → **128 px** de rayon, rayon retenu le 28/10 ; 32 px avant le 12/11) :
  le débordement s'arrête à 128 px, et la boîte (256 px) tient dans la hauteur
  minimale de la fenêtre (500 px), donc elle n'écrase ni la phrase ni la saisie.
  En repli animé, `vocal-speak-glow` respire **autour de 128 px** (0,94 → 1,06),
  et son opacité ne descend plus sous **0,80** : la lueur respire sans jamais
  s'éteindre.
- **L'enveloppe est le REPLI du contour, jamais un doublon**
  (`CONCEPTION-cercle-equaliseur.md` §7.3) : dès que le contour spectral est
  peint (voix locale installée, classe `.vocal-spectrum-live` posée sur
  l'overlay), l'enveloppe est **éteinte** (opacité 0, sans animation ni
  transition) — et le **code** non plus ne la mesure pas (`planSpeechEnvelope`
  refuse alors d'écrire : `contourPeint`). La décision de code est unique
  (`spectrumPlan`, `porteur` côté contour ; `planSpeechEnvelope`, `live` côté
  enveloppe) et verrouillée par test.
- **Mouvement réduit** : le même drapeau que les animations d'ouverture
  (`prefers-reduced-motion` **et** le réglage « Animer l'ouverture des modales »).
  Quand il est actif, plus aucune animation, plus aucune transition, et le
  **halo intérieur** est **figé** à 0,55 en écoute (éteint dans les trois autres
  états) : il reste **lisible**, ce n'est jamais une animation muette. Le code ne
  pose **aucune** valeur dans ce cas (`planLevel` comme `planSpeechEnvelope`
  refusent d'écrire). La **lueur de parole** obéit à la même règle : ni
  clignotement ni disparition — elle est **fixe mais visible**, à sa **taille
  pleine** (les 44 px de la boîte, 128 px de rayon) et **opacité 1**, sans
  animation ni transformation. **Aucun nouveau réglage** n'a été créé pour cet
  écran.

## 5. Le micro : quand il s'ouvre, quand il se ferme

**Deux captures différentes** vivent dans cet écran, et elles ne s'ouvrent pas au
même moment — c'est la distinction qui manquait :

- **L'ORDRE est une décision du propriétaire : la MESURE ouvre EN PREMIER.**
  Le micro de MESURE (l'état « écoute », le halo intérieur, la prise de parole)
  est demandé **à l'entrée dans le mode**, avant tout armement de la dictée —
  jamais au premier geste, jamais dans les autres modes. La dictée vient
  **après** elle, et **seulement si elle est réellement ouverte**.
- **La DICTÉE** (§6bis) n'est donc ouverte qu'**une fois la mesure ouverte**,
  puis pendant **tout le mode**, sauf pendant que Pilot parle et pendant qu'il
  travaille : elle s'arme au repos 350 ms après l'entrée, parce que « parler
  suffit » (aucun bouton à toucher). C'est **son** service de reconnaissance qui
  tient le micro ouvert, mais il ne peut plus passer devant la mesure.
- **Pourquoi cet ordre** : avec la dictée en premier, un pilote audio qui
  refusait la **seconde** capture faisait échouer la **mesure** — le halo se
  figeait et l'écran annonçait une panne de micro alors que la dictée
  fonctionnait (panne fantôme permanente). Mesure d'abord, et chaque panne
  s'affiche pour ce qu'elle est : une panne de mesure, ou une panne de dictée.
  Deux clients sur le même périphérique ne se dégradent plus l'un l'autre
  (l'annulation d'écho de la mesure reste intacte).
- **Si la mesure n'a pas pu s'ouvrir, la dictée ne s'arme pas.** L'écran dit la
  panne du micro avec **la phrase existante** (« Le micro est fermé. »,
  « Le micro est occupé par une autre application. »…) et propose « Autoriser le
  micro ». Une seule phrase, un seul bouton — rien de nouveau.
- **Projet sensible** : tant que la réponse « ce projet est-il marqué 🔒 ? »
  n'est pas arrivée, **aucune dictée cloud ne s'ouvre** (l'écran attend quelques
  millisecondes au lieu de parier sur « projet libre »). La réponse est relue à
  l'entrée du mode **et** à chaque changement de projet
  (`pilot-project-sensitivity`) : la transcription cloud ne s'ouvre jamais sur
  un projet 🔒.
- **Aux trois sorties du mode, les deux captures sont réellement rendues** : les
  pistes sont arrêtées (`stop()`), le contexte audio est fermé, la boucle de
  mesure est annulée et la dictée est fermée. Le témoin du système s'éteint :
  Pilot ne vous écoute pas en dehors de cet écran. Un retour dans le mode
  redemande les deux captures (une demande par entrée, jamais en boucle).
- **Un refus n'est jamais redemandé tout seul** : l'écran le **dit en une phrase**
  et propose « Autoriser le micro ». Le mode reste **entièrement utilisable**
  (écrire, envoyer, écouter). Les messages sont : « Le micro est fermé. » ·
  « Aucun micro n'est branché. » · « Le micro est occupé par une autre
  application. » · « Le micro n'a pas répondu. »
- **Le niveau affiché** est le volume mesuré, **lissé** (montée rapide, retombée
  lente) et projeté sur le rayon du halo intérieur (0 au silence, 82 px au fort).
  Le halo ne saute donc pas d'une image à l'autre. **Le même niveau décide de
  l'état affiché** (voir §4) : le halo qui s'ouvre et le passage en « écoute »
  viennent d'une seule et même mesure, jamais de deux chemins séparés.
- **Une seconde capture, et c'est voulu** (§6bis) : la **dictée** ouvre sa propre
  capture (service de reconnaissance du navigateur) **après** la mesure de
  niveau. La sortie du mode ferme **les deux**. Si une plateforme refuse la
  capture de dictée, l'écran le **dit** (« La dictée n'a pas fonctionné :
  écrivez votre demande. ») et le clavier reste utilisable : le micro de mesure,
  lui, n'est jamais touché, et le halo continue de suivre votre voix.

## 6. Parler par-dessus Pilot : lire **et** travailler

Prendre la parole en mode Vocal **interrompt Pilot**, dans les deux cas : quand
il **lit** une réponse, et quand il **réfléchit** (l'agent travaille). Un seul
signal, une seule garde, **deux** cibles choisies par la priorité des états (§4).

### 6.1 Pilot lit sa réponse (lot 4a)

- **Un seul signal « Pilot parle »** : l'état de la lecture à voix haute
  (`pilot-read-aloud-state`, émis par `read-aloud.js`). L'écran ne devine jamais la
  parole et ne crée **aucun second lecteur**. « Pilot parle » vaut pour la lecture
  normale **et pour ses deux replis de voix** (`local-fallback` quand la voix
  locale choisie manque, `system-fallback` quand aucune voix du système ne
  correspond) : dans les deux cas le son sort des haut-parleurs, donc la dictée
  doit être désarmée et la coupure armée comme pendant une lecture ordinaire. La
  décision est **une seule fonction pure**, `isReadAloudSpeaking(state)`, et elle
  sert les quatre chemins (armement de la dictée, garde du micro, coupure, sortie
  du mode) — aucune comparaison de chaîne ailleurs.
- **À chaque début de lecture**, une fenêtre d'ouverture de **600 ms** pendant
  laquelle Pilot **ne coupe jamais** : elle lui laisse le temps de commencer à
  parler. La **mesure** du son de Pilot (le **résidu d'écho**) ne se prend que sur
  l'**attaque du son**, les **200 ms** premières millisecondes de cette fenêtre
  (la constante existante `BARGE_IN_MIN_MS`) ; le reste de la fenêtre n'émet plus
  aucune mesure. Pourquoi : une **première** lecture démarre sur un moteur de
  voix **froid** (le son arrive après la fenêtre), une **deuxième** sur un moteur
  **chaud** (le son démarre tout de suite) — mesurer la fenêtre entière y ferait
  entrer **votre** voix, qui deviendrait la référence et que plus rien ne
  dépasserait. C'est exactement le défaut corrigé (1ʳᵉ lecture coupable, 2ᵉ
  jamais) : `RAPPORT-correction-coupure-deuxieme-lecture.md`.
- **La fenêtre s'ouvre sur le DÉBUT DU SON, pas sur l'annonce.** L'état « Pilot
  parle » part **avant** le premier son (choix de la voix : jusqu'à 1500 ms ; voix
  locale : synthèse du premier morceau par un processus) : la fenêtre mesurait
  alors parfois du **silence**, la référence valait 0, les seuils tombaient au
  plancher et Pilot se coupait **lui-même**. Le lecteur émet donc
  `READ_ALOUD_SOUND_EVENT`, **une fois par lecture**, au premier échantillon
  **audible** (`utterance.onstart` ; pour la voix locale, démarrage réel de la
  lecture audio), et `vocalMic.setSoundStarted()` rouvre la mesure **à cet
  instant**. L'annonce garde sa fenêtre provisoire — un moteur qui n'annonce rien
  retombe sur le comportement antérieur — et **aucun seuil ne change** :
  `RAPPORT-coupure-attaque-du-son.md`.
- **Une voix franche et continue coupe à CHAQUE lecture**, indéfiniment : la
  deuxième, la troisième, la dixième comme la première. Aucune mesure ne survit
  d'une lecture à l'autre, et aucun verrou de coupure ne peut être hérité d'une
  réflexion interrompue.
- **Le seuil** vaut ensuite `max(0,05 ; résidu × 1,8)` : il est toujours posé
  **au-dessus** de ce que Pilot s'entend faire. Le résidu ne remonte que sur les
  moments **calmes** — une voix ne peut pas devenir elle-même la référence qui
  l'empêcherait de couper.
- **Il faut une voix continue** au-dessus du seuil pendant **200 ms** : des
  claquements, une toux brève ou un bruit de chaise ne suffisent pas.
- **Le cas « impossible à couper » n'existe plus (garantie de secours).** Quand
  la garde n'est **pas armée** (annulation d'écho non prouvée, ou résidu
  au-dessus de `BARGE_IN_RESIDUAL_MAX`), le seuil normal est **interdit** — couper
  avec lui ferait se taire Pilot sur son propre son. Mais le silence n'est plus
  la conséquence : une voix qui dépasse **le double du résidu mesuré**
  (`fallbackThreshold`, `BARGE_IN_FALLBACK_FACTOR` = 2) et **s'y tient
  `BARGE_IN_FALLBACK_MS` = 1000 ms** coupe la lecture. Pourquoi cela ne part pas
  sur Pilot : le résidu est mesuré sur l'**attaque du son**, quand seul le son de
  Pilot est présent ; ce même son ne franchit pas son propre double, alors
  qu'une voix superposée l'élève nettement. Le secours est **plus prudent** que
  la voie normale (marge 2 au lieu de 1,8 ; une seconde au lieu de 200 ms) et il
  ne supprime **aucune** protection anti-écho.
- **La preuve d'annulation d'écho est relue à chaque début de lecture**, sur la
  piste **déjà ouverte** (`setSpeaking` → `echoCancellationOf`), et non plus une
  seule fois à l'ouverture du micro : une valeur `false` lue une fois ne gèle
  plus la décision de toute la session. Aucun second accès au micro.
- **Une seule coupure par lecture.** Aucune reprise automatique n'est programmée.
- **Ce que fait la coupure** : `stopReading()` — la **seule** voie d'arrêt de
  lecture du projet, donc l'arrêt tombe **entre deux phrases**, jamais au milieu
  d'un mot ; l'objet repasse en « écoute » ; le curseur revient dans la zone de
  saisie. **Aucun agent n'est arrêté** : la voix coupe l'écoute, pas le travail.

### 6.2 Pilot réfléchit (lot 4b)

- **Même garde, même mesure, mêmes 200 ms.** Le moteur micro reçoit simplement
  l'état « réflexion », par `setThinking`, depuis le **même** signal que l'écran
  (`reflectingActive`, alimenté par `agent_start` / `agent_end`).
- **Aucun calibrage dans ce cas, et c'est voulu** : Pilot est muet pendant qu'il
  réfléchit, il n'y a **aucun écho à mesurer**. La garde applique donc directement
  le plancher de bruit déjà utilisé par la lecture (0,05) — **aucun seuil, aucune
  durée, aucun réglage nouveau** n'a été ajouté.
- **Ce que fait la coupure** : **le chemin d'arrêt du bouton Stop**, à l'identique
  (`stopSuperAgentTurn` → `invoke("abort_super_agent")`). Il n'existe **pas** de
  second mécanisme d'arrêt : la voix et le bouton empruntent la **même** fonction,
  donc les mêmes effets — l'arrêt est demandé au moteur, le texte **déjà produit**
  est conservé et affiché, l'état de la conversation retombe (`agent_end`), la
  file de missions du projet est **tenue** et l'arrêt est **tracé** dans
  `.pilot/agent-stops.log` comme tout arrêt.
- **Une seule coupure par prise de parole** : tant que la voix ne retombe pas, la
  garde ne recoupe pas. Quand vous vous taisez, elle **se réarme** d'elle-même —
  sans délai à régler — pour la phrase suivante.
- **Votre parole n'est pas perdue** : le curseur revient dans la zone de saisie,
  prêt à recevoir la dictée ou votre correction. Pilot **ne relance pas** l'agent
  avec ce qui vient d'être dit (ce n'est pas fait, §9).

### 6.3 Commun aux deux cas

- **Hors mode Vocal, rien ne change** : les autres écrans lisent jusqu'au bout et
  laissent travailler l'assistant ; le micro n'y est pas ouvert, et la fonction de
  coupure sort immédiatement si l'écran Vocal n'est pas affiché.
- **L'écran ne change pas** : ni bouton, ni réglage, ni ligne d'état nouveaux.
- **Pendant une dictée, la voix ne coupe rien** (§6bis) : c'est la même voix qui
  est en train d'être transcrite. `vocalBargeIn` rend donc la main tant qu'une
  dictée est ouverte — **aucun seuil, aucune durée n'a bougé**.

## 6bis. Parler suffit : la dictée s'arme toute seule

Le défaut corrigé : le micro de cet écran ne faisait que **mesurer** le niveau.
Parler animait l'écran, mais n'écrivait rien et n'envoyait rien ; et les erreurs
de dictée s'affichaient dans **la conversation**, qui n'est pas affichée ici.

- **Aucun bouton à toucher.** Au repos, la **dictée** de la barre de saisie
  s'ouvre d'elle-même (après 350 ms) : on parle, le texte s'écrit dans la zone,
  et la fin d'écoute passe par le **chemin d'envoi existant**
  (`applyVoiceEnd` → `send`) — donc **un seul envoi**, jamais deux.
- **La demande part deux secondes après le dernier mot** (§6bis.1) : Pilot ne
  dépend plus de la fin que déclare — tardivement — le moteur de reconnaissance.
- **Elle se désarme pendant que Pilot parle** (on ne se transcrit pas soi-même)
  et **pendant qu'il travaille** (le tour en cours prime). « Pilot parle »
  comprend les **replis de voix** (§6.1) : une réponse lue avec la voix du
  système ne laisse pas le micro se rouvrir.
- **Elle se réarme quand la lecture d'une réponse est finie**, avec une marge de
  silence plus longue (600 ms) : c'est la **conversation continue** du mode —
  répondre puis reparler, sans rien toucher.
- **Un plafond arrête les retours INSTANTANÉS du moteur** : si le moteur de
  reconnaissance rend la main **sans rien transcrire trois fois en moins de
  30 secondes**, la dictée **cesse de s'armer toute seule** — sinon le micro
  serait rouvert en boucle pour rien. Le plafond est une **fonction pure**
  (`noteEmptyVocalSession`), il ne compte que les fins **vides** — la fin
  **normale et vide** comme la fin **silencieuse du moteur** (`no-speech`,
  `aborted` sans geste, qui rendaient la main sans rien dire et échappaient au
  plafond), jamais une erreur **affichée**, jamais un arrêt **demandé** (🎙️,
  envoi, sortie du mode), jamais une reprise en main — et **seulement dans cet
  écran**. Le constat du vide et la nature de la fin sont tranchés à **un seul
  endroit** (`isSilentEmptyVoiceEnd` et `VOICE_END_*`, dans
  `voice-auto-send.js`) : aucune seconde détection.
  **Un SILENCE n'est pas une panne** (défaut corrigé, cf.
  `docs/rapports/RAPPORT-dictee-vocale-coupee.md`) : une fin d'écoute qui a
  **réellement écouté** — durée mesurée ≥ `VOICE_EMPTY_SESSION_INSTANT_MS`
  (1 s) — n'alimente **jamais** le plafond, et une telle écoute **remet le
  compte à zéro**. Le moteur de reconnaissance termine lui-même la session
  toutes les quelques secondes de silence ; compter ces fins normales
  suspendait l'écoute au bout de trois pauses en annonçant un échec alors que
  le son était capté. Le plafond ne vise donc plus que le **retour
  instantané** (le moteur rend la main sans avoir écouté), seul profil de
  boucle. La durée est **mesurée** dans `super-agent.js` (`debutSession` → `rec.onend`)
  et transmise au compteur ; le seuil, lui, vit dans `voice-auto-send.js` —
  aucun réglage utilisateur.
  Il **ne se lève pas avec le temps** : un **geste** le rétablit — un clic sur
  🎙️, ou une nouvelle entrée dans le mode. La ligne d'état l'annonce
  (« La dictée n'a pas fonctionné : écrivez votre demande. », phrase existante),
  et **seulement** dans ce cas : un silence ne produit aucun message.
- **Un geste explicite prime toujours** : un clic sur 🎙️ pour arrêter la dictée
  la laisse fermée (elle ne se rouvre pas 350 ms plus tard).
- **Les trois sorties du mode la ferment** : aucun périphérique ne reste ouvert
  derrière l'écran.
- **Un projet sensible ne dicte jamais** (dictée cloud) : le drapeau est relu à
  l'entrée du mode **et à chaque changement de projet**, comme dans l'onglet
  agent π. Tant que la réponse n'est pas arrivée, **la dictée ne s'arme pas**
  (règle `sensibilite-inconnue`) : on attend quelques millisecondes au lieu de
  parier sur « projet libre ».
- **Cette attente est BORNÉE** (`withTimeout`, 800 ms : la garde déjà écrite
  pour cette doctrine, aucune seconde). Au-delà, le projet est **non vérifié** :
  la dictée **ne s'arme toujours pas toute seule** (on ne suppose **jamais**
  « projet libre »), mais l'écran **le dit** sur l'unique ligne d'état
  (« État du projet non vérifié : appuyez sur le micro pour dicter, ou écrivez
  votre demande. ») et le **geste 🎙️ fonctionne** : l'utilisateur décide, une
  fois averti. Une erreur d'IPC, elle, reste fail-open (projet tenu pour libre,
  comme avant).
- **La MESURE passe avant la DICTÉE** (§5) : aucune dictée ne s'arme tant que le
  micro de mesure n'est pas **réellement ouvert** (`mesure-fermee`). Une panne de
  mesure se lit donc comme une panne de mesure (phrase du micro + « Autoriser le
  micro »), jamais comme une dictée qui marche avec un halo figé.
- **Une panne de dictée se voit dans l'unique ligne d'état**, en une phrase qui
  dit quoi faire (« … : écrivez votre demande. ») : micro refusé, micro occupé,
  réseau absent, dictée indisponible sur ce poste. Jamais dans la zone masquée,
  jamais en boucle (le geste 🎙️ ou « Autoriser le micro » lève l'erreur).
- **« Dictée indisponible » est réellement dit.** Quand le poste n'a pas de
  reconnaissance vocale (`transcription === false`), la décision le sait déjà ;
  la ligne du repos affiche donc « La dictée n'est pas disponible sur ce poste :
  écrivez votre demande. » au lieu de promettre « Je vous écoute. ». La phrase est
  choisie par la décision pure, à l'unique endroit qui écrit cette ligne
  (`vocalStatusLine`, appelée par `applyVocalState`).
- **Rien de nouveau à l'écran** : ni bouton, ni réglage. Les phrases du repos, de
  l'écoute, de la réflexion et de la parole sont inchangées ; au repos seulement,
  la ligne peut porter **en plus** le message que la décision prévoit (micro
  fermé, dictée indisponible, plafond des sessions vides) — jamais pendant la
  parole ni pendant la réflexion, qui gardent la priorité.
- **Une seule mise en œuvre** : les décisions sont **pures**
  (`src/js/vocal-conversation.js`), l'application se fait à **un seul endroit**
  (la fin de `applyVocalState`), et le démarrage passe par **une seule voie**
  (`startVoiceInput`, extraite de `toggleVoiceInput` : `new SR()` n'existe qu'une
  fois dans le code).

### 6bis.1 Répondre après le dernier mot : deux secondes par défaut, réglable

**Décision du propriétaire, appliquée telle quelle** : *deux secondes après le
dernier mot récupéré, s'il n'y a pas de nouveau mot, la demande part.* — puis :
*rendre ce délai réglable, de une à cinq secondes, sans changer le défaut.*

Le défaut corrigé : l'envoi n'avait lieu qu'à la **fin que déclare le moteur de
reconnaissance** du navigateur, et cette fin peut arriver **plusieurs secondes
après le dernier mot** (le moteur attend son propre silence). L'écran ne décidait
donc jamais lui-même que la phrase était terminée : on parlait, le texte
s'écrivait, puis on attendait.

- **Le délai est décidé** : la règle **pure** `decideVocalSilenceSend(etats,
  moment)` vit dans la **source unique des décisions**
  (`src/js/vocal-conversation.js`). Elle ne lit **aucune constante** : le délai
  lui **arrive avec l'état** (`etats.delaiMs`), fourni par le **seul** endroit qui
  arme le minuteur (`vocalSilenceState()` dans `super-agent.js`). Une règle pure
  se teste donc avec n'importe quel délai, sans configuration.
- **Valeur par défaut inchangée : DEUX SECONDES.** `VOCAL_SILENCE_SEND_MS`
  (2 000 ms) reste la valeur par défaut du réglage (et le repli quand la
  configuration est illisible). Rien d'autre ne la recopie : l'écran Vocal ne
  connaît que la valeur **relue**, jamais le nombre.
- **Le réglage, à UN SEUL endroit** : ⚙️ Options → onglet **« Assistant »** →
  section **« Mode Vocal »**, juste sous le réglage de la voix. Un **curseur de
  1 à 5 s par pas de 0,5 s** (défaut **2 s**) et la valeur **en toutes lettres**
  (« 1 seconde », « 2,5 secondes », « 5 secondes »). Mémorisé dans la
  configuration (`vocal_silence_send_ms`, champ `u32` à défaut 2 000), appliqué
  **sans redémarrage**. Aucun autre réglage ne concerne ce délai, et il n'est
  affiché nulle part ailleurs (ni sur l'écran Vocal, ni dans une bulle).
- **Bornes et pas décidés à UN SEUL endroit** : `normalizeVocalSilenceSendMs`
  (module pur) — valeur absente, illisible ou ≤ 0 ⇒ **2 secondes** ; en dessous de
  1 s ⇒ **1 s** ; au-dessus de 5 s ⇒ **5 s** ; toute valeur hors pas est **alignée
  sur le pas**. L'interface **enregistre** ce que cette fonction rend : une
  configuration aberrante ne change jamais le comportement. Le libellé vient
  aussi de là (`vocalSilenceSendLabel`, virgule décimale, singulier à une
  seconde).
- **Un changement pendant une dictée s'applique au PROCHAIN armement**, jamais au
  minuteur déjà lancé : la valeur est lue **au moment d'armer**, elle n'est pas
  surveillée ensuite. On ne coupe donc **jamais** une parole en changeant un
  réglage ; c'est le mot suivant (ou la dictée suivante) qui suit la nouvelle
  valeur. La relecture ne touche pas au minuteur (aucun `clearTimeout`, aucun
  `setTimeout` dans `refreshVocalSilenceSendMs`).
- **Pilot par mots, pas à l'horloge** : chaque texte récupéré — **provisoire
  comme définitif** — **repousse** l'échéance. Un texte **identique** au précédent
  n'est pas un nouveau mot : sinon un moteur qui répète son résultat intermédiaire
  repousserait sans fin.
- **Un seul minuteur à la fois** : remplacé à chaque nouveau mot, **annulé** dès
  que la dictée se referme, quand Pilot **parle** ou **réfléchit**, et aux
  **trois sorties** du mode. Aucun second minuteur de ce genre n'existe.
- **Un seul envoi, celui d'aujourd'hui** : à l'échéance, on **referme** la dictée
  en demandant au moteur de s'arrêter ; sa fin d'écoute **normale** passe par
  `applyVoiceEnd` → `send`, comme avant. Aucun second envoi, aucun second moteur,
  aucune seconde détection de fin de parole.
- **Jamais de coupure d'une parole** : rien ne part si du texte arrive encore, si
  Pilot **lit** ou **réfléchit**, si la dictée s'est refermée, ou si l'utilisateur
  a **repris la main** dans la zone. Une dictée **muette** n'envoie rien. Les
  gardes existantes (projet sensible, mesure d'abord, plafond des fins vides,
  dictée unique) sont **inchangées**.
- **Ordre des règles** (c'est la spec, testé tel quel) : hors mode → Pilot parle →
  Pilot travaille → dictée refermée → reprise en main → aucun mot → **échéance :
  refermer** (et, au moment du mot, attendre le délai réglé). Les gardes passent
  **avant** le délai : aucune valeur de réglage ne peut faire partir une demande
  qu'elles refusent.
- **La phrase qui annonçait l'envoi « à la fin de la dictée » a été corrigée** là
  où elle était devenue fausse : c'est le **dernier mot + le délai réglé**
  (deux secondes par défaut) qui décide, plus la fin du moteur.

### 6bis.2 Pilot parle court : une réponse de conversation, pas de chat écrit

**Décision du propriétaire, appliquée telle quelle** : *« le texte que l'assistant
prononce dans ce mode vocal, il faudrait que ce soit plus court pour une
conversation plus fluide, et qu'on entre dans les détails si l'utilisateur le
demande dans la conversation ».*

Le défaut corrigé : dans l'écran Vocal, Pilot répondait comme dans un chat écrit
(réponses longues, listes, titres, noms de fichiers, code). La voix est ici le
**seul canal** : ces réponses sont pénibles à écouter et lentes.

- **Une consigne ajoutée à la demande, à UN SEUL endroit** : le point de
  composition de la demande envoyée à l'agent est `send()`
  (`src/js/super-agent.js`), traversé par **toutes** les demandes de cet écran
  (clavier comme dictée, puisque la barre de saisie est le même nœud déplacé).
  La consigne et son assemblage vivent dans une **source unique** :
  `src/js/vocal-brevity.js` (`VOCAL_BREVITY_INSTRUCTION`,
  `composeVocalPrompt(texte, { modeVocal })`). Aucun second chemin de prompt
  n'a été créé.
- **Ce que la consigne demande, en clair** : répondre en **deux phrases
  exactement** (le défaut actuel, voir § 6bis.3 pour les quatre niveaux),
  comme à l'oral — **pas de listes, pas de titres, pas de tableaux,
  pas de noms de fichiers, pas de code** — et aller droit à ce qui est **utile à
  dire à voix haute**. Si l'utilisateur demande explicitement de développer
  (« détaille », « explique », « pourquoi », « comment »), Pilot développe : le
  détail demandé, **compréhensible à l'oreille** (des phrases, jamais un tableau
  ni de code).
- **Les cas de sécurité sont exclus explicitement** : une **panne**, un **refus**,
  une **erreur** (outil, micro, agent) et une **demande de confirmation** restent
  dits **entièrement**, même si c'est plus long que le nombre de phrases du
  niveau choisi. La consigne place cette exception **avant** la brièveté : jamais
  une information utile cachée pour rester court.
- **Aucune troncature, jamais** : la brièveté vient de la **consigne**. Rien n'est
  coupé après coup (aucune limite de caractères, aucune `slice`), et la demande de
  l'utilisateur reste **mot pour mot** en tête du message envoyé : une réponse
  tronquée au milieu d'une phrase sonnerait faux et cacherait une information
  utile.
- **Les autres écrans ne changent pas** : hors du mode Vocal, `composeVocalPrompt`
  rend le texte **inchangé** — le chat écrit (onglet π) et l'onglet 🧭 Assistant
  gardent exactement leurs réponses actuelles, et le prompt système de
  l'assistant (`super_agent.rs`) ne contient pas cette consigne. La provenance est
  l'écran Vocal **réel** (`vocalOverlay !== null`), pas un drapeau parallèle.
- **Rien à l'écran, rien à régler** *(avant le réglage de longueur, § 6bis.3)* : ni
  bouton, ni phrase d'interface dans l'écran Vocal lui-même.
  La bulle de la demande et l'historique gardent le texte de l'utilisateur tel
  qu'il l'a dit ; seul le message **envoyé** à l'agent porte la consigne.

### 6bis.3 La longueur des réponses orales se règle (quatre niveaux)

**Décision du propriétaire** : la longueur, longtemps figée, se règle
**Quatre niveaux**, une clé stable par niveau, **un seul juge** de ce qu'une
valeur vaut. **Les longueurs exactes ont été arrêtées par le propriétaire** et
remplacent les fourchettes précédentes : **une phrase**, **deux phrases**,
**quatre à six phrases**, réponse développée.

| Clé (`vocal_brevity_level`) | Libellé à l'écran | Ce que Pilot dit |
|---|---|---|
| `tres-courte` | Très courte | **une phrase**, une seule, pas deux — l'essentiel seulement |
| **`courtes`** (défaut) | Courtes | **deux phrases**, exactement deux, pas trois |
| `moyenne` | Moyenne | **quatre à six phrases**, avec le pourquoi quand il aide |
| `detaillees` | Détaillées | réponse complète et développée, mais toujours dite à l'oreille : des phrases, jamais de tableau, jamais de code, jamais un nom de fichier lu à voix haute |

Les nombres sont écrits **en toutes lettres et répétés** dans la consigne
(« en UNE phrase, une seule, pas deux » ; « en DEUX phrases, exactement deux,
pas trois ») pour qu'un modèle ne puisse pas les lire de travers.

- **Source unique** : `src/js/vocal-brevity.js`. `VOCAL_BREVITY_LEVELS` (les
  quatre clés), `VOCAL_BREVITY_DEFAULT_LEVEL = "courtes"`,
  `normalizeVocalBrevityLevel()` (**seul** juge : valeur inconnue, vide, `null`,
  casse différente ⇒ défaut), `vocalBrevityLabel()` (**seul** libellé),
  `vocalBrevityInstruction(niveau)` (la consigne d'un niveau).
  `VOCAL_BREVITY_INSTRUCTION` est la consigne du niveau **par défaut**
  (« courtes » : deux phrases exactement).
- **La consigne est construite à l'envoi**, par le seul `composeVocalPrompt(text,
  { modeVocal, niveau })` (appelé une seule fois, dans `send()` de
  `src/js/super-agent.js`). Le niveau est donc lu **au moment de composer** : un
  réglage change s'applique à la **demande suivante**, jamais à une demande déjà
  partie.
- **Ce qui ne change jamais, quel que soit le niveau** : (a) une demande
  explicite de développer (« détaille », « explique », « pourquoi », « comment »)
  passe **avant** le niveau choisi ; (b) une **panne**, un **refus**, une
  **erreur** (outil, micro, agent) ou une **demande de confirmation** se disent
  **entièrement**, même en « très courte » ; (c) **aucune troncature** : la
  brièveté vient de la consigne, jamais d'une coupe (aucune `slice`, aucune
  limite de caractères) ; (d) **hors du mode Vocal**, le texte est **inchangé** ;
  (e) une **demande vide** ne reçoit **aucune consigne**.
- **Réglage, à UN SEUL endroit** : Paramètres → onglet **« Assistant »** →
  section **« Mode Vocal »**, **sous le curseur du délai d'envoi**
  (`#setting-vocal-brevity-level`, un seul choix, quatre libellés venus du module
  pur, plus une phrase d'explication). Champ de configuration Rust
  `vocal_brevity_level` (chaîne, `#[serde(default = "default_vocal_brevity_level")]`
  = `"courtes"` ⇒ **aucune migration**). Le front relit la valeur **fail-open**
  (absente ou illisible ⇒ « courtes ») **au montage** de l'onglet et dans le
  gestionnaire `pilot-config-changed` **déjà existant** (aucun second écouteur),
  et l'enregistrement est **immédiat**.
- **Verrou** : `src/js/vocal-longueur-reglable.test.js` (les quatre niveaux, le
  défaut mot pour mot, le repli sur valeur inconnue, les cinq invariants pour les
  quatre niveaux, le branchement, l'interface, la documentation), complété par
  `src/js/vocal-reponses-courtes.test.js` (même module, aucune copie ailleurs).

## 7. Pourquoi cela peut légitimement ne pas se déclencher

**Ce sont des protections, pas des pannes.** Le choix est explicite : *un silence
vaut mieux qu'une réponse qui bégaie ou qui se coupe toute seule.* Les cas
ci-dessous sont **voulus** et se produisent sans que rien ne soit cassé.

| Ce que vous vivez | Pourquoi (c'est voulu) | Quoi faire |
|---|---|---|
| **Il faut insister plus longtemps que d'habitude** | Quand l'écho n'est pas maîtrisé (navigateur qui ne **prouve** pas l'annulation d'écho, ou résidu d'écho au-dessus de la limite), le seuil habituel — 200 ms de voix — est **interdit** : il ne reste que la **garantie de secours**, qui demande une voix au-dessus du **double** du son que Pilot s'envoie **tenue une seconde entière**. | Parler d'une traite pendant au moins une seconde, sans s'arrêter. **Rien ne rend plus la coupure impossible** : c'est la règle tenue par cette garantie. |
| **Rien ne se coupe dans la première seconde** | Les **600 premières millisecondes** d'une lecture servent à laisser Pilot commencer à parler : couper pendant cette ouverture reviendrait à juger avec un seuil pas encore établi. La mesure du son de Pilot, elle, ne prend que les **200 premières** millisecondes. | Parler après le tout début d'une phrase. |
| **Rien ne se coupe si vous parlez dans les 200 premiers millisecondes** | Votre voix tombe alors **dans** la mesure d'attaque : elle est comptée comme du son de Pilot, et la référence du secours monte avec elle — plus rien ne la dépasse pendant cette lecture-là. Au-delà de ces 200 ms, la mesure est terminée : votre voix ne peut plus la polluer. | Laisser passer le tout début de la phrase, puis parler. La lecture suivante repart d'une mesure propre. |
| **Rien ne se coupe avec des haut-parleurs très forts** | Le **résidu d'écho mesuré** est si élevé que le secours exige une voix au-dessus du **double** de ce son : si vos haut-parleurs couvrent votre voix, aucun seuil ne peut la distinguer. | Baisser le volume, rapprocher le micro, ou mettre un casque — puis relire la mesure. |
| **Il faut vraiment insister** | Une voix **brève ou hachée** (moins de 200 ms continues au-dessus du seuil, ou une seconde dans le régime de secours) n'est pas une prise de parole : c'est un bruit — que Pilot **lise** ou qu'il **réfléchisse**. | Parler d'une traite, une phrase entière. |

Ces protections ne concernent que la **lecture** : pendant une réflexion, Pilot
n'émet aucun son, il n'y a donc ni calibrage ni désarmement d'écho à appliquer
(§6.2).

**Ce qui reste impossible, dit franchement** : il n'y a **qu'une seule entrée
micro**, et pilot ne peut pas séparer votre voix du son de Pilot autrement qu'en
comparant des niveaux. Deux cas restent donc hors de portée, et ils sont
mesurables :

1. **Vous parlez dans les 200 ms qui suivent le début de la phrase** : votre
   voix entre dans la mesure d'attaque et devient une partie de la référence —
   la lecture n'est pas coupée cette fois-là. La lecture **suivante** repart
   d'une mesure propre : c'est une limite d'une lecture, pas d'une session.
2. **Vos haut-parleurs sont si forts que votre voix ne dépasse pas le double du
   son qu'ils envoient au micro** : aucun seuil ne peut la distinguer.

Le prix de la garantie de secours, assumé et chiffré : le son de Pilot qui
**bondit d'un coup à plus du double** de son niveau habituel et **s'y tient une
seconde sans le moindre creux** est indiscernable d'une voix — Pilot se coupe
alors lui-même, une fois. En pratique, la voie normale déjà en service depuis le
lot 4a est **plus** susceptible de partir (marge 1,8 fois, 200 ms) et ne produit
pas ce défaut chez vous : le secours, plus prudent (2 fois, 1000 ms), reste sous
ce risque.

## 8. Sortir du mode Vocal — trois voies, aucune surprise

| Voie | Effet |
|---|---|
| **Le même bouton** (le logo : en Vocal son infobulle annonce « Détaillé », un clic y passe) | retour à l'écran normal |
| **Échap** | idem — sauf si une modale est ouverte : la touche lui appartient alors, on ne quitte pas le mode sous elle |
| **Fermer l'onglet 🧭 Assistant** | idem (la lecture est arrêtée et le mode quitté) |

`Ctrl+Shift+A` (le raccourci du plein écran de l'assistant) **sort** aussi du mode
Vocal au lieu d'empiler un second plein écran.

**Jamais deux pleins écrans superposés** : entrer en Vocal sort d'abord de
« Assistant seul », et entrer en « Assistant seul » sort d'abord du Vocal — la
garde est posée aux deux endroits qui créent un overlay. **Symétrie exacte** :
tout nœud déplacé à l'entrée (le logo, qui est le bouton des modes, la barre de
saisie) est restitué à sa place et dans le bon ordre, avec son texte d'invite et
sa hauteur d'origine.

## 9. Ce qui n'est pas fait (et n'est pas simulé)

- **La réorientation de l'agent** quand on le coupe : la coupure arrête la
  **lecture** ou le **travail en cours** (lot 4b), mais elle ne **relance pas**
  l'agent avec ce qui vient d'être dit. Il faut redemander (à la voix, c'est
  désormais possible sans bouton — §6bis).
- **La dictée vocale** reste celle du navigateur (le son peut sortir du poste) :
  rien de local n'a été ajouté ici, et un projet sensible ne dicte pas.
- **Deux éléments du rapport de conception ne sont pas livrés** : le bouton
  « Reprendre ici » (devenu inutile — la coupure rend déjà la main au clavier) et la
  ligne d'état « Je finis ce que je fais, puis je vous réponds. ».

## 10. Où c'est dans le code, et ce que les tests tiennent

| Fichier | Rôle |
|---|---|
| `src/js/screen-mode.js` | **source unique** des trois modes : cycle, libellé, infobulle, clé `pilot_screen_mode`, migration, `screenModeScreen()` (mode → écran) |
| `src/js/super-agent.js` | `enterVocal` / `exitVocal`, `applyVocalState`, `vocalBargeIn`, `stopSuperAgentTurn` (arrêt partagé bouton Stop / voix), `vocalSyncMicSpeaking` / `vocalSyncMicThinking`, `autoReadVocalReply`, `vocalScreenState` / `vocalStateClass` / `vocalStatusText` / `vocalReducedMotion` / `vocalInterruptTarget` (pures) ; **conversation parlée** : `startVoiceInput` (seule voie de démarrage), `armVoiceInput`, `vocalSyncConversation`, `reportVoiceFailure`, `refreshVocalSensitivity` |
| `src/js/vocal-conversation.js` | **source unique des décisions de la conversation parlée** (pures) : armer au repos, réarmer après la lecture, désarmer pendant la parole (replis compris) / le travail / hors du mode / sur projet sensible / après un arrêt manuel / **quand le statut du projet n'a pas pu être vérifié** (`sensibilite-indisponible`), **plafond des sessions vides** (`noteEmptyVocalSession`), **la demande qui part deux secondes après le dernier mot** (`VOCAL_SILENCE_SEND_MS` en valeur par defaut + `decideVocalSilenceSend`, delai reglable de 1 a 5 s), et **l'unique phrase** à afficher pour chaque panne de dictée |
| `src/js/voice-auto-send.js` | **seule détection du vide** d'une dictée (`normalizedVoiceText`, `VOICE_END_*`) et **seule décision** « cette fin alimente-t-elle le plafond ? » (`isSilentEmptyVoiceEnd` : fin normale et vide OU fin silencieuse du moteur **instantanée** — durée mesurée < `VOICE_EMPTY_SESSION_INSTANT_MS` (1 s) —, jamais une erreur affichée, un arrêt demandé, une reprise en main, et **jamais un silence d'une durée réelle**) |
| `src/js/vocal-brevity.js` | **source unique** de la **réponse courte du mode Vocal** : les **quatre niveaux** de longueur (`VOCAL_BREVITY_LEVELS`, `normalizeVocalBrevityLevel`, `vocalBrevityLabel`), la consigne d'un niveau (`vocalBrevityInstruction`) et son **seul assemblage** (`composeVocalPrompt`, qui rend le texte **inchangé** hors du mode). Aucune troncature |
| `src/js/vocal-mic.js` | **seul** endroit où le micro est ouvert : capture, niveau lissé, arrêt réel, messages de panne, garde anti-auto-coupure (`stepSpeechGate`, `bargeInArmed`, `setSpeaking` / `setThinking`) |
| `src/js/main.js` | câblage du bouton, ouverture de l'onglet 🧭 quand un mode plein écran est mémorisé |
| `index.html` · `src/css/style.css` | le bouton unique — le logo `#mode-logo` et son `data-screen-mode` —, l'écran `.pilot-vocal` et ses jetons `--vocal-*` |

Verrous : `trois-modes-ecran.test.js` (lot 1), `ecran-vocal-lot2.test.js` (écran,
états, trois sorties, symétrie), `ecran-vocal-lot3.test.js` (micro, arrêt réel,
messages), `ecran-vocal-lot4a.test.js` (garde anti-auto-coupure, chiffres),
`vocal-couper-la-reflexion.test.js` (lot 4b : chemin d'arrêt **réutilisé**, une
seule coupure, négatifs bruit court / silence / écho, écran inchangé),
`vocal-parler-declenche-une-demande.test.js` + décisions pures couvertes par
`vocal-conversation.js` (conversation parlée : armer au repos, désarmer pendant
la lecture et le travail, réarmer après la lecture, fermeture aux trois sorties,
un seul envoi, erreurs dans la ligne d'état),
`vocal-correctifs-revue.test.js` (repli de voix = « Pilot parle », phrase
« dictée indisponible » affichée, plafond des sessions vides et levée par un
geste), `vocal-repondre-deux-secondes.test.js` (délai de **deux secondes après le
dernier mot** : valeur unique, ordre des règles, report à chaque mot, un seul
minuteur, aucun envoi pendant la lecture / la réflexion / après une reprise en
main, aucun envoi tardif après la sortie du mode, `rec.stop()` réutilisé),
`vocal-deux-gardes-finales.test.js` (deux défauts non bloquants de la
revue indépendante : **attente bornée** du statut du projet — délai dépassé ⇒
phrase affichée **et** geste qui fonctionne, jamais « projet libre » supposé —
et **plafond atteignable** : une fin silencieuse du moteur compte, 3 fins vides
en 30 s ⇒ plus d'armement automatique),
`dictee-vocale-se-rearme.test.js` (défaut « le micro est coupé, la dictée n'a pas
fonctionné » : **un silence n'est pas une panne** — une fin d'écoute d'une durée
réelle n'alimente pas le plafond et n'affiche aucun message, la dictée se réarme
après chaque fin normale, la boucle **instantanée** reste arrêtée, rien ne s'arme
hors du mode et jamais deux sessions ; durée **mesurée** et transmise au seul
compteur),
`vocal-reponses-courtes.test.js` (**réponse courte du mode Vocal** : contenu de la
consigne, texte de l'utilisateur intact et non tronqué, consigne **absente** hors
du mode Vocal — chat écrit et Assistant inchangés —, un seul appel dans toute
l'application, cas de sécurité exclus explicitement, documentation à jour).

## 11. Ce qui est prouvé, et ce qui dépend de votre matériel

**Prouvé par les tests** : le cycle des trois modes, la clé unique et la migration,
le libellé et l'infobulle, la structure de l'écran, une seule classe d'état, la
priorité parole > réflexion > écoute, les trois sorties, la restitution des nœuds,
l'arrêt réel du micro, et — sur images audio simulées — **zéro auto-coupure** sur
30 s d'écho résiduel puis **une** coupure quand une voix continue dépasse le seuil.
Est aussi prouvé que la coupure pendant une réflexion ne part **qu'une fois**, ne
part **pas** sur un bruit court ni sur un silence, et emprunte le **même** chemin
d'arrêt que le bouton Stop (aucun second `invoke` d'arrêt dans le code).

Est également prouvé pour la **conversation parlée** : la dictée s'arme au repos
et **pas** pendant la parole / le travail / hors du mode / sur un projet sensible,
elle se réarme après la lecture, elle est **fermée** aux trois sorties, elle ne
s'ouvre **qu'une fois** (une session, une minuterie), et aucun second moteur de
transcription ni second envoi n'existe dans le code. Est prouvé en plus le
délai de **deux secondes après le dernier mot** : respecté, repoussé par chaque
nouveau mot, jamais écoulé pendant la lecture ou la réflexion, jamais honoré après
une reprise en main ou après la sortie du mode. Sont prouvés de même le
**repli de voix** (un repli compte comme « Pilot parle » : pas d'armement pendant
la lecture, coupure de nouveau armée), la phrase **« dictée indisponible »**
affichée par la décision et le **plafond des sessions vides** (trois fins
sans texte en moins de 30 s suspendent l'armement, un geste le rétablit).

Est aussi prouvé pour la **réponse courte du mode Vocal** : la consigne est
ajoutée **uniquement** aux demandes qui partent de cet écran (le chat écrit et
l'onglet Assistant rendent le texte **inchangé**), la demande de l'utilisateur
reste **mot pour mot** en tête du message, **aucune troncature** n'existe dans le
module, et les cas de sécurité (panne, refus, erreur, confirmation) sont
**exclus explicitement** du régime court.

**Non prouvable par un test, à vérifier chez vous** : le niveau d'écho **réel** de
votre pièce (haut-parleurs, volume, distance, pilote audio) — et la capacité de
votre poste à tenir **deux captures** en même temps (mesure de niveau + dictée).
Quand il ne peut pas prouver que l'écho est maîtrisé, Pilot ne renonce plus à la
coupure : il passe à la **garantie de secours** (double du résidu mesuré, tenu
une seconde), qui est aussi prouvée sur images audio simulées — écho déclaré
absent ou trop fort ⇒ une voix franche **coupe** ; son de Pilot seul, même fort et
pendant trente secondes ⇒ **aucune** coupure. La **mesure ouvre toujours la
première** : si elle est refusée, la dictée ne s'arme pas et l'écran le dit ; si
c'est la dictée qui est refusée, le halo continue de suivre votre voix et le
clavier reste utilisable.
