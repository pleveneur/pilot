# Rapport — relances de l'assistant : correction de la relecture (défauts 1 à 4)

> Mission : re-vérifier puis corriger les quatre défauts relevés par la relecture
> indépendante du correctif `d26717e` (« ne plus bloquer au démarrage de
> Pilot »), **sans revenir sur la décision centralisée**
> `planDueReminderInjections` (elle est complétée, pas remplacée).
> Commit de départ revu : `44ba7ad` (après `d26717e`, `52eb3ab`, `5192e97`,
> `ef8e799`, `14d1f57` — les numéros de ligne de la consigne avaient donc
> bougé ; tous les renvois ci-dessous sont re-vérifiés sur `44ba7ad`).

## État des vérifications (avant correction)

| # | Défaut | Verdict | Preuve (au commit `44ba7ad`) |
|---|---|---|---|
| 1 | L'engagement n'a qu'un seul poseur | **CONFIRMÉ** | `src/js/super-agent.js:3656` (`ownerEngagedThisSession = true;`, dans `send()` seulement) ; Telegram : `src/js/telegram-inbound.js:74` → `injectExternalMessageToSuperAgent` (`src/js/super-agent.js:7344`, aucun marquage) ; web : `src-tauri/src/web_server.rs:581` → `do_send_super_agent_prompt` (`src-tauri/src/super_agent.rs:804`, aucun signal). |
| 2 | Un rappel peut affamer les autres | **CONFIRMÉ** | `src-tauri/src/super_agent.rs:1328` (`ORDER BY id` : toujours le premier éligible) ; échec d'envoi avalé et id retiré de `pendingReminderIds` (`src/js/super-agent.js:4046-4048`), donc resélectionné à chaque passe, indéfiniment. |
| 3 | Le rattrapage ré-occupe l'assistant | **CONFIRMÉ** | `src/js/super-agent-schedule.js:70` (`toInject: eligible.slice(0, 1)`) : une relance par passe, chacune ouvrant un tour complet — un arriéré de N relances = N tours successifs (un rappel est un prompt système entier). |
| 4 | La retenue est totalement silencieuse | **CONFIRMÉ** | `src/js/super-agent.js:4011` : `const { toInject } = planDueReminderInjections(...)` — le champ `held`/`waitingForOwner` était calculé puis **jeté**, aucun message. |
| Bonus doc | `spec_super_agent.md` se contredit | **CONFIRMÉ** | `spec_super_agent.md:1343-1346` : « **1 fire** par planification et par tick, **au plus UNE relance livrée par passe** » — deux règles inverse l'une de l'autre, écrites à la suite. |

Aucun défaut n'est infirmé ; aucun n'est un faux positif.

## Corrections apportées (périmètre borné)

### Défaut 1 — un seul signal d'engagement, posé par tous les chemins
- **Backend** (`src-tauri/src/super_agent.rs`) : nouveau
  `SUPERAGENT_OWNER_ENGAGED_EVENT = "pilot-superagent-owner-engaged"` +
  `emit_owner_engaged(app)`, appelé **une seule fois** dans
  `do_send_super_agent_prompt`, **après** un `send_superagent` réussi. Ce helper
  est le point de passage commun de la saisie directe **et** du web distant
  (`web_server.rs:581`) : un seul site d'émission dans tout le backend.
- **Frontend** (`src/js/super-agent.js`) : `send()` **ne pose plus** le drapeau ;
  `createSuperAgent` écoute l'évènement et pose `ownerEngagedThisSession = true`
  (nettoyage de l'écoute ajouté au `unlisten` de l'onglet).
- **Telegram** (`injectExternalMessageToSuperAgent`, `src/js/super-agent.js`) :
  marque **le même** drapeau (son message n'entre pas par
  `do_send_super_agent_prompt`). **Aucun second drapeau** n'a été créé.

