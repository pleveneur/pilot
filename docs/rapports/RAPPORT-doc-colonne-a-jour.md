# Rapport — la colonne de gauche décrite telle qu'elle est

> Mission documentaire seulement. **Aucun fichier de code de l'application n'a été
> touché** : `index.html`, `src/css/style.css` et `src/js/**` sont inchangés.
> Ni la largeur de la colonne (280 px), ni la bande du haut, ni le coin haut droit,
> ni le badge « Distant » n'ont été retouchés.
> Un seul commit local, en français. Pas de push, pas de tag, pas de changement de
> numéro de version.

---

## 1. Ce que j'ai relevé moi-même sur le disque (preuves)

| Point annoncé dans la mission | Vérifié | Preuve |
|---|---|---|
| Bloc du bas : **7 lignes de 32 px** (Brouillon · Options · Assistant · Dossier du projet · Terminal · Commandes du projet · Autres écrans) | **oui** | `index.html:139-171` : `btn-scratchpad`, `btn-settings`, `btn-superagent`, `btn-explorer`, `btn-terminal`, `btn-commands`, `btn-more-screens` |
| « Lancer l'agent » **n'est plus dans le bloc**, il ouvre le menu « Autres écrans », groupe « Mon projet », avant « Prompt Builder » | **oui** | `index.html:178-181` : `btn-terminal-cmd` avec `pj-more-item` + `role="menuitem"`, juste sous le titre « Mon projet » |
| Menu « Autres écrans » : **10 entrées en 5 groupes** | **oui** | 10 éléments `pj-more-item` ; groupes *Mon projet / Comprendre / Vérifier / Collaborer / Sources* |
| Plafond de hauteur du bloc : **60 %** (et non 50 %) | **oui** | `src/css/style.css:809` — `max-height: 60%;` sur `#project-footer` |
| Plus aucune mise en évidence dans le bloc | **oui** | aucune occurrence de `pj-row-main` dans le balisage ; les règles CSS correspondantes ont disparu (il n'en reste qu'un commentaire, `style.css:1716`) |
| Colonne toujours à **280 px** | **oui** | `#sidebar { width: 280px; min-width: 280px; }` |
| Badge « Distant » intact | **oui** | `index.html:81` (client(s) distant(s)) |

**Conséquence importante, dite franchement** : une partie du constat de la mission
était **déjà périmée**. `help/overview.md` n'annonçait plus « trois boutons toujours
visibles dont Lancer l'agent » : le bloc `<!-- HELP:overview -->` avait déjà été
remis d'aplomb par le commit `2978922` (« docs(colonne) : lot B »), et vérifié par
`c49aca3`. Je n'ai donc **pas** réécrit ce qui était déjà juste ; j'ai cherché ce
qui restait faux et corrigé **cela seulement**.

---

## 2. Mentions corrigées (fichier, ligne, avant, après)

### 2.1 `help/overview.md` — ligne 27-29 (bloc d'aide embarquée)

Seule inexactitude restante : le texte disait les sept lignes « toujours visibles »,
ce qui est **faux sans projet ouvert** (le cadre ne montre alors que Brouillon et
Options — le texte le dit lui-même deux phrases plus bas).

