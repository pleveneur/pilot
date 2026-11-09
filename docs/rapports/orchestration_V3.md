# Mode Orchestration — Analyse critique & propositions V3

> Document d'analyse (pas une spec implémentée). Objectif : rendre le mode Orchestration plus efficace pour le cas d'usage principal :
> **orchestrateur cloud (planification + méta) + codeur local (exécution)**, avec un découpage le plus fin possible des tâches
> et un codeur qui **réfléchit → fait → contrôle** son propre travail, jusqu'à 3 fois.

Date : 2026-06-29

---

## 0. Résumé exécutif

Le mode Orchestration actuel (V1 + V2) est **fonctionnel et riche** : plan JSON, bascule de modèle, validation post-tâche, timeout d'inactivité, subdivision, escalade intelligente (4 actions), révision mid-plan, vérification finale, linting-in-the-loop, édition chirurgicale SEARCH/REPLACE. C'est beaucoup de mécanismes empilés — et c'est précisément le problème.

**Verdict global** : la mécanique est là, mais elle est **mal orientée pour le besoin exprimé**. Aujourd'hui, c'est le *frontend* qui contrôle la qualité (mtime + lint), et le codeur n'est qu'un exécutant passif qui ne s'auto-vérifie jamais. Le système réagit aux échecs (retry/subdivision/escalade) au lieu de les prévenir par une boucle interne au codeur.

**Les 5 problèmes structurels majeurs** :
1. Le codeur ne fait pas les 3 phases (réfléchir / faire / contrôler) — il ne fait que produire, c'est le frontend qui valide.
2. Seulement **2 tentatives** au codeur avant subdivision/escalade (l'utilisateur en veut 3, avec auto-contrôle).
3. Découpage trop grossier en pratique : le prompt planificateur est bon sur le papier, mais rien ne force réellement le respect des bornes (2 fichiers, 30-60 lignes). La subdivision n'est déclenchée qu'après échec, jamais proactivement.
4. Plusieurs **bugs silencieux** font que des garde-fous censés exister ne fonctionnent pas (compression de prompt, révision inconditionnelle, mtime à la seconde près).
5. La « vérification finale » par l'orchestrateur est **aveugle** : elle ne voit que l'arborescence, pas le contenu des fichiers — donc elle ne peut pas réellement vérifier quoi que ce soit.

Ce document détaille ces points et propose une **V3** centrée sur le triptyque **réfléchir → faire → contrôler** du codeur, avec 3 tentatives, un découpage proactif, et une vraie vérification de fin.

---

## 1. Cartographie de l'existant (état des lieux)

### 1.1 Le flux actuel en pratique

```
Utilisateur → buildPlanPrompt (orchestrateur cloud, contexte vierge)
            → parsePlanResponse + normalizePlan + validatePlan (warnings only)
            → executeNextTask :
                ├─ clearContextForOrchestration (new_agent_session)  [sauf batch]
                ├─ switchToCoder
                ├─ buildTaskPrompt (tâche + fichiers listés + résumés + arborescence)
                ├─ send_agent_prompt
                ├─ resetOrchestrationIdleTimer (reset à chaque text_delta / tool_call)
                └─ handleOrchestrationAgentEnd :
                     ├─ parseSearchReplaceBlocks → applySearchReplaceBlocks (écriture disque)
                     ├─ runLintCheck (eslint / py_compile / cargo check)
                     ├─ checkTaskFilesChanged (mtime des fichiers listés / mentionnés)
                     └─ DONE + ok → completed ; sinon handleTaskFailure (≤2 tentatives)
            → subdivision (1 niveau) si 2 échecs et tâche non-sous-tâche
            → escalade V2 (4 actions : REDECOUPER / EXECUTER / REVISER / COMMANDE)
            → révision mid-plan toutes les N tâches
            → vérification finale (≤3 cycles)
```

### 1.2 Ce qui marche bien

| Point | Pourquoi c'est bien |
|---|---|
| **Session unique + bascule `set_model`** | Architecture simple, pas de double processus, pas de modification de `rpc_manager.rs`. |
| **Contexte vierge par tour (`new_session`)** | Économie de tokens, pas de contamination. Décision saine pour le couple cloud/local. |
| **Validation `confirmActiveModel` (point R)** | Détecte un `set_model` silencieusement annulé par `new_session`. Vraiment utile. |
| **Édition chirurgicale SEARCH/REPLACE + CREATE (V2)** | Empêche le codeur de recracher un fichier entier. Bonne discipline. |
| **Linting-in-the-loop** | Boucle locale de correction syntaxique sans escalade. Idée excellente. |
| **Timeout d'inactivité (reset par delta)** | Ne tue pas un codeur lent mais actif. Bien pensé. |
| **Détection d'erreur de connexion (point Q)** | Met en pause au lieu de marquer « fait » à tort. Indispensable. |
| **`global_directive` (boussole)** | Ancre le codeur dans l'objectif global. Petit détail, gros effet. |

### 1.3 Ce qui est surdimensionné / redondant

- **Deux chemins de subdivision** : subdivision proactive (point M, après 2 échecs) **ET** action `REDECOUPER` en escalade V2. Logique dupliquée, deux prompts différents pour faire la même chose. Source d'incohérences (numérotation d'IDs, rebranchement des `depends_on`).
- **Révision mid-plan + vérification finale + escalade `REVISER`** : trois mécanismes qui demandent à l'orchestrateur de revoir le plan. Chevauchement conceptuel important.
- **Granularité adaptive `getAdaptiveGranularity`** : existe, est appelée, mais n'a d'effet que sur le *texte* du prompt (l'objectif de taille affiché). Elle ne force jamais un re-découpage. Potentiellement trompeur.

---

## 2. Critiques détaillées par fonctionnalité

### 2.1 Le codeur ne « réfléchit » ni ne « contrôle » — il produit seulement

**C'est le problème central.** Le `buildTaskPrompt` dit :

> Tu es un développeur qui exécute une micro-tâche précise. [...] Lis les fichiers [...] Produis du code [...] Termine par DONE: <résumé>.

Il n'y a **aucune instruction de réflexion explicite** (analyse de la tâche, plan d'attaque) ni **aucune instruction de vérification** (relire ce qu'on a écrit, vérifier la cohérence, vérifier les cas d'erreur). Tout le contrôle est externalisé :

