# Proposition — Faire disparaître la barre de fenêtre système

> **Statut : PROPOSITION APPLIQUEE dans sa variante « option 2 ».** Le 2026-11-02,
> la decision du proprietaire a tranche : **Q1 = OUI** (supprimer la bande de
> 32 px et installer les trois boutons au bout de la rangee d'onglets), **Q2 = NON**
> (aucune marge de 24 px a gauche des onglets en mode Zen), **Q3 = NON** (ne pas
> masquer les trois boutons sur macOS). Ce qui suit decrit donc l'etat ANTERIEUR
> (utile comme justification chiffree) : l'etat COURANT est decrit dans
> `spec_pilot.md` §1 (« Boutons de fenetre ») et `README.md` § « Barre de
> fenetre », et la preuve d'execution est dans
> `RAPPORT-suppression-bande-fenetre.md`.
>
> **Portee** : Windows (verifie sur le depot), macOS et Linux (specifies, **non
> verifies** ici — aucune machine disponible).
> **Décisions non rouvertes** : D1–D5 (2026-10-23), sous-titre du moteur dans la
> bannière, tableau de bord dans « Autres écrans », colonne de gauche fixe.
> **Documents non réécrits** : `docs/proposition-presentation-ui.md` (7 lots),
> `docs/proposition-navigation.md`.
> **Convention de preuve** : tout constat sur l'état actuel porte un `fichier:ligne`.

---

## 1. Ce que la barre système fait aujourd'hui — et ce qu'on perdrait

Elle montre trois choses (dont deux sont des doublons) et rend six services.

| Ce qu'elle affiche | Preuve | Doublon ? |
|---|---|---|
| L'icône de la fenêtre | `src-tauri/tauri.conf.json:10-18` (`bundle.icon`) | Oui — le logo est déjà plus grand sous elle |
| Le titre de la fenêtre | `"Pilot"` : `tauri.conf.json:41`, puis `Pilot <chemin>` : `src/js/sidebar.js:493` et `:530` → `src-tauri/src/lib.rs:2809-2812` | Oui — le nom du dossier est déjà dans la barre « Projets en cours » |
| Les 3 boutons système (Réduire, Agrandir/Restaurer, Fermer) | fournis par le cadre système ; **aucun `decorations`** dans `tauri.conf.json:40-50` (donc cadre natif) | Non — c'est le seul service non doublonné |

Les six services rendus, et leur sort si on retire la barre :

| Service | Où il vit aujourd'hui | Après retrait |
|---|---|---|
| **Glisser** la fenêtre | tout le haut de la barre système | **reproduit** : bande Pilot de 32 px, `startDragging()` (`@tauri-apps/api/window`, `window.js:1407`) |
| **Redimensionner** par les bords et les coins | cadre système | **conservé** par Tauri pour une fenêtre *sans cadre mais redimensionnable* (Windows et Linux GTK) — `resizable: true` est déjà là (`tauri.conf.json:44`). **À vérifier sur ce poste.** |
| **Double-clic** sur la barre = agrandir/restaurer | cadre système | **reproduit** : `toggleMaximize()` (`window.js:867`) sur double-clic |
| **Menu système** (clic droit : Restaurer, Déplacer, Taille, Réduire, Agrandir, Fermer) | cadre système | **perdu**. Non reproduit au lot 0.1 (voir Q1 et le lot 0.5) |
| **Agencement Windows 11** (survol du bouton Agrandir) | cadre système | **perdu** — limite connue de Tauri : la demande Windows n'atteint jamais la fenêtre, WebView2 l'intercepte (`tauri-apps/tauri` #4531, *open*, « won't be implemented for v2 »). Parade : Q1 |
| **Clavier** : Tab jusqu'aux boutons, Alt+Espace | cadre système | **partiellement perdu** : nos boutons redeviennent des `<button>` focusables avec anneau visible (lot 0.2) ; **Alt+Espace disparaît**, Alt+F4 doit rester (à vérifier) |
| **Titre dans la barre des tâches / Alt+Tab** | propriété *titre* de la fenêtre, pas le cadre | **inchangé** (le titre reste posé par `lib.rs:2809`) — sauf si on le raccourcit : Q2 |

Deux choses **ne changent pas** et doivent rester identiques :

- **Fermer** garde le comportement actuel : keep-alive (la fenêtre se cache) ou
  confirmation « Êtes-vous sûr de vouloir quitter Pilot ? », puis `destroy()`
  (`lib.rs:3433-3463`). Le bouton Fermer de Pilot appelle `close()`, donc ce même
  chemin. **Jamais** `destroy()` directement.
- **L'icône de la barre des tâches** : inchangée.

---

## 2. Trois options, puis la recommandation

| # | Option | Gain | Coût |
|---|---|---|---|
| **a** | **Fenêtre sans cadre + bande Pilot dédiée de 32 px** en haut, dessinée par Pilot (3 boutons à droite, zone de glissement sur toute la largeur) | Une seule bande, toujours au même endroit ; glisser et double-clic sur toute la largeur ; suit le thème sombre/clair ; **hauteur identique** à la barre système (≈32 px) ; ne dépend d'aucun autre lot | Agencement Windows 11 perdu ; menu système perdu ; 4 permissions Tauri à ajouter ; un fichier JS de plus |
| **b** | **Garder le cadre système**, simplifier seulement ce que Pilot affiche (logo + nom) | Risque **zéro** (glisser, redimensionner, agencement, clavier, menu système intacts) | La barre reste « étrangère » (couleurs du système, pas le thème de Pilot, titre `Pilot <chemin>` toujours là) : la gêne signalée reste entière |
| **c** | **Sans cadre + 3 boutons dans la rangée d'onglets** (aucune hauteur ajoutée) | Zéro pixel de chrome en plus ; les boutons sont dans le mobilier existant | Zone de glissement réduite (uniquement le vide de la rangée d'onglets) ; **entre en collision avec le futur lot 4** du document de présentation, qui ajoute une bande de contexte de 26 px **au-dessus** des onglets : les boutons de fenêtre se retrouveraient sur la 2ᵉ rangée, sous le bouton « Travail » |

### Recommandation ferme : **option a**

Trois raisons, dans cet ordre :

1. **Robustesse vis-à-vis des lots à venir.** Le lot 4 du document de présentation
   crée `#context-bar`, 26 px, **au-dessus** des onglets
   (`docs/proposition-presentation-ui.md:232`). Si les boutons de fenêtre sont dans
   la rangée d'onglets (option c), ce lot les déplace et les fait voisiner le bouton
   « Travail » (`:234`) : il faudrait tout redessiner. Avec la bande dédiée, le lot 4
   s'empile **sous** elle et ne touche à rien.
2. **Ergonomie identique à aujourd'hui.** Glisser et double-cliquer marchent sur
   toute la largeur, comme sur la barre système. En option c, on ne peut plus
   glisser que depuis le vide de la rangée d'onglets — avec 6 onglets ouverts, il
   n'y a plus de vide.
3. **Une seule règle à retenir.** Une bande, trois boutons, à un seul endroit, dans
   tous les modes.

Ce que l'option a **ne donne pas** : de la hauteur gagnée. La bande (32 px) remplace
la barre système (≈32 px). Le gain est visuel et de cohérence, pas vertical. Le gain
vertical viendra du lot 2 du document de présentation (bande d'identité 72 → 48 px).

---

## 3. Design retenu, zone par zone

### 3.1 La bande

| Propriété | Valeur exacte |
|---|---|
| Nom | `#window-bar` (`<div>`, **premier enfant de `<body>`**, avant `#app-body` — `index.html:21`) |
| Hauteur | **32 px**, écrite une seule fois : `--window-bar-height: 32px` dans `:root` (`style.css:70-85`, qui ne connaît que `--space-1..6` = 4/8/12/16/20/24 : 32 n'existe pas comme jeton, d'où la variable) |
| Fond | `var(--bg-app)` (identique à `--bg-sidebar`, `style.css:163` et `:250` : la bande prolonge la barre latérale) |
| Filet bas | `1px solid var(--border-subtle)` (`style.css:136` / `:223`) |
| Remplissage | `padding: 0` ; `margin: 0` |
| Disposition | `display: flex; align-items: stretch; justify-content: flex-end` |
| Empilement | `position: relative; z-index: 100001` — **au-dessus** de l'écran de chargement (`99999`, `style.css:9`) et des dialogues d'agent (`100000`, `style.css:3701`) : la fenêtre reste déplaçable et fermable pendant un chargement (jusqu'à 30 s, `main.js:346-352`) et pendant une question d'agent, exactement comme la barre système aujourd'hui |
| Flex du parent | `body` est déjà `display:flex; flex-direction:column` (`style.css:50-59`) : `#window-bar` prend sa hauteur, `#app-body` garde `flex:1` (`:63-67`). **Aucune autre règle de layout à modifier** |
| Zone de glissement | **toute la bande**, sauf les boutons (règle 3.3) |
| Contenu à gauche | **rien.** Ni logo ni nom du projet : ce sont les doublons refusés. Espace vide = zone de glissement |

### 3.2 Les trois boutons

Ordre de gauche à droite, comme Windows : **Réduire**, **Agrandir/Restaurer**,
**Fermer** (dans la proposition d'origine, Fermer touchait le bord droit de la
fenêtre ; **ce n'est plus le cas** — voir « État réel implémenté » ci-dessous).

> **État réel implémenté (mis à jour).** La bande de 32 px décrite au §3.1 a
> été **supprimée** : les trois boutons sont le **dernier enfant de
> `#tab-row`** (option c du §2). Géométrie appliquée aujourd'hui :
>
> - **bouton** : **46 × 28 px** — la largeur ne change pas, la hauteur devient
>   celle de la **ligne des onglets** (28 px) et non plus toute la hauteur de la
>   rangée (36 px) ;
> - **groupe** `#window-controls` : **4 px d'air en haut, à droite et en bas**, et
>   0 à gauche (`padding: 4px 4px 4px 0`). C'est ce remplissage qui fait l'air :
>   il est la **seule** source, donc retirer l'air rendrait les boutons à 36 px et
>   les ferait retoucher les bords haut et droit ;
> - **Fermer ne touche plus le bord droit** : il reste **4 px** entre la croix et
>   le bord de la fenêtre ;
> - **largeur du groupe** : 3 × 46 + 4 = **142 px** (au lieu de 138 px), dont
>   **4 px pris sur la place des onglets** — invisible ;
> - **la rangée ne change pas de hauteur** : **36 px + 1 px de filet**, rien
>   au-dessus d'elle, aucune marge en haut de la fenêtre ;
> - l'air appartient au groupe, qui est dans `WINDOW_GESTURE_BLOCKLIST` : il **ne
>   déplace pas** la fenêtre ; les zones de glissement restent le bandeau du nom
>   de projet et le vide de la rangée ;
> - l'anneau de focus reste **inscrit dans la touche** (`outline-offset: -2px`).
>
> Verrou : `src/js/barre-fenetre-etats.test.js` (« le groupe prend 4 px d'air en
> haut, à droite et en bas »). Aucune couleur, aucune ombre, aucun jeton ajouté.

| Propriété | Valeur exacte |
|---|---|
| Conteneur | `#window-controls` (`<div>`), dernier enfant de `#window-bar` |
| Taille d'un bouton | **46 × 32 px** exactement (`width: 46px; height: 32px`) |
| Espacement | **0** entre les boutons (`gap: 0`) ; groupe collé au bord droit (`margin-right: 0`) ; groupe = **138 px** de large |
| Zone de clic | toute la surface 46 × 32 ; `padding: 0` ; `border: 0` |
| Rayon | `var(--radius-xs)` = 4 px (`style.css:84`) |
| Icône | Lucide via `refreshIcons` / `setIcon` (`src/js/icons.js:19-20`), classe **`.icon-sm`** = **14 px**, `stroke-width: 2` (`style.css:98-106`) — aucune taille nouvelle |
| Icônes | Réduire = `minus` ; Agrandir = `square` ; Restaurer = `copy` ; Fermer = `x` |
| Couleur de l'icône au repos | `var(--text-secondary)` |
| Libellés | `title` **et** `aria-label` : « Réduire » ; « Agrandir la fenêtre » / « Restaurer la fenêtre » ; « Fermer Pilot » |
| Ordre dans le DOM | Réduire, Agrandir, Fermer — donc aussi l'ordre du Tab |

**Attention à ne pas confondre avec le mode Zen.** F11 bascule `body.zen-mode`
(`main.js:49` et `:853`) : ce n'est **pas** le plein écran. Les libellés disent donc
« Agrandir la fenêtre », jamais « Plein écran ». Aucun code n'appelle
`setFullscreen` (0 occurrence dans `src/js/` et `src-tauri/src/`) : il n'y a pas
d'état plein écran à gérer.

### 3.3 Ce qui fait quoi (une seule règle par geste)

| Geste | Zone | Effet | Garde-fou |
|---|---|---|---|
| Appui gauche + glisser | `#window-bar`, **hors** boutons | `getCurrentWindow().startDragging()` | si `e.target.closest("button")`, ne rien faire |
| Double-clic | `#window-bar`, **hors** boutons | `toggleMaximize()` | même garde-fou |
| Clic | `#win-min` | `minimize()` | — |
| Clic | `#win-max` | `toggleMaximize()` puis relire l'état | — |
| Clic | `#win-close` | `close()` — **pas** `destroy()` | laisse jouer `lib.rs:3433-3463` |

Le code vit dans **un seul fichier neuf** : `src/js/window-controls.js`, appelé une
fois depuis `main.js` (init `DOMContentLoaded`, `main.js:337`).

### 3.4 Effet de bord obligatoire : la pastille du suivi du travail

`#agent-activity` est en `position: fixed; top: 8px; right: 12px; z-index: 10000`
(`style.css:1383-1387`). Elle tomberait **sous** la bande (10000 < 100001) :
invisible et non cliquable — on ne verrait plus qu'un agent travaille. Elle passe
donc à **`top: calc(var(--window-bar-height) + 8px)`** (40 px) et `right: 12px`
inchangé. Son panneau, ancré en `top: 22px` (`style.css:1472`), suit tout seul
(y = 62 px). Le lot 4 du document de présentation la déplacera dans la bande de
contexte : rien à défaire, cette valeur est provisoire et assumée.

### 3.5 Ce qui n'est **pas** touché

`#project-selector` (`style.css:753-761`, logo 48 px `:785-789`, nom 22 px
`:791-795`), `#tab-bar` (`style.css:1363-1372`), `#main-area`, `#sidebar`. Aucune
réservation de `padding-right` n'est nécessaire : les boutons sont **au-dessus** de
la rangée d'onglets, pas dedans.

### 3.6 Configuration de la fenêtre

| Où | Quoi |
|---|---|
| `tauri.conf.json:40-50` | **inchangé** (`resizable: true`, `maximized: true`, `minWidth: 800`, `minHeight: 500`, `dragDropEnabled: true`). On **n'ajoute pas** `decorations` au fichier : la valeur est commune aux 3 OS et macOS doit garder son cadre (voir §6) |
| `tauri.conf.json` | `"transparent"` reste **absent** (donc `false`) : la transparence dégrade le redimensionnement par les bords |
| `src-tauri/src/lib.rs`, dans `setup` (`:3236`) | `#[cfg(not(target_os = "macos"))] { window.set_decorations(false); }` — une seule ligne, un seul fichier de config |
| `src-tauri/capabilities/default.json` | **4 permissions à ajouter** après la ligne 10 : `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close`, `core:window:allow-start-dragging` |

**Preuve que ces 4 permissions manquent** (relevé sur place, pas de mémoire) : le
manifeste ACL généré (`src-tauri/gen/schemas/acl-manifests.json`) liste ce que
contient `core:default` → `core:window:default`, à savoir les **lecteurs**
(`allow-is-maximized`, `allow-current-monitor`…) et `allow-internal-toggle-maximize`,
**et pas** `allow-minimize`, `allow-toggle-maximize`, `allow-close`,
`allow-start-dragging`. Le fichier de permissions actuel
(`capabilities/default.json:5-11`) ne contient que `core:default` + 4 plugins.

---

## 4. États

### 4.1 États d'un bouton

| État | Rendu | Contraste mesuré (sombre / clair) |
|---|---|---|
| Repos | icône `--text-secondary` sur `--bg-app` | **7,75:1 / 5,70:1** |
| Survol | fond `--surface-3`, icône `--text-primary` | **11,73:1 / 13,77:1** |
| Appui | fond `--surface-3` + `box-shadow: inset 0 1px 3px rgba(0,0,0,0.35)` | idem survol |
| Focus clavier | `outline: 2px solid var(--accent); outline-offset: -2px` | **6,14:1 / 3,92:1** (≥ 3:1) |
| Survol de **Fermer** | fond `--surface-3`, icône `--danger` | **6,83:1 / 3,59:1** |
| Désactivé | **jamais** — aucun des trois ne peut être désactivé | — |

**Le survol de Fermer n'est pas un fond rouge plein.** Preuve chiffrée : une croix
blanche sur `--danger` donne **2,77:1** en thème sombre (illisible) et 3,91:1 en
clair. Le fond rouge est donc remplacé par `--surface-3` + croix `--danger`, seul
moyen d'obtenir un contraste suffisant avec les jetons existants
(`--danger` = `#f87171` sombre `style.css:144`, `#e5484d` clair `:231`).

### 4.2 États de la fenêtre

| État | Comportement attendu |
|---|---|
| Normale | icône `square` (« Agrandir la fenêtre ») |
| Agrandie | icône `copy` (« Restaurer la fenêtre »). **Dès le démarrage la fenêtre est agrandie** (`tauri.conf.json:46`) : l'état doit être lu au chargement (`isMaximized()`, `window.js:459`), sinon le bouton affichera « Agrandir » sur une fenêtre déjà agrandie |
| Après agrandir/restaurer | icône relue à chaque redimensionnement : `onResized()` (`window.js:1581`) → `isMaximized()` → `setIcon` (`icons.js:19-20`) |
| Réduite | la fenêtre n'est plus visible : rien à dessiner |
| Redimensionnement par les bords | assuré par Tauri hors mode agrandi ; les 4 px du haut restent une zone de redimensionnement système, comme sur la barre native — donc le haut du bouton Fermer ne réagit pas au clic sur 4 px |

### 4.3 Glisser, double-clic

Glisser : la fenêtre suit le curseur, sans à-coup, y compris depuis le vide à gauche
des boutons. Double-clic : agrandit, puis restaure au double-clic suivant. Aucun
autre geste sur la bande (pas de clic droit : voir §7 piège 4).

---

## 5. Cohérence

### 5.1 Thème sombre **et** clair

Aucune couleur en dur : uniquement des jetons déjà définis pour les deux thèmes
(sombre `style.css:110-158`, clair `:202-245`). Les **8 sous-thèmes** (4 sombres
`:294`, `:323`, `:345`, `:367` ; 4 clairs `:389`, `:411`, `:433`, `:455`) redéfinissent
ces mêmes jetons : la bande les suit sans une ligne de plus. Les valeurs de
contraste du §4.1 sont calculées sur les deux thèmes de base ; le survol de Fermer
est le seul point à revérifier dans chaque sous-thème clair (3,59:1 de marge).

### 5.2 Fenêtre étroite (800 px, `tauri.conf.json:47`)

La bande ne contient **aucun texte** : rien à tronquer. Les boutons occupent 138 px
à droite ; il reste 662 px de zone de glissement. En mode immersif, la bande de
l'overlay réserve `padding-right: 146px` (§6) : à 800 px, 636 px restent pour le
titre, ce qui suffit avec une ellipse (`text-overflow: ellipsis`).

### 5.3 Mode immersif (🧭 Assistant seul)

L'overlay `.superagent-immersive` est `position: fixed; inset: 0; z-index: 99990`
(`style.css:9732-9740`) : il **recouvre** la bande. Deux règles, et deux seulement :

1. `#window-bar` garde `z-index: 100001` : les boutons restent visibles et actifs
   au-dessus de l'overlay (sinon : impossible de fermer ou de déplacer Pilot sans
   sortir du mode immersif — voir Q3).
2. `body.superagent-immersive-active .superagent-immersive { top: var(--window-bar-height); }`
   pour que la bande de l'overlay (`.sa-immersive-top`, 58 px, `style.css:9753-9761`,
   avec son bouton retour) commence **sous** la bande et ne soit pas recouverte.

### 5.4 Mode Zen (F11) et mode distant web

- Zen (`body.zen-mode`, `style.css:2966-2968`) masque `#sidebar`, `#global-actions`
  et `#project-footer`. La bande est **hors** de `#app-body` : elle reste visible.
  C'est voulu (on doit pouvoir sortir d'un mode plein écran).
- **Mode distant web : hors périmètre, explicitement.** L'UI web a son propre
  en-tête (`web/index.html:26`, `.top-area` + `<span class="app-title">`) et aucune
  fenêtre native : `#window-bar` ne la concerne pas.

---

## 6. macOS et Linux

| OS | Cadre | Boutons | Ce qu'il faut ajouter |
|---|---|---|---|
| **Windows** | `set_decorations(false)` | les 3 boutons Pilot, à droite | rien |
| **Linux** | `set_decorations(false)` | les 3 boutons Pilot, à droite | rien (le redimensionnement sans cadre existe côté GTK, encart de 5 px) |
| **macOS** | cadre natif **conservé** + `titleBarStyle: "Overlay"` (option **macOS uniquement** dans Tauri) | les **feux tricolores natifs**, en haut à gauche, ~78 × 28 px | masquer `#window-bar` (`display: none`) ; réserver **28 px en haut** : `body.apple #app-body { padding-top: 28px }` ; la bande d'identité de la barre latérale ne doit pas passer sous les feux |

**Ce qui doit rester vrai partout** : mêmes trois actions (réduire, agrandir/
restaurer, fermer), même sémantique (Fermer garde la confirmation et le keep-alive),
glisser et double-cliquer possibles, aucune couleur en dur, aucun texte dans la
bande.

**Non vérifié ici** : le rendu macOS (pas de machine), et le redimensionnement
Windows sans cadre sur ce poste précis. Ces deux points sont dans le VERDICT.

---

## 7. Pièges à éviter (chacun avec sa conséquence utilisateur)

| # | Piège | Conséquence pour l'utilisateur |
|---|---|---|
| 1 | Croire que l'agencement Windows 11 survit | Il survole « Agrandir » : **plus aucune disposition** proposée. Parade : Q1 (menu « Disposer ») |
| 2 | Oublier les 4 permissions (`§3.6`) | Clic sur Réduire, Agrandir ou Fermer : **rien ne se passe**, sans message. Le bouton paraît mort |
| 3 | Ne pas lire `isMaximized()` au démarrage | La fenêtre démarre agrandie (`tauri.conf.json:46`) et le bouton annonce « Agrandir » : au premier clic, la fenêtre **se réduit d'un coup** au lieu de s'agrandir |
| 4 | Laisser `#agent-activity` à `top: 8px` | La pastille de suivi passe **sous** la bande (z 10000 contre 100001) : elle devient invisible et non cliquable — on ne voit plus qu'un agent travaille |
| 5 | Mettre la bande **dans** `#app-body` | En Zen (F11), `#sidebar` disparaît et la bande avec : **plus aucun bouton** pour fermer ou déplacer |
| 6 | Fond rouge plein au survol de Fermer | Croix à **2,77:1** en sombre : on ne voit plus ce qu'on clique (§4.1) |
| 7 | `z-index` inférieur à 99990 | En mode immersif, les boutons **disparaissent** : impossible de fermer sans quitter le mode |
| 8 | Activer `transparent: true` | Redimensionnement par les bords erratique et artefacts de repeint : la fenêtre « saute » quand on tire un bord |
| 9 | Appeler `destroy()` au lieu de `close()` | Court-circuite la confirmation **et** le keep-alive (`lib.rs:3433-3438`) : l'utilisateur ferme et perd la session gardée en arrière-plan |
| 10 | Ajouter un clic droit « maison » sur la bande au lot 0.1 | Un menu à moitié faux (Déplacer/Taille impossibles à reproduire) : l'utilisateur cherche des gestes clavier qui n'existent pas. Mieux : rien, puis Q1 |

---

## 8. Lots

### 8.1 Où se place ce travail : **avant** les 7 lots existants — c'est le **lot 0**

Trois raisons mesurables :

1. Le document de présentation mesure tout **depuis y = 0 du contenu**
   (`docs/proposition-presentation-ui.md:225-228`). Retirer la barre système change
   l'origine de ~32 px : mesurer avant, c'est mesurer deux fois.
2. Son lot 4 crée `#context-bar` **au-dessus** des onglets (`:232`). Cette bande
   doit s'empiler **sous** la bande de fenêtre ; dans l'autre ordre, le lot 4 serait
   à refaire.
3. Son lot 2 fixe la bande d'identité à **48 px** (`:119`). Avec la bande de fenêtre
   connue (32 px), la hauteur totale du haut est **80 px** avant de dessiner le lot 2.

### 8.2 Ordre de livraison

| Lot | Contenu (entièrement visible à la livraison) | Fichiers | Vérification attendue |
|---|---|---|---|
| **0.1** | La barre système disparaît ; la bande Pilot apparaît avec ses 3 boutons qui marchent | `src-tauri/src/lib.rs` (`setup` `:3236`), `src-tauri/capabilities/default.json` (après `:10`), `index.html` (avant `:21`), `src/css/style.css` (bande + `#agent-activity` `:1383-1387`), `src/js/window-controls.js` (neuf), `src/js/main.js` (`:337`) | 1) La barre système n'est plus là. 2) Réduire réduit. 3) Agrandir agrandit, l'icône devient « Restaurer ». 4) Fermer affiche la confirmation actuelle. 5) Glisser depuis le haut gauche déplace la fenêtre. 6) Double-clic agrandit. 7) Les 4 bords et 4 coins redimensionnent. 8) La pastille de suivi est visible et cliquable. 9) F11 : la bande reste. 10) `npm test` et `cargo test --manifest-path src-tauri/Cargo.toml --lib` verts |
| **0.2** | Les états et le clavier : survol, appui, focus visible, `aria-label`, icône synchronisée | `src/css/style.css`, `src/js/window-controls.js` | Tab depuis le haut atteint les 3 boutons, anneau visible sur chacun ; survol et appui conformes au §4.1 ; après agrandir puis restaurer, l'icône est juste dans les deux sens ; lecture d'écran : les 3 boutons sont nommés |
| **0.3** | Le mode immersif : boutons visibles au-dessus, aucune collision avec le bouton retour | `src/css/style.css` (§5.3, 2 règles) | En immersif : les 3 boutons sont là et actifs ; le bouton retour de l'overlay n'est pas recouvert ; fermer en immersif rend la main |
| **0.4** | Fenêtre étroite + thème clair : contrôle des contrastes et de l'ellipse | `src/css/style.css` si un chiffre bouge | À 800 px : rien ne déborde, la zone de glissement reste ≥ 600 px ; en thème clair et dans les 4 sous-thèmes clairs, les 5 états du §4.1 tiennent |
| **0.5** *(optionnel — dépend de Q1)* | Menu « Disposer » : moitié gauche, moitié droite, plein écran | `src/js/window-controls.js`, `src/css/style.css` | Clic droit sur « Agrandir » : 3 entrées, chacune place la fenêtre comme annoncé ; Échap ferme le menu |
| **0.6** *(différé — dépend d'une machine)* | macOS (feux natifs, réserve de 28 px) et Linux (sans cadre) | `src-tauri/src/lib.rs`, `src/css/style.css` | Sur un Mac : feux tricolores visibles, rien dessous ; sur Linux : 3 boutons, bords redimensionnables |

### 8.3 Documentation à mettre à jour avec le lot 0.1

`README.md:34` (« Titre de fenêtre dynamique ») et `README.md:547`
(`set_window_title`), `spec_pilot.md` (§ zones de l'interface) — **seulement** après
la réponse à Q2, qui décide du texte du titre.

---

## 9. Trois questions fermées

| # | Question | Réponse recommandée | Ce que ça débloque |
|---|---|---|---|
| **Q1** | L'agencement Windows 11 est perdu de toute façon (Tauri #4531). Ajoute-t-on un menu « Disposer » (clic droit sur « Agrandir » : moitié gauche / moitié droite / plein écran) ? | **Oui** — c'est le seul moyen de retrouver le geste de partage d'écran, que vous utilisez déjà (version dev + version installée côte à côte) | Le lot 0.5 (existe ou n'existe pas) |
| **Q2** | Quel texte la fenêtre donne-t-elle au système (barre des tâches, Alt+Tab) ? Aujourd'hui : `Pilot <chemin complet>` (`sidebar.js:493`) | **`Pilot — <nom du dossier>`** (sans le chemin) : court, utile, et ça corrige un vrai défaut | Le texte de `lib.rs:2809`, donc le lot 0.1 **et** `README.md:34` |
| **Q3** | En mode immersif, les 3 boutons restent-ils visibles au-dessus de l'overlay ? | **Oui** — sinon on ne peut plus fermer ni déplacer Pilot sans quitter le mode | Le lot 0.3 (§5.3, les 2 règles) |

---

## 10. VERDICT

| Point | Verdict |
|---|---|
| **Prêt à appliquer** | **Oui** pour les lots 0.1 → 0.4 sur Windows : toutes les valeurs sont chiffrées, tous les points de branchement sont nommés avec leur `fichier:ligne`, aucune décision antérieure n'est rouverte |
| **Reste à décider** | Q1 (menu « Disposer »), Q2 (texte du titre), Q3 (boutons en immersif). Aucune des trois ne bloque le lot 0.1, sauf Q2 qui fixe une chaîne de caractères à écrire dans ce lot |
| **Non vérifié ici** | (1) le redimensionnement par les bords d'une fenêtre sans cadre **sur ce poste Windows** ; (2) le comportement de `Win` + flèches ; (3) Alt+F4 ; (4) le rendu macOS et Linux (aucune machine). Les points 1 à 3 se vérifient en 2 minutes au lot 0.1 ; s'ils échouent, l'option b reste le repli documenté (§2) |

DONE: 333 lignes — options comparées : (a) fenêtre sans cadre + bande Pilot dédiée de 32 px, (b) cadre système conservé avec en-tête simplifié, (c) sans cadre avec les 3 boutons dans la rangée d'onglets — recommandation : **option a** — 6 lots (0.1 à 0.6, dont 4 fermes et 2 optionnels/différés) — questions : Q1 menu « Disposer » ? Q2 texte du titre système ? Q3 boutons visibles en mode immersif ?