- **Avant** : « **sept** lignes nommées, toujours visibles et **toutes de la même
  taille** (aucune n'est mise en évidence) — **Brouillon**, **Options**, **Assistant**… »
- **Après** : « **sept** lignes nommées, **toutes de la même taille** (aucune n'est
  mise en évidence) et, dès qu'un projet est ouvert, toutes visibles — **Brouillon**,
  **Options**, **Assistant**… »

Le reste du bloc était juste et n'a pas été touché : sept lignes de la même taille,
« dix entrées » pour le menu, « Lancer l'agent » en première ligne du groupe « Mon
projet », « deux clics », plafond à 60 %, cadre affiché sans projet ouvert.

### 2.2 `spec_help.md` — § 5 (UX), ligne 303-306

Le texte renvoyait à un **nom de lot périmé** (« § 4 lot 1 ») d'un découpage qui
n'existe plus comme repère de lecture.

- **Avant** : « …première entrée du menu « Autres écrans » (dix entrées), voir
  `RAPPORT-design-colonne-entrees.md` § 2.2, § 2.3 et § 4 lot 1. Aucune porte de
  remplacement n'a été ajoutée en haut (aucune place réservée). »
- **Après** : « …première entrée du menu « Autres écrans » (dix entrées). L'état de
  référence est décrit dans `spec_pilot.md` § C (et, pour l'utilisateur, dans
  `help/overview.md`). Aucune porte de remplacement n'a été ajoutée en haut (aucune
  place réservée). »

### 2.3 `spec_pilot.md` — § C, ligne 34

Même nom de lot périmé dans le renvoi, pour la même raison.

- **Avant** : « (elles ont quitté le haut de la colonne, mêmes
  libellés/infobulles/icônes/identifiants ; voir `RAPPORT-design-colonne-entrees.md`
  § 2.2 et **§ 4 lot 1**) »
- **Après** : « (… ; voir `RAPPORT-design-colonne-entrees.md` § 2.2) »

Le reste de la phrase était déjà juste (sept lignes de 32 px, aucune mise en
évidence, 10 entrées, « Lancer l'agent » en première ligne, 278 px, plafond 60 %) :
non modifié.

### 2.4 `docs/proposition-navigation.md` — en-tête (après la ligne 6)

Ce document est la **proposition d'origine** : son corps décrit une cible qui n'est
plus l'état du disque (« 3 boutons nommés, toujours visibles », dont « Lancer
l'agent »). Le corps garde sa valeur d'historique ; j'ai ajouté **un encadré daté**
en tête pour qu'on ne le prenne pas pour l'état actuel.

- **Avant** : rien (l'en-tête s'arrêtait à « Rédigé pour être lu sans connaissance
  technique du projet. »).
- **Après** : encadré « **État réel aujourd'hui (vérifié sur le disque le
  26/10/2026)** » : sept lignes de même taille, aucune mise en évidence,
  « Lancer l'agent » désormais en première entrée du menu « Autres écrans »
  (dix entrées), plafond à 60 % ; renvoi vers `spec_pilot.md` § C et `help/overview.md`.

### 2.5 `docs/proposition-presentation-ui.md` — en-tête (après la ligne 16)

Même situation, avec quatre écarts précis (six lignes, ligne « Lancer l'agent » en
évidence, neuf entrées de menu, plafond 50 %).

- **Avant** : rien.
- **Après** : encadré « **État réel aujourd'hui (vérifié sur le disque le
  26/10/2026)** » annonçant les quatre écarts (sept lignes et non six, plus aucune
  mise en évidence, dix entrées et non neuf, 60 % et non 50 %) et renvoyant vers
  l'état de référence.

### 2.6 Rien d'autre à corriger

Balayage de **toute** la documentation du projet (`README.md`, `help/`, `spec_*.md`,
`docs/`, `AGENTS.md`) sur les mots-clés du sujet (nombre de lignes du bloc, nombre
d'entrées du menu, « Lancer l'agent » dans le bloc, mise en évidence, « 50 % »,
« six lignes », « neuf entrées ») :

- `README.md` : ne décrit pas les lignes du panneau (il ne cite que la prise en main
  et le panneau « Travail », dont le « 60 % de la hauteur » est un **autre** sujet,
  toujours vrai). **Aucune modification.**
- `spec_onboarding.md`, `spec_pilot.md`, `help/overview.md` : les mentions de
  « Lancer l'agent » qui restent parlent de **ce qu'il fait**, pas de l'endroit où
  il est. Toujours vrai. **Non modifiées.**
- `release-notes/*.md` : notes de versions passées, historiques par nature. **Non
  modifiées.**
