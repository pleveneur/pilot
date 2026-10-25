# RAPPORT — Étape 4b : présence automatique et restitution ordonnée (poste)

> Chantier « mode réseau multi-postes » (GDS partagé). **Étape 4b uniquement.**
> Les étapes 1→4a sont closes et n'ont été ni relues ni rejouées
> (`35bee91`, `5b9e2b4`, `f8e110d`, `866ede0`). `gds-core/*` n'a pas été ouvert en
> écriture, aucun fichier JS/CSS/interface/workflow/migration/spec/plan touché.

## 0. Vérification de la tâche reçue

La consigne décrit bien **l'étape 4b** : présence automatique, séquence de
restitution ordonnée, écritures refusées hors portage. Elle ne parle **ni** des
routes HTTP du serveur (étape 3), **ni** de l'identifiant de machine (étape 4a),
**ni** du bug de file d'attente. **Aucun décalage de file.**

## 1. Premier constat (état au démarrage)

- `src-tauri/src/gds_handover.rs` (4a) fournissait le client des 5 routes mais
  **ne déclenchait rien** : `heartbeat`/`force` sous `#[allow(dead_code)]`,
  `give_back` faisait le **seul** appel `return` sans publier ni pousser avant, et
  **aucun** blocage des écritures hors portage n'existait.
- Compteurs desktop **avant** : **735 passed, 1 ignored** (conforme à la référence).

## 2. Ce qui est livré

### 2.1 Présence automatique (un seul appel par cycle, jamais hors portage)

| Élément | Emplacement |
|---|---|
| Cadence 3 min (plan §3 réglage 1) | `src-tauri/src/gds_handover.rs:404` (`HEARTBEAT_INTERVAL_SECS = 180`) |
| Repère local « ce poste tient ce projet » (clé `handover.holder.<projet>`) | `gds_handover.rs:414`, `:423`, `:430`, `:441`, `:502` |
| Décision pure : quels projets reçoivent un battement (`presence_targets`) | `gds_handover.rs:557` |
| Classement d'une réponse : tenu / perdu / panne (`classify_presence`) | `gds_handover.rs:580` |
| Cycle générique (une promesse par projet tenu, la panne n'arrête pas la boucle) | `gds_handover.rs:590` |
| Cycle réel (une seule route appelée par projet tenu) | `gds_handover.rs:621` |
| Effets sur les repères (garde / efface si perdu / signale la panne) | `gds_handover.rs:658` |
| Tâche de fond `start_gds_handover_presence_monitor` | `gds_handover.rs:701`, branchée `src-tauri/src/lib.rs:3320` |
| Repères rangés dans la table de synchro **existante** | `src-tauri/src/gds_sync.rs:447` / `:453` (`gds_sync_state`, mêmes `get_state`/`set_state` que le watermark) |

Garanties :
- **aucun appel** si le repère est absent, vide ou illisible, ou s'il désigne un
  autre poste (`presence_targets`), donc **jamais d'appel réseau pour un projet
  que ce poste ne tient pas** ;
- **un seul appel par projet tenu et par cycle** (3 min), aucune boucle serrée ;
- la prise en main (`take`) mémorise le repère (`gds_handover.rs:282-300`) et un
  refus l'**efface** : la présence s'arrête proprement ; la restitution réussie
  l'efface aussi (`gds_handover.rs:920`) ;
- **échec réseau** : conservé dans le rapport du cycle **et** dans le repère
  `handover.presence.last_error`, réessayé au cycle suivant, **aucun plantage**
  (le cycle continue avec les autres projets) ;
- **refus métier** (409/403/404/400) : la présence s'arrête pour ce projet au lieu
  de réessayer indéfiniment (pas de boucle).

### 2.2 Restitution ordonnée, sans jamais annoncer un succès partiel

Ordre imposé : **code → avancement → `return`** (`gds_handover.rs:738`, `:806`).

| Étape | Emplacement |
|---|---|
| Publier le code (`git add` + `git commit` + `git push` sur le remote `gds`) | `gds_handover.rs:842` |
| Pousser l'avancement (`gds_sync::force_push_tracking`, voie compte GDS ou voie historique) | `gds_handover.rs:854` |
| Rendre le projet (`give_back_with`, refus serveur = échec) | `gds_handover.rs:865-925` |
| Exécution ordonnée qui **s'arrête à la première étape en échec** | `gds_handover.rs:821` |
| Commande `gds_handover_return` = la séquence complète | `gds_handover.rs:1150` |

Garanties :
- une étape échouée **n'est pas marquée faite** ; `returned` reste faux, **aucune
  étape suivante n'est tentée** → on ne libère jamais un projet dont le code n'est
  pas publié ;
- l'avancement réel est **toujours** persisté (repère `handover.restitution.<projet>`,
  `gds_handover.rs:732`) : l'état est **lisible et rejouable**, la reprise repart
  de l'étape en échec (`steps_to_run`) ;
