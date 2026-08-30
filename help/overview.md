# Pilot — Aide utilisateur (source pour le handbook)

> Ce fichier est la **source** des blocs d'aide « généralités » de Pilot. Il est
> orienté utilisateur (langage simple). Le script `scripts/build-handbook.js`
> agrège les blocs `<!-- HELP:* -->` de ce fichier **et** des `spec_*.md` pour
> générer `help/handbook.md` (embarqué dans l'app).
>
> **Ne pas éditer `help/handbook.md` directement** : éditer ce fichier
> (`help/overview.md`) ou les blocs HELP des specs, puis relancer
> `npm run build:handbook`.

---

<!-- HELP:overview -->
## Pilot en bref

Pilot est un éditeur de texte multiplateforme pensé pour les agents IA. Il
combine un éditeur de code (CodeMirror 6), une prévisualisation Markdown, un
terminal intégré, un agent de codage IA (« Agent Pi », onglet π) et un mode
orchestration. Tout se fait dans une seule fenêtre, sans passer par un terminal
externe.

- **Onglets** : édition (📝), prévisualisation (👁️), mode split (📝👁️),
  terminal (🖥️), agent Pi (π).
- **Barre latérale** : explorateur de fichiers du projet, filtre, favoris,
  brouillon (scratchpad).
- **Panneau d'actions** (bas de la barre latérale) : boutons Terminal, Agent Pi,
  Prévisualisation, Paramètres ⚙️, badge Accès distant.
<!-- /HELP:overview -->

<!-- HELP:demarrage -->
## Démarrer un projet

1. **Ouvrir un projet** : bouton **« 📁 Projets ▼ »** en haut de la barre
   latérale → « Ouvrir un dossier… » (ou via la palette de commandes
   `Ctrl+Shift+P`).
2. **Explorer** : l'arborescence s'affiche dans la barre latérale. Filtrer les
   fichiers avec `Ctrl+P`. Le **clic droit sur un ascenseur** (scrollbar) n'affiche
   aucun menu natif.
3. **Ouvrir un fichier** : double-clic dans l'arborescence → un onglet s'ouvre
   (détection automatique du mode : édition pour le code, prévisualisation pour
   `.md`, `.pdf`, images, `.csv`). Dans la **prévisualisation Markdown**, les
   liens sont cliquables : un lien interne ouvre le fichier cible dans un onglet,
   un lien externe (http/https) s'ouvre dans le navigateur, une ancre (`#section`)
   fait défiler la prévisualisation.
4. **Sauvegarder** : `Ctrl+S` (sauvegarde auto configurable dans les
   Paramètres). Enregistrer sous : `Ctrl+Shift+S`.
5. **Fermer un onglet** : `Ctrl+W` ou clic sur la croix de l'onglet. On peut
   **réordonner** les onglets par glisser-déposer, et **renommer** un onglet par
   double-clic sur son titre.
6. **Brouillon** : `Ctrl+Shift+N` ouvre un brouillon rapide (scratchpad) non lié
   au projet courant. Vous pouvez y avoir **plusieurs pages** (mini-onglets en
   haut : « + » pour ajouter, clic sur le nom pour renommer, ✕ pour supprimer),
   sauvegardées localement par projet.
<!-- /HELP:demarrage -->

<!-- HELP:raccourcis -->
## Raccourcis clavier essentiels

### Fichiers et onglets
- `Ctrl+S` — Sauvegarder · `Ctrl+Shift+S` — Enregistrer sous… · `Ctrl+W` — Fermer l'onglet
- `Ctrl+Tab` / `Ctrl+Shift+Tab` — Onglet suivant / précédent (fonctionne aussi dans le terminal)
- `Ctrl+1`…`Ctrl+9` — Aller à l'onglet par position (ordre actuel)
- `Ctrl+Shift+E` — Basculer en mode split (éditeur + prévisualisation)
- `Ctrl+Shift+B` — Ajouter/retirer le fichier courant des favoris
- `Ctrl+Shift+N` — Ouvrir le brouillon (scratchpad)

### Navigation et recherche
- `Ctrl+P` — Filtrer les fichiers (barre latérale)
- `Ctrl+G` — Aller à la ligne…
- `Ctrl+Shift+F` — Recherche globale (full-text dans tous les fichiers du projet)
- `Ctrl+Shift+H` — Remplacement global (avec aperçu et confirmation)
- `Ctrl+Alt+R` — Fichiers récents (popover fuzzy)
- `Ctrl+Shift+O` — Table des matières Markdown (outline cliquable)
- `Ctrl+Shift+P` — Palette de commandes

### Édition Markdown
- `Ctrl+B` — Gras · `Ctrl+I` — Italique · `Ctrl+K` — Lien
- `Ctrl+D` — Sélectionner l'occurrence suivante (multi-curseur)
- `Alt+clic` — Ajouter un curseur à la position cliquée

### Divers
- `F11` — Plein écran
<!-- /HELP:raccourcis -->

<!-- HELP:theme-parametres -->
## Thème et paramètres

- **Thème** : bascule dark/light depuis les **Paramètres ⚙️** (bouton du panneau
  d'actions) → section « Apparence ». Le thème est mémorisé.
- **Paramètres ⚙️** : onglet de configuration modale (thème, éditeur, agent Pi,
  accès distant, etc.). Toute la configuration est persistée dans un fichier
  JSON (`app_data_dir/com.pilot.editor/config.json`).
- **Palette de commandes** (`Ctrl+Shift+P`) : accès rapide à toutes les
  commandes (sauvegarder, ouvrir, fermer, basculer split/outline/recherche, etc.).
<!-- /HELP:theme-parametres -->

<!-- HELP:terminal -->
## Terminal intégré

- Bouton **Terminal** dans le panneau d'actions (ou palette de commandes).
- Si le terminal intégré est activé (Paramètres ⚙️ → « Terminal intégré »),
  il s'ouvre dans un onglet 🖥️. Sinon, un terminal externe est lancé.
- Shell par défaut : `cmd.exe` (Windows), `$SHELL`/`/bin/zsh` (macOS),
  `$SHELL`/`/bin/bash` (Linux).
- **Windows** : le terminal intégré reconstruit le PATH système + utilisateur
  depuis la registry, pour que les commandes installées après le lancement de
  Pilot (ex: `cargo`) soient trouvées.
- Le terminal reste indépendant de l'éditeur ; on peut l'ouvrir et le fermer
  comme un onglet normal.
<!-- /HELP:terminal -->

<!-- HELP:recherche-outline -->
## Recherche, remplacement et outline

- **Recherche globale** (`Ctrl+Shift+F`) : panneau de recherche full-text dans
  tous les fichiers du projet, avec support des expressions régulières et un
  filtre par extension. Cliquer un résultat ouvre le fichier à la ligne.
- **Remplacement global** (`Ctrl+Shift+H`) : bouton ▸ pour afficher la ligne de
  remplacement, puis « Tout remplacer » — un aperçu (nombre d'occurrences et de
  fichiers concernés) précède une confirmation avant écriture. Les onglets
  d'édition ouverts et non modifiés sont rechargés automatiquement.
- **Table des matières** (`Ctrl+Shift+O`) : bascule l'outline Markdown (titres
  cliquables, mise à jour en temps réel). Pratique pour naviguer dans un long
  fichier `.md`.
- **Mode split** (`Ctrl+Shift+E`) : éditeur à gauche, prévisualisation à droite.
  Le scroll est **synchronisé proportionnellement dans les deux sens** :
  défilement de l'éditeur → la prévisualisation suit, et inversement. La
  position de scroll est préservée pendant l'édition (pas de saut en haut à
  chaque frappe). Cliquer sur un titre (`h1`–`h6`) dans la prévisualisation
  fait défiler l'éditeur jusqu'à la ligne correspondante.
