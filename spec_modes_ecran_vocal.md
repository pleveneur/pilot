# Pilot — Les trois modes d'écran et l'écran Vocal (spec)

> **Statut : ✅ livré** — lot 1 (`e3f147b`), lot 2 (`944bd0c`), lot 3 (`70fe93e`),
> lot 4a (`174cc45`), lot 4b (couper la réflexion, voir ce fichier §6),
> **conversation parlée** (§6bis : parler déclenche une demande, sans bouton).
>
> Ce document décrit **ce que Pilot fait réellement**, relu dans le code livré.
> Les raisons de conception (mesures de contraste, choix de placement, découpage
> en lots) restent dans `RAPPORT-trois-modes-ecran-vocal.md`, à la racine.
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
| **Vocal** | un objet lumineux, un trait de niveau, **une** ligne de texte, la zone de saisie en bas | parler à Pilot et l'écouter |

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
l'objet, le trait de niveau, la ligne d'état et la barre de saisie. **Aucun
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
2. **Au centre**, un bloc vertical : un **disque de 168 px** (anneau plein de 2 px
   + remplissage lumineux de 18 % au centre, 0 % aux bords : aucune image), puis
   **24 px** plus bas un **trait de niveau de 200 × 3 px**, puis **24 px** plus bas
   **l'unique ligne d'état**. Le bloc suit la fenêtre sans calcul.