- `RAPPORT-*.md` : rapports de missions précédentes, historiques. **Non modifiés**
  (et aucun supprimé).

---

## 3. Aide embarquée régénérée

`npm run build:handbook` lancé **après** les corrections :

```
[build-handbook] ✅ help/handbook.md généré (45 blocs, 275538 octets, topics: overview, …)
```

- **`help/handbook.md` a bien changé** : 2 lignes modifiées (275510 → 275538 octets),
  celles du panneau d'actions, qui reprennent maintenant « toutes de la même taille
  … et, dès qu'un projet est ouvert, toutes visibles ».
- Le fichier généré **n'a jamais été édité à la main** : seule la source
  (`help/overview.md`) a été modifiée, puis le script a été relancé.
- Vérifié dans le fichier généré : « **sept** lignes », « **dix** entrées »,
  « **Lancer l'agent** en toute première ligne (groupe « Mon projet ») »,
  « **60 %** de la hauteur de la fenêtre ».

---

## 4. Tests — compte réel

| Commande | Résultat réel |
|---|---|
| `npx vitest run` (suite complète, lancée après toutes les corrections) | **PASS 3246 / FAIL 0** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **779 réussis, 1 ignoré, 0 échec** (recompilation incluse de `help.rs`, qui embarque le fichier d'aide régénéré) |

- Aucun test ne lit les documents modifiés (`spec_help.md`, `spec_pilot.md`,
  `docs/proposition-*.md`) : vérifié par recherche (`readFile` sur ces chemins dans
  `src/js/*.test.js` et `scripts/*.test.js` → aucune occurrence). Les verrous de la
  colonne (`lot3-colonne-bas.test.js`, `lot2-colonne-haut.test.js`) lisent le code,
  qui n'a pas bougé : ils restent verts.
- Tests Rust : **lancés aussi**, parce que l'aide embarquée est incluse par
  `include_str!` dans le binaire : 779 réussis, 1 ignoré, 0 échec. Aucun fichier
  `.rs` n'a été modifié.

---

## 5. Point signalé, non corrigé (hors périmètre documentaire)

Le texte affiché par la prise en main, dans l'application elle-même, dit encore :
« « Lancer l'agent » ouvre la conversation de l'agent du projet **(bloc en bas à
gauche)** » (`index.html:1647`). C'est **faux depuis que le bouton a rejoint le menu
« Autres écrans »**. Corriger demanderait de toucher un fichier de code : la mission
l'interdit, donc je le signale sans y toucher. À traiter par une mission de code
(une phrase à réécrire, par exemple « dans le menu « Autres écrans » du bas de la
colonne »).

---

## 6. Fichiers touchés par cette mission (exhaustif)

| Fichier | Nature |
|---|---|
| `help/overview.md` | source de l'aide embarquée (bloc `<!-- HELP:overview -->`) |
| `help/handbook.md` | **généré** par `npm run build:handbook` (jamais édité à la main) |
| `spec_help.md` | § 5 UX : renvoi sans nom de lot |
| `spec_pilot.md` | § C : renvoi sans nom de lot |
| `docs/proposition-navigation.md` | encadré « état réel » en tête |
| `docs/proposition-presentation-ui.md` | encadré « état réel » en tête |
| `RAPPORT-doc-colonne-a-jour.md` | ce rapport |

`src-tauri/src/agents.rs` porte des modifications **antérieures** d'une autre mission :
il est **exclu** du commit et je n'y ai pas touché.

**Précision sur `docs/proposition-presentation-ui.md`** : ce fichier n'est **pas
suivi par Git** (il était déjà en « non suivi » avant cette mission, comme
d'autres propositions de `docs/`). Mon encadré y est donc écrit **sur le disque**,
mais il **n'entre pas dans le commit** : je ne change pas le statut de suivi d'un
document qui n'est pas le mien. La correction reste effective pour quiconque lit
le disque.
