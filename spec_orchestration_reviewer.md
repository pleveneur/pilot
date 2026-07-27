# Spec — Reviewer indépendant (H2 V1)

Évolution **H2 V1** du Mode Orchestration : un **reviewer indépendant** relit le
diff de chaque tâche du codeur, en complément de l'auto-validation `SELF_FIX`
(V3 §13.2). C'est la première brique de H2 (multi-codeurs spécialisés) : elle pose
l'architecture multi-sessions qu'on étendra ensuite (V2 : sub-agents parallèles
multiples — test-writer, doc-writer, refactorer). **Statut : ✅ Implémenté
(2026-07-29).**

## 1. Objectif & valeur

Aujourd'hui le codeur **s'auto-valide** (triptyque Réfléchir/Faire/Contrôler,
`SELF_FIX`). L'auto-validation est moins fiable qu'une relecture externe : même
contexte, même biais. H2 V1 ajoute une **2e couche de validation indépendante** :
un reviewer avec un **contexte vierge** (pas biaisé par la production du codeur)
relit le diff et émet `APPROVED` ou `CHANGES_REQUESTED: <défauts>`.

- **Valeur :** 🔴 très haute (qualité, anti-régression).
- **Effort :** moyen (backend multi-session + porte frontend).
- **Compatibilité :** opt-in (défaut off) — aucun impact si désactivé.

## 2. Architecture — session reviewer dédiée

Le reviewer est un **second processus `pi --mode rpc --no-session`** (pas de
persistance, contexte jetable), géré indépendamment de la session principale.

| Aspect | Session principale (`main`) | Session reviewer |
|---|---|---|
| État backend | `AppState.rpc_state` (inchangé) | `AppState.rpc_reviewer` (nouveau) |
| Persistance | `--session-dir` (si configuré) | `--no-session` (jetable) |
| Canal événements | `rpc-event` (inchangé) | `rpc-event-reviewer` (nouveau, séparé) |
| Modèle | orchestrateur / codeur (bascule) | modèle reviewer dédié (fallback orchestrateur) |
| Cycle de vie | lancée au démarrage agent | **lazy** : lancée au 1er besoin, recyclée (`new_session` avant chaque review) |

Le reviewer n'est pas lancé au démarrage de l'agent (économie de ressources). Il
est démarré à la 1re tâche nécessitant une review, puis conservé entre les
tâches (un `new_session` avant chaque review garantit un contexte vierge).

### 2.1 Routage des événements

Le backend émet les événements du reviewer sur le canal Tauri **séparé**
`rpc-event-reviewer` (et fan-out web dédié si distant). Le frontend écoute ce
canal avec un handler dédié `handleReviewerEvent` — il ne traverse **pas** le
`handleRpcEvent` principal (pas de garde-fou orchestration, pas de pollution de
`lastAssistantRawText`, pas de timer d'inactivité). Le reviewer est court (un
tour), sans outil (lecture seule).

## 3. Workflow — porte review après tests (E2)

Insérée dans `handleOrchestrationAgentEnd` (`agent-pi.js`), **après** le test gate
(E2) et **avant** la validation de la tâche :

```
Codeur (DONE / NO_CHANGE, SELF_FIX interne déjà joué)
  → linting (existant)
  → tests E2 (existant)
  → 🔍 REVIEW GATE (nouveau)
      non déclenché (scope critical + aucun fichier sensible) → validation directe
      déclenché :
        new_reviewer_session + set_reviewer_model + send_reviewer_prompt
        → reviewer stream → agent_end → parse
          APPROVED                       → tâche validée → executeNextTask
          CHANGES_REQUESTED: <défauts>    → retry codeur avec feedback (budget unifié)
          crash / timeout / pas de marqueur → fallback : validation sans review
```

### 3.1 SELF_FIX conservé

Le `SELF_FIX` (auto-détection V3 §13.2) reste la **1re couche** : le codeur peut
se rendre compte d'un défaut en relisant (Phase 3 CONTRÔLE) et se corriger
in-session. Le reviewer est la **2e couche / porte finale**, qui remplace
l'auto-validation implicite actuelle (il n'y avait pas de validation externe
avant, seulement lint + tests E2).

## 4. Prompt reviewer — `buildReviewPrompt`

Fonction pure dans `orchestration.js` :

```
buildReviewPrompt(task, changedFiles, projectMemory, planDirective)
```

Injecte :
- **Rôle** : « Tu es un reviewer indépendant. Tu ne modifies rien. Tu relis le
  diff ci-dessous et tu juges s'il réalise correctement la tâche, sans
  régression. »
- **Description de la tâche** (`task.description`).
- **Fichiers modifiés** : pour chaque fichier de `changedFiles`, le **contenu
  actuel** après modification (lu via `read_file_content`) — le reviewer juge
  l'état final, pas un diff brut (plus simple et plus robuste qu'un format diff).
