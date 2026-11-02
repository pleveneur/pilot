# RAPPORT — H4 : Plan Editor visuel (approbation structurée)

> **Nature du document : conception UI/UX. Aucun code, aucun test modifié.** Le seul
> fichier écrit par cette mission est celui-ci. Toutes les affirmations sur
> l'existant portent une preuve `fichier:ligne`, recomptée sur le disque le
> 2026-11-05 (`agent-pi.js` = 9578 lignes, `orchestration.js` = 2182,
> `style.css` = 11249, `plan.rs` = 71, `spec_orchestration.md` = 1111,
> `idees_evolutions.md` = 962).
>
> **État de départ mesuré** : `npx vitest run` → **183 fichiers, 3204 tests, tous
> verts** (177 fichiers dans `src/js/`, 6 dans `scripts/`). Le dépôt de code est
> propre (`git status` : aucune modification de fichier suivi).
>
> **Décisions NON rouvertes** : bande haute supprimée, trois boutons système en
> bout de rangée d'onglets, colonne de gauche 280 px (`style.css:739-740`),
> organisation des menus, échelle de texte 11/12/13/15 px (`style.css:273-279`).
> Ce rapport ne les touche pas ; il s'y range.
>
> **Hors périmètre assumé** : l'**estimation de coût par tâche** demandée par la
> fiche H4 d'origine (`idees_evolutions.md:483-486`) est **exclue** de cette
> conception. On réserve un emplacement — jamais un libellé vide ni un chiffre
> inventé (§ 2.9).

---

## 0. Résumé pour décider

