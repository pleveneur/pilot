# Rapport — une question d'agent ne reste plus sans surface (ni sans fin)

> Point 3 « DÉTONATEUR » du diagnostic de gel (`RAPPORT-gel-session-pilot.md`),
> après le correctif `551c944` qui a levé le blocage du thread principal Tauri.
> Défaut protégé ici : **une question posée par un agent ne trouvait pas toujours
> quelqu'un pour l'afficher**, et quand c'était le cas, **l'attente ne se terminait
> jamais** — la file du projet restait réservée jusqu'au plafond de 45 min.

---

## 1. Le défaut, tel qu'il était écrit

`agents-bus.js` (les agents lancés par l'Assistant) émet la question de l'agent
sur `window` (`AGENT_RELAY_EVENT = "pilot-agent-relay-request"`). **Un seul
écouteur existait** : celui de l'onglet 🧭 Assistant (`onAgentRelayRequest`),
posé à la **création** de l'onglet et **retiré à sa fermeture**.

Conséquences, onglet 🧭 fermé :

1. **Personne ne peignait la question.** L'utilisateur ne pouvait pas répondre —
   pas par négligence : il n'y avait rien à l'écran.
2. **L'attente restait ouverte.** Rien ne la terminait : `pi` attend
   `extension_ui_response`, l'agent ne travaille plus, et le couple
   (projet, agent) garde son créneau ⇒ les demandes suivantes du projet
   attendent derrière un agent qui attend lui-même quelqu'un.
3. Le commentaire d'en-tête d'`agent-choice-relay.js` (et de
   `agents-bus.js` ~3069) affirmait que la limite de 45 min
   (`anomaly::AWAITING_USER_MAX_SUSPEND_SECS`) « empêche le gel de la file » :
   c'est **inexact**. Elle **borne** l'attente (elle la coupe au bout du
   plafond), elle ne la **résout** pas et ne répond jamais.

## 2. Ce qui a changé

| Fichier | Nature | Rôle |
|---|---|---|
| `src/js/agent-question-surface.js` | **créé** (PUR) | SOURCE UNIQUE : qui peint (`decideAgentQuestionSurface`), registre de prise en charge (`claimAgentQuestion`…), vue de la question, formats de réponse, textes |
| `src/js/agent-question-fallback.js` | **créé** (DOM) | surface de SECOURS : installée avec l'application, réutilise les dialogues existants et le routage existant |
| `src/js/main.js` | édité | `initAgentQuestionFallback()` au démarrage (jamais à l'ouverture d'un onglet), sous `try/catch` |
| `src/js/agents-bus.js` | édité | relit le registre après émission ; si personne n'a pris la question ⇒ `terminateUnanswerableQuestion` ; commentaire 45 min corrigé |
| `src/js/super-agent.js` | édité | l'onglet 🧭 **prend** la question avant de la peindre, enregistre/retire sa surface (jeton) ; `respondAgentRelay` exporté ; `responder` normalisé + libération de la prise |
| `src/js/agent-pi.js` | édité | dialogues de choix **exportés** (`domConfirm`, `domSelect`, `domPrompt`) + `domMultiSelect` (cases à cocher) ; `_domDialog` accepte un corps DOM et un `okValue` calculé au clic |
| `src/js/agent-choice-relay.js` | édité | en-tête corrigé : 45 min = **bornage**, pas résolution ; « question sans surface » = attente terminée |
| `src/js/agent-stop-funnel.test.js` | édité | cardinalités des sites d'arrêt mises à jour (nouveau site **entonnoiré**, aucune assertion assouplie) |
| `src/js/agent-question-surface.test.js` | **créé** | 25 tests (décisions pures + comportement réel du bus + gardes de source) |
| `spec_gestion_agents.md`, `spec_super_agent.md` | édités | comportement décrit (aide + technique) ; `help/handbook.md` régénéré |

**Aucun nouveau bouton, aucun nouvel écran, aucun second dialogue** : la surface
de secours réutilise les dialogues de choix déjà utilisés par l'application
(`agent-pi.js`) et la **même** voie de réponse que l'onglet
(`respondAgentRelay` → `send_agent_command_to`).

## 3. Où la question s'affiche désormais

`decideAgentQuestionSurface({ primarySurface, appDialogAvailable })` tranche, dans
cet ordre :

1. **onglet 🧭 ouvert** ⇒ c'est lui (comportement inchangé : boutons de choix dans
   la conversation, file `#pendingBar`, champ de précision) ;
