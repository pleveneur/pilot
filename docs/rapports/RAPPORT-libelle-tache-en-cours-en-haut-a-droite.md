# Rapport — le texte de la tâche « en cours » (colonne de droite de l'écran Vocal)

Date : 2026-11-14 · Projet : `G:\IA_PL\pilot`
Demande du propriétaire : dans la colonne de droite de l'écran Vocal (la zone qui
liste les tâches du projet quand il n'y a ni image de personnage ni avatar), **le
texte affiché pour la tâche en cours ne correspond pas à ce qui tourne
réellement**. Indice : *« quand il y avait encore les 2 tâches en cours, c'était
bon »* — juste avec deux missions (une en cours, une en file), faux avec une
seule.

Ce rapport est écrit **avant** toute modification de code.

---

## 1. La chaîne d'affichage, de bout en bout

| Étape | Fichier:ligne |
|---|---|
| Le bus envoie le prompt de la mission | `src/js/agents-bus.js:4185-4187` |
| …après avoir démarré/repris la session | `src/js/agents-bus.js:4142` |
| Le cœur écrit la commande et retient prompt + résumé | `src-tauri/src/agent_service.rs:1898-1916` (`record_prompt` `:1860`, `record_resume` `:1876`) |
| La vue d'ensemble expose `prompt` et `resume` | `src-tauri/src/dashboard.rs:1299-1306` |
| Le magasin d'activité ne relit cette vue que FORCÉ | `src/js/agent-activity.js:1006-1024` (`planActivityRefresh`), `:1119` (`activityRefresh`), `:1079-1102` (`runActivityRefresh`) |
| La sonde de 2 s est LÉGÈRE (jamais les champs d'affichage) | `src/js/agent-activity.js:1148` + `:1031-1067` (`mergeProbeActivity` : vivacité, outil, horodatage — **jamais** `prompt`/`resume`) |
| `busy`/`working` sont calculés depuis `state` de la vue LOURDE | `src/js/agent-activity.js:161-173` |
| Le libellé de la mission vient de cette vue LOURDE | `src/js/agent-activity.js:554` (`resolveMissionLabel`), `:799-825` (`buildRunningMissions`) |
| La colonne lit le magasin | `src/js/super-agent.js:2404` → `:3832-3848` (`collectSuperMissions`/`publishSuperMissionsCount`) |
| …et peint | `src/js/super-agent.js:2304` (`buildVocalTasksHtml`) après `src/js/vocal-sides.js:866` (`planVocalTasks`) |
| Répétition toutes les 900 ms | `src/js/super-agent.js:2756` (`vocalSyncSides`), `:6861` |

**Il n'y a donc qu'UNE seule source du texte affiché : `prompt`/`resume` de la
sonde LOURDE.** Rien d'autre n'écrit ce libellé — c'est conforme à la décision
« une seule source, pas de second mécanisme ». Le défaut n'est pas là : il est
dans le **moment** où cette vue est relue.

---

## 2. Ce qui déclenche la relecture de la vue LOURDE

Trois cas seulement (`planActivityRefresh`, `agent-activity.js:1006-1024`) :

1. le magasin n'a jamais été alimenté (première passe) ;
2. un push `agent-state-changed` (`agent-activity.js:1142`) ;
3. l'**ensemble** des sessions a changé (démarrage, arrêt, mort) —
   `probeSessionsSignature`, `:977-987` : `projet + agent + vivacité`.

Or **écrire un prompt ne produit aucun des trois** :

- `AgentService::send` écrit `prompt`/`resume` puis rend la main **sans émettre
  d'évènement** (`agent_service.rs:1913-1914`) ; `record_prompt`/`record_resume`
  n'émettent rien (l.1860-1890). `set_state` est le seul émetteur
  (`:1349-1370`), et il est appelé au **démarrage** de la session (`:1520`,
  `:1554`) et à la **remise au repos** (`:1725`, `:1806`) ;
- une session **reprise** (`start()` trouve un processus vivant) ne change pas
  la signature `projet+agent+vivacité` : elle était déjà `1` et le reste.

Autrement dit, pour une mission lancée sur une session déjà vivante — le cas
courant après la première mission, les processus pi des agents restant parqués
vivants — la vue LOURDE n'est relue **ni au démarrage de la mission, ni pendant,
ni à sa fin autrement que par le push de remise au repos**.

---

## 3. Le décalage d'un cran — reproduction des deux cas

### Cas A — une seule mission en cours (le cas faux)

1. La mission **A** tourne. À sa fin, le bus remet l'agent au repos
   (`agents-bus.js:1761-1780` : `set_agent_state(busy:false, Paused)`), ce qui
   **émet** `agent-state-changed` ⇒ la vue LOURDE est relue **à cet instant** :
   `prompt`/`resume` valent **A** (le prompt de A a bien été écrit au début de
   A). L'agent ne travaille plus ⇒ aucune ligne « en cours ».
2. La mission **B** démarre : `start_agent_process` (`agents-bus.js:4154`) →
   `set_state(Running)` → **émet** (`agent_service.rs:1520`) ⇒ relecture LOURDE.
   Mais à ce moment le prompt de **B n'a pas encore été envoyé** : le bus enchaîne
   encore `new_agent_process_session` → `set_agent_process_model` (deux allers-
   retours IPC, dont un `set_model` qui attend pi) → niveau de réflexion
   (`agents-bus.js:4173-4182`) avant `sendPromptToAgent` (`:4185-4187`). La
   relecture LOURDE lit donc **`prompt`/`resume` = A**.
3. Pendant tout le tour de B : la sonde de 2 s est LÉGÈRE (`prompt`/`resume` non
   portés), la signature ne change pas (session vivante avant comme après) ⇒
   **aucune relecture LOURDE**. La colonne affiche donc la mission **A** alors que
   **B** tourne.

C'est exactement le symptôme rapporté : *une seule ligne, un texte qui ne
correspond pas à ce qui tourne*. La ligne apparaît dès qu'un outil tourne
(`toolInProgress` vient de la sonde légère, donc frais, `agent-activity.js:1057`
et `:173`) — c'est-à-dire l'essentiel d'une mission de code — et porte le texte de
la mission précédente.

### Cas B — deux missions (une en cours, une en file) : « c'était bon »

Avec une seconde mission, un **second agent** (ou la même session relancée
derrière une autre) provoque un `set_state` **supplémentaire** : le démarrage de
B émet `agent-state-changed` alors que **A tourne déjà** ⇒ la relecture LOURDE
tombe cette fois **après** l'écriture du prompt de A ⇒ la ligne de A prend le
**bon** texte ; et la ligne de B, encore en file, vient de la mémoire JS
(`runAgentsQueueByProject`, `super-agent.js:3860`), donc du bon texte aussi. Les
**deux** lignes sont justes — par accident : la mission en cours a été « sauvée »
par l'évènement d'une autre. Retirez la seconde mission et il ne reste plus
personne pour forcer la relecture.

C'est la lecture exacte de l'indice du propriétaire, et c'est aussi pourquoi le
défaut est passé inaperçu si longtemps.

---

## 4. Ce qui est écarté

- **Bug « une tâche mise en file en exécute une autre »** : c'est un défaut
  d'**exécution**, déjà corrigé et documenté
  (`docs/rapports/RAPPORT-bug-file-attente-mauvaise-tache.md`). Ici la mission
  exécutée est la bonne ; seul le **texte affiché** est celui d'avant.
- **Composition de la file et rang → mission** : `src/js/project-queue-view.js` /
  `project-task-queue.js` produisent les missions « en attente » ; elles étaient
  justes dans les deux cas. Aucune modification ne les concerne.
- **`planVocalTasks`** (`vocal-sides.js:866`) : il ne fait que répartir les entrées
  reçues en groupes et borner à la hauteur. Il n'invente ni ne remplace aucun
  texte : une entrée fausse en entrée reste fausse en sortie.
- **Le résumé `Some(None)`** (`agent_service.rs:418-430`) : il efface le résumé
  d'une mission précédente — utile, mais il ne peut rien contre un texte qui n'a
  jamais été **relu**.
- **La sonde lourde trop fréquente** : le correctif ne doit pas la remettre dans
  la boucle de 2 s (gel de session, commit `551c944`).

---

## 5. Correctif retenu (au plus près de la cause)

La cause est : **le magasin n'est jamais relu au moment où le texte de la mission
change réellement**. Le correctif consiste donc à demander cette relecture au
**seul moment où une mission commence vraiment** — juste après l'envoi effectif du
prompt, quand le cœur a déjà écrit `prompt`/`resume` :

1. un point d'entrée **unique** dans `agent-activity.js` :
   `refreshAgentMissionDisplay()` — il appelle la relecture LOURDE **existante**
   (`activityRefresh(true)`), donc exactement le chemin déjà utilisé par
   `agent-state-changed`. Aucune nouvelle sonde, aucun nouveau mécanisme ;
2. appelé aux **points d'envoi réels d'un prompt de mission** :
   - `src/js/agents-bus.js` après `sendPromptToAgent` / `sendPromptToAssistantAgent`
     (point unique des missions déléguées, `:4185-4187`) ;
   - `src/js/super-agent.js` après `send_super_agent_prompt` (`:7437`) — la ligne
     de l'Assistant affiche sa propre demande comme texte de mission.

La relecture est **coalescée** si une autre est en vol (`activityRefresh`, `:1119-
1135`), donc l'envoi ne peut pas produire deux lectures concurrentes, et elle est
**postérieure** à l'écriture du prompt (l'`await` de l'invoke d'envoi est déjà
revenu). Aucun changement Rust : `src-tauri` reste en lecture seule.

