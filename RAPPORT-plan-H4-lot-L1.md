# RAPPORT — H4 « plan éditable » — LOT L1 (socle de données, invisible)

> Référence appliquée : `RAPPORT-plan-editable-H4.md` **§ 5, ligne L1 uniquement**
> (+ § 3.1 pour le vocabulaire des états, § 3.5 pour la forme de `approval`,
> § 4.1 comme piège à ne pas aggraver). Aucun autre lot n'a été entamé.
>
> Commit local : `feat(plan): socle du plan editable (lot L1)`. Pas de push, pas
> de tag, version inchangée.

## 0. Compte de tests (mesuré, pas recopié)

| Moment | Commande | Résultat réel |
|---|---|---|
| **Avant** (état du disque à l'ouverture de la mission) | `npx vitest run` | **PASS 3246 / FAIL 0** — 187 fichiers (181 `src/js`, 6 `scripts`) |
| **Après** | `npx vitest run` | **PASS 3278 / FAIL 0** — 188 fichiers (182 `src/js`, 6 `scripts`) |

Delta = **+1 fichier de test, +32 tests**, tous nouveaux et tous verts. Aucun test
existant n'a été modifié ni supprimé : `src/js/orchestration.test.js` est intact.

⚠️ **Écart avec le rapport de conception** : il annonçait « 183 fichiers, 3204
tests » (mesure du 2026-11-05). Sur le disque ce jour : **187 fichiers, 3246
tests** (+4 fichiers, +42 tests apportés par d'autres missions depuis). Les
**numéros de ligne et comptes structurels** cités par le rapport, eux, sont
**toujours exacts** — recomptés, cf. § 1.

## 1. Écarts constatés par rapport au rapport de conception (recomptés sur disque)

| Affirmation du rapport | Contrôle réel | Verdict |
|---|---|---|
| `agent-pi.js` = 9578 lignes | `wc -l` → 9578 | ✅ identique |
| `orchestration.js` = 2182 lignes | 2182 avant modification | ✅ identique |
| 24 sites de rendu | 25 occurrences de `renderOrchestrationPlan(` = 1 définition + **24 appels** | ✅ identique |
| 17 sites `save_plan` | 17 occurrences dans `agent-pi.js` | ✅ identique |
| 7 clés par tâche (`normalizePlan`) | `id, title, description, files, context, depends_on, subtask` | ✅ identique |
| `orchestration.test.js` sans `toEqual` sur une tâche complète | seuls `toMatchObject`, `toEqual([])`, `toEqual([...])` sur des tableaux | ✅ identique |
| Site de création du plan (`agent-pi.js:6861-6875`) | identique, **non touché** (c'est L2) | ✅ identique |
| `replaceTaskWithSubtasks` (`orchestration.js:1546`) | construit des sous-tâches à **7 clés** | ⚠️ **écart de périmètre** : ce site n'était pas nommé en L1. Il a été aligné (cf. § 3.4), sinon le socle serait à deux vitesses : `executableTasks`/`planCounts` verraient deux formes de tâches |
| `task.limits` (§ 2.10) | l'arithmétique de L1 impose **10 clés**, pas 11 | ⚠️ **écart assumé** : l'emplacement réservé du coût est réalisé en `task.constraints.limits` (objet vide, jamais affiché). Il respecte l'intention de § 2.10 sans casser le compte 7 → 10 |

Aucun numéro de ligne utilisé par ce lot n'était devenu faux : rien n'a été
appliqué « à l'aveugle ».

## 2. Ce que le lot L1 devait poser (rappel, sans invention)

1. `normalizePlan` transporte `state`, `constraints`, `edited_by_user` → **clés par tâche 7 → 10**.
2. `plan.approval` initialisé à `pending`.
3. Fonctions pures `executableTasks(plan)` et `planCounts(plan)`.
4. Total **engagé** dans `summarizePlan`.
5. Rien d'autre : **aucun** branchement dans `agent-pi.js` (rendus 24 → **24**,
   `save_plan` 17 → **17**), aucun pixel, aucun libellé.

## 3. Ce qui a été posé (fichier `src/js/orchestration.js`, +227 / −3 lignes)

### 3.1 Transport des trois nouveaux champs dans `normalizePlan`

Chaque tâche normalisée porte désormais :

```
state            → "todo" | "dropped" | "deferred"   (normalizeTaskState)
constraints      → { forbidden_files: [], note: "", limits: {} }  (normalizeTaskConstraints)
edited_by_user   → booléen strict (t.edited_by_user === true)
```

Point capital (piège § 4.1) : ces champs sont **relus** depuis l'entrée, pas
réinitialisés. Une renormalisation (révision, rechargement, subdivision) ne peut
donc plus effacer une retouche de l'utilisateur. Vérifié par un test
d'idempotence (`normalizePlan(normalizePlan(x))` **égal** à `normalizePlan(x)`).

### 3.2 Vocabulaire fermé des états

- `TASK_STATES` = `{TODO:"todo", DROPPED:"dropped", DEFERRED:"deferred"}`.
- `normalizeTaskState(v)` : toute valeur absente ou inconnue → `todo`. Un plan
  produit par l'agent (qui ne pose jamais d'état) reste donc **intégralement
  exécutable** — aucune régression possible sur les plans existants.

### 3.3 Contraintes d'une tâche (forme et bornes seulement, aucun écran)

- `defaultTaskConstraints()` → `{forbidden_files: [], note: "", limits: {}}`.
- `normalizeTaskConstraints(raw)` : chemins non vides, espaces retirés ; remarque
  bornée à **200 caractères** (constante `MAX_CONSTRAINT_NOTE_CHARS`, spec § 2.7) ;
  `limits` conservé s'il est un objet, remis à `{}` sinon.
- `taskHasConstraints(task)` : « cette tâche porte-t-elle au moins une contrainte
  réelle ? » (une remarque vide ou blanche ne compte pas).

### 3.4 Sous-tâches : même forme de tâche

`replaceTaskWithSubtasks` produit désormais des sous-tâches à **10 clés**
(`state: "todo"`, contraintes vierges, `edited_by_user: false`). Les contraintes
de la tâche d'origine ne sont **pas** recopiées : leur sort à la subdivision est
une décision qui appartient au lot L6, elle n'a pas été tranchée ici.

### 3.5 Filtre d'exécution et comptage (purs, non branchés)

- `executableTasks(plan)` : tout sauf `dropped` et `deferred`. Accepte
  `{plan: [...]}` **ou** le tableau de tâches. Ne modifie ni ne renomme rien :
  `pickNextTask` / `isPlanBlocked` sont intacts, ils recevront simplement cette
  liste (L4).
- `planCounts(plan)` → `{total, kept, dropped, deferred, constraints}`.
  Invariant testé : `kept === executableTasks(plan).length`.

### 3.6 Porte d'approbation : trace initialisée `pending`

- `APPROVAL_MODES` = `{PENDING:"pending", HUMAN:"human", AUTO:"auto"}`.
- `pendingApproval()` → `{mode:"pending", at:null, edited:false, edits:0,
  dropped:0, deferred:0, constraints:0, via:null}` (forme exacte de § 3.5).
- `ensureApproval(plan)` → copie superficielle du plan avec une trace **valide**,
  et **n'écrase jamais un accord déjà donné** (`human`/`auto` conservés, champs
  manquants complétés). Un mode inconnu retombe sur `pending` : on ne considère
  jamais approuvé ce qu'on ne comprend pas.
