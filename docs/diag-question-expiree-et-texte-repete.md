# Diagnostic — « question à choix qui expire » et « l'assistant redit la même chose »

Projet : `G:\IA_PL\pilot` · Mode : **lecture seule** (aucun code modifié)
Portée : deux défauts signalés par le propriétaire, preuve `fichier:ligne` pour chacun.

---

## DÉFAUT A — Une question à choix cesse silencieusement d'être écoutée

### Symptôme
L'assistant pose une question à boutons. L'utilisateur clique **longtemps après** :
sa réponse s'affiche dans la conversation (« Réponse : … ») mais l'assistant ne la reçoit
pas — il n'attend plus, il est déjà passé à autre chose.

### Cause unique, démontrée
**Chaque question à choix porte une échéance de 30 minutes, et passé ce délai la réponse
tardive est jetée sans aucun signal.**

1. **Création de la question** — `src-tauri/extensions/pilot-choices.ts:62`
   (`ctx.ui.select(params.title, params.options, PILOT_UI_OPTS)` → idem `:112`
   multi-choix, `:155` confirmation, `:200` saisie).
2. **Décision de l'échéance** — `src-tauri/extensions/pilot-choices.ts:44` :
   `const PILOT_UI_OPTS = { timeout: 1800000 };` (30 min, commentaire `:40-43`).
   C'est le **seul** endroit qui décide de l'expiration : aucune borne côté écran
   (aucun `1800000` dans `src/js/`), donc **les boutons restent cliquables
   indéfiniment** — l'écran ne sait pas que la question est morte.
3. **Ce que fait pi à l'échéance** — bibliothèque pi, `dist/modes/rpc/rpc-mode.js:64-68` :
   `setTimeout(() => { cleanup(); resolve(defaultValue); }, opts.timeout)` ;
   `cleanup()` fait `pendingExtensionRequests.delete(id)` (`:57`) et `defaultValue`
   vaut `undefined` pour `select` (`:84`). L'extension reçoit donc `null` et répond à
   l'agent « L'utilisateur a annulé le choix (ou n'a pas répondu dans le délai imparti
   de 30 min). » (`pilot-choices.ts:63-64`) : **l'agent n'attend plus**, il continue.
4. **Réinjection de la réponse (le clic tardif)** — `src/js/super-agent.js:9348-9355`
   (`respondSuperAgent` → `invoke("send_super_agent_command", { command: { type:
   "extension_ui_response", id } })`) ; côté onglet agent `src/js/agent-pi.js:8951` et
   relais `super-agent.js:9359-9367`. La commande part bien jusqu'à pi.
5. **Pourquoi elle n'est plus entendue** — `dist/modes/rpc/rpc-mode.js:616-623` :
   `const pending = pendingExtensionRequests.get(response.id); if (pending) { … } return;`
   L'id a été supprimé à l'étape 3 ⇒ **aucune entrée trouvée ⇒ `return` silencieux** :
   ni erreur, ni trace, ni retour à l'écran.
6. **Ce que voit l'utilisateur** — `src/js/super-agent.js:2406`
   (`appendMessage(superMessagesEl, "user", "Réponse : " + label)`) : la réponse est
   écrite dans le fil **avant/indépendamment** de l'accusé du backend. D'où l'illusion
   exacte du symptôme : « ma réponse est là, mais il n'a pas répondu ».

