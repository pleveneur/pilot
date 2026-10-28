# Rapport — le compte rendu de fin de mission devient VISIBLE

> **Mission** : appliquer les correctifs C1 (obligatoire), C2 (obligatoire) et C3
> (optionnel) du diagnostic `RAPPORT-diag-restitution-perdue.md`.
> **Rapport écrit d'abord, complété ensuite** (trace conservée en cas d'arrêt
> brutal, conformément à la consigne).
> **Statut** : EN COURS — les sections 5 (preuve que les tests mordent), 6
> (comptes de tests avant/après) et 7 (documentation) sont renseignées en fin de
> mission.

---

## 0. Ce que le diagnostic avait établi (rappel, non réanalysé)

Le compte rendu de fin de mission n'est pas perdu : il est écrit en base
durable, remis à l'Assistant et consommé. Ce qui manque est la **trace
visible** : aucun code n'affiche le compte rendu remis, la seule surface étant
le texte libre du modèle — qu'un tour d'outils peut terminer sans un mot.
L'accusé `delivered=1` ne prouve, lui, qu'une **écriture sur stdin**, pas une
lecture par le destinataire.

---

## 1. C1 — la bulle de reçu dans la conversation (obligatoire, appliqué)

### 1.1 Un point du diagnostic était périmé, et il fallait trancher

Le diagnostic proposait de réutiliser `appendSystemMessage`
(`src/js/super-agent.js:7524`) comme surface d'affichage. **Vérification faite
sur le disque : ce n'est plus la conversation.** Depuis la tâche #139, un
message « système » n'est plus écrit dans la conversation : `appendSystemMessage`
(`super-agent.js:2425`) ne fait plus qu'alimenter le **panneau des événements**
du suivi du travail (haut droite, `pushSuperAgentSystemEvent`, `:2528`), avec
une **ligne de texte** (`label.textContent`) — ni texte repliable, ni contenu de
rapport.

**Décision (tranchée, faute d'arbitrage à demander)** : la bulle est donc
ajoutée à la **conversation** de l'Assistant (`messagesEl`, la même cible que
les réponses : `super-agent.js:2751-2754`), puisque la consigne est explicite
(« une BULLE VISIBLE apparaît dans la conversation de l'assistant », et « la
bulle de compte rendu est du CONTENU dans la conversation »). Le mécanisme
d'affichage réutilisé est celui des messages de la conversation
(`.agent-message` / `.agent-message-system`), pas un second système inventé.
`warnInjectionFailure` reste **inchangé** : il continue d'alerter le panneau des
événements en cas de `status === "error"`.

### 1.2 Ce qui a été ajouté

**Nouveau module pur** `src/js/super-agent-receipt.js` (aucune dépendance
Tauri/DOM, testable en Node) :

| Fonction | Rôle |
|---|---|
| `parseReportMission(text)` | lit l'identité de mission en tête du compte rendu (`[mission #3 · agents : concepteur-ui]`, et l'ancienne variante `—`). Rend `{id: null, agentIds: []}` si aucune identité : rien n'est inventé. |
| `formatReportSize(chars)` | `2 624 caractères` (taille réelle, groupée). |
| `receiptStatusLabel(status, detail)` | `livré` / `mis en attente (remis dès que l'assistant est libre)` / `NON remis — sera réessayé` / `statut illisible`. |
| `shouldShowReportReceipt(category)` | faux pour `telegram` : le message du propriétaire n'est pas un compte rendu d'agent. |
| `buildReportReceipt({...})` | construit le reçu : titre (numéro de mission + agents), ligne d'info (projet, taille, statut), texte **replié** borné à 1 200 caractères, troncature annoncée. |
| `deliverReportReceipt(entry, res, {summary, projectName, append})` | LE point d'appel : décide (catégorie) puis **appelle l'affichage** avec le reçu. Testable avec un `append` espion. |

**Branchement dans `sendSuperAgentReport`** (`src/js/super-agent.js`) : l'appel
`deliverReportReceipt(...)` est posé **après** `invoke("inject_session_summary")`,
**dans tous les cas** (`delivered`, `queued`, `error`), et **avant** `return res`.
Aucune condition ne l'entoure : c'est l'invariant « un compte rendu remis laisse
toujours une trace visible ».