<!-- /HELP:recherche-outline -->

<!-- HELP:edition-lint -->
## Édition : multi-curseurs, lint, export HTML, fichiers récents

- **Multi-curseurs** : `Alt+clic` ajoute un curseur à la position cliquée ;
  `Ctrl+D` sélectionne l'occurrence suivante du mot sous le curseur (répète pour
  en sélectionner plusieurs). Pratique pour éditer plusieurs endroits à la fois.
- **Lint intégré** : pour les fichiers JS/TS, les diagnostics du linter du
  projet (eslint) s'affichent en direct dans la gouttière et sous les mots
  soulignés (debounce ~1.2 s). Silencieux si eslint n'est pas disponible.
- **Export HTML autonome** : clic droit sur un fichier `.md` → « Exporter en
  HTML » génère un fichier `.html` autonome (CSS inline + images en base64)
  partageable sans Pilot, via un dialogue de sauvegarde natif.
- **Fichiers récents** (`Ctrl+Alt+R`) : popover listant les 20 derniers
  fichiers ouverts du projet (filtre fuzzy, navigation clavier, Entrée pour
  ouvrir). L'historique est stocké localement (par projet), jamais envoyé au
  cloud.
<!-- /HELP:edition-lint -->
<!-- HELP:aide -->
## Aide intégrée (❓)

Le bouton **❓** du panneau d'actions ouvre l'onglet **Aide** : un assistant
conversationnel qui répond à tes questions sur l'utilisation et le paramétrage de
Pilot, **à partir de la documentation embarquée** (handbook généré à la
compilation depuis les specs).

- **Liste déroulante de modèle** en haut de l'onglet : choisis le modèle
  d'inférence utilisé pour l'aide (persisté dans les Paramètres, champ
  `help_model`). Le 1er modèle disponible est auto-sélectionné au 1er usage.
- L'aide est **isolée** de l'agent de coding : elle n'a accès ni à tes fichiers, ni
  à la conversation de l'onglet π — uniquement à la documentation.
- L'historique de la conversation d'aide est conservé tant que l'onglet est
  ouvert (réinjecté à chaque question, le process pi étant sans mémoire).