### Correctif proposé (une ligne de décision)
- **Principal** : retirer l'échéance des dialogues **humains** de `pilot-choices`
  (appeler `ctx.ui.select(…)` **sans** `PILOT_UI_OPTS`, donc sans `timeout` → pi attend
  indéfiniment, `rpc-mode.js:64` ne s'arme pas). Garder la borne là où c'est une machine
  qui attend (`mcp-client.src.ts:96`), pas un humain.
- **Complément indispensable** (sinon le défaut change juste de forme) : quand la question
  n'est plus attendue, **le dire**. Tant que l'écran ne reçoit aucun signal d'expiration,
  la seule façon de ne pas mentir est de ne pas expirer.

### Risque
- `src/js/extensions-ui-timeout.test.js:229-266` **exige** une borne finie et plafonnée
  (`MAX_HUMAN_TIMEOUT_MS = 30 min`) sur **tous** les `await ctx.ui.*` : retirer la borne
  casse ce test. Il faut donc une **exception nommée** pour `pilot-choices.ts`
  (question humaine) et la documenter, plutôt qu'un contournement silencieux.
- Sans échéance, une question jamais répondue **immobilise le tour de cet agent**
  (verrou de projet tenu). C'est le comportement demandé, et il reste sortable :
  ⏹ arrêt, `stop_agent_session`, relais Telegram, et la porte d'inactivité existante.
- Ne **pas** se contenter d'allonger le délai (60 min, 24 h…) : le défaut reviendrait à
  l'identique, simplement plus tard.

---

## DÉFAUT B — « Parfois l'assistant redit mot pour mot ce qu'il venait de dire »

### Les deux hypothèses de l'énoncé
| Hypothèse | Verdict | Preuve |
|---|---|---|
| (a) la synthèse vocale **relit** un message déjà lu (file, rejeu après redémarrage) | **ÉCARTÉE** | `read-aloud.js` : **aucune** file ni persistance (aucune occurrence de `localStorage`/`sessionStorage`) ; une seule lecture vivante (`let currentPlayback` `:238`) et chaque nouvelle lecture **arrête** la précédente (`stopReading()` `:871`) ; lecture locale en **un seul passage** d'indices (`local-voice.js:899-917`, `index++` sans retour) ; le chemin « lecture auto » historique est **mort** (`speakEnabled` déclaré `super-agent.js:1885`, jamais mis à `true`, seule lecture `:6737`). Rien ne peut donc « rejouer » une lecture passée. |
| (b) la même réponse **réémise** dans la conversation (rejeu de message, évènement dupliqué) | **ÉCARTÉE sous cette forme** | Un **seul** abonnement au canal (`super-agent.js:4083`), retiré à la fermeture (`:5985` `origUnlisten()`), donc pas de double rendu par double écoute ; **aucun** rejeu d'historique à l'ouverture (aucun `get_messages` de rendu dans `super-agent.js`) ; le gestionnaire `type === "message"` (`:6654`) est **inatteignable** (pi RPC n'émet que `message_start/message_update/message_end`) ; Telegram, seul autre consommateur du texte, a son anti-doublon (`telegram-messages.js:571`, `isDuplicateMessage`). |

### Cause retenue (démontrée dans le code)
**Pilot traite une fin NON terminale comme la fin du tour.** Une seule racine, deux
effets visibles selon l'écran.

1. `super-agent.js:6700-6723` : sur `agent_end`, le garde-fou **existe et est importé**
   (`shouldFinalizeOnAgentEnd`, `agent-hardening.js:31-34`, qui refuse `willRetry: true`)
   mais il n'est appliqué qu'au **compteur de rappels** (`:6702`). L'appel `onEnd()` de
   `:6723` est **inconditionnel** — et le commentaire de `:6727` prouve que le code sait
   que l'évènement peut ne pas être terminal (« Ignoré si cet agent_end n'est pas
   terminal (la session reprend) »).
2. `onEnd()` est aussi appelé sur des évènements qui ne sont **pas** des fins de tour :
   `message_end` en erreur (`:6660`) et `process_exit`/`process_error` (`:6756`).
3. Or `onEnd()` (`:4084-4117`) remet la bulle à zéro (`currentBody = null`) **et appelle
   `autoReadVocalReply()`** (`:4114`).
   - Effet **audio** (mode Vocal) : `autoReadVocalReply` (`:5439-5456`) reclique le
     **dernier** bouton d'écoute, en ne vérifiant que `dataset.readState === "idle"` — il
     **ne se souvient pas** de ce qui a déjà été lu. Un `agent_end` non terminal (relance
     automatique : `retry.enabled = true`, `maxRetries = 3` par défaut ; ou compaction,
     `compaction.enabled = true`) ou un `process_exit` transitoire ⇒ **la dernière
     réponse est relue mot pour mot**, sans qu'aucune nouvelle réponse n'existe.
   - Effet **conversation** : `currentBody = null` ⇒ la réponse relancée par le backend
     repart dans une **nouvelle bulle** ; le texte de la tentative abandonnée reste
     affiché au-dessus. Deux bulles qui se ressemblent, d'où « il redit la même chose ».
4. Asymétrie établie avec les deux autres chemins, qui **refusent** explicitement une fin
   non terminale : `agent-pi.js:2809`/`:7822` (`auto_retry_start`, `state.isCompacting`,
   issue #54) et `agents-bus.js:2906` (`if (event.willRetry === true)`). `super-agent.js`
   ne gère **pas** `auto_retry_start` du tout.

### Correctif proposé
- Appliquer aux **trois** effets de `onEnd()` le garde-fou déjà présent :
  `if (!shouldFinalizeOnAgentEnd(payload)) return;` avant `onEnd()`, ou à l'intérieur
  (remise à zéro différée, pas de `autoReadVocalReply`, pas de relais Telegram, pas de
  rejeu des comptes rendus).
- Ajouter à `autoReadVocalReply` une **mémoire de ce qui a été lu** (id/référence de la
  bulle ou du texte déjà lu) : une bulle ne se lit **jamais deux fois**.
- Gérer `auto_retry_start` dans `super-agent.js` comme `agent-pi.js:7822` (au minimum :
  ne pas conclure, ne pas lire, ne pas relayer).

### Risque
- Différer `onEnd()` sur une fin non terminale touche l'état « occupé/libre » : si pi
  n'émet **jamais** le `agent_end` terminal (bug backend), l'assistant resterait marqué
  occupé. Prévoir le filet existant (`agent_settled`, la porte d'inactivité 10 min) —
  ne pas inventer une seconde minuterie.
- La mémoire « déjà lu » ne doit pas empêcher une **nouvelle** lecture volontaire du même
  message : c'est un clic utilisateur qui doit rester souverain ; seul l'automatisme
  (mode Vocal) doit être borné.
- Ne pas toucher `read-aloud.js` (aucun défaut démontré : il est hors cause).

---

## Ce qui n'a pas pu être tranché
- **B — la surface exacte** : le code démontre le mécanisme (fin non terminale ⇒ relecture
  et/ou seconde bulle) mais ne permet pas de dire, sans une trace d'exécution, laquelle
  des deux surfaces le propriétaire a vue. **Confirmation en une minute** : dans le
  fichier de session de l'assistant, chercher deux messages `assistant` consécutifs de
  texte identique (bulle doublée) — s'il n'y en a pas, la répétition était **audio**
  (`autoReadVocalReply`), pas conversationnelle.
- Aucun défaut n'a été inventé pour combler un manque de preuve.