**Affichage** : `appendReportReceipt(messagesEl, receipt)` construit
`.agent-message.agent-message-system.agent-message-receipt` — titre, ligne
d'info, puis un `<details>` (natif, accessible) replié contenant le texte reçu
en `<pre>`. Si la conversation n'est pas encore montée (onglet 🧭 jamais ouvert),
le reçu est **mis en attente en mémoire** (`pendingReportReceipts`) et affiché
dès la création de la conversation (`flushPendingReportReceipts`, appelé là où
`superWarnMessagesEl` est posé) : la bulle apparaît au moment de la remise, pas
à la fin d'un rendu.

**Aucun repère d'onglet** n'a été ajouté : ni pastille, ni point, ni changement
de couleur (refus ferme du propriétaire, respecté).

---

## 2. C2 — l'accusé de remise dit la vérité (obligatoire, appliqué)

### 2.1 Le mécanisme existant réutilisé

Le diagnostic indiquait `send_superagent_sync_timeout`
(`src-tauri/src/agent_service.rs:2784`), déjà présent. Vérifié sur le disque :
`send_sync_timeout` (`:1989`) enregistre la commande, **relâche le verrou** du
registre de sessions, puis attend la réponse corrélée par `id`
(`rpc_manager::wait_response`). Le thread de lecture route bien les
`{"type":"response"}` vers l'attente (`rpc_manager.rs:373-383`).

Côté moteur, vérifié dans le `pi` installé
(`dist/modes/rpc/rpc-mode.js:298-313`) : un `prompt` reçoit une réponse
**immédiate** — `{type:"response", command:"prompt", success:true,
data:{disposition:"started"|"queued"|"handled"}}` après le préflight,
`{success:false, error:…}` en cas de refus (agent déjà en cours de génération,
compaction, modèle/clé absents : `dist/core/agent-session.js:1649-1680`).

> **Écart avec le diagnostic, vérifié sur le disque** : le diagnostic annonçait
> le champ d'accusé sous le nom `ok`. Le lecteur lit `success` (nom réel du
> protocole RPC, `rpc-mode.js:31-38`) **et** `ok` par tolérance de backend. Un
> seul `true` explicite vaut remise.

### 2.2 Ce qui a été changé

| Élément | Détail |
|---|---|
| `injection_ack(&Value) -> Result<String, String>` | fonction **pure** : `success`/`ok` à `true` → `Ok(« accusé : <disposition> »)` ; à `false` → `Err(raison du moteur, remontée telle quelle)` ; champ **absent** ou non booléen → `Err(« aucun accusé de remise lisible »)`. Rien n'est supposé livré sans un `true` explicite. |
| `send_injection_with_ack(...)` | envoie le prompt **avec attente de l'accusé** (`send_superagent_sync_timeout`, délai `INJECTION_ACK_TIMEOUT_SECS = 8`). Utilisé par les **deux** chemins de remise (immédiate et rejeu). |
| `deliver_one_summary(...)` | **réutilisée telle quelle** — aucune seconde fonction de décision n'a été créée : c'est déjà elle qui décide du marquage. Seule change la SOURCE DE VÉRITÉ du `send` qu'on lui passe (envoi avec accusé). `delivered=1` **seulement** sur accusé positif ; sinon la ligne reste `delivered=0`, `injection_logs` écrit `error`, le statut rendu est `"error"` (l'alerte visible existante se déclenche) et le rejeu redélivre plus tard. |
| compteur d'essais (`note_ack_failure` / `ack_attempts_exhausted`) | un moteur qui refuse **systématiquement** (modèle ou clé absents) n'est plus harcelé à chaque cycle : au-delà de `MAX_INJECTION_ACK_ATTEMPTS = 5` la ligne n'est plus présentée. Elle n'est **jamais** marquée livrée pour autant ; un accusé reçu remet le compteur à zéro. |
| `inject_session_summary` | passe de `send_superagent` (écriture seule) à la remise **avec accusé** ; et devient `async` + `spawn_blocking` pour ne **pas** geler le thread principal pendant l'attente (même raison que `get_super_agent_state`, `super_agent.rs:1818-1830`). |
| rejeu (`replay_pending_superagent_summaries_inner`) | passe lui aussi l'accusé : un rejeu refusé laisse la ligne en attente au lieu de la marquer « rejouée/livrée ». |

