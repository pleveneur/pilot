# Spec — Observabilité des échecs du codeur (Mode Orchestration)

> **Statut : ✅ Implémenté (13/07/2026).**
> Composant : `spec_orchestration.md` (Mode Orchestration V3) — évolution.
>
> Objectif : donner à l'utilisateur une **visibilité sur les raisons d'échec** du
> codeur local en mode orchestration. Sans cela, l'utilisateur ne sait pas pourquoi
> une tâche a été retry / subdivisée / escaladée, et ne peut ni calibrer le harnais
> ni avoir confiance dans le système.

---

## 1. Problème

Aujourd'hui, quand le codeur échoue, l'utilisateur ne voit que des messages
système génériques (« 🔁 Échec tâche N », « ✂️ Subdivision », « 🧠 Escalade »).
La **raison précise** (erreur de linting, format invalide, `NEED_HELP`, timeout,
bouclage, validation fichier échouée) n'est pas exposée. L'utilisateur ne peut
pas diagnostiquer si le codeur local est bon ou s'il faut un meilleur harnais.

## 2. Solution — journal des tentatives par tâche

### 2.1 Structure de données

Nouveau champ dans `progress` (persisté dans `.pilot/plan.json`) :

```js
progress.task_logs = {
  [taskId]: [
    {
      n: 1,                      // numéro de tentative (1-indexed)
      ts: 1736890000000,         // timestamp
      marker: "DONE" | "NEED_HELP" | "SELF_FIX" | "NO_CHANGE"
            | "timeout" | "syntax_error" | "validation_fail" | "loop",
      reason: "Linting échoué : ...",  // raison lisible (FR)
      filesChanged: ["src/a.ts"],      // fichiers écrits via SEARCH/REPLACE
      durationMs: 45000,               // durée du tour (si disponible)
      responseExcerpt: "...",          // 500 premiers caractères de la réponse
      action: "complete" | "self_fix" | "retry" | "lint_correction"
            | "subdivide" | "escalate",
      lintErrors: null | "sortie brute du linter",
      cycles: 0,                       // cycles SELF_FIX déjà consommés avant ce tour
      loop: false,                     // true si réponse en boucle détectée
    }
  ]
}
```

### 2.2 Détection de bouclage

À chaque nouvelle entrée pour une tâche, on compare l'excerpt normalisé à celui de
la tentative précédente. Similarité > 80 % (mêmes mots significatifs) → `loop: true`
+ raison « 🔄 Réponse en boucle détectée (similaire à la tentative précédente) ».
C'est le signal qui distingue un échec récupérable (retry utile) d'un échec
structurel (le codeur a épuisé son plafond).

### 2.3 Points d'instrumentation

| Lieu | Marqueur | Action |
|---|---|---|
| `handleOrchestrationAgentEnd` — `DONE` + validation OK | `DONE` | `complete` |
| `handleOrchestrationAgentEnd` — `SELF_FIX` | `SELF_FIX` | `self_fix` |
| `handleOrchestrationAgentEnd` — `NEED_HELP` | `NEED_HELP` | (passe à `handleTaskFailure`) |
| `handleOrchestrationAgentEnd` — format invalide | (validation) | (passe à `handleTaskFailure`) |
| `handleOrchestrationAgentEnd` — linting échoue | `syntax_error` | `lint_correction` |
| `handleOrchestrationAgentEnd` — validation fichiers échoue | `validation_fail` | (passe à `handleTaskFailure`) |
| `handleTaskFailure` — attempts < 3 | (raison reçue) | `retry` |
| `handleTaskFailure` — subdivision | (raison reçue) | `subdivide` |
| `handleTaskFailure` — escalade | (raison reçue) | `escalade` |
| `handleOrchestrationTimeout` | `timeout` | (passe à `handleTaskFailure`) |

### 2.4 Affichage — panneau d'orchestration

Nouveau bloc repliable **« 📋 Journal des tentatives »** dans le panneau
d'orchestration (entre `orch-metrics` et `orch-tasks`), affichant les tentatives de
la **tâche en cours** (`progress.current_task`) :

```
┌─────────────────────────────────────────────┐
│ 📋 Journal des tentatives (tâche #3)  ▶     │  ← repliable
├─────────────────────────────────────────────┤
│ #1 · SELF_FIX (auto-contrôle 1/3) · 42s     │  ← clic = déplie l'excerpt
│    « corriger l'import manquant dans a.ts » │
│ #2 · syntax_error · lint_correction · 18s   │
│    🧹 eslint: 'x' is not defined (3:5)      │
│ #3 · DONE · complete · 12s                  │
│    « Ajout de la route GET /tasks »         │
└─────────────────────────────────────────────┘
```

