# Rapport d'application — compteur de travail de l'entrée « Travail »

> Proposition appliquée : `RAPPORT-compteur-taches.md`, **telle quelle**.
> Les trois arbitrages fixés n'ont pas été réouverts :
> 1. **Total** = tâches **en cours + en attente**.
> 2. Les **deux familles d'attente oubliées** sont comptées **maintenant** :
>    file des commandes manuelles d'un projet, file d'exclusivité du bus d'agents.
> 3. Le **signal des événements non lus** n'est pas perdu : point du bouton
>    **+ point de 6 px** sur l'onglet « Événements » (aucun chiffre en clair).
>
> Aucun fichier Rust touché. Aucune structure de données nouvelle. Aucune
> suppression.

---

## 1. Ce qui a été appliqué

| Fichier | Changement | Preuve |
|---|---|---|
| `index.html` | Le badge de non-lus (`#agent-activity-badge`) quitte le bouton ; sa place porte `#agent-activity-count` (dans le flux, après le mot « Travail »). Le point du bouton perd ses attributs d'accessibilité en double. L'onglet « Événements » gagne `#agent-activity-events-unread` + `aria-label="Événements"`. | `index.html:225` (bouton), `:245` (onglet) |
| `src/js/agent-activity.js` | `agentTaskCounterText()` (pure, `en cours/total`, vide à zéro, plafond 99+), `agentTaskCounterLabel()` (pure, nombres **réels** pour `title`/`aria-label`), `agentUnreadTooltip()` (pure), `paintAgentPanelTaskCount()`, `setAgentPanelTaskCount()`. `updateAgentPanelBadge()` ne touche plus aucun badge : point du bouton + point de l'onglet + infobulle. `setActivityExpanded()` pose `aria-expanded` sur le **bouton** seulement. | `agent-activity.js:1204`, `:1219`, `:1236`, `:1248`, `:1275`, `:1338-1350`, `:1410` |
| `src/css/style.css` | Bloc `#agent-activity-count` : texte seul (aucun fond, aucune bordure, aucun `border-radius`, aucune animation), `color:var(--text-secondary)` (AA dans les deux thèmes), `font-variant-numeric:tabular-nums` (largeur stable), **aucune hauteur**. `#agent-activity-events-unread` : point de 6 px. `.sa-events-tab` : `gap:4px` (l'onglet est `inline-flex`, le point est donc réellement peint). | `style.css:1978-2000` (compteur), `:2001-2016` (point), `.sa-events-tab` (`gap`) |
| `src/js/super-agent.js` | `publishSuperMissionsCount()` : **un seul** calcul `buildRunningMissions(...)` + `splitMissions(...)`, puis `setAgentPanelTaskCount()`. `renderSuperMissions()` **reprend** ce résultat (aucun second calcul). `collectQueuedMissions()` couvre **quatre** familles. `onPanelTabChanged` n'arrête plus la surveillance. Abonnement de secours à la fermeture de l'onglet Assistant. | `super-agent.js:2578-2587`, `:2589-2591`, `:2616-2645`, `:2672`, `:2883`, `:3969` |
| `src/js/project-task-queue.js` | `listAllProjectCommands()` (lecture de la file **existante** de tous les projets) + `countProjectQueuedCommands()` (pure). | `project-task-queue.js:433`, `:455` |
| `src/js/agents-bus.js` | `listExclusivityWaitingDemands()` : lecture de `projectExclusivityQueues` (file **existante**). | `agents-bus.js:458` |
| `src/js/compteur-taches-travail.test.js` | **Nouveau verrou** (24 tests) : voir §4. | nouveau fichier |
| `spec_super_agent.md` | Aide utilisateur réécrite (langage clair) + section technique dédiée. | `spec_super_agent.md:115-133` (aide) et section « Technique — compteur de travail » après la fin du bloc d'aide |
| `README.md` | La description « une pastille indique les événements non lus » devient : compteur `en cours / total`, quatre familles comptées, signal des non-lus à **deux** endroits. | `README.md` § « Suivre le travail » |
| `help/handbook.md` | Régénéré (`npm run build:handbook`) — 45 blocs, 273 743 octets. | commit |

## 2. Forme exacte du compteur

- Texte `en cours/total`, ex. `2/5` ; **rien** quand `en cours + total <= 0`
  (aucun `0/0` permanent).
- Plafond `99+` appliqué **chiffre par chiffre** (`99+/99+` — le `2/5` reste
  cohérent avec lui-même) ; les **nombres réels** sont dans `title` **et**
  `aria-label` (même chaîne).
- Le chiffre **s'allume** (`--text-primary`) dès qu'une tâche est **en cours** ;
  aucune animation, aucun fond, aucune pastille.
- Le compteur **suit le réglage** de l'onglet « Tâches » : onglet masqué ⇒
  compteur masqué (il ne renvoie jamais à un volet absent).

## 3. Une seule source pour le bouton et l'onglet

`publishSuperMissionsCount()` calcule une fois
`buildRunningMissions(getAgentActivitySnapshot().list, collectQueuedMissions())`
puis `splitMissions()` ; le bouton reçoit `running.length` / `waiting.length`
et le volet « Tâches » reçoit **les mêmes missions**. Aucun second calcul : le
bouton ne peut pas contredire l'onglet. Le compte reste vrai **onglet Assistant
fermé** (abonnement `subscribeAgentActivity(publishSuperMissionsCount)` posé à
la fermeture), et `onPanelTabChanged` n'arrête plus la surveillance — seul le
**rendu de la liste** est conditionné par `isAgentPanelPaneVisible("tasks")`.

## 4. Non-régression — chiffres recomptés sur le disque

Comptés par moi-même (`npx vitest run --reporter=json`), pas repris d'un
document :

| | Avant travaux | Après travaux | Écart |
|---|---|---|---|
| Suites (`numTotalTestSuites`) | **1030** | **1037** | **+7** |
| Tests (`numTotalTests`) | **3167** | **3191** | **+24** |
| Réussis | 3167 | 3191 | +24 |
| Échecs | **0** | **0** | 0 |

Explication des deux écarts, vérifiée : **+24 tests = exactement les 24 tests du
nouveau verrou** (aucun test existant ajouté ni supprimé) ; **+7 suites = 1
fichier + ses 6 `describe`**. Le balayage complet (`npx vitest run`) termine sur
`PASS (3191) FAIL (0)`.

### 4.1 Le verrou `src/js/compteur-taches-travail.test.js` (24 tests)

Couvre, avec les **fonctions réelles** (aucune copie) :
(a) « en cours / total », « rien » à vide, `0/3`, plafond `99+` + nombres réels
dans l'infobulle, une seule chaîne pour `title`/`aria-label` ;
(b) **bouton = onglet** sur 5 situations (`0/0`, `1/0`, `0/3`, `2/3`, `120/40`) et
`1 + 4 = 1/5` (un compteur qui ignorerait l'attente afficherait `1/1`) ;
(c) les **deux familles oubliées** comptées depuis les files existantes
(`enqueueProjectCommand` → `countProjectQueuedCommands`, `enqueueExclusivity` →
`listExclusivityWaitingDemands`) et **présentes dans `collectQueuedMissions`** ;
(d) aucune pastille/fond/bordure/animation, `tabular-nums`, ancien badge absent
du HTML, du CSS **et** du JS ;
(e) hauteur de rangée (36 + 1 = **37 px**), bouton 22 px, compteur sans hauteur
ni retour à la ligne, point de 6 px ;
(f) signal des non-lus : infobulle avec pluriel juste, les deux points présents,
`updateAgentPanelBadge` sur **un seul** calcul de compte.

Le découpage du CSS passe par `sliceSource()` (`src/js/source-slice.js`) :
l'inventaire `source-slice.test.js` **interdit** un découpage non protégé. Ma
première version utilisait `css.indexOf`/`slice` — l'inventaire l'a refusée
(`1 découpage non protégé mesuré, relevé 0`), corrigé en `sliceSource`.

### 4.2 Preuve que le test mord (sabotages réels, puis restauration)

**Sabotage 1 — le total oublie l'attente** (`cappedCount(r + w)` → `cappedCount(r)`) :

```
FAIL (b) > le total n'oublie jamais l'attente : 1 en cours + 4 en attente = 1/5
AssertionError: expected '1/1' to be '1/5'
Tests  4 failed | 20 passed (24)
```
Les 4 échecs sont exactement les cas avec de l'attente (`0/3`, `2/3`, `1/5`,
`120/40`). Restauration vérifiée : `diff` avec la copie de sauvegarde →
**identique**.

**Sabotage 2 — une famille d'attente disparaît** (`listAllProjectCommands()` et
`listExclusivityWaitingDemands()` remplacés par `[]` dans `collectQueuedMissions`) :

