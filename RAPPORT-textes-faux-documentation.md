# Rapport — trois textes visibles devenus faux (documentation)

Commit local unique, sans bump de version ni tag. Fichiers touchés : `help/overview.md`,
`help/handbook.md` (régénéré, jamais édité à la main), `index.html`,
`spec_super_agent.md`, ce rapport.

Aucun autre fichier modifié par des travaux en cours n'a été ajouté au commit.

---

## 1. Le nom du moteur écrit en dur (`help/overview.md`)

**Constat vérifié** : au moins sept endroits de la doc intégrée affirmaient « Agent Pi »
alors que le nom du moteur est **calculé** par `agentDisplayLabel()`
(`src/js/backend-info.js` : backends `pi`/Node et `plh`/Rust), donc faux pour un
utilisateur de PLh. Le raisonnement est déjà écrit dans `index.html` (l. 530-534) :
« le libelle vient de `agentDisplayLabel()` — ne JAMAIS reecrire "Agent Pi" en dur ici ».
Même vocabulaire que `spec_super_agent.md` (l. 47) : « Options → Agent ».

| Endroit | Avant | Après |
|---|---|---|
| En bref | « un agent de codage IA (« Agent Pi », onglet π) » | « un agent de codage IA (l'agent Pi **ou** PLh selon le moteur en service, onglet π) » |
| Liste des onglets | « agent Pi (π) » | « agent (π) » |
| Prise en main, écran 1 | « (⚙️ Options → « Agent Pi ») » | « (⚙️ Options → l'onglet de l'agent, qui porte le nom du moteur en service) » |
| Revoir la prise en main | « **⚙️ Options → Agent Pi** » | « **⚙️ Options → l'onglet de l'agent** » |
| Fermer un onglet agent | « agent Pi, accès distant, etc. » | « l'agent, accès distant, etc. » |
| Multi-onglets (2 fois) | « Options ⚙️ → onglet « Agent Pi » » | « Options ⚙️ → onglet de l'agent » |

**Ce qui n'a pas été changé, volontairement** : les passages qui parlent de **Pi
lui-même** (titre « Mise à jour de l'agent Pi », `pi update --self`, phrase « ne
concerne que l'agent **Pi** (pas PLh) »). Là, le nom est vrai.

**Cohérence** : `npm run build:handbook` relancé → `help/handbook.md` régénéré
(45 blocs). Le bloc « overview » du handbook porte exactement les mêmes phrases.

**Verrous** : `src/js/libelle-moteur-options.test.js` et
`src/js/moteur-un-seul-endroit.test.js` comptent les « Agent Pi » **du code** et des
textes de la prise en main logicielle (`onboarding.js`), pas ceux de `help/overview.md` :
aucun n'avait à bouger, et aucun n'a été modifié. Les deux restent verts.

---

## 2. Une position d'écran qui n'existe plus (`index.html`)

**Constat vérifié** (l'occurrence est à la ligne 1682, pas 1647) :

> « **« Lancer l'agent »** ouvre la conversation de l'agent du projet (bloc en bas à gauche). »

Le texte promet une **ligne visible** dans le bloc du bas. Sur le disque, « Lancer
l'agent » n'est plus une ligne du bloc : c'est le **premier élément du menu
« Autres écrans »** (`#btn-terminal-cmd`, `index.html` l. 199), menu ouvert par
`#btn-more-screens` (l. 195, « Autres écrans ») à l'intérieur de
`#project-footer` (le cadre accentué du bas de la colonne de gauche). Et ce bloc se
**replie au survol** : au repos, la seule ligne visible est « Autres écrans ». Un
utilisateur qui cherche « Lancer l'agent » dans le bloc ne le trouve donc pas.

| | Texte |
|---|---|
| Avant | « … ouvre la conversation de l'agent du projet (bloc en bas à gauche). » |
| Après | « … ouvre la conversation de l'agent du projet : c'est la première ligne du menu **« Autres écrans »**, au bas de la colonne de gauche. » |

**Rien n'a été déplacé** (aucun changement de HTML structurel, uniquement le texte du
`<li>`). Aucun test ne figeait cette phrase.

---

## 3. La description d'écran périmée (`spec_super_agent.md`)

**Ce que j'ai trouvé avant de modifier** : la section « Technique — angle haut droit du
mode « Assistant seul » » avait déjà été réécrite lors d'une passe précédente
(`RAPPORT-boutons-assistant-seul-2.md`), mais elle **s'ouvrait encore sur la
description de l'ancienne barre** :

> « Le coin haut droit a connu **deux défauts successifs** […] 2. première correction :
> **150 px réservés à droite** (largeur du groupe + air). […] **Placement retenu (état
> actuel)** : … »

Or il n'existe **plus aucune réservation latérale** : sur le disque, le placement est
une **marge haute** + **un air droit de 4 px**, rien d'autre. Ce « 150 px » n'a donc
plus de contrepartie dans le code, et le document se lisait comme s'il en existait une.

**Preuves relevées sur le disque** (aucune valeur recopiée à la main : toutes
recalculées par `src/js/barre-fenetre-assistant-seul.test.js`, **12 tests verts**) :

| Fait | Où |
|---|---|
| `--window-controls-width: 142px` (3 × 46 + 4), `--window-controls-air: 4px`, `--window-controls-height: 36px` | `src/css/style.css` (bloc `:root`) |
| `--window-controls-width` n'est **plus utilisée** pour réserver une place latérale (jeton de mesure, toujours vérifié) | `src/css/style.css` + test, cas « le jeton de largeur vaut exactement l'empreinte mesurée » |
| `.sa-immersive-top` : `height: 58px`, `margin-top: var(--window-controls-height)`, `padding: 0 var(--window-controls-air) 0 18px`, **ni `position`, ni `z-index`, ni `top`** | `src/css/style.css` |
| Ordre réel des enfants de la barre : retour, titre, point des agents, ⚙ (le ⚙ **dernier**, donc son bord droit est celui de la fenêtre) | `src/js/super-agent.js`, `buildImmersiveOverlay()` |
| L'overlay `.superagent-immersive` reste `inset: 0` et passe **sous** `#window-controls` (`z-index: 100001`) | même fichier / feuille |

| | Texte |
|---|---|
| Avant | « Le coin haut droit a connu **deux défauts successifs** […] 150 px réservés à droite […] **Placement retenu (état actuel, décision du propriétaire)** : les deux boutons sont **sous** les boutons système et **alignés sur leur bord droit**. » |
| Après | « **Ce qui existe sur le disque** : la barre du mode (`.sa-immersive-top`, 58 px de haut) se pose sur la **seconde ligne**, **sous** la rangée des trois boutons système, et ses **deux derniers** éléments — le point des agents puis le ⚙ — reprennent l'**air droit exact** de ce groupe : leur bord droit est celui de la fenêtre, comme le bouton Fermer. **Aucune place n'est réservée latéralement** […] Le placement se fait donc par **une marge haute** et **un air droit**, rien d'autre. » |

Le reste de la section (jetons, absence de couches, verrou de 12 tests) était exact et
n'a pas été touché.

---

## Vérifications

| Commande | Résultat |
|---|---|
| `npm run build:handbook` | ✅ handbook régénéré (45 blocs) |
| `npm test` | ✅ **195 fichiers, 3465 tests passés**, 0 échec |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ✅ **789 passés, 1 ignoré**, 0 échec |
| `npx vitest run src/js/barre-fenetre-assistant-seul.test.js` | ✅ 12 tests (le verrou du § 3) |

Aucun numéro de version modifié, aucun tag, aucun push de tag.
