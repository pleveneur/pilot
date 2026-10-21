# Rapport de relecture finale — file d'attente et verrous (P1, P2, P3)

**Mission** : relecture indépendante, en LECTURE SEULE (aucune modification de code, aucun
commit, aucun tag, aucun changement de version). Seul ce fichier est écrit.
**Périmètre** : 3 correctifs locaux non poussés — P2 `13f7552` (+ re-vérification `9031b37`),
P1 `4cf5356`, P3 `275eb04` — sur la base publiée `3c67064 chore: bump version to 0.4.35`.

---

## 0. Verdict global

> ### **PUBLIABLE** — sous 3 conditions **mécaniques** de publication (§10), aucune condition de code.
>
> Les trois défauts sont réellement neutralisés, et chacun est couvert par une preuve qui
> **échoue si le défaut revient** (7 mutations exécutées, §3–§5). P1 + P2 partagent bien **une
> seule file** et **un seul rejeu** ; P3 a changé les clés sans orpheliner une file en vol ;
> **aucune donnée utilisateur n'est touchée, aucune migration n'a lieu** (§8).
>
> Deux **réserves réelles mais non bloquantes** subsistent et sont à traiter dans un correctif
> ultérieur (§9) : (R-A) une mission qui ressort de file pour être relancée peut être remise
> **en queue** au lieu de la **tête** si le projet n'est pas libre → inversion d'ordre possible,
> **sans perte ni doublon** ; (R-B) la file des **commandes manuelles** n'a pas reçu la clé
> d'identité unique (même symptôme D3, famille non traitée), **sans perte** non plus.

| Défaut | Verdict | Preuve que le comportement fautif est impossible | Preuve que le test cible le défaut |
|---|---|---|---|
| **P2** — un arrêt d'agent ne détruit plus une file | **CORRIGÉ — prouvé** | seul site d'abandon automatique de la file de missions : `super-agent.js:4798` (chien de garde, tracé + notifié) ; `stop_agent` appelle `keepQueuedRunAgentsMissions` (`:5449`) qui ne fait **ni** `shift` **ni** `length = 0` (`:801-834`) | mutations M3, M4, M7 → le test **échoue** à chaque fois (§3) |
| **P1** — ordre d'arrivée à l'admission | **CORRIGÉ — preuve partielle** : garanti **à l'admission** (3 points d'entrée), **pas** sur le rebouclage d'une mission défilée (R-A) | `decideMissionAdmission` (`:618`) : `pending > 0` ⇒ `queue: true`, appelé **avant** tout lancement (`:4654`, `:4732`, `:4906`) | M1 → test **échoue** ; M2 → test passe, mais M2 **ne change pas la décision** (§4.3) |
| **P3** — identité de projet unique | **CORRIGÉ — prouvé**, périmètre **incomplet** (R-B) | `project-key.js` source unique ; plus aucune comparaison de chemin brut dans `super-agent.js`, `agents-bus.js`, `exclusivity-queue.js`, `reservations.js` (§5.1) | M5, M6 → tests **échouent** (§5.3) |

**Tests frontend, dépôt réel** : `npx vitest run` → **124 fichiers, 2091 tests, 2091 PASS, 0 FAIL**
(chiffres du rapport JSON : `numTotalTests=2091`, `numPassedTests=2091`, `numFailedTests=0`).

---

## 1. Méthode

- **Code lu, pas les rapports** : `src/js/super-agent.js` (6778 l.), `agents-bus.js`,
  `project-key.js`, `exclusivity-queue.js`, `mission-identity.js`, `reservations.js`,
  `run-policy.js`, `project-task-queue.js`, `project-queue-view.js`, plus les diffs réels
  (`git show 275eb04`, `git diff 8aa8f0d..HEAD`).
- **Preuves exécutées** : suite complète + **7 mutations** dans un bac à sable
  (`/tmp/pilot-mut` : copie du projet **sans** `target/`, `node_modules` lié), pour vérifier que
  chaque test échoue bien si le défaut revient.
- Convention : quand seule la lecture du code prouve un point, c'est écrit **« prouvé par
  lecture (non exécuté) »**. Aucune affirmation non étiquetée.

### 1.1 Le delta 2080 / 2091 (vérifié, ce n'est pas une anomalie)