Effets attendus :

- le texte de la mission en cours est celui de la mission en cours, dès l'envoi
  (≤ le temps d'un aller-retour IPC), et le reste ;
- rien ne change pour les missions en file (mémoire JS, déjà juste) ;
- la sonde lourde n'entre **pas** dans la boucle de 2 s.

---

## 6. Livraison et preuves

Fichiers touchés (rien d'autre) :

- `src/js/agent-activity.js` — point d'entrée unique `refreshAgentMissionDisplay()`
  (+29 lignes, aucune logique déplacée) ;
- `src/js/agents-bus.js` — une demande de relecture après l'envoi du prompt de
  mission (+11 lignes, dont l'import) ;
- `src/js/super-agent.js` — une demande de relecture après l'envoi de la demande
  à l'Assistant (+9 lignes, dont le nom ajouté à l'import existant) ;
- `src/js/libelle-tache-en-cours-mission-reelle.test.js` — **verrou** (8 tests) ;
- `spec_modes_ecran_vocal.md` § 3ter (nouvelle sous-section + bloc d'aide
  `vocal-colonnes-portrait`), `help/handbook.md` régénéré, `AGENTS.md` (ligne de
  navigation) ;
- ce rapport.

Preuves exécutées :

| Vérification | Résultat |
|---|---|
| `npx vitest run src/js/libelle-tache-en-cours-mission-reelle.test.js` **avec** le correctif | 8 tests passés |
| le même test **sans** le correctif (les 3 fichiers de code remis à `HEAD`) | **3 échecs** — les trois ancres du branchement ; les 5 tests de la chaîne pure, qui décrivent le défaut et l'indice des deux missions, restent verts dans les deux états |
| `npm test` (suite complète) | **281 fichiers, 5 177 tests, 0 échec** |
| `node --check` sur les 4 fichiers JS touchés | OK |
| fins de ligne des fichiers modifiés | LF (`.gitattributes` respecté) |
| `cargo` / `src-tauri` | **non touché** |

Ce qui n'a **pas** bougé, et qui devait ne pas bouger : la composition de la file
et le rang → mission (`project-queue-view.js`, `project-task-queue.js`), la sonde
légère de 2 s (aucune relecture lourde dans le tic), l'effacement de la barre du
bas et les règles de `vocalChromeVisible`, les réglages de lecture à voix haute /
VoiceStudio, et les verrous `ecran-vocal-point7-photo-sous-le-cercle.test.js` /
`vocal-taches-en-haut-portrait-en-bas.test.js`.

VERDICT : cause unique confirmée — les champs d'affichage de la mission ne sont
relus qu'à des moments qui ne coïncident pas avec l'écriture du prompt (et jamais
pendant le tour), d'où un décalage d'un cran expliquant **exactement** « juste
avec deux tâches, faux avec une ». Correctif au plus près : une demande de
relecture de la vue **existante**, au seul moment où le texte change, aux deux
points d'envoi réels d'un prompt de mission.