- en cas d'échec, le poste **reste porteur** (repère de présence conservé) et le
  message nomme l'étape en clair (« publication du code », « poussée de
  l'avancement », « restitution au serveur »).

### 2.3 Écritures refusées hors portage

| Élément | Emplacement |
|---|---|
| Verdict pur (aucun porteur / autre poste / expiré / porteur = moi) | `gds_handover.rs:954` |
| Décision pure « faut-il prendre la main avant d'écrire » | `gds_handover.rs:984` |
| Message unique et lisible du cas « à prendre en main » | `gds_handover.rs:1008` |
| Garde commune `gate(project, claim)` : écriture réelle ou simple **lecture** | `gds_handover.rs:1014` |
| Garde d'écriture `write_gate` (état serveur + prise de main unique) | `gds_handover.rs:1094` |
| Verdict **en lecture seule** `peek_write_gate` (aucune écriture) | `gds_handover.rs:1101` |
| Garde réutilisable par les commandes d'écriture `ensure_write_allowed` | `gds_handover.rs:1107` |
| **Branchement sur l'écriture existante** `gds_force_push_suivi` | `src-tauri/src/gds_sync.rs:1120` |
| Commande de lecture `gds_handover_can_write` (pour l'interface, étape 5) | `gds_handover.rs:1169`, enregistrée `lib.rs:3901` |
| Commande de diagnostic `gds_handover_presence_now` (un cycle immédiat) | `gds_handover.rs:1183`, enregistrée `lib.rs:3902` |

Garanties : un projet tenu par un **autre** poste est refusé avec un message
lisible qui dit **qui** le tient et **jusqu'à quand** ; une prise en main
**expirée** n'autorise pas l'écriture ; une **panne** de vérification refuse
l'écriture (on n'écrit jamais sans avoir pu vérifier) ; **jamais de panique**.

La même règle sert deux usages distincts, **une seule décision** (`needs_claim`,
`write_verdict`) :
- `write_gate` / `ensure_write_allowed` — chemin qui **écrit** : prend la main
  une fois si nécessaire, puis autorise ou refuse ;
- `peek_write_gate` / commande `gds_handover_can_write` — chemin qui **lit**
  seulement : rend `{ allowed:true }`, `{ allowed:false, claim_required:true }`
  (message « prenez le projet en main pour publier ») ou un refus lisible, et
  **n'appelle jamais** la route de prise en main.

## 3. Décision assumée (à relire) — prise de main au premier écrit

Le brief dit « si le poste n'est pas porteur, toute écriture est refusée ». Pris
au pied de la lettre, cela refusait aussi le cas **« aucun porteur »**, or :
la prise en main automatique à l'ouverture d'un projet appartient à l'étape 4
(`src-tauri/src/gds_client.rs:177`, **hors périmètre autorisé**) et le bouton
« Prendre le projet » est l'étape 5. Un utilisateur solo se serait donc retrouvé
**sans aucun recours**, sur une fonctionnalité existante (« forcer la publication
du suivi ») → régression interdite par le quality-gate.

Choix retenu (`needs_claim`, `gds_handover.rs:984`, `gate`, `:1014`) :
- projet **libre**, ou prise en main **de ce poste** expirée → le poste **prend la
  main une seule fois** (`take`, idempotent, il ne vole rien) puis écrit : aucune
  écriture ne se fait « hors portage » ;
- projet tenu par un **autre** poste → **aucune** prise de main, **refus lisible** ;
- une course perdue (409 au `take`) → refus lisible, jamais un écrasement.

À trancher à l'étape 5 : déplacer cette prise de main à l'**ouverture du projet**
(plan §6 b) rendra ce chemin résiduel. `gds_sync_tracking` (pont automatique,
mode déconnecté) n'est **pas** gardé : il fonctionne sans serveur joignable.

## 4. Incertitudes / points à confirmer

1. **Publication du code = commit automatique** (`git add -A` + commit). Le plan
   dit « publier le code (commit + push) » ; j'ai suivi, mais cela committe tout
   l'arbre de travail au moment de la restitution — à valider côté produit.
2. **Branche poussée** : la branche courante (`git_current_branch`). Aucune
   convention de branche par poste n'existe ; non inventée.
