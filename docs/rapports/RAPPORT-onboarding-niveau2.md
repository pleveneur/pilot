# Rapport — Prise en main, NIVEAU 2 : l'équipe d'agents

Lot unique, terminé. Le niveau 2 **apprend plus tard et à la demande** à se
servir de l'équipe d'agents. Il ne crée **aucun** écran de gestion, **aucun**
onglet, **aucun** bouton dans la colonne de gauche : il **réutilise** l'écran
« Équipe d'agents » existant et, pour la forme, la modale du niveau 1.

---

## 1. Les deux écrans (réels, deux au maximum)

`src/js/onboarding-niveau2.js` (363 lignes), `ONBOARDING_TEAM_SCREENS = 2`
(ligne 36). La fenêtre est la modale existante : `index.html:1651`
(`#onboarding-team-modal`, `class="modal hidden"`, `.modal-content`,
`.modal-header`, `.modal-close`, `.modal-actions`) — **aucun composant nouveau**.

| Écran | Titre affiché | Contenu réel | Rempli par |
|---|---|---|---|
| 1 | « À quoi sert une équipe » | ce qu'est une équipe (plusieurs agents, un rôle, un modèle, des compétences) **+ l'état réel du registre** | `onboardingTeamComposition` (ligne 82) |
| 2 | « Votre premier geste » | le geste qui marche du premier coup (lire une fiche, puis confier une tâche à 🧭 Assistant) | `onboardingTeamFirstGesture` (ligne 143) |

L'étape est annoncée et bornée : `onboardingTeamStepLabel` (ligne 164) rend
« Étape 1 sur 2 » / « Étape 2 sur 2 ». Le dernier bouton s'intitule
**« Voir mon équipe d'agents »** et emmène sur l'écran d'équipe **existant**
(`ONBOARDING_TEAM_AGENTS_TAB_MODE = "agents"`, ligne 43 ; ouverture par
`tabs.openFile` — **un seul** `.openFile(` dans le module). Il n'y a donc **pas
d'impasse** : on finit là où on peut agir.

Sorties disponibles à tout moment : **Fermer**, la croix, **Échap**
(`index.html`, boutons `btn-onboarding-team-skip` / `onboarding-team-close`).

## 2. Les deux points d'entrée, tous deux sur un geste

| Où | Élément | Câblage |
|---|---|---|
| Fenêtre de première ouverture (niveau 1) | lien discret « Apprendre à organiser mon équipe d'agents » — `index.html:1626` | `src/js/onboarding.js:659` (`gesture: true`) |
| Écran « Équipe d'agents » **existant** | bouton discret en bas de la colonne des agents — `src/js/agents-ui.js:60` | `src/js/agents-ui.js:641` (`gesture: true`, registre passé **en lecture**) |

Un seul appel par fichier (vérifié par test). Styles ajoutés sans couleur en dur
ni token nouveau : `src/css/style.css:11187` (`.agents-learn-link`) et
`src/css/style.css:11215` (`.onboarding-link-btn`), sur `--text-secondary`,
`--text-primary`, `--bg-hover`, `--border-subtle`.

## 3. Il ne s'ouvre jamais tout seul

`openOnboardingTeamModal` (ligne 209) commence par la garde
`if (deps.gesture !== true) return { shown: false, reason: "no-gesture" };`
**avant tout accès au document** ; un test vérifie cet **ordre**.

- `main.js` ne connaît ni `onboarding-niveau2`, ni `openOnboardingTeamModal`, ni
  `onboarding-team-modal` (test) : rien ne l'ouvre au démarrage.
- Aucune minuterie, aucun observateur d'état ne l'ouvre : les **deux seuls**
  appels de tout le dépôt sont les deux clics ci-dessus.
- Il ne revient donc **jamais** à chaque démarrage ; il n'y a **rien de nouveau à
  mémoriser** en configuration (aucun champ ajouté).
- Échap dans le niveau 2 est traité par le niveau 2 : le niveau 1 garde son
  gestionnaire (`src/js/onboarding.js:631`) pour ne pas écrire « déjà vu » en
  refermant deux fenêtres d'un coup.

## 4. Équipe déjà configurée : il n'impose rien

Constat mesuré sur le registre réel (`loadAgentRegistry`, lecture seule) :

| État du registre | Ce que l'écran 1 dit | Écran 2 |
|---|---|---|
| **Équipe en place** (ex. 3 agents) | « Votre équipe compte **déjà** 3 agents : Coordinateur, Codeur, Relecteur — **rien ne vous oblige à la modifier**. » **Aucune** « Marche à suivre » | geste = **lire** une fiche ; pas d'invitation à modifier |
| **Équipe vide** | « Aucun agent n'est déclaré… » + **Marche à suivre** (↻ remet les agents fournis, + en ajoute) + « Réessayer » | le premier geste est de **remettre une équipe en place** |
| **Registre illisible** | la **cause réelle** (« … : lecture refusée ») + marche à suivre + « Réessayer » **vivant** | geste de lecture, aucune affirmation fausse |
| **En cours de lecture** | « Lecture de votre équipe d'agents… » (jamais de liste vide muette) | idem, aucune affirmation fausse |

Une équipe nombreuse est **résumée** (6 noms puis « … ») au lieu d'une liste
sans fin. Formes acceptées : `{agents:[…]}`, `[…]`, ou une fonction qui les rend
(le registre déjà en mémoire de l'écran d'équipe).