| Question | Réponse courte |
|---|---|
| Le plan est-il approuvé aujourd'hui ? | **Non.** Il démarre tout seul à réception : `agent-pi.js:6866-6875`. |
| Que peut-on déjà retoucher ? | Deux gestes, **après** démarrage : sauter (`⏭️`) et éditer la description via `prompt()` (`agent-pi.js:3386-3409`). |
| Y a-t-il une place pour une revue avant démarrage ? | **Oui** : un état d'attente entre le parsing (`agent-pi.js:6819-6861`) et `orchestrationRunning = true` (`:6866`). |
| Combien de lots ? | **8**, chacun livrable seul (l'app ne ment jamais à mi-chemin). |
| Le plus gros risque | Dès que `orchestrationRunning` passe à `true`, **toutes** les questions et portes d'écriture sont auto-approuvées (`:8877`, `:8908`, `:9197`). L'approbation humaine doit donc être enregistrée **avant**, jamais être « une porte de plus ». |
| Deuxième risque | Le panneau d'orchestration est adressé par un **id global** (`agent-pi.js:516`, lu en `:3169` et `:3184`) : avec deux onglets agents, la revue du 2ᵉ écrirait dans le 1ᵉʳ. À corriger **avant** d'ouvrir l'édition. |

---

## 1. État des lieux prouvé

### 1.1 Où le plan est produit

| Élément | Preuve | Remarque utile pour H4 |
|---|---|---|
| Prompt de planification | `orchestration.js:291` `buildPlanPrompt(userText, existingPlan, projectTree, keyFileContents, granularity)` | accepte un **plan existant** → réutilisable tel quel pour « Revoir avec l'agent » |
| Granularités | `orchestration.js:296-316` : `atomic` (1 fichier, ~10-25 lignes, 15-40 tâches), `fine` (2 fichiers, ~30-60, 5-25), `medium` (3, ~60-120, 3-12), `large` (5, ~100-200, 2-6) | le nombre de tâches attendu est donc **très variable** : la liste doit défiler, pas être figée |
| Extraction du plan | `orchestration.js:101` `parsePlanResponse` (bloc ```` ```json ````, objet `{"plan": …}` équilibré, candidats, parse global) | rien n'existe tant que l'objet n'est **pas complet** |
| Normalisation | `orchestration.js:55-87` `normalizePlan` | **écrase** les champs inconnus : 7 clés seulement (`id, title, description, files, context, depends_on, subtask`) → toute retouche doit y être transportée |
| Qualité | `orchestration.js:1459` `validatePlan` : `reject` si plan vide ; `reject` si `< 3` tâches pour une demande `> 100` car. ; `warn` si description `< 40` car., `> 3` fichiers, titre `> 80` car. | un plan édité peut légitimement tomber sous ces seuils **après** édition → à ne pas re-valider à l'approbation (§ 3.6) |
| Re-plan automatique | `agent-pi.js:6842-6865` (1 seule tentative, puis exécution quand même) | un 2ᵉ plan peut arriver **pendant** la revue |

### 1.2 Où il est affiché

| Élément | Preuve |
|---|---|
| Panneau | créé par onglet, `agent-pi.js:512-540` : `.orchestration-panel.hidden`, **`id="orchestration-panel"`** (`:516`), 4 boutons d'en-tête (`pause`, `resume`, `reset`, `undo`), barre de progression, métriques, journal des tentatives, `<div class="orchestration-tasks" id="orch-tasks">` (`:536`) |
| Position dans l'onglet | ordre réel : messages (`:345`) → barre d'outils (`:379`) → bloc file (`:390`) → **panneau (`:538`)** → barre de saisie (`:565`) |
| Rendu de la liste | `agent-pi.js:3182` `renderOrchestrationPlan(messagesEl, st)`, **appelée depuis 24 sites** (`:2476, 2882, 3389, 3405, 3581, 3637, 3649, 3667, 3690, 3705, 3721, 4014, 4026, 4034, 4071, 4539, 4569, 4586, 4610, 4623, 4660, 4758, 5155, 6872`) |
| Anatomie d'une ligne | `agent-pi.js:3196-3220` : `.orch-task` > `.orch-task-status` (`✅`/`❌🔧`/`🔁`/`🔄`/`☐`) + `.orch-task-title` + `.orch-task-controls` |
| Contrôles existants | `⏭️` sauter (`data-task-action="skip"`) et `✏️` éditer (`data-task-action="edit"`), visibilité `canSkip = !isDone && !isCurrent`, `canEdit = !isDone` (`:3205-3213`) ; handler par délégation `agent-pi.js:1919-1931` |
| Barre et métriques | `agent-pi.js:3226-3262` : `total = tasks.length`, `done = completed + escalated`, libellés « réussie(s) / échouée(s) / sautée(s) » |
| Titre du panneau | `agent-pi.js:3168-3180` : « Plan d'orchestration : <extrait ≤ 70 car.> », icône `clipboard-list` |
| Styles | `style.css:6960-7110` : panneau `--surface-1`, `padding: 12px 16px`, **`max-height: 320px`**, `overflow: hidden` ; `.orchestration-tasks` `overflow-y: auto`, `gap: 4px` ; `.orch-task` `padding: 6px 8px`, `--font-sm`, `gap: 8px` ; titres en `--font-md` (14 px) — **hors échelle 11/12/13/15** (dette existante, non rouverte ici) |

**Ce qui est montré pendant la planification** : le JSON brut défile dans la bulle
de l'assistant, rendu en Markdown (`agent-pi.js:7165` et `:7177`). Il n'existe
aucun rendu intermédiaire du plan avant sa réception complète.

### 1.3 Où il est lu et exécuté

| Élément | Preuve | Conséquence pour H4 |
|---|---|---|
| Sélection de tâche | `orchestration.js:1142` `pickNextTask(tasks, doneIds)` : première tâche non terminée dont **toutes** les dépendances sont dans `doneIds` | un seul point de passage pour retirer les tâches écartées |
| Plan bloqué | `orchestration.js:1161` `isPlanBlocked` | idem |
| **2 sites d'appel seulement** | `agent-pi.js:3614-3620` (`doneIds` construit `completed ∪ escalated`, puis `pickNextTask`, puis `isPlanBlocked`) | la découpe est très contenue |
| Boucle d'exécution | `agent-pi.js:3589` `executeNextTask` : sort si pas de plan, si `orchestrationPaused`, si `isStreaming` | la porte d'approbation peut s'appuyer sur `orchestrationPaused` |
| Fin de plan | `agent-pi.js:3624-3672` : `remaining = tasks − doneIds` ; si `remaining.length === 0` → « ✅ Plan terminé » + bilan + `plan = null` | **une tâche écartée qui n'entre pas dans `doneIds` empêche la clôture** (§ 3.2) |
| Bilan | `orchestration.js:1284-1293` `summarizePlan(progress, total)` : taux = `completed / total` | une tâche écartée compterait comme un échec si le total n'est pas ajusté |
| Subdivision | `agent-pi.js:3574-3584` `applySubdivision` → `replaceTaskWithSubtasks` (`:3577`) | écrase le plan pendant l'exécution (§ 4.1) |
| Révision périodique | `agent-pi.js:4655` et `:4753` → `mergeRevisedPlan` (`orchestration.js:1176`) : **remplace toutes les tâches restantes** | écrase aussi les retouches si rien ne les protège |
| Fichiers modifiés (preuve d'écriture) | `orchestration.js:961` `captureFileState(task)` (existence + mtime des `task.files`), `orchestration.js:1046` `checkTaskFilesChanged` | base de la vérification d'une contrainte « ne touche pas à X » (§ 3.4) |
| **Application des écritures** | `orchestration.js:1691-1766` `applySearchReplaceBlocks(blocks, invokeFn, projectPath)` : boucle par chemin, puis `write_file_content` | **le seul endroit qui écrit sur disque pour le codeur** : c'est là qu'une interdiction se refuse |

### 1.4 Comment le plan est « approuvé » aujourd'hui : il ne l'est pas

Séquence exacte, `agent-pi.js:6819-6875` :

1. fin de réponse de l'orchestrateur → `parsePlanResponse(rawText)` (`:6819`) ;
2. repli DOM si le texte brut est vide (`:6822-6828`) ;
3. `validatePlan` + éventuel re-plan (`:6835-6857`) ;
4. plan accepté → `state.orchestrationPlan = {…, progress}` (`:6861`) ;
5. **`state.orchestrationRunning = true`** (`:6866`) ;
6. `save_plan` (`:6874`) ;
7. message « 📋 Plan reçu avec N tâches. Démarrage de l'exécution... » (`:6873`) ;
8. `await executeNextTask(...)` (`:6875`).

**Aucune confirmation, aucun délai, aucune trace d'accord humain.** Le seul
« refus » possible est un Ctrl+Z après coup : `orch-reset` (nouveau plan) ou
`orch-undo` (restauration Git de la dernière tâche, `spec_orchestration_snapshots.md`).

**Aggravant, décisif pour la conception** : dès que `orchestrationRunning === true`,
l'agent devient autonome et **les portes sont auto-approuvées** :

| Porte | Preuve | Effet |
|---|---|---|
| Confirmation `ctx.ui.confirm` | `agent-pi.js:8877-8883` | `confirmed: true` renvoyé sans affichage |
| Choix à options | `agent-pi.js:8908-8924` | **1ʳᵉ option** choisie automatiquement |
| Saisie libre | `agent-pi.js:8943` | `cancelled` |
| Porte pré-écriture (diff review) | `agent-pi.js:9197-9202` : `gateActive = confirmFileEdits && !orchestrationRunning` | **désactivée en orchestration** |

⇒ L'approbation du plan **n'est pas** une porte de plus : elle vit à
`orchestrationRunning === false`, dans un état d'attente dédié. Si on la codait
comme une `extension_ui_request`, elle serait auto-approuvée par ces quatre sites.

### 1.5 Où le plan est persisté

| Élément | Preuve | Remarque |
|---|---|---|
| Écriture | `plan.rs:16-36` `save_plan` → `<projet>/.pilot/plan.json`, JSON **brut**, aucune validation de schéma | tout champ ajouté est écrit sans migration |
| Lecture | `plan.rs:39-52` `load_plan` → `""` si absent | un seul plan **par projet** |
| Suppression | `plan.rs:55-70` `delete_plan` | — |
| Fréquence d'écriture | **17 sites** `save_plan` (`agent-pi.js:2474, 3388, 3404, 3580, 3657, 3677, 4013, 4025, 4033, 4531, 4578, 4609, 4616, 4659, 4757, 5154, 6874`) | les retouches doivent être persistées, sinon perdues |
| Chargement | **1 seul site** : `agent-pi.js:2864`, à l'activation du mode orchestration (`:2860-2882`) | un plan en attente serait **perdu** à la fermeture de l'onglet ou au redémarrage (§ 4.6) |

### 1.6 Ce qui est réutilisable, et ce qu'on n'utilise pas

| Réutilisable | Preuve | Usage dans H4 |
|---|---|---|
| Le panneau et sa liste | `agent-pi.js:512-540`, `:3182` | support unique : la revue est un **état** du même panneau |
| Les contrôles `skip` / `edit` | `agent-pi.js:3205-3220`, `1919-1931` | même mécanisme `data-task-action`, mêmes classes `.orch-task-btn` |
| `orchestrationPaused` | `agent-pi.js:3594-3596` | gèle la boucle sans nouveau drapeau |
| `buildPlanPrompt(existingPlan)` | `orchestration.js:291`, `:318-340` | « Revoir avec l'agent » envoie un **plan existant**, pas un prompt neuf |
| `mergeRevisedPlan` | `orchestration.js:1176` | point unique où « l'humain gagne » doit être appliqué |
| `captureFileState` / `checkTaskFilesChanged` | `orchestration.js:961`, `:1046` | vérification d'une contrainte après la tâche |
| `applySearchReplaceBlocks` | `orchestration.js:1691` | refus d'écriture d'un fichier interdit |
| `summarizePlan` | `orchestration.js:1284` | bilan à ajuster (tâches écartées) |
| Jetons de thème | `style.css:259-306` (`--font-*`, `--radius-*`, `--surface-*`, `--accent*`, `--success/--warning/--danger`) | aucune couleur en dur |
| Instrument de contraste | `src/js/contraste-evenements-sombre.test.js` (calcul de luminance + mesure par sélecteur) | le lot 8 peut le réutiliser tel quel pour la vue révision |
| Boutons de choix du chat | `style.css:5680+` `.agent-choice*` | **non réutilisé** : la revue est déterministe, elle n'appelle pas le modèle |
| `prompt()` natif | `agent-pi.js:3401` | **à remplacer** : dialogue navigateur, hors thème, bloquant (§ 2.5) |
| Boutons `.agent-choice-btn` | `style.css:5687` | modèle de bouton de choix (12 px, radius 8) — **réutilisable** pour les actions du pied |

### 1.7 Ce qui n'existe pas et qu'il faut créer

| Manquant | Pourquoi c'est nécessaire |
|---|---|
| Un état « plan en attente d'accord » | aujourd'hui le seul état est « en exécution » |
| Un champ `state` par tâche (`todo` / `dropped` / `deferred`) | `normalizePlan` n'en transporte aucun (`orchestration.js:55-87`) |
| Un champ `constraints` par tâche | `task.context` est du texte libre, jamais vérifié |
| Une trace d'approbation (`approval`) | rien dans le fichier persisté (`plan.rs:16-36`) |
| Un compteur des tâches hors exécution | la barre et le bilan ne connaissent que `completed`/`failed`/`escalated` (`agent-pi.js:3227-3262`) |
| Un rendu éditable de la ligne | la ligne est un `innerHTML` figé (`agent-pi.js:3214-3219`) |
| Aucun test ne verrouille la liste | vérifié : `grep "data-task-action\|orch-task\|orchestration-panel"` dans `src/js/*.test.js` et `scripts/*.test.js` → **0 résultat** : ajouter des contrôles ne fait rougir aucun test existant |

---

## 2. Proposition d'écran

### 2.1 Principe : un **état** de l'onglet agent, pas un nouvel écran

Trois raisons mesurées de ne pas créer de fenêtre ni d'onglet :

1. **La place** : à la fenêtre minimale (800 × 500, `tauri.conf.json:47-48`), il
   reste 440 px de haut après la rangée d'onglets (36 px, `style.css:1832`) et la
   barre d'état (24 px, `style.css:914-915`). La barre d'outils de l'agent (~48 px,
   `style.css:4665-4672`) et la barre de saisie (~61 px, `style.css:4975-4982` +
   `.agent-input` `min-height: 36px` `:5108`) en consomment déjà 109 : le panneau
   actuel (320 px max) laisse **~11 px** de conversation. Une fenêtre de plus
   n'ajouterait pas un pixel.
2. **Le contexte** : la revue a besoin de la demande d'origine (déjà dans
   `orchestrationLastUserPrompt`, utilisée en `agent-pi.js:3169`).
3. **Les décisions fermes** : aucun nouvel emplacement n'est à négocier.

⇒ **La vue « Révision du plan » remplace la conversation dans l'onglet** (mêmes
pixels, aucun ajout), avec un lien pour revoir la conversation sans perdre les
retouches. La barre de saisie est **remplacée** par le pied d'actions : une seule
issue possible, aucun champ concurrent.

### 2.2 Les deux états du panneau

| État | Déclencheur | Hauteur | Ce qui est visible |
|---|---|---|---|
| **compact** (aujourd'hui) | `orchestrationPlan` présent et approuvé | `max-height: 320px` (inchangé) | titre, 4 boutons d'en-tête, progression, métriques, liste, contrôles `⏭️`/`✏️` |
| **revue** (nouveau) | `orchestrationPlan.approval.mode === "pending"` | `flex: 1` (toute la zone) | en-tête de revue, liste éditable, pied d'actions ; conversation masquée (`.agent-chat-messages.hidden`), barre de saisie remplacée |

Aucun troisième état. À l'approbation, retour immédiat à **compact**, avec une
marque d'approbation dans l'en-tête (§ 3.5).

### 2.3 Maquette (fenêtre 800 × 500, largeur utile de conversation ≈ 520 px)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⟳ Plan proposé · 8 tâches · non approuvé            [voir la conversation] │ 28 px
├────────────────────────────────────────────────────────────────────────────┤
│ Demande : « Ajoute un bouton d'export CSV dans le tableau de bord… »       │ 11 px
├────────────────────────────────────────────────────────────────────────────┤
│ ▸ ☑  1  Créer le module d'export                          ⚑1              │ 32 px
│ ▸ ☑  2  Brancher le bouton dans l'en-tête                                 │
│ ▸ ☐  3  Exporter les colonnes calculées            écartée   ↺             │
│ ▸ ☑  4  Tests unitaires de l'export                                       │
│ ▸ ☑  5  Mettre à jour le README                    plus tard ↺             │
│   …                                                                        │
├────────────────────────────────────────────────────────────────────────────┤
│ 6 gardées · 1 écartée · 1 plus tard                                        │ 24 px
│ [ Refuser le plan ]                    [ Revoir avec l'agent ]  [ Approuver ] │ 44 px
└────────────────────────────────────────────────────────────────────────────┘
```

*(les boutons par ligne `⚑` / `↺` sont omis de la maquette pour la lisibilité ;
ils occupent les 2 dernières colonnes, cf. § 2.4)*

### 2.4 Anatomie d'une ligne de tâche (vue revue)

Hauteur **32 px** (aujourd'hui 6+8+8 = ~28 px, `style.css:7052-7060`). Colonnes,
dans l'ordre, avec leur largeur **fixe** sauf le titre :

| # | Élément | Largeur | Contenu / état |
|---|---|---|---|
| 1 | `▸` déplier | 16 px | chevron ; ouvre le détail (§ 2.6). `aria-expanded` |
| 2 | **case à cocher** | 16 px | `input[type=checkbox]`, `accent-color: var(--accent)` (motif existant `style.css:3212-3216`) ; cochée = tâche engagée |
| 3 | numéro | 24 px | `#n`, `--font-xs`, `--text-secondary`, aligné à droite |
| 4 | **titre** (cliquable) | flexible ≥ 180 px | `--font-sm` `--text-primary`, une ligne, ellipsis, `title` = texte complet. **Clic = édition en place** ; `Entrée` sur la ligne focalisée aussi |
| 5 | marqueurs | auto | `⚑n` si contraintes, `plus tard` / `écartée` en `--font-xs` `--text-secondary` |
| 6 | `⚑` contrainte | 24 × 24 | ouvre le bloc contraintes (§ 2.7) |
| 7 | `↺` plus tard | 24 × 24 | bascule `todo ↔ deferred` |

Somme des largeurs fixes : 16+16+24+24+24 = 104 px + 6 espaces de 6 px (36) = **140 px**,
laissant **≈ 348 px** au titre dans 488 px utiles (520 − 32 de padding).
À 1000 px de fenêtre, le titre dispose de ≈ 548 px.

**États visuels** (couleurs **et** mot, jamais la couleur seule) :

| État | Case | Statut | Fond de ligne | Texte | Mot affiché |
|---|---|---|---|---|---|
| engagée | cochée | `☐` | transparent | `--text-primary` | — |
| écartée | décochée | `⊘` | `--surface-2` | `--text-primary` | « écartée » |
| plus tard | cochée | `⏸` | `--surface-2` | `--text-primary` | « plus tard » |
| détail ouvert | — | — | `--surface-2` | — | — |
| survol | — | — | `--surface-3` | — | — |
| focus clavier | — | — | — | — | `outline: 2px solid var(--accent); outline-offset: -2px` |

**Interdit mesuré** : ne pas peindre les états en `--text-muted` (3,67:1 sur
`--surface-1` en sombre, 3,33:1 sur `--surface-2` — sous le seuil AA 4,5:1) et ne
pas baisser l'opacité du texte (une opacité 0,55 sur `--text-secondary` ramène
7,28:1 à ≈ 3,3:1). Le sens est porté par le **mot**, l'état par le **fond** et le
**glyphe**. Mesures faites avec la formule de luminance déjà utilisée par
`src/js/contraste-evenements-sombre.test.js`.

**Cibles de clic** : 24 × 24 px pour les boutons (contre ~20 px aujourd'hui,
`.orch-task-btn` `style.css:7095-7100`), 32 px de hauteur de ligne : la ligne
entière est cliquable pour le détail, jamais pour décocher (une décoche
accidentelle changerait le travail demandé).

### 2.5 Édition du titre en place (remplace `prompt()`)

- Un clic sur le titre (ou `Entrée`) le transforme en `input` de **24 px** de haut,
  `--font-sm`, fond `--surface-2`, bordure `1px solid var(--accent)`, radius
  `--radius-xs` (4 px), largeur = la colonne titre.
- `Entrée` ou sortie de champ = valider ; `Échap` = annuler et restaurer.
- La valeur est écrite dans le **modèle** immédiatement (debounce 250 ms + flush
  sur `blur`), puis `save_plan` (un des 17 sites existants).
- Une tâche éditée porte une marque discrète `✎` en `--text-secondary` (11 px) et
  `edited_by_user = true` : l'utilisateur voit ce qu'il a changé.
- **Ce qui n'est pas éditable** : `id`, `depends_on`, `files` (ils viennent du
  plan et servent la sélection, `orchestration.js:1142`) et le nombre de tâches.
  Les fichiers ne sont pas retouchés à la main : on **ajoute une contrainte** (§ 2.7),
  ce qui est réversible et ne casse pas `captureFileState`.

### 2.6 Détail d'une tâche (déplié)

Sous la ligne, `padding-left: 62px` (aligné sur le titre), `--font-xs`
`--text-secondary`, 3 lignes max :
`description` (2 lignes + ellipsis), `fichiers : a.js, b.js` (ou « aucun fichier
déclaré »), `dépend de : #2, #3`, `contraintes : 2`.

### 2.7 Bloc « Contraintes de cette tâche »

Se déplie **sous la ligne** (pas de modale : on garde le plan visible). Trois
champs, dans cet ordre :

| Champ | Type | Comportement |
|---|---|---|
| **Ne pas toucher à ces fichiers** | zone de saisie, un chemin par ligne, 3 lignes | chemins relatifs au projet, normalisés ; un chemin absolu hors projet est refusé avec un message (11 px, `--danger` pour la bordure seulement, texte en `--text-primary`) |
| **Remarque pour l'agent** | une ligne, 200 car. max, compteur 11 px à droite | texte libre, joint au prompt de la tâche |
| **Limite** | emplacement **réservé, vide, non affiché** | aucun libellé « budget », « coût » ou « jetons » tant qu'aucune valeur n'existe (§ 2.9) |

Pied du bloc : `[ Annuler ]` (secondaire) · `[ Enregistrer la contrainte ]`
(primaire `--accent-solid` / `--accent-fg`, `style.css:349-351` sombre,
`:442-444` clair).

### 2.8 Le pied d'actions (remplace la barre de saisie)

| Élément | Mesure | Rôle |
|---|---|---|
| Compteur | 24 px, `--font-xs` `--text-secondary` | « 6 gardées · 1 écartée · 1 plus tard » — jamais un total faux |
| `Refuser le plan` | 32 px, texte `--text-secondary`, fond `--surface-2` | abandonne l'attente, **n'écrit rien**, laisse un message système « Plan refusé (aucune tâche exécutée) » et la conversation intacte. Pas de confirmation : rien n'est détruit, le plan peut être redemandé |
| `Revoir avec l'agent` | 32 px, bordure `1px solid var(--border)`, texte `--text-primary` | déplie un champ multiligne « Ce qu'il faut changer » + `[ Envoyer ]`. Envoie via `buildPlanPrompt` avec le **plan courant** (`orchestration.js:291`), donc l'agent voit les retouches |
| `Approuver et démarrer` | 32 px, `--accent-solid` + `--accent-fg` | seul chemin vers `orchestrationRunning = true`. **Désactivé** (opacité .5 + `aria-disabled`) si 0 tâche gardée |

Ordre visuel : refuser à gauche, approuver à droite (convention déjà posée dans
`docs/proposition-presentation-ui.md` § 3.7).

### 2.9 Cas « toutes les tâches retirées » (0 gardée)

L'état vide est **un écran**, pas un bouton grisé muet :

```
        ⊘  Aucune tâche gardée
           8 tâches ont été écartées ou mises à plus tard.
           Rien ne sera exécuté si vous approuvez maintenant.
           [ Tout réactiver ]   [ Revoir avec l'agent ]  ← action principale
```

- `Approuver et démarrer` : désactivé **et** expliqué par le texte ci-dessus
  (jamais par un simple `title`).
- Pourquoi c'est nécessaire : approuver un plan vide appellerait
  `executeNextTask` → `nextTask === null` → `remaining.length === 0` →
  « ✅ Plan terminé » + bilan `0/0` (`agent-pi.js:3655-3658`), c'est-à-dire un
  message **faux** (« terminé » alors que rien n'a été fait).
- `Tout réactiver` remet `state = "todo"` sur toutes les tâches ; il est
  **gratuit** (aucune écriture disque, une seule sauvegarde).

### 2.10 Emplacement réservé du coût (exclu, muet)

Le modèle réserve `task.limits` (objet vide) et le pied de ligne réserve une
colonne de 0 px extensible à `min-width: 88px` à droite. **Rien n'est affiché**
tant qu'aucune valeur réelle n'existe : ni « — », ni « coût inconnu », ni 0.
Si une mesure existe un jour, le libellé serait `≈ 12 000 jetons` en `--font-xs`
`--text-secondary` à cet endroit. C'est un emplacement, pas un affichage.

### 2.11 Fenêtre étroite et thèmes

| Sujet | Règle |
|---|---|
| 800 px de large | les 140 px de colonnes fixes + 348 px de titre tiennent dans 488 px utiles : **aucun repli n'est nécessaire**. Sous 520 px de conversation (fenêtre impossible : le minimum est 800), le marqueur texte « plus tard »/« écartée » passe en glyphe seul (le mot reste dans `title` et en `aria-label`) |
| 500 px de haut | la vue revue prend `flex: 1` : la liste défile (`.orchestration-tasks` a déjà `overflow-y: auto`), le pied reste collé en bas, le compteur reste visible |
| 2 palettes / 10 sous-thèmes | **aucune couleur en dur** ; uniquement `--surface-1/2/3`, `--text-primary/secondary`, `--accent`, `--accent-solid/fg`, `--border*`, `--radius*`, `--font-*`. Les sous-thèmes de `src/js/theme.js` (dark : default, one-dark, dracula, nord, tokyo-night ; light : default, github, one-light, solarized, tokyo-day) suivent donc automatiquement |
| Contrastes mesurés (palettes par défaut) | `--text-primary/--surface-1` 14,50 (sombre) / 16,87 (clair) ; `--text-secondary/--surface-1` 7,28 / 6,22 ; `--accent-fg/--accent-solid` 6,31 / 5,97 → **tous ≥ 7:1** pour le texte de la revue |
| Interdits mesurés en thème clair | `--warning` sur `--surface-1` = **2,04:1** (même sous 3:1 pour un composant) ; `--success` = 3,16 ; `--danger` = 3,91 ; `--accent` sur blanc = 4,28 → jamais du texte, jamais une information portée par eux seuls |

### 2.12 Clavier et accessibilité

| Geste | Effet |
|---|---|
| `Tab` | `▸` → case → titre → `⚑` → `↺` (ordre du DOM = ordre visuel) |
| `Espace` sur la case | coche / décoche |
| `Entrée` sur le titre | édition en place ; `Entrée` valide, `Échap` annule |
| `Alt+↑` / `Alt+↓` | ligne précédente / suivante, **sans réordonner** (le réordonnancement est hors périmètre, § 2.13) |
| `Ctrl+Entrée` | approuver (uniquement si ≥ 1 tâche gardée) |
| `Échap` (hors édition) | ferme le détail ouvert ; ne refuse jamais le plan (un refus par accident serait grave) |
| Annonces | `role="checkbox"` natif via `input`, `aria-expanded` sur `▸`, `aria-describedby` du compteur sur le bouton d'approbation, statut d'état dans le texte (pas d'`aria-label` porteur du seul sens) |

### 2.13 Ce que l'écran ne fait pas (assumé)

- **Pas de réordonnancement** des tâches : l'ordre et `depends_on` font foi
  (`orchestration.js:1142`) ; réordonner exigerait de recalculer les dépendances
  et de renuméroter, donc un second chantier. Si le besoin apparaît, il passera
  par « Revoir avec l'agent » (l'agent repropose un plan ordonné).
- **Pas d'ajout de tâche** à la main : le texte d'une tâche vient du plan ;
  inventer une tâche sans description ni fichiers ferait échouer
  `checkTaskFilesChanged` (`orchestration.js:1046`, « pas de fichiers listés »).
- **Pas de coût / budget** (§ 2.10).
- **Pas de « approuver en aveugle pour la suite »** (case « ne plus me demander ») :
  ce serait réintroduire la perte de contrôle que H4 corrige.
- **Pas de mode web** : `web/js/*.js` ne connaît pas l'orchestration
  (`grep "orchestration"` → 0 résultat) ; l'activité web est l'idée D2, qui dépend
  de H4 (`idees_evolutions.md:630`) et viendra après.

---

## 3. Règles de comportement

### 3.1 Les trois états d'une tâche (vocabulaire unique)

| État stocké | Sens | Exécutée ? | Entre dans `doneIds` ? | Comptée au bilan ? |
|---|---|---|---|---|
| `todo` (défaut) | engagée | oui, dans l'ordre des dépendances | quand terminée | oui |
| `dropped` | écartée par l'utilisateur | **jamais** | **oui** (sinon le plan ne se clôt jamais) | **non** (ni réussite ni échec) |
| `deferred` | à plus tard | pas dans cette passe | **oui** (pour clore la passe) | **non** ; la tâche réapparaît à la reprise |

Le champ `progress` reste **inchangé** (`completed`, `failed`, `escalated`,
`retrying`) : deux ensembles s'ajoutent, `progress.dropped` et
`progress.deferred`. Aucun ensemble existant n'est renommé — c'est ce qui évite
de toucher les **38** occurrences de `escalated` hors tests (`agent-pi.js` 21,
`orchestration.js` 17).

### 3.2 Une tâche décochée (`dropped`)

1. **Effet immédiat** : la case décochée écrit `state = "dropped"` dans le modèle,
   un `save_plan`, un rendu. Rien d'autre.
2. **Effet à l'exécution** : `executeNextTask` calcule ses tâches exécutables par
   une fonction pure nouvelle, `executableTasks(plan)` = `plan.filter(t => t.state !== "dropped" && t.state !== "deferred")`.
   Les **deux** sites d'appel (`agent-pi.js:3615` et `:3620`) reçoivent ce résultat :
   `pickNextTask`/`isPlanBlocked` (`orchestration.js:1142`, `:1161`) ne changent pas.
3. **Clôture** : `doneIds` (`agent-pi.js:3614`) ajoute `dropped ∪ deferred`. Sans
   cela, `remaining` reste non vide (`:3619`) et le plan ne se termine jamais —
   ou pire, déclenche une vérification finale inutile (`:3672`).
4. **Bilan** : `summarizePlan` (`orchestration.js:1284`) reçoit un total **engagé**
   (`total − dropped − deferred`) et une ligne « ⊘ n écartée(s) ». Sinon le taux de
   réussite serait faux.
5. **Dépendances** : si #5 dépend de #3 et que #3 est écartée, **rien n'est
   décoché automatiquement**. La ligne #5 affiche « dépend de #3 (écartée) » en
   `--text-secondary`, et **l'approbation est refusée** tant que le cas n'est pas
   tranché, avec trois issues en un clic : écarter #5 aussi · garder #5 en
   sachant que #3 ne sera pas faite · remettre #3.
   *Règle* : **aucune écriture silencieuse dans le plan de l'utilisateur.**
6. **Réversibilité** : recocher remet `todo` et efface la marque. Aucune donnée
   n'est détruite : la tâche reste dans `plan.plan` (donc dans `plan.json`).

### 3.3 Une tâche « à plus tard » (`deferred`)

- Même mécanique que `dropped`, avec un sens différent : elle **reste prévue**.
- Elle n'est pas exécutée dans la passe courante ; le plan peut se clore en le
  disant : « ✅ Passe terminée : 6/6 gardées exécutées, 1 écartée, 1 plus tard ».
- À la reprise (`▶️` ou message suivant), les tâches `deferred` redeviennent
  candidates **automatiquement** (elles ne sont plus filtrées tant qu'on est dans
  une nouvelle passe) — mais uniquement si l'utilisateur a approuvé cette reprise.
  Sinon, une tâche mise « à plus tard » reviendrait sans accord : ce serait la
  négation de H4.
- Le compteur du pied les compte séparément : « 1 plus tard » ≠ « 1 écartée ».

### 3.4 Une contrainte posée : transmission **et** vérification

Trois verrous, aucun quatrième (pas de nouvelle porte, cf. § 1.4) :

| Verrou | Où | Ce qu'il fait |
|---|---|---|
| **1. Transmission** | `buildTaskPrompt` (`orchestration.js:435`), inséré **après** `filesInstruction` (fin `:470`) et **avant** `treeSection` (`:472`) | bloc `=== CONTRAINTES DE L'UTILISATEUR (IMPÉRATIVES) ===` : fichiers interdits, remarque. Placé là, il **échappe aux deux fenêtres de compaction** (`compactTaskPrompt`, `orchestration.js:1257-1275`, qui réduit l'arborescence et les résumés). `buildRetryTaskPrompt` (`:558`) hérite du bloc sans modification |
| **2. Refus à l'écriture** | `applySearchReplaceBlocks` (`orchestration.js:1691-1766`) reçoit la liste des interdits | un bloc visant un fichier interdit produit une erreur `« <chemin> : fichier interdit par une contrainte utilisateur »` ; **aucune écriture** n'a lieu pour ce chemin ; le message remonte au codeur comme un échec de format, donc il peut se corriger |
| **3. Contrôle après coup** | `captureFileState` (`orchestration.js:961`) capture en plus les fichiers interdits (existence + mtime) ; `checkTaskFilesChanged` (`:1046`) compare | si un fichier interdit a changé, la tâche est marquée **`violated`** (nouvel état d'affichage `⛔`), **aucun retry automatique**, un message système le dit : « ⛔ Tâche #n : contrainte violée (a.js modifié) ». La révocation Git (`orch-undo`) reste disponible |

Ce que la contrainte n'est **pas** : une question posée à l'utilisateur (elle
serait auto-approuvée en orchestration, `agent-pi.js:9197`), ni une modification
des `task.files` (elle casserait `captureFileState` et la validation d'écriture).

### 3.5 Preuve d'approbation : humaine ou par défaut

Champ persisté au niveau du plan (`plan.rs` écrit le JSON tel quel, aucune
migration nécessaire) :

```
"approval": {
  "mode": "pending" | "human" | "auto",
  "at": "2026-11-05T12:04:11Z",
  "edited": true,          // au moins une retouche
  "edits": 3,              // nombre de retouches
  "dropped": 1, "deferred": 1, "constraints": 2,
  "via": "pannel"          // où l'accord a été donné
}
```

| Où c'est dit | Comment |
|---|---|
| En-tête du panneau **compact** | marque `✓ approuvé 12:04 · 3 retouches` en `--font-xs` `--text-secondary`. Si `mode = "auto"` : `✓ approuvé par défaut (reprise automatique)` — un aveu explicite, jamais une ambiguïté |
| En-tête de la vue **revue** | `⟳ Plan proposé · 8 tâches · non approuvé` |
| Conversation | message système `📝 Plan approuvé par l'utilisateur — 6 tâches, 1 écartée, 1 plus tard, 2 contraintes.` (via `appendSystemMessage`, mécanisme existant) |
| Fichier | `plan.json` (§ ci-dessus), donc lisible par un futur écran web (D2) |
| Journal des arrêts | **n'y touche pas.** `.pilot/agent-stops.log` est le journal des **fins de session non demandées** (`spec_cinq_regles_chaine_agents.md`, règle 3) ; y écrire une approbation mélangerait deux natures. Aucun second journal n'est créé |

**Cas « approuvé par défaut », à assumer explicitement** : les passes suivantes
d'un plan déjà approuvé (reprise après pause, subdivision, révision périodique,
vérification finale) ne redemandent **pas** l'accord — sinon la boucle autonome
s'arrête à chaque tâche. Elles portent `mode = "auto"` et le disent. Un
**nouveau** plan initial, lui, est toujours `pending`.

### 3.6 Invariants (ce qui est interdit, et pourquoi)

1. **Aucun envoi de prompt pendant la revue**, sauf le bouton « Revoir avec
   l'agent » : sinon un message de l'utilisateur remplacerait le plan en attente.
2. **Aucune écriture disque avant approbation** : la revue ne touche qu'à
   `.pilot/plan.json` (via `save_plan`), jamais aux fichiers du projet.
3. **Aucune estimation préalable, aucun agent auxiliaire** au moment d'approuver :
   la règle 1 (`spec_cinq_regles_chaine_agents.md`) protège exactement ce cas ;
   approuver lance **le même** agent, dans **la même** session.
4. **Aucun nouvel arrêt automatique** : la revue n'arrête rien ; elle n'ajoute
   aucune ligne à `agent-stops.log` (règle 3) et ne crée pas d'entonnoir parallèle.
5. **Aucune re-validation du plan après édition** : `validatePlan`
   (`orchestration.js:1459`) sert à juger la production de l'agent. Un titre
   raccourci ou une description resserrée par l'utilisateur ne doit pas être
   rejeté par « découpage manifestement insuffisant » (§ 1.1). Les avertissements
   de qualité restent affichés **pour information** au-dessus de la liste.
6. **Le plan approuvé est gelé** : `approval.mode` repasse à `pending` si une
   révision automatique remplace des tâches **engagées** (§ 4.1) — l'utilisateur
   doit revoir ce qui a changé, et le panneau le dit.

---

## 4. Pièges réels (constatés, pas hypothétiques)

### 4.1 Plan déjà en exécution édité

**Constat** : `applySubdivision` (`agent-pi.js:3577`) et `mergeRevisedPlan`
(`:4655`, `:4753`) **remplacent** des tâches pendant l'exécution ; `normalizePlan`
(`orchestration.js:55-87`) reconstruit chaque tâche à partir de 7 champs, donc
toute retouche non prévue serait **effacée**.

**Conséquences si rien n'est fait** : la contrainte disparaît, la tâche écartée
revient, l'utilisateur croit avoir décidé.

**Parade** :
- l'édition n'est possible que si `orchestrationRunning === false` (sinon les
  contrôles sont absents et une mention « ⏸ Mettez en pause pour retoucher le
  plan » est affichée) ;
- `mergeRevisedPlan` conserve, **par id**, `state`, `constraints`, `edited_by_user`
  des tâches restantes ; une tâche engagée remplacée par une révision repasse le
  plan en `pending` (message : « l'agent a révisé 3 tâches : le plan attend à
  nouveau votre accord ») ;
- une tâche `dropped` n'est **jamais** ressuscitée par une révision : elle reste
  hors exécution, la révision s'applique aux autres.

### 4.2 Plan reçu en plusieurs morceaux pendant l'affichage

**Constat** : le texte de l'orchestrateur s'affiche **en flux** dans la bulle
(`agent-pi.js:7165`, `:7177`), JSON compris ; le plan n'existe qu'après
`extractBalancedJson` (`orchestration.js:101-150`). Un JSON incomplet déclenche un
retry (`agent-pi.js:6895+`) ; un re-plan peut arriver **pendant** la revue
(`:6842-6865`).

**Parade** :
- la vue revue ne s'ouvre **jamais** sur du texte partiel : uniquement après
  `parsePlanResponse` + `normalizePlan` + `validatePlan` (les 3 étapes déjà
  franchies avant `:6861`) ;
- si un second plan arrive alors qu'une revue est en cours, **aucun écrasement** :
  bandeau « Un nouveau plan est arrivé (N tâches). Il remplace le plan en cours de
  relecture. [ Voir le nouveau ] [ Garder mes retouches ] » ; « Garder » conserve
  le plan édité et jette le nouveau (jamais l'inverse sans le dire) ;
- si l'orchestrateur répond en texte (pas de plan), la revue **ne s'ouvre pas** :
  message système « Aucun plan à approuver : l'agent a répondu en texte. »
  (chemin existant `agent-pi.js:6880-6883`).

### 4.3 Perte d'édition au re-render (changement de fenêtre, rafraîchissement)

**Constat** : `renderOrchestrationPlan` reconstruit `#orch-tasks.innerHTML` **en
entier** (`agent-pi.js:3196-3219`) et il est appelé depuis **24 sites** ; un
passage d'onglet, une pause, un événement d'outil ou un simple rafraîchissement
d'état peut re-rendre pendant une frappe.

**Parade** :
- **la vérité est dans le modèle**, jamais dans le DOM : chaque frappe écrit
  `plan.plan[i].title` (debounce 250 ms + `blur`), le rendu réaffiche le modèle ;
- un drapeau `isEditingTask` suspend le re-rendu tant qu'un champ a le focus
  (le rendu est rejoué à la sortie du champ, une seule fois) ;
- aucune perte au changement de fenêtre : la sauvegarde est faite sur `blur`, et
  `save_plan` (`plan.rs:16`) est déjà appelé 17 fois dans le cycle — un 18ᵉ site
  pour l'édition est cohérent ;
- régression possible à éviter : le rendu garde la position de défilement de la
  tâche active (`agent-pi.js:3264-3272`), à conserver pour la ligne en cours
  d'édition.

### 4.4 Panneau partagé entre plusieurs onglets (id global)

**Constat** : chaque onglet crée son panneau avec **le même `id`**
(`agent-pi.js:516`), et les deux fonctions qui l'utilisent le cherchent par
`document.getElementById("orchestration-panel")` (`:3184`) ou
`document.querySelector("#orchestration-panel .orchestration-title")` (`:3169`).
`getElementById` renvoie **le premier du document** : avec deux onglets agents sur
deux projets, le rendu du 2ᵉ écrit dans le panneau du 1ᵉʳ. C'est exactement le
défaut déjà documenté et corrigé pour les sélecteurs de modèle
(`src/js/agent-model-selector.js:1-14`, cause C4).

**Parade** : résoudre le panneau **depuis la portée de l'onglet**
(`wrapper.querySelector(...)`) et non par id global ; ou dériver un id unique du
couple (projet, agent) comme `agentSelectorIds` (`agent-model-selector.js`).
**À faire avant d'ouvrir l'édition** (lot 3), sinon une retouche peut atterrir
dans le mauvais projet.

### 4.5 Plan non découpable en tâches

Trois cas réels, déjà présents dans le code :

| Cas | Preuve | Traitement proposé |
|---|---|---|
| Réponse en texte (question simple) | `agent-pi.js:6880-6883` | pas de revue ; message système, conversation normale |
| JSON invalide (2 tentatives) | `agent-pi.js:6895-6910` | pas de revue ; message d'échec existant |
| Plan d'**une seule** tâche pour une demande > 100 car. | `orchestration.js:1478-1481` (`reject`) + re-plan `agent-pi.js:6842` | pas de revue : c'est un rejet de qualité, pas une décision humaine. Ne pas confondre avec un plan réduit à 1 tâche **par l'utilisateur** (autorisé, § 2.9) |

Règle : **la revue ne remplace jamais le diagnostic existant** ; elle n'apparaît
que sur un plan jugé acceptable (`severity` ≠ `reject`).

### 4.6 Plan en attente perdu au redémarrage ou à la fermeture de l'onglet

**Constat** : `load_plan` n'est appelé qu'à l'**activation** du mode orchestration
(`agent-pi.js:2864`, dans la bascule `:2860-2882`). `plan.json` est unique **par
projet** (`plan.rs:31`, `:50`). Donc : approbation différée + fermeture d'onglet
ou redémarrage = plan en attente **introuvable**, panneau vide, utilisateur sans
explication.

**Parade (lot 7)** : au montage de l'onglet, si `plan.json` contient
`approval.mode === "pending"`, restaurer le plan **et** rouvrir la revue ; sinon,
ne rien faire (comportement actuel conservé pour les plans approuvés/en cours).
Un second onglet orchestration sur le **même** projet lit le même fichier : la
revue y est donc partagée — d'où l'obligation de régler § 4.4 avant.

---

## 5. Découpe en lots livrables seuls

Chaque lot laisse l'application **cohérente** : soit il ne change rien à l'écran
(L1), soit il livre un comportement complet (jamais une case qui ne fait rien,
jamais un bouton qui ne sauvegarde pas). La colonne « arithmétique » est la
vérification à refaire après le lot, sur le disque.

| Lot | Contenu | Fichiers | Arithmétique (avant → après) | Preuve de non-régression |
|---|---|---|---|---|
| **L1 — Socle de données (invisible)** | `normalizePlan` transporte `state`, `constraints`, `edited_by_user` ; `plan.approval` initialisé à `pending` ; fonctions pures `executableTasks(plan)`, `planCounts(plan)` ; total engagé dans `summarizePlan` | `orchestration.js` | clés par tâche **7 → 10** ; sites de rendu **24 → 24** ; `save_plan` **17 → 17** | `orchestration.test.js` : aucune assertion `toEqual` sur une tâche complète (vérifié : seuls `toMatchObject` et `toEqual([])`) → ajouter des clés ne rougit pas |
| **L2 — Vue revue + porte d'approbation** | état `pending` : le plan **ne démarre plus** ; vue revue en **lecture seule** ; pied `Approuver` / `Refuser` ; `orchestrationRunning = true` uniquement sur clic | `agent-pi.js`, `style.css` | `state.orchestrationPlan =` **13 → 13** ; `save_plan` **17 → 18** (1 écriture à l'approbation) ; démarrages automatiques **1 → 0** (`:6866` devient conditionnel) | test nouveau : « un plan reçu n'appelle plus `executeNextTask` sans approbation » (assertion de source, style `screen-guard-wiring.test.js`) |
| **L3 — Panneau propre à l'onglet** | remplace `document.getElementById("orchestration-panel")` par une résolution locale (`wrapper.querySelector`) ; id unique dérivé du couple (projet, agent) | `agent-pi.js` | sites `getElementById("orchestration-panel")` **1 → 0** ; sites `querySelector("#orchestration-panel …")` **1 → 0** ; ids en dur **1 → 0** | test nouveau : 2 onglets, 2 panneaux, la revue du 2ᵉ ne touche pas le 1ᵉʳ (même approche que `agent-model-selector` / C4) |
| **L4 — Édition du titre + écartement effectif** | titre éditable en place (remplace `prompt()`) ; case = `dropped` ; `executableTasks` branché aux **2** sites ; `doneIds` + `dropped` ; total engagé dans la barre | `agent-pi.js`, `style.css` | contrôles par tâche **2 → 4** (case, titre, `⚑`, `↺` + `▸` = 5 cibles) ; sites `pickNextTask/isPlanBlocked` **2 → 2** (arguments changés) ; `prompt()` pour l'édition **1 → 0** | test pur : `executableTasks` exclut `dropped` ; test pur : `pickNextTask` ne choisit jamais une tâche écartée ; test : une tâche écartée n'est plus comptée comme échec |
| **L5 — « Plus tard » + clôture honnête** | `deferred` ; compteur du pied ; fin de passe qui **dit** les 3 catégories ; réintégration seulement sur accord | `agent-pi.js`, `orchestration.js` | ensembles de `progress` **4 → 6** (`completed, failed, escalated, retrying` + `dropped, deferred`) ; occurrences de `escalated` hors tests **38 → 38** (aucun renommage) | test pur : un plan 100 % `deferred`/`dropped` se clôt avec un bilan « 0 réussie, 0 échouée, n écartée, n plus tard » ; test : `planFinished` (`:1552-1556`) reste faux tant qu'une tâche engagée reste |
| **L6 — Contraintes de tâche** | bloc contraintes (3 champs) ; transmission dans `buildTaskPrompt` **après** `filesInstruction` ; refus dans `applySearchReplaceBlocks` ; contrôle mtime des interdits ; état `violated` | `orchestration.js`, `agent-pi.js`, `style.css` | sections du prompt de tâche **7 → 8** ; sites d'écriture disque **1 → 1** (même site, garde ajoutée) ; fenêtres de compaction **2 → 2** (contraintes hors fenêtres) | test pur : `buildTaskPrompt` contient le bloc et **survit** à `compactTaskPrompt` ; test pur : `applySearchReplaceBlocks` refuse un chemin interdit et n'écrit rien ; test : fichier interdit modifié ⇒ `violated`, pas de retry |
| **L7 — Preuve d'approbation + reprise** | champ `approval` rempli (humain/auto), marque dans l'en-tête, message système ; restauration d'un plan `pending` au montage ; conservation des retouches dans `mergeRevisedPlan` | `agent-pi.js`, `orchestration.js` | `approval` écrit à **1** endroit (l'approbation) ; `load_plan` **1 → 2** sites (montage + activation) ; `mergeRevisedPlan` **1 → 1** (fusion enrichie) | test pur : `mergeRevisedPlan` conserve `state`/`constraints` par id ; test : une révision qui remplace une tâche engagée remet `pending` ; test : rechargement d'un plan `pending` rouvre la revue |
| **L8 — Accessibilité, contrastes, fenêtre étroite** | parcours clavier complet, `aria-*`, `focus-visible` ; mesures de contraste sur les 10 sous-thèmes ; repli à 800 × 500 | `style.css`, `agent-pi.js`, test | sélecteurs de la revue mesurés **0 → 6** ; couleurs en dur **0** (règle déjà posée) | étendre `contraste-evenements-sombre.test.js` : chaque texte de la revue ≥ 4,5:1 dans les palettes par défaut ; test : la revue tient sans débordement à 800 × 500 |

**Ordre imposé** : L1 → L2 → L3 → L4 → L5 → L6 → L7 → L8. Justifications :

- **L2 avant L4** : ouvrir l'édition sans porte d'approbation reviendrait à éditer
  un plan qui démarre déjà — l'écran mentirait.
- **L3 avant L4** : éditer par un id global peut écrire dans le mauvais projet
  (§ 4.4).
- **L5 après L4** : « plus tard » a besoin du filtre `executableTasks` de L4 ;
  sinon la tâche reportée serait quand même exécutée.
- **L7 après L6** : la preuve d'approbation doit compter les contraintes et les
  retouches, qui n'existent qu'à partir de L4/L6.

**Ce qui reste vrai après chaque lot** (à revérifier) : les 24 sites de rendu
fonctionnent ; les 4 boutons d'en-tête (`pause`, `resume`, `reset`, `undo`)
existent toujours ; `⏭️` et `✏️` de l'état compact sont conservés ; `plan.json`
reste lisible sans migration ; aucun test existant ne casse (183 fichiers, 3204
tests au départ).

---

## 6. Trois questions fermées

### Q1 — Où vit la vue de révision ?

- **(a)** Dans l'onglet, **à la place** de la conversation (saisie remplacée par
  le pied d'actions), avec un lien « voir la conversation ».
- **(b)** Panneau agrandi au-dessus de la conversation qui reste visible (plafond
  55 % de la hauteur).
- **(c)** Modale plein écran (animation de zoom existante).

**Recommandé : (a).** À 800 × 500 il ne reste que ~11 px de conversation avec le
panneau actuel (§ 2.1) ; (b) réduirait la liste à 3-4 lignes visibles sur 25 ;
(c) ferait perdre le contexte de la conversation et empêcherait de lire le plan en
regardant l'échange. **(a) n'ajoute aucun pixel et ne rouvre aucune décision
d'écran.**

### Q2 — Que fait exactement la case décochée ?

- **(a)** Un seul geste : décochée = **écartée** (retirée de l'exécution, gardée
  dans le plan, réversible) ; « plus tard » est le **second** geste (`↺`).
- **(b)** Décochée = **plus tard** ; écarter définitivement demande un menu.
- **(c)** Pas de case : seulement deux boutons `↺` et `⊘` par ligne.

**Recommandé : (a).** La case est le geste universel (elle dit « je garde / je ne
garde pas ») ; (b) transforme une hésitation en report silencieux et empêche de
distinguer « je n'en veux pas » de « pas maintenant » ; (c) perd la lecture en un
coup d'œil (8 cases cochées se lisent d'un regard, 16 boutons non).

### Q3 — Quand l'approbation humaine est-elle obligatoire ?

- **(a)** À **chaque nouveau plan initial** ; jamais pour les passes internes d'un
  plan déjà approuvé (reprise, subdivision, révision périodique, vérification
  finale), qui portent `mode = "auto"` et l'affichent.
- **(b)** À chaque plan, y compris les révisions internes.
- **(c)** Uniquement si le plan touche des fichiers protégés.

**Recommandé : (a).** (b) casserait la boucle autonome (une subdivision survient
en cours d'exécution, `agent-pi.js:3577` — l'utilisateur serait rappelé au milieu
d'un travail, sans contexte) ; (c) suppose une liste de fichiers protégés qui
n'existe pas et laisse passer 99 % des plans sans contrôle.

---

## 7. VERDICT

**Faisable, utile, et plus petit qu'il n'y paraît.**

- L'essentiel du besoin (« décider avant que le travail démarre ») est livré par
  **L1 + L2** : un état d'attente, une liste lisible, deux issues. C'est le gain
  de contrôle maximal pour le coût minimal, et cela ne touche que deux fichiers.
- L'édition (titre, écartement, « plus tard », contraintes) est **contenue** :
  `pickNextTask`/`isPlanBlocked` n'ont que **2** sites d'appel
  (`agent-pi.js:3617`, `:3622`), l'écriture disque n'a qu'**1** site
  (`orchestration.js:1691`), le prompt de tâche qu'**1** point d'insertion utile
  (`orchestration.js:470-472`). Aucun renommage des **38** occurrences de
  `escalated`.
- **Deux conditions non négociables** avant d'ouvrir l'édition : (1) l'accord
  humain vit à `orchestrationRunning === false` — jamais dans une porte, qui
  serait auto-approuvée (`:8877`, `:8908`, `:9197`) ; (2) le panneau doit être
  résolu dans la portée de l'onglet (§ 4.4), sinon une retouche peut atterrir dans
  un autre projet.
- **Ce qui n'est pas traité et qui ne doit pas être promis** : le coût par tâche
  (exclu, emplacement muet), le réordonnancement, l'ajout manuel de tâche, le mode
  web (`web/js/*.js` ignore l'orchestration), et la preuve « terrain » (aucun de
  ces écrans n'a encore été vu en exécution réelle — les mesures de contraste sont
  calculées sur les palettes, pas relevées à l'écran).

---

## 8. Ce que je n'ai pas vérifié (honnêteté de la conception)

1. **Le rendu réel** : toutes les mesures viennent du CSS et du DOM construits par
   `agent-pi.js` ; aucune capture d'écran n'a été prise.
2. **Les 10 sous-thèmes** : les contrastes sont calculés sur les palettes par
   défaut (sombre `style.css:309+`, clair `:411+`). Les sous-thèmes
   (`style.css:534`, `:565`, `:589`, `:613` en sombre ; `:637`,
   `:661`, `:685`, `:709` en clair) n'ont pas
   été mesurés un par un — le test de contraste existant connaît déjà une
   exception assumée (one-dark, secondaire 4,12:1).
3. **Le comportement du codeur** face à un fichier refusé par contrainte : la
   conception parie sur la boucle de correction existante (`buildRetryTaskPrompt`,
   `orchestration.js:558-600`) ; à confirmer par une exécution réelle.
4. **Le coût en jetons** de la revue : nulle part (aucun appel de modèle dans la
   vue revue, sauf le bouton « Revoir avec l'agent »).
5. **Le mode distant** : non concerné, non audité.
6. **Les tests de L2 à L8** sont décrits par leur intention, pas écrits : cette
   mission ne produit aucun test (contrainte de la demande).

DONE: rapport de conception H4 écrit dans `RAPPORT-plan-editable-H4.md` (aucun code ni test modifié ; tests du dépôt verts au départ : 183 fichiers / 3204 tests).