```
FAIL (c) > super-agent.js lit les DEUX familles dans collectQueuedMissions
AssertionError: expected 'function collectQueuedMissions() {\n …' to match /listAllProjectCommands\(\)/
Tests  1 failed | 23 passed (24)
```
Restauration vérifiée : les deux boucles sont revenues (`super-agent.js:2632`,
`:2636`), fichier identique à la copie de sauvegarde.

## 5. Hauteur de la rangée d'onglets — avant / après

Mesure par lecture du CSS (méthode du projet, pas d'infobulle d'estimation) :
`min-height` de `#tab-row` + épaisseur de son filet bas, marges verticales du
conteneur `#agent-activity`, hauteur du bouton, présence/hauteur du compteur.

| Grandeur | Avant | Après |
|---|---|---|
| `rangee_min_height_px` | 36 | **36** |
| `rangee_filet_bas_px` | 1 | **1** |
| **`rangee_peinte_px`** | **37** | **37** |
| `conteneur_travail_marges_verticales_px` | `[0]` | **`[0]`** |
| `bouton_travail_height_px` | 22 | **22** |
| `compteur_present` | `false` | `true` |
| `compteur_height` | — | **`null`** (aucune hauteur déclarée) |
| `compteur_line-height` | — | **`1`** |

**Aucun pixel ajouté.** Le compteur n'a ni hauteur ni `flex-basis` propre
(`flex: 0 0 auto`, `line-height: 1`, `--font-xs`), il ne passe jamais à la ligne
et vit dans les 22 px du bouton ; le point de 6 px de l'onglet vit dans les 24 px
de la barre d'onglets. Le script de mesure temporaire (`.mesure-rangee.mjs`) a
été **supprimé** avant le commit.

