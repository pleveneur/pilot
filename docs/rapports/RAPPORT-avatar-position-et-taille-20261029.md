# Peut-on ouvrir l'avatar à une position et une taille choisies ?

**Étude technique bornée — 29 octobre 2026**
**Portée : aucune modification de code.** Ce document ne change ni l'écran Vocal, ni sa mise en
page, ni les réglages. Les corrections en file sur l'écran Vocal ne sont pas touchées.

---

## La réponse, en trois phrases

1. **La position : OUI.** Pilot sait déjà demander à l'avatar de se poser où il veut — le
   mécanisme existe et il est branché. Il n'est simplement utilisé par personne aujourd'hui.
2. **La taille : NON, pas aujourd'hui.** L'avatar n'expose aucune commande de taille, et Pilot
   ne sait pas la lire non plus. Il faudrait ajouter environ **quinze lignes dans le projet de
   l'avatar** (un autre dépôt) pour que cela devienne possible.
3. **La voie la plus robuste sur Windows, macOS et Linux n'est pas celle-là** : c'est une
   **image posée dans la zone**, sans fenêtre flottante — et cette voie existe déjà (le
   portrait du personnage). L'avatar vivant, lui, n'existe **que sous Windows**.

---

## 1. Comment Pilot parle-t-il à l'avatar aujourd'hui ?

Il lui parle par **HTTP, sur la machine locale** (`http://127.0.0.1:3000`), et **d'une seule
manière** : par les outils de l'Assistant. Trois faits, et rien d'autre :

| Maillon | Ce qu'il fait | Où |
|---|---|---|
| Le cœur | traduit quatre « outils » en appels HTTP vers l'avatar : `set_expression` → `/emotion`, `get_status` → `/status`, `set_position` → `/set_position`, `reset` → `/neutral` | `src/js/face-gateway.js:22-47` |
| Les outils | les expose à l'agent sous forme d'outils (`set_expression`, `get_status`, `set_position`, `reset`) | `src-tauri/extensions/pilot-face.ts:30-118` |
| Le chargement | ces outils ne sont chargés que pour les **sessions de l'Assistant** (🧭), pas pour les agents d'un projet | `src-tauri/src/agent_service.rs:3158`, `:3197`, `:3416` |

Ce que Pilot fait d'autre est **une seule sonde** : « l'avatar répond-il ? » (`GET /status`,
400 ms), utilisée par l'écran Paramètres → Avatar, et par rien d'autre.

| Ce que Pilot demande | Où c'est branqué |
|---|---|
| « Tourne-t-il ? » | `src-tauri/src/plface.rs:751` (`is_running`) → commande `plface_status` (`src-tauri/src/lib.rs:2363`) → `src/js/settings.js:2295` |
| Lancement / fermeture | `src-tauri/src/plface.rs` (`launch_if_needed`, `stop_if_owned`), `src-tauri/src/lib.rs:2320` |

**Point important** : **l'écran Vocal, lui, ne parle pas à l'avatar.** Il n'y a dans tout le
code de l'interface Pilot **aucune** requête vers `127.0.0.1:3000` : le seul appel vers le
visage part d'un **outil d'agent**, jamais de la page. C'est le point qui décide de l'effort
du § 3.

---

## 2. Que permet ce mécanisme, exactement ?

| Question | Réponse | Preuve |
|---|---|---|
| Fixer la **position** de la fenêtre de l'avatar ? | **OUI.** `GET /set_position?x=&y=` déplace la fenêtre en pixels physiques | `PLface/app/src-tauri/src/api.rs:153-160` (`handle_set_position` → `window.set_position(PhysicalPosition::new(x, y))`), route déclarée `:203`, paramètres `struct PositionParams { x: i32, y: i32 }` `:64-67` |
| Fixer sa **taille** ? | **NON.** Aucune route de taille : les 14 routes sont `/`, `/status`, `/emotion`, huit raccourcis d'humeur, `/move`, `/set_position`, `/close` | `PLface/app/src-tauri/src/api.rs:191-204` |
| **Lire** sa position ou sa taille ? | **NON.** `/status` renvoie une **phrase fixe** (la liste de ses routes), pas une géométrie | `PLface/app/src-tauri/src/api.rs:106-115` |
| Lui demander une **expression** ? | **OUI** — c'est même ce qui existe le plus (`/emotion`, huit raccourcis) | `PLface/app/src-tauri/src/api.rs:117-140`, `emotion.rs` |
| Déplacer sa **tête** (regard) ? | oui, ce n'est pas la fenêtre : `/move?x=&y=` | `PLface/app/src-tauri/src/api.rs:140-151` |