---

## 3. C3 — mise en file plutôt que refus (optionnel, appliqué)

`Cmd["streamingBehavior"] = "followUp"` est posé **uniquement** dans le chemin
d'injection (`send_injection_with_ack`), jamais dans
`prompt_command_with_resume` (le test `prompt_command_with_resume_is_additive_only`
verrouille la forme de la commande simple : il reste intact).

Pourquoi c'est sûr : `pi` ne consulte `streamingBehavior` **que** s'il est déjà
en train de générer (`agent-session.js:1662-1673`) ; sinon le champ est ignoré.
Dans cette fenêtre précise, au lieu de **refuser** (`ok:false`), pi **met en
file** et répond `ok:true, disposition:"queued"` — donc le compte rendu est
accepté puis traité, au lieu d'être refusé puis resservi. Aucun autre
comportement ne change (même message, même session, même commande).

---

## 4. Ce qui ne devait pas bouger et n'a pas bougé

- **Comptes rendus eux-mêmes** : contenu, format et longueur **inchangés**
  (`buildRunAgentsSummary`, `annotateMissionReport`, `build_capped_injection_message`
  et le plafond `MAX_INJECTED_MESSAGE_CHARS = 4000` non touchés). La bulle
  n'affiche qu'une **lecture** du texte déjà remis.
- **Assistant** : prompt, base de suivi (`super-agent.db` : schéma intact), règles
  de curation, porte `superAgentReportGate`, file des missions, RÈGLE 4 — aucun
  changement de logique.
- **Interface** : colonne de gauche, bande du haut, logo, onglets, pastilles,
  badges — **aucune** modification (une seule règle CSS ajoutée, pour la bulle
  elle-même).
- **Aucun réglage, aucun bouton, aucune option à l'écran** ajoutés.
- Le texte `injection_logs`/`session_summaries` reste la source de vérité : le
  rejeu et l'idempotence existants sont conservés.

---

## 5. Preuve que les tests mordent

