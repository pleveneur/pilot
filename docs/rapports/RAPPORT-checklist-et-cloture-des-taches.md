# Rapport — cocher une case NOMMÉE et clôturer délibérément une tâche

Date : 2026-11-16 · Projet : `G:\IA_PL\pilot` · Point de départ : commit `d4a45c4`

---

## 1. Symptôme, dit par le propriétaire

> « Depuis **sa conversation**, l'Assistant doit pouvoir, avec **ses outils
> habituels** (aucun canal parallèle) : cocher / décocher un point de checklist
> **désigné par son nom** — un nom inconnu est **refusé avec un message clair**,
> jamais ignoré en silence ; et **terminer délibérément** une tâche même si des
> cases restent décochées — mais **jamais en silence** : la clôture forcée laisse
> une **trace lisible** disant qu'elle a été forcée **et pourquoi**. »

Constat de départ : le cœur Rust savait déjà manipuler une checklist (`task_checks`,
`db_add_task_check`, `db_set_task_check_done`, `super_agent_task_check_*`) et
portait le contrôle de clôture (`guard_task_checklist`, modes désactivé / rappel /
bloquant), mais :

- **aucun outil de l'Assistant** ne touchait la checklist (l'écran seulement) :
  depuis la conversation, l'Assistant ne pouvait ni lire les points ni en cocher un ;
- l'écran forçait la clôture avec `force: true` **sans motif**, et le cœur
  n'enregistrait **rien** : une tâche pouvait être terminée avec des points
  restants sans qu'aucune ligne ne dise pourquoi (« 10 tâches finies restées en
  cours » côté suivi).

---

## 2. Mécanisme retenu (extension de l'existant, aucune voie nouvelle)

Le canal est celui de **tous** les outils de l'Assistant : une extension embarquée
émet un `input` préfixé `PILOT_ASSISTANT_TOOLS::<outil>::<JSON>`, `super-agent.js`
l'intercepte dans le **même** `switch (toolName)` et appelle une **commande Rust**.

### 2.1 Décisions pures, en un seul endroit (`src-tauri/src/super_agent.rs`)

| Fonction | Rôle | Refus / garantie |
|---|---|---|
| `check_label_key(label)` | clé de comparaison : minuscules, sans accents, espaces réduits (miroir de `fold_task_char`) | un libellé sans mot utilisable ne désigne rien |
| `resolve_task_check_id(checks, label)` | traduit un **libellé** en **id de point** | refuse : vide, inconnu (**liste les points présents**), porté par **deux** points (nomme les ids), tâche **sans aucun point** |
| `bounded_label_list(labels)` | cite au plus **5** libellés (« a, b, c … et 2 autres ») | message toujours court, jamais tronqué au hasard |
| `db_set_task_check_done_by_label(conn, task_id, label, done)` | **point d'écriture unique** | refuse la tâche inconnue et la tâche **terminée** (checklist figée, même règle que le retrait) ; rend `{ok, check_id, label, done, remaining, total}` |
| `forced_closure_needs_trace(pending, force, new_status)` | « y a-t-il vraiment clôture forcée ? » : `force` **et** des points restants **et** statut visé classé `done` | un `force` sur un statut qui ne termine rien ne demande **aucun** motif et n'écrit **aucune** trace |
| `check_forced_closure_reason(...)` + `forced_closure_reason_required_message()` | motif obligatoire | refus **avant toute écriture**, message disant quoi relancer (`force = true` **et** `reason`) et « Aucune écriture n'a été faite. » |
| `forced_closure_summary(task_id, title, pending, reason)` | la phrase lisible | « Clôture forcée de la tâche #12 « … » : 2 point(s) de checklist non cochés (« Tests passés », …) — motif : … » |
| `db_record_forced_closure(conn, task_id, pending, reason)` | la trace | une ligne `decisions` **rattachée à la tâche** (donc visible dans « Décisions récentes » et reprise comme **origine** par la traçabilité de livraison) |

### 2.2 Les deux voies de clôture, même contrat

`super_agent_update_task_status` **et** `super_agent_update_task` reçoivent deux
arguments **additifs** `force` / `reason` et suivent la **même** séquence :