- La *vraie* vérification se fait dans `handleOrchestrationAgentEnd` : parsing SEARCH/REPLACE, application sur disque, lint, check mtime.
- Si le lint rate → `buildLintFailurePrompt` renvoie « NEED_HELP: Correction syntaxique requise » au codeur. C'est une boucle de *correction*, pas de *vérification*.
- Le codeur n'est jamais invité à relire son propre output ni à valider qu'il a atteint l'objectif.

**Conséquence** : un modèle local « faible » (Qwen 7B, etc.) produit souvent du code approximatif, répond `DONE:` avec un résumé optimiste, et le système le valide parce que les fichiers ont effectivement été modifiés — même si le code est faux, incomplet ou casse une autre partie. Le lint ne capte que la syntaxe, pas la sémantique.

**Ce qu'il faudrait** : un prompt codeur structuré en 3 phases explicites, avec des marqueurs de phase obligatoires, et une boucle de 3 tentatives où le codeur **relit et corrige lui-même** avant de déclarer DONE.

### 2.2 Seulement 2 tentatives — l'utilisateur en veut 3

Dans `handleTaskFailure` :

```js
if (attempts < 2) { /* retry */ }
else { subdivision ou escalade }
```

Soit exactement 2 essais. Avec le besoin exprimé (3 tentatives avec auto-contrôle), c'est insuffisant. Le passage à 3 est trivial mais doit s'accompagner d'un **feedback enrichi** à chaque tentative : le codeur doit recevoir ce qu'il a fait de mal et relire son propre travail, pas juste un « recommence ».

### 2.3 Découpage : la théorie vs la pratique

Le prompt `buildPlanPrompt` est soigné : principe micro-tâche, bornes « 2 fichiers / ~30-60 lignes », fourchette « 5 à 25 tâches », exemples bon/mauvais. **Mais rien ne contraint réellement** l'orchestrateur à respecter ces bornes :

- `validatePlan` ne fait que produire des **warnings** affichés dans le chat. L'exécution continue même si une tâche a 6 fichiers.
- Aucun **re-plan automatique** si le plan est manifestement trop grossier (< 3 tâches pour une demande longue).
- La subdivision n'arrive **qu'après 2 échecs** — donc seulement *réactivement* sur les tâches déjà trop grosses. Les tâches grossières qui réussissent du premier coup restent grossières.
- `getAdaptiveGranularity` ajuste l'« objectif de taille » affiché mais ne force jamais le redécoupage.

**Résultat** : en pratique, l'orchestrateur cloud produit souvent des tâches de 4-6 fichiers et 150+ lignes, parce que c'est naturel pour un modèle puissant, et rien ne l'en empêche concrètement.

### 2.4 Bugs identifiés (vrais, dans le code)

#### Bug 1 — `compactTaskPrompt` ne marche jamais (résumés jamais compressés)

Dans `orchestration.js`, `compactTaskPrompt` :

```js
compacted = compacted.replace(
  /=== RÉSUMÉS DES TÂCHES PRÉCÉDENTES ===[\s\S]*?(?=\n=== TÂCHE À RÉALISER ===|\n=== FORMAT OBLIGATOIRE)/,
  "=== RÉSUMÉS DES TÂCHES PRÉCÉDENTES ===\n(résumés tronqués ...)"
);
```

