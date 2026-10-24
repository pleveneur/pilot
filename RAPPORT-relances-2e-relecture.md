# Rapport — relances de l'assistant : 2ᵉ relecture (4 points)

> Mission : corriger les quatre points de la **2ᵉ relecture indépendante** de la
> correction des relances (`8e2ae1c`), **sans revenir** sur les quatre
> corrections déjà validées de ce commit. Livraison = dernière étape avant mise
> en ligne : aucun bump de version, aucun tag, aucune publication.

## État de départ

| # | Point | Gravité | Verdict sur `8e2ae1c` |
|---|---|---|---|
| 1 | Un message Telegram reçu onglet fermé est perdu à la réouverture | Modéré | corrigé |
| 2 | Un des vingt tests ne vérifie rien (découpage de source vide) | Faible | corrigé |
| 3 | Le lot de relances n'a aucune borne (ni nombre, ni longueur) | Faible | corrigé |
| 4 | Règle périmée dans le code et dans `tests/schedule-tests.md` | Faible (doc) | corrigé |

---

## 1. Message Telegram perdu quand l'onglet est fermé (modéré)

**Cause.** `startScheduleTicker()` remettait `ownerEngagedThisSession = false;`
à chaque ouverture de l'onglet 🧭. Or l'écoute Telegram tourne **sans** l'onglet :
message reçu onglet fermé → traité et engagement posé (`injectExternalMessageToSuperAgent`)
→ réouverture de l'onglet → engagement **oublié** → relances retenues et signal
« écrivez » alors que le propriétaire venait d'écrire.

**Correction.** La remise à zéro ne suit plus l'ouverture d'un onglet : elle est
la **valeur initiale** de la variable (`let ownerEngagedThisSession = false;`),
posée **une seule fois par exécution de Pilot**. Une *session d'assistant* est
donc **une exécution de Pilot** — la même unité que la mémoire de session côté
Rust (qui repart de zéro au redémarrage). Aucun second drapeau, aucun compteur
en base : la règle « un seul drapeau » de `8e2ae1c` est intacte.
`src/js/super-agent.js` : déclaration (commentaire de portée) + suppression de
la remise à zéro dans `startScheduleTicker()`, remplacée par un commentaire
explicite « ne pas remettre à zéro ici ».

