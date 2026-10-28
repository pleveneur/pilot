# Rapport — aligner la documentation sur le logo devenu bouton unique des trois modes

> Mission de **documentation seule**. Aucun fichier de code, aucun test, aucun
> style, aucun comportement n'a été touché. Aucune publication, aucun bump, aucun
> envoi vers un dépôt distant.
> Date : 2026-10-28.

---

## 0. La vérité, relue dans le code (avant de corriger quoi que ce soit)

| Fait | Preuve sur le disque |
|---|---|
| Le bouton est le **logo**, en haut à gauche du bandeau de gauche | `index.html:56` : `<button … id="mode-logo" …><img id="btn-project-logo" …>` ; un seul `id="mode-logo"` dans tout le document |
| Ni mot, ni icône, ni **pastille** | `src/js/screen-mode.js` (`renderScreenModeButton` ne pose que `data-screen-mode`, `title`, `aria-label`) ; `src/css/style.css` — aucune règle `.screen-mode-dot`, aucune `#screen-mode-button` |
| L'infobulle dit le mode **courant** et annonce le **suivant** | `screenModeTitle()` : « Mode d'écran : Détaillé. Passer à « Assistant seul ». » |
| Un clic fait avancer d'**un** mode | `initScreenMode()` → `applyScreenMode(nextScreenMode(...))` |
| Une **garde de 400 ms** empêche un double-clic réflexe d'en sauter deux | `MODE_CLICK_GUARD_MS = 400`, `shouldIgnoreModeClick()` |
| Le logo reste **à la même place** dans les trois modes | une seule règle à deux sélecteurs : `body.superagent-immersive-active #mode-logo, body.pilot-vocal-active #mode-logo { position:absolute; top:8px; left:13px }` — la même place qu'en « Détaillé » (inset 16 px − 3 px de l'image) |
| Les barres des deux pleins écrans **ne portent plus** de bouton de mode | `super-agent.js:3809-3822` et `:4150-4156` (commentaires + code) : la barre de 58 px garde « titre, agents, Travail, ⚙ », celle de 44 px « devient une bande de respiration » |

Rappel : l'aide intégrée (`help/overview.md`, bloc `HELP:modes-ecran`) était
**déjà juste** ; elle n'a pas été réécrite. Voir §3 pour le seul cas où la
régénération a été nécessaire.

---

## 1. Endroits corrigés (références recomptées sur le fichier d'arrivée)