Le bac à sable comptait `2080 PASS / 0 FAIL` contre `2091 / 0` dans le dépôt réel. Écart
**expliqué et clos** par comparaison fichier par fichier des rapports JSON :
`gds-e2e-isolation.test.js` (7 tests) et `gds-image-license.test.js` (4 tests) ne collectent
**aucun** test dans le bac à sable parce que `gds-core/` et `gds-server/` n'y ont pas été copiés
(ces deux fichiers lisent des sources serveur). **7 + 4 = 11.** Le chiffre de référence est donc
bien **2091 PASS / 0 FAIL**, reproductible.

---

## 2. État réel du dépôt (vérifié, pas déclaré)

```
origin/main = 3c67064  (chore: bump version to 0.4.35)      ← publié
HEAD        = 9031b37  → 4cf5356 → 275eb04 → 13f7552 → 8aa8f0d → 3c67064
git rev-list --count origin/main..HEAD = 5   (5 commits locaux non poussés)
tag v0.4.35 : présent en local ET sur origin (3c670644…)
```

- Version courante : **0.4.35** dans `package.json`, `src-tauri/tauri.conf.json`,
  `Cargo.lock` (package `pilot` uniquement — vérifié : une seule occurrence), version portée
  par le workspace racine.
- **Conséquence directe** : `v0.4.35` est déjà **taguée et publiée**. Ces trois correctifs ne
  peuvent donc **pas** sortir en 0.4.35 (règle « ne jamais republier un tag ») → **0.4.36**
  obligatoire (§10).
