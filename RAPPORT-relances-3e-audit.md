# Rapport — relances de l'assistant : 3ᵉ audit (4 points)

> Mission : régler les quatre points du **3ᵉ audit indépendant** de la correction
> des relances (`bc7fd1f`), **sans revenir** sur ce qui a été validé. Livraison =
> dernière étape avant mise en ligne : aucun bump de version, aucun tag, aucune
> publication.

## État de départ (ce que l'audit reproche à `bc7fd1f`)

| # | Point | Gravité |
|---|---|---|
| 1 | Des relances sont marquées « envoyées » alors que leur texte a été tronqué hors du message | **SÉRIEUX** |
| 2 | Règle périmée encore vivante (2 occurrences dans un test) + verrou trop étroit (liste de phrases figées, 2 fichiers seulement) | Modéré |
| 3 | Prompt arrivé par l'accès web distant, onglet fermé → engagement perdu | Modéré |
| 4 | Garde-fou de découpage non testé + un cas vacuable dans `read-aloud.test.js` | Faible |

---

## Point 1 — SÉRIEUX : relances marquées sans être livrées

**Cause.** Le message du lot était plafonné à 4000 caractères **après** assemblage :
au-delà, le texte était coupé (« N caractère(s) omis ») mais la boucle de marquage
parcourait **toute** la liste du plan. Mesure de l'audit : 8 relances × 3011
caractères → message de 4000, « 20496 caractère(s) omis », seules 1 et 2 lisibles,
**les 8 marquées** ; six relances perdues.