3. **La zone de saisie**, en bas, **toujours visible** et discrète : c'est la barre
   de saisie de l'onglet Assistant, **déplacée** (même nœud, même envoi, même
   dictée 🎙️), 720 px au plus, centrée, 16 px de marge basse, sans filet ni fond
   pleine largeur, plafonnée à **120 px** de haut (au lieu de 200 px dans l'onglet).
   Son texte d'invite y devient **« Écrivez, ou parlez. »** et il est restitué tel
   quel à la sortie.
4. **Un bouton de dépannage, caché par défaut** : « Autoriser le micro »
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
| **Écoute** | le micro **capte vraiment** : le niveau mesuré dépasse le seuil **haut** (0,06 RMS) | vert (`--vocal-listen`) | aucun mouvement propre : **le trait suit la voix** | « Je vous écoute… » |
| **Réflexion** | l'agent réfléchit | violet de l'assistant (`--vocal-think`) | arc de 60° qui tourne en 3 s | « Je réfléchis… » |
| **Parole** | Pilot lit la réponse | ambre (`--vocal-speak`) | halo de 1,6 s + enveloppe du trait | « Je réponds. » |

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
- **En « écoute », aucun niveau n'est inventé** : la longueur du trait vient du
  niveau **réellement mesuré**. Sans mesure (micro fermé, refusé, en panne), le
  trait retombe au silence (8 %), il ne simule rien.
- **En « parole », le trait ne mesure rien** : la voix de la synthèse n'est pas
  capturable par le navigateur, il suit donc une **enveloppe fixe** de 1,6 s,
  volontairement lente et bornée (jamais synchrone avec les mots). Seule
  l'écoute mesure votre voix.
- **Mouvement réduit** : le même drapeau que les animations d'ouverture
  (`prefers-reduced-motion` **et** le réglage « Animer l'ouverture des modales »).
  Quand il est actif, plus aucune animation, plus aucune transition, et le trait est
  **figé** à 8 / 45 / 20 / 70 % selon l'état. **Aucun nouveau réglage** n'a été créé
  pour cet écran.

## 5. Le micro : quand il s'ouvre, quand il se ferme

**Deux captures différentes** vivent dans cet écran, et elles ne s'ouvrent pas au
même moment — c'est la distinction qui manquait :

- **L'ORDRE est une décision du propriétaire : la MESURE ouvre EN PREMIER.**
  Le micro de MESURE (le trait de niveau, l'état « écoute », la prise de parole)
  est demandé **à l'entrée dans le mode**, avant tout armement de la dictée —
  jamais au premier geste, jamais dans les autres modes. La dictée vient
  **après** elle, et **seulement si elle est réellement ouverte**.
- **La DICTÉE** (§6bis) n'est donc ouverte qu'**une fois la mesure ouverte**,
  puis pendant **tout le mode**, sauf pendant que Pilot parle et pendant qu'il
  travaille : elle s'arme au repos 350 ms après l'entrée, parce que « parler
  suffit » (aucun bouton à toucher). C'est **son** service de reconnaissance qui
  tient le micro ouvert, mais il ne peut plus passer devant la mesure.
- **Pourquoi cet ordre** : avec la dictée en premier, un pilote audio qui
  refusait la **seconde** capture faisait échouer la **mesure** — le trait se
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
  lente) et projeté sur la longueur du trait (8 % au silence, 100 % au fort). Le
  trait ne saute donc pas d'une image à l'autre. **Le même niveau décide de
  l'état affiché** (voir §4) : le trait qui s'allonge et le passage en « écoute »
  viennent d'une seule et même mesure, jamais de deux chemins séparés.
- **Une seconde capture, et c'est voulu** (§6bis) : la **dictée** ouvre sa propre
  capture (service de reconnaissance du navigateur) **après** la mesure de
  niveau. La sortie du mode ferme **les deux**. Si une plateforme refuse la
  capture de dictée, l'écran le **dit** (« La dictée n'a pas fonctionné :
  écrivez votre demande. ») et le clavier reste utilisable : le micro de mesure,
  lui, n'est jamais touché, et le trait continue de suivre votre voix.

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
- **À chaque début de lecture**, une **mesure de 600 ms** (calibrage) : Pilot ne
  coupe pas, il écoute **son propre son** sortir des haut-parleurs et retient le
  niveau maximal observé (le **résidu d'écho**).
- **Le seuil** vaut ensuite `max(0,05 ; résidu × 1,8)` : il est toujours posé
  **au-dessus** de ce que Pilot s'entend faire. Le résidu ne remonte que sur les
  moments **calmes** — une voix ne peut pas devenir elle-même la référence qui
  l'empêcherait de couper.
- **Il faut une voix continue** au-dessus du seuil pendant **200 ms** : des
  claquements, une toux brève ou un bruit de chaise ne suffisent pas.
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
- **Un plafond arrête les sessions vides** : si le moteur de reconnaissance rend
  la main **sans rien transcrire trois fois en moins de 30 secondes**, la dictée
  **cesse de s'armer toute seule** — sinon le micro serait rouvert en boucle
  pour rien. Le plafond est une **fonction pure** (`noteEmptyVocalSession`), il
  ne compte que les fins **vides** — la fin **normale et vide** comme la fin
  **silencieuse du moteur** (`no-speech`, `aborted` sans geste, qui rendaient la
  main sans rien dire et échappaient au plafond), jamais une erreur **affichée**,
  jamais un arrêt **demandé** (🎙️, envoi, sortie du mode), jamais une reprise
  en main — et **seulement dans cet écran**. Le constat du vide et la nature de
  la fin sont tranchés à **un seul endroit** (`isSilentEmptyVoiceEnd` et
  `VOICE_END_*`, dans `voice-auto-send.js`) : aucune seconde détection.
  Il **ne se lève pas avec le temps** : un **geste** le rétablit — un clic sur
  🎙️, ou une nouvelle entrée dans le mode. La ligne d'état l'annonce
  (« La dictée n'a pas fonctionné : écrivez votre demande. », phrase existante).
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
  micro »), jamais comme une dictée qui marche avec un trait figé.
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

### 6bis.1 Répondre deux secondes après le dernier mot

**Décision du propriétaire, appliquée telle quelle** : *deux secondes après le
dernier mot récupéré, s'il n'y a pas de nouveau mot, la demande part.*

Le défaut corrigé : l'envoi n'avait lieu qu'à la **fin que déclare le moteur de
reconnaissance** du navigateur, et cette fin peut arriver **plusieurs secondes
après le dernier mot** (le moteur attend son propre silence). L'écran ne décidait
donc jamais lui-même que la phrase était terminée : on parlait, le texte
s'écrivait, puis on attendait.

- **Le délai est décidé** : `VOCAL_SILENCE_SEND_MS` (2 000 ms) et la règle
  **pure** `décideVocalSilenceSend(etats, moment)` sont ajoutées à la **source
  unique des décisions** (`src/js/vocal-conversation.js`). Ni réglage, ni bouton,
  ni affichage : le délai ne se règle pas et ne se voit pas.
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
  refermer** (et, au moment du mot, attendre deux secondes).
- **La phrase qui annonçait l'envoi « à la fin de la dictée » a été corrigée** là
  où elle était devenue fausse : c'est le **dernier mot + deux secondes** qui
décide, plus la fin du moteur.

## 7. Pourquoi cela peut légitimement ne pas se déclencher

**Ce sont des protections, pas des pannes.** Le choix est explicite : *un silence
vaut mieux qu'une réponse qui bégaie ou qui se coupe toute seule.* Les quatre cas
ci-dessous sont **voulus** et se produisent sans que rien ne soit cassé.

| Ce que vous vivez | Pourquoi (c'est voulu) | Quoi faire |
|---|---|---|
| **Rien ne se coupe quand vous parlez** | La machine ne **prouve** pas qu'elle annule l'écho : le navigateur ne répond pas « oui » (champ absent) ou répond « non » à l'annulation d'écho. Sans cette preuve, la détection reste **désarmée** et Pilot lit jusqu'au bout. | Casque (l'écho disparaît), ou accepter la lecture complète. Le motif est lisible sans coupure : `bargeInReport()` (`echoCancellation`, `residu`, `seuil`, `arme`, `calibre`, `motif`). |
| **Rien ne se coupe si vous parlez tout de suite** | Les **600 premières millisecondes** d'une lecture servent à mesurer le son de Pilot lui-même : couper pendant cette mesure reviendrait à juger avec un seuil qui n'existe pas encore. | Parler après le tout début d'une phrase. |
| **Rien ne se coupe avec des haut-parleurs forts** | Le **résidu d'écho mesuré** dépasse la limite (0,03 quand l'annulation d'écho est prouvée, 0,01 quand le navigateur ne dit rien) : la détection se désarme d'elle-même. | Baisser le volume, rapprocher le micro, ou mettre un casque — puis relire la mesure. |
| **Il faut vraiment insister** | Une voix **brève ou hachée** (moins de 200 ms continues au-dessus du seuil) n'est pas une prise de parole : c'est un bruit — que Pilot **lise** ou qu'il **réfléchisse**. | Parler d'une traite, une phrase entière. |

Ces trois premières protections ne concernent que la **lecture** : pendant une
réflexion, Pilot n'émet aucun son, il n'y a donc ni calibrage ni désarmement d'écho
à appliquer (§6.2).

Conséquence assumée : sur un poste où le navigateur ne rapporte pas l'annulation
d'écho, **la coupure de la lecture ne marchera pas** — et Pilot **lit jusqu'au
bout**, exactement
comme avant le lot 4a. Aucun réglage n'a été ajouté pour forcer la détection : ce
serait le moyen le plus sûr de faire bégayer Pilot.

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
| `src/js/vocal-conversation.js` | **source unique des décisions de la conversation parlée** (pures) : armer au repos, réarmer après la lecture, désarmer pendant la parole (replis compris) / le travail / hors du mode / sur projet sensible / après un arrêt manuel / **quand le statut du projet n'a pas pu être vérifié** (`sensibilite-indisponible`), **plafond des sessions vides** (`noteEmptyVocalSession`), **la demande qui part deux secondes après le dernier mot** (`VOCAL_SILENCE_SEND_MS` + `décideVocalSilenceSend`), et **l'unique phrase** à afficher pour chaque panne de dictée |
| `src/js/voice-auto-send.js` | **seule détection du vide** d'une dictée (`normalizedVoiceText`, `VOICE_END_*`) et **seule décision** « cette fin alimente-t-elle le plafond ? » (`isSilentEmptyVoiceEnd` : fin normale et vide OU fin silencieuse du moteur, jamais une erreur affichée, un arrêt demandé ou une reprise en main) |
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
en 30 s ⇒ plus d'armement automatique).

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

**Non prouvable par un test, à vérifier chez vous** : le niveau d'écho **réel** de
votre pièce (haut-parleurs, volume, distance, pilote audio) — et la capacité de
votre poste à tenir **deux captures** en même temps (mesure de niveau + dictée).
Pilot ne suppose jamais l'écho maîtrisé : quand il ne peut pas le prouver, **il ne
coupe pas**. La **mesure ouvre toujours la première** : si elle est refusée, la
dictée ne s'arme pas et l'écran le dit ; si c'est la dictée qui est refusée, le
trait continue de suivre votre voix et le clavier reste utilisable.