**Portée du « une fois par session » (réconciliée).** La spec disait « une seule
fois par session » sans dire laquelle. Portée **réelle et conservée** : **une
fois par session de conversation, c'est-à-dire par ouverture de l'onglet 🧭**, et
c'est désormais écrit tel quel dans `spec_super_agent.md`. Pourquoi garder le
code et corriger la doc (et non l'inverse) : le signal de retenue est écrit
**dans la conversation**, laquelle est **recréée** à chaque ouverture d'onglet ;
l'annoncer une seule fois pour toute l'exécution de Pilot le rendrait invisible
dans la nouvelle conversation alors que des relances restent retenues. Les deux
portées sont donc distinctes et justifiées : engagement = exécution de Pilot
(état de décision, doit survivre à la fermeture d'onglet), signal = conversation
(affichage, doit être visible dans le fil courant).

**Verrou.** `src/js/relances-relecture.test.js` :
- « parcours complet : message Telegram reçu ONGLET FERMÉ → ouverture de l'onglet
  → la relance part » : marquage par le chemin Telegram, absence de toute remise
  à zéro dans le ticker (fragment découpé et **borné**), une seule occurrence de
  `ownerEngagedThisSession = false;` dans tout le fichier, puis
  `planDueReminderInjections({ ownerEngaged: true, autoCheckStartup: false })`
  → la relance est bien dans `toInject`, `waitingForOwner === 0`.
- `src/js/super-agent-schedule.test.js` : titre et assertions mis à jour (la
  remise à zéro suit le démarrage, plus l'ouverture d'un onglet).

## 2. Un test sur vingt ne vérifiait rien (faible)

**Cause.** Le découpage cherchait `"export async function send("` alors que la
fonction est **imbriquée** (`  async function send() {`) : `indexOf` → −1,
`slice` → chaîne vide, `not.toContain(…)` vrai **par construction**. Preuve
donnée par la relecture : remettre la pose du drapeau dans `send()` laissait
20/20 verts.

**Correction.** Helper unique `sliceSource(src, startAnchor, endAnchor, minLen)`
utilisé par **tous** les découpages de source du fichier (corps de `send`, tick,
ticker, corps Rust) : il **exige** que les deux ancres existent (`toBeGreaterThan(-1)`,
`toBeGreaterThan(start)`) et que le fragment atteigne une **taille minimale**
(`toBeGreaterThanOrEqual(minLen)`), avec un message nommant l'ancre fautive.
Ancres réelles : `"\n  async function send() {\n"` → `"\n  // ── Bouton « Analyser et
ranger mes données »"`, minimum 500 caractères. Deux assertions
« anti-découpage-vide » ajoutées là où le fragment était encore découpé à la
main (corps Rust `do_send_super_agent_prompt` > 500, définition de la table
`assistant_schedules` > 100).

**Preuve que le test mord** (neutralisation 2 ci-dessous) : avec le helper,
remettre la pose dans `send()` fait **échouer** le test ; avec l'ancien
découpage, la même neutralisation laissait **27/27 verts**.

## 3. Le lot de relances n'avait aucune borne (faible)

**Correction** — `src/js/super-agent-schedule.js`, deux bornes **et** une mise en
forme honnête :

| Borne | Constante | Effet |
|---|---|---|
| Nombre de relances par envoi | `REMINDER_BATCH_MAX_ITEMS = 8` | appliquée dans `planDueReminderInjections` : les relances en trop restent **dues** (`held`, jamais marquées), donc partent à la passe suivante — rien n'est perdu |
| Longueur du message | `REMINDER_BATCH_MAX_CHARS = 4000` | **miroir volontaire** de `MAX_INJECTED_MESSAGE_CHARS` (`src-tauri/src/super_agent.rs`), le plafond unique du reste des injections automatiques ; au-delà, troncature **annoncée** (nombre de caractères omis + où lire le texte intégral), l'avis comptant lui-même dans la taille (le message ne dépasse **jamais** 4000) |

Numérotation : les lignes suivantes d'un rappel multi-lignes sont **indentées
sous leur numéro** (`numberReminderLine`), sinon la suite du texte se confondait
avec les items suivants du lot.

**Verrous.** Deux tests : « le lot est BORNÉ en nombre … les relances en trop
restent dues, jamais marquées » (12 relances échues → 8 envoyées, 4 dans `held`
avec leurs ids exacts) et « le message du lot est BORNÉ en longueur, et la
troncature est DITE » (8 × 3000 caractères → `length ≤ 4000` + mention
`lot tronqué : N caractère(s)` ; un lot normal n'est jamais touché). Plus un
test de mise en forme (« un rappel multi-lignes est indenté sous son numéro »).

## 4. Règle périmée dans le code et dans les notes de test (doc)

Remplacée partout par la règle réellement appliquée : **un seul ENVOI par passe
(un seul tour de l'assistant)**, un envoi pouvant porter **plusieurs** relances
regroupées.

- `src-tauri/src/super_agent.rs` (bloc de garde-fous au-dessus de
  `SCHEDULE_MIN_EVERY_SECS`, ~l.1098) : « 1 exécution max par planification et
  par tick » → « UN SEUL ENVOI par passe de tick … un même envoi peut porter
  PLUSIEURS relances regroupées », en conservant la précision vraie côté Rust
  (`schedule_due` : au plus une ligne par planification et par appel,
  `last_run_at` marqué à l'émission, issue #135).
- `tests/schedule-tests.md` : garde-fou 3, tableau « Où se trouve la logique » et
  ligne du test `schedule_due_marks_and_returns_at_most_once_per_tick` réécrits
  (la limite d'envoi par passe est côté ticker, pas côté Rust).

**Verrou.** Test « plus aucune règle périmée » : l'ancienne formulation ne peut
plus apparaître **comme règle appliquée** (seule une citation introduite par
« et non « … » » est tolérée, pour expliquer le remplacement) dans
`super_agent.rs` **et** `tests/schedule-tests.md` ; la nouvelle formulation y est
exigée.

---

## Neutralisations (preuve que chaque verrou mord)

Chaque neutralisation a été appliquée, mesurée, puis **restaurée** (restauration
vérifiée : 27/27 et 57/57 verts après remise en état).

| # | Neutralisation appliquée | Résultat observé | Restauré |
|---|---|---|---|
| 1 | Remise à zéro remise dans `startScheduleTicker()` (`ownerEngagedThisSession = false;`) | **2 échecs** / 57 : « le ticker ne touche plus au drapeau » (`expected 'function startScheduleTicker() …' not to contain 'ownerEngagedThisSession'`) et le parcours complet (`expected 2 to be 1`) | oui |
| 2a | Pose du drapeau remise dans `send()` (`ownerEngagedThisSession = true;` en 1ʳᵉ ligne) | **1 échec** / 27 : « ne pose plus l'engagement dans send() » — le verrou mord | oui |
| 2b | **Ancien** découpage de `send()` rétabli (celui de `8e2ae1c`), neutralisation 2a **toujours en place** | **27/27 verts** — reproduit exactement le défaut signalé (assertion vraie par construction) ; c'est la preuve que le nouveau découpage est indispensable | oui (fichier de test restauré) |
| 3a | Plafond de **nombre** retiré (`laggards.map(...)`, `list` non tronquée) | **1 échec** : `expected [ { id: 1, … }, …(11) ] to have a length of 8 but got 12` | oui |
| 3b | Plafond de **longueur** retiré (`capReminderMessage` neutralisé) | **1 échec** : `expected 24320 to be less than or equal to 4000` | oui |
| 4 | Règle périmée réintroduite dans `super_agent.rs` **et** `1 fire/tick` dans `tests/schedule-tests.md` | **1 échec** : `super_agent.rs : règle périmée posée comme appliquée → « 1 exécution max par planification et par tick »` | oui |

## Chiffres réels des suites (après corrections, worktree final)

| Suite | Commande | Résultat |
|---|---|---|
| Frontend (Vitest) | `npm test` | **161 fichiers, 2787 tests passés, 0 échec** (2780 avant : +7 tests) |
| Rust (desktop) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **722 passés, 1 ignoré, 0 échec** (10,71 s) |

## Documentation

- `spec_super_agent.md` : lot borné (règle 4 de la passe d'envoi), portée du
  signal de retenue (« une fois par session de conversation, c'est-à-dire par
  ouverture de l'onglet », + pourquoi), portée du drapeau d'engagement (« une
  exécution de Pilot », + le parcours Telegram verrouillé).
- `help/handbook.md` régénéré **dans le même commit** (`npm run build:handbook`,
  45 blocs, 257 264 octets).
- `tests/schedule-tests.md` : règles 1 envoi/passe, garde-fou 3, tableau et test.
- `src-tauri/src/super_agent.rs` : commentaire de garde-fous.

## Hors périmètre (respecté)

Aucune des quatre corrections validées de `8e2ae1c` n'a été revue ou modifiée ;
aucun second drapeau d'engagement, aucun compteur en base ; aucun bump de
version, tag, publication, installation ni lancement de Pilot ; aucun autre
`RAPPORT-*.md` touché ; aucun outil de listage de sessions d'agents appelé.