Or les prompts réels produits par `buildCommonContext` utilisent le libellé **`=== TÂCHES PRÉCÉDENTES TERMINÉES ===`** (et il n'existe aucune section `=== TÂCHE À RÉALISER ===`). La regex ne matche donc **jamais**. Conséquence : la compression des résumés quand le contexte déborde est **inopérante** ; seule la compression de l'arborescence fonctionne (celle-là a la bonne chaîne `=== ARBORESCENCE DU PROJET ===`).

À corriger en utilisant les libellés réels (`=== TÂCHES PRÉCÉDENTES TERMINÉES ===`, bornes `=== FORMAT OBLIGATOIRE` / `=== ARBORESCENCE`).

#### Bug 2 — La révision mid-plan est **inconditionnelle**

Dans `handleOrchestrationAgentEnd` :

```js
// Révision conditionnelle : seulement si le taux d'échec est significatif
const failureRate = ...;
const avgAttempts = ...;
// Révision systématique selon l'intervalle configuré (spec §4.6)
shouldRevise = true;
```

Le calcul de `failureRate` et `avgAttempts` est fait mais **jamais utilisé**. `shouldRevise` est forcé à `true`. La révision se déclenche donc toutes les `orchestration_revision_interval` tâches **quoi qu'il arrive**, même si tout se passe parfaitement. Ce qui :

- gaspille des appels cloud coûteux,
- peut déstabiliser un plan qui se déroulait bien (l'orchestrateur peut « réorganiser » et casser les IDs/logique en cours).

Le commentaire trahit l'intention (« conditionnelle ») mais le code fait l'inverse. À corriger : n'escalader la révision que si `failureRate > seuil` ou `avgAttempts > 1.3`.

#### Bug 3 — Validation post-tâche par `mtime` : peu fiable sous Windows

`checkTaskFilesChanged` compare `before.mtime !== after.mtime`. Or :
- Sous Windows, la résolution de `mtime` d'un fichier est souvent **1 seconde** (parfois 2s en NTFS avec last-access désactivé). Un fichier lu puis réécrit dans la même seconde peut garder le même `mtime` → la tâche est marquée « échec validation » à tort → escalade injustifiée.
- C'est exactement le cas quand le codeur lit un fichier puis le réécrit rapidement (cas typique d'une micro-tâche).

Le code applique déjà un assouplissement (fichiers mentionnés dans la réponse), ce qui masque partiellement le bug, mais pas toujours. **Solution** : baser la validation sur le **contenu (hash)** plutôt que sur `mtime`, ou au minimum comparer `size + mtime` et accepter un delta de ±2s. Mieux : puisque `applySearchReplaceBlocks` a déjà écrit les fichiers, **on sait déjà ce qui a été écrit** — la validation par mtime devient en partie redondante avec le retour de `applySearchReplaceBlocks.changedFiles`.

#### Bug 4 — `isBatchContinuation` contredit le « contexte vierge par tour »

Le mode batch (`orchestration_batch_size`, défaut 5 pour les codeurs locaux) garde la **même session RPC** sur N tâches consécutives. C'est en contradiction directe avec le principe fondamental §4.7 de la spec (« contexte vierge par tour »). Conséquences :

- Le codeur voit l'historique des tâches précédentes (et leurs `DONE:`), ce qui peut le leurrer ou l'encombrer.
- Les `task_summaries` injectés par `buildTaskPrompt` deviennent **redondants** avec l'historique réel dans la session → double contexte, gaspillage.
- L'optimisation « batch » gagne du temps de chargement modèle (utile pour un modèle local lent) mais au prix de la cohérence. Le compromis n'est pas documenté comme tel dans la spec ; il est juste présenté comme une accélération.

À clarifier : soit on assume le batch et on adapte le prompt (ne pas réinjecter les résumés quand on est en continuation), soit on supprime le batch et on mise sur le `warmupCoderIfNeeded`.

#### Bug 5 — `validatePlan` n'a aucun effet sur l'exécution

Les warnings sont affichés mais n'arrêtent ni ne font re-planifier. Pour une demande de 60+ caractères produisant 2 tâches, on affiche « découpage possiblement trop grossier » **puis on exécute quand même**. C'est inutile d'avertir si aucune action ne suit. Soit on re-demande automatiquement un plan plus fin (avec un message « Le plan est trop grossier, re-découpe plus finement »), soit on supprime l'avertissement.

#### Bug 6 — La vérification finale est **aveugle**

`buildFinalReviewPrompt` envoie à l'orchestrateur :
- l'objectif global,
- la liste des tâches terminées (titre + 1ère ligne de description),
- l'arborescence du projet.

**Pas le contenu des fichiers.** L'orchestrateur ne peut donc pas vérifier que le code est correct : il ne voit que les noms de fichiers. Il ne peut juger que sur la cohérence des titres de tâches vs l'arborescence. En pratique, il répond presque toujours « tout est OK » (ou produit un plan de complétion sur des suppositions). Cette « vérification » donne une **fausse assurance**. À repenser : soit on lui donne le contenu des fichiers clés créés/modifiés (avec budget token strict), soit on délègue cette vérification au **codeur** (relit le projet, vérifie les points de la directive globale), soit on la supprime et on la remplace par une vraie étape de contrôle décrite en §3.

#### Bug 7 — `markEscalatedAndContinue` puis pas de `return` immédiat

Dans `handleOrchestrationAgentEnd`, le cas « Choix 4 (EXECUTER) » appelle `markEscalatedAndContinue()` puis **tombe** dans le code commun (sauvegarde + révision mid-plan éventuelle + `executeNextTask`). Le commentaire l'assume (« Ne PAS retourner ici »). C'est fonctionnellement correct mais **fragile** : le code commun manipule `progress.completed`/`failed` mais pas `escalated`, et la branche escalade précédente a déjà fait un `return` pour les autres actions. Un refactor malheureux pourrait facilement casser ce chemin. À sécuriser par un `else` explicite ou un `return` après avoir replanifié la suite.

#### Bug 8 — `parseSearchReplaceBlocks` et le `hasInvalidFormat` peu fiable

L'heuristique « format invalide » : `!hasBlocks && freeCodeRe.test(remaining.trim())`. Cela détecte du code libre **hors** blocs. Mais :
- un codeur qui répond uniquement `DONE: fait` sans bloc (cas légitime d'une tâche de vérification / NO_CHANGE) → `hasBlocks=false`, `remaining` ne contient pas de mot-clé `function`/`const` → `hasInvalidFormat=false`. OK.
- un codeur qui écrit `J'ai ajouté une fonction \`foo\` dans le fichier` → la regex `^(?:...|function\s+...)` ne matche pas (pas en début de ligne), donc OK.
- mais un codeur qui commence sa réponse par `const x = 1` sans bloc → `hasInvalidFormat=true` → `handleTaskFailure`. C'est l'objectif, mais ça peut être un faux positif sur des commentaires explicatifs.

Marginalement acceptable, mais à surveiller : la heuristique est sensible au moindre changement de style de réponse du modèle. Préférer une approche positive : « si pas de marqueur DONE/NEED_HELP/NO_CHANGE/SEARCH-REPLACE/CREATE → format invalide », plutôt que d'essayer de détecter du « code libre ».

### 2.5 Le couple « révision mid-plan » + « subdivision » + « escalade REVISER »

Trois mécanismes distincts pour « l'orchestrateur revoit le plan ». En pratique :

- **Révision mid-plan** : déclenchée toutes les N tâches terminées (inconditionnellement — voir Bug 2). Remplace toutes les tâches restantes.
- **Subdivision proactive (point M)** : déclenchée après 2 échecs sur une tâche non-sous-tâche. Remplace **une** tâche par 2-4 sous-tâches.
- **Escalade `REDECOUPER`** : alternative à la subdivision quand on est déjà passé en escalade. Fait la même chose mais via un prompt d'escalade différent.

C'est trop. L'utilisateur n'a pas besoin de trois portes d'entrée pour la même opération. **Proposition V3** : unifier « redécoupage » en un seul mécanisme (voir §3), avec un seul prompt, et une politique claire de *quand* redécouper.

### 2.6 Pas de boucle de self-correction sémantique

Le linting corrige les **erreurs de syntaxe**. Mais aucune boucle ne corrige les **erreurs sémantiques** (la tâche ne fait pas ce qui était demandé). Or c'est l'erreur la plus fréquente avec un modèle local faible : le code compile, mais il est faux ou incomplet. Seul un contrôle par un agent (le codeur lui-même relisant, ou l'orchestrateur) peut le détecter.

Actuellement, le seul filet sémantique est la **vérification finale aveugle** (§2.4 Bug 6), qui ne voit rien. Donc **il n'y a pas de filet sémantique du tout**.

### 2.7 Métriques collectées mais sous-exploitées

Le système enregistre `task_metrics` (durée, tentatives, `responseChars`, statut, subdivisée) et injecte dans les prompts de révision/escalade. Mais :

- `getAdaptiveGranularity` ajuste seulement le texte affiché, pas le découpage réel.
- L'analyse auto des métriques (point P) ne s'applique qu'au prompt de révision, qui lui-même est déclenché inconditionnellement (Bug 2).
- Aucune métrique n'est affichée à l'utilisateur en temps réel pour qu'il puisse juger.

Les métriques sont une bonne infrastructure, mais leur **usage décisionnel** est quasi nul.

### 2.8 L'utilisateur n'est pas vraiment dans la boucle

Le panneau de progression affiche `done/total` et les boutons Pause/Reprendre/Nouveau plan. Mais :

- Impossible de **sauter** une tâche récalcitrante (la marquer comme « je le ferai moi-même »).
- Impossible d'**éditer** une tâche du plan (la scinder manuellement, corriger sa description).
- Impossible de **ré-ordonner** ou de **supprimer** une tâche.
- Impossible de **forcer une escalade** manuelle sur une tâche précise.
- Impossible de **donner un feedback** au codeur sur une tâche en cours (« non, tu as mal compris, utilise plutôt X »).

Pour un usage réel, l'utilisateur est spectateur. C'est frustrant quand le plan part mal (et il part mal souvent, cf. §2.3).

---

## 3. Propositions pour la V3

### 3.1 Principe directeur

> **Le codeur local fait les 3 phases lui-même, jusqu'à 3 fois, dans la même session** :
> 1. **RÉFLEXION** : analyse la tâche, liste ce qu'il va faire, identifie les risques.
> 2. **FAIRE** : applique les modifications via SEARCH/REPLACE ou CREATE.
> 3. **CONTRÔLER** : relit ce qu'il a fait, vérifie qu'il répond à la description, détecte les défauts.
> Si le contrôle révèle un problème, il **corrige** (même session) et recontrôle. Jusqu'à 3 cycles.
> Le frontend ne fait plus la validation sémantique — il orchestre uniquement la **boucle de cycles** et le **gate de syntaxe** (lint) entre chaque cycle.

Cela déplace la responsabilité du contrôle du frontend vers le codeur, ce qui :
- exploite réellement le contexte que le codeur a construit en lisant les fichiers,
- marche avec n'importe quel modèle capable de se relire,
- réduit les escalades (le codeur se corrige avant de déclarer DONE),
- rend le `DONE:` **crédible** : il n'est émis qu'après auto-contrôle.

### 3.2 Nouveau prompt codeur — structuré en 3 phases

Le `buildTaskPrompt` devient un **squelette à phases**, avec des marqueurs obligatoires que le frontend peut parser pour piloter la boucle :

```
=== OBJECTIF GLOBAL ===
<global_directive>

Tu exécutes une micro-tâche. Tu DOIS respecter les 3 phases ci-dessous DANS L'ORDRE,
en marquant chacune par son en-tête obligatoire.

Tâche : <title>
Description : <description>
Fichiers concernés : <files>
Contexte : <context>

=== PHASE 1 — RÉFLEXION ===
- Liste les fichiers que tu vas lire (avec read_file).
- Pour chacun, indique ce que tu cherches à comprendre.
- Énonce en 3-5 points ce que tu vas modifier/créer et pourquoi.
- Identifie les cas d'erreur ou edge cases à gérer.
Termine cette phase par la ligne : REFLEXION_DONE.

=== PHASE 2 — EXECUTION ===
- Applique les modifications avec SEARCH/REPLACE: <path> ... >>>>>>> REPLACE
  ou CREATE: <path> ... (formats stricts, déjà connus).
- Une fois toutes les modifications appliquées, termine cette phase par :
  MODIFS_DONE: <liste des fichiers modifiés/créés>

=== PHASE 3 — CONTRÔLES ===
- Relis chaque fichier modifié avec read_file.
- Vérifie point par point que chaque élément de la description est couvert.
- Vérifie qu'il n'y a pas de régression (imports cassés, fonction orpheline, etc.).
- Si tout est bon, réponds : DONE: <résumé>.
- Si tu détectes un défaut, réponds : SELF_FIX: <défaut>, puis recommence la PHASE 2
  sur le défaut (sans tout refaire), puis re-CONTRÔLER. Tu as droit à 3 cycles
  Phase 2 + Phase 3 au total. Ne dépasse pas.

Règles :
- N'envoie JAMAIS de code en dehors des blocs SEARCH/REPLACE / CREATE.
- OBJECTIF DE TAILLE : ~30-60 lignes pour cette tâche.
- Si la tâche est réellement trop grosse, réponds NEED_HELP: "tâche trop grosse".
```

### 3.3 Boucle de cycles côté frontend

`handleOrchestrationAgentEnd` détecte, dans la réponse du codeur, le **dernier marqueur** émis :

| Dernier marqueur | Action |
|---|---|
| `DONE:` | Tâche réussie → `completed` (après gate lint + check fichiers). |
| `SELF_FIX:` | Le codeur a détecté un défaut lui-même et demande à recorriger → on renvoie un prompt court « Corrige le défaut suivant puis recontrôle : <défaut> », **sans `new_session`** (le codeur garde son contexte), et on incrémente un compteur de cycles `task_cycles`. |
| `NEED_HELP:` | Échec → `handleTaskFailure`. |
| Aucun marqueur attendu | Format invalide → `handleTaskFailure`. |

Le compteur `task_cycles` remplace `task_attempts`. Politique :

- **3 cycles** max (Phase 2 + Phase 3) par tâche. Au-delà, on déclare échec.
- En cas d'échec : **subdivision proactive** par l'orchestrateur (unifiée — voir §3.6) puis, si toujours échec, **escalade EXECUTER**.
- Le gate lint intervient **après chaque Phase 2 effective** (càd après `MODIFS_DONE:` ou après `DONE:`). Si lint rate, on renvoie `SELF_FIX: <sortie linter>` au codeur (ça compte comme un cycle).

Cette boucle remplace :
- le « retry » actuel (2 tentatives) par 3 cycles d'auto-contrôle,
- le `buildRetryTaskPrompt` (qui reformulait tout le prompt) par un prompt minimal de correction in-session,
- la validation sémantique « fantôme » du frontend par une auto-évaluation du codeur.

### 3.4 Vrai découpage fin — contraintes actives

Pour que le découpage soit réellement fin (et pas seulement suggéré dans le prompt) :

1. **`validatePlan` devient bloquant** : si une tâche a > 2 fichiers OU une description < 40 car. OU le plan a < 3 tâches pour une demande > 60 car., on renvoie **automatiquement** un message à l'orchestrateur : « Le plan est trop grossier (raisons: ...). Re-découpe en respectant STRICTEMENT max 2 fichiers et ~30-60 lignes par tâche. » (max 2 re-plans, comme pour le JSON invalide).
2. **Découpage proactif à la planification** : ajouter au `buildPlanPrompt` une étape « après ton premier brouillon de plan, vérifie chaque tâche : si > 2 fichiers, subdivise-la avant de répondre. » (incite à un auto-affinage par l'orchestrateur lui-même).
3. **Subdivision unifiée** (voir §3.6) applicable aussi **proactivement** : si, pendant l'exécution, la **première** tentative d'une tâche échoue *uniquement parce que le codeur a émis `NEED_HELP: tâche trop grosse`* (marqueur explicite), on subdivise immédiatement, sans attendre 3 cycles. C'est un signal clair, gratuit.

### 3.5 Vérification finale crédible

Remplacer la vérification finale aveugle par **une vérification par le codeur lui-même** (il a le contexte, l'outillage, et coûte peu en local) :

```
=== VÉRIFICATION FINALE DU PROJET ===
Tu es le codeur. L'objectif global était : <global_directive>.
Voici les tâches terminées et leurs résumés : <liste>.
Relis les fichiers clés du projet avec read_file. Pour chaque tâche terminée,
vérifie que le livrable correspond à sa description. Réponds :
- VERIFIED: tout est correct.   (si OK)
- TODO: <liste des points manquants ou incorrects>  (sinon)
```

Si `TODO:` non vide → générer un **mini-plan** (orchestrateur, court) de corrections et re-exécuter. Limite à 2 cycles de vérification (au lieu de 3 actuellement) parce qu'ici la vérification a vraiment accès au contenu.

Alternative / complément : donner à l'orchestrateur cloud le **contenu des fichiers clés créés** (sélectionnés par leurs chemins apparaissant dans les `task_summaries`), avec un budget token strict (ex : 8 000 tokens). L'orchestrateur cloud est bon pour juger la cohérence globale — laissons-le faire ce qu'il sait faire, avec de la matière.

### 3.6 Subdivision unifiée

Un seul mécanisme « redécoupage », un seul prompt (`buildSubdividePrompt` déjà existant), appelé dans **trois** situations :

1. **Proactive** : `NEED_HELP: tâche trop grosse` du codeur (immédiat, sans cycle).
2. **Réactive** : après 3 cycles d'auto-contrôle échoués sur une tâche non-sous-tâche.
3. **À l'escalade** : si l'orchestrateur, en escalade, choisit `REDECOUPER` (on garde le marqueur, mais on appelle le même `buildSubdividePrompt` + `replaceTaskWithSubtasks`).

Supprimer le dualisme « subdivision point M » vs « escalade REDECOUPER ». Garde-fou : **1 niveau de subdivision** reste (les sous-tâches ne sont pas re-subdivisables), sinon on entre dans une explosion exponentielle.

### 3.7 Révision mid-plan conditionnelle (corriger Bug 2)

```js
const failureRate = totalDone > 0 ? failedCount / totalDone : 0;
shouldRevise = interval > 0
  && st.orchestrationTasksSinceRevision >= interval
  && remainingAfter.length > 0
  && (failureRate > 0.30 || avgAttempts > 1.3);
```

Et par défaut, **désactiver** la révision mid-plan (`orchestration_revision_interval = 0`) tant que les tâches avancent bien. Ne la déclencher que sur signaux négatifs. Ça économise du cloud et évite de perturber un plan sain.

### 3.8 Batch mode : clarifier ou supprimer

Décision à prendre clairement :
- **Option A (recommandée)** : supprimer le batch. La session vierge par tour est un principe trop important pour le sacrifier à une accélération. Le `warmupCoderIfNeeded` couvre déjà le coût de chargement modèle. On gagne en cohérence et en prévisibilité.
- **Option B** : garder le batch mais **adapter le prompt en continuation** : ne pas réinjecter `buildCommonContext` (les résumés) puisqu'ils sont déjà dans l'historique ; ajouter un en-tête « Tu enchaînes sur la tâche N+1, voici la nouvelle tâche : » qui signale explicitement la transition.

L'option B est plus risquée : un modèle local faible peut confondre l'ancien contexte avec le nouveau. L'option A est plus simple et alignée avec la philosophie de la spec.

### 3.9 Validation post-tâche robuste (corriger Bug 3)

Remplacer la comparaison `mtime` par un **hash du contenu** (ou au moins `size + mtime` avec tolérance ±2s). Mieux : puisque `applySearchReplaceBlocks` retourne déjà `changedFiles`, **c'est la source de vérité**. La validation devrait être :

```
si applySearchReplaceBlocks.ok && changedFiles.length > 0  → ok (les fichiers ont été écrits)
sinon si NO_CHANGE explicite + fichier existe              → ok (rien à faire, c'est valide)
sinon                                                    → échec validation
```

On supprime la dépendance au `mtime` (fragile sous Windows) et on s'appuie sur ce qu'on sait avoir écrit. Le `captureFileState` / `checkTaskFilesChanged` peut être conservé comme garde-fou secondaire uniquement pour détecter le cas « le codeur dit DONE mais n'a rien écrit ».

### 3.10 Contrôle utilisateur renforcé

Ajouter au panneau d'orchestration :

- Clic sur une tâche → menu contextuel : **« Forcer l'escalade »**, **« Subdiviser »**, **« Marquer faite »**, **« Éditer la description »**.
- Bouton **« Sauter cette tâche »** (marque comme `skipped`, n'entre ni dans `completed` ni dans `escalated`, mais libère le plan).
- Champ **« Feedback pour le codeur »** avant de relancer une tâche : injecté dans le prompt de la prochaine tentative.

C'est essentiel pour récupérer un plan qui dérape sans devoir tout abandonner.

### 3.11 Métriques affichées en temps réel

Afficher dans le panneau, pour la tâche en cours : `cycle 2/3`, `durée 47s`, `outils: read_file×3, write×1`. Et en bas : `codeur: 4/6 réussies, 1 escaladée, 1 en cours`. Donne à l'utilisateur une lecture immédiate de la santé du plan, et lui permet de décider d'interrompre tôt si ça va mal.

### 3.12 Découpage par défaut « fine » et non configurable pour le codeur local

Le setting `orchestration_granularity` propose `fine`/`medium`/`large`. Pour le cas d'usage « codeur local faible », **`fine` devrait être la seule option recommandée** et `large` devrait être masqué ou affiché avec un avertissement « déconseillé avec un codeur local ». Inverser le défaut à `fine` (c'est déjà le cas) et documenter clairement que `large` ne convient qu'à un codeur cloud puissant.

---

## 4. Tableau de synthèse — V2 → V3

| Aspect | V2 (actuel) | V3 (proposé) |
|---|---|---|
| Phases du codeur | Produire seulement | **Réfléchir → Faire → Contrôler** (marqueurs obligatoires) |
| Tentatives codeur | 2 | **3 cycles d'auto-contrôle** (in-session) |
| Validation sémantique | Aucune (frontend = mtime+lint) | **Auto-contrôle par le codeur** (SELF_FIX) |
| Validation fichiers | mtime (fragile Win) | **`changedFiles` de applySearchReplaceBlocks** + hash |
| Découpage fin | Suggéré dans le prompt | **Contraint** : `validatePlan` bloquant + auto-affinage |
| Subdivision | 2 chemins (point M + REDECOUPER) | **Unifiée**, 3 déclencheurs (proactif/réactif/escalade) |
| Révision mid-plan | Inconditionnelle (bug) | **Conditionnelle** (signaux négatifs seulement) |
| Vérification finale | Aveugle (arborescence seule) | **Par le codeur** (relit les fichiers) + orchestrateur sur fichiers clés |
| Batch mode | En contradiction avec le principe | **Supprimé** (ou adapté explicitement) |
| Contrôle utilisateur | Pause/Reprendre/Nouveau | + **Escalade/Subdivision/Saut/Édition manuelle** |
| Métriques | Collectées, peu utilisées | **Affichées en temps réel** + décisionnelles |
| Lint | Boucle syntaxique séparée | Intégré aux cycles (compte comme un cycle) |

---

## 5. Priorisation des actions

Pour livrer la V3 sans tout casser, dans l'ordre :

1. **Corriger les bugs silencieux d'abord** (rapide, gros gain de fiabilité) :
   - Bug 1 (`compactTaskPrompt` : libellés des regex).
   - Bug 2 (révision mid-plan conditionnelle).
   - Bug 3 (validation par `changedFiles`/hash au lieu de mtime).
   - Bug 5 (`validatePlan` bloquant avec auto re-plan).
2. **Passer à 3 tentatives** dans `handleTaskFailure` (`attempts < 3`) avec feedback enrichi.
3. **Introduire le prompt 3 phases** (§3.2) + parsing des marqueurs `REFLEXION_DONE` / `MODIFS_DONE` / `SELF_FIX` / `DONE` côté frontend, avec la boucle de cycles (§3.3).
4. **Vérification finale par le codeur** (§3.5) — remplace l'actuelle, plus crédible.
5. **Unifier la subdivision** (§3.6) — supprimer le dualisme point M / REDECOUPER.
6. **Contrôles utilisateur** (§3.10) — saut/escalade/édition manuelle.
7. **Supprimer le batch** (§3.8) ou l'adapter explicitement.
8. **Métriques temps réel** (§3.11) et affinage du setting granularité (§3.12).

Les étapes 1 et 2 sont des **corrections peu risquées** et doivent passer par le protocole quality-gate (`.pi/skills/quality-gate/SKILL.md`) avant modification. Les étapes 3-5 sont des changements plus profonds du flux `handleOrchestrationAgentEnd` et de `buildTaskPrompt` : à traiter comme une vraie V3, avec mise à jour de `spec_orchestration.md` et tests de non-régression sur les scénarios existants (plan simple, escalade, révision, vérification finale).

---

## 6. Risques & préventions (V3)

| Risque | Prévention |
|---|---|
| Le codeur local « faible » n'arrive pas à faire une vraie Phase 3 (auto-contrôle) | Le prompt doit être très directif ; accepter qu'un modèle trop petit reste en Phase 2/3 superficielle — dans ce cas, l'escalade cloud prend le relais, c'est exactement le rôle prévu. |
| Les 3 cycles peuvent tripler le temps d'exécution | Le gate lint ne se déclenche qu'après une Phase 2 effective ; les cycles `SELF_FIX` sont courts (prompt minimal, in-session). Afficher la durée pour laisser l'utilisateur interrompre. |
| `validatePlan` bloquant peut boucler si l'orchestrateur produit toujours du grossier | Limiter à 2 re-plans, comme pour le JSON invalide. En cas d'échec, exécuter quand même avec avertissement. |
| Supprimer le batch ralentit le codeur local | Compenser par `warmupCoderIfNeeded` (déjà existant) et par un `set_model` mis en cache côté pi. |
| Vérification finale par le codeur : il peut déclarer `VERIFIED` trop vite | Demander explicitement « cite 3 vérifications concrètes que tu as faites » avant `VERIFIED`. Refuser un `VERIFIED` sans justification. |

---

## 7. Conclusion

Le mode Orchestration est **architecturalement sain** (session unique, bascule de modèle, contexte vierge) et **fonctionnellement riche** (linting, escalade intelligente, subdivision, métriques). Mais il est **orienté réaction** plutôt que **prévention** : tout le contrôle sémantique est externalisé au frontend, qui n'a pas les moyens de le faire (mtime + lint ne captent pas la sémantique), et le codeur ne s'auto-vérifie jamais.

La **V3** proposée recentre le codeur sur un triptyque **réfléchir → faire → contrôler** en 3 cycles, rend le découpage réellement contraignant, fiabilise la validation (hash au lieu de mtime, `changedFiles` comme source de vérité), unifie les trois mécanismes de redécoupage en un seul, et remplace la vérification finale aveugle par une vraie revue par le codeur (qui a accès au contenu).

Les **bugs silencieux** (`compactTaskPrompt`, révision inconditionnelle, mtime Windows) sont des corrections rapides à faire en priorité : ils dégradent la qualité perçue aujourd'hui sans que personne ne le remarque, et leur correction restaure immédiatement la confiance dans les garde-fous existants.

L'investissement principal de la V3 est le **prompt 3 phases + parsing des marqueurs** : c'est le changement qui aligne le système sur le besoin exprimé (« le codeur réfléchit, fait, et contrôle, jusqu'à 3 fois »). Tout le reste est de la consolidation.