Deux conséquences honnêtes :

- **Pilot ne peut pas vérifier ce qu'il a fait.** Après un déplacement, il n'a aucun moyen de
  constater que l'avatar est bien là : la seule route de lecture renvoie toujours le même
  texte.
- **Pilot ne peut pas revenir en arrière.** La place et la taille d'avant ne sont pas
  lisibles : une fois l'avatar déplacé, Pilot ne peut pas le remettre.

---

## 3. S'il faut que ce soit possible : quoi ajouter, et combien de lignes ?

Deux changements, dans **deux dépôts différents**. Estimation franche, **sans les écrire** :

| Où | Quoi | Volume |
|---|---|---|
| **Avatar** (`PLface/app/src-tauri/src/api.rs`) | accepter `w` et `h` **facultatifs** dans `/set_position` et appeler `window.set_size(PhysicalSize::new(w, h))` — la fenêtre est déjà à portée de main dans ce gestionnaire | **10 à 15 lignes** |
| **Avatar** (`PLface/app/src/main.js`) | une marque « taille imposée » pour que la page **n'écrase pas** la taille choisie par la personne (elle la mémorise automatiquement, `:104-134` + `:148`) | **5 lignes** |
| **Avatar** (optionnel mais recommandé) | une route de **lecture** `GET /geometry` qui renvoie `{x, y, w, h}` — seule façon de lever « Pilot ne peut rien vérifier » et de rendre sa place d'avant à l'avatar | **environ 15 lignes** |
| **Pilot** | un module **pur** qui calcule le rectangle : position de la fenêtre de Pilot (`outerPosition`), facteur d'échelle, décalage de la zone, arrondi, seuils de place | **60 à 80 lignes** + tests |
| **Pilot** | le **branchement** dans l'écran Vocal : un appel à l'entrée de l'écran, un par geste de déplacement / redimensionnement, un quand le cas change — jamais pendant | **20 à 30 lignes** |

**Total : environ 100 à 150 lignes, dans deux projets, avec une dépendance d'un projet vers
l'autre** (le programme de l'avatar est livré *à l'intérieur* de Pilot :
`src-tauri/assets/plface.exe`) : il faut donc **le modifier, le reconstruire, et le réexpédier**
dans chaque version de Pilot. C'est ce dernier point qui coûte le plus, pas les lignes.

**Bonne nouvelle technique** : Pilot pourrait appeler l'avatar directement depuis l'interface,
sans commande Rust supplémentaire — la page n'a aucune restriction de sécurité
(`"csp": null`, `src-tauri/tauri.conf.json:53`) et le serveur de l'avatar accepte toutes les
origines (`CorsLayer::permissive()`, `PLface/app/src-tauri/src/api.rs:205`). La géométrie de
l'écran, elle, est déjà calculable côté Pilot (`src/js/window-controls.js:238` `readWorkArea`,
`:36` `PhysicalPosition` / `PhysicalSize`).

---

## 4. Les deux voies, comparées honnêtement

| | **(a) Piloter la fenêtre de l'avatar** pour qu'elle se pose dans la zone | **(b) Afficher l'image du visage DANS la zone**, sans fenêtre flottante |
|---|---|---|
| Ce qu'on voit | le **vrai** avatar : il respire, bouge la tête, change d'expression | une **image** fixe du personnage |
| Ce qui existe déjà | la route de position **et** le branchement Pilot | le **portrait du personnage** (cas 1) : un `portrait.png` déposé, déjà lu par Pilot (`src/js/assistant-persona.js`) |
| Ce qu'il faudrait ajouter | la taille (§ 3) + un calcul de place, **dans deux dépôts** | **rien**, si l'on se contente d'une image |
| Ce qu'il faudrait ajouter pour un avatar **vivant** dans la zone | — | embarquer un **moteur 3D** (`three.js` + `@pixiv/three-vrm`) **et** le modèle `.vrm` dans Pilot : des **centaines** de lignes et **des dizaines de Mo** |
| Windows | fonctionne | fonctionne |
| macOS | **impossible** : Pilot n'y propose même pas de programme d'avatar (`#[cfg(not(windows))] → None`, `src-tauri/src/lib.rs:2280-2290`) | fonctionne |
| Linux | **impossible**, même raison | fonctionne |
| Ce que l'utilisateur risque | un avatar mal posé, qu'il ne peut **pas** remettre à sa place, et dont la taille choisie est **écrasée** | rien |

