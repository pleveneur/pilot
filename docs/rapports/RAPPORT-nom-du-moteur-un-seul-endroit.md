# Rapport — le nom du moteur : un seul endroit

> Mission : annuler le déplacement du nom du moteur fait par `9db5ea7`, retirer la
> mention du moteur qui s'affichait encore sous la zone de saisie du chat, et
> prouver qu'il ne reste **qu'un seul** endroit qui le nomme.
> Date : 2026-10-26. Commit de départ : `721ce6c`.

---

## 1. Ce qui a été constaté sur le disque avant de toucher quoi que ce soit

### 1.1 Ce que `9db5ea7` avait fait

`9db5ea7` (« style(colonne) : le badge Distant rejoint l'info du moteur en bas »)
avait :

- **retiré** `<span id="project-engine" class="project-engine"></span>` du bloc
  `#project-identity` (le bandeau du haut) ;
- **créé** un conteneur `#sidebar-engine-row`, dernier enfant de `#sidebar`, où
  le sous-titre du moteur vivait **à côté** du badge `#remote-badge` (texte
  d'abord, badge à droite) ;
- laissé `#global-actions` **vide** (le badge l'avait déjà quitté).

### 1.2 La mention « Agent Pi (Suivi) » sous la zone de saisie — d'où venait-elle ?

Constat fait **avant** toute suppression, en cherchant qui écrit ce texte :

- la zone de saisie du chat (`agent-chat-input-bar`) ne contient **aucun** texte
  d'identité du moteur : dans `agent-pi.js` (barre de saisie de l'onglet π) comme
  dans `super-agent.js` (barre de l'Assistant 🧭), la barre ne porte que le
  `<textarea>`, le bouton micro 🎙️ et le bouton d'envoi ;
- le texte venait de la **barre de statut** (`#status-filetype`), qui est
  précisément l'élément affiché **juste sous la zone de saisie** quand un onglet
  de chat est ouvert. Trois écritures, dans `src/js/tabs.js` :
  1. `statusFiletype.textContent = \`${active.name} (RPC)\`` (re-sonde du backend) ;
  2. `statusFiletype.textContent = \`${newLabel} (Suivi)\`` (même endroit) ;
  3. `statusFiletype.textContent = \`${agentDisplayLabel()} (RPC)\`` et
     `… (Suivi)` (rafraîchissement de la barre pour un onglet de chat).

`grep "(Suivi)"` ne trouvait **que** `tabs.js` : il n'y avait donc pas d'autre
mention cachée ailleurs. **Le sélecteur de modèle**, lui, ne vit pas dans la
barre de saisie mais dans la barre d'outils du chat (`agent-model-select-*` pour
π, `#superagent-model-select` pour l'Assistant) : il n'a **pas** été touché, et
rien d'autre n'a été retiré (voir § 4).

---

## 2. GESTE 1 — le nom du moteur remonte dans le bandeau, le badge reste seul en bas

### `index.html`

- `#project-engine` est **revenu** dans `#project-identity` (bandeau du haut),
  **sous** `#btn-project-name`, dans l'ordre d'origine ;
- `#sidebar-engine-row` ne contient plus **que** `#remote-badge` ;
- les commentaires des trois blocs (bandeau, `#global-actions`, ligne du bas)
  disent la règle en vigueur et l'annulation de la partie « descente du texte »
  de la décision 375.

Le badge **ne dépend plus** de la présence d'une ligne de moteur à côté de lui :
il est seul, il garde `margin: 0 0 0 auto`, et la ligne porte désormais
`justify-content: flex-end` (double sécurité). Aucune largeur n'est écrite : la
colonne reste à **280 px**, le bandeau à **48 px**, le logo inchangé.

### `src/css/style.css`

- commentaire de `#project-selector` et de `#project-identity` : le sous-titre
  revit dans le bandeau (nom + moteur sur deux lignes) ;
- la règle devenue morte `#sidebar-engine-row .project-engine { flex: 1 1 auto;
  min-width: 0 }` est **supprimée** (le texte n'est plus dans cette ligne) ;
- `#sidebar-engine-row` : `justify-content: flex-end` ajouté, `height: 28px`,
  `overflow: hidden`, marges/padding inchangés ;
- `.project-engine` : `text-overflow: ellipsis` + `white-space: nowrap` +
  `overflow: hidden` conservés (utile dans le bandeau), commentaire remis à jour ;
- `.project-engine:empty { display: none; }` conservé : avant la première sonde,
  aucune ligne vide n'est réservée dans le bandeau ;
- `.remote-badge` : commentaire remis à jour (badge **seul**, aligné à droite) ;
  la règle elle-même est **inchangée** (28 px, `flex: 0 0 auto`, `width: auto`,
  `nowrap`).

---

## 3. GESTE 2 — la mention sous la zone de saisie est retirée

Dans `src/js/tabs.js`, les **trois** écritures d'identité du moteur dans la barre
de statut sont remplacées par du vide (`statusFiletype.textContent = ''`) :

- rafraîchissement de la barre pour un onglet `agent` (π) → `''` ;
- rafraîchissement pour un onglet `superagent` (🧭) → `''` ;
- re-sonde du backend (`pilot-backend-changed`) pour ces deux modes → `''`.

La barre de statut **reste** celle des fichiers (type, curseur, encodage, fin de
ligne, auto-save) : sur un onglet de chat elle n'affiche simplement plus rien de
propre à l'agent. **Rien d'autre n'a été supprimé** : ni le sélecteur de modèle /
d'orchestrateur / de codeur (`agent-model-select-*`, `#superagent-model-select`),
ni le micro, ni le bouton d'envoi, ni la zone de saisie.

---

## 4. Le compte exact : **1 seul endroit** nomme le moteur en service

**Périmètre de comptage** (celui qui a un sens pour cette mission) : les zones de
l'**interface de travail** qui affichent le nom du moteur comme **information de
statut**, c'est-à-dire un texte produit par la source unique
`agentDisplayLabel()` (`src/js/backend-info.js`).

| Zone | Avant | Après |
|---|---|---|
| Bandeau de la colonne (`#project-engine`) | 0 (descendu) | **1** |
| Ligne du bas de la colonne (`#sidebar-engine-row`) | 1 | 0 |
| Barre de statut (`#status-filetype`) | 2 | **0** |
| Barres de saisie des chats | 0 | 0 |
| **Total** | **3** | **1** ✅ |

Ne sont **pas** comptés, et c'est délibéré (ce ne sont pas des informations de
statut, et deux d'entre eux sont exigés par d'autres décisions verrouillées) :

- le **nom d'onglet** du chat (« π Agent Pi (RPC) » dans la barre d'onglets) :
  c'est le nom de l'onglet, écrit par `tabs.js` ;
- le **libellé de l'onglet des Options** (`#settings-tab-agent-label`, écrit par
  `main.js`), qui vit dans la modale Paramètres, fermée par défaut — verrou
  existant `src/js/libelle-moteur-options.test.js`, non touché ;
- les **messages d'erreur / de chargement** (« Agent Pi indisponible »,
  « Démarrage de Agent Pi… »), qui ne nomment le moteur que pour expliquer une
  panne ou une attente.

