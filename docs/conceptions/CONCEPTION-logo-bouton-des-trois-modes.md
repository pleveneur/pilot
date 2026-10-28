# Conception — le logo Pilot devient le bouton des trois modes

> **Statut** : proposition à appliquer, **écrite pour être exécutée sans interprétation**.
> **Aucun fichier de code, de spec ou de test n'est modifié par ce document** : il ne
> fait que décrire l'état constaté, l'état cible, l'écart, et le découpage en lots.
> **Preuves** : chaque affirmation porte un `fichier:ligne`. Rien n'est supposé.

---

## 0. Ce que ce document tranche (résumé)

1. Le **logo Pilot du bandeau** (`#btn-project-logo`, `index.html:47`) devient le
   **bouton unique des trois modes**. Il est **entouré** d'un bouton, il n'est pas
   redessiné, pas dupliqué, pas déplacé ailleurs qu'à sa place actuelle.
2. Le **bouton dédié actuel** (`#screen-mode-button`, `index.html:340`) **disparaît**
   du DOM, du CSS et du JS. Aucun second bouton ne le remplace.
3. Il **ne change pas de place** : **x = 13 → 41 px** dans les trois modes ;
   **y = 10 → 38** en Détaillé, **y = 8 → 36** dans les deux pleins écrans (2 px
   d'écart, infranchissable : les deux bandeaux n'ont pas la même hauteur, et les
   deux hauteurs sont verrouillées).
4. **Affordance** : c'est un vrai `<button>` → curseur, boîte au survol, bord au
   survol, anneau au clavier, **infobulle mot pour mot identique à celle du bouton
   supprimé** (mode courant + mode suivant). Aucune pastille, aucun chevron, aucun
   mot : le logo ne redevient pas un bouton déguisé.
5. **Clic par erreur** : cycle inchangé (un seul clic depuis l'écran de départ mène
   à « Assistant seul », **jamais** à « Vocal »), l'entrée en Vocal **n'ouvre pas le
   micro**, la sortie est immédiate par **Échap**, et une **garde de 400 ms** avale
   le double-clic réflexe qui, aujourd'hui, **agrandissait la fenêtre** à cet endroit
   exact.
6. **Six lots** livrables séparément, chacun vérifiable seul (test ou recette).

---

## 1. État constaté (preuves)

### 1.1 Il y a trois logos dans le document, un seul est concerné

| Nœud | Où | CSS | Devient |
|---|---|---|---|
| `#boot-logo` | `index.html:14` — écran de chargement | `style.css:35` (160 px) | **inchangé** |
| `#btn-project-logo` | `index.html:47` — bandeau du haut de la colonne gauche | `style.css:1239` (24 px, `margin-left:-3px`) | **le bouton des trois modes** |
| `#empty-logo` | `index.html:366` — filigrane de la zone vide | `style.css:1026`, `1037` | **inchangé** |

Le fichier image est **le même** pour les trois (`/logo_pilot_vector.svg`) : c'est
pourquoi il n'est **ni recadré ni remplacé** (`style.css:1240-1245`, commentaire
« LOT A »). Le dessin est un dégradé turquoise → bleu → violet : il tient sur les
dix palettes, et son fond est `--bg-app` dans les trois modes (§ 2.2).

### 1.2 Ce que le logo fait aujourd'hui : **rien**