**Verdict.** La plus **robuste** sur les trois systèmes est **(b) avec une image** — et elle
n'est pas à construire : c'est le **cas 1** déjà spécifié (« un personnage occupe la zone si
et seulement si un portrait affichable existe »). **(a)** est la **seule** façon de montrer un
avatar **vivant** dans la zone, mais elle ne concerne **que Windows**, elle dépend d'un
**autre programme**, et elle rendra Pilot incapable de vérifier ou d'annuler ce qu'il a fait.
**(b) avec un avatar vivant rendu par Pilot** est à écarter : c'est réimplanter chez Pilot ce
qui existe déjà ailleurs, pour deux moteurs à maintenir.

**La question à trancher n'est donc pas technique, elle est de goût** : veut-on, dans la zone,
une **image** (disponible partout, tout de suite, sans risque) ou **l'être vivant** (Windows
seulement, avec une taille à ajouter chez l'avatar et un risque de déplacement non annulable) ?

---

## 5. Les pièges, nommés un par un

| Piège | Ce qui se passe réellement | Ce qu'il faudrait décider |
|---|---|---|
| **La fenêtre mange les clics** | La fenêtre de l'avatar est une **vraie fenêtre du système** : elle reçoit la souris sur **tout son rectangle**, transparence comprise. Rien dans l'avatar ne la rend « transparente aux clics » (aucun `set_ignore_cursor_events` dans `PLface/app/src-tauri/src`), et le CSS de Pilot n'a **aucun** effet sur elle. Posée dans la zone, elle **avalerait** les clics à cet endroit — y compris sur le haut de la liste des tâches. C'est **directement contraire** à la règle « aucun calque ne capte les clics » (`spec_modes_ecran_vocal.md` § 8bis). | soit rendre la fenêtre transparente aux clics (une ligne chez l'avatar, mais **alors on ne peut plus la déplacer à la souris**), soit accepter que la zone soit « à l'avatar » et que rien d'autre n'y soit cliquable |
| **La fenêtre passe devant** | Elle est **toujours au premier plan** (`"alwaysOnTop": true`, `app/src-tauri/tauri.conf.json:24`) : elle passera aussi devant la fenêtre des **Paramètres**, devant une **modale**, devant une autre application. Aujourd'hui cela se voit peu (elle flotte déjà partout) ; posée dans la zone, elle **aura l'air** de faire partie de Pilot tout en se comportant comme une application à part. | l'accepter explicitement, ou ne poser l'avatar **que** quand l'écran Vocal est au premier plan |
| **L'avatar fermé par l'utilisateur** | La zone devient **vide**, sans message (c'est le comportement voulu : de l'air, pas un trou). Pilot **ne le relance pas** s'il ne l'a pas lancé lui-même : il ne referme — donc ne relance — que **sa** copie, tracée dans `plface.pid` (`src-tauri/src/plface.rs:34-43`). | rien à coder : c'est déjà la bonne règle — mais il faut savoir que la zone peut rester vide longtemps |
| **L'avatar sur un autre écran** | Pilot calcule la place à partir de **sa** fenêtre et de **son** facteur d'échelle. Un avatar posé sur un second écran, avec un autre facteur, se poserait **au mauvais endroit**, et Pilot **ne peut pas le constater** (aucune route de lecture). | ajouter la route de lecture (§ 3) — sinon assumer l'erreur silencieuse |
| **Mouvement réduit** | Déplacer une fenêtre **est** un mouvement : Pilot ne peut pas l'animer (`set_position` téléporte), et le saut se produit **même** si la personne a demandé moins de mouvement. Par ailleurs l'avatar **mémorise** chaque déplacement et chaque taille (`app/src/main.js:104-134`, `:246-285`) : la place et la taille imposées par Pilot deviendraient **permanentes**, définitivement, sans que personne l'ait demandé. | ne rien déplacer du tout en mouvement réduit, et une marque « ne pas mémoriser » chez l'avatar (les 5 lignes du § 3) |
| **Place insuffisante** | L'avatar a un plancher de **160 × 180** (`app/src-tauri/tauri.conf.json:19-20`) : sous une certaine fenêtre, il ne reste **aucune** ligne de tâche. | déjà tranché : sous le seuil, la zone n'existe pas et l'avatar **n'est pas déplacé** (`spec_modes_ecran_vocal.md` § 3ter) |

---

## 6. Recommandation

1. **Répondre « oui » pour la position, « non » pour la taille** — c'est mesuré, pas supposé.
2. **Ne rien implémenter maintenant** : la conception écrite de la zone d'image
   (`docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md` § 7bis) a déjà tranché
   que, **tant que la taille n'est pas connue, la zone ne s'affiche pas** et l'avatar n'est
   **pas** déplacé — ce qui évite d'avoir à choisir entre les pièges du § 5.
3. **Si l'on veut l'avatar vivant** : commencer par les **15 lignes chez l'avatar** (taille +
   lecture), et traiter **en même temps** les clics (piège n° 1) et la mémorisation (piège
   n° 5). C'est ce couple qui décide du succès, pas le déplacement lui-même.