- Cette fonction n'est **appelée nulle part** dans ce lot (L2 s'en servira à la
  création du plan, L7 à la restauration). Le fichier `plan.json` d'un projet
  n'est donc pas modifié aujourd'hui.

### 3.7 Total engagé dans `summarizePlan`

- Nouvelle fonction pure `engagedTaskCount(progress, total)` = `total − dropped −
  deferred`, jamais négatif.
- `summarizePlan(progress, total)` calcule son taux sur ce total engagé.
  **Signature inchangée** (`(progress, total)`) : ses **3 sites d'appel**
  (`agent-pi.js:3656`, `:4530`, `:4577`) ne bougent pas.
- Tant que `progress.dropped` et `progress.deferred` sont vides (état actuel), le
  texte produit est **rigoureusement identique** à l'ancien — verrouillé par un
  test de comparaison de chaîne exacte.

## 4. Ce que chaque test verrouille (`src/js/plan-editable-socle.test.js`, 32 tests)

| Test | Ce qu'il empêche de régresser |
|---|---|
| « porte exactement les 10 clés attendues » | la disparition d'un des 3 champs dans `normalizePlan` (7 → 10) |
| « pose les valeurs par défaut » | un `state` non initialisé, des contraintes `undefined`, une marque d'édition `undefined` |
| « conserve un état, des contraintes et une marque existants » | l'écrasement d'une retouche utilisateur (piège § 4.1) |
| « n'efface pas les retouches à la renormalisation » | la perte d'une retouche au 2ᵉ passage de normalisation |
| « retombe sur todo pour un état inconnu » | l'acceptation d'un état non prévu |
| « expose les trois états et rien d'autre » / `normalizeTaskState` | l'ajout d'un 4ᵉ état ou un état libre venu de l'agent |
| 6 tests de contraintes | chemins non filtrés / non nettoyés, remarque non bornée à 200, `limits` inventé ou tableau, entrée `null`/chaîne, détection de contrainte réelle |
| 5 tests `executableTasks` | l'exécution d'une tâche `dropped` ou `deferred`, la perte d'une tâche sans état, la mutation du plan, une entrée absente |
| 3 tests `planCounts` | un compteur faux, un plan vide, `kept ≠ executableTasks().length` |
| 5 tests de la trace d'approbation | un plan qui naît autre chose que `pending`, un accord `human`/`auto` écrasé, un mode inconnu accepté, la mutation de l'entrée |
| 5 tests `engagedTaskCount` / `summarizePlan` | une tâche écartée comptée comme un échec, un total négatif, une division par zéro, **et toute modification du texte du bilan** quand rien n'est écarté |
| 1 test `replaceTaskWithSubtasks` | des sous-tâches à 7 clés (deux formes de tâches) |