- Aucun fichier Rust modifié (`src-tauri/`, `gds-core/`, `gds-server/` absents du diff) : les
  trois correctifs sont **100 % frontend**. `cargo test` n'est pas requis pour cette relecture
  (rien n'a bougé côté Rust), mais reste la vérification d'usage pour une release.

---

## 3. P2 — « un arrêt d'agent ne détruit plus une file de missions »

### 3.1 Le comportement fautif est-il devenu impossible ? **Oui — prouvé.**

Le défaut historique produisait la trace `reason=queue-abandoned detected=stop-agent` : la
branche `stop_agent` concluait « le projet est libre » sur la foi du **verrou de bus** puis
vidait `runAgentsQueueByProject`.

Preuve structurelle, plus forte qu'une simple relecture de la branche :

- `abandonQueuedRunAgentsMissions` (fonction qui vide la file) n'est appelée, en production,
  **qu'à un seul endroit** : `super-agent.js:4798`, le **chien de garde** (run bloquée 15 min),
  avec motif tracé (`:4795-4805`) et notification utilisateur (`:767-773`).
- `abandonProjectMissionQueue` (l'autre vidage) n'est appelée que par `project-queue-view.js:151`
  → commande **utilisateur** `/file vide`.
- La branche `stop_agent` (`:5442-5478`) appelle désormais
  `keepQueuedRunAgentsMissions(queueKey)` (`:5449`) / `keepQueuedRunAgentsMissions(assistantKey)`
  (`:5475`), qui **conserve la file en place, dans son ordre** (`:801-834`, aucun `shift`, aucun
  `length = 0`), **nomme** chaque mission dans le journal (`queue-kept`) et **arme le rejeu**
  (`armQueueReplay`, `:826`).

⇒ Il n'existe plus **aucun** chemin `stop_agent` capable de vider une file : ni par appel direct,
ni par un helper partagé.

### 3.2 Le test cible-t-il le défaut ? **Oui — 3 mutations sur 3 l'ont fait échouer.**

`src/js/file-attente-arret-conserve.test.js` (7 tests) charge le **vrai module** (stub DOM, aucun
accès Tauri), appelle la **vraie** consigne de production, et vérifie en plus par lecture de
source que la branche `stop_agent` n'appelle plus l'abandon (projet **et** espace assistant).

| Mutation | Résultat |
|---|---|
| **M3** — `keepQueuedRunAgentsMissions` vide la file (`queue.length = 0`) | **ÉCHEC** (les assertions « file intacte » tombent) |
| **M4** — `stop_agent` rappelle `abandonQueuedRunAgentsMissions` (réversion exacte du défaut) | **ÉCHEC** (branche projet **et** branche assistant) |
| **M7** — la file est conservée mais `armQueueReplay` retiré (conservée sans jamais être rejouée) | **ÉCHEC** (« file conservée **et** rejeu armé ») |

M7 est le mutant le plus utile : il prouve que le test ne se contente pas de « la file n'est pas
vidée », il exige aussi **qu'elle reparte** — c'est exactement le défaut D2 (une file conservée
mais jamais reprise serait une perte silencieuse déguisée).

---

## 4. P1 — ordre d'arrivée à l'admission

### 4.1 Ce qui est prouvé

`decideMissionAdmission` (`:618-623`) est le **point de décision unique** :

```js
const pending = pendingMissionsAhead(projectPath, opts);   // longueur de la file du projet
if (pending > 0) return { queue: true, pending, reason: "queue-ahead" };
if (opts && opts.busy) return { queue: true, pending, reason: "busy" };
return { queue: false, pending, reason: "" };
```

Il est appelé **avant tout lancement** aux trois points d'entrée de `run_agents` /
`run_assistant_agents` : `:4654`, `:4732` (`launchOrQueue`), `:4906` (`startRun` de l'assistant).
La file lue est **la même** que celle écrite (`pendingMissionsAhead` → `missionQueueKey` `:479` ;
écriture → `enqueueMissionForProject` `:550`). ⇒ une demande qui arrive quand une mission attend
**ne peut pas démarrer** : elle s'empile derrière, et la décision est **tracée**
(`traceMissionQueuedBehindPending`, `:638`, motif `queue-order-respected`).

### 4.2 Le test cible-t-il le défaut ? **Oui pour la réversion réelle (M1).**

`src/js/file-attente-fifo-admission.test.js` (8 tests) : décision pure, rejeu de la tête **non
compté** comme « une mission devant », scénario clé « A en file, B arrive alors que le projet
*paraît* libre → **A démarre en premier** », trace, unicité du point de décision (source), et
affichage de la file.

| Mutation | Résultat |
|---|---|
| **M1** — `pendingMissionsAhead` renvoie toujours `0` (le défaut : on ne regarde pas la file) | **ÉCHEC (2 tests)** ✔ |
| **M2** — on teste `busy` **avant** `queue-ahead` | test **toujours vert** — voir 4.3 (ce n'est pas une faiblesse) |

### 4.3 Pourquoi M2 n'est **pas** un trou de test (mise au point)

L'ordre des deux règles est **sans effet sur la décision** : si `pending > 0` **et** `busy`, les
deux branches renvoient `queue: true`. Seuls changent le **motif** (`reason`) et le message
affiché — c'est-à-dire la **trace**, pas le comportement. M2 est donc un **mutant non
équivalent** : son survie est la preuve que la garantie FIFO ne dépend pas de l'ordre de ces deux
lignes. La seule réversion qui rétablit réellement le défaut est M1, et elle est bien détectée.

### 4.4 Trou résiduel **réel** de la garantie (R-A, prouvé par lecture)

**La garantie d'ordre vaut à l'admission, pas au rebouclage.** Chaîne exacte :

1. `launchQueuedMission(target, entry)` **pose le drapeau** puis appelle le lanceur :
   `runAgentsInFlightByProject[inFlightKey(target)] = true` (`:1055`), puis
   `entry.launch({ dequeue: true })` (`:1075`).
2. Le lanceur (`launchOrQueue`) attend `releaseStuckRunLock` (`:4717`), puis :
   `if (inFlight && !isRunInProgress(target)) inFlight = false` (`:4723`) — le drapeau n'est
   **effacé que si le bus est totalement libre** — puis
   `blockedByFlag = missionNature === "write" && inFlight` (`:4729`).
3. Donc, si **une autre run tourne sur le projet** (mission de **lecture** en cours, commande
   **manuelle** en cours, run d'un autre agent du même projet — tous invisibles pour la sonde de
   rejeu `isRunStillActive`, qui juge sur les **sessions** et non sur le bus), la mission défilée
   arrive à l'admission avec `busy = true` ⇒ `queue: true` ⇒ **`:4741`
   `enqueueMissionForProject(...)`** ⇒ **`queue.push` = remise en QUEUE** (`:554`), alors que la
   mission venait d'être **retirée de la tête** (`queue.shift()`, `:1003` / `:4573` / `:4887`).

**Conséquence** : avec une file `[B, C]`, si B ressort et ne peut pas démarrer, la file devient
`[C, B]`. B n'est **ni perdue ni dupliquée** (même identité, même numéro, rejeu réarmé `:4747`),
mais **C passe avant B** : l'ordre d'arrivée est inversé dans ce cas précis. Le scénario symétrique
existe sur le chemin assistant (`:4922`).

**Correctif attendu** (hors mission — non appliqué) : `enqueueMissionForProject(..., { atHead:
true })` quand `launchOpts.dequeue` est vrai (ou `unshift` dans `launchQueuedMission` quand le
lanceur répond `{ queued: true }`), + un test « mission défilée qui ne peut pas démarrer →
revient **en tête** ».

---

## 5. P3 — une seule identité de projet

### 5.1 Le défaut est-il impossible ? **Oui pour les familles traitées — vérifié par grep exhaustif.**

`src/js/project-key.js` est la **source unique** (`normalizeProjectPath`, `projectKey`,
`sameProject`, `projectScopedKey`, `findProjectScopedKey`, `deleteProjectScoped`,
`queueKeyMatchesProject`). Toutes les structures visées passent par lui :

| Structure | Clé utilisée | Lieu |
|---|---|---|
| File de missions | `missionQueueKey` → `projectScopedKey` | `super-agent.js:479` |
| Drapeau de run | `inFlightKey` | `:482` |
| Rejeu / chien de garde | `missionReplayKey`, `watchdogKey`, `delegationReplayKey` | `:485-492` |
| États de délégation | `projectKey` | `:424` |
| File d'exclusivité (bus) | `exclusivityKey` = `projectKey(projet)\u{1f}agent` | `exclusivity-queue.js:27` |
| Files d'exclusivité par projet | `projectScopedKey` | `agents-bus.js:415, 433, 460, 479, 515` |
| Réservations de fichiers | `projectKey` (chemin **réel** conservé en valeur) | `reservations.js:166-218, 263` |

Contrôle de non-régression majeur : **une clé n'est jamais utilisée comme chemin**.
`scopedProjectOfKey` ne sert qu'à **comparer** (`project-key.js:83`) ; les traces d'abandon
reçoivent le **chemin réel** (`super-agent.js:709-712`, `:759-761`) ; la file d'exclusivité
mémorise le chemin réel dans une propriété **symbole** (`agents-bus.js:419`), invisible des
`Object.keys` — donc jamais confondue avec une clé (`.test` `project-cle-unicite.test.js:162-165`).

### 5.2 Le test cible-t-il le défaut ? **Oui — 2 mutations sur 2.**

`src/js/project-cle-unicite.test.js` (6 tests) : 4 écritures d'un même dossier
(`G:\IA_PL\Pilot\`, `g:/ia_pl/pilot`, `g:/ia_pl/pilot/`, `…\pilot`) → **une** clé, **une** file
d'exclusivité, **une** file de missions (lecture ET écriture croisées), **une** réservation ; et
l'abandon depuis l'écriture B vide bien la file lue avec l'écriture A (`:151-152`).

| Mutation | Résultat |
|---|---|
| **M5** — `missionQueueKey` renvoie le chemin brut | **ÉCHEC** ✔ |
| **M6** — `exclusivityKey` renvoie le chemin brut | **ÉCHEC (2 tests)** ✔ |

### 5.3 P3 a-t-il cassé une file en vol ? **Non — prouvé, et il n'y a rien à migrer.**

- Les clés **existantes** sont retrouvées, pas remplacées : `projectScopedKey` renvoie la clé
  **déjà présente** (`findProjectScopedKey` sinon canonique) ; `exclusivityKey` renvoie la clé
  existante via `findExclusivityKey` (`exclusivity-queue.js:61, 75`). Une entrée posée sous une
  autre écriture du même dossier reste donc **visible, lisible, rejouable et abandonnable**.
- Les files sont **en mémoire vive uniquement** (`runAgentsQueueByProject`, `delegationStates`,
  files d'exclusivité, réservations) : il n'existe **aucun** état persisté à migrer (§8).
- Les adaptions de tests existants (`exclusivity-queue.test.js`, `verrou-par-projet.test.js`,
  `agent-demande-exact.test.js`, `super-agent-refus-avant-lancement.test.js`) sont des mises à
  jour de **contrats de chaînes** (`launchMission = (missionLaunchOpts) => launchOrQueue(...)`,
  clé d'exclusivité normalisée) : **aucune assertion supprimée ou affaiblie** (diff lu ligne à
  ligne, 19 insertions / 7 suppressions).

### 5.4 Effets de bord cosmétiques / limites de la normalisation (faible)

- `collectQueuedMissions` (`:2150`) itère les clés : le libellé de projet du volet Missions vient
  désormais de la clé **normalisée** (minuscules) — purement cosmétique.
- `normalizeProjectPath` **écrase les barres multiples** (`//`) : un chemin **UNC**
  `\\serveur\partage` devient `/serveur/partage`, indistinguable d'un chemin racine Unix. Sans
  effet sur l'usage desktop (le même écrit est appliqué aux deux côtés de la comparaison), mais à
  connaître pour un jour où un projet vivrait sur un partage réseau comparé à un chemin local.
- `"/"` (racine) se normalise en `""`, c'est-à-dire la clé « aucun projet / assistant ». Cas
  théorique, jamais rencontré (les projets sont des dossiers de travail).

---

## 6. Cohérence des trois correctifs

| Question posée | Réponse | Preuve |
|---|---|---|
| P1 et P2 partagent-ils **une** file ? | **Oui** | une seule map `runAgentsQueueByProject` (`:472`), **un seul** écrivain de production `enqueueMissionForProject` (`:550`, `push` en `:554`), une seule lecture `pendingMissionsAhead` (`:596`) — P1 y décide, P2 y conserve |
| Un **seul** rejeu ? | **Oui** | `replayQueuedMissionForProject` (`:990`) armé par l'unique `armQueueReplay` (`:1021`) ; P1 arme à l'empilement (`:4747`), P2 arme après l'arrêt (`:826`) ; auto-réarmement tant qu'il reste des missions (`:1030`) |
| Le rejeu et le chien de garde se contredisent-ils ? | **Non, et c'est un point à surveiller** | le rejeu juge sur les **sessions vivantes** (`isRunStillActive`, `:960`), l'admission sur le **bus** (`isRunInProgress`) : deux juges différents — c'est **la** cause de R-A (§4.4). Ils ne se contredisent pas sur la *perte* (aucun ne détruit la file sauf le chien de garde, tracé) |
| P3 a-t-il invalidé les clés de P1/P2 ? | **Non** | P1/P2 lisent et écrivent **via** `missionQueueKey` (`:479`) ; P3 n'a fait que remplacer la valeur de cette clé, dans **une** fonction, et retrouve les clés existantes. Les tests P1/P2 (8 + 7) restent verts **et** les mutants M1/M3/M4/M5/M6 échouent toujours → les preuves n'ont pas été « décalées » par P3 |

Chaîne complète vérifiée : `enqueueMissionForProject` → `armQueueReplay` → `replayQueuedMissionForProject`
(sonde de liberté) → `queue.shift()` → `launchQueuedMission` → `launchOrQueue`/`startRun` →
`decideMissionAdmission` → `settleRun` → `queue.shift()` suivant. Un seul circuit, un seul verrou
de run projet, une seule identité de projet.

---

## 7. Matrice de non-régression (les scénarios demandés)

| Scénario | Résultat | Preuve |
|---|---|---|
| **File vide** | OK | `keepQueuedRunAgentsMissions` sort tôt (`count === 0`, `:803`) ; `abandon*` sort tôt et ne trace rien ; un `deleteProjectScoped` sur clé absente est un no-op (`:4577`) |
| **Arrêt sans file** | OK | branche `waitingMissions === 0` → `delete runAgentsQueueByProject[missionQueueKey(queueKey)]` (`:5458`) : supprime une clé **vide**, aucune trace parasite (le journal n'écrit que s'il y a des libellés, `:661`) |
| **Arrêt avec file** | OK | file intacte + nommée + rejeu armé (`:5444-5452`) ; M4 prouve que la réversion est détectée |
| **Arrêt avec file — espace assistant** (`__assistant__`) | OK | branche dédiée `:5465-5477` ; M4 couvre les **deux** branches ; le journal prend son **repli global** (un espace réservé n'est pas un chemin, `:655`) |
| **Deux demandes simultanées** | OK **à l'admission** | 2ᵉ demande : `pending > 0` ⇒ mise en file, jamais de démarrage parallèle non voulu ; `run_agents` ×2 et `run_assistant_agents` décident par le **même** point (test `:237`) ; la file est monotone (`nextMissionId`) et le double empilement est refusé (`stampQueuedMission`, `mission-identity.js:104-119`) |
| **Deux écritures du même chemin** | OK (familles traitées) | `project-cle-unicite.test.js` — une clé, une file, une réservation ; M5/M6 détectent la réversion. **Réserve R-B** pour la file des commandes manuelles (§9) |
| **Rejeu après arrêt** | OK | `keep` arme le rejeu ; le rejeu ne lance la **tête** qu'une fois l'admission libre et se réarme s'il reste des missions (`:1030`) ; M7 prouve que « conservée mais jamais rejouée » est détecté |
| **Rejeu après arrêt — ordre** | **Réserve R-A** | inversion tête→queue possible si le bus est encore occupé (§4.4), sans perte |
| **Deux écritures vers le même fichier** | OK | réservations par `projectKey` (une seule réservation par dossier) + file d'exclusivité par couple (projet, agent) normalisé ; `isProjectReservedBy` compare le **codeur** et non la clé (`reservations.js:215-218`) |

---

## 8. Données utilisateur et migrations

- **Aucune écriture de données, aucun format modifié.** Les trois commits ne touchent que
  `src/js/*.js`, les specs et des rapports. Diff : `20 fichiers, +2028 / −189`, **zéro** fichier
  Rust, zéro migration SQL, zéro fichier de configuration utilisateur.
- **Aucune migration silencieuse possible** : les trois files (missions, délégations,
  exclusivité) et les drapeaux de run sont **en mémoire**, perdus au redémarrage. Il n'y a donc
  pas d'état persistant dont le changement de clé aurait pu « orpheliner » des entrées.
- **Artefacts persistés touchés indirectement** : `.pilot/reservations.json` — **schéma
  inchangé** (`buildReservations` → `{coder, files, agents}`, `reservations.js:128-134`) ; la purge
  écrit désormais avec le **chemin réel mémorisé** (`:263-267`) ; `.pilot/agent-stops.log` —
  **append** avec le **chemin réel** du projet (et repli global hors projet) : les journaux
  existants restent lisibles, aucun format changé.
- Base de suivi de l'assistant, sessions, coffre, historique : **non touchés** (aucun fichier de
  ces domaines dans le diff).

---

## 9. Réserves classées (ce qui n'est **pas** bloquant, mais qui est vrai)

| # | Réserve | Gravité | Effet utilisateur | Lieu |
|---|---|---|---|---|
| **R-A** | Une mission **défilée** qui ne peut pas démarrer repart **en queue** au lieu de la **tête** ⇒ inversion d'ordre possible | **Moyenne** | une demande peut passer devant une autre (jamais perdue, jamais dupliquée, +15 s d'attente) | `:4741` + `:554` ; symétrique `:4922` ; cause `:4729` (drapeau posé `:1055`) |
| **R-B** | La file des **commandes manuelles** (`/file`) reste indexée par **chemin brut** : D3 non appliqué à cette famille | **Moyenne-faible** | deux écritures du même dossier ⇒ deux files de commandes manuelles ; `/file` peut ne pas voir ni abandonner les commandes posées sous l'autre écriture (aucune perte de code) | `project-task-queue.js:209-210, 282-289, 315-341` |
| **R-C** | `help/handbook.md` **non régénéré** après l'ajout du bloc `HELP` D3 (présent dans `spec_super_agent.md:649`, absent du handbook committé) | **Faible (hygiène)** | aucun : `beforeBuildCommand`/`beforeDevCommand` exécutent `npm run build:handbook` (`tauri.conf.json:33-34`) ⇒ le binaire publié embarque bien le bloc ; seule la copie du dépôt est en retard | `help/handbook.md` |
| **R-D** | Libellé de projet du volet Missions issu de la clé normalisée (minuscules) | **Cosmétique** | affichage seulement | `:2150`, `:2144` |
| **R-E** | Le rejeu s'auto-réarme **sans plafond d'essais** : une mission qui ne peut *jamais* démarrer provoque une tentative toutes les 15 s (`RUN_AGENTS_QUEUE_REPLAY_MS`, `:928`) | **Faible (pré-existant)** | bruit de journal possible ; rien n'est perdu, mais le cas n'est pas borné | `:1021-1035` |
| **R-F** | Le chien de garde est armé **même** pour une mission mise en file (`:4807` avant `launchMission`, `:4808`) : il peut, 15 min plus tard, abandonner la file si le bus paraît mort | **Faible (pré-existant, désormais tracé)** | abandon **nommé, journalisé et notifié** — donc plus silencieux | `:4798-4805` |
| **R-G** | Asymétrie assumée à l'arrêt : les **délégations** sont **annulées** (`:5451`), les **missions** sont **conservées** puis rejouées | **À confirmer par le propriétaire** | deux sens différents pour un même bouton « arrêter » ; c'est une décision (D2), pas un défaut | `:5443-5460` |

---

## 10. À faire avant de publier (ordonné, bloquant/non bloquant)

1. **[BLOQUANT — mécanique]** `v0.4.35` est **déjà publiée** (tag local **et** distant sur
   `3c67064`) : publier ces correctifs impose un **bump en 0.4.36** dans les **4** fichiers
   (`src-tauri/tauri.conf.json`, `package.json`, `Cargo.lock` — cibler le **package `pilot`**
   précisément, jamais de `sed` global : incident v0.2.30 — et la version du workspace), +
   `release-notes/v0.4.36.md` rédigé en français orienté utilisateur.
2. **[BLOQUANT — mécanique]** Pousser `main` **puis** créer et pousser le tag `v0.4.36`
   (5 commits locaux non poussés : `git rev-list --count origin/main..HEAD` = 5).
3. **[BLOQUANT — mécanique]** Vérifier la clé de signature (`TAURI_SIGNING_PRIVATE_KEY`) et
   relancer `cargo test --manifest-path src-tauri/Cargo.toml --lib` après le bump de
   `Cargo.lock` (anti-régression du verrou) — même si rien n'a bougé côté Rust.
4. **[RECOMMANDÉ, non bloquant]** Régénérer `help/handbook.md`
   (`npm run build:handbook`) et l'inclure dans le commit de bump → R-C.
5. **[RECOMMANDÉ, non bloquant]** Corriger R-A (remise **en tête** d'une mission défilée) + test
   dédié « mission défilée qui ne peut pas démarrer revient en tête » : c'est ce qui rendrait la
   promesse de P1 **vraie sans réserve**. Correctif de ~5 lignes (`atHead`/`unshift`), risque
   quasi nul.
6. **[RECOMMANDÉ, non bloquant]** Étendre l'identité de projet à `project-task-queue.js` (R-B)
   pour fermer D3 sur la dernière famille de file.

**Aucun de ces points n'exige de toucher aux trois correctifs** : ils sont indépendants les uns
des autres dans les fichiers concernés.

---

## 11. Ce que je n'ai pas prouvé

- **R-A n'est pas prouvée par l'exécution** : elle est **prouvée par lecture** de la chaîne
  `:1055 → :4723 → :4729 → :4732 → :4741 → :554` (aucune mutation ne la déclenche, aucun test ne
  la couvre aujourd'hui). Le scénario qui la déclenche (bus occupé par une **lecture** ou une
  **commande manuelle** au moment du rejeu) n'a pas été reproduit de bout en bout.
- **La coexistence « rejeu (sessions) » / « admission (bus) »** n'a pas été observée en
  fonctionnement réel (pas d'app à disposition) : l'analyse est statique.
- **Rust** : non exécuté (aucun fichier Rust modifié) — un `cargo test` complet avant release
  reste indispensable, il n'a pas été lancé ici.
- Le rendu **UI** (messages affichés, libellés de file) n'a pas été vérifié à l'écran ; seuls les
  textes produits par le code ont été lus.

---

*Relecture effectuée sans écriture de code, sans commit, sans tag, sans changement de version.
Seul fichier créé : ce rapport.*