4. **Si l'on veut une image partout, tout de suite** : le cas 1 (portrait) existe déjà et ne
   coûte **aucune ligne**.

---

## Annexe A — Toutes les preuves, à leur ligne

**Côté Pilot**

| Fait | Fichier:ligne |
|---|---|
| Traduction outil → HTTP (dont `set_position` → `/set_position`) | `src/js/face-gateway.js:36-47` |
| URL de l'API locale du visage | `src/js/face-gateway.js:15` |
| Outils exposés à l'agent, dont `set_position {x, y}` | `src-tauri/extensions/pilot-face.ts:30-118` |
| Ces outils ne sont écrits que pour les sessions de l'Assistant | `src-tauri/src/agent_service.rs:3158`, `:3197`, `:3416` |
| Sonde « tourne-t-il ? » (400 ms, `GET /status`) | `src-tauri/src/plface.rs:589-630`, `:751` |
| Commande d'interface `plface_status` | `src-tauri/src/lib.rs:2363` |
| Seul appelant de cette sonde dans l'interface | `src/js/settings.js:2295` |
| L'avatar n'existe que sous Windows (programme livré) | `src-tauri/src/lib.rs:2280-2290` |
| Aucune restriction CSP (une requête locale est possible) | `src-tauri/tauri.conf.json:53` |
| Géométrie d'écran déjà disponible côté Pilot | `src/js/window-controls.js:36`, `:238` |
| Aucune requête de l'interface vers `127.0.0.1:3000` | `grep -rn "127.0.0.1:3000" src/js web/js` → uniquement `face-gateway.js` |

**Côté avatar (`G:\IA_PL\PLface`)** — lu, jamais modifié

| Fait | Fichier:ligne |
|---|---|
| `/set_position` déplace la fenêtre | `app/src-tauri/src/api.rs:153-160` |
| Route déclarée | `app/src-tauri/src/api.rs:203` |
| Paramètres `x`, `y` entiers | `app/src-tauri/src/api.rs:64-67` |
| Les 14 routes — **aucune** de taille | `app/src-tauri/src/api.rs:191-204` |
| `/status` renvoie une phrase fixe | `app/src-tauri/src/api.rs:106-115` |
| CORS ouvert | `app/src-tauri/src/api.rs:205` |
| Fenêtre sans cadre, transparente, **toujours au premier plan** | `app/src-tauri/tauri.conf.json:22-25` |
| Plancher de taille 160 × 180 | `app/src-tauri/tauri.conf.json:19-20` |
| Taille choisie **mémorisée** par la page | `app/src/main.js:104-134`, `:148` |
| Position **mémorisée** aussi | `app/src/main.js:246-285` |
| Aucune transparence aux clics | `grep -rn "ignore_cursor\|IgnoreCursorEvents" app/src-tauri/src app/src` → **aucun résultat** |

## Annexe B — Ce que je n'ai pas pu vérifier

- **Le comportement réel des clics** sur une fenêtre transparente : je l'ai déduit de
  l'absence de transparence aux clics dans le code de l'avatar ; je ne l'ai **pas** observé à
  l'écran. C'est le point à vérifier en premier si la voie (a) est retenue.
- **Le facteur d'échelle** quand l'avatar est sur un autre écran : non mesuré (Pilot n'a aucune
  route de lecture pour le constater, l'avatar non plus).
- **Rien de cette étude n'a été testé sur macOS ni Linux** : sur ces deux systèmes, il n'y a
  pas d'avatar, donc pas de voie (a) — c'est un fait de code, pas une mesure.
