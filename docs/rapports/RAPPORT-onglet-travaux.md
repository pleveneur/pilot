# Rapport — l'onglet « Tâches » du panneau « Travail » devient « Travaux »

Date : 2026-11-16 · Portée : **le nom d'un seul onglet**. Aucune logique, aucune
mise en page, aucun comportement du panneau n'a changé.

## Pourquoi

Le panneau « Travail » (bouton `#agent-activity`, en haut à droite) a trois
onglets : Agents, Tâches, Événements. L'onglet « Tâches » ne montre **que le
travail des agents** (missions en cours, en démarrage, en attente) — jamais les
tâches du suivi (Kanban, avec checklists de livraison). Le propriétaire a
confondu les deux. Le nom de l'onglet devient **« Travaux »** : la confusion
tombe par le nom, sans toucher au contenu.

## Occurrences trouvées, et ce qu'elles sont devenues

### Changées — libellés réellement produits à l'écran

| Endroit | Avant | Après |
|---|---|---|
| `index.html` — bouton de l'onglet `#agent-activity-tab-tasks` | `Tâches` | `Travaux` |
| `src/js/agent-activity.js` — `AGENT_PANEL_TAB_LABELS.tasks` (source des libellés du module) | `"Tâches"` | `"Travaux"` |
| `index.html` — libellé du réglage « Onglet … dans le panneau du suivi du travail » (Options → Assistant) | `Onglet « Tâches » …` | `Onglet « Travaux » …` |
| `index.html` — infobulle **title** de cette même case | `Afficher l'onglet « Tâches » …` | `Afficher l'onglet « Travaux » …` |

Aucun autre texte affiché ne nommait cet onglet : il n'y a **ni infobulle sur le
bouton de l'onglet**, **ni libellé de bouton recopié**, et le **texte d'état vide**
du volet (« **Aucune mission en cours.** ») ne nomme pas l'onglet — il est donc
laissé tel quel.

### Changées — commentaires et documentation qui désignent l'onglet

Un renommage d'affichage qui laisse l'ancien nom dans le code recrée la
confusion qu'on vient de lever. Les 26 occurrences de `« Tâches »` / `« Taches »`
entre guillemets qui **désignent cet onglet ou son volet** sont alignées, plus
les énumérations d'onglets :

- `src/js/agent-activity.js` (module propriétaire du libellé), `agents-ui.js`,
  `main.js`, `project-task-queue.js`, `settings.js`, `super-agent.js`,
  `super-agent-kanban.js`, `super-agent-kanban-view.js`,
  `taches-suivies-ecran.js` ;
- `AGENTS.md` (table d'arborescence, ligne du module `taches-suivies-ecran.js`) ;
- `spec_super_agent.md` (11 mentions : panneau, ordre des onglets, réglage,
  compte de travail, réglages du compteur) ;
- `spec_modes_ecran_vocal.md` § 3ter (« le même panneau à trois onglets
  Agents · Travaux · Événements ») ;
- `README.md` (description utilisateur des trois onglets et du compteur).

### Aide intégrée

Le bloc `<!-- HELP:super-agent-panneau-taches -->` de `spec_super_agent.md`
nommait l'onglet : il est mis à jour, puis `npm run build:handbook` a été
relancé (48 blocs). `help/overview.md` ne nommait pas cet onglet : inchangé.

### Volontairement laissées

| Occurrence | Raison |
|---|---|
| « Tâches du suivi », « Tâches bloquées », « Tâches terminées/livrées » (Kanban, rapports périodiques, `dashboard.js`, `period-report.js`, `super-agent-context.js`) | Ce sont les **tâches du suivi**, pas l'onglet : elles gardent leur nom. |
| **Onglet Kanban** (`>Kanban<`), **colonne de droite de l'écran Vocal**, **panneau du suivi des tâches**, bouton **« Travail »** | Hors périmètre (consigne) : vérifiés intacts par le verrou ajouté. |
| Documents d'historique : `docs/rapports/*`, `docs/conceptions/*`, `docs/proposition-*.md`, `release-notes/*` | Archives datées : elles décrivent l'état à leur date, on ne les réécrit pas. |
| `help/overview.md` | Ne nomme pas cet onglet. |

## Tests

Verrou ajouté : `src/js/libelle-onglet-travaux.test.js` (4 tests) — il vérifie
(a) que le bouton de l'onglet affiche « Travaux » et **jamais** « Tâches »,
(b) que `AGENT_PANEL_TAB_LABELS.tasks === "Travaux"`, (c) que le réglage des
Paramètres (libellé **et** infobulle) le nomme « Travaux », et (d) que rien
d'autre n'a bougé (entrée « Travail », ordre Agents / Travaux / Événements,
libellés Agents et Événements, onglet « Kanban »). Les découpages de source
passent par `sliceSource` (aucun découpage non protégé ajouté — inventaire de
`source-slice.test.js` respecté).

Preuve par mutation : en remettant `tasks: "Tâches"` dans
`AGENT_PANEL_TAB_LABELS`, le verrou **échoue** ; il repasse au vert à la
restauration.

Tests existants **adaptés**, sans être desserrés :

- `src/js/panneau-suivi-trois-onglets.test.js` : la valeur attendue de
  `AGENT_PANEL_TAB_LABELS.tasks` passe à `"Travaux"`, et l'assertion sur le
  libellé du réglage exige désormais `Travaux` **et** l'absence de `Tâches`
  (elle est donc plus stricte qu'avant) ;
- `src/js/taille-et-style-panneau.test.js` : la liste des trois libellés lus
  dans `index.html` devient `["Agents", "Travaux", "Événements"]`.

Résultat mesuré de `npm test` (recompté, non recopié) :

```
Test Files  304 passed (304)
     Tests  5651 passed (5651)
```

## Commit

`feat(panneau-travail): l'onglet « Taches » devient « Travaux »`

✅ Vérifications effectuées
- `index.html` relu autour des trois points modifiés (bouton, commentaire
  d'en-tête, réglage) : syntaxe et attributs intacts, identifiants inchangés.
- `agent-activity.js` relu sur les zones touchées : `AGENT_PANEL_TABS` et
  l'ordre des onglets inchangés, seul le libellé change.
- Aucune occurrence restante du libellé de l'onglet dans le code produit
  (`src/`, `web/`) : recherche exhaustive sur `Tâches|Taches` vérifiée fichier
  par fichier.
- `help/handbook.md` régénéré par `npm run build:handbook` (ne pas éditer).
- Aucune version, aucun workflow de publication touché.