---

## 5. Verrous (tests) mis à jour — jamais supprimés

| Fichier | Ce qui change |
|---|---|
| `src/js/badge-distant-bas.test.js` | L'en-tête dit la règle en vigueur (décision 375 pour le **badge**, annulation du 2026-10-26 pour le **texte**). `badge_dans_la_ligne_du_bas()` exige maintenant que la ligne du bas ne contienne **plus** `#project-engine`. Le test « à droite du texte » devient « **SEUL**, aligné à droite » (`justify-content: flex-end`, `margin-left: auto`, aucun texte dans la ligne, et le sous-titre **est** dans le bandeau). Le test de largeur ne calcule plus la place du texte (il n'y en a plus) ; celui du texte élastique devient « le badge ni ne se réduit ni ne grossit, et rien ne dépasse » et vérifie que la règle morte `#sidebar-engine-row .project-engine` a bien disparu. Le test final vérifie que le bandeau porte de nouveau le sous-titre, **sous** le nom du projet. |
| `src/js/lot2-colonne-haut.test.js` | La règle (h) s'inverse : le sous-titre vit **dans `#project-identity`** (bandeau) et **plus** dans `#sidebar-engine-row`. L'en-tête et les commentaires disent l'annulation. Les autres règles (a) → (i) restent identiques : 48 px, logo, nom 15 px, bouton « Projets », haut sans bouton, badge nommé 28 px, thème clair. |
| `src/js/moteur-un-seul-endroit.test.js` (**nouveau**) | Le verrou du **compte** : un seul `#project-engine` dans toute la page et dans le bandeau ; aucune écriture du nom du moteur ni de `(RPC)` / `(Suivi)` dans `#status-filetype` ; la ligne du bas ne porte que le badge ; aucune barre de saisie ne porte de texte d'identité ; **la fonction `endroitsQuiNommentLeMoteur()` rend exactement `["#project-engine (bandeau)"]`** ; et le retrait n'a emporté que du texte (saisie, micro, envoi et sélecteurs de modèle toujours là). |