## 6. Écarts constatés sur le disque (signalés, pas corrigés en silence)

1. **Documents historiques** encore écrits avec l'ancien badge :
   `RAPPORT-lot4-presentation-contexte.md` (§ tableau, § 36), `docs/proposition-
   bande-contexte-allegee.md:58`, `docs/proposition-presentation-ui.md:74` et
   `:512` parlent de `#agent-activity-badge`. Ce sont des **rapports/propositions
   datés**, pas de la documentation vivante : je ne les ai **pas réécrits**.
2. **`dist/`** contient encore l'ancien bundle (`dist/index.html:225` montre
   `#agent-activity-badge`). C'est un artefact de build, reconstruit par
   `npm run tauri build` : non touché.
3. **La marge du panneau** : la proposition calculait 20,3 px de marge. Vérifié
   sur le CSS réel : `.sa-events-tab` est `inline-flex` et `.sa-events-tabs` a
   `gap:4px`, donc le point de 6 px **est** peint (6 + 4 = 10 px) — la marge
   reste tenable car les trois onglets tiennent dans la largeur minimale du
   panneau (300-360 px) avec de la place à revendre. Aucun changement de largeur
   n'a été nécessaire.
4. **Documentation vivante en retard sur le code** : `README.md` et
   `spec_super_agent.md` décrivaient encore « une pastille sur l'entrée Travail =
   nombre d'événements non lus ». C'est **corrigé** (§1), et l'aide intégrée est
   régénérée.
5. **`aria-expanded` en double** : il était posé sur le bouton **et** sur le point
   intérieur. Il ne reste que sur le bouton (un lecteur d'écran n'annonce plus
   deux fois le même état). Aucun identifiant perdu.

## 7. Ce qui n'a PAS été touché

Zone haute validée, coin haut droit (Réduire/Agrandir/Disposer/Fermer), largeur
de la colonne de gauche, bandeau, ordre des trois onglets du panneau, réglage
« Événements en plein écran », identifiants et classes préservés
(`#agent-activity-entry`, `#agent-activity-dot`, `.agent-activity-entry-label`,
`#agent-activity-dropdown`, `#agent-activity-list`,
`#agent-activity-tab-{agents,tasks,events}`, `#agent-activity-pane-*`,
`.sa-events-tabs`, `.sa-events-tab`, `#tab-row`, `#tab-bar`, `#window-controls`),
code Rust, version (`0.5.0`), workflow de release.

## 8. Commandes

```bash
npx vitest run                      # PASS (3191) FAIL (0)
npm run build:handbook              # aide intégrée régénérée (45 blocs)
npm run tauri dev                   # contrôle visuel : compteur 2/5, point, infobulle
```
