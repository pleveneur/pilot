# Proposition — Présentation de l'interface de Pilot

> **Ce document complète `docs/proposition-navigation.md` (706 lignes), il ne le
> remplace pas et ne le réécrit pas.** Le document de navigation décide **où** sont
> les choses (organisation, portes, étapes). Celui-ci décide **à quoi elles
> ressemblent** (hiérarchie, densité, tailles, espacements, alignements, états,
> libellés, contraste, fenêtre étroite).
>
> Statut : proposition de conception, **lecture seule sur le code** — aucun fichier
> de code n'a été modifié pour l'écrire. Chaque affirmation sur l'existant porte sa
> preuve `fichier:ligne` ; à défaut, elle est marquée **« à vérifier »**.
>
> Les arbitrages du propriétaire du 23/10 (`proposition-navigation.md` § 7) sont
> traités comme **fermes** : D1 (3 boutons nommés + un menu), D2 (Coffre dans
> Réglages), D3 (nom d'onglet fixe + moteur en sous-titre), D4 (panneau Travail au
> clic), D5 (fusion des Paramètres après les étapes 1 à 7). L'étape 1 (nommer les
> 14 boutons, commit `527ad30`) est **acquise** : elle n'est pas reproposée.
>
> **État réel aujourd'hui (vérifié sur le disque le 26/10/2026).** Ce document garde
> la **proposition d'origine** ; sur quatre points, ce qui a été livré en diffère.
> Le bloc du bas de la colonne porte **sept** lignes, et non six. Il n'y a **plus
> aucune ligne mise en évidence** : « Lancer l'agent » a **quitté le bloc**. Le menu
> « Autres écrans » compte **dix** entrées, et non neuf, « Lancer l'agent » étant sa
> **toute première** entrée. Le plafond de hauteur du bloc est à **60 %** de la
> hauteur de la fenêtre, et non 50 %. Pour l'état de référence, voir
> `spec_pilot.md` § C et, côté utilisateur, `help/overview.md`.

---

## 1. Ce qui manque au document de navigation

Le document de navigation est un document d'**organisation** : il répond à « quel
bouton, à quel endroit, derrière quelle porte ». Il ne fixe **aucune valeur
visuelle** — vérification faite sur ses 706 lignes : **zéro** occurrence du mot
« contraste » et **zéro** occurrence de « px ». Autrement dit, si on appliquait son
plan tel quel, on obtiendrait la bonne disposition avec les défauts de présentation
actuels intacts : trois systèmes de boutons différents dans la même colonne, cinq
tailles de texte qui se contredisent, deux grilles d'alignement concurrentes, et un
état clavier invisible.

Il manque donc, pour que le plan soit applicable sans négociation au moment de
coder : (1) une **échelle de texte** unique et les valeurs exactes de chaque zone ;
(2) une **règle d'états** écrite une seule fois (normal / survol / actif / désactivé
/ focus) au lieu d'être réinventée par composant ; (3) des **mesures de contraste**
dans les deux thèmes — le thème clair n'a jamais été vérifié, et il est en échec à
plusieurs endroits ; (4) un **comportement en fenêtre étroite**, aujourd'hui
inexistant (3 media queries dans 10 061 lignes de CSS, aucune ne concerne la colonne
de gauche ni la barre d'onglets : `src/css/style.css:7223`, `:8758`, `:9991`).

Enfin, trois points de **divergence** entre le plan et le code existant doivent être
signalés avant d'être appliqués — ils sont posés en § 7 comme questions fermées.

---

## 2. Cinq principes de présentation

Cinq maximum, chacun avec sa conséquence concrète à l'écran. Ils sont ordonnés : en
cas de conflit, le premier l'emporte.

### Principe 1 — Un seul cadre accentué par colonne : celui du projet

**Conséquence.** Le cadre bleu (`color-mix(accent 16%)` + bordure accent,
`src/css/style.css:509-511`) reste sur le bloc du bas, et **disparaît** de la rangée
d'icônes globales (`:506-517` aujourd'hui). Deux cadres identiques dans une colonne
de 280 px ne hiérarchisent rien : ils disent « ces deux blocs sont de même nature »,
ce qui est faux (l'un est le projet, l'autre est la maison). Après : un cadre, donc
un seul endroit « qui compte ».

### Principe 2 — Une action principale par zone, et une seule

**Conséquence.** Dans le bas de la colonne, **« Lancer l'agent »** est le seul
libellé à 13 px / 600 avec une icône colorée ; « Assistant », « Dossier du
projet », « Terminal », « Commandes du projet » et « Autres écrans » restent à
12 px / 400 en `--text-secondary`. Dans la rangée du
haut, les trois boutons sont **égaux** (aucune action principale : ce sont des
portes, pas des actions). Dans le panneau Travail, l'onglet actif est le seul à
porter un filet accent. Un écran = un point le plus fort, jamais deux.

### Principe 3 — Trois tailles de texte, pas sept

**Conséquence.** L'échelle devient **11 / 12 / 13 px** (plus 15 px pour le titre de
zone « nom du projet », seul texte au-dessus). Aujourd'hui la colonne de gauche en
utilise six : 9 px (`#agent-activity-badge`, `:1446`), 10 px (`.open-projects-label`,
`:1067`), 12 px (`.pj-tab` `:557`, `.pj-panel button` `:1350`), 13 px
(`.settings-tab` `:2709`), 14 px (icônes de boutons, `:1326`), 22 px
(`#btn-project-name`, `:794`). Concrètement : le nom du projet passe de **22 à
15 px**, le badge de **9 à 11 px**, les libellés de section de **10 à 11 px**.

### Principe 4 — Le texte porte le sens, l'icône le confirme

**Conséquence.** Aucun bouton **nommable** n'est icône seule, sauf « Fermer » dans
un en-tête de panneau. Cela vaut pour la rangée globale (7 icônes nues aujourd'hui,
`index.html:45-51`), pour les trois onglets du panneau Travail (12 px,
`style.css:4411`) et pour les deux boutons d'en-tête du panneau
(`index.html:119-120`), dont un est destructeur.

### Principe 5 — Le survol change le contraste, jamais le sens ; l'actif se lit à l'accent

**Conséquence.** Une seule règle d'états, écrite une fois :

