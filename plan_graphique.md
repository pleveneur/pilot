# Plan de Conception — Refonte Graphique de Pilot

> **Source** : `refonte_graphique.md` (cadrage UI/UX, style Linear/Zed/Cursor/Raycast).
> **Contrainte majeure** : CSS Vanille + Variables CSS + Vite + Lucide inline.
> **Anti-régression** : ne jamais modifier les `id` HTML ni les classes ciblées par
> `src/js/*.js` ; mettre à jour les propriétés visuelles en conservant les sélecteurs.

---

## État actuel (constaté)

- `src/css/style.css` : **5492 lignes**, thème Catppuccin (Mocha dark / Latte light).
- Tokens actuels : `--bg-main`, `--bg-secondary`, `--bg-sidebar`, `--bg-tab`, `--bg-editor`,
  `--bg-input`, `--bg-hover`, `--bg-context`, `--text-primary/secondary/muted`, `--border`,
  `--accent`, `--danger`, `--success`, `--shadow-sm/md/lg`, `--ring`, `--cat-*`.
- Bordures opaques dures (`--border: #45475a`), fonds plats, pas de layering en surfaces.
- Chat agent : `.agent-chat-messages`, `.agent-message-*`, `.agent-bubble-*`, `.agent-stream-flow`.
- Orchestration : section `/* --- Mode Orchestration --- */` (ligne 3865).
- Web remote : `web/css/web.css` (142 lignes, tokens `--bg/--fg/--accent/--card/--border`).
- Thème appliqué via `body.theme-dark` / `body.theme-light` (`src/js/theme.js`).

---

## Stratégie générale

1. **Ajouter** les nouveaux design tokens (surfaces, bordures subtiles, ombres, typo,
   radius, transitions) **sans supprimer** les tokens existants — les anciens restent
   utilisés par de nombreux sélecteurs. On les **re-définit** pour pointer vers les
   nouveaux (alias), puis on migre progressivement les composants vers les nouvelles
   variables.
2. **Conserver tous les sélecteurs** existants ; ne changer que les valeurs visuelles.
3. **Vérifier visuellement** après chaque sprint (`npm run dev`).
4. **Quality-gate** avant chaque commit.

---

## Sprints de réalisation

### Sprint 1 — Design Tokens & Base Globale (`src/css/style.css`) ✅
- [x] Redéfinir `:root`, `.theme-dark`, `.theme-light` :
  - Typo UI : `"Inter", "Geist", -apple-system, ...` ; Mono : `"JetBrains Mono", ...`.
  - Échelle `--font-xs/sm/base/md/lg/xl` + graisses 400/500/600.
  - Surfaces : `--bg-app`, `--surface-1/2/3`, `--surface-floating`.
  - Bordures : `--border-subtle`, `--border-hover`, `--border-active` (semi-transparentes).
  - Ombres : `--shadow-xs/sm/md/lg` + `--shadow-glow`.
  - Radius : `--radius-xs/sm/md/lg/xl`.
  - Transitions : `--transition-fast/normal/smooth` + courbe `cubic-bezier(0.16,1,0.3,1)`.
  - **Alias legacy** : `--bg-main → --surface-1`, `--bg-sidebar → --bg-app`,
    `--bg-input → --surface-2`, `--bg-hover → --surface-3`, `--border → --border-subtle`,
    `--text-primary/secondary/muted` conservés, `--accent` conservé.
- [x] Reset typographique global (`body`, `button`, `input`, `select`, `textarea`).

### Sprint 2 — Structure, Topbar & Sidebar ✅
- [x] Header / bouton Projets : bouton épuré icône + nom + flèche, dropdown en carte flottante.
- [x] Barre « Projets ouverts » : pastilles d'activité animées (`pulse`), bouton ✕ au survol.
- [x] Boutons d'action topbar (🔗 🎭 ❓ ⚙️) : icon-buttons épurés, hover `--surface-2`.
- [x] Sidebar & treeview : hauteur de ligne ~28px, hover arrondi pleine largeur, sélection
      avec indicateur latéral, badges Git en pilules pastel, icônes alignées.
- [x] Splitters ultra-fins avec poignée au survol.

### Sprint 3 — Onglets, Éditeur & Prévisualisation ✅
- [x] Barre d'onglets : style "pills"/tabs intégrées, onglet actif surélevé, ✕ micro-animé,
      onglets spéciaux (π, Terminal, Review, Help) avec accent discret (classe `tab-special`).
- [x] CodeMirror 6 : harmoniser avec les variables (gouttière `--text-muted`, curseur/sélection fluides).
- [x] Split view : resizer fin ; Markdown modernisé (blocs code `--radius-md` + bouton copier
      `⧉` sur chaque `pre`, via `attachCopyButtons`), Mermaid élégant ; PDF/CSV/Image harmonisés.

### Sprint 4 — Panneau Agent Pi, Chat & Orchestration ✅
- [x] Fil de discussion : séparation nette user/agent/pensées.
  - Messages user : carte à fond accentué (alignés à droite).
  - Pensées : accordion épuré sur `--surface-1`, bordure fine, texte tamisé.
  - Tool calls : cartes "Code/Commande" avec statut (en cours/succès/erreur).
- [x] Prompt bar : "floating input bar", textarea auto-extensible, boutons intégrés
      (modèle, 🎙️, mode, envoi).
- [x] Mode Orchestration : pipeline vertical / stepper, badges d'état pastel.

### Sprint 5 — Modales, Menus Contextuels, Thème Clair & Web Remote ✅
- [x] Modales : backdrop flouté (`blur(8px)`), boîte `--radius-xl`, ombre prononcée,
      en-tête fixe + pied aligné à droite.
- [x] Menus contextuels : style macOS/Raycast, `--radius-md`, séparateurs fins entre groupes
      logiques (`.menu-separator`, masqués si orphelins via `_syncMenuSeparators`),
      raccourcis alignés à droite en `--text-muted` (`.menu-shortcut`/`kbd`).
- [x] Décliner minutieusement le **thème clair** (`.theme-light`).
- [x] Harmoniser `web/css/web.css` (tokens alignés sur le desktop).

### Sprint 6 — Validation Quality Gate & Tests Visuels ✅
- [x] `npm run build` + `npm run dev` sans régression.
- [x] Vérifier les 3 plateformes (Windows/macOS/Linux).
- [x] Fluidité & réactivité globales.

---

## Règles de non-régression (rappel)

- Ne pas toucher aux `id` (`#chat-messages`, `#file-tree`, `#project-btn`, …) ni aux
  classes JS (`.tab-item`, `.tree-node`, `.btn-orchestration`, …).
- Ne pas supprimer massivement de règles ; mettre à jour les valeurs visuelles.
- Valider chaque sprint visuellement.
- Consulter `.pi/skills/quality-gate/SKILL.md` avant chaque commit.
