# Rapport — Prise en main de la première ouverture, niveau 1

> Lot livré sur la base du socle (`8ab3514`, `spec_onboarding.md`). Aucun
> deuxième critère d'affichage n'a été inventé : la décision reste celle du
> socle. Tout ce qui suit a été recompté sur le disque après écriture.

## 1. Ce qui s'affiche, réellement

Une **modale** (pas un onglet, pas un écran de navigation, pas de bouton dans
la colonne de gauche) : `index.html:1573`, bloc de 58 lignes, qui réutilise
`.modal`, `.modal-content`, `.modal-header`, `.modal-close`, `.modal-actions`
ainsi que l'animation d'ouverture existante (`animateModalOpen`). Styles :
`src/css/style.css:3258-3374` (117 lignes), **aucune couleur en dur, aucun
token nouveau** — uniquement des tokens déjà définis et déjà éprouvés en clair
et en sombre.

Trois écrans courts, chacun un **constat** de ce qui est là :

1. **Le moteur constaté** — nom du moteur réellement en service (Pi ou PLh, via
   `getBackendInfoSync`), version et programme utilisé (`getPiHealthSync`).
   Si rien ne répond : la **cause** (`no_path`, `not_executable`,
   `probe_failed`, relevé absent) **et la marche à suivre** (⚙️ Options →
   « Agent Pi »), plus le bouton **« Revérifier le moteur »** (relance réelle de
   `checkPiHealth`, pas un bouton décoratif).
2. **Le projet sur lequel on travaille** — nom + chemin du projet ouvert
   (`window._pilotProjectPath`, renseigné par `sidebar.js`), ou, s'il n'y en a
   aucun, comment en ouvrir un : bouton **« Choisir un dossier de projet »** qui
   appelle le sélecteur natif **existant** (`sidebar.openProject()`, aucun second
   chemin d'ouverture). Le constat est **relu** après l'ouverture.
3. **Le modèle de l'assistant** — la liste des modèles **réellement
   disponibles**, lue **sur disque** par `get_available_models_list` (registre
   de l'agent), donc **sans session et sans appel de modèle**. Le choix est
   **facultatif** : l'option « Garder le modèle déjà réglé » n'écrase rien. Si
   la liste est vide ou la lecture en échec : la **cause**, la **marche à
   suivre** (⚙️ Options → « Fournisseurs ») et le bouton **« Réessayer »**.

**« Je découvre »** : trois repères courts (« Lancer l'agent », 🧭 Assistant,
⚙️ Options), puis fermeture en ouvrant **l'onglet Assistant déjà existant**
(`tabs.openFile(superAgentDisplayLabel(), "superagent")` — exactement l'appel de
`main.js:893`).

## 2. Ce qui est écrit, et quand

Une seule voie d'écriture dans tout le module : `get_config` → correctif **pur**
→ `save_config`, **une seule fois**, en sortie. Vérifié : un seul
`invokeFn("save_config", …)` dans `src/js/onboarding.js`.

| Sortie | Écriture |
|---|---|
| **Terminer** (écran 3) | `onboarding_seen: true` + `rpc_agent_enabled: true` + `integrated_terminal: true` + `super_agent_default_model` **seulement** si un modèle a été choisi |
| **Je découvre** | idem, puis ouverture de l'onglet Assistant |
| **Passer** / Échap / croix | `onboarding_seen: true` **et rien d'autre** |

Pourquoi ces deux réglages : sur une installation neuve ils valent faux, et
c'est précisément ce qui fait que « Lancer l'agent » ouvre un terminal.
`rpc_agent_enabled` fait ouvrir la conversation de l'agent ; le terminal
intégré reste le filet de sécurité s'il est coupé plus tard.

La configuration est **relue juste avant** d'être réécrite : tout ce que
l'application a écrit entre-temps (projet récent si l'utilisateur en a ouvert un
depuis l'écran 2, etc.) est conservé, et seuls les champs nommés changent.

## 3. Comportement en échec (aucun cas muet)

| Situation | Ce qui se passe |
|---|---|
| État d'affichage illisible (`get_onboarding_state` en échec) | **Rien n'est affiché** (jamais de fenêtre « par défaut » chez une installation existante) |
| Aucun moteur configuré / non exécutable | Cause + marche à suivre à l'écran, « Revérifier le moteur » actif |
| Liste de modèles vide ou illisible | Cause + marche à suivre + « Réessayer » ; le sélecteur est masqué, jamais vide |
| Échec d'écriture | Message **dans la fenêtre** (zone d'alerte) + notification : « rien n'a été enregistré », la fenêtre **ne se ferme pas**, « Passer » reste actif, rien n'est persisté à moitié |
| Vérification du moteur encore en cours | La fenêtre **ne s'ouvre pas** ; elle revient au démarrage suivant (rien n'a été écrit) |

« Passer » n'est jamais désactivé, et Pilot reste utilisable dans tous ces cas :
le démarrage n'attend jamais cette fenêtre (`void initOnboarding(...)`, après le
masquage du chargement).

## 4. Priorité au démarrage — le verrou existant reste vert

La fenêtre attend que le terrain soit rendu : gardien unique
`pi-startup-gate.js` (`isPiStartupGateBlocking()`) **et** absence de proposition
de mise à jour visible (`pi-update-modal`), attente **bornée** à 30 s
(`ONBOARDING_STARTUP_WAIT_MS`) ; un échec réseau rend la main en ~1 s.