`grep -rn "btn-project-logo" src/ tests/` ne renvoie que `src/css/style.css:1239` et
`src/js/badge-distant-bas.test.js:365` (qui exige seulement la présence de l'id).
**Aucun écouteur de clic, aucun `cursor: pointer`, aucune infobulle, aucun
`tabindex`.** Le nœud est inerte.

Deux gestes de **fenêtre** le traversent pourtant, parce qu'il est dans une zone de
glissement (`src/js/window-controls.js:56` : `WINDOW_DRAG_ZONE_IDS = ["project-selector", "tab-row"]`) :

- **appui** sur le logo → `startDragging()` (`window-controls.js:364-372`) ;
- **double-clic** sur le logo → agrandir / restaurer (`window-controls.js:375-378`).
  L'`<img>` n'est pas dans le garde-fou (`WINDOW_GESTURE_BLOCKLIST`,
  `window-controls.js:63-66`) : le geste part bien de là.

**C'est le point de vigilance n° 3** : le réflexe « double-clic dans le bandeau du
haut = agrandir la fenêtre » existe **à cet endroit exact**. Si le logo devient un
bouton, ce réflexe bascule deux fois de mode. Voir § 2.4.

### 1.3 Le bouton dédié actuel

- **Nœud** : `<button type="button" id="screen-mode-button" data-screen-mode="detailed">`
  (`index.html:340`), dans `#tab-row`, **entre** l'entrée « Travail »
  (`#agent-activity`) et `#window-controls`. Commentaire de propriété : `index.html:327-339`.
- **Contenu** : `.screen-mode-icon` (Lucide) + `.screen-mode-dot` (pastille 6 px) +
  `.screen-mode-label` (le mot du mode courant).
- **Source unique** : `src/js/screen-mode.js`. Clé `pilot_screen_mode` (`:25`),
  ancienne clé binaire reprise une fois (`:28`), cycle
  `Détaillé → Assistant seul → Vocal` (`:36-44`), pastille et infobulle calculées
  (`:96-105` `screenModeTitle`, `:178-193` `renderScreenModeButton`), câblage
  (`:247-256` `initScreenMode`).
- **Textes exacts** (à reprendre **mot pour mot**) :
  - « Mode d'écran : Détaillé. Passer à « Assistant seul ». »
  - « Mode d'écran : Assistant seul. Passer à « Vocal ». »
  - « Mode d'écran : Vocal. Passer à « Détaillé ». »
- **Apparence** : `style.css:2031` (28 px de haut, **88 px** de large, bordure
  transparente, `--radius-sm`), `:2055-2058` survol (`--surface-2`), `:2061-2065`
  focus clavier (anneau `--accent`, offset −2), `:2075-2090` pastille et teintes.
- **Déplacement / restitution** (le nœud est **déplacé, jamais recréé**) :
  `super-agent.js:3748` `enterImmersive`, `:3795-3805` (mémorisation + insertion
  avant le résumé des agents), `:3855-3862` restitution ; `:4095` `enterVocal`,
  `:4110-4116` (insertion dans `.vocal-top`), `:4196-4203` restitution.
- **Raccourcis et sorties** : `Ctrl+Shift+A` → `super-agent.js:4256-4258` ;
  **Échap sort du Vocal** (`super-agent.js:4268-4274`, sauf modale ouverte) ;
  **Échap ne sort pas de « Assistant seul »** (comportement d'origine, conservé).
- **Effet d'un changement de mode** : `applyScreenMode` publie
  `pilot-screen-mode-apply` (`screen-mode.js:208-220`) ; `super-agent.js:4303-4320`
  entre ou sort de l'écran ; `main.js:567` ouvre l'onglet 🧭 si besoin.

### 1.4 Géométrie des trois écrans (les seules mesures qui comptent)

| Écran | Bandeau qui contient le contrôle | Départ du bandeau | Source |
|---|---|---|---|
| Détaillé | `#project-selector`, **48 px**, `padding: 8px 8px 8px 16px`, `align-items:center`, `gap:8px` | y = 0 | `style.css:1176-1186` |
| Assistant seul | `.superagent-immersive-top`, **58 px**, `margin-top: var(--window-controls-height)` | y = 36 | `style.css` bloc `.sa-immersive-top`, `--window-controls-height: 36px` en `style.css:288` |
| Vocal | `.vocal-top`, **44 px**, même `margin-top` | y = 36 | `style.css:11578-11587` |

- L'overlay démarre **tout en haut** (`inset: 0`, `.superagent-immersive` /
  `.pilot-vocal`), le décalage vit sur la **barre** : la bande **y = 0 → 36** est
  **libre à gauche** dans les deux pleins écrans (les trois boutons de fenêtre
  l'occupent à **droite**, `z-index: 100001`).
- Fond du bandeau de Détaillé = `#sidebar` → `var(--bg-sidebar)` (`style.css:785`)
  = `var(--bg-app)` (`style.css:405` sombre, `:508` clair). Fond des deux overlays
  = `var(--bg-app)`. **Le même dessin repose donc sur la même couleur dans les trois
  modes.**
- Fenêtre minimale : 800 × 500 (`src-tauri/tauri.conf.json:47-48`) ; aucun
  `@media` ne masque la colonne de gauche (`style.css:10090`, `:8564`, `:11397`
  concernent le tableau de bord, le formulaire des agents et le mode immersif).

### 1.5 Ce qui est verrouillé par des tests (à ne pas casser sans le dire)

| Fichier | Ligne | Ce qu'il exige |
|---|---|---|
| `trois-modes-ecran.test.js` | `189` | `SCREEN_MODE_BUTTON_ID === "screen-mode-button"` |
| | `193-200` | un seul nœud, entre « Travail » et les boutons système, dans `#tab-row` |
| | `205-213` | jamais créé par du code : `getElementById`, `insertBefore(..., agentsHost)`, `immersiveModeButtonHome` |
| | `217-224` | la balise porte `data-screen-mode`, le titre, le `<span>` du mot, la pastille |
| | `225-247` | à la sortie, MODE est restitué **avant** « Travail » |
| | `273-296` | 88 px, `--font-sm`, pastille `--superagent-accent` / `--vocal-listen` |
| `barre-fenetre-assistant-seul.test.js` | `252` | un seul `id="screen-mode-button"` |
| | `240-260` | ordre de la barre : titre → mode → agents → ⚙ |
| `ecran-vocal-lot2.test.js` | `326-328` | un seul nœud ; `SCREEN_MODE_BUTTON_ID` utilisé < 12 fois |
| | `374-377` | `#screen-mode-button[data-screen-mode="vocal"] .screen-mode-dot` + `--vocal-listen` |
| | `409-415` | `body.pilot-vocal-active #screen-mode-button { width:auto }` ; barre 44 px |
| `badge-distant-bas.test.js` | `365` | le HTML contient `id="btn-project-logo"` et `src="/logo_pilot_vector.svg"` |
| `lot2-colonne-haut.test.js` | `96-101` | blocs inspectés du bandeau : `#project-selector`, `#btn-project-name`, `.project-engine`, `#btn-open-project`, `#project-identity` |
| `barre-fenetre-etats.test.js` | `292` | `WINDOW_DRAG_ZONE_IDS === ["project-selector","tab-row"]` |

**Conclusion** : `#btn-project-logo` doit **garder son id et son `src`** (sinon
`badge-distant-bas.test.js:365` casse), la constante `SCREEN_MODE_BUTTON_ID` doit
**garder son nom** (sinon 8 points d'appel et 3 tests changent pour rien), et quatre
fichiers de test doivent être **adaptés** (§ 4.3) — aucun ne peut rester tel quel.

---

## 2. Décisions tranchées

### D1 — On n'invente pas un logo : on **entoure** celui qui existe

```html
<!-- index.html, à la place de la ligne 47 -->
<div id="project-selector">
  <button type="button" id="mode-logo" data-screen-mode="detailed"
          title="Mode d'écran : Détaillé. Passer à « Assistant seul »."
          aria-label="Mode d'écran : Détaillé. Passer à « Assistant seul ».">
    <img id="btn-project-logo" src="/logo_pilot_vector.svg" alt="Logo" />
  </button>
  <div id="project-identity"> … </div>
```

- `#btn-project-logo` **reste** : même id, même `src`, même CSS (`style.css:1239-1252`),
  même place dans le flux (elle devient le contenu du bouton).
- Un **seul** nœud nouveau, **un seul** `id` nouveau : `#mode-logo`.
- `alt="Logo"` : sans effet sur le nom accessible (l'`aria-label` du bouton le
  remplace) ; on n'y touche pas.
- **Écarté** : dessiner un second logo, réutiliser `#boot-logo`, transformer
  `#btn-project-name` en bouton (il est tronqué par ellipse, il n'est pas une cible
  stable), ou mettre le bouton sur `.logo + nom`.

### D2 — Une seule place, calculée (pas choisie)

**Boîte du bouton** (repère : coin haut-gauche de la fenêtre) :

| Mode | x | y | Boîte de l'image (dessin à +3,2 px) |
|---|---|---|---|
| Détaillé | **13 → 41** | **10 → 38** | 13 → 37 × 12 → 36 (**exactement aujourd'hui**) |
| Assistant seul | **13 → 41** | **8 → 36** | 13 → 37 × 10 → 34 |
| Vocal | **13 → 41** | **8 → 36** | 13 → 37 × 10 → 34 |

**Le calcul, en clair :**

- **x = 13** : l'inset du bandeau est 16 px (`style.css:1178`) et l'image porte
  `margin-left: -3px` (`style.css:1246`) → son bord est à 13. On garde **13** en
  mettant `margin-left: -3px` sur le bouton (l'image garde le sien, donc son dessin
  repart à **16,2 px**, valeur documentée dans le code).
- **Détaillé, y = 10** : (48 − 28) / 2 = 10. L'image (24 px) retombe sur **12 → 36**,
  sa place actuelle : **le bandeau ne bouge pas d'un pixel**.
- **Pleins écrans, y = 8** : la bande libre s'arrête à **36** (départ de la barre du
  mode). On **colle** donc la boîte au haut de la barre : 36 − 28 = **8**. Elle ne
  la chevauche pas d'un pixel (un chevauchement se verrait au survol : le fond du
  bouton mordrait le filet de la barre).
- **Les 2 px d'écart (10 vs 8) sont infranchissables** : les bandeaux font 48 px et
  la bande libre 36 px, et ces deux hauteurs sont verrouillées
  (`lot2-colonne-haut.test.js:107`, `barre-fenetre-assistant-seul.test.js:226`).
  Aligner le logo sur les **boutons de fenêtre** (y = 4 → 32) donnerait **6 px**
  d'écart : c'est pire. **2 px ne se voient pas ; 6 px se voient.**
- **Le nom du projet ne bouge pas** : la boîte du bouton rend au nom exactement sa
  place (`margin-right: -4px` : 28 − 3 − 4 = **21 px** de boîte, la largeur qu'occupait
  l'image).

### D3 — L'affordance : un vrai bouton, discret, qui ne bavarde pas

| Élément | Décision | Pourquoi |
|---|---|---|
| Élément HTML | `<button type="button">` | atteignable au clavier (`Tab`), activable par `Entrée`/`Espace`, annoncé « bouton » aux lecteurs d'écran — **c'est** l'affordance, elle ne dépend d'aucun dessin |
| Curseur | `cursor: pointer` | la convention de l'application (le bouton « Projets » voisin, `style.css:1206` ; les entrées de menu, `style.css:249-251` ; le bouton supprimé lui-même, `style.css:2049`) |
| Survol | `background: var(--surface-2)` + `box-shadow: inset 0 0 0 1px var(--border-subtle)` | c'est **le survol du bouton qu'on supprime** (`style.css:2055-2058`), repris tel quel ; le filet interne rend le survol visible même dans les palettes claires, où `--surface-2` (#f0f1f4) et `--bg-app` (#f4f5f7) sont très proches. Aucune couleur nouvelle. |
| Appui | `background: var(--surface-3)`, filet `--border-hover` | même vocabulaire que les boutons de fenêtre (`style.css:133-136`) et que « Projets » (`style.css:1225-1227`) |
| Clavier | `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` | même règle que les boutons de fenêtre (`style.css:147-150`), offset **positif** : la boîte est collée au bord haut dans les pleins écrans, un anneau en retrait (−2) serait rogné |
| Infobulle | `title` + `aria-label` = **les trois phrases existantes**, mot pour mot (`screen-mode.js:96-105`) | c'est **le** mécanisme de découverte de l'application (tous les boutons sans mot en ont un) ; il annonce le mode **suivant** sans rien afficher au repos |
| Désactivé | aucune règle `:disabled` | aucun code ne pose `disabled` (même raison que `style.css:253-256`) |
| **Pastille de couleur** | **supprimée** | c'est une **seconde** information sur un objet de marque : elle ferait du logo un badge d'état. Le mode courant se lit à l'écran, qui change du tout au tout |
| **Chevron / point « cliquable »** | **écarté** | un chevron dit « ouvre un menu », pas « change d'écran » (le chevron est déjà pris par `#btn-open-project`, `index.html:53`) ; un point clignotant est déjà pris par l'entrée « Travail » |
| **Mot « Détaillé » à côté du logo** | **écarté** | c'est reconstruire le bouton qu'on supprime. Le propriétaire a demandé **un seul** endroit, pas un bouton déguisé en logo |

**Ce qu'on perd, dit franchement** : la **pastille** et le **mot**. Le bouton
supprimé donnait deux lectures du mode (mot + teinte) *parce qu'il devait annoncer
ce qu'on allait obtenir*. Le logo n'annonce rien : il **est** l'entrée. L'infobulle
reste la seule annonce, et elle est exacte.

### D4 — Le clic par erreur : quatre barrières, aucune boîte de dialogue

1. **Le cycle ne saute pas d'étape** (`screen-mode.js:36-44` + `nextScreenMode`) :
   depuis « Détaillé », **un** clic mène à « Assistant seul », **jamais** à
   « Vocal ». Le pire clic isolé sur l'écran de départ n'ouvre pas l'écran au micro.
2. **Entrer en « Vocal » n'ouvre pas le micro** : la permission part au **premier
   geste dans l'écran** (`super-agent.js:3966` `onVocalFirstGesture`, armé en `:4138` ;
   `spec_modes_ecran_vocal.md` §5),
   jamais à l'entrée. Un clic accidentel **n'écoute pas**.
3. **La sortie ne demande pas la souris** : **Échap** quitte le Vocal
   (`super-agent.js:4268-4274`), et la sortie écrit « Détaillé » dans la clé
   (`super-agent.js:4221` → `noteImmersiveExited`) : **aucune trace** ne reste.
   *(La mémorisation est justement la raison de se méfier : un clic de trop suivi
   d'une fermeture de Pilot rouvrirait Vocal au démarrage suivant —
   `spec_modes_ecran_vocal.md` §1.3.)*
4. **Garde anti-double-clic : 400 ms** (`shouldIgnoreModeClick`). Le double-clic
   réflexe à cet endroit **agrandissait la fenêtre** (§ 1.2, `window-controls.js:375-378`) : l'habitude est ancrée,
   et un double-clic ferait **deux** sauts (`Détaillé → Assistant seul → Vocal`).
   `400 ms` est **sous** le seuil système de reconnaissance du double-clic
   (500 ms par défaut sous Windows) : les deux clics d'un double-clic tombent dans
   la garde ; deux clics **volontaires** sont séparés de plus de 500 ms.
   **Écarté** : une confirmation (« Passer en mode Vocal ? ») — bavarde, et elle
   punirait le geste normal ; un appui long — invisible et non discoverable.

### D5 — Le bouton dédié disparaît : ce qui est supprimé, exactement

| Fichier | Ce qui disparaît |
|---|---|
| `index.html` | le nœud `#screen-mode-button` (`:340`) **et** son commentaire de propriété (`:327-339`), remplacés par un commentaire de 4 lignes renvoyant au logo |
| `src/js/screen-mode.js` | la valeur `"screen-mode-button"` → `"mode-logo"` (`:32`, **le nom de la constante ne change pas**) ; les deux écritures DOM du mot et de l'icône (`:188-191`) ; l'import `setIcon` (`:23`) devenu inutile |
| `src/js/super-agent.js` | les blocs d'insertion/réstriction du bouton dans les barres (`:3795-3805`, `:4110-4116`) → insertion dans l'**overlay** ; les restitutions (`:3855-3862`, `:4196-4203`) restent, mêmes noms de variables |
| `src/css/style.css` | `#screen-mode-button` et ses six règles (`:2031-2091`), `body.superagent-immersive-active #screen-mode-button` (`:11165`), `body.pilot-vocal-active #screen-mode-button` (`:11593`) |
| — | **rien d'autre** : `SCREEN_MODES[].icon` reste (c'est la fiche du mode, pas un rendu), `screenModeInfo`/`screenModeTitle` restent (purs, réutilisés), la clé `pilot_screen_mode` et la migration restent, `Ctrl+Shift+A` reste |

### D6 — Ce qui ne change pas (verrous à respecter)

- Place du contrôle dans le DOM : **plus dans `#tab-row`**. C'est le seul déplacement
  de structure du document, et il est **voulu**.
- **Ordre de la barre de « Assistant seul »** : titre → résumé des agents →
  « Travail » → ⚙ (`barre-fenetre-assistant-seul.test.js:240-260`). Le mode n'y est
  plus : la barre **garde ses 58 px** et son air de gauche de 18 px.
- **Barre du Vocal** : 44 px, `margin-top: var(--window-controls-height)`, filet bas
  (`style.css:11578-11587`). Elle ne porte plus **rien** : elle devient une **bande
  de respiration** de 44 px, et le logo occupe le coin au-dessus d'elle. L'écran
  reste nu : le logo est un repère de 28 px dans l'angle, pas un élément de la scène.
- `#window-controls` : `z-index: 100001`, 46 × 28 px, 4 px d'air — **intact**.
- Bandeau de la colonne : 48 px, inset 16 px, filet bas, sous-titre du moteur, badge
  « Distant » en bas — **intact**.
- Cycle, mémoire, migration, raccourcis, écrans : **intacts**.

### D7 — Le mode Zen (F11) : le seul cas où le logo disparaît — **voir Q1**

`body.zen-mode` masque `#sidebar` (`style.css:4043-4046`), donc le bandeau, donc le
logo. Deux bascules existent (`main.js:329` et `main.js:1092`). Aujourd'hui, le
bouton dédié **survit** au Zen (il est dans `#tab-row`) : le contrôle ne disparaît
jamais. Après le changement, il disparaît en Zen.

Trois issues, **une seule est recommandée** :

- **(A) Ne rien faire** (*recommandé*) : le Zen est **défini** comme « plein écran
  sans barre latérale ». Le mode reste atteignable par `Ctrl+Shift+A` (puis le logo,
  désormais visible dans le plein écran) ou en quittant le Zen (`F11`). Zéro
  mécanisme en plus, zéro test en plus.
- **(B) Déplacer le logo au début de `#tab-row` en Zen** : 4ᵉ emplacement, boîte à
  **y = 4 → 32** (6 px plus haut, 13 px plus à droite), deux points d'appel de plus
  (`main.js:329`, `main.js:1092`) et un test de plus.
- **(C) Laisser `#sidebar` vivante en Zen** : hors sujet, c'est casser le Zen.

### D8 — Les textes, mot pour mot

- Infobulle / `aria-label` du logo : **les trois phrases de `screen-mode.js:96-105`**,
  à l'identique (aucune reformulation, aucune seconde formulation).
- `data-screen-mode` reste posé sur le bouton (`detailed` | `assistant` | `vocal`) :
  il ne sert plus à peindre quoi que ce soit, il reste la **trace lisible** du mode
  dans le DOM (utile aux tests et au diagnostic). Il n'est pas supprimé.
- Libellés d'écran, titres, pastilles de `#agent-activity` : **inchangés**.

---

## 3. Tableau avant / après

| Point | Avant | Après |
|---|---|---|
| Nœud de commande | `#screen-mode-button` dans `#tab-row` | `#mode-logo` autour de `#btn-project-logo`, dans `#project-selector` |
| Nombre de nœuds | 1 | 1 (jamais de copie) |
| Déplacement en plein écran | dans la barre (58 px / 44 px) | **hors du flux**, dans l'overlay, boîte absolue (13, 8) |
| Restitution | parent + voisin mémorisés, **ordre MODE avant « Travail » imposé** | parent + voisin mémorisés ; **l'ordre n'est plus imposé** (le voisin suivant de « Travail » est `#window-controls`, qui ne bouge jamais) |
| Affordance | fond, bord, mot, icône, pastille, infobulle | curseur, fond + filet au survol, anneau clavier, infobulle ; **ni mot, ni icône, ni pastille** |
| Largeur | 88 px fixes | **28 px** fixes (carré) |
| Glisser la fenêtre | impossible depuis le bouton (garde-fou `button`) | idem — **mais** 28 × 28 px de moins dans le bandeau (≈ 110 px de surface glissable restent : 280 − 32 d'inset − 28 de logo − 8 de gap − ~90 pour « Projets » − 8) |
| Double-clic d'agrandissement | actif sur le logo (28 × 28 px) | **désactivé** sur le logo, actif partout ailleurs dans le bandeau |
| Clic de mode | 1 clic = 1 mode | idem, **+ garde 400 ms** |
| Mémoire du mode | `pilot_screen_mode` | idem |

---

## 4. Ce qu'il faut vérifier pour ne rien casser

### 4.1 Recette manuelle (à faire à la fin de chaque lot)

1. Démarrage en « Détaillé » → **`Tab`** jusqu'au logo : l'anneau `--accent` apparaît ;
   `Entrée` → « Assistant seul » ; l'infobulle disait bien « Passer à « Assistant seul » ».
2. « Assistant seul » → le logo est **dans le coin haut-gauche**, à la même hauteur
   apparente qu'en Détaillé ; la barre est à 58 px et commence **sous** la rangée des
   boutons de fenêtre ; l'ordre est titre → agents → Travail → ⚙.
3. Logo → « Vocal ». **Le micro n'est pas demandé.** Le logo est au même endroit.
   La barre de 44 px est vide.
4. **Échap** → retour « Détaillé », **le logo est revenu dans le bandeau**, la barre
   de saisie est revenue dans l'onglet 🧭, la colonne de gauche est intacte.
5. `Ctrl+Shift+A` depuis « Détaillé » → « Assistant seul » ; `Ctrl+Shift+A` depuis
   « Assistant seul » → « Détaillé » (comportement d'origine, **non modifié**).
6. `Ctrl+Shift+A` **depuis « Vocal »** → sort du Vocal (garde croisée
   `super-agent.js:4256-4258`), jamais deux pleins écrans superposés.
7. **Double-clic rapide** sur le logo : **un seul** mode est franchi.
8. **Double-clic** sur le nom du projet : la fenêtre s'agrandit **encore** (zone de
   glissement intacte). Idem sur le vide de la rangée d'onglets.
9. Fermer l'onglet 🧭 en plein écran → retour « Détaillé » (chemin existant).
10. Redémarrer en « Vocal » mémorisé → l'écran Vocal revient, logo au même endroit.
11. Les **dix palettes** (5 sombres, 5 claires) : survol et anneau visibles partout.
12. Fenêtre à 800 px de large : rien ne se chevauche, rien n'est rogné.

### 4.2 Tests à lancer

```bash
npm test                                   # Vitest (dont les 4 fichiers adaptés + le nouveau)
cargo test --workspace                     # rien de Rust ne bouge, mais c'est le garde-fou
npm run build:handbook                     # après le lot 5 (aide intégrée)
```

### 4.3 Tests à **adapter** (à faire dans le lot qui les casse, jamais après)

| Fichier | Ligne | Remplacement |
|---|---|---|
| `trois-modes-ecran.test.js` | `189` | `toBe("mode-logo")` |
| | `193-200` | le nœud est **dans `#project-selector`**, **avant** `#btn-project-name`, et `#tab-row` ne le contient plus |
| | `205-213` | `insertBefore(screenModeButton, agentsHost)` → `immersiveOverlay.appendChild(...)` ; `immersiveModeButtonHome` conservé |
| | `217-224` | la balise `<button id="mode-logo">` : `data-screen-mode="detailed"` + les deux phrases ; **plus** de `.screen-mode-label` ni `.screen-mode-dot` |
| | `225-247` | l'ordre MODE/Travail n'est plus exigé ; on exige : les deux restitutions **avant** `immersiveOverlay.remove()`, et chacune chez son parent mémorisé |
| | `273-296` | apparence : 28 × 28, marges calculées, `cursor: pointer`, `:focus-visible` `--accent`, `:hover` `--surface-2` |
| `barre-fenetre-assistant-seul.test.js` | `252` | `id="mode-logo"` (toujours **1**) |
| | `240-260` | ordre titre → agents → Travail → ⚙ ; **et** `barreJs` ne contient **pas** `mode-logo` |
| `ecran-vocal-lot2.test.js` | `326-328` | `id="mode-logo"` (le plafond `< 12` sur la constante reste valable) |
| | `374-377` | la règle de pastille est **remplacée** par `body.pilot-vocal-active #mode-logo { position:absolute; top:8px; left:13px }` |
| | `409-415` | la règle `width:auto` est **supprimée** ; on garde les assertions sur `.vocal-top` (44 px, `margin-top`) **et** on ajoute : `.vocal-top` ne contient **aucun** bouton |
| `badge-distant-bas.test.js` | `365` | **aucun changement** |
| `lot2-colonne-haut.test.js` | `96-101` | **aucun changement** |
| `barre-fenetre-etats.test.js` | `292` | **aucun changement** |

### 4.4 Nouveau fichier de test (lot 4) — `src/js/logo-bouton-trois-modes.test.js`

Invariants à verrouiller :

1. `index.html` contient **un seul** `id="mode-logo"`, dans `#project-selector`,
   **avant** `#btn-project-name` ; et **aucun** `id="screen-mode-button"`.
2. `src/js/super-agent.js` et `src/css/style.css` ne contiennent **plus** la chaîne
   `screen-mode-button`.
3. `#btn-project-logo` est **conservé** (id + `src`), et il est **dans** le bouton.
4. `#mode-logo` : `width: 28px`, `height: 28px`, `cursor: pointer`,
   `:focus-visible` avec `--accent`, `:hover` avec `--surface-2`.
5. `body.superagent-immersive-active #mode-logo` **et** `body.pilot-vocal-active #mode-logo`
   portent **les mêmes** `top: 8px` / `left: 13px` (une seule place, prouvée).
6. `shouldIgnoreModeClick(now, dernier)` : 4 cas purs (premier clic, 399 ms, 400 ms,
   valeurs non numériques).
7. Le logo est **déplacé, jamais créé** : `getElementById(SCREEN_MODE_BUTTON_ID)`,
   aucun `id = "mode-logo"` en JS.

---

## 5. Les lots (chacun livrable et vérifiable seul)

> Ordre imposé : 1 → 2 → 3 → 4 → 5 → 6. Chaque lot **laisse la suite verte** :
> un lot ne commence pas avant que `npm test` passe.

### LOT 1 — Le logo devient le seul bouton (bascule fonctionnelle, place provisoire)

**But** : le contrôle est le logo ; le bouton dédié n'existe plus ; l'application se
comporte **exactement** comme avant.

- `index.html` : ajouter le `<button id="mode-logo">` autour de l'image (`:47`) ;
  supprimer `#screen-mode-button` et son commentaire (`:327-340`).
- `src/js/screen-mode.js` : `SCREEN_MODE_BUTTON_ID = "mode-logo"` (`:32`, **même nom**),
  commentaire mis à jour ; suppression des écritures `.screen-mode-label` /
  `.screen-mode-icon` (`:188-191`) et de l'import `setIcon` (`:23`).
- `src/css/style.css` : bloc `#mode-logo` (voir **annexe A**) ; suppression de
  `#screen-mode-button` (`:2031-2091`), `body.superagent-immersive-active #screen-mode-button`
  (`:11165`), `body.pilot-vocal-active #screen-mode-button` (`:11593`).
- `src/js/super-agent.js` : **rien** (les insertions continuent d'utiliser la
  constante ; le logo entre dans la barre comme le bouton hier — place provisoire).
- Tests : les adaptations **minimales** de § 4.3 qui empêchent la suite d'être rouge
  (lignes `189`, `252`, `326-328`) — le reste attend le lot 4.

**Vérifier** : § 4.1 points 1, 3, 4, 5, 6, 9, 10 ; `npm test`.

**Ne pas toucher** : `#btn-project-logo` (id, `src`, CSS), `#window-controls`,
hauteurs de barres, `screenModeScreen`, la mémoire du mode.

### LOT 2 — La place exacte dans les deux pleins écrans

**But** : le logo quitte le flux des barres et vient se poser à **la même place**
qu'en Détaillé.

- `src/js/super-agent.js` : `enterImmersive` → remplacer l'insertion avant
  `agentsHost` par `immersiveOverlay.appendChild(screenModeButton)` (`:3795-3805`) ;
  même chose dans `enterVocal` : `vocalOverlay.appendChild(modeButton)` au lieu de
  `barre.appendChild(modeButton)` (`:4110-4116`). Restitutions **inchangées**.
- `src/css/style.css` : les deux règles d'annexe A § A.3.
- Vérifier : la barre de 58 px ne contient plus le mode (ordre titre → agents →
  Travail → ⚙), la barre de 44 px est vide, le logo est à (13, 8) dans les deux
  écrans et ne mord pas le filet de la barre.

**Vérifier** : § 4.1 points 2, 3, 4 ; § 4.3 lignes `240-260`, `374-377`, `409-415`.

### LOT 3 — Le clic par erreur

**But** : un double-clic réflexe ne fait pas deux sauts.

- `src/js/screen-mode.js` : `MODE_CLICK_GUARD_MS = 400`, `shouldIgnoreModeClick(now, dernier)`
  (pure), `dernierClicMode`, garde dans l'écouteur de `initScreenMode`.
- **Ne pas toucher** au cycle, à la clé, aux textes.

**Vérifier** : § 4.1 point 7 ; les 4 cas purs de `shouldIgnoreModeClick` (lot 4).

### LOT 4 — Les verrous de test

**But** : la conception est prouvée par des tests, pas par un document.

- Adapter les lignes restantes de § 4.3 (`trois-modes-ecran.test.js:193-296`,
  `barre-fenetre-assistant-seul.test.js:240-260`, `ecran-vocal-lot2.test.js:409-415`).
- Créer `src/js/logo-bouton-trois-modes.test.js` (§ 4.4).

**Vérifier** : `npm test` (tout vert), et vérifier qu'un test **échoue** si l'on
remet `#screen-mode-button` dans `index.html` (preuve que le verrou tient).

### LOT 5 — La documentation (et l'aide intégrée)

- `help/overview.md`, bloc `<!-- HELP:modes-ecran -->` (`:419-423`) : « Un **seul
  bouton** fait le tour… » → « Le **logo Pilot**, en **haut à gauche**, fait le tour… ;
  son infobulle annonce le **mode suivant**. Aucune pastille, aucun mot : le mode
  courant se lit à l'écran. » Puis `npm run build:handbook` (**ne pas** éditer
  `help/handbook.md`).
- `spec_modes_ecran_vocal.md` : §2 « Où il vit » (`:33-40`) → le bandeau ; §1.1
  (« trois modes, un seul bouton ») ; §3.1 « Barre de 44 px … elle ne porte que le
  bouton des trois modes » (`:99-101`) → **elle ne porte plus rien** ; §6 (tableau des
  fichiers, `:263`) → `.screen-mode-*` → `#mode-logo`.
- `spec_pilot.md:16` (les trois modes) et `:11` (surfaces de glissement : le bandeau
  perd 28 × 28 px, le garde-fou `button` les rend au logo).
- `spec_super_agent.md:1966` : « le **bouton des trois modes** (dans la barre) » →
  « le **logo Pilot** (en haut à gauche) ».
- `README.md:108-112` : « Un **seul bouton**, à gauche de la rangée d'onglets… » →
  le logo en haut à gauche ; `README.md:138` (« le **même bouton** (mode suivant) »)
  → « le **même logo** ».
- `AGENTS.md` (arborescence, ligne de `screen-mode.js` et de `super-agent.js`) : dire
  que le bouton est le logo.
- **Aucun** fichier `RAPPORT-*.md` n'est réécrit : ce sont des comptes rendus datés.

### LOT 6 — Recette complète

**But** : les 12 points de § 4.1 sur l'application packagée, plus `npm test` et
`cargo test --workspace`. Rien à coder : c'est la porte de sortie.

---

## Annexe A — CSS à appliquer (texte prêt à coller)

### A.1 Le bouton-logo (Détaillé)

```css
/* ── Le logo Pilot EST le bouton des trois modes ─────────────────────────────
   La boîte fait 28 x 28 px ; le DESSIN ne bouge pas d'un pixel (24 px, même
   fichier, même -3 px sur l'image : style.css:1246). Trois nombres sont
   CALCULES, pas choisis :
     margin-left: -3px   -> la boîte commence à 13 px, là où commençait l'image ;
     margin-right: -4px  -> la boîte rend au nom du projet sa place exacte
                            (28 - 3 - 4 = 21 px, la largeur de l'image seule) ;
     padding: 2px 1px 2px 3px -> le contenu fait 24 x 24, soit l'image : elle
                            n'est donc jamais decalee par un centrage.
   `box-sizing: border-box` est global. Aucune bordure (elle decalerait la mise
   en page au survol) : le filet est un box-shadow interne. */
#mode-logo {
  flex: 0 0 auto;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  padding: 2px 1px 2px 3px;
  margin-left: -3px;
  margin-right: -4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--transition-fast);
}

/* Survol et appui : les jetons deja utilises par les boutons voisins
   (style.css:2055, :129). Le filet interne rend le survol visible dans les
   palettes claires, ou --surface-2 et --bg-app sont tres proches. */
#mode-logo:hover {
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--border-subtle);
}
#mode-logo:active {
  background: var(--surface-3);
  box-shadow: inset 0 0 0 1px var(--border-hover);
}

/* Focus CLAVIER seulement (meme regle que les boutons de fenetre,
   style.css:145-148). Offset POSITIF : la boite est collee au bord haut dans
   les deux pleins ecrans, un anneau en retrait serait rogne. */
#mode-logo:focus { outline: none; }
#mode-logo:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Aucun etat desactive : aucun code ne pose `disabled`
   (meme raison que style.css:253-256). */
```

### A.2 Détaillé : rien d'autre

Le bouton étant un enfant direct de `#project-selector` (`align-items: center`,
`gap: 8px`), il se place **tout seul** à (13, 10). Aucune règle de position.

### A.3 Les deux pleins écrans : la même place

```css
/* Place EXACTE dans les deux pleins ecrans. La bande libre du haut s'arrete a
   36 px (depart de la barre du mode = --window-controls-height) : la boite de
   28 px se colle donc a 36 - 28 = 8 px, sans mordre le filet de la barre.
   x = 13 px : le meme bord que dans « Detaille » (inset 16 px du bandeau moins
   les 3 px de l'image). Le logo sort du flux de la barre : ni les 58 px de
   « Assistant seul » ni les 44 px du « Vocal » ne bougent. */
body.superagent-immersive-active #mode-logo,
body.pilot-vocal-active #mode-logo {
  position: absolute;
  top: 8px;
  left: 13px;
  margin: 0;
  z-index: 2;
}
```

### A.4 Ce qui est supprimé du CSS

`#screen-mode-button` et ses six règles (`style.css:2031-2091`),
`body.superagent-immersive-active #screen-mode-button` (`:11165`),
`body.pilot-vocal-active #screen-mode-button` (`:11593` et la suite du bloc).
**Aucune** autre règle ne mentionne `.screen-mode-` : la vérifier par
`grep -n "screen-mode-" src/css/style.css` (attendu : **0**).

---

## Annexe B — JS à appliquer (extrait)

```js
// src/js/screen-mode.js

/** Identifiant du bouton UNIQUE des trois modes : c'est le LOGO du bandeau
 *  (`#mode-logo`, autour de `#btn-project-logo`). Le nom de la constante ne
 *  change pas : la constante dit le ROLE (un <button>), pas le dessin. */
export const SCREEN_MODE_BUTTON_ID = "mode-logo";

/** Delai pendant lequel un second clic sur le logo est ignore. Sous le seuil
 *  systeme de reconnaissance du double-clic (500 ms) : les deux clics d'un
 *  double-clic reflexe tombent dans la garde, deux clics volontaires non. */
export const MODE_CLICK_GUARD_MS = 400;

/** Decision PURE : ce clic doit-il etre ignore ? */
export function shouldIgnoreModeClick(now, dernier) {
  if (typeof now !== "number" || typeof dernier !== "number") return false;
  return now - dernier < MODE_CLICK_GUARD_MS;
}

let dernierClicMode = -Infinity;

export function initScreenMode() {
  const btn =
    typeof document !== "undefined" ? document.getElementById(SCREEN_MODE_BUTTON_ID) : null;
  if (btn && btn.dataset.screenModeWired !== "1") {
    btn.dataset.screenModeWired = "1";
    btn.addEventListener("click", () => {
      const maintenant = Date.now();
      if (shouldIgnoreModeClick(maintenant, dernierClicMode)) return;
      dernierClicMode = maintenant;
      applyScreenMode(nextScreenMode(getScreenMode()));
    });
  }
  return rememberScreenMode(getScreenMode());
}
```

`renderScreenModeButton` garde son nom et son corps **moins** les deux écritures
`.screen-mode-label` / `.screen-mode-icon` : il pose `data-screen-mode`, `title` et
`aria-label`, c'est-à-dire **exactement** ce que le logo peut porter.

---

## 6. Explicitement écarté (à ne pas faire, même « en mieux »)

- Un **second bouton** à côté du logo, un menu de choix des modes, un écran de
  réglage des modes.
- Une **pastille** ou un **badge** sur le logo, un chevron, un mot à côté.
- Changer l'**ordre du cycle**, la **clé** de mémoire, la **migration**, ou les
  **trois phrases** d'infobulle.
- Toucher aux **hauteurs** (48 / 58 / 44 px), à `--window-controls-*`, à
  `#window-controls`, au bandeau du nom, au badge « Distant ».
- Ajouter un `@media` ou un réglage pour « la place du logo ».
- Réécrire un `RAPPORT-*.md` (comptes rendus datés).

---

## 7. Questions fermées au propriétaire

**Q1 — Mode Zen (F11), où la colonne de gauche est masquée (`style.css:4043-4046`) :
le logo disparaît avec elle.**
- **(A)** On n'y touche pas : en Zen, on change de mode par `Ctrl+Shift+A` (puis le
  logo du plein écran) ou en quittant le Zen par `F11`. *(recommandé : zéro mécanisme
  en plus, zéro test en plus, et le Zen est « plein écran **sans** barre latérale »)*
- **(B)** Le logo est déplacé au début de la rangée d'onglets en Zen : 4ᵉ
  emplacement (6 px plus haut, 13 px plus à droite), 2 points d'appel et 1 test de
  plus.

**Q2 — La pastille de couleur du mode courant (`style.css:2075-2090`) :**
- **(A)** Supprimée avec le bouton : le mode se lit à l'écran, le logo reste une
  marque. *(recommandé)*
- **(B)** Conservée, réduite à 6 px, collée au coin du logo.

**Q3 — La garde anti-double-clic :**
- **(A)** 400 ms : un double-clic réflexe (qui **agrandissait** la fenêtre à cet
  endroit, `window-controls.js:375-378`) ne franchit qu'**un** mode. *(recommandé)*
- **(B)** Aucune garde : le geste reste brut, un double-clic franchit **deux** modes.

---

**DONE:** document de conception écrit dans `CONCEPTION-logo-bouton-des-trois-modes.md`
(racine du projet). Aucun fichier de code, de spec ou de test n'a été modifié, aucun
outil de listing de sessions d'agents n'a été appelé.
