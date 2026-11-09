# Spécification et Guide d'Exécution — Refonte Graphique de Pilot

> **Document de cadrage pour l'agent de codage**  
> **Objectif** : Refonte visuelle complète (UI/UX) de l'interface graphique de Pilot pour atteindre un standard moderne, épuré et haut de gamme (style Linear, Zed, Cursor, Raycast).

---

## 1. Vision & Principes Directeurs

### 1.1 Objectif visuel
L'interface actuelle de Pilot est fonctionnelle et propre, mais elle utilise un style visuel classique. L'objectif est de lui donner une allure **professionnelle, moderne, fluide et élégante**, sans alourdir le code ni dégrader les performances.

### 1.2 Choix d'Architecture Technique (Contraintes)
* **Stack inchangée** : Conserver **CSS Vanille + Variables CSS + Vite + SVG Lucide inline**.
* **Pas de framework lourd (pas de Tailwind CSS, Bootstrap, MUI, etc.)** :
  * *Pourquoi ?* Pour éviter de briser la compatibilité avec CodeMirror 6, xterm.js, markdown-it, PDF.js et l'ensemble des modules JS manipulant le DOM.
  * *Avantage* : Zéro dépendance supplémentaire, performances maximales, contrôle total sur le CSS.
* **Non-régression fonctionnelle** :
  * Interdiction de modifier les `id` HTML ou les classes de comportements clés utilisés par les scripts JavaScript (`src/js/*.js`).
  * Tout changement visuel doit respecter le protocole anti-régression (`.pi/skills/quality-gate/SKILL.md`).

---

## 2. Charte Visuelle & Design Tokens (À implémenter dans `:root`, `.theme-dark`, `.theme-light`)

### 2.1 Typographie
* **Police principale (UI)** :
  * Utiliser une pile typographique moderne avec fallback propre :  
    `font-family: "Inter", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;`
* **Police Mono (Code & Terminal)** :  
  `font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace;`
