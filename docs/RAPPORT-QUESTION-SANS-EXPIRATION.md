# Rapport — « Une question posée à l'utilisateur n'expire plus »

Projet : `G:\IA_PL\pilot`
Défaut d'origine : une question à choix meurt au bout de 30 minutes, l'écran laisse
les boutons cliquables et un clic tardif est jeté **en silence**
(diagnostic : `docs/diag-question-expiree-et-texte-repete.md`, DÉFAUT A).

---

## 1. Ce qui est modifié, où, et pourquoi

| Fichier | Modification | Pourquoi |
|---|---|---|
| `src-tauri/extensions/pilot-choices.ts` | `PILOT_UI_OPTS = { timeout: 1800000 }` **supprimé** et remplacé par l'**exception nommée** `HUMAN_DIALOG_NO_DEADLINE = Object.freeze({})` (objet d'options **sans** champ d'échéance). Les **4** dialogues humains (`ask_choice`, `ask_multi_choice`, `ask_confirm`, `ask_input`) passent cette exception. Textes de repli corrigés : ils ne parlent plus d'un « délai imparti de 30 min » qui n'existe plus. | C'est **le seul endroit** qui décidait de l'expiration. Sans `timeout`, pi (`createDialogPromise`, `if (opts?.timeout)`) n'arme **aucune** minuterie : la question reste attendue jusqu'à la réponse ou l'annulation. |
| `src/js/extensions-ui-timeout.test.js` | Garde-fou statique **adapté, non neutralisé** : il accepte désormais une **seule exception nommée** (`HUMAN_DIALOG_NO_DEADLINE`), **uniquement** dans `pilot-choices.ts`, et exige que sa déclaration existe et soit bien `Object.freeze({})` (donc sans échéance). Il vérifie en plus que l'exception couvre **exactement 4** appels (aucune extension silencieuse à un dialogue automatique). Tout le reste continue d'exiger une borne finie et plafonnée. | Le test exigeait une borne ≤ 30 min sur **tous** les `await ctx.ui.*` : on ne le supprime pas, on nomme l'exception et on la rend vérifiable. |
| `src/js/super-agent.js` | (a) constante `PENDING_QUESTION_INACTIVE_NOTICE` ; (b) dans `finishPendingQuestion`, le refus d'application (`outcome.applied === false` : question déjà répondue par un autre canal, file avancée, session relancée) n'est **plus un retour silencieux** : `notifyPendingQuestionInactive()` affiche le message via le chemin **existant** `appendSystemMessage`. | Complément indispensable : quand une réponse ne peut plus être transmise, l'écran ne doit pas laisser croire qu'elle est partie. Aucune réponse n'est décidée à la place de l'utilisateur, aucune refonte (2 fonctions, réemploi du rendu système existant). |
| `src/js/question-humaine-sans-expiration.test.js` (**nouveau**) | Prouve le comportement : (1) les **4** dialogues humains ne transmettent **aucune** échéance, sont **toujours posés après 45 min simulées** et la **réponse tardive est reçue** ; (2) **démonstration de la cause** : avec l'ancienne borne de 30 min, la même question meurt et rend `undefined` (le test n'est pas complaisant) ; (3) un dialogue de **MACHINE** (`mcp-client.src.ts`) **garde** une borne finie et plafonnée, et n'utilise pas l'exception ; (4) l'écran **signale** honnêtement une réponse non transmise. | Sans test dédié, la régression reviendrait sans bruit (c'est exactement comme cela que la borne de 30 min a été figée par un test de garde). |
| `spec_rpc.md` | § Extension `pilot-choices.ts` : mention de l'exception nommée (questions humaines sans échéance, dialogues automatiques/MCP bornés, signalement côté écran). | La documentation doit rester cohérente avec le comportement. |

### Ce qui n'est **pas** modifié (et pourquoi)

- **`mcp-client.src.ts`** (dialogue automatique / MCP) : garde sa borne
  (`{ timeout: 1800000 }`) — c'est une **machine** qui attend, pas un humain.
  Les deux cas sont explicitement séparés.
- **`pilot-edit-gate.ts`** (+ toutes les extensions `pilot-assistant-*`) : bornes
  inchangées. La porte pré-écriture est *fail-closed* (un silence = refus), donc
  l'échéance y est un garde-fou légitime, pas un mensonge.
- **`agent_timeout_ms` / porte d'inactivité** : inchangés. Une question sans
  réponse immobilise le tour de cet agent, et cela reste **sortable** :
  bouton ⏹ arrêt, `stop_agent_session`, relais Telegram, porte d'inactivité.
- Aucun autre fichier, aucune version, aucun changelog, aucun geste Git
  destructif.

---

## 2. Résultat des tests (exact)

```
npx vitest run src/js/question-humaine-sans-expiration.test.js src/js/extensions-ui-timeout.test.js
  → PASS (14)  FAIL (0)

npm test
  → Test Files  231 passed (231)
  → Tests       4275 passed (4275)

cargo test --manifest-path src-tauri/Cargo.toml --lib
  → test result: ok. 807 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out (10.51 s)
```

Aucun test n'a été supprimé ni neutralisé : `extensions-ui-timeout.test.js`
compte désormais les appels bornés **et** l'exception nommée (4).

---

## 3. Ce qui reste vrai / limites assumées

- Une question jamais répondue **immobilise le tour de cet agent** (verrou de
  projet tenu) : c'est le comportement **demandé** — une question posée à un
  humain reste valide jusqu'à sa réponse. Les sorties existantes (⏹, arrêt de
  session, porte d'inactivité) restent disponibles.
- L'écran ne reçoit toujours **aucun signal d'expiration** : précisément parce
  qu'il n'y a plus d'expiration. Le signalement introduit à l'étape 4 couvre le
  seul cas restant où une réponse ne peut plus être transmise (question déjà
  répondue ailleurs / file avancée / session relancée).
- Ne pas « rallonger » un jour cette échéance (60 min, 24 h…) : le défaut
  reviendrait à l'identique, simplement plus tard.