**Preuve que ces tests rougissent vraiment** : mutation volontaire appliquée au
code (suppression du transport de `state` + retour à `total` brut dans
`summarizePlan`), puis `npx vitest run src/js/plan-editable-socle.test.js` →
**5 échecs**. Code restauré ensuite (diff vérifié : seules les lignes du lot
subsistent), suite re-passée → **32/32 verts**.

## 5. Vérifications et résultats (quality-gate)

- [x] `orchestration.js` relu après modification (blocs ajoutés, accolades, exports).
- [x] Points de connexion vérifiés : **aucun export existant renommé ni supprimé** ;
      `normalizePlan`, `summarizePlan`, `replaceTaskWithSubtasks` gardent leur
      signature ; leurs appelants (`agent-pi.js`) sont inchangés.
- [x] Aucun consommateur n'introspecte les clés d'une tâche (`rg 'Object.keys\((t|task|plan)'`
      hors tests → 0 résultat) : l'ajout de 3 clés ne casse rien.
- [x] `plan.rs` écrit et relit le JSON **brut** (`save_plan` / `load_plan`, aucune
      validation de schéma) : pas de migration nécessaire.
- [x] `npx vitest run` complet → **PASS 3278 / FAIL 0**.
- [x] `./node_modules/.bin/vite build` → **✓ built in 16.65s** (le module est bien
      bundlable ; aucun avertissement nouveau hormis les tailles de chunks déjà connues).
- [x] Fins de ligne : fichiers édités en LF (`.gitattributes`), tests du lot sans
      ancre multi-lignes sur le source.