### Défaut 2 — rotation, compteur d'échecs **en mémoire**
- `planDueReminderInjections` classe désormais les rappels éligibles par
  **échecs consécutifs croissants** (puis par ordre d'origine) : celui qui vient
  d'échouer passe après ceux qui n'ont jamais échoué.
- Au-delà de `REMINDER_MAX_CONSECUTIVE_FAILURES = 3`, un rappel est **écarté**
  tant qu'un autre peut partir ; si **tous** sont écartés, ils sont retentés
  **ensemble** (aucun rappel n'est jamais perdu).
- Le compteur vit dans `const reminderFailureCounts = new Map()` (ticker
  `super-agent.js`), incrémenté dans le `catch` d'envoi, effacé au succès et
  purgé des ids qui ne sont plus dus. **Aucune écriture en base**, aucune
  colonne ajoutée à `assistant_schedules`.

### Défaut 3 — les retardataires partent groupés
- Nouveau : `isOverdueLaggard()` / `parseScheduleInstant()` (module pur) —
  est **retardataire** un rappel dont l'échéance est dépassée de plus de
  `REMINDER_LAGGARD_INTERVAL_FACTOR = 2` intervalles (cas type : arriéré
  accumulé pendant une fermeture de Pilot).
- `buildReminderInjectionMessage(items)` produit **un seul** message :
  `[⏰ Rappel programmé] …` pour une relance seule (format historique conservé),
  `[⏰ N relances échues] … 1. … 2. …` pour un lot. Le ticker n'émet donc plus
  qu'**une commande par passe** quel que soit le lot.
- Côté Rust, `DueSchedule` expose `nextFireAt` (l'échéance qui a rendu le rappel
  dû, jamais l'heure du tick) : sans cette valeur, la notion de retardataire ne
  pouvait pas être honnête. Une relance simplement échue **continue de partir
  seule** (la règle validée de `d26717e` est préservée pour le cas courant).

### Défaut 4 — la retenue parle, une fois par session
- `formatReminderHoldNotice(n)` : « N relance(s) en attente — écrivez, ou
  activez ⚙️ → Assistant ».
- `createReminderHoldGuard()` : la règle d'unicité (au plus **une** annonce par
  session) est isolée et testable ; `reset()` à chaque ouverture du ticker.
- Le ticker affiche le message **seulement** quand la cause est « le
  propriétaire n'a pas écrit » (`plan.waitingForOwner > 0`), jamais pour un
  assistant simplement occupé (cela se débloque seul).

### Documentation
- `spec_super_agent.md` : la contradiction est levée — la règle réellement
  appliquée est écrite (un seul **envoi** par passe, l'unité limitée est le
  nombre de **tours**, pas le nombre de rappels traités), avec les trois
  sous-règles (une par passe / retardataires groupés / rotation et mise à
  l'écart en mémoire), le signal d'engagement unique (les trois chemins
  d'écriture) et le signal de retenue (une fois par session).
- `help/handbook.md` régénéré via `npm run build:handbook` (bloc
  `<!-- HELP:super-agent -->` modifié), **dans le même commit**.

## Neutralisations essayées puis restaurées (preuve que les verrous tiennent)

Chaque correction a été défaite isolément, le test concerné relancé, puis la
correction restaurée (copie de sauvegarde). Résultats réels :

| Neutralisation | Test relancé | Résultat |
|---|---|---|
| Retrait de l'appel `emit_owner_engaged(app)` dans `do_send_super_agent_prompt` | `relances-relecture.test.js` | **1 échec** : `expected 'fn do_send_super_agent_prompt(…' to contain 'emit_owner_engaged(app);'` |
| Retrait de l'écoute `listen("pilot-superagent-owner-engaged")` | idem | **1 échec** : `expected … to contain 'listen("pilot-superagent-owner-engage…'` |
| Rotation + mise à l'écart défaites (tri par ordre d'origine, plus de quarantaine) | idem | **3 échecs** : `expected [ 10 ] to deeply equal [ 11 ]` (×2) et `expected [ 10 ] to deeply equal [ 10, 11 ]` |
| `const laggards = [];` (plus de regroupement) | idem | **1 échec** : `expected 'single' to be 'group'` |
| Garde d'unicité défait (`return true` toujours) | idem | **1 échec** : `expected true to be false` (2ᵉ appel de la même passe) |
| Contradiction réintroduite dans la spec (`1 fire … / au plus UNE relance livrée par passe`) | idem | **1 échec** : `expected '# Spécification — Assistant…' not to match /1 fire/` |
| `const items = due;` (le ticker ignorerait le plan et marquerait des rappels retenus) | idem | **1 échec** : `expected 'async function scheduleTick() …' to contain 'const items = plan.toInject;'` |

Toutes les neutralisations ont été restaurées : `npm test` et `cargo test`
repassent au vert (chiffres ci-dessous) et `git diff` ne contient aucune trace
de neutralisation.

## Fichiers touchés

- `src/js/super-agent-schedule.js` (logique pure : rotation, retardataires,
  message de lot, signal de retenue, garde d'unicité, `nextFireAt`).
- `src/js/super-agent.js` (ticker : un seul envoi par passe, compteur en
  mémoire, signal de retenue ; écoute du signal d'engagement ; marquage
  Telegram).
- `src-tauri/src/super_agent.rs` (`nextFireAt` dans `schedule_due` +
  `emit_owner_engaged` dans `do_send_super_agent_prompt` + 1 test unitaire).
- `src/js/relances-relecture.test.js` (nouveau : 20 tests, verrous des 4 défauts
  + doc).
- `src/js/super-agent-schedule.test.js` (verrou de branchement adapté).
- 7 fichiers de test qui mockaient `super-agent-schedule.js` avec un mock
  incomplet (le module crée maintenant son garde au chargement) : mock complété.
- `spec_super_agent.md` + `help/handbook.md` (régénéré).
- `RAPPORT-relances-correction-relecture.md` (ce rapport).

## Vérifications finales (chiffres réels)

```
npm test
  Test Files  161 passed (161)
  Tests       2780 passed (2780)

cargo test --manifest-path src-tauri/Cargo.toml --lib
  cargo test: 722 passed, 1 ignored (1 suite, 10.68s)
```

Remarque d'honnêteté : lors d'une première exécution complète de
`cargo test --lib`, `gds::tests::server_test_state_is_memorized_and_listed` a
échoué une fois (`2026-10-24T20:38:38Z` vs `…37Z`, comparaison d'horodatage à la
seconde). Relancé seul puis en série complète : **passe**. C'est un
aléa préexistant du test GDS (module non touché par cette mission), pas une
régression.

## Ce qui n'a pas été fait (par construction)

- La décision centralisée de `d26717e` n'est pas revisitée : tout passe
  toujours par `planDueReminderInjections`.
- Aucun second drapeau d'engagement, aucun compteur d'échec en base.
- Aucun autre chantier touché (ménage des rappels, voix, panneau des tâches,
  autres rapports de mission), aucune version, aucun tag, aucune publication,
  aucun lancement de l'application.