| État | Rendu |
|---|---|
| normal | texte `--text-secondary`, fond transparent, bordure transparente |
| survol | texte `--text-primary`, fond `--surface-2`, bordure `--border-subtle` |
| actif (choisi / basculé) | texte `--text-primary`, fond accent 14 %, filet ou bordure accent, `aria-pressed` / `aria-selected` |
| pressé | `transform: scale(0.97)` (aujourd'hui `0.94`, un peu fort : `:1340`) |
| désactivé | opacité `.45`, `cursor: not-allowed` |
| focus clavier | `outline: 2px solid var(--accent); outline-offset: 1px` |

Aujourd'hui cette règle existe **une seule fois dans tout le projet** : c'est
`.agent-read-btn:focus-visible` (`:3920-3923`), soit 1 occurrence de
`:focus-visible` dans 10 061 lignes de CSS. Aucun bouton de la colonne de gauche,
aucun onglet, aucun onglet de Paramètres, aucune ligne de palette n'a de focus
visible → l'interface est inutilisable au clavier alors que tous les raccourcis
existent.

---

## 3. Écran par écran, zone par zone

Les valeurs sont données en pixels réels et en variables du projet (`--space-1..6` =
4/8/12/16/20/24, `--radius-sm/md/lg` = 6/8/12, `--font-xs/sm/base` = 11/12/13, lues
dans `:root`). Les preuves renvoient au fichier **actuel** (HEAD `96fd8f6`).

### 3.1 Le haut de la colonne de gauche — le projet

| Élément | Aujourd'hui (preuve) | Cible (valeur exacte) | Écart |
|---|---|---|---|
| Bande entière | 72 px de haut : logo 48 + `padding: 12px 8px 12px 12px` (`style.css:753-761`, `:786`) | **48 px** : logo 20 px, `padding: 8px 8px 8px 16px`, filet bas 1 px `--border-subtle` conservé | −24 px ; inset gauche 12 → **16 px** |
| Logo | `height: 48px` (`:786`) | `height: 20px`, `width: auto` | −28 px |
| Nom du projet | 22 px / 700, police `Avenir` en dur (`:791-800`) | **15 px / 600**, `var(--font-ui)`, `flex: 1`, ellipsis conservé | −7 px ; quitte la police en dur |
| Bouton « Projets » | Carré **48 × 48** (`:763-778`) ne contenant qu'un chevron de 16 px (`index.html:28-30`) ; le mot « Projets » n'existe que dans le `title` | Bouton **nommé** : hauteur **28 px**, `padding: 0 8px`, `gap: 6px`, libellé « **Projets** » **12 px / 600**, chevron 14 px | −20 px de haut ; un mot visible |
| États du bouton « Projets » | survol = fond `--surface-3` + bordure (`:780-783`) ; aucun état « ouvert », aucun focus | normal / survol / **ouvert** (fond accent 14 %, bordure accent 40 %, chevron retourné 180°) / focus (principe 5) | 2 états ajoutés |
| Ordre visuel | logo · nom · chevron (`index.html:26-30`) | logo · nom · « Projets ▾ » — inchangé | — |

**Pourquoi.** Le nom du projet est un **état**, pas une action : c'est le plus gros
texte de l'application alors que les boutons qui ouvrent le travail sont à 12 px.
Et la plus grande surface cliquable du haut (48 × 48) ne sert qu'à un chevron.

**Preuve d'alignement à corriger.** Trois insets différents cohabitent dans la même
colonne : **12 px** ici (`:754`), **16 px** dans la rangée globale (8 px de marge +
8 px de padding, `:508`/`:516`), **30 px** dans les lignes du bas (8 px de marge +
6 px de padding `:533` + 8 px de padding `.pj-panel` `:595` + 8 px de padding de
ligne `:1345`). Après le § 4.2 : **16 px partout**.

### 3.2 La rangée d'icônes globales — de 7 icônes à 3 boutons nommés

| Élément | Aujourd'hui (preuve) | Cible | Écart |
|---|---|---|---|
| Nombre de boutons | **7** icônes seules, `title` pour tout texte (`index.html:45-51`) | **3** : « Brouillon » (`file-text`), « Réglages » (`settings`), « Aide » (`circle-help`) | −4 boutons ; décidé § 4.4 du doc de navigation |
| Cadre | fond accent 16 % + bordure accent + radius 12 + `padding: 8px` + `flex-wrap` (`:506-517`) | **aucun cadre** : `padding: 0 8px 8px`, `gap: 4px`, `flex-wrap: wrap` conservé | cadre retiré (principe 1) |
| Format | 32 × 32, `padding: 0`, `font-size: 14px` pour l'icône (`:1316-1332`) | **pastille** : hauteur **28 px**, `padding: 0 8px`, `gap: 6px`, icône **16 px**, libellé **12 px / 500**, radius `--radius-sm` | −4 px ; +un libellé |
| Étiquette de section | aucune | aucune (les boutons sont assez explicites) | — |
| États | survol fond `--surface-2` + texte primaire (`:1333-1338`) ; pressé `scale(.94)` (`:1339-1340`) ; pas de focus | principe 5 ; « Réglages » et « Aide » portent `aria-pressed="true"` pendant que leur fenêtre est ouverte (fond accent 14 %) | focus + état « ouvert » |
| Badge distant | `#remote-badge` (`index.html:52`) : pastille `hidden` par défaut, icône 14 px + compteur | même famille visuelle que les 3 boutons : hauteur **28 px**, `padding: 0 8px`, bordure `--border-subtle`, fond `--surface-2`, texte « Distant » **11 px / 600** + compteur **11 px**, poussé à droite (`margin-left: auto`) | texte ajouté, hauteur alignée |
| Les 4 portes retirées | Coffre, Remarque, GDS admin, GDS compte (`index.html:47-50`) | dans **Réglages → Accès directs** (§ 3.7), **mêmes identifiants** (`btn-vault`, `btn-feedback`, `btn-gds-admin`, `btn-gds-params`), libellés repris **mot pour mot** des `title` actuels | D2 ; câblage `main.js:624-720` inchangé |

### 3.3 Le bas de la colonne de gauche — 3 boutons nommés + un menu

**État actuel mesuré.** `#project-footer` (cadre accent, `margin: 0 8px 8px`,
`padding: 6px`, `gap: 6px`, `max-height: 40%`, `overflow-y: auto` — `:519-534`)
contient 3 sous-onglets `.pj-tab` (`index.html:68-70`, 12 px / 600 en dur `:557`,
actif = fond accent 60 % `:573`) puis un seul panneau visible parmi 3
(`index.html:82`, `:90` ; bascule `src/js/sidebar.js:1608-1645`) totalisant **14
lignes** de 32 px (`index.html:75-94` ; hauteur `:1318-1319`, libellé 12 px `:1350`,
ellipsis `:1355`, `gap: 4px` `:594`, `padding: 8px` `:595`).

**Hauteur réellement demandée** : 8 + 8 (paddings panneau) + 6 × 32 + 5 × 4 (lignes)
+ 26 (rangée d'onglets) + 12 (paddings cadre) + 6 (gap) ≈ **272 px**. Plafonnée à
`40 %`, elle n'obtient que **200 px** à la hauteur minimale autorisée de la fenêtre
(**500 px**, `src-tauri/tauri.conf.json:48`) → ~72 px de contenu coupés, soit plus de
deux lignes inaccessibles sans défilement. *(Estimation arithmétique à partir des
valeurs CSS ; le rendu exact reste **à vérifier à l'écran**.)*

**Cible appliquée.** Les trois questions posées par cette section ont été
tranchées par le propriétaire (2026-10-25) : « Lancer l'agent » reste la
**première** ligne (Q1), « Dossier du projet » désigne l'action qui ouvre le
dossier du projet dans l'explorateur du système et remonte du menu avec
« Commandes du projet » (Q2), et le plafond du bloc passe de 40 % à 50 % (Q3).
Le bloc porte donc **SIX lignes**, chacune sur une ligne entière, libellés en
clair et jamais raccourcis.

```
┌ cadre accent (inchangé) ─────────────┐
│  Lancer l'agent                  32px │  13 px / 600, icône bot 16 px, icône --accent-text
│  Assistant                       32px │  12 px / 400, icône compass 16 px
│  Dossier du projet               32px │  12 px / 400, icône folder-open 16 px
│  Terminal                        32px │  12 px / 400, icône terminal
│  Commandes du projet             32px │  12 px / 400, icône square-terminal
│  Autres écrans ▾                 32px │  12 px / 400, icône more-horizontal, chevron
└──────────────────────────────────────┘
```

**Hauteur recomptée** (2 + 16 + 6 × 32 + 5 × 6 = **240 px**), et plafond porté à
**50 %** : à la hauteur minimale de fenêtre (500 px), 50 % = 250 px > 240 px, donc
aucune ligne n'est jamais dessinée hors du cadre.

| Élément | Aujourd'hui (preuve) | Cible | Écart |
|---|---|---|---|
| Sous-onglets | 3 `.pj-tab` + `role="tablist"` (`index.html:67-70`) | **supprimés** (étape 5, D1) ; `role="tablist"` disparaît avec eux | −26 px de haut |
| Lignes visibles | 6 au mieux, 4 ou 6 selon le sous-onglet | **6**, toujours les mêmes | 14 → 6 boutons (dont **2 remontés du menu**) |
| Hauteur de ligne | 32 px, `padding: 0 8px`, libellé 12 px (`:1345-1353`) | 32 px **conservé**, `padding: 0 8px`, libellé **12 px / 400** (13 px / 600 pour « Lancer l'agent ») | +1 taille pour la ligne principale |
| Fond des lignes | transparent, arrondi `--radius-sm` | transparent, **pleine largeur dans le cadre** (le cadre passe à `padding: 4px 0` + `overflow: hidden`, les fonds de survol touchent la bordure) | inset 30 → **16 px** |
| Hauteur totale du bloc | ≈ 272 px (plafond 200 px à 500 px de haut) | ≈ **240 px** (2 + 16 + 6 × 32 + 5 × 6 ; plafond **50 %** = 250 px à 500 px de haut) → **tient sans défilement** | −12 % |
| Ordre | Projet / Vues / Assistant, puis 6, 4 ou 4 | Lancer l'agent · Assistant · Dossier du projet · Terminal · Commandes du projet · Autres écrans (§ 4.3 du doc de navigation ; Q1 et Q2 du propriétaire) | ordre figé, plus de contexte caché |
| Menu « Autres écrans » | n'existe pas | Voir ci-dessous | nouveau |

**Repli au survol (LOT 1, appliqué).** Le bloc est **replié au repos** : une seule ligne visible (sa **dernière**, `⋯ Autres écrans` avec un projet, `⚙ Options` sans projet), mêmes libellé, icône et identifiant, **cadre à 50 px** (2 bordures + 2 × 8 padding + 1 ligne de 32). Le survol le déploie après **100 ms** (`--transition-fast`), le clavier (`Tab`) **immédiatement et sans animation** ; le repli n'a lieu que si la souris n'est plus dessus **et** le focus n'est plus dedans **et** le menu « Autres écrans » est fermé, après **300 ms** de sursis (`--transition-smooth`) puis **180 ms** d'animation (`--transition`). L'ancre est le **bas** du cadre (`justify-content: flex-end`) : la ligne du bas ne bouge jamais, les autres sont découvertes par la fente qui monte. Le rognage est porté par la seule règle d'état `#project-footer.pj-replie` (`overflow: clip`, jamais `hidden` : un `hidden` défile au focus) ; `overflow: visible` reste dans la règle de base, `.pj-panel` porte `flex: 0 0 auto`, la colonne reste à 280 px. Aucun nœud n'est ajouté ni retiré, aucun réglage, aucun bouton. Le **seul** ajout est l'**infobulle enrichie** de la ligne d'ancrage : son `title` est passé de « Autres écrans » à un texte qui **nomme les six autres lignes** du bloc (Q2 du propriétaire : libellé inchangé, aucun bouton, aucun réglage). Voir `RAPPORT-conception-repli-menus-bas.md`.

**Le menu « Autres écrans » (présentation).**

| Point | Valeur |
|---|---|
| Déclencheur | ligne de 32 px, `aria-expanded`, `aria-controls`, `aria-haspopup="menu"` |
| Sens d'ouverture | **vers le haut** : `bottom: calc(100% + 4px)`, `left: 0` (le bloc est en bas de colonne) |
| Panneau | largeur = largeur du cadre (≈ 236 px), `max-height: 60vh`, `overflow-y: auto`, fond `--surface-2`, bordure `--border`, radius `--radius-md`, ombre `--shadow-lg`, `padding: 4px 0` |
| En-tête de groupe | **11 px / 600**, majuscules, `letter-spacing: .04em`, `color: var(--text-secondary)` (jamais `--text-muted`, cf. § 4.4), `padding: 8px 8px 4px` |
| Ligne | hauteur **28 px**, `padding: 0 8px`, `gap: 8px`, icône **14 px** `--text-secondary`, libellé **12 px** `--text-primary` |
| Survol | fond `--surface-3` (le panneau est déjà en `--surface-2`), texte inchangé |
| Groupes et libellés | **mot pour mot** ceux de `proposition-navigation.md` § 4.3, **moins les deux lignes remontées dans le bloc** : *Mon projet* — Prompt Builder ; *Comprendre* — Tableau de bord · Graphe du projet · Historique des sessions ; *Vérifier* — Revue de code (diff Git) ; *Collaborer* — Équipe d'agents · Discussion inter-projets ; *Sources* — GDS du projet (9 entrées ; les groupes ne sont pas fusionnés) |
| Icônes | celles du code, réutilisées telles quelles : dans le bloc `bot`, `compass`, `folder-open`, `terminal`, `square-terminal`, `more-horizontal` ; au menu `puzzle`, `gauge`, `network`, `history`, `search-check`, `users`, `columns-3`, `link`, `database` (`index.html`) |
| Fermeture | `Échap`, clic extérieur, ou sélection d'une ligne |

**Ce que l'étape 1 (`527ad30`) a laissé — critique mesurée, pas reproposée.**

- Deux libellés se chevauchent : « Terminal » (`index.html:76`) et « Agent /
  Terminal » (`:77`). Les libellés ont rendu visible une duplication que les icônes
  masquaient ; c'est exactement P5, et l'étape 5 la supprime.
- Le mot « Assistant » apparaît **trois fois sur le même écran** : sous-onglet
  (`:70`), ligne du panneau (`:92`), onglet des Paramètres (`:293`).
- L'ellipsis (`.pj-btn-label`, `:1355`) existe mais ne mord pas aujourd'hui : à
  12 px, « Discussion inter-projets » (24 caractères) tient dans les ~196 px utiles
  *(estimation ; **à vérifier à l'écran**)*.

### 3.4 La bande de contexte et la barre d'onglets

**État actuel.** `#tab-bar` : `min-height: 36px`, `padding: 4px 6px`, `gap: 2px`
(`:1363-1374`) ; `.tab` : hauteur 28 px, `padding: 0 12px`, `gap: 6px`, 12 px
(`:1690-1708`), actif = `inset 2px` accent (contour complet) ; `.tab-name` limité à
160 px + ellipsis (`:1839`) ; fermeture `.tab-close` (`tabs.js:3021`). Le libellé
d'un onglet cumule **trois canaux** pour une seule information : un emoji en
préfixe (π, 🧭, 📜, 📕, 🖼️, 📊), un suffixe entre parenthèses ajouté au nom
(« (RPC) », « (PDF) », « (aperçu) », « (Sessions) », « (Prompt) », « (Brouillon) »,
« (image) », « (CSV) », `tabs.js:3017-3018`), et le mode. Aucun fil d'Ariane :
**0 occurrence** de « breadcrumb » ou « fil d'Ariane » dans `index.html`,
`src/js/*.js` et `src/css/style.css` (recherche effectuée).

**Réservation d'espace manquante.** Le cercle d'activité est `position: fixed;
top: 8px; right: 12px` (`:1383-1387`), soit y = 8 à 22 px — **dans** la bande
verticale des onglets (y = 4 à 32 px), et `#tab-bar` n'a **aucun `padding-right`**
de réservation (`:1363-1372`). Avec assez d'onglets ouverts, le dernier passe sous
le cercle : le seul point d'entrée du panneau Travail masque un onglet.

| Élément | Aujourd'hui (preuve) | Cible | Écart |
|---|---|---|---|
| Bande de contexte | inexistante | **`#context-bar`**, hauteur **26 px**, `padding: 0 8px 0 16px`, **11 px**, `--text-secondary`, filet bas `--border-subtle` | +26 px, remplace le vide au-dessus des onglets |
| Contenu | — | `Projet › <nom du projet> › <nom de l'onglet actif>` ; 1<sup>er</sup> segment cliquable (ouvre le menu « Projets ») ; dernier segment **11 px / 600** `--text-primary` ; séparateurs `›` en `--text-muted` (décoratifs, donc autorisés) | étape 9, élargie |
| Bouton Travail | cercle flottant 14 px (`:1414-1427`), `title="Suivi du travail"` (`index.html:110`) | **bouton nommé dans la bande de contexte, à droite** — voir § 3.5 | plus aucun chevauchement |
| Hauteur d'onglet | 28 px, `padding: 0 12px` (`:1690-1705`) | 28 px **conservé**, `padding: 0 8px 0 10px`, `gap: 6px` | −4 px de padding |
| Nom d'onglet | 12 px, `max-width: 160px` (`:1839`) | 12 px / **500** (600 si actif), `max-width: **180px**` | +20 px utiles |
| Onglet actif | contour complet `inset 2px` accent (`:1708`) | **filet bas 2 px** accent dans l'onglet | le contour redevient disponible pour le focus clavier |
| Suffixes | 8 suffixes entre parenthèses (`tabs.js:3017-3018`) | **supprimés** quand l'icône le dit déjà : « (RPC) », « (PDF) », « (aperçu) », « (image) », « (CSV) », « (Brouillon) » ; **conservés** « (Sessions) » et « (Prompt) » (deux fichiers homonymes) | 8 → 2 |
| Emoji de préfixe | π 🧭 📜 🧩 🖥️ ▶ 👁️ 📕 🖼️ 📊 | **lot séparé, non bloquant** : icônes Lucide 14 px (`file-text`, `compass`, `scroll-text`, `puzzle`, `square-terminal`, `square-play`, `eye`, `file-type`, `image`, `table`) — les emojis sont les seuls restants du mobilier alors que le projet a remplacé les siens par Lucide (`src/js/icons.js`) | cohérence de taille et de couleur |
| Focus | absent | `outline: 2px solid var(--accent); outline-offset: -2px` sur `.tab:focus-visible` | +1 règle |

**Vérifié :** aucune chaîne « (aperçu) », « (RPC) », « (Sessions) », « (Prompt) »,
« (Brouillon) » n'est verrouillée par un test (recherche dans `src/js/*.test.js` et
`scripts/*.test.js` : 0 résultat).

### 3.5 Le panneau « Travail »

| Élément | Aujourd'hui (preuve) | Cible | Écart |
|---|---|---|---|
| Entrée | pastille 14 × 14, `--text-secondary`, opacité `.6` (`:1414-1427`), animation `breathing` (`:1428`), classe `agent-unread` (`:1455`) | **bouton nommé** dans la bande de contexte : hauteur **22 px**, `padding: 0 8px`, `gap: 6px`, **11 px / 600** ; **pastille 8 px à gauche** qui conserve la respiration et la couleur d'état ; compteur **11 px** si > 0 | la seule zone cliquable devient lisible ; D4 (clic) conservé |
| États de l'entrée | survol = `opacity: 1` (`:1427`) uniquement | repos (`--text-secondary`, pastille `--text-muted`) · survol (`--surface-2`, texte `--text-primary`) · **ouvert** (fond accent 14 %, bordure accent 40 %, pastille `--accent`) · jamais désactivé | 3 états lisibles |
| Position | `fixed; top: 8px; right: 12px` (`:1383-1387`), **chevauche la barre d'onglets** | dans `#context-bar` (flux normal), aligné à droite | fin du chevauchement |
| Panneau | `min-width: 320px`, idéal `34vw`, max `360px`, hauteur max `60vh`, alpha 94 % (variables `:1407-1412`) | `min-width: 320px` **conservé** (verrou de lisibilité), idéal `34vw`, **max `380px`**, hauteur `min(60vh, 520px)`, **alpha 94 % conservé** | +20 px de large ; variables verrouillées respectées |
| Rayon | `--radius-sm` (6 px), seul élément arrondi à 6 px à côté de cadres à 12 px | **`--radius-lg` (12 px)**, comme les cadres de la colonne | cohérence de rayon |
| En-tête | `.sa-events-header` `padding: 8px 10px` (`:4313-4321`), **sans titre** : le panneau ne s'annonce que par ses onglets | hauteur **32 px**, `padding: 0 8px 0 12px` : titre « **Travail** » **12 px / 600** à gauche, les 3 onglets au centre, **un seul** bouton × à droite | 1 titre ; 2 → 1 bouton à droite |
| Onglets | `.sa-events-tab` `padding: 3px 8px`, 12 px / 600, actif = fond `--bg-input` + texte primaire (`:4411-4440`) | hauteur **24 px**, `padding: 0 10px`, **12 px / 500** ; actif = texte `--text-primary` + **filet bas 2 px** accent + `aria-selected` | cible de clic +4 px, actif plus net |
| Ordre des onglets | **Agents · Tâches · Événements**, déclaré « ORDRE DÉFINITIF » (`index.html:102-108`), verrouillé par `src/js/panneau-suivi-trois-onglets.test.js:213` et `:257` | **inchangé** | — |
| « Tout effacer » | icône poubelle 14 px collée à l'icône ×, à 6 px (`index.html:118-120`, `.sa-events-header-actions`) | **quitte l'en-tête** : bouton **texte** « Tout effacer » **11 px**, `--text-secondary`, en **pied** du seul onglet Événements, aligné à droite, `padding: 6px 12px`, filet haut `--border-subtle`, survol `--danger` ; visible seulement si la liste n'est pas vide (comportement `hidden` conservé) | P12 : distance + un mot au lieu d'une icône |

### 3.6 La zone de travail — les deux conversations

C'est le deuxième écran à ne pas confondre (P2). Aujourd'hui, les deux barres
d'outils sont **le même composant** : `.agent-chat-toolbar` (`agent-pi.js:360`) et
`.agent-chat-toolbar superagent-toolbar` (`super-agent.js:2702-2703`), boutons
icône-seule de 14 px (`:3827`), différenciés par leur seul `title` — plus une
bordure violette côté assistant. Le nom de la porte n'apparaît **nulle part** dans
la conversation.

| Élément | Aujourd'hui (preuve) | Cible | Écart |
|---|---|---|---|
| Identification | aucune dans la conversation ; seul l'onglet nomme l'écran ; l'assistant garde en plus un **panneau de suivi masqué** (`super-agent.js:3581-3591`, bouton `data-action="tracking"`) | **bandeau d'identification 28 px** au-dessus de la barre d'outils : filet vertical **4 px** à gauche dans la couleur de la porte (`--accent` pour l'agent, `--superagent-accent` pour l'assistant), titre **13 px / 600**, sous-titre **11 px** `--text-secondary` aligné à droite | D3 satisfait sans toucher la barre d'onglets |
| Titre | — | Agent : « **Conversation avec l'agent** » ; Assistant : « **Assistant** » | nom fixe |
| Sous-titre | — | Agent : « **Agent Pi** » ou « **Agent PLh** » — valeur déjà calculée par `agentDisplayLabel()` (`src/js/backend-info.js:69`), donc **aucune nouvelle source** ; Assistant : « **suivi multi-projets** » (ou le nom configuré) | même texte qu'en barre d'état (`tabs.js:2345-2351`) |
| Barre d'outils | 10 boutons icône-seule, `padding: 6px 10px`, 14 px (`agent-pi.js:361-378`) | hauteur **36 px** ; boutons **26 × 26**, `padding: 0 6px`, radius `--radius-sm` ; 3 groupes séparés par un filet vertical 1 px `--border-subtle` de 16 px de haut, `gap: 8px` : *(session)* · *(écrans)* · *(modèle + état)* | les actions de session ne sont plus mélangées aux écrans |
| États | survol seul, via `.agent-btn` | principe 5 ; les 4 bascules (orchestration, quality-gate, contexte, mémoire) portent `aria-pressed="true"` + fond accent 16 % + bordure accent 50 % | 4 états basculés lisibles |
| Panneau de suivi masqué | présent (`super-agent.js:3581-3591`) | **supprimé** (étape 7) : la vue de suivi n'existe qu'en un lieu | −1 bouton, −1 vue |

**Note de fidélité au plan.** Le document de navigation décrit le panneau Travail
avec **quatre** onglets, dont « Projet » pour le tableau de bord (§ 4.6). Le code
actuel en a **trois**, déclarés « ordre définitif » et verrouillés par un test. Cette
divergence n'est pas tranchée ici : elle est la question 2 du § 7.

### 3.7 Les Paramètres

| Élément | Aujourd'hui (preuve) | Cible | Écart |
|---|---|---|---|
| Fenêtre | `.settings-content` 920 px (`:2545`) | 920 px **conservé**, `max-width: 92vw` | — |
| En-tête | `h2` seul (`index.html:278`, `:2586`) | `h2` « Réglages » **15 px / 600** + sous-titre **11 px** `--text-secondary` (« Tout ce qui se règle dans Pilot »), bande **48 px**, filet bas | 1 texte d'aide |
| Accès directs | inexistants | sous l'en-tête : rangée de **4 boutons nommés**, hauteur **30 px**, icône 14 px + libellé **12 px / 500**, `gap: 8px`, dans une carte `--surface-2` + `--border-subtle` + radius `--radius-md`, `padding: 8px 12px` ; libellés **mot pour mot** : « Coffre fort », « Envoyer une remarque », « Serveur GDS », « GDS mon compte » (`index.html:47-50`) ; **identifiants inchangés** | D2 ; `main.js:624-720` continue de fonctionner tel quel |
| Navigation | 184 px de large (`:2696`), 11 onglets (`index.html:283-293`), `padding: 8px 12px`, **13 px** (`:2698-2712`) | **200 px** de large ; onglets hauteur **32 px**, 13 px conservé ; 4 **en-têtes de groupe** **11 px / 600** majuscules `--text-secondary`, `padding: 12px 12px 4px` : *Pilot* (Général, Avatar) · *IA* (Agent Pi, Modèles IA, Fournisseurs, RAG, Graphe) · *Connexions* (Accès distant, Serveurs MCP, Service Laya) · *Suivi* (Assistant) | regroupement **visuel** seulement : aucun onglet renommé, aucun `data-settings-tab` modifié, aucun contenu déplacé (la fusion reste l'étape 8, D5) |
| État d'onglet | survol fond `--bg-hover` (`:2713-2716`), actif à vérifier | principe 5 + **filet gauche 2 px** accent sur l'actif + `aria-selected` | actif repérable sans couleur de texte seule |
| Boutons d'action | `Enregistrer` puis `Annuler` (`index.html:1270-1271`) ; le **premier enfant** reçoit l'accent (`:2659-2663`), donc l'action primaire est à **gauche** | ordre **`Annuler` · `Enregistrer`**, primaire à **droite** ; `Annuler` en `--text-secondary` sur `--bg-input`, `Enregistrer` avec le couple `--accent-solid` / `--accent-fg` du § 4.4 | convention : annuler à gauche, valider à droite ; **piège** : la règle `:first-child` doit être retirée en même temps, sinon l'accent passe sur « Annuler » |

### 3.8 La palette de commandes

| Élément | Aujourd'hui (preuve) | Cible | Écart |
|---|---|---|---|
| Bloc | 480 × 360 px, `padding-top: 120px` (`:5632` et suivantes) | **560 × 420 px**, `padding-top: 88px` | +80 px, plus haut |
| Couleur de repli | `var(--text, #d4d4d4)` en dur → **1,31:1 en thème clair** (mesuré, § 4.4) | `var(--text-primary)` / `var(--text-secondary)` : **aucune couleur en dur** | lisibilité en thème clair |
| Champ de saisie | `padding: 12px 16px`, **14 px** | 14 px conservé, même padding, placeholder « **Nom d'un écran ou d'une commande…** », filet bas `--border-subtle` | annonce ce qu'on peut taper (P8) |
| Ligne | `padding: 8px 16px`, **13 px**, survol = fond accent + **`#fff`** (`:5632`+) | hauteur **30 px**, `padding: 0 12px`, `gap: 10px`, radius `--radius-sm` : colonne d'icône **fixe 18 px** (icône 14 px `--text-secondary`) + libellé **13 px** `--text-primary` + **étiquette de catégorie** **11 px** `--text-secondary` (`Projet` · `Travail` · `Réglages` · `Édition`) + raccourci `.palette-key` | libellés alignés (aujourd'hui : aucun icône, donc aucun alignement possible) |
| Survol / sélection | fond accent plein + texte blanc | fond accent **18 %** + **filet gauche 2 px** accent, **texte inchangé** `--text-primary` | contrastes 11,11 (sombre) / 12,06 (clair) au lieu de 3,08 / 4,28 |
| En-têtes de catégorie | aucun | **11 px / 600** majuscules `--text-secondary`, `padding: 8px 12px 4px`, non focalisables | on trouve par groupe, pas en défilant |
| Ligne indisponible | aucune notion | opacité `.45`, étiquette **11 px** « aucun projet ouvert », `aria-disabled="true"`, non focalisable | ne jamais laisser une commande muette |
| Pied | aucun | ligne **24 px**, **11 px** `--text-secondary`, à droite : « Échap pour fermer · ↑ ↓ pour choisir » | sortie toujours visible |

---

## 4. Cohérence visuelle

### 4.1 Les tailles de texte — trois tailles, pas sept

| Rôle | Taille | Graisse | Usage |
|---|---|---|---|
| Repère secondaire | **11 px** | 400 / 600 | bande de contexte, en-têtes de groupe, sous-titres, étiquettes de catégorie, badges, pieds de panneau, barre d'état |
| Libellé d'action | **12 px** | 400 / 500 (600 si action principale) | tous les boutons nommés, tous les onglets, lignes de menu, lignes de palette |
| Titre de zone | **13 px** | 600 | titre de conversation, titre de fenêtre, titre de panneau |
| Titre de la colonne | **15 px** | 600 | nom du projet (seul texte au-dessus de 13 px) |

À supprimer : **9 px** (`:1446`), **10 px** (`.open-projects-label` `:1067`,
`.dropdown-label`), **22 px** (`:794`), et les **14 px** d'icônes de boutons
(`:1326`) ramenés à **16 px** (icônes) — les icônes ne sont plus confondues avec du
texte. Les valeurs en dur `12px` / `13px` qui doublonnent des variables existantes
(`:557`, `:1350`, `:2709`) sont remplacées par `var(--font-sm)` / `var(--font-base)`.

### 4.2 Les espacements et les alignements — une seule grille

| Repère | Valeur | Où |
|---|---|---|
| Bord du cadre accentué | **8 px** du bord de la colonne | `margin: 0 8px` (déjà) |
| **Inset des contenus** | **16 px** | *toute* ligne, tout bouton, tout libellé de la colonne |
| Rythme vertical | **4 / 8 / 12 px** | interlignes de lignes, paddings de bloc |
| Hauteurs de ligne | **22 px** (entrée Travail) · **28 px** (bouton secondaire, onglet, ligne de menu) · **32 px** (bouton principal, en-tête de panneau) · **36 px** (barre d'outils, barre d'onglets) | — |
| Rayons | **6 px** (`--radius-sm`) lignes et boutons · **12 px** (`--radius-lg`) cadres et panneaux | — |
| Filets | **1 px** `--border-subtle` ; filets d'état **2 px** accent (onglet actif, ligne sélectionnée) | — |

Les trois insets actuels (**12 / 16 / 30 px**) sont remplacés par un seul. Le seul
changement structurel : `#project-footer` passe à `padding: 4px 0` +
`overflow: hidden`, et `#project-selector` à `padding-left: 16px` (`:754`) — deux
valeurs, pas une refonte. Les menus flottants (`.projects-dropdown`, menu « Autres
écrans ») sont **hors grille** : ce sont des superpositions, leur inset interne est
de 8 px.

### 4.3 Les libellés — verbe + objet, ou nom d'écran

| Règle | Exemple conforme | Exemple non conforme aujourd'hui |
|---|---|---|
| Une **action** = verbe + objet | « Ouvrir le dossier », « Lancer l'agent », « Tout effacer » | « Agent / Terminal » (`index.html:77`) : deux fonctions, aucun verbe |
| Un **écran** = son nom, sans verbe | « Tableau de bord », « Graphe du projet », « Revue de code » | « Kanban » (mot seul, jargon) |
| Une **porte** = son nom, sans complément | « Projets », « Travail », « Réglages », « Aide » | — |
| Casse | phrase (majuscule initiale, pas de point final) ; majuscules conservées pour les noms propres (GDS, MCP, Pi, PLh) | cohérent après l'étape 1 : rien à corriger |
| Un mot = un sens | « Assistant » = l'agent de suivi, partout | trois « Assistant » sur un écran (§ 3.3) ; « agent » désigne aussi l'agent de codage |

Renommages portés par la présentation (les autres sont ceux du doc de navigation) :
« Agent / Terminal » → « **Lancer l'agent** » ; onglet « Agent Pi (RPC) » →
« **Conversation avec l'agent** » (moteur en sous-titre) ; « **Tout effacer** »
passe d'icône à mot.

### 4.4 Le contraste — mesuré, thème sombre et thème clair

Méthode : luminance relative WCAG 2.1, calculée localement sur les couleurs du
fichier CSS, sur fonds **opaques** (le panneau Travail est translucide à 94 % et
n'a **pas** été mesuré — *à vérifier*). Seuil visé : **4,5:1** pour du texte,
**3:1** pour un repère non textuel.

| Couleur | Sur | Sombre | Clair | Verdict |
|---|---|---|---|---|
| `--text-primary` (#e6e8ee / #1a1d24) | fond app | **15,42** | **13,77** | conforme |
| `--text-secondary` (#a0a6b4 / #5a6170) | fond app / `--surface-3` | **7,75** / 6,60 | **5,70** / 5,07 | conforme — **c'est la seule couleur de texte secondaire autorisée** |
| `--text-muted` (#6b7280 / #8a91a0) | fond app | **3,91** | **2,90** | **échec** dans les deux thèmes → réservé au **décor** (séparateurs, filets), jamais à un texte |
| `.pj-tab.active` (blanc sur accent 60 %) | fond du cadre | **5,85** | **6,96** (texte primaire, `:581-583`) | conforme — rien à changer |
| Texte **blanc** sur `--accent` plein | bouton primaire `.modal-actions button:first-child` (`:2659-2663`) | **3,08** | **4,28** | **échec** : c'est le bouton « Enregistrer » de toutes les fenêtres |
| `--accent` en **texte** (`.tab-special`) | fond app | 6,14 | **3,92** | échec en clair → utiliser `--accent-text` |
| `var(--text, #d4d4d4)` | palette | 10,87 | **1,31** | **échec grave** en clair (couleur en dur) |
| Ligne de palette survolée (blanc sur accent) | accent plein | **3,08** | **4,28** | **échec** → texte inchangé + fond accent 18 % (11,11 / 12,06) |

Deux jetons à ajouter (noms proposés, définis dans les deux thèmes) :

| Jeton | Sombre | Clair | Usage |
|---|---|---|---|
| `--accent-text` | `#7d97ff` (**6,97** sur fond app, 5,30 sur `--surface-2`) | `#3b57d6` (**5,47**, 4,87 sur `--surface-3`) | accent **en texte** : onglets spéciaux, libellé principal, icône mise en avant |
| `--accent-solid` + `--accent-fg` | `--accent` #6b8cff + encre `#0b0d12` (**6,31**) | `#3b57d6` + `#ffffff` (**5,97**) | bouton **plein** accentué (valider, primaire d'une fenêtre) |

Règle de sûreté, plus simple à tenir que les calculs : **aucun texte blanc sur
l'accent**, **aucun `--text-muted` sur du texte**, **aucune couleur en dur**
(le `#d4d4d4` de la palette est le seul du lot). Le test existant
`src/js/contraste-evenements-sombre.test.js` couvre le panneau Travail : les jetons
qu'il verrouille ne sont pas modifiés par ce document.

### 4.5 La fenêtre étroite

Faits : la fenêtre ne descend pas sous **800 × 500** (`tauri.conf.json:47-48`), le
défaut est 1280 × 860 ; la colonne de gauche est fixée à **280 px** (`:483`) et sa
largeur est mémorisée (`src-tauri/src/lib.rs:410-411`, défaut 280 `:983` et `:1123`,
écriture `:2683`) ; **aucune** des 3 media queries existantes ne concerne la colonne
ou la barre d'onglets (`:7223` = 900 px pour `.agent-form-cols`, `:8758` = 1200 px
pour le tableau de bord, `:9991` = 700 px).

| Largeur | Colonne de gauche | Zone de travail | Fenêtres |
|---|---|---|---|
| ≥ 1200 px | 280 px, inchangé | inchangé | Paramètres 920 px, palette 560 px |
| 1000–1199 px | 280 px (35 % → 24 %) | inchangé | palette `min(560px, 90vw)` |
| 800–999 px (**minimum autorisé**) | 280 px ; libellés de ligne **ellipsis** autorisé ; hauteur du bloc du bas plafonnée à `min(46%, 320px)` | `.tab-name` max 180 → **110 px** ; bande de contexte : segments intermédiaires masqués, il reste `Projet › onglet` | Paramètres `92vw` ; navigation 200 → **168 px** ; palette `94vw` ; panneau Travail `min(380px, 92vw)` |

Aucun **repli automatique** de la colonne n'est proposé ici : ce serait un
comportement nouveau, donc une fonctionnalité, pas une présentation (question 3 du
§ 7).

---

## 5. Rattachement au plan

| Présentation (ce document) | Gêne traitée | Étape du doc de navigation | Nature |
|---|---|---|---|
| Échelle de texte, grille d'alignement, règle d'états, focus, jetons de contraste | **transverse** (rend P4, P12 et le clavier utilisables) | **étape 0 — nouvelle** | à faire **avant** tout le reste : les étapes 4 à 9 s'appuient dessus |
| § 3.1 haut de colonne (nom 15 px, « Projets ▾ » nommé, bande 48 px) | P4 (partie) | **étape 6** | présentation de l'étape 6 |
| § 3.2 rangée globale 7 → 3 nommés, cadre retiré, Accès directs | P4 | **étape 6** | présentation de l'étape 6 |
| § 3.3 bas de colonne : 5 + menu, 6 lignes, 272 → 240 px | **P1, P5, P6** | **étape 5** (+ étape 3 pour les libellés) | présentation de l'étape 5 |
| § 3.4 bande de contexte + barre d'onglets (suffixes, actif, focus) | **P9**, P2 (partie) | **étape 9**, élargie : la bande porte aussi l'entrée **Travail** | l'étape 9 absorbe le déplacement du cercle flottant |
| § 3.5 panneau Travail (bouton nommé, titre, 1 bouton à droite, « Tout effacer » en pied) | **P3, P12** | **étapes 7 et 10** | présentation des étapes 7 et 10 |
| § 3.6 conversations (bandeau d'identification, groupes de la barre d'outils) | **P2, P6** | **étape 3** (D3), étape 7 (panneau masqué) | présentation de D3 |
| § 3.7 Paramètres (en-tête, Accès directs, 4 groupes visuels, ordre des actions) | **P7**, D2 | **étape 6** (Accès directs) ; **étape 8** seulement pour la fusion (D5) | préparation de l'étape 8 **sans** la faire |
| § 3.8 palette (taille, icônes, catégories, survol lisible) | **P8** | **étape 4** | présentation de l'étape 4 |
| § 4.5 fenêtre étroite | — (nouveau) | **3<sup>e</sup> étape supplémentaire** : réglages de largeur et de troncature | petite, indépendante, peut passer en dernier |

Deux étapes supplémentaires sont donc proposées, et **deux seulement** :

- **Étape 0 — socle de présentation** (jetons, échelle, états, focus, contrastes) :
  sans elle, chaque étape réinvente ses valeurs et le résultat divergera.
- **Étape 11 — fenêtre étroite** (media queries de largeur et de troncature) :
  reportable sans risque, mais à ne pas oublier, car rien n'existe aujourd'hui.

L'**étape 9 est élargie** : elle porte le fil d'Ariane **et** l'entrée « Travail »
nommée (au lieu de laisser un cercle flottant au-dessus des onglets). Cela ne
contredit aucune décision : D4 fixe que le panneau s'ouvre au clic, pas que son
entrée reste un cercle.

---

## 6. Découpage en lots livrables seuls

Sept lots, chacun visible **en entier** dès qu'il est livré, et chacun arrêtable
sans laisser l'interface à moitié présentée. L'ordre est l'ordre de livraison.

**Ce qui ne doit pas changer, dans tous les lots** — à recopier dans chaque
demande de travail :

1. Les **identifiants** des boutons (`btn-terminal`, `btn-terminal-cmd`,
   `btn-superagent`, `btn-superkanban`, `btn-vault`, `btn-feedback`, `btn-gds-admin`,
   `btn-gds-params`, `btn-explorer`, `btn-dashboard`, `btn-agents`…) : le câblage
   `main.js` et les tests s'y accrochent.
2. Les **22 modes d'onglet** et leurs `mode` de routage (`src/js/tabs.js:288-390`).
3. L'**ordre de la barre d'onglets** (🧭 premier, 📊 verrouillé — `tabs.js:3054-3074`)
   et l'**ordre des 3 onglets du panneau** (Agents, Tâches, Événements,
   `index.html:102-108`, test `panneau-suivi-trois-onglets.test.js:213`).
4. Les **variables de dimensions du panneau Travail** (`style.css:1407-1412`,
   test `taille-et-style-panneau.test.js:179-180`) et les **jetons de contraste**
   verrouillés par `contraste-evenements-sombre.test.js`.
5. **Aucune** modification de `docs/proposition-navigation.md`.

### Lot 1 — Socle (étape 0)

- **Résultat visible** : l'application n'a pas bougé d'un pixel de disposition, mais
  tous les boutons réagissent de la même façon au survol, à l'appui, au clavier ;
  le bouton « Enregistrer » de chaque fenêtre est lisible dans les deux thèmes.
- **Contenu** : jetons `--accent-text`, `--accent-solid`, `--accent-fg` ; échelle
  11/12/13/15 ; règle d'états écrite une fois (classes partagées) ; `:focus-visible`
  global ; `--text-muted` interdit sur du texte ; `#d4d4d4` de la palette remplacé.
- **Ne doit pas changer** : tout le reste (aucun déplacement).
- **Vérification** : `npm test` (dont `contraste-evenements-sombre.test.js`),
  `cargo test --manifest-path src-tauri/Cargo.toml --lib` inutile ici.

### Lot 2 — Le haut de la colonne (étape 6, partie haute)

- **Résultat visible** : bande de 48 px au lieu de 72, nom du projet à 15 px,
  bouton « Projets ▾ » nommé, **3 boutons nommés** au lieu de 7 icônes, cadre bleu
  retiré du haut. Le badge « Distant » prend sa place à droite.
- **Ne doit pas changer** : `btn-scratchpad`, `btn-settings`, `btn-help` conservés ;
  les 4 autres boutons **n'existent plus** en haut et vivent dans Réglages (lot 7).
  Le menu « Projets » (`#projects-dropdown`) garde ses 4 entrées.

### Lot 3 — Le bas de la colonne (étapes 3 et 5)

- **Résultat visible** : 3 sous-onglets et 14 lignes remplacés par **6 lignes** de
  32 px — « Lancer l'agent » en évidence, puis Assistant, Dossier du projet,
  Terminal, Commandes du projet et « Autres écrans ▾ » ; le bloc passe de
  ~272 px à **~240 px** (plafond 50 %) et tient à 500 px de haut.
- **Ne doit pas changer** : les 14 identifiants et leurs fonctions ; le cadre accent
  (il reste le seul) ; le déclenchement de chaque écran.
- **Ordre de livraison interne** : d'abord le menu (les entrées qui ne sont pas des
  accès directs y déménagent), ensuite la suppression des sous-onglets — jamais
  l'inverse.

### Lot 4 — La bande de contexte et l'entrée Travail (étape 9 élargie)

- **Résultat visible** : une bande de 26 px en haut de la zone de travail
  (`Projet › <projet> › <onglet>`), et à sa droite un bouton « **Travail** » nommé
  qui remplace le cercle flottant. Plus aucun chevauchement avec les onglets.
- **Ne doit pas changer** : `#agent-activity-dot` et `#agent-activity-badge`
  conservés comme **contenu** du bouton (identifiants et `aria-*` inchangés) ; la
  respiration et la mémoire de l'onglet actif du panneau sont conservées ; D4 (clic).
- **Dépend de** : lot 2 (la bande s'aligne sur le nouvel en-tête).

### Lot 5 — Le panneau Travail (étapes 7 et 10)

- **Résultat visible** : panneau avec un titre, un seul bouton à droite, des onglets
  de 24 px à filet bas, et « Tout effacer » en mot, en pied de l'onglet Événements.
- **Ne doit pas changer** : les 3 variables de largeur/hauteur, l'alpha 94 %, les
  3 identifiants d'onglet, les 3 `aria-controls` / `tabpanel`, le gabarit de ligne
  partagé (`.sa-events-list, .sa-tasks-list, #agent-activity-list`, `:4346-4356`).

### Lot 6 — La palette (étape 4)

- **Résultat visible** : palette plus large et plus haute, lignes de 30 px avec
  icône alignée + catégorie, survol lisible dans les deux thèmes, pied de sortie,
  lignes indisponibles grisées et expliquées.
- **Ne doit pas changer** : `Ctrl+Shift+P` (`Ctrl+K` reste le lien Markdown,
  `main.js:53`), les 19 commandes d'édition existantes, le comportement de la
  capture clavier de la palette.

### Lot 7 — Les Paramètres (étape 6, partie basse)

- **Résultat visible** : rangée « Accès directs » à 4 boutons nommés sous le titre,
  navigation en 4 groupes visuels, `Annuler` à gauche / `Enregistrer` à droite.
- **Ne doit pas changer** : les 11 `data-settings-tab` et leurs libellés, l'ouverture
  ciblée depuis les boutons 🔊 ou 🧭 (`settings.js:2495`), le câblage des 4 boutons
  déplacés, la règle `.modal-actions button:first-child` **doit** être neutralisée en
  même temps que l'ordre change (sinon « Annuler » devient primaire).
- **Dépend de** : lot 1 (jetons de contraste).

**Lots explicitement non bloquants** : emoji → Lucide dans la barre d'onglets (§ 3.4)
et fenêtre étroite (§ 4.5). Aucun des deux ne bloque la livraison des autres.

---

## 7. Ce que je ne peux pas trancher seul

Trois questions fermées, chacune avec la réponse recommandée et ce qu'elle débloque.
Les décisions D1 à D5 ne sont **pas** rouvertes.

**Q1 — Le sous-titre du moteur vit-il *dans* l'onglet ou *juste sous* l'onglet ?**
D3 fixe que le nom de l'onglet devient « Conversation avec l'agent » et que le
moteur (« Agent Pi » / « Agent PLh ») passe en sous-titre. Reste l'emplacement.
*(a)* Dans l'onglet, sur deux lignes → la barre d'onglets doit passer de 36 à ~44 px
pour les 22 modes. *(b)* Juste sous l'onglet, dans le bandeau d'identification de
28 px (§ 3.6), plus la barre d'état qui l'affiche déjà (`tabs.js:2345-2351`).
**Recommandé : (b)** — un onglet de 28 px de haut ne porte pas deux lignes, et faire
grandir la barre touche les 22 modes. **Débloque : lot 4.**

**Q2 — Le tableau de bord : menu « Autres écrans » ou 4<sup>e</sup> onglet du panneau Travail ?**
Le doc de navigation prévoit 4 onglets, dont « Projet » pour le tableau de bord
(§ 4.6) ; le code en a 3, déclarés « ordre définitif » (`index.html:102-108`) et
verrouillés par un test. *(a)* Garder 3 onglets, tableau de bord dans « Autres
écrans › Comprendre ». *(b)* Ajouter l'onglet « Projet » → 4 onglets et un test à
réécrire. **Recommandé : (a)** — aucune décision antérieure contredite, aucun test
à modifier, et la palette (`Ctrl+Shift+P`) donne déjà l'accès direct.
**Débloque : lots 3 et 5.**

**Q3 — En fenêtre étroite, replier la colonne de gauche ou la garder fixe ?**
À 800 px (minimum autorisé), la colonne fait 280 px, soit 35 % de la largeur.
*(a)* Garder 280 px fixes, avec ellipsis et bande de contexte raccourcie (§ 4.5).
*(b)* Ajouter un bouton de repli (colonne en icônes seules). **Recommandé : (a)** —
le repli est une **fonctionnalité** (un état de plus à mémoriser, à tester, à
documenter), pas une présentation ; il n'est pas nécessaire pour tenir à 800 px.
**Débloque : lot 1** (règles de largeur) ; si (b) est choisi, cela devient une étape
à part entière, à chiffrer séparément.

---

## 8. VERDICT

**Prêt à appliquer.** Les lots **1, 2, 3, 5, 6** sont prêts tels quels : chaque valeur
est chiffrée, chaque point de l'existant a sa preuve `fichier:ligne`, et aucune
décision du propriétaire n'est contredite. Les gains mesurables attendus :
bloc du bas de **272 → 240 px** (il tient enfin à 500 px de haut), en-tête de colonne
de **72 → 48 px**, **7 icônes → 3 boutons nommés** en haut et **14 lignes → 6** en
bas (dont 2 accès directs remontés du menu), deux contrastes fautifs corrigés (bouton primaire 3,08 ; palette 1,31 en clair)
et un focus clavier visible là où il n'en existait aucun.

**Reste à décider.** Le lot **4** dépend de Q1 (emplacement du sous-titre) ; le
contenu du menu et du panneau dépend de Q2 (tableau de bord) ; les règles de largeur
dépendent de Q3 (repli de la colonne). L'**étape 8** (fusion des Paramètres, « gros »
morceau) n'est volontairement **pas** traitée en présentation : seule sa *mise en
forme* est préparée (4 groupes visuels, en-tête, ordre des actions), conformément à
D5.

**Non vérifié.** Cinq points demandent un passage à l'écran avant livraison :
(1) le rendu exact des hauteurs de bloc (mes calculs partent des valeurs CSS, pas du
rendu) ; (2) la troncature réelle de « Discussion inter-projets » à 12 px dans
196 px utiles ; (3) le contraste **effectif** du panneau Travail translucide à 94 %
sur l'éditeur, non mesuré ; (4) l'état actif des onglets de Paramètres
(`settings.js:375-400` : `aria-selected` posé ou non) ; (5) le rendu en mode distant
(`web/index.html`, `web/css/web.css`), **non audité** par ce document — la
présentation web devra être traitée séparément si l'on veut la même cohérence.

**Ce que ce document ne fait pas** : il ne modifie aucun fichier de code, ne
réécrit pas `docs/proposition-navigation.md`, ne touche ni aux fonctionnalités ni au
contenu des écrans, et ne rouvre aucune des cinq décisions D1 à D5.