L'instruction `runPiStartupCheck();` reste **seule sur sa ligne, première et non
attendue** (`src/js/main.js:523`) : le verrou `pi-update-startup.test.js` reste
vert, et je n'ai **pas** eu besoin de garder la promesse sous la main — l'état
du gardien, seul propriétaire de la règle, suffit et évite un second état.

## 5. Ce que j'ai recompté moi-même (et non recopié)

- `src/js/onboarding.js` : **677 lignes** ; `src/js/onboarding-niveau1.test.js` :
  **457 lignes**.
- Modale : `index.html:1573` → `1630` (58 lignes) ; styles : `style.css:3258` →
  `3374` (117 lignes) ; câblage : `main.js:31` (import), `main.js:523`
  (`runPiStartupCheck();`), `main.js:1364` (`void initOnboarding(...)`).
- Tokens employés (`--text-primary`, `--text-secondary`, `--bg-hover`,
  `--bg-input`, `--border`, `--border-subtle`, `--border-color`, `--accent`,
  `--radius-md`, `--space-*`, `--font-*`, `--fw-semibold`) : tous présents dans
  `style.css`, aucun créé.
- Aucun onglet créé : un seul `openFile(...)` dans le module (« superagent »).

## 6. Tests ajoutés — et preuve qu'ils mordent

**Avant** : `npx vitest run` → **3031 passed, 0 failed** ;
`cargo test --manifest-path src-tauri/Cargo.toml --lib` → **759 passed, 1 ignored**.

**Après** : `npx vitest run` → **3060 passed, 0 failed** (+29, tous dans
`src/js/onboarding-niveau1.test.js`, aucun autre fichier de tests modifié) ;
Rust inchangé → **759 passed, 1 ignored**.

Les verrous existants qui touchent le démarrage restent verts :
`pi-update-startup.test.js`, `demarrage-verification-pi.test.js`,
`settings-onboarding.test.js`, `source-slice.test.js` (inventaire des découpages
de source protégés).

### Preuve de morsure (mutations réelles, une à la fois, puis restauration)

| Mutation appliquée au code livré | Résultat du test |
|---|---|
| (a) décision affaiblie : `show === true` → `show === true \|\| onboarding_seen === false` | **2 échecs** — « n'ouvre rien quand le socle dit de ne pas afficher » (`expected [ { … } ] to have a length of +0 but got 1`) + « `show` doit valoir VRAI au sens strict » |
| (b) « Passer » pose aussi les réglages de lancement | **2 échecs** — « le correctif de « Passer » ne pose qu'un champ » (`le champ rpc_agent_enabled ne doit pas bouger: expected true to deeply equal false`) + le contrôle de source |
| (c) `save_config` appelé deux fois | **1 échec** — « une seule écriture dans tout le module » (`expected [ 'invokeFn("save_config"', … ] to have a length of 1 but got 2`) |
| (d) attente du gardien supprimée (`isPiStartupGateBlocking()` → `false`) | **1 échec** — « l'attente porte sur le gardien unique du terrain » |
| (e) liste de modèles vide renvoyée sans aucune ligne | **1 échec** — « l'écran des modèles ne montre jamais une liste vide muette » (`expected '' to contain 'Fournisseurs'`) |
| (f) bouton « Choisir un dossier » débranché | **1 échec** — « « Réessayer » et le choix de dossier sont câblés (aucun bouton mort) » |
| (g) `main.js` : `void initOnboarding(...)` → `await initOnboarding(...)` | **1 échec** — « le démarrage n'attend pas la fenêtre : l'appel est détaché et après la vérification » |

Après restauration : source identique à l'octet (`diff -q`), suite complète
reverte à **3060 / 0**.

Couverture du fichier de tests (29 cas) : décision (jamais un second critère,
`show` strict, état illisible), attente bornée du démarrage, « Passer » →
« déjà vu » seul, « Terminer » → deux réglages + une seule écriture + échec dit
sans fermeture, présence et contenu des trois écrans, « Je découvre » → un seul
onglet (`superagent`), non-muétude (cause + marche à suivre + boutons vivants),
absence de coût (aucun `list_agent_models` / `list_agent_sessions` /
`send_prompt` / `start_agent` dans le module), et apparence (aucune couleur en
dur, aucun token nouveau).

## 7. Documentation

- `spec_onboarding.md` réécrit : statut niveau 1, trois écrans, tableau des
  écritures, priorité au démarrage, non-muétude, niveau 2 restant, couverture.
- `help/overview.md` (bloc `HELP:demarrage`) : la première ouverture décrite
  telle qu'elle se passe aujourd'hui (trois écrans, Terminer / Passer / Je
  découvre, ce qu'elle ne fait jamais) — `npm run build:handbook` relancé
  (`help/handbook.md`, 45 blocs).
- `README.md` : section « Prise en main à la première ouverture ».

## 8. Ce qui reste (hors de ce lot)

- **Niveau 2** : l'équipe d'agents, en réutilisant l'écran existant
  `spec_gestion_agents.md` — aucun écran dédié à créer.

VERDICT : la prise en main de première ouverture est livrée au niveau 1 — trois écrans de constat réels, une seule écriture de configuration en sortie (deux réglages qui font que « Lancer l'agent » lance l'agent ; « Passer » n'écrit que « déjà vu »), jamais par-dessus la vérification du moteur, aucun cas muet, aucun coût, aucun onglet ajouté, et la règle d'affichage du socle reste la seule décision.