## 5. Aucun coût, aucune modification, aucune écriture

- Aucun appel de modèle, **aucune session d'agent** : le module ne connaît ni
  `run_agents`, ni `send_prompt`, ni `start_agent`, ni `list_agent_sessions`
  (interdit : bloque la file `~25 min`) — vérifié par test, ainsi que l'absence
  de tout accès Tauri (`@tauri-apps/api/core`).
- **Aucune écriture de configuration** (`save_config`, `get_config` interdits par
  test) et **aucune modification d'agent** (`upsert_agent`, `delete_agent`,
  `replace_agents`, `reset_agent_registry` interdits).
- Fermer ne décide rien : aucune réponse n'est décidée à la place de
  l'utilisateur, rien n'est supprimé.
- Une notification qui échouerait ne bloque pas la sortie (`notify`) : la
  fenêtre ne reste jamais ouverte sur un échec silencieux.

## 6. Recollement — fichiers touchés, comptés

| Fichier | Nature | Compte |
|---|---|---|
| `src/js/onboarding-niveau2.js` | **nouveau** module | 363 lignes |
| `src/js/onboarding-niveau2.test.js` | **nouveau** fichier de tests | 550 lignes, 27 tests |
| `index.html` | lien niveau 1 (`1626`), modale niveau 2 (`1651`) | +50 lignes |
| `src/js/onboarding.js` | import (`38`), élément (`437`), garde Échap (`631`), câblage (`659`) | +15 lignes |
| `src/js/agents-ui.js` | import (`43`), bouton (`60`), référence (`82`), câblage (`641`) | +18 lignes |
| `src/css/style.css` | bloc documenté `11172`→fin (2 sélecteurs) | +62 lignes |
| `spec_onboarding.md` | statut + § Niveau 2 + couverture | mise à jour |
| `help/overview.md` | bloc `demarrage` : « L'équipe d'agents, apprise plus tard et à la demande » | mise à jour |
| `help/handbook.md` | **généré** par `npm run build:handbook` (45 blocs, 270 167 octets) — jamais écrit à la main | régénéré |

Ce qui n'a **pas** été touché : colonne de gauche, rangée d'onglets, panneau du
bas, thèmes, niveau 1 livré (seul le lien de sortie a été ajouté), logique de
file, mode réseau, documentations de l'Assistant.

## 7. Tests — avant / après et preuve de morsure

| Mesure | Valeur |
|---|---|
| **Avant** (`npx vitest run`) | **PASS 3113** / FAIL 0 |
| **Après** (`npx vitest run`) | **PASS 3140** / FAIL 0 |
| Delta | **+27** tests (tous dans `src/js/onboarding-niveau2.test.js`) |

Les tests de niveau 1 (`onboarding-niveau1.test.js`) et du gardien de démarrage
restent **verts**. Le fichier de tests respecte l'inventaire
`source-slice.test.js` : découpages de source uniquement via `sliceSource` /
`sliceFrom`, jamais de `.slice(… indexOf(…))` non protégé.

**Preuve de morsure (mutation réelle, puis restauration à l'identique — `diff`
vide contre la sauvegarde) :**

| Mutation appliquée | Résultat |
|---|---|
| garde retirée (`if (false) return { shown:false, reason:"no-gesture" }`) | **4 échecs** — dont « refuse de s'ouvrir quand aucun geste n'est fourni » : `expected {shown:false, reason:'no-dom'} to deeply equal {shown:false, reason:'no-gesture'}` et « la garde du geste est la PREMIÈRE instruction » |
| mode d'onglet inventé (`"onboarding-team"`) + `createTab` au lieu de `openFile` | **3 échecs** — « il réutilise l'écran « Équipe d'agents » EXISTANT » (`expected 'onboarding-team' to be 'agents'`), « le module n'ouvre qu'UN écran » (`expected +0 to be 1`), et la sortie n'ouvre plus l'onglet `['Agents','agents']` |
| écriture ajoutée (`invokeFn("save_config", …)`) | **6 échecs** — dont « aucune écriture de configuration et aucune modification d'agent » |

Restaurations vérifiées : suite complète de nouveau **PASS 3140 / FAIL 0**.

## 8. Documentation

- `spec_onboarding.md` : statut « niveaux 1 et 2 ✅ implémentés », section
  **Niveau 2 — l'équipe d'agents** (réutilisation stricte, jamais tout seul, deux
  écrans, ce qu'il ne fait jamais, garde d'Échap) et couverture de tests.
- `help/overview.md`, bloc `<!-- HELP:demarrage -->` : sous-section
  **« L'équipe d'agents, apprise plus tard et à la demande »** (les deux points
  d'entrée, les deux écrans, le fait qu'elle ne s'ouvre jamais seule).
- `npm run build:handbook` relancé (jamais d'édition manuelle de
  `help/handbook.md`).

---

VERDICT : le niveau 2 est livré — deux écrans réels dans la modale existante, deux entrées discrètes sur clic seulement, jamais ouvert au démarrage, lecture seule de l'équipe (aucune écriture, aucune session, aucun coût), cas vide/illisible toujours dit avec sa marche à suivre, arrivée finale sur l'écran « Équipe d'agents » existant, aucun écran ni onglet nouveau, 3140 tests verts (3113 avant) et preuve de morsure faite sur les trois invariants (geste, absence d'écran de navigation, absence d'écriture).