- [x] Aucun fichier Rust touché → pas de `cargo test` nécessaire (et
      `src-tauri/src/agents.rs` était **déjà** modifié avant la mission : laissé
      hors du commit).

## 6. Confirmation : rien de visible n'a changé

- Fichiers modifiés par le lot : `src/js/orchestration.js` (fonctions pures),
  `src/js/plan-editable-socle.test.js` (nouveau), ce rapport. **Aucun autre.**
- `src/js/agent-pi.js` : **non modifié** → sites de rendu **24 → 24**, `save_plan`
  **17 → 17**, boutons d'en-tête (`pause`, `resume`, `reset`, `undo`) intacts,
  contrôles `⏭️` / `✏️` de l'état compact intacts.
- `src/css/style.css` : **non modifié** → aucun pixel déplacé, colonne de gauche
  toujours à 280 px, bande du haut, coin haut droit et bloc des menus du bas
  inchangés.
- Aucun bouton, aucun libellé, aucun réglage ajouté. Aucune nouvelle fonction
  exportée n'est appelée par l'interface : les 8 ajouts (`TASK_STATES`,
  `normalizeTaskState`, `defaultTaskConstraints`, `normalizeTaskConstraints`,
  `taskHasConstraints`, `executableTasks`, `planCounts`, `APPROVAL_MODES`,
  `pendingApproval`, `ensureApproval`, `engagedTaskCount`) sont **inertes** tant
  qu'un lot ultérieur ne les branche pas.
- Seul effet de données, invisible à l'écran : le `.pilot/plan.json` écrit à
  partir de maintenant porte 3 champs supplémentaires par tâche (l'écriture reste
  au même site et au même moment).
- Aucun rapport supprimé de la racine ; documentation **non touchée** (consigne).

## 7. Points laissés ouverts (assumés, pour les lots suivants)

1. **Rien n'est branché.** `executableTasks` / `planCounts` / `ensureApproval`
   sont posés mais pas appelés : c'est exactement ce que demande L1.
2. **L2** doit appeler `ensureApproval(...)` à la création du plan
   (`agent-pi.js:6861`) et rendre `orchestrationRunning = true` conditionnel — la
   condition non négociable « accord impossible pendant l'exécution » se joue là.
3. **L3** (panneau propre à l'onglet) reste entier : `document.getElementById("orchestration-panel")`
   est toujours utilisé, piège § 4.4 **non aggravé** mais **non corrigé**.
4. **L7** doit enrichir `mergeRevisedPlan` : aujourd'hui il repasse les tâches
   révisées par `normalizePlan`, donc une tâche `dropped` redeviendrait `todo`
   lors d'une révision. Le socle rend la conservation *possible*, il ne la fait pas.
5. **L6** doit trancher le sort des contraintes de la tâche d'origine lors d'une
   subdivision (choix explicite : non recopiées ici).
6. Le nombre de tâches `deferred` réintégrées à la reprise, le compteur du pied de
   revue et le message système « plan approuvé » ne sont pas anticipés.
7. `src-tauri/src/agents.rs` reste modifié dans le dépôt de travail (antérieur à
   cette mission) : **volontairement exclu** du commit.

DONE: lot L1 livré — `normalizePlan` transporte `state`/`constraints`/`edited_by_user` (7 → 10 clés, retouches jamais écrasées), vocabulaire fermé des états, contraintes bornées, `executableTasks`/`planCounts`/`engagedTaskCount` pures, trace `approval` initialisée `pending` sans jamais écraser un accord, total engagé dans `summarizePlan` (texte identique tant que rien n'est écarté) ; 32 tests neufs (3278 PASS / 0 FAIL après, 3246 avant ; vérifié qu'ils rougissent par mutation), `vite build` OK, aucun fichier d'interface touché (rendus 24 → 24, `save_plan` 17 → 17, `style.css` intact), rapport `RAPPORT-plan-H4-lot-L1.md` écrit, un commit local sans push ni tag.