Deux verrous, un par défaut, chacun **éprouvé par casse volontaire puis
restauration** (le code a été remis à l'identique après chaque essai).

### 5.1 « La bulle ne peut pas disparaître » — `src/js/super-agent-receipt.test.js`

11 tests. Les deux qui portent l'invariant :

| Test | Ce qu'il exige |
|---|---|
| `produit une bulle pour LES TROIS statuts et la confie toujours à l'affichage` | pour `delivered`, `queued` **et** `error`, un reçu est produit **et** l'affichage est appelé **une fois** ; le titre nomme la mission et les agents ; la ligne d'état dit la vérité. Si l'appel disparaît, ce test échoue. |
| `branche la bulle dans la conversation de l'Assistant, pas dans un repère d'onglet` | l'appel du reçu existe dans `sendSuperAgentReport`, **après** `invoke("inject_session_summary")`, **sans condition** (suivi du `return res;` au même niveau) ; `appendReportReceipt` pose la classe `.agent-message…-receipt`, **ajoute** l'élément à la conversation (`messagesEl.appendChild`), le replie (`details`) et affiche `receipt.shown` ; **aucun** `badge`/`pastille` dans le chemin ; la catégorie `telegram` est filtrée. |

Casse éprouvée (trois variantes, chacune restaurée) :

1. suppression du bloc `deliverReportReceipt(entry, res, {…})` → **ÉCHEC** (`SourceSliceError : ancre de début absente`) ;
2. suppression de `messagesEl.appendChild(el)` (bulle construite mais jamais ajoutée) → **ÉCHEC** (`to contain 'messagesEl.appendChild(el)'`) ;
3. remplacement de `send_injection_with_ack` par un échec sec dans `inject_session_summary` → **ÉCHEC** du verrou C2 ci-dessous.

### 5.2 « Un compte rendu non accusé n'est pas livré » — `src-tauri/src/super_agent.rs`

| Test | Ce qu'il exige |
|---|---|
| `injection_ack_reads_only_an_explicit_engine_answer` | `success:true` → `Ok` avec la disposition ; `success:false` → `Err` **contenant la raison du moteur** ; `{}`, réponse sans verdict, `success:"yes"` → **`Err`** (une écriture dans le tuyau n'est pas une lecture). |
| `unacknowledged_report_is_not_delivered_and_is_retried` | sur **refus** du moteur : `deliver_one_summary` rend `false`, la ligne reste `delivered=0` et **reste en file** ; sur **absence d'accusé** (délai) : même verdict ; sur accusé positif **ensuite** : `delivered=1` une seule fois et file vidée. |
| `repeated_refusals_stop_after_the_cap_without_claiming_delivery` | le compteur d'essais monte, le plafond coupe le harcèlement, et un accusé reçu le remet à zéro — sans jamais conclure à une remise. |

Casse éprouvée : `injection_ack` rendu permissif (`Some(_) => Ok(…)`, c'est-à-dire
le comportement d'avant) → **ÉCHEC des deux premiers tests** (`left: "livré"`,
`right: "accusé : started"` ; puis « un refus du moteur ne doit pas compter
comme une remise »). Restauration → `cargo test --lib` : 778 passés.

---

## 6. Comptes de tests avant / après (recomptés sur le disque)

| Suite | Avant | Après | Écart |
|---|---|---|---|
| Frontend (`npx vitest run`) | **185 fichiers / 3 226 tests**, 0 échec | **186 fichiers / 3 237 tests**, 0 échec | +1 fichier, **+11 tests** (le fichier de verrou) |
| Rust (`cargo test --manifest-path src-tauri/Cargo.toml --lib`) | **775 passés**, 0 échec, 1 ignoré | **778 passés**, 0 échec, 1 ignoré | **+3 tests** |

Aucun test existant n'a été modifié, renommé ni supprimé. Aucun plafond n'a été
desserré : l'inventaire `src/js/source-slice.test.js` (qui interdit tout
découpage de source non protégé dans les tests) reste vert — les découpages du
nouveau test passent par `sliceSource`/`sliceFrom`, donc une ancre qui change
fait **échouer** le test au lieu de le rendre vrai par construction.

---

## 7. Documentation mise à jour

| Fichier | Modification |
|---|---|
| `spec_super_agent.md` | § « Compte rendu de fin de mission : trace VISIBLE » (bulle) + § « Remise : l'accusé du moteur fait foi » (C2) + mention C3 (`streamingBehavior: followUp` dans le seul chemin d'injection). |
| `AGENTS.md` (arborescence) | `src/js/super-agent-receipt.js` décrit (reçu visible : source unique du format, du statut et de la décision d'afficher) ; accusé de remise mentionné côté `super_agent.rs`. |
| `RAPPORT-diag-restitution-perdue.md` | **non modifié** : pièce de diagnostic, conservée comme référence. |
| `help/handbook.md` | **non modifié** : aucune commande, aucun réglage, aucun geste utilisateur nouveau (la bulle est du contenu, pas une option). |
| `README.md` | **non modifié** : rien de nouveau à faire côté utilisateur. |

---

## 8. Écarts assumés avec le libellé du diagnostic

Deux, tous deux vérifiés sur le disque et expliqués ci-dessus :

1. le champ d'accusé réel du protocole RPC est `success` (le diagnostic disait
   `ok`) — les deux sont lus, un seul `true` explicite vaut remise ;
2. la décision de remise **réutilise** `deliver_one_summary` au lieu d'ajouter
   une seconde fonction `deliver_summary_report` : une seule décision de
   marquage, pas deux mécanismes.

### Limite connue, écrite noir sur blanc

Si l'accusé se perd alors que le moteur a **effectivement** pris le compte rendu
(cas étroit : la réponse RPC est arrivée après le délai de 8 s), la ligne reste
non livrée et le rejeu la présentera une seconde fois. C'est le prix du choix
« aucun mensonge » : on préfère un doublon possible à un compte rendu perdu en
silence. Le plafond de 5 essais borne le phénomène, et la seconde remise porte la
même étiquette de mission (RÈGLE 4), donc elle reste identifiable.