- **Conventions projet** (`PROJECT_MEMORY.md` si présent) pour cohérence.
- **Consigne de sortie stricte** : terminer par exactement :
  - `APPROVED: <résumé court>` si tout est bon, ou
  - `CHANGES_REQUESTED: <liste numérotée des défauts concrets à corriger>`.

Pas d'outils (lecture seule). Contexte vierge → pas de compaction possible.

## 5. Parsing du résultat — `parseReviewResult`

Fonction pure dans `orchestration.js` :

```
parseReviewResult(text) -> { approved: boolean, summary: string, changes: string|null }
```

Détecte le **dernier** marqueur (`APPROVED` ou `CHANGES_REQUESTED`) par position
dans le texte (même logique que `detectCoderMarker`). Si aucun marqueur →
`approved: false, changes: null` (→ fallback : on ne sait pas, on valide sans
review pour ne pas bloquer).

## 6. Budget retry unifié

Les tentatives de correction (lint + tests E2 + review) partagent un **budget
unique** `maxCorrections` (défaut 3, configurable). Un `CHANGES_REQUESTED` du
reviewer consomme une tentative comme un échec de lint/test.

- `reviewAttempts` (nouveau compteur par tâche) s'ajoute à `lintAttempts +
  testAttempts`.
- Quand `lintAttempts + testAttempts + reviewAttempts > maxCorrections` →
  `handleTaskFailure` (subdivision / escalade selon politique existante).
- Le feedback du reviewer est passé au codeur via `buildReviewCorrectionPrompt`
  (prompt court : « Le reviewer a demandé : <défauts>. Corrige et renvoie DONE. »).

## 7. Configuration — champs `AppConfig` (lib.rs)

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `orchestration_reviewer_enabled` | `bool` | `false` | active la porte review (opt-in) |
| `orchestration_reviewer_provider` | `String` | `""` | provider du reviewer (vide → `orchestration_provider`) |
| `orchestration_reviewer_model` | `String` | `""` | modèle reviewer (vide → `orchestration_model`) |
| `orchestration_reviewer_scope` | `String` | `"all"` | `"all"` = chaque tâche · `"critical"` = seulement si fichier sensible touché |
| `orchestration_reviewer_critical_patterns` | `Vec<String>` | `["src-tauri/src/**/*.rs", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "package.json", "AGENTS.md", "spec_*.md"]` | globs éditables (mode `"critical"` uniquement) |

### 7.1 Matching mode `"critical"`

Une tâche déclenche le reviewer si **au moins un** de ses `changedFiles` matche
un des globs (matching simple `*`/`**`, via crate `glob` ou fonction JS
équivalente côté frontend). Si la liste est vide en mode `"critical"` → aucune
tâche ne déclenche (équivalent désactivé) + message d'avertissement une fois au
démarrage du plan.

## 8. Commandes Tauri (lib.rs)

Nouvelles commandes dédiées (ne touchent pas à `rpc_state`) :

| Commande | Rôle |
|---|---|
| `start_reviewer_session(app)` | spawn `pi --no-session` dans `rpc_reviewer` si absent (lazy) |
| `stop_reviewer_session(state)` | arrête proprement le reviewer |
| `send_reviewer_prompt(state, message)` | envoie un prompt au reviewer |
| `new_reviewer_session(state)` | `new_session` (contexte vierge avant chaque review) |
| `set_reviewer_model(state, provider, modelId)` | bascule le modèle du reviewer |
| `abort_reviewer(state)` | abort le tour reviewer en cours |
| `get_reviewer_state(state)` | état streaming reviewer |

Réutilise `rpc_manager::spawn_and_start` avec `no_session=true`, mais émet sur
le canal `rpc-event-reviewer`. Pour cela, `spawn_and_start` prend un paramètre
`event_channel: &str` (défaut `"rpc-event"`), injecté dans `app_handle.emit`.

## 9. Frontend (`agent-pi.js` + `orchestration.js`)

### 9.1 `runReviewGate(state, messagesEl, statusEl, task, changedFiles)`

Helper async dans `agent-pi.js`, appelé dans `handleOrchestrationAgentEnd` après
`runTestGate` :

1. Vérifier `orchestration_reviewer_enabled` ; si non → retour `{ ok: true, skipped }`.
2. Vérifier le scope : si `"critical"`, matcher `changedFiles` contre
   `orchestration_reviewer_critical_patterns` ; si aucun match → retour `skipped`.
3. Incrémenter `reviewAttempts` ; si budget dépassé → retour `{ ok: false, reason }`.
4. Démarrer le reviewer si pas actif (`start_reviewer_session`), `new_reviewer_session`,
   `set_reviewer_model`, lire le contenu des `changedFiles`, construire le prompt
   via `buildReviewPrompt`, `send_reviewer_prompt`.
5. Attendre `agent_end` sur le canal `rpc-event-reviewer` (Promise + listener
   dédié, timeout 90 s).
6. Parser via `parseReviewResult` :
   - `APPROVED` → retour `{ ok: true }`.
   - `CHANGES_REQUESTED` → `sendReviewCorrectionPrompt` (retour codeur), retour
     `{ ok: false, retry: true, changes }`.
   - aucun marqueur / timeout / crash → retour `{ ok: true, fallback: true }`
     (validation sans review, non-bloquant).

### 9.2 `handleReviewerEvent(payload, messagesEl, state, statusEl)`

Listener du canal `rpc-event-reviewer`. Handler simplifié (pas de garde-fou
orchestration, pas de `lastAssistantRawText`) :
- `agent_start` → badge `🔍 Reviewer — Réflexion...`, `isReviewerStreaming = true`.
- `message_update` / `text_delta` → append dans une bulle reviewer dédiée
  (style distinct, classe CSS `agent-reviewer-block`).
- `agent_end` → `isReviewerStreaming = false`, résout la Promise en attente.
- `compaction_start`/`compaction_end` → appliquer le même filtre `isCompacting`
  (réutilise le fix §11.8 — le reviewer peut aussi compacter).

### 9.3 Badges & UI

- Bulle reviewer : classe `agent-reviewer-block` (fond/légèrement différent),
  en-tête `🔍 Reviewer`.
- `renderOrchestrationAttempts` : badge 🔍 sur les attempts qui ont déclenché
  une review (champ `reviewResult` dans `createAttemptLog`).
- Pas d'onglet séparé (tout dans le chat principal).

### 9.4 `createAttemptLog` (orchestration.js)

Étendu avec `reviewResult: { approved, changes, skipped, fallback } | null`.

## 10. UI — Paramètres (`index.html` + `settings.js`)

Nouveau bloc « Reviewer » dans la section Orchestration :
- Checkbox « Reviewer indépendant » (`orchestration_reviewer_enabled`).
- Provider + modèle reviewer (vides = modèle orchestrateur).
- Select scope : « Chaque tâche » (`all`) / « Fichiers sensibles » (`critical`).
- Textarea patterns critiques (un par ligne), visible seulement si `scope == critical`.

## 11. Fallback gracieux

- Reviewer non activé → comportement strictement identique à aujourd'hui.
- Reviewer crash / timeout / réponse sans marqueur → on **valide sans review**
  (non-bloquant) + message `⚠️ Reviewer indisponible, validation sans relecture.`
- Budget dépassé → `handleTaskFailure` (politique existante).
- Backend ne supportant pas un 2nd process → `start_reviewer_session` échoue →
  fallback sans review + avertissement.

## 12. Compatibilité / anti-régression

- **Session principale inchangée** : `rpc_state`, `handleRpcEvent`, toutes les
  commandes existantes — aucune modification. Le reviewer vit à côté.
- **SELF_FIX, E2, A1, linting, batch mode, escalade, subdivision** : intacts. La
  porte review s'insère après E2 et avant validation ; si non activée, zéro effet.
- **Canal séparé** : aucun risque de pollution croisée codeur/reviewer.
- **Distant (web)** : le reviewer émet aussi sur le fan-out web dédié (optionnel
  en V1 — peut être différé).

## 13. Fichiers

| Fichier | Changement |
|---|---|
| `src-tauri/src/lib.rs` | 5 champs `AppConfig` + `rpc_reviewer` state + 7 commandes + enregistrement `generate_handler!` |
| `src-tauri/src/rpc_manager.rs` | `spawn_and_start` prend `event_channel: &str` |
| `src/js/orchestration.js` | `buildReviewPrompt`, `parseReviewResult`, `buildReviewCorrectionPrompt`, `createAttemptLog.reviewResult`, helper de glob matching |
| `src/js/agent-pi.js` | `runReviewGate`, `handleReviewerEvent`, listener `rpc-event-reviewer`, state (`isReviewerStreaming`, `reviewAttempts`, config), insertion dans `handleOrchestrationAgentEnd`, badges, resets |
| `index.html` + `src/js/settings.js` | bloc reviewer |
| `src/css/style.css` | `.agent-reviewer-block`, badge 🔍 |
| `spec_orchestration.md` | §11.9 + HELP |
| `AGENTS.md`, `plan_dev.md`, `idees_evolutions.md` | navigation + statut |

<!-- HELP:orchestration -->
### Reviewer indépendant (H2 V1)

- **Opt-in** (Paramètres → Orchestration → Reviewer). Un second agent relit le diff
  de chaque tâche (ou seulement les fichiers sensibles en mode « critical ») avec
  un contexte vierge et répond `APPROVED` ou `CHANGES_REQUESTED`.
- Désactivé par défaut (coûte un tour cloud par tâche). Modèle reviewer configurable
  (défaut = modèle orchestrateur).
- Les corrections demandées par le reviewer sont renvoyées au codeur et partagent le
  même budget que lint/tests (`maxCorrections`).
- En cas d'indisponibilité du reviewer (crash/timeout), la tâche est validée sans
  relecture (non-bloquant).
<!-- /HELP:orchestration -->