3. **Garde posée sur `gds_force_push_suivi` seulement** (l'écriture explicite).
   Les routes d'écriture du **serveur** (§6 d) restent l'autorité finale : la
   garde côté poste est un confort, pas une sécurité.
4. **Repères locaux** : une seule table (`gds_sync_state`), pas un second journal
   — mais ces clés cohabitent avec le watermark ; un `gds_sync_state` vidé par
   l'utilisateur fait simplement repartir la présence de zéro (aucune corruption).
5. **Cadence 180 s** codée en dur (constante) : le plan ne prévoit pas de réglage
   utilisateur ; non ajouté.
6. **Restitution déjà aboutie** (`returned=1`) : un nouveau geste volontaire la
   **rejoue de zéro** (code → avancement → `return`) — honnête si le projet a été
   repris entre-temps ; si ce poste ne le tient plus, le serveur refuse et le
   message le dit (aucun succès inventé).

## 5. Tests

- Desktop, **avant** : `cargo test --manifest-path src-tauri/Cargo.toml --lib` →
  **735 passed, 1 ignored**.
- Desktop, **après** : **750 passed, 1 ignored** (1 suite, 10.61 s) →
  **+15 tests, 0 échec, aucun test ignoré ajouté** ; l'écart de +15 correspond
  exactement aux tests ajoutés (§5.2). **Aucun autre écart.**
- Frontend (non modifié) : `npm test` → **170 fichiers, 2932 tests passed**,
  aucune régression.
- `cargo check --lib` : aucun nouvel avertissement rattaché aux fichiers
  modifiés (le seul visible, `gds_sync.rs:356 get_pg_id` utilisé seulement par
  les tests, **existait déjà à `HEAD`** ; `held_by_this_poste`, écrite puis
  rendue inutile, a été retirée — pas de `#[allow]` de complaisance).

### 5.1 Tests sans serveur ni base

Tous les tests ajoutés sont **purs** ou **sans réseau** (aucun serveur, aucune
base PostgreSQL) : les cycles et la séquence prennent leur envoi/exécution en
paramètre.

### 5.2 Tests ajoutés (tous dans `gds_handover.rs`)

| Test | Ligne | Ce qu'il prouve |
|---|---|---|
| `presence_marker_roundtrips_and_is_never_guessed` | 1443 | repère relu à l'identique ; absent/vide/illisible ⇒ **aucune** présence |
| `presence_cadence_is_three_minutes` | 1465 | 180 s (plan §3) |
| `presence_is_never_sent_for_a_project_this_poste_does_not_hold` | 1473 | **0 appel** pour projets d'un autre poste / sans repère |
| `presence_sends_exactly_one_call_per_held_project` | 1492 | **1 appel par projet tenu**, échéance relue, autres écartés |
| `a_network_failure_does_not_break_the_presence_cycle` | 1522 | panne conservée, cycle poursuivi, rien de perdu |
| `a_409_refusal_stops_the_presence_instead_of_retrying_forever` | 1547 | 409 = perdu (arrêt propre) ; 503 = panne (réessai) |
| `restitution_order_is_code_then_tracking_then_return` | 1568 | ordre imposé |
| `restitution_progress_roundtrips_and_resumes_without_skipping` | 1581 | reprise sans saut d'étape ; avancement illisible ⇒ tout rejoué |
| `restitution_runs_code_then_tracking_then_return` | 1601 | ordre **d'exécution** réel |
| `a_failed_publication_never_gives_the_project_back` | 1630 | échec du code ⇒ **pas** de `return`, étape non marquée faite, message lisible |
| `restitution_resumes_at_the_step_that_failed` | 1664 | reprise à l'étape en échec |
| `writing_outside_the_portage_is_refused_with_a_readable_message` | 1731 | autre poste / aucun porteur / expiré ⇒ refus **lisible** |
| `the_claim_required_message_is_actionable_and_not_technical` | 1777 | message « prendre le projet en main » sans jargon |
| `the_holder_may_write_even_with_a_raw_state_object` | 1785 | porteur légitime autorisé (casse ignorée) |
| `a_free_or_expired_project_is_claimed_once_before_writing` | 1797 | prise de main sur projet libre/expiré, **jamais** sur celui d'un autre |

## 6. Périmètre respecté

Fichiers modifiés : `src-tauri/src/gds_handover.rs`, `src-tauri/src/gds_sync.rs`,
`src-tauri/src/lib.rs` (+ ce rapport). `gds_service.rs` et `gds.rs` **non**
modifiés (leur existant a suffi : `post_reply`/`get_reply` avec statut conservé,
`optional_pool`, `poste_id`). Aucun `gds-core/*`, aucun JS/CSS, aucune interface,
aucun workflow, migration, spec ni plan. Aucune suppression de fichier, aucun
`push`, aucun tag, aucun changement de version, aucun `--amend`.

## 7. Commandes à lancer

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib   # 750 passed, 1 ignored
npm test                                                # 170 fichiers, 2932 tests
```

VERDICT : étape 4b livrée et vérifiée sans serveur ni base — présence automatique (1 appel/cycle de 3 min, jamais pour un projet non tenu, arrêt propre et échec signalé sans boucle), restitution strictement ordonnée code → avancement → `return` avec état rejouable et succès jamais annoncé à moitié, écritures hors portage refusées par un message lisible (prise de main unique sur projet libre pour ne pas bloquer l'utilisateur solo ; le chemin de lecture ne prend jamais la main) ; 750 tests passés / 1 ignoré (735 avant, +15 ajoutés, 0 échec), aucun écart.