| Fichier | Ligne(s) d'arrivée | Ce qui était faux | Ce qui est écrit maintenant |
|---|---|---|---|
| `README.md` | **108-115** (le titre est en 108) | « Un **seul bouton**, à gauche de la **rangée d'onglets** […] Son **libellé** et sa **pastille** montrent le mode courant » | « **Le logo Pilot, en haut à gauche du bandeau, est le bouton** » + « il est **muet** (ni mot, ni pastille) », l'infobulle dit le courant et annonce le suivant, **garde de 400 ms** sur un second clic réflexe. La phrase « Le mode choisi est **mémorisé** d'une ouverture à l'autre » est **gardée telle quelle** |
| `spec_modes_ecran_vocal.md` | **34-55** (§ 2, trois puces réécrites) | « **Où il vit** : `#screen-mode-button`, dans la rangée d'onglets (`#tab-row`), **entre** l'entrée Travail et les boutons de fenêtre » ; « le même bouton est **déplacé dans la barre du plein écran** » ; « le **libellé** est le mode courant […] et une **pastille** reprend la teinte du mode courant » | Le bouton est le **logo** `#mode-logo` du bandeau, **aucun** bouton de mode dans la rangée d'onglets et aucune place réservée ; le logo entre dans l'overlay et y prend **la même place** (une règle CSS à deux sélecteurs), puis restitution exacte ; « **Ce qu'il dit** : rien de visible — ni mot, ni icône, ni pastille » ; nouvelle puce « **Ce qu'il fait** » (un mode par clic + garde de 400 ms) |
| `spec_modes_ecran_vocal.md` | **69** | « On en sort par le **même bouton de mode** (il affiche le mode courant et annonce le suivant) » | « par le **même bouton** (le logo : son infobulle annonce le mode suivant) » |
| `spec_modes_ecran_vocal.md` | **103** | « seuls la barre de saisie et **le bouton des modes** [sont déplacés] » | « seuls la barre de saisie et **le logo, qui est le bouton des modes**, le sont » |
| `spec_modes_ecran_vocal.md` | **108-110** (§ 3, point 1) | « la barre de 44 px **ne porte que le bouton des trois modes**, à gauche » | la barre « ne porte **rien** — c'est une bande de respiration » ; le logo se pose **au-dessus** d'elle, à sa place des trois modes |
| `spec_modes_ecran_vocal.md` | **277** (§ 8, tableau) | « Le même bouton de mode (**il affiche « Vocal »** ; un clic passe à « Détaillé ») » | « **Le même bouton** (le logo : en Vocal son infobulle annonce « Détaillé », un clic y passe) » |
| `spec_modes_ecran_vocal.md` | **287-289** (§ 8, symétrie) | « tout nœud déplacé à l'entrée (**le bouton des modes**, la barre de saisie) » | « (le logo, qui est le bouton des modes, la barre de saisie) » |
| `spec_modes_ecran_vocal.md` | **312** (§ 10, tableau) | « le bouton unique (**`.screen-mode-*`**) » — ces classes n'existent plus | « le bouton unique — le logo `#mode-logo` et son `data-screen-mode` » |
| `AGENTS.md` | **201** (description de `screen-mode.js`) | « libellé du mode COURANT, infobulle du mode SUIVANT, **pastille** […] UN SEUL bouton (**`#screen-mode-button`**, dans index.html) DÉPLACÉ **dans la barre** du mode assistant seul PUIS dans celle du mode Vocal » | « infobulle du mode COURANT puis du mode SUIVANT, garde anti-double-clic `MODE_CLICK_GUARD_MS` = 400 ms […] **LE BOUTON EST LE LOGO** (`#mode-logo`, autour de `#btn-project-logo`, bandeau du haut de la colonne) — ni mot, ni icône, ni pastille, plus aucun `#screen-mode-button` nulle part ; il entre dans l'overlay des deux pleins écrans et y prend la MÊME place que dans « Détaillé » […] puis restitué exactement à sa place » |
| `AGENTS.md` | **202** (description de `super-agent.js`) | « barre de 44 px **avec le bouton de mode** » | « barre de 44 px **qui ne porte RIEN** (le logo, bouton des modes, se pose au-dessus d'elle, à sa place des trois modes) » ; « trois sorties — même bouton **(le logo)** » |
| `spec_super_agent.md` | **1905-1921** (§ « Mode Assistant seul », *dans* le bloc `HELP:super-agent`) | « le bouton UNIQUE des trois modes **de la rangée d'onglets** (il porte le mode courant…) » ; « Le bouton des modes y est **déplacé** lui aussi, **juste après le titre** » ; « on en sort par le bouton des trois modes **(présent dans la barre)** » | le bouton est le **logo Pilot** du bandeau (infobulle courant/suivant) ; « **Aucun bouton de mode dans cette barre** : le logo-bouton entre dans l'overlay et se pose **au même endroit** que dans « Détaillé » (en haut à gauche), par une seule règle CSS » ; sortie « par le **logo** (le bouton des trois modes, en haut à gauche) » |
| `spec_super_agent.md` | **1968-1969** (même bloc) | « Sortir du mode : le **bouton des trois modes (dans la barre)** » | « le **logo** (le bouton des trois modes, en haut à gauche) » |

Rien d'autre n'a été remanié : les phrases déjà justes (« trois sorties, jamais
deux pleins écrans », « aucun écran de réglage », le cycle des trois modes, la
mémoire et la migration) sont **inchangées**, mot pour mot.

---

## 2. Méthode de recherche, et mentions examinées puis **laissées**

Recherche faite sur les fichiers suivis par Git :

```bash
git grep -n "screen-mode-button\|screen-mode-dot" -- '*.md'
git grep -ln "pastille" -- '*.md'          # puis tri, un fichier par un
git grep -n "bouton de mode\|bouton des modes\|mode-logo" -- '*.md'
```

| Fichier | Mention | Laissé parce que |
|---|---|---|
| `CONCEPTION-logo-bouton-des-trois-modes.md` | « la **pastille** de couleur est **supprimée** », « ce qu'on perd : la pastille et le mot » ; décrit l'ancien dispositif au passé | C'est le **document de conception** de la bascule : il doit garder le « avant » pour que la décision reste lisible. Rien n'y est présenté comme l'état actuel. |
| `RAPPORT-ecran-vocal-nu.md` | « le bouton unique des modes (`#screen-mode-button`) » (3 occurrences) | **Rapport daté** : il raconte l'état du code au moment du lot « écran nu ». Réécrire un rapport rétroactif rendrait l'historique des missions faux. À noter pour le lecteur : ce nom d'identifiant n'existe plus. |
| `RAPPORT-logo-lots-*-*.md`, `RAPPORT-mode-assistant-seul-3-retouches.md`, `RAPPORT-trois-modes-ecran-vocal.md` | mentionnent `#mode-logo`, `screen-mode-button`, le bouton déplacé | Mêmes raisons : rapports de lots **datés**, qui décrivent le chemin parcouru. |
| `plan_graphique.md`, `refonte_graphique.md`, `docs/proposition-navigation.md`, `spec_anomaly.md`, `spec_dashboard.md`, `spec_gestion_agents.md`, `spec_multiprojects.md`, `spec_read_aloud.md`, `spec_telegram.md`, `release-notes/*` | le mot « pastille » | **Aucun rapport avec le mode d'écran** : il s'agit de la pastille du suivi du travail, de l'activité des agents, des cartes de tâches, etc. Rien à corriger. |
| `help/overview.md` (l. 422-424) | « **Le logo Pilot, en haut à gauche du bandeau, est le bouton des trois modes** […] ni mot ni pastille » | **Déjà juste.** Non touché. |
| `src/js/screen-mode.js`, `index.html`, `src/css/style.css` | commentaires qui décrivent l'ancien puis le nouveau | Fichiers de **code** : hors périmètre de cette mission, et leurs commentaires sont déjà à jour. |

---

## 3. L'aide intégrée : ce qui a bougé, et pourquoi c'était inévitable

La consigne était de ne pas y toucher, sauf s'il apparaissait qu'elle serait
modifiée. **Elle l'était** : la section « Mode « Assistant seul » » du handbook
n'est pas propre au handbook — elle est **recopiée** du bloc
`<!-- HELP:super-agent -->` de `spec_super_agent.md`. Or ce bloc décrivait encore
le bouton « de la rangée d'onglets », « déplacé juste après le titre » et
« présent dans la barre ». Corriger la spec **sans** régénérer aurait laissé
l'aide intégrée affirmer le contraire de la spec : exactement la divergence que
le projet veut éviter.

`npm run build:handbook` a donc été relancé. Diff obtenu : **9 lignes ajoutées,
7 retirées**, uniquement les deux passages ci-dessus (`help/handbook.md:3556-3569`
et `:3619-3620`). Aucun autre bloc n'a changé.

> Si le propriétaire préfère que l'aide reste figée sur ce point, il suffit de
> `git checkout help/handbook.md` **et** de retirer les deux corrections
> `spec_super_agent.md` : les deux vont ensemble.

---

## 4. Deuxième point : le rapport de diagnostic entre dans l'historique

`RAPPORT-diagnostic-etat-ecran-vocal.md` (266 lignes, daté du 2026-10-28) était
resté **non suivi**, alors que la correction qu'il a motivée (« l'écran restait
sur Je vous écoute… ») est, elle, dans l'historique. Il est **ajouté au commit**
de cette mission, tel quel, sans une ligne réécrite : c'est un ajout de document,
aucune suppression.