* **Échelle de tailles & graisses** :
  * `--font-xs`: `11px` (badging, hints)
  * `--font-sm`: `12px` (arborescence, métadonnées, sous-titres)
  * `--font-base`: `13px` (texte d'interface, boutons, menus, chat)
  * `--font-md`: `14px` (titres de sections, onglets)
  * `--font-lg`: `16px` (titres de modales)
  * `--font-xl`: `20px` (grands titres)
  * Graisses : `400` (normal), `500` (medium), `600` (semibold).

### 2.2 Hiérarchie des Surfaces (Layering / Elevation)
Ne pas utiliser un fond unique plat. Structurer l'interface en 4 niveaux de profondeur :
* `--bg-app` : Fond général de l'application (le plus sombre/profond).
* `--surface-1` : Barre latérale, barre de statut, fond de l'éditeur.
* `--surface-2` : Onglets inactifs, cartes, bulles de message, champs de saisie.
* `--surface-3` : Onglet actif, survol d'éléments, en-têtes de modales.
* `--surface-floating` : Menus déroulants, popups, menus contextuels, modales (avec `backdrop-filter: blur(16px)` quand supporté).

### 2.3 Subtilité des Bordures
* Supprimer les bordures opaques dures (`#45475a`).
* Remplacer par des bordures très fines et semi-transparentes :
  * En Mode Dark : `1px solid rgba(255, 255, 255, 0.07)` à `rgba(255, 255, 255, 0.12)`.
  * En Mode Light : `1px solid rgba(0, 0, 0, 0.06)` à `rgba(0, 0, 0, 0.10)`.
* Variable dédiée : `--border-subtle`, `--border-hover`, `--border-active`.

### 2.4 Ombres & Lumières (Shadows & Glows)
* `--shadow-xs` : `0 1px 2px rgba(0, 0, 0, 0.12)`
* `--shadow-sm` : `0 2px 8px rgba(0, 0, 0, 0.20)`
* `--shadow-md` : `0 8px 24px rgba(0, 0, 0, 0.28)`
* `--shadow-lg` : `0 16px 40px rgba(0, 0, 0, 0.40)`
* `--shadow-glow` : `0 0 16px rgba(137, 180, 250, 0.15)` (halo sur focus / action principale)

### 2.5 Rayons de Courbure (Border Radius)
* `--radius-xs`: `4px` (badges, indicateurs)
* `--radius-sm`: `6px` (boutons compacts, items de liste, inputs)
* `--radius-md`: `8px` (cartes, onglets, blocs de code)
* `--radius-lg`: `12px` (modales, volets coulissants, bulles de chat)
* `--radius-xl`: `16px` (dialogues principaux, grands conteneurs)

### 2.6 Micro-interactions & Animations
* Courbe de transition unifiée : `cubic-bezier(0.16, 1, 0.3, 1)` (effet "spring" très réactif et élégant).
* Durées :
  * `--transition-fast`: `0.1s` (hovers, clics de bouton)
  * `--transition-normal`: `0.2s` (ouverture de sous-menus, onglets)
  * `--transition-smooth`: `0.3s` (modales, volets)
* Animations CSS (`@keyframes`) :
  * Fade-in + Zoom léger (`scale(0.97)` → `scale(1)`) pour les modales et dropdowns.
  * Slide-up doux (`translateY(6px)` → `translateY(0)`) pour les nouveaux messages du chat.

---

## 3. Spécifications Visuelles par Composant

### 3.1 Barre Principale & En-tête (Topbar / Header)
* **Bouton Projets** :
  * Bouton épuré avec icône Lucide + nom du projet actif + flèche discrète.
  * Menu déroulant "Projets récents" restylisé sous forme de carte flottante à coins arrondis avec ombrage doux.
* **Barre des projets en cours** :
  * Badges d'activités repensés avec pastilles animées lumineuses (`pulse`) quand l'agent travaille.
  * Bouton de fermeture (✕) visible de manière fluide au survol (`opacity: 0` → `opacity: 1`).
* **Boutons d'action topbar** (🔗 Inter-projet, 🎭 Agents, ❓ Aide, ⚙️ Paramètres) :
  * Alignés à droite, style icon-button épuré (`background: transparent`, hover sur `--surface-2` avec `--radius-sm`).

### 3.2 Barre Latérale (Sidebar) & Explorateur de Fichiers
* **En-tête de la sidebar** : Titre court, boutons d'action d'arborescence (nouveau fichier, nouveau dossier, rafraîchir, tout replier) sous forme d'icones épurées.
* **Treeview (Arborescence)** :
  * Hauteur de ligne légèrement augmentée (ex. `28px` au lieu de `22px`) pour une meilleure aération.
  * Effet hover arrondi (`--radius-sm`) couvrant toute la largeur.
  * Sélection active avec fond subtil et indicateur latéral discret (`border-left` ou fond `--surface-2` contrasté).
  * Badges Git (`M`, `A`, `D`, `?`) restylisés en pilules compactes aux couleurs pastel douces.
  * Icônes de dossier/fichier avec alignement strict et espacement constant.

### 3.3 Barre d'Onglets & Zone d'Édition / Prévisualisation
* **Barre d'onglets** :
  * Design de type "pills" ou "tabs intégrées" sans bordures verticales lourdes.
  * Onglet actif surélevé (`--surface-3`) ou souligné par une ligne d'accentuation très fine.
  * Bouton de fermeture d'onglet (✕) avec micro-animation au survol.
  * Onglets spéciaux (Agent π, Terminal, Review, Help) identifiables par leur couleur d'accentuation discrète.
* **Zone d'Édition (CodeMirror 6)** :
  * Harmonisation des couleurs du thème CodeMirror avec les variables de l'application.
  * Gouttière (numéros de ligne) aux couleurs atténuées (`--text-muted`).
  * Curseur et sélection fluides.
* **Mode Split & Prévisualisations (Markdown, PDF, Image, CSV)** :
  * Séparateur (Resizer) ultra-fin avec poignée discrète au survol.
  * Rendu Markdown (markdown-it) modernisé : typographie aérée, blocs de code à coins arrondis (`--radius-md`) avec en-tête d'action (bouton copier le code).
  * Diagrammes Mermaid intégrés de façon élégante.

### 3.4 Panneau Agent Pi / Chat IA & Mode Orchestration
* **Zone de Chat (Fil de discussion)** :
  * Séparation visuelle nette entre messages Utilisateur, messages Agent et Pensées (thoughts).
  * **Messages Utilisateur** : Alignés à droite ou identifiés par une carte à fond légèrement accentué.
  * **Messages Agent** : Formatés proprement en Markdown fluide.
  * **Blocs de Pensées (Thoughts)** :
    * Style rétractable ("Accordion") épuré, sur fond `--surface-1` avec bordure fine et texte tamisé.
  * **Blocs d'Outils (Tool Calls : read, write, edit, bash)** :
    * Stylisés comme des cartes "Code/Commande" minimalistes avec statut (en cours, succès, erreur).
* **Barre de Saisie (Prompt Bar)** :
  * Design "floating input bar" en bas du panneau.
  * Zone de texte extensible automatiquement (`textarea`).
  * Boutons intégrés à la barre : sélecteur de modèle (dropdown épuré), bouton dictée vocale (🎙️), sélecteur de mode (Standard / Orchestration), bouton d'envoi principal avec icône d'action claire.
* **Mode Orchestration** :
  * Cartes de micro-tâches présentées sous forme de pipeline vertical ou de stepper élégant.
  * Indicateurs d'état (En attente, En cours, Self-fix, Succès, Échec) sous forme de badges colorés pastel.

### 3.5 Modales, Popups & Menus Contextuels
* **Modales (Paramètres ⚙️, Confirmez l'édition A4, Nouveau Projet, etc.)** :
  * Fond de masque (Backdrop) assombri avec flou d'arrière-plan (`backdrop-filter: blur(8px)`).
  * Boîte de dialogue centrée, coins fortement arrondis (`--radius-xl`), ombre portée prononcée.
  * En-tête fixe avec titre et bouton de fermeture, contenu défilant sans scrollbar disgracieuse, pied de page avec boutons d'action principaux/secondaires alignés à droite.
* **Menus Contextuels (Clic droit)** :
  * Style macOS / Raycast : cartes flottantes épurées, coins arrondis (`--radius-md`), séparateurs très fins, raccourcis clavier alignés à droite en couleur atténuée.

### 3.6 Terminal Intégré (xterm.js)
* Intégration dans un cadre propre avec en-tête minimaliste (nom du terminal, boutons d'action : effacer, relancer, fermer).
* Palette xterm synchronisée exactement sur les variables de thème (`--bg-main`, `--text-primary`, `--accent`, etc.).

---

## 4. Feuille de Route de Realisation (Plan par Sprints)

L'agent de codage devant réaliser cette refonte devra procéder dans l'ordre suivant :

### 📍 Sprint 1 : Refonte des Design Tokens & Base Globale (`src/css/style.css`)
1. Redéfinir l'ensemble du bloc `:root`, `.theme-dark` et `.theme-light` dans `src/css/style.css`.
2. Mettre en place les nouvelles variables de surfaces (`--surface-1` à `3`), de bordures subtiles, d'ombres multi-couches et de typographie.
3. Appliquer le reset typographique et la mise en page globale (`body`, `button`, `input`, `select`, `textarea`).

### 📍 Sprint 2 : Structure, Topbar & Sidebar
1. Moderniser le header principal, le bouton Projets et la barre des projets en cours.
2. Refondre la sidebar et l'explorateur de fichiers (treeview, survol, sélection, badges Git).
3. Ajuster les séparateurs redimensionnables (splitters).

### 📍 Sprint 3 : Barre d'Onglets, Éditeur & Prévisualisation
1. Appliquer le nouveau design aux onglets ("pills" / tabs épurées).
2. Adapter le thème CodeMirror 6 et les zones de prévisualisation Markdown / PDF / CSV.

### 📍 Sprint 4 : Panneau Agent Pi, Chat & Orchestration
1. Refondre la présentation du fil de discussion (messages, pensées, tool calls).
2. Repenser la barre de saisie (Prompt Bar) et ses contrôles intégrés (modèle, micro 🎙️, envoi).
3. Styliser le panneau et le pipeline du Mode Orchestration.

### 📍 Sprint 5 : Modales, Menus Contextuels & Finalisation
1. Repasser sur toutes les modales (Paramètres, Gate Diff Review, etc.) et menus contextuels.
2. Décliner et ajuster minutieusement le **Thème Clair** (`.theme-light`).
3. Harmoniser l'interface Web Remote (`web/css/web.css`) pour maintenir la cohérence entre Desktop et Web.

### 📍 Sprint 6 : Validation Quality Gate & Tests Visuels
1. Vérifier qu'aucune régression fonctionnelle n'est apparue (`npm run build`, `npm run dev`).
2. Vérifier le comportement sur les 3 environnements (Windows, macOS, Linux).
3. Valider la réactivité et la fluidité globale.

---

## 5. Recommandations & Consignes Importantes pour l'Agent de Codage

1. **Méthode d'édition CSS** :
   * Ne pas supprimer massivement les règles CSS existantes sans vérifier leurs sélecteurs. Préférer mettre à jour les propriétés visuelles (couleurs, padding, margin, border-radius, box-shadow) en conservant la structure des sélecteurs.
2. **Respect des Identifiants & Classes JS** :
   * Ne jamais modifier un `id` (ex: `#chat-messages`, `#file-tree`, `#project-btn`) ni une classe cible JS (ex: `.tab-item`, `.tree-node`, `.btn-orchestration`).
3. **Incrémentalisme** :
   * Valider visuellement chaque sprint en lançant l'application (`npm run dev`).
4. **Protocole Anti-Régression** :
   * Consulter `.pi/skills/quality-gate/SKILL.md` avant de committer un ensemble de modifications.