**Correctif retenu : la troncature du message est rendue STRUCTURELLEMENT
IMPOSSIBLE** (option préférée de l'audit), pas seulement détectée.

- `src/js/super-agent-schedule.js` : nouvelle constante
  `REMINDER_ITEM_MAX_CHARS = 450` ; chaque relance est rendue **dans un budget**
  (`renderReminderItemWithin`), la coupe tombe sur une frontière lisible
  (`cutTextAt`) et l'avis de troncature est **celui de cette relance**
  (`reminderTruncationNotice`). Marge vérifiée : 8 × 450 + séparateurs + en-tête
  (≈ 190) < 4000.
- Nouvelle API `buildReminderInjection(items)` → `{ message, delivered, withheld }`.
  `delivered` = relances dont le texte est **réellement** dans le message.
  `buildReminderInjectionMessage()` reste un wrapper `.message` (rétrocompatibilité).
- `src/js/super-agent.js` (`scheduleTick`) : `readable = injection.delivered` ;
  le message envoyé est `injection.message` ; la notification (panneau 🔔 + toast)
  compte `readable` ; la boucle de marquage boucle sur **`readable`** ; seules les
  relances retirées sont **remises à « dues »** (elles ne passent jamais « en
  vol » : `for (const d of readable) pendingReminderIds.add(d.id)`).

**Tests (dans `src/js/relances-relecture.test.js`)** :
- « la troncature du message est STRUCTURELLEMENT IMPOSSIBLE : chaque relance est
  bornée DANS le lot » — reproduit la mesure de l'audit (8 × 3011) et exige : message
  ≤ 4000, aucun avis « lot tronqué », `delivered` = les 8, **8 avis de troncature
  par relance**, et un lot de 8 × 50 000 caractères toujours ≤ 4000.
- « le contenu RÉELLEMENT LISIBLE est relié au marquage » — pour 7 tailles de relance
  (0 → 20 000), vérifie `delivered ∪ withheld = items`, la **lisibilité de chaque
  `delivered`** et l'**absence de chaque `withheld`** dans le message.
- « le ticker marque les relances LISIBLES (`injection.delivered`), jamais la liste
  brute du plan » — verrou de branchement sur le source du ticker.

**Neutralisation (vérification que le test mord)** : dans `composeGroupMessage`,
remplacement du rendu borné par le rendu complet
(`numberReminderLine(i + 1, d.prompt)`), constante laissée intacte.
→ **ÉCHEC** : `expected [ 1 ] to deeply equal [ 1, 2, 3, 4, 5, 6, 7, 8 ]` et
`expected '…' to match /relance tronquée : \d+ caractère/` (**2 échecs / 30
passés**). Restauration → **32 passés**.
Seconde neutralisation (constante portée à 4000) → **1 échec** (garde de marge).

---

## Point 2 — règle périmée vivante + verrou trop étroit

**Cause.** Deux titres de `src/js/super-agent-schedule.test.js` énonçaient encore
« une relance par passe » ; le test de garde ne cherchait qu'une **liste de phrases
figées**, sur **deux** fichiers.

**Correctif.**
- `src/js/super-agent-schedule.test.js` : groupe renommé « (réglage « points à faire
  à l'ouverture » + un seul ENVOI par passe) » ; test renommé « un seul ENVOI par
  passe : une relance simplement échue part seule, les autres restent dues ».
- `src/js/relances-relecture.test.js` : la liste de phrases devient une liste de
  **motifs** (`MOTIFS_REGLE_PERIMEE`, 7 expressions) couvrant « au plus / une seule /
  qu'une … relance … par passe », « relance livrée par passe », « 1 exécution (fire) …
  par tick / par planification », « 1 fire/tick ». Périmètre **élargi** à
  `src-tauri/src/super_agent.rs`, `tests/schedule-tests.md`,
  `src/js/super-agent-schedule.test.js`, `src/js/super-agent-schedule.js`,
  `spec_super_agent.md`.
- Seule tolérance conservée : la **citation** de l'ancienne règle pour expliquer son
  remplacement (« et non « … » »).
- Test ajouté : « une REFORMULATION de la règle périmée est attrapée » — 4
  reformulations inédites passent le crible, 2 formulations valides ne le passent
  pas (aucun faux positif).
- Le commentaire Rust qui **citait** l'ancienne règle sans la forme tolérée a été
  reformulé (« … et non « 1 exécution max par planification et par tick » … »).

**Neutralisation** : réintroduction du titre « au plus une relance par passe » dans
`super-agent-schedule.test.js`. → **ÉCHEC** :
`src/js/super-agent-schedule.test.js : règle périmée posée comme appliquée →
« une relance par passe »` (**1 échec / 31 passés**). Restauration → **32 passés**.

---

## Point 3 — prompt par accès web, onglet fermé

**Cause.** L'écoute de « le propriétaire a écrit » était enregistrée dans la
**fabrique de l'onglet** et retirée à sa fermeture ; l'émission Rust étant
inconditionnelle, un prompt venu du **web distant onglet fermé** tombait dans le
vide : engagement non posé, relances retenues, « écrivez » affiché à tort.

**Option retenue : écoute au niveau de l'APPLICATION** (et non persistance de
l'engagement côté Rust). Pourquoi :
1. le modèle existe déjà et il est éprouvé dans le projet — `initTelegramInbound()`
   est appelé au démarrage, onglet ou pas ; on ne crée donc aucun mécanisme nouveau ;
2. aucune persistance en base : l'audit interdit un **second drapeau** comme un
   **compteur** ; l'écoute applicative n'en ajoute aucun, elle déplace seulement
   l'abonnement ;
3. l'unité « une session = une exécution de Pilot » (validée à la 2ᵉ relecture) se
   pose d'elle-même : l'abonnement vit aussi longtemps que l'exécution ;
4. persister côté Rust aurait demandé un état par session côté serveur, un
   nettoyage au redémarrage et un nouveau contrat front/back pour un booléen déjà
   porté par le front.

**Correctif.**
- `src/js/super-agent.js` : `initOwnerEngagementWatch()` **idempotente** (garde
  `ownerEngagementWatchInstalled`), extraite de `createSuperAgent` ; la fabrique
  n'enregistre plus l'écoute et ne la retire plus (`unlistenOwnerEngaged` supprimé).
- `src/js/main.js` : appel `void initOwnerEngagementWatch();` juste après
  `initTelegramInbound()`.
- Toujours **un seul drapeau** (`ownerEngagedThisSession`), posé à deux endroits
  (écoute applicative + réception Telegram) — assertions dédiées.

**Tests** :
- « l'écoute « le propriétaire a écrit » est posée AU NIVEAU DE L'APPLICATION, pas
  dans la fabrique de l'onglet » : corps de `initOwnerEngagementWatch` (découpé par
  `sliceSource`) contient le `listen(...)` et la pose du drapeau ; corps de
  `createSuperAgent` n'enregistre plus l'évènement (`not.toMatch(/listen\(\s*["']pilot-superagent-owner-engaged/)`)
  ni `unlistenOwnerEngaged` ; `main.js` **appelle** (regex ancrée à la ligne, donc
  un appel mis en commentaire ne suffit pas) ; 2 poses du drapeau, aucun `+= 1`.
- « prompt web pendant que l'onglet est fermé → ouverture de l'onglet → la relance
  part » : signal Rust → drapeau → `planDueReminderInjections` livre la relance et
  `buildReminderInjection` la marque `delivered` ; **contre-épreuve** sans signal
  (état d'avant correctif) → relance **retenue** (`toInject` vide, `held` = [7]).

**Neutralisation** : appel de `main.js` mis en commentaire. → **ÉCHEC**
(`expected '…' to match /^[^\S\n]*void initOwnerEngagementWatch\(\);$/m`,
**1 échec / 31 passés**). Restauration → **32 passés**.
(Constante trouvaille au passage : l'assertion initiale `toContain(...)` passait
encore sur le **commentaire** — elle est devenue ancrée à la ligne.)

---

## Point 4 — invariant de découpage non imposé

**Cause.** Les tests découpaient le source par `.slice(... indexOf(...))` sans
vérifier l'ancre : ancre absente → `-1` → fragment vide → une assertion
`not.toContain(...)` devenait **vraie par construction** (cas `read-aloud.test.js`
≈ l. 665).

**Correctif.**
- Nouveau module d'outillage `src/js/source-slice.js` :
  - `sliceSource(src, startAnchor, endAnchor?, minLen = 1)` et `sliceFrom(...)` :
    lèvent `SourceSliceError` si l'ancre de début manque, si l'ancre de fin manque,
    si elle est **placée avant le début** (diagnostic distinct) ou si le fragment
    est **trop court** ;
  - `findUnprotectedSourceSlices(source)` : détecteur PUR du motif fautif (borne de
    `.slice(...)` calculée **en ligne** par `indexOf`/`lastIndexOf`, parenthèses
    équilibrées), avec neutralisation préalable des chaînes, gabarits et
    commentaires (sinon un échantillon de code cité dans une chaîne serait compté).
- `src/js/read-aloud.test.js` : les deux découpages manuels sont remplacés par
  `sliceSource(...)` (avec `minLen`), donc une ancre cassée **fait échouer** le test.
- `src/js/relances-relecture.test.js` : `sliceSource` utilisé partout (les deux
  découpages fautifs restants y ont été remplacés), plus un test « le ticker marque
  `injection.delivered` ».
- Nouveau `src/js/source-slice.test.js` : le garde-fou est testé **pour lui-même**
  (5 échecs distincts + cas nominaux), le détecteur est testé sur le motif exact du
  défaut, **et un INVENTAIRE** balaie `src/`, `scripts/` et `web/` : tout nouveau
  découpage non protégé fait échouer le test ; les deux fichiers réparés sont tenus
  à **zéro**.

**État de l'inventaire.** 162 fichiers de test balayés. **37** découpages non
protégés **historiques** subsistent dans **24** fichiers ; ils sont **gelés** par un
relevé explicite dans `source-slice.test.js` (tout dépassement échoue, et un fichier
du relevé qui disparaît fait aussi échouer le test — le plafond ne peut pas
« traîner »). Les fichiers réparés par ce correctif (`read-aloud.test.js`,
`relances-relecture.test.js`) n'y figurent pas : ils sont à **zéro**. La dette
restante est donc **visible et bornée**, pas excusée ; la réparer entièrement sortait
du périmètre borné de ce correctif.

**Neutralisations.**
1. `sliceSource` remplacé par un découpage naïf (sans garde) → **ÉCHEC : 6 tests**
   (« expected function to throw an error, but it didn't » ×4, ancres/illisible).
   Restauration → **81 passés** (3 fichiers).
2. Un découpage de `read-aloud.test.js` remis à la main
   (`src.slice(src.indexOf(userFactory), …)`) → **ÉCHEC** de l'inventaire :
   `src/js/read-aloud.test.js : 1 découpage(s) non protégé(s) (plafond 0) → l.639`.
   Restauration → **49 passés** (2 fichiers).

---

## Vérifications finales (chiffres réels)

| Commande | Résultat |
|---|---|
| `npm test` | **162 fichiers passés / 162**, **2808 tests passés / 2808**, 0 échec (9,9 s) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **722 passés, 1 ignoré** (10,6 s) |

## Documentation

- `spec_super_agent.md` : point 5 ajouté à la règle d'envoi (borne **par relance**,
  `REMINDER_ITEM_MAX_CHARS`, troncature **par relance**, `delivered`/`withheld`,
  marquage limité à `delivered`) ; paragraphe « Où l'écoute est installée » (niveau
  **application**, `initOwnerEngagementWatch` idempotente, appelée par `main.js`,
  plus dans la fabrique) ; parcours web verrouillé cité.
- `npm run build:handbook` relancé : `help/handbook.md` régénéré (45 blocs,
  258 809 octets) et committé **dans le même commit** que la spec.

## Ce qui n'a pas bougé (validé, à ne pas rouvrir)

- Émission **unique** du signal côté Rust (`do_send_super_agent_prompt`).
- **Pas** de remise à zéro de l'engagement à l'ouverture d'un onglet.
- Les **deux** bornes du lot conservées : 8 relances (`REMINDER_BATCH_MAX_ITEMS`),
  4000 caractères (`REMINDER_BATCH_MAX_CHARS`).
- Portée « une fois par session de conversation » du signal de retenue.
- Un **seul** drapeau d'engagement, aucun compteur en base.
- Voix, rappels (interface) et panneau des tâches : non touchés.
- Aucun bump de version, aucun tag, aucune publication, application non lancée.