2. **sinon** ⇒ **surface de secours** : le dialogue de choix habituel de Pilot,
   avec l'en-tête « 🤖 L'agent « codeur » du projet « X » attend votre réponse : … » ;
   choix simple, choix multiple (cases), confirmation (Oui/Non), saisie libre ;
3. **sinon (aucune surface)** ⇒ voir § 4.

La réponse repart par `respondAgentRelay(projectPath, agentId, id, value, cancelled)`
→ `invoke("send_agent_command_to")` : **le même endroit du bus**, quelle que soit
la surface qui a peint. Les formats sont exactement ceux qu'attend
`pilot-choices.ts` (`{"selected":…}`, `{"selected":[…]}`, `{"confirmed":…}`, texte
brut pour une saisie, `{cancelled:true}` pour un refus).

Rien de technique n'est peint : les sentinelles de présentation
(`PILOT_MULTI_CHOICE::`, `PILOT_CONFIRM::`) sont **déballées**, et une sentinelle
**machine** (`PILOT_*::`) n'est jamais présentée à l'utilisateur — elle reçoit la
réponse explicite déjà utilisée par le relais de l'onglet.

## 4. Sans aucune surface : l'attente se termine, elle ne reste pas ouverte

`agents-bus.js` relit le registre **juste après** avoir émis l'événement (la prise
en charge se fait avant tout `await`, donc elle est visible de façon synchrone).
Si **personne** n'a pris la question :

1. **message explicite** (conversation de l'Assistant + notification ⚠️) :
   « L'agent « codeur » attend une réponse qui ne peut pas être affichée (…) :
   l'attente est donc TERMINÉE — l'agent est arrêté et son créneau libéré (motif
   journalisé dans `.pilot/agent-stops.log`). Aucune réponse n'a été décidée à
   votre place. » ;
2. **trace écrite AVANT l'arrêt**, par l'entonnoir **unique** de la règle 3
   (`stopAgentWithTrace`) : motif **littéral** `question-sans-surface`, détecteur
   `relais-sans-ecouteur`, agent, projet, uid de session ;
3. **arrêt effectif** (`abort_agent_process` avec `expectedUid`) ⇒ file libérée.

Ce chemin ne décide **jamais** à la place de l'utilisateur : ni
`confirmed: true`, ni première option, ni annulation silencieuse.

Un dialogue qui refuse de s'ouvrir (erreur DOM) produit de la même façon une
réponse **explicite** (`cancelled: true`) — jamais une attente infinie.

## 5. Les quatre points demandés

1. **Surface de secours disponible onglet fermé** — `agent-question-fallback.js`,
   installée par `main.js`, mêmes boutons de choix, réponse au même endroit du
   bus. ✔
2. **Aucune surface ⇒ attente terminée** — `terminateUnanswerableQuestion`
   (message clair + file libérée + trace comme les autres arrêts automatiques). ✔
3. **Commentaire inexact corrigé** — `agent-choice-relay.js` et
   `agents-bus.js` disent maintenant que la limite de 45 min **borne** l'attente
   (elle libère la file au bout du plafond) et ne la résout pas. ✔
4. **Un seul écouteur par question** — voir § 6. ✔

## 6. Preuve qu'un seul écouteur traite chaque question

- Les deux écouteurs possibles (onglet 🧭 et surface de secours) passent par le
  **même registre** (`claimAgentQuestion`, module pur). Le **premier** obtient la
  question ; tout suivant est refusé ⇒ **aucun double affichage, aucune double
  réponse**.
- La prise en charge est faite **avant tout `await`** : l'émetteur la voit
  immédiatement après `dispatchEvent` et n'a pas besoin d'attendre.
- Quand l'onglet 🧭 est ouvert, `hasPrimaryAgentQuestionSurface()` est vrai : la
  surface de secours **s'abstient** (elle ne peint pas, elle n'envoie rien).
  Test dédié : `onglet 🧭 OUVERT — un seul ecouteur traite la question`.
- `initAgentQuestionFallback` est **idempotent** : deux appels ⇒ **un** écouteur
  (vérifié sur le `window` de test).
- L'enregistrement/retrait de la surface de l'onglet se fait avec un **jeton
  propre à l'onglet** : un onglet fermé ne peut pas retirer la surface d'un onglet
  ouvert après lui (test dédié).
