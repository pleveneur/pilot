# RAPPORT — Lot 0.5 (barre de fenêtre) : menu « Disposer »

## État avant
- La bande Pilot portait ses trois boutons ; le **clic gauche** sur `#win-max` appelait
  `toggleMaximize()`. Aucun **clic droit**, donc aucun équivalent de l'agencement Windows 11.
- ACL : seuls `minimize`, `toggle-maximize`, `close`, `start-dragging` étaient accordés
  (`set-position` / `set-size` **manquaient** : la fenêtre n'aurait pas pu être placée).
- Menus existants : classe `.context-menu` (z-index **200**, donc **sous** la bande à 100001).

## État après
- **Clic droit** sur « Agrandir » → menu `#dispose-menu`, 3 entrées : « Moitié gauche de
  l'écran », « Moitié droite de l'écran », « Plein écran ». **Le clic gauche est inchangé.**
- Mécanisme de placement (`applyDisposeZone`) : `currentMonitor()` → **zone utile**
  (`workArea`, barre des tâches exclue, écran secondaire géré) ; si la fenêtre est agrandie
  elle est d'abord **restaurée** (`toggleMaximize`, seule voie déjà autorisée), puis
  `setPosition(PhysicalPosition)` + `setSize(PhysicalSize)`. Moitiés : `floor(largeur/2)` à
  gauche, le reste à droite (aucun trou, largeur impaire comprise). « Plein écran » =
  **agrandissement** sur toute la zone utile (Pilot n'a aucun état plein écran : F11 = mode Zen ;
  un vrai plein écran serait un état **dont on ne sortirait pas** par ce menu).
- **Échap** ferme le menu (écoute `keydown` posée une fois, inerte menu fermé) ; **appui hors
  du menu** le ferme (écoute `mousedown` en capture, `!disposeMenu.contains(e.target)`).
- Le menu reprend `.context-menu` (jetons de surface → sombre **et** clair), et `#dispose-menu`
  passe à **z-index 100002** (> 100001) : il ne passe jamais sous la bande ; son `top` est
  borné sous la bande et dans la fenêtre.

## Fichiers touchés
- `src/js/window-controls.js` — `computeDisposeTarget` (pure), `applyDisposeZone`,
  `openDisposeMenu` / `closeDisposeMenu` / `isDisposeMenuOpen`, câblage `contextmenu` + Échap.
- `src/css/style.css` — 2 règles (`#dispose-menu`, `#dispose-menu > button`), aucun jeton modifié.
- `src-tauri/capabilities/default.json` — **ajout** de `core:window:allow-set-position` et
  `core:window:allow-set-size` (nécessaires et suffisantes ; aucun garde-fou contourné) ;
  `src-tauri/gen/schemas/capabilities.json` (miroir **généré**) régénéré par `cargo check`.
- `src/js/barre-fenetre-disposer.test.js` — **nouveau test** (25 cas) : ordre et libellés, cibles (moitiés, largeur impaire, barre des tâches, écran secondaire, cas illisibles), clic gauche inchangé, Échap + clic extérieur, placement réel, z-index au-dessus de la bande.
- Non touchés : `main.js`, `index.html`, `docs/`, `spec_pilot.md`, `README.md`, onglets.

## Tests
- `npm test` : **166 fichiers / 2906 tests passés, 0 échec** (dont les 25 nouveaux).
- `cargo check --manifest-path src-tauri/Cargo.toml --lib` : **OK** (20,4 s) — l'ACL accepte
  les deux permissions ajoutées.

## Reste à faire (essai à l'écran, par le propriétaire)
1. Clic droit sur « Agrandir » → les 3 entrées s'affichent sous le bouton, dans les deux thèmes.
2. Moitiés gauche / droite : la fenêtre occupe bien la moitié, sans passer sous la barre des
   tâches ; essai sur un second écran si disponible ; fenêtre très étroite (< 800 px) :
   `minWidth: 800` peut empêcher la moitié exacte.
3. « Plein écran » : agrandissement (barre des tâches visible). Si le propriétaire veut un vrai
   plein écran (sans barre des tâches), c'est une décision à prendre : elle demanderait
   `allow-set-fullscreen` **et** une entrée de sortie — hors périmètre de ce lot.
4. Échap et clic ailleurs : le menu se ferme ; le clic gauche sur Agrandir agrandit toujours.