---

## 5. Vérifications

| Vérification | Résultat |
|---|---|
| `npm test` (Vitest) | **203 fichiers, 3678 tests — tous verts** (aucun changement de compte) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **792 passés, 1 ignoré** — lancé parce que `help/handbook.md` est embarqué par `include_str!` (`help.rs:47`) et lu par les tests du socle documentaire |
| `npm run build` | **✓ built in 12,40 s** (avertissements de découpage de chunks préexistants, sans erreur) |
| `npm run build:handbook` | **46 blocs**, 284 714 octets — diff limité aux deux passages corrigés |
| Fichiers de code / tests / style modifiés | **aucun** (`git status` : `AGENTS.md`, `README.md`, `help/handbook.md`, `spec_modes_ecran_vocal.md`, `spec_super_agent.md` + le rapport ajouté) |
| Comportement | **inchangé** : zéro modification hors documentation |

Contrôles quality-gate appliqués :

- [x] Fichiers concernés lus **en entier** avant modification (`README.md` § modes,
      `spec_modes_ecran_vocal.md` entier, `AGENTS.md` l. 199-205,
      `spec_super_agent.md` l. 1904-1975, `screen-mode.js` entier,
      `index.html` l. 40-70, `style.css` l. 2015-2095, `super-agent.js` l. 3800-3885
      et 4140-4250).
- [x] Points de connexion vérifiés : aucun test ne verrouille les phrases
      modifiées (`ecran-vocal-lot3.test.js:625`, `ecran-vocal-lot4a.test.js:461`,
      `ecran-vocal-nu.test.js:197` ne cherchent que « trait de niveau »,
      « coupure/parler », « écran nu » — tous conservés).
- [x] Branchements : `help/handbook.md` est **généré** ; la source et le généré
      ont été régénérés et relus ensemble.
- [x] Fins de ligne : lectures normalisées (`\r\n` → `\n`), `.gitattributes`
      `eol=lf` non touché.
- [x] Aucun identifiant de code, aucune constante, aucun libellé d'interface
      inventé dans la documentation : tous les noms cités (`#mode-logo`,
      `MODE_CLICK_GUARD_MS`, `data-screen-mode`, `#btn-project-logo`) ont été
      relus dans le code.