- Si la réponse est vide ou en erreur, vérifie qu'un **modèle valide** est
  sélectionné dans la liste déroulante.
<!-- /HELP:aide -->

<!-- HELP:dev-mode -->
## Développer Pilot avec Pilot (mode dev)

Tu peux **développer Pilot avec Pilot** : lancer une version **dev** en parallèle
 de la version **installée**, sans conflit.

- **Lancement** : `npm run tauri dev` (le wrapper ajoute automatiquement un
  identifiant d'application séparé `com.pilot.editor.dev`).
- **Deux instances indépendantes** : la version dev utilise son propre
  `app_data_dir` (config, sessions, audit, extensions) et son propre verrou
  single-instance → elle peut tourner en même temps que la version installée.
- **Port web distant décalé** : en mode dev, le port réellement utilisé est le
  port configuré **+ 1** (ex: configuré 8787 → dev écoute sur 8788), pour
  éviter tout conflit de port avec la version installée.
- **Projets partagés** : les projets sont ouverts par chemin, donc tu peux
  ouvrir les mêmes projets dans les deux versions.
<!-- /HELP:dev-mode -->

<!-- HELP:pi-update -->
## Mise à jour de l'agent Pi

À l'ouverture de l'onglet agent, Pilot **vérifie automatiquement** si une
nouvelle version de Pi est disponible (backend `pi` uniquement). Si c'est le
cas, une modale te propose de la mettre à jour via la commande intégrée de Pi
(`pi update --self`).

- **Mettre à jour maintenant** : lance la mise à jour puis te confirme le
  résultat.
- **Plus tard** : ferme la modale (la vérification se refait à la prochaine
  ouverture de l'onglet agent).
- **Ne plus demander** : désactive la vérification automatique (réactivable en
  remettant `pi_skip_update_check` à `false` dans la config).

La vérification ne concerne que l'agent **Pi** (pas PLh) et n'est proposée que
si une version plus récente existe réellement.
<!-- /HELP:pi-update -->

<!-- HELP:multi-agents -->
## Plusieurs agents sur un même projet (multi-onglets)

Tu peux ouvrir **plusieurs onglets agent indépendants** sur le même projet,
chacun avec sa propre conversation (bouton **« + »** dans la barre d'onglets).

- **Activer** : Paramètres ⚙️ → onglet « Agent Pi » → cocher « Multi-onglets
  agents ».
- **Ouvrir un agent** : bouton « + » de la barre d'onglets (toujours en
  première position, avant les autres onglets).
- **Renommer un onglet** : double-clic sur son nom.
- **Configurer le nombre et les noms au démarrage** : Paramètres ⚙️ → onglet
  « Agent Pi » → section « Agents du projet ». Définis les agents rechargés
  automatiquement à l'ouverture du projet, chacun avec son nom. La
  configuration est enregistrée dans `.pilot/agents.json` du projet (versionnée
  et partagée entre utilisateurs).
- Le **renommage manuel** d'un onglet (double-clic) **prime** sur le nom
  configuré.
- Le bouton « + » reste disponible pour ajouter des agents au-delà de ceux
  configurés.
<!-- /HELP:multi-agents -->

<!-- HELP:gds -->
## GDS (gestionnaire de sources) — principe

Le **GDS** (Gestionnaire De Sources) est la solution prévue dans Pilot pour
**centraliser les sources des projets** (dépôts git + suivi partagé dans une
base de données PostgreSQL unique), en remplacement d'un hébergement externe
type GitHub.

- **Activé projet par projet** : le GDS n'est jamais activé globalement.
  Chaque projet choisit explicitement **son propre serveur** au moment de
  l'activation (activation on/off, URL du serveur, identité), via un fichier
  de configuration **dans le projet**. Il n'y a **aucun serveur par défaut**
  et **aucune configuration globale** pour le GDS.
- **Sans activation** : le projet reste 100 % local, exactement comme
  aujourd'hui.
- **Onglet « 🌐 GDS »** : le bouton **GDS** du panneau **Vues** (sidebar)
  ouvre un onglet dédié, **par projet**, pour piloter le GDS :
  - **Provisionner le serveur** (adresse PostgreSQL, utilisateur/mot de passe
    dédiés, email + mot de passe admin) → crée la base `pilot_gds`, les tables
    et le premier compte admin, puis active le GDS pour le projet ;
  - **Configurer le projet** (`.pilot/gds.json`) : activation on/off, URL du
    serveur, email d'identité, dossier local de clonage, hôte SSH ;
  - **Ajouter le projet au GDS** : crée un dépôt git bare sur le serveur,
    ajoute le remote `origin` et pousse la branche courante ;
  - **Consulter** la liste des projets et des dépôts git du serveur.
- **Phase B/C à venir** : la synchronisation, les verrous et les tickets
  (suivi des demandes clients) sont affichés comme « disponibles à la Phase
  B/C » — non implémentés dans cette version.
<!-- /HELP:gds -->