- La prise est **libérée** après la réponse : une réémission de la même question
  pourra de nouveau être servie.

## 7. Défaut connexe trouvé et corrigé (même chemin)

En branchant la surface de secours, un décalage d'arguments a été trouvé sur le
`responder` de l'onglet 🧭 : la barre des questions appelle
`responder(id, value, cancelled)`, alors que le relais définissait
`responder(value, cancelled)`. Résultat : **toute réponse donnée à une question
relayée partait comme `cancelled: true`** (choix perdu, agent croyant à une
annulation). Aucun test ne couvrait ce chemin.

Correction : `normalizeAgentAnswerArgs` (module pur, testé) accepte les **deux**
formes d'appel ; le responder du relais l'utilise, et libère la prise en charge
après transmission. Le comportement « demandes internes » (2 arguments) est
conservé à l'identique.

## 8. Tests et résultats

Nouveau fichier : `src/js/agent-question-surface.test.js` — **25 tests**, dont :

- décisions pures : priorité des surfaces, une seule prise en charge par question,
  clé de question, jeton de surface, en-tête, vues (select/confirm/input/multi),
  débalage des sentinelles, sentinelle machine jamais peinte, formats de réponse,
  normalisation des arguments ;
- **comportement réel du bus, onglet fermé** : la question est affichée une fois
  (options intactes) et la réponse repart avec le bon projet, le bon agent, le bon
  id et le bon format ; aucun arrêt ;
- **dialogue impossible** : refus explicite, jamais une attente ouverte ;
- **onglet ouvert** : un seul porteur (la surface de secours ne peint rien) ;
- **aucune surface** : notification explicite (`notifyType: "error"`), trace
  `reason=question-sans-surface` / `detected=relais-sans-ecouteur` dans
  `agent-stops.log`, **arrêt effectif** (`abort_agent_process`), **aucune réponse**
  envoyée au moteur ;
- **gardes de source** : `main.js` installe la surface (sous `try/catch`), le bus
  appelle bien `terminateUnanswerableQuestion` avec les motifs littéraux, l'onglet
  prend la question et enregistre/retire sa surface, les quatre dialogues
  réutilisés sont exportés.

### Preuve que le test échoue SANS le correctif (vérifié)

- En supprimant l'appel `if (!prise) await terminateUnanswerableQuestion(…)` :
  `1 failed | 20 passed` — le test « SANS aucune surface » échoue sur le message
  (il ne reçoit que l'ancien « ❓ L'agent codeur attend votre réponse »), et aucun
  arrêt n'est demandé.
- En supprimant l'installation de l'écouteur de secours (état d'avant le
  correctif) : `3 failed | 18 passed` — la question n'est **pas** affichée et
  aucune réponse ne repart.

### Suites complètes

| Commande | Résultat |
|---|---|
| `npm test` | **5113 tests** (5088 avant ce correctif + 25 nouveaux), **tous verts** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **819 passés, 1 ignoré** |

Aucun test existant supprimé ni assoupli. Seules les **cardinalités** de deux
fichiers de contrôle ont été mises à jour, car le nouveau site d'arrêt est
**entonnoiré** :

- `agent-stop-funnel.test.js` : total 9 → 10, entonnoirés 8 → 9, appelants
  vérifiés 7 → 8, `abort_agent_process` 4 → 5 ;
- `agent-stop-trace-paths.test.js` : sites `abort_agent_process` du bus 4 → 5,
  sites tracés 3 → 4, appels d'entonnoir 8 → 9, points de trace du bus 26 → 27.

Les deux fichiers portent désormais le commentaire expliquant le site ajouté
(`terminateUnanswerableQuestion`, motif `question-sans-surface`).

## 9. Ce que ce correctif ne fait pas

- Il ne change **aucune** règle de travail de l'assistant, aucun garde-fou, aucun
  seuil de détection, aucune durée.
- Il ne touche pas au relais de l'onglet chat (`agent-pi.js`), qui garde sa
  condition d'affichage propre.
- Il ne décide jamais à la place de l'utilisateur et **n'invente aucune réponse**.

## 10. Commit

Commit unique (conventional, anglais) :
`fix(agents): une question d'agent trouve toujours une surface ou se termine`
(single commit local — hash exact : `git log -1 --format=%H`)