Rien n'a été supprimé : les deux fichiers existants gardent toutes leurs autres
vérifications.

---

## 6. Vérifications exécutées

| Vérification | Résultat |
|---|---|
| Suite complète `npx vitest run` — **avant** toute modification | PASS **3401** / FAIL 0 |
| Suite complète `npx vitest run` — **après** | PASS **3409** / FAIL **0** (+8 = le nouveau fichier ; les deux fichiers mis à jour gardent le même nombre de tests) |
| `npm run build` (vite) | ✅ `built in 12.84s` (seuls les avertissements de découpage de chunks déjà présents) |
| Contre-épreuve | voir § 6.1 |

### 6.1 Contre-épreuve (faite, puis code restauré à l'identique)

1. Le nom du moteur a été **remis sous la zone de saisie** :
   `statusFiletype.textContent = \`${agentDisplayLabel()} (Suivi)\`` dans la
   branche « superagent » de `tabs.js`.
2. `npx vitest run` sur les trois verrous → **PASS 45 / FAIL 3** :
   - « aucune écriture du nom du moteur ni de son rôle dans la barre de statut » ;
   - « les deux branches de chat vident la barre de statut au lieu de la remplir » ;
   - « aucun texte d'identité du moteur dans les barres de saisie » (le compte
     rendait 4 endroits au lieu de 1).
3. Code **restauré à l'identique** (copie de `tabs.js` reprise), puis suite
   complète relancée → **PASS 3409 / FAIL 0**.

---

## 7. Ce qui n'a **pas** pu être vérifié à l'écran

La fenêtre de Pilot n'a pas été lancée (aucun contrôle graphique dans cette
session) : les points suivants sont donc **déduits** du HTML et du CSS, pas vus.

- que le bandeau de 48 px tient bien **deux lignes** (nom 15 px + sous-titre
  11 px) sans rogner le nom du projet ni pousser le bouton « Projets » ;
- que le sous-titre s'affiche bien **en entier** (« Moteur · Agent Pi ») à
  280 px de colonne, et qu'il s'ellipse proprement pour un libellé plus long ;
- que le badge « Distant » apparaît bien **collé à droite** de sa ligne de 28 px
  quand un client distant est connecté (pastille + « Distant » + compteur) ;
- que la barre de statut d'un onglet de chat est bien **vide** (et non blanche
  avec un reste de texte) au premier affichage comme après une re-sonde pi ↔ plh.