1. lire le statut précédent ;
2. `guard_task_checklist(...)` — le **mode bloquant n'est jamais contourné** ;
3. lire les points restants ;
4. **`check_forced_closure_reason(...)`** ⇒ refus **avant** l'écriture ;
5. écrire ;
6. si `forced_closure_needs_trace(...)` ⇒ `db_record_forced_closure(...)`
   (**après** le succès, **fail-open**), **avant** `record_delivery_trace_if_enabled`
   (la trace forcée devient l'origine de la livraison).

### 2.3 Outils de l'Assistant (`src-tauri/extensions/pilot-assistant-tools.ts`)

- **`get_task_checklist`** (nouveau) → `super_agent_task_check_list` : sans lui, la
  coche par libellé serait aveugle (l'Assistant connaît les noms lus, pas les ids).
- **`set_task_check`** (nouveau) : `taskId`, `label`, `done` **optionnel** (omis =
  cocher, jamais « décocher par accident ») →
  `super_agent_task_check_set_done_by_label`. Les consignes disent : lire d'abord,
  ne jamais inventer un point, ne jamais changer le statut.
- **`update_task_status`** (étendu) : `force` + `reason`, avec la phrase qui dit que
  le motif est **obligatoire** pour une clôture forcée et qu'il est **conservé**.

Aucun de ces trois outils ne réimplémente une règle : ils transmettent.

### 2.4 L'écran ne force plus en silence (`super-agent-kanban.js` + `-view.js`)

`KANBAN_FORCED_CLOSURE_REASON` — motif **vrai par construction** (« clôture décidée
par l'utilisateur depuis le tableau de bord, sans cocher les points restants ») —
accompagne les **trois** forçages de l'écran : clôture en lot, changement de statut
seul, enregistrement de la fiche complète. Sans lui, le bouton « Terminer quand
même » aurait été **refusé** par le nouveau contrôle : c'est la régression que ce
point devait éviter.

---

## 3. Ce que l'Assistant peut faire maintenant — et ce qu'il ne peut pas

**Peut** : lire la checklist d'une tâche ; cocher / décocher un point **nommé**
(casse, accents, espaces de bord indifférents) ; terminer une tâche avec des points
restants **en donnant un motif**, lequel apparaît dans l'historique du projet ;
savoir pourquoi un refus a eu lieu (le message nomme les points existants).

**Ne peut pas** : ajouter ni retirer un point (aucun outil — le message « aucun
point » renvoie donc à la **fiche de la tâche** dans Pilot, pas à un outil
inexistant) ; cocher sur une tâche **terminée** (checklist figée) ; forcer la
clôture en mode **bloquant** ; clôturer sans motif ; toucher au statut par une
coche ; toucher une autre tâche ; supprimer quoi que ce soit.

---

## 4. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src-tauri/src/super_agent.rs` | +589 lignes : 8 fonctions pures, la commande `super_agent_task_check_set_done_by_label`, `force`/`reason` sur les deux voies de clôture, **10 tests** |
| `src-tauri/src/lib.rs` | enregistrement de la nouvelle commande |
| `src-tauri/extensions/pilot-assistant-tools.ts` | `get_task_checklist`, `set_task_check`, `update_task_status` étendu |
| `src/js/super-agent.js` | 3 cas du dispatcher (canal existant) |
| `src/js/super-agent-kanban.js` | `KANBAN_FORCED_CLOSURE_REASON` (source unique du motif de l'écran) |
| `src/js/super-agent-kanban-view.js` | motif sur les **trois** forçages |
| `src/js/checklist-case-nommee-et-cloture-forcee.test.js` | **verrou neuf (8 tests)** |
| `spec_super_agent.md` | bloc `<!-- HELP:super-agent-checklist -->` enrichi (2 sous-sections utilisateur) + section « Technique — cocher une case NOMMÉE et clôturer délibérément » |
| `help/handbook.md` | régénéré (`npm run build:handbook`, 48 blocs) |

Aucun test existant n'a été affaibli ni supprimé. Deux corrections ont été
nécessaires dans des tests **préexistants** de la même tranche :
`forced_closure_needs_trace` a reçu le statut visé (une première version
demandait un motif pour un `force` qui ne terminait rien — défaut trouvé par
`forced_closure_writes_no_trace_when_nothing_was_forced`), et deux attentes de
statut par défaut visaient `a_faire` alors que le défaut de la table est
`demande`.

---

## 5. Résultats exacts des tests (comptés, pas recopiés)

```
npx vitest run                                              → PASS (5647)  FAIL (0)
npx vitest run src/js/checklist-case-nommee-et-cloture-forcee.test.js
                                                            → PASS (8)     FAIL (0)
npx vitest run src/js/super-agent-checklist.test.js          → PASS (33)    FAIL (0)
cargo test --manifest-path src-tauri/Cargo.toml --lib       → 912 passed, 3 ignored, 0 failed
```

Les trois chiffres du front et du Rust sont **postérieurs** à tous les
changements, y compris la régénération du handbook.

### Preuve par mutation (les verrous échouent sur le code d'avant)

| Mutation appliquée | Résultat | Restauré |
|---|---|---|
| Retirer `check_forced_closure_reason(...)` de `super_agent_update_task_status` | le verrou JS échoue (« le motif doit être vérifié AVANT l'écriture ») | oui |
| Faire renvoyer le **premier** point quand aucun libellé ne correspond | `set_task_check_by_label_refuses_unknown_label_without_writing` échoue | oui |
| Neutraliser `check_forced_closure_reason` (retour `Ok` systématique) | `forced_closure_without_reason_is_refused_before_any_write` échoue | oui |

Après restauration, les trois suites repassent au vert (chiffres ci-dessus
relevés **après** restauration).

---

## 6. Commit

`feat(suivi): cocher un point de checklist par son nom et clôturer une tâche avec un motif tracé`
