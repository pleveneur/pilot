# RAPPORT — Suppression de la bande de fenetre de 32 px (boutons dans la rangee d'onglets)

> Etude de reference appliquee : `docs/proposition-barre-fenetre.md` (seule etude
> sur la barre de fenetre presente sur disque, 333 lignes, verifiee avant
> modification). Decisions du proprietaire appliquees telles quelles :
> Q1 = OUI (option « sans cadre + 3 boutons dans la rangee d'onglets »),
> Q2 = NON (aucune marge de 24 px en mode Zen), Q3 = NON (les 3 boutons ne sont
> pas masques sur macOS).
>
> Statut de ce rapport : TERMINE.

## 1. Etat AVANT (releve sur disque, pas de memoire)

| Element | Etat constate | Preuve |
|---|---|---|
| Bande haute | `<div id="window-bar">` premier enfant de `<body>`, 32 px, `position: relative; z-index: 100001`, filet bas, contient `#window-controls` | `index.html:25`, `src/css/style.css:77` (`#window-bar`), `:99` (`#window-controls`), `:107` (`> button`, 46 x 32) |
| Hauteur | une seule source : `--window-bar-height: 32px` dans `:root`, consommee par la bande, les boutons et le mode immersif | `src/css/style.css:85`, `:79`, `:109`, `:10590` |
| Rangee d'onglets | `#tab-row` (36 px + 1 px de filet) : `#tab-bar` puis `#agent-activity` (« Travail ») | `index.html:180-241`, `src/css/style.css:1782` |
| Gestes | glisser + double-clic cables sur `#window-bar` uniquement, garde-fou `closest("button")` | `src/js/window-controls.js` (`initWindowControls`) |
| Mode immersif | overlay `inset: 0` decale de 32 px vers le bas pour degager la bande ; la bande reste au-dessus (z 100001) | `src/css/style.css:10566-10592` |
| Mode Zen | `#sidebar`, `#global-actions`, `#project-footer` masques ; la bande (hors `#app-body`) restait visible | `src/css/style.css:3617-3620` |
| Tests decrivant la bande | `barre-fenetre-etats.test.js`, `barre-fenetre-disposer.test.js` | lecture integrale des deux fichiers |

Compteur de reference : **2932 tests verts** avant modification (`npx vitest run`,
HEAD `90f73e0`).

## 2. Ce qui a ete retire (un seul lot)

1. **Le bloc HTML `#window-bar`** : supprime entierement (`index.html`). Le corps
   de l'application (`#app-body`) commence desormais au premier pixel de la
   fenetre. Aucun element n'est laisse a la place (pas un `div` vide).
2. **Les 32 px de chrome** : `--window-bar-height: 32px` retiree de `:root`
   (aucun consommateur ne reste) ; la hauteur est desormais celle du mobilier qui
   porte les boutons (la rangee d'onglets, 36 px).
3. **La regle de decalage du mode immersif** :
   `body.superagent-immersive-active .superagent-immersive { top: var(--window-bar-height) }`
   supprimee : l'overlay demarre tout en haut (`inset: 0`), et sa propre barre
   (`.sa-immersive-top`, 58 px) occupe les premiers pixels. `padding-right: 146px`
   de cette barre est **conserve** : il evite le recouvrement avec les 138 px des
   trois boutons, qui restent au-dessus (z 100001).
4. **L'ancien cablage des gestes** : plus aucune reference a `#window-bar`, plus
   de `closest("button")` isole (remplace par un garde-fou unique et etendu).

Ce qui n'a **pas** ete retire, volontairement : les trois boutons eux-memes, leurs
libelles (`Reduire`, `Agrandir la fenetre`, `Restaurer la fenetre`, `Fermer Pilot`),
leurs etats (survol / appui / focus / survol de Fermer), le menu « Disposer »,
`close()` (jamais `destroy()`), et la lecture de `isMaximized()` au demarrage.

## 3. Nouvelle structure

```
<body>
  #boot-overlay                      (inchange, z 99999)
  #app-body                          <-- commence en haut de la fenetre
    #sidebar
      #project-selector  48 px       <-- zone de glissement n°1
      ...
    #main-area
      #tab-row           36 px       <-- tout en haut de la fenetre
        #tab-bar         (flex 1 1 auto, overflow-x: auto)
        #agent-activity  (entree « Travail », ne defile pas)
        #window-controls (3 boutons, dernier enfant, flex 0 0 auto)
      #main-content
```

- Ordre du DOM des boutons inchange : **Reduire → Agrandir → Fermer** (donc ordre
  du Tab inchange).
- Les trois boutons sont le **dernier enfant de `#tab-row`** : leur place
  (3 x 46 px = **138 px**) est **reservee dans le flux** (`flex: 0 0 auto`), donc
  **aucun onglet ne passe dessous** et aucune marge de reservation n'a ete ajoutee.
- Verifications automatiques : 424 `<div>` ouvrantes / 424 fermantes, profondeur
  finale 0 ; `#window-bar` absent du HTML (`indexOf` = -1) ; ordre verifie
  `#app-body` < `#tab-row` < `#tab-bar` < `#agent-activity` <
  `#window-controls` < `#main-content`.
- Ancetres (`#app-body`, `#main-area`, `#tab-row`) : ni `z-index`, ni `transform`,
  ni `filter`, ni `isolation` — le `z-index: 100001` des boutons joue donc bien
  dans le contexte racine et les garde au-dessus du chargement (99999), des
  dialogues d'agent (100000) et de l'overlay immersif (99990).

### Gestes de fenetre (reportes, pas perdus)

| Geste | Zone n°1 | Zone n°2 |
|---|---|---|
| Glisser | `#project-selector` (bandeau du nom de projet) | vide de `#tab-row` |
| Double-clic | idem | idem |

Garde-fou **unique** (`WINDOW_GESTURE_BLOCKLIST`) : `button, a, input, select,
textarea, .tab, .projects-dropdown, #agent-activity, #window-controls,
[role='button'], [role='tab'], [role='menuitem']`. Un clic sur un onglet, le
bouton « Projets », le menu des projets, l'entree « Travail » ou un bouton de
fenetre ne deplace donc jamais la fenetre (`closest` remonte les ancetres : cliquer
l'icone d'un bouton est bloque comme cliquer le bouton).
`user-select: none` a ete pose sur `#project-selector` et sur `#tab-bar` (l'ancienne
bande le portait) pour qu'un double-clic n'agrandisse pas la fenetre *et* ne
selectionne pas de texte.

En **mode Zen** (F11), `#sidebar` disparait : la zone n°1 s'en va, la zone n°2
reste — la fenetre reste donc toujours deplacable (aucune marge vide de 24 px
ajoutee : Q2 = NON).

## 4. Valeurs retenues (aucune couleur en dur, aucun nouveau jeton)

| Valeur | Retenue | Justification |
|---|---|---|
| Largeur d'un bouton | `46px` | inchange (etude §3.2) |
| Hauteur d'un bouton | `height: 100%` | **remplace** `32px` : les boutons occupent la hauteur du mobilier ou ils vivent (la rangee, 36 px). Aucune hauteur nouvelle inventee |
| Hauteur de la rangee | `min-height: 36px` | valeur existante de `#tab-row`, non modifiee |
| Largeur totale du groupe | 3 x 46 = **138 px** | inchange |
| Empilement | `position: relative; z-index: 100001` | reporte du bloc `#window-bar` (etude §7 piege 7) |
| Flexion | `flex: 0 0 auto; align-self: stretch` | le groupe ne se comprime jamais : c'est lui qui reserve sa place |
| Couleurs | `--surface-3`, `--text-primary`, `--text-secondary`, `--danger`, `--accent`, `--accent-hover`, `--radius-xs` | jetons existants uniquement, donc les 8 sous-themes suivent sans une ligne de plus |

Contrastes : le fond reel derriere les boutons est desormais `#tab-row`
(`background: var(--bg-sidebar)`), soit `--bg-sidebar`, qui est un **alias de
`--bg-app`** dans les deux themes de base (et non redefini par les 8 sous-themes).
Les contrastes mesures au lot 0.2 / 0.4 (`--text-secondary` sur `--bg-app` = 7,75:1
en sombre, 5,70:1 en clair) restent donc **exacts**, et les 4 corrections de
sous-themes clairs restent justifiees.

## 5. Tests et documentation

### Tests mis a jour (ils decrivaient l'ancienne structure)

| Fichier | Changement |
|---|---|
| `src/js/barre-fenetre-etats.test.js` | Section CSS ancree sur `BOUTONS DE FENETRE PILOT` (au lieu de `BANDE DE FENETRE PILOT`). Nouveau test : `#window-bar` absent du HTML et du CSS, `--window-bar-height` absente. Bouton = `46 px x 100%` (au lieu de `46 x var(--window-bar-height)`), et `#tab-row` garde `min-height: 36px`. Ordre du DOM recalcule (rangee → barre → « Travail » → boutons, avant `#main-content`). Gestes : `WINDOW_DRAG_ZONE_IDS` = `["project-selector","tab-row"]`, boucle de cablage, `startDragging()` toujours present, et verification que **les deux** gestionnaires appellent `isWindowGestureTarget(e.target)` (2 occurrences) — l'ancien `closest("button")` x2 est remplace par ce garde-fou unique, teste sur de faux noeuds (aucun DOM requis) |
| `src/js/barre-fenetre-disposer.test.js` | `bandHeight()` → `controlsHeight()` ; le z-index du menu « Disposer » est desormais compare a `#window-controls` (au lieu de `#window-bar`) ; il reste strictement superieur (menu au-dessus des boutons) |
| `src/js/panneau-suivi-trois-onglets.test.js` | Commentaire de structure corrige et assertion ajoutee : `#window-controls` est **dans** `#tab-row`, **apres** `#agent-activity` (les boutons ne passent pas sous les onglets) |

### Resultat des tests

- Avant : **2932** tests verts.
- Apres : **2935** tests verts, **0 echec** (`npx vitest run`, compteur releve par
  l'agent). Delta +3 = 2 tests nouveaux (bande disparue, hauteur de rangee
  conservee) + 1 test nouveau (garde-fou unique des gestes).
- Aucun autre test ne decrivait la bande : la suite complete est verte.

### Documentation mise a jour

| Fichier | Changement |
|---|---|
| `spec_pilot.md` §1 | « **Bande de fenetre** (`#window-bar`, 32 px…) » → « **Boutons de fenetre** (`#window-controls`, groupe fixe haut-droite au bout de la rangee d'onglets) » : suppression de la bande, place reservee, `z-index 100001`, deux zones de glissement et garde-fou, mode immersif sans decalage |
| `spec_pilot.md` §B | La rangee d'onglets est decrite « **tout en haut de la fenetre** — plus aucune bande au-dessus » et porte trois blocs (barre, « Travail », boutons) |
| `README.md` § « Barre de fenetre » | Reecrit cote utilisateur : plus de bande, **32 px gagnes**, boutons en haut a droite au bout des onglets, deplacement depuis le bandeau du nom de projet **ou** le vide de la rangee, jamais depuis un onglet |
| `docs/proposition-barre-fenetre.md` | En-tete de statut remplace : la proposition n'est plus « non appliquee » mais « APPLIQUEE dans sa variante option 2 », avec Q1/Q2/Q3 tranchees et renvoi vers la spec, le README et ce rapport. Le corps de l'etude est conserve (il reste la justification chiffree de l'etat ANTERIEUR) |

Aucun fichier Rust n'a ete modifie. Aucun fichier supprime. Aucun changement de
version. Aucun push, aucun tag.

Portee du commit : les 8 fichiers suivis modifies ci-dessus. `docs/proposition-barre-fenetre.md`
(en-tete de statut mis a jour) est, comme les autres documents de proposition et
les `RAPPORT-*.md`, **non suivi** par git (`??`) : il reste modifie sur disque et
n'a **pas** ete ajoute au commit, pour ne pas melanger des brouillons de travail
au lot de code.

## 6. Ecarts et doutes signales (non corriges seuls)

1. **Commentaire Rust devenu imprecis** — `src-tauri/src/lib.rs:3468` dit encore
   « ses trois boutons vivent desormais dans la bande `#window-bar` ». Le
   comportement est inchange et correct (la fenetre perd son cadre sous Windows et
   Linux, macOS garde le sien), seule la phrase cite un element qui n'existe plus.
   **Non corrige** : le perimetre de ce lot exclut les fichiers Rust. Correction
   proposee (une ligne de commentaire, aucun effet fonctionnel) : remplacer
   « dans la bande `#window-bar` » par « au bout de la rangee d'onglets
   (`#window-controls`) ».
2. **Mode immersif : les boutons recouvrent le coin droit de la barre de l'overlay**
   — c'est le comportement voulu (Q3 + etude §5.3), et `.sa-immersive-top` garde
   `padding-right: 146px`, donc le titre et le bouton retour ne passent pas dessous.
   A verifier a l'ecran (§7), car je n'ai pas pu lancer l'application ici.
3. **macOS** — Q3 = NON : les feux tricolores natifs **et** les trois boutons Pilot
   coexistent donc en haut a droite / en haut a gauche. L'etude signalait deja que
   macOS n'est pas verifiable sans machine ; aucune regle `body.apple` n'a ete
   ajoutee ni retiree (il n'en existait aucune pour `#window-bar` dans le CSS).
4. **Redimensionnement par les bords** — le haut de la fenetre est desormais la
   rangee d'onglets : les 4 px superieurs restent une zone de redimensionnement
   systeme, comme sur la barre native. Non verifiable ici, a essayer a l'ecran.
5. **Zone de glissement n°2 « petite »** — avec beaucoup d'onglets ouverts, le vide
   de `#tab-bar` se reduit ; c'est exactement le cout que l'etude attribuait a
   l'option c (§2). Il est compense par la zone n°1 (bandeau du nom de projet,
   toujours presente hors mode Zen) : c'est la raison pour laquelle les deux zones
   ont ete cablees, et non une seule.
6. **Aucun test de rendu** — la suite verifie le CSS et le DOM, pas le pixel. Les
   points ci-dessous (§7) sont la seule verification possible du rendu.

## 7. Points a essayer a l'ecran

1. **Haut de la fenetre** : la fenetre commence par la rangee d'onglets, sans aucun
   liseré noir ni bande vide ; le gain est de 32 px.
2. **Les trois boutons** : Reduire reduit ; Agrandir agrandit et l'icone devient
   « Restaurer » ; Fermer affiche la confirmation habituelle (ou met en veille).
3. **Aucun onglet sous les boutons** : ouvrir 8 a 10 onglets, faire defiler la barre
   horizontalement jusqu'au bout — le dernier onglet s'arrete avant les boutons, et
   il reste toujours atteignable.
4. **Deplacement** : glisser depuis le **bandeau du nom de projet** (colonne de
   gauche) et depuis le **vide de la rangee d'onglets** ; double-clic aux deux
   endroits = agrandir / restaurer.
5. **Non-regression des clics** : cliquer un onglet, le bouton « Projets », le menu
   des projets, l'entree « Travail » — la fenetre ne bouge pas et les gestes
   habituels fonctionnent.
6. **Mode immersif** (Assistant seul) : les trois boutons restent visibles et
   actifs au-dessus de l'ecran ; la barre de l'overlay (bouton retour) n'est pas
   recouverte a droite.
7. **Mode Zen** (F11) : la colonne de gauche disparait, les boutons restent, et la
   fenetre reste deplacable depuis le vide de la rangee d'onglets.
8. **Menu « Disposer »** : clic droit sur Agrandir → les trois placements ; le menu
   s'affiche **au-dessus** des boutons et jamais derriere eux.
9. **Fenetre etroite** (800 px) : rien ne deborde, les trois boutons restent
   entierement visibles.
10. **Sous-themes** : passer en theme clair (et un sous-theme clair, ex. One Light)
    — survol des boutons, croix de Fermer et anneau de focus (`Tab`) restent
    lisibles.

VERDICT : applique et verifie automatiquement (2935 tests verts, 0 echec, DOM
equilibre, aucun vestige de `#window-bar` dans le HTML, le CSS ou le JS) ; reste a
confirmer a l'ecran les 10 points du §7, en particulier le mode immersif, le
mode Zen et le redimensionnement par les bords (aucune application lancee ici).