À regarder en ouvrant Pilot : bandeau du haut (nom + moteur), ligne du bas
(badge seul à droite), puis onglet π et onglet 🧭 (barre de statut vide sous la
zone de saisie, sélecteur de modèle toujours présent dans la barre d'outils).

---

## 8. Interdits respectés

Aucun envoi GitHub, aucun tag, aucune publication, aucune suppression de
fichier, aucun contournement de garde-fou, aucune commande Git de nettoyage ou de
réinitialisation (les retouches sont **manuelles**, fichier par fichier ; le
commit `9db5ea7` n'a pas été annulé par `revert`/`reset`).

Non touchés : compteur Travail, colonne 280 px, hauteur/logo du bandeau, thèmes,
les trois onglets du panneau, barre de boutons système, boutons « Assistant
seul ». Version inchangée.

`src-tauri/src/agents.rs` était **déjà modifié** avant cette mission : il n'est
pas inclus dans le commit de cette mission.

---

## 9. Contrôle indépendant (deuxième passe, 2026-10-26)

> Cette passe n'a **rien redessiné** : elle a contrôlé le disque, refait le
> compte moi-même, et renforcé le verrou qui doit l'empêcher de revenir.

### 9.1 État trouvé (commit de contrôle `c0a4304`)

Les trois points de la décision 382 étaient **déjà** ceux du disque, livrés par
`7758ba5` (« le nom du moteur remonte dans le bandeau, un seul endroit ») :

| Exigence 382 | Constaté sur le disque | Verdict |
|---|---|---|
| (1) nom du moteur **sous la barre du haut, dans le bandeau** | `index.html:50`, dans `#project-identity`, sous `#btn-project-name` | conforme |
| (2) badge « Distant » **seul** en bas de colonne, aligné à droite | `index.html:234-236` : `#sidebar-engine-row` ne contient que `#remote-badge` ; `style.css` : `justify-content: flex-end` | conforme |
| (3) plus de mention du moteur **sous la zone de saisie** | `tabs.js:223`, `tabs.js:225`, `tabs.js:2361`, `tabs.js:2369` : `statusFiletype.textContent = ""` / `''` | conforme |

`9db5ea7` (descente du texte en bas de colonne, décision 375) est bien **annulé
pour le texte**, et le badge a **gardé** sa position du bas.

### 9.2 Le compte, refait à la main (preuves fichier:ligne)

Champ de comptage : les textes **visibles dans l'interface de travail** qui
nomment le moteur **en service** (le libellé de la source unique
`agentDisplayLabel()`, `src/js/backend-info.js:70`).

| # | Endroit | Preuve fichier:ligne | Compte |
|---|---|---|---|
| 1 | Sous-titre du bandeau de la colonne | porteur `index.html:50` ; seule écriture du libellé `src/js/main.js:646` (`"Moteur · " + agentDisplayLabel()`) ; style `src/css/style.css:1241` et `:1253` | **1** |
| — | Barre de statut (`#status-filetype`), sous la zone de saisie | `src/js/tabs.js:223` (agent), `:225` (assistant), `:2361` (agent), `:2369` (assistant) — toutes vides | 0 |
| — | Barres de saisie des deux chats | `src/js/agent-pi.js:558-568`, `src/js/super-agent.js:2917-2925` : `textarea`, micro, envoi — aucun texte d'identité | 0 |
| — | Ligne du bas de la colonne | `index.html:234-236` : badge `#remote-badge` seul | 0 |
| | **TOTAL** | | **1** ✅ |

Relevé machine complémentaire (`node`, sources de production seulement,
commentaires retirés) : le libellé `Moteur ·` apparaît **une seule fois** dans
tout le front de production, `src/js/main.js:646` ; zéro occurrence dans
`index.html` et dans les 120 autres modules `src/js` (121 modules de production
au total, hors tests).

**Hors de ce compte, et signalé franchement** (ce ne sont pas des informations
de statut, et deux sont exigés par d'autres décisions verrouillées) :

- le **nom d'onglet** du chat : `src/js/tabs.js:212` et `:3330`
  (« π Agent Pi (RPC) ») — c'est le nom de l'onglet, comme « Notes.md » ;
- le **libellé de l'onglet des Options**, dans la modale Paramètres fermée par
  défaut : `index.html:534` (+ valeur de repli avant la première sonde) — verrou
  distinct `src/js/libelle-moteur-options.test.js` ;
- le titre de section de cette même modale : `index.html:742`
  (« Agent Pi ou PLh ») ;
- l'écran de **prise en main** de la première ouverture :
  `src/js/onboarding.js:155` (une seule fois, jamais l'interface de travail) ;
- les **messages de panne / d'attente** : `src/js/tabs.js:615`, `:632`, `:686`.

Si le propriétaire veut que le nom d'onglet cesse lui aussi de nommer le moteur,
c'est une décision distincte : rien n'a été changé de ce côté.

### 9.3 Faille du verrou trouvée, puis corrigée (mesurée, pas supposée)

Le verrou `src/js/moteur-un-seul-endroit.test.js` (livré par `7758ba5`) ne
cherchait que `agentDisplayLabel()` et les rôles `(RPC)` / `(Suivi)`.

**Contre-épreuve 1 (avant renforcement)** — libellé réécrit **en dur** dans
`src/js/tabs.js` : `statusFiletype.textContent = "Moteur · Agent Pi";` →
suite du verrou **PASS 8 / FAIL 0**. Le nom du moteur pouvait donc revenir sous
la zone de saisie **sans faire rougir** le verrou. C'est exactement le défaut que
la mission demandait de fermer.

Renforcement (dans le test **uniquement**, aucun code de production touché) :

- `sansCommentaires()` : la prose n'est plus jugée (un commentaire ne satisfait
  ni ne fait rougir un verrou) ;
- `ecrituresNommantLeMoteurDansLeStatut()` : **toute** écriture dans
  `statusFiletype` (`textContent`, `innerText`, `innerHTML`, `outerHTML`,
  `append`, `prepend`, `insertAdjacentHTML/Text`, `replaceChildren`) qui nomme le
  moteur — `agentDisplayLabel`, `Moteur`, `Agent Pi`, `Agent PLh`, `(RPC)`,
  `(Suivi)` — est refusée, **y compris écrite en dur** ;
- `sourcesDeProduction()` + `occurrencesDuSousTitre()` : le libellé `Moteur ·`
  est compté à l'échelle de **tout** le front de production (index.html + tous
  les modules `src/js` hors tests) et doit valoir **exactement 1** ;
- le porteur `id="project-engine"` doit rester **unique** dans `index.html` et
  **aucun** module ne peut en créer un second.

**Contre-épreuve 2 (après renforcement)** — mêmes sabotages volontaires
(libellé en dur dans `tabs.js` + second porteur `id="project-engine"` ajouté dans
`main.js`) → verrou **FAIL 5 / (13 cas)** :
« aucune écriture du nom du moteur dans la barre de statut », « un commentaire
qui cite une écriture » (le code saboté est lu), « aucun texte d'identité dans
les barres de saisie » (compte = 2), « le libellé n'est écrit qu'à un endroit »
(2 fichiers) et « aucun module ne crée un second porteur ». Sabotages **retirés**
(copies restaurées, `git diff` vide sur ces deux fichiers) puis relance :
**PASS 13 / FAIL 0**.

### 9.4 Vérifications exécutées dans cette passe

| Vérification | Résultat exact |
|---|---|
| `npx vitest run src/js/moteur-un-seul-endroit.test.js` | **PASS 13 / FAIL 0** |
| Suite complète `npm test` (vitest, 195 fichiers) | **3417 PASS / 0 FAIL** (3412 avant cette passe ; +5 cas de verrou) |
| `npm run build` (vite) | exit 0, `built` — seuls les avertissements de taille de chunk déjà présents |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **786 passed, 1 ignored**, exit 0 |
| Contre-épreuves | voir § 9.3 (une rouge avant renforcement, cinq rouges après) |

`src-tauri/src/agents.rs` n'a **pas** été touché (il était déjà modifié avant
cette passe, et n'est pas inclus dans le commit). Aucune version changée, aucun
envoi GitHub, aucun tag.

### 9.5 Ce qui reste à vérifier à l'écran (non vérifiable ici)

Pilot n'a pas été lancé (aucun contrôle graphique dans cette session). Restent
**déduits** du HTML et du CSS, pas vus :

- le bandeau de 48 px tient bien les deux lignes (nom 15 px + sous-titre 11 px)
  sans rogner le nom ni pousser le bouton « Projets » ;
- le sous-titre s'affiche en entier (« Moteur · Agent Pi ») à 280 px et s'ellipse
  proprement pour un libellé plus long ;
- le badge « Distant » apparaît collé à droite de sa ligne de 28 px quand un
  client distant est connecté, et la ligne garde sa hauteur ;
- la barre de statut d'un onglet de chat est bien vide au premier affichage
  **et** après une re-sonde pi ↔ plh.