- Si `loop: true` sur une entrée → badge `🔄 bouclage` en rouge.
- Si aucune tâche en cours → bloc caché.
- Clic sur une entrée → déplie l'extrait de réponse + erreurs de linting.

### 2.5 Synthèse finale par tâche

À la fin d'une tâche (réussie ou escaladée), le message système existant est enrichi :

- Réussie : `✅ Tâche 3 terminée (2 tentatives : syntax_error → fixée, DONE).`
- Escaladée : `🧠 Tâche 3 escaladée (3 tentatives : NEED_HELP, bouclage, validation_fail).`

## 3. Fichiers

| Fichier | Rôle |
|---|---|
| `src/js/orchestration.js` | Fonctions pures : `createAttemptLog`, `normalizeExcerpt`, `detectLoop`, `summarizeTaskAttempts` |
| `src/js/agent-pi.js` | `logTaskAttempt(st, taskId, partial)` (runtime) ; instrumentation aux points clés ; `renderOrchestrationAttempts(st)` ; bloc UI `orch-attempts` dans `orchestrationPanel.innerHTML` |
| `src/css/style.css` | Styles `.orch-attempts`, `.orch-attempt`, `.orch-attempt-loop` |
| `spec_orchestration.md` | Référence croisée vers cette spec |
| `idees_evolutions.md` | Pointer (brainstorming §A/observabilité) |

## 4. Compatibilité

- Aucun changement de backend Rust, aucun changement de commande Tauri.
- `task_logs` est ajouté au `progress` persisté ; les anciens `.pilot/plan.json`
  sans ce champ restent lisibles (lookup `|| []`).
- Le mode orchestration normal (sans échec) n'est pas ralenti (log ajouté seulement
  aux points de branchement existants, ~1 appel par tour).
- Aucune régression sur le workflow V3 (triptyque, subdivision, escalade, linting).

## 5. Nudge proactif après arrêt prématuré en réflexion

### 5.1 Problème observé

Les modèles locaux faibles (9B-14B) s'arrêtent souvent après la Phase 1
(RÉFLEXION) du prompt codeur : ils écrivent `REFLEXION_DONE` (ou une variante
naturelle) puis stoppent, sans produire aucun bloc `SEARCH/REPLACE` / `CREATE`.
Sans intervention, ce cas tombait dans `validation_fail` → 3 retries inutiles
( même arrêt ) → escalade cloud systématique, annulant l'économie du local.

### 5.2 Solution — nudge in-session

Quand `coderMarker.marker === null` (pas de `DONE`/`SELF_FIX`/`NEED_HELP`) **et**
`detectReflectionOnly(responseText)` renvoie vrai (signal de fin de réflexion
présent, aucun bloc, pas de `MODIFS_DONE`), on envoie un **nudge** au codeur
dans la **même session** (contexte préservé) via `buildNudgeAfterReflectionPrompt`.

Ce nudge dit au codeur : « ta réflexion est bonne, maintenant exécute la
Phase 2 (blocs `SEARCH/REPLACE` / `CREATE`) puis `DONE` ».

### 5.3 Compteur anti-bouclage

- Max **2 nudges** par tâche (`st.orchestrationNudgeAttempts[taskId]`).
- Un nudge **n'incrémente pas** `task_attempts` (ce n'est pas un retry, c'est
  une continuation — le codeur reprend là où il s'est arrêté).
- Après 2 nudges sans modification, le flux retombe dans `validation_fail` →
  `handleTaskFailure` (comportement classique : retry / subdivision / escalade).
- Le compteur est reset au succès de la tâche (`delete
  st.orchestrationNudgeAttempts[currentTaskId]`) et au reset global du plan.

### 5.4 Journal (observabilité)

Chaque nudge est journalisé dans `task_logs[taskId]` avec :
- `marker: "REFLECTION_ONLY"`
- `action: "nudge"`
- `reason: "Arrêt prématuré après RÉFLEXION (aucun bloc produit)"`

### 5.5 Fichiers

- `src/js/orchestration.js` : `detectReflectionOnly(text)` (pure),
  `buildNudgeAfterReflectionPrompt(task, globalDirective, nudgesRemaining)` (pure).
- `src/js/agent-pi.js` : branche nudge dans `handleOrchestrationAgentEnd`,
  compteur `st.orchestrationNudgeAttempts` (max 2).

## 6. Futur (hors scope)

- Classification automatique des échecs en « récupérable » vs « structurel » pour
  adapter la politique d'escalade (voir `idees_evolutions.md` §23 — harnais LLM local).
- E2 (auto-test post-modif) comme feedback `SELF_FIX` supplémentaire.
- Export du journal (JSON/HTML) pour analyse hors Pilot.