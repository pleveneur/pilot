# Rapport — « Le point de la liste des agents respire, la zone de saisie du chat non »

> Diagnostic demandé par le propriétaire, puis correction minimale.
> Ce rapport est écrit à la racine du projet pour être versionné : le dossier
> `.pilot/` est ignoré par Git (`.gitignore:44`) ; les journaux bruts des
> vérifications y sont déposés quand même (`.pilot/rapports/*.log`).

## 1. Le symptôme rapporté

Dans Pilot, la liste des agents (haut à droite) montre qu'un agent travaille
(son point « respire »). Dans la zone de saisie du chat, aucune pulsation : au
moment d'écrire, rien ne dit que le travail continue ailleurs.

## 2. Où respire le point de la liste des agents (preuves)

| Rôle | Fichier:ligne |
|---|---|
| Calcul unique « est-ce que ça travaille ? » | `src/js/agent-activity.js:254` (`isAgentWorking`) et `src/js/agent-activity.js:233` (`anyBusy`) |
| Store partagé (poll 2 s + push `agent-state-changed`) qui produit `busy` | `src/js/agent-activity.js:700-750` ; abonnement public `src/js/agent-activity.js:739` (`subscribeAgentActivity`) |
| Point du cercle en haut à droite : `dot.classList.toggle("breathing", busy)` | `src/js/agent-activity.js:928-931` |
| Point de chaque entrée de la liste déroulante | `src/js/agent-activity.js:840`, `src/js/agent-activity.js:864` (`isAgentWorking(a) ? "breathing"`) |
| Point poignée du mode « assistant seul » | `src/js/agent-activity.js:789` |
| Feuille de style du point qui respire | `src/css/style.css:1391` (`#agent-activity-dot.breathing`), `src/css/style.css:1538` (`.agent-activity-item-dot.breathing`), animation `@keyframes agent-pulse` `src/css/style.css:3972` |

Conclusion partielle : **une seule** vérité de travail existe déjà
(`anyBusy(list)`, exposée par `subscribeAgentActivity(cb)` → 2e argument
`busy`). Tout ce qui respire dans la liste consomme cet état.

## 3. Existe-t-il un indicateur prévu pour la zone de saisie ?

**Oui — pour la conversation de l'Assistant (onglet 🧭)**, et il est déjà
branché, mais sur le **mauvais** état :

| Rôle | Fichier:ligne |
|---|---|
| Classe `superagent-input-reflecting` posée sur la barre de saisie | `src/js/super-agent.js:3009-3020` (`applyReflecting`) |
| Styles + animation de respiration du champ | `src/css/style.css:4127` (`.agent-chat-input-bar.superagent-input-reflecting .agent-input`) et `@keyframes assistant-input-breathe` `src/css/style.css:4146` |
| Décision pure (événement RPC → réflexion) | `src/js/super-agent.js:379` (`superAgentReflectingFromEvent`) |
| Alimentation réelle de l'état | `src/js/super-agent.js:3606` (`setReflecting(true)` au seul envoi d'un prompt), `src/js/super-agent.js:3272-3277` (`onEnd` → `setReflecting(false)`), `src/js/super-agent.js:3783-3800` (poll `get_agent_supervision` → `processing` de la **seule session de l'Assistant**) |

Pour l'onglet de l'agent du projet (π) : la barre de saisie
(`src/js/agent-pi.js:552-562`, classe `agent-chat-input-bar`) **n'a aucun**
branchement de ce type ; elle possède en revanche un libellé d'état
« Réflexion… » clignotant (`src/js/agent-pi.js:1003-1018` via
`resolveAgentStatus`, `duree-travail.js`).

## 4. Causes classées de la plus probable à la moins probable

### Cause n° 1 — **TRANCHÉE** : la zone de saisie suit la session de l'Assistant, pas le travail des agents

`applyReflecting()` ne calcule que
`reflectingActive && !hasPendingQuestion()` (`src/js/super-agent.js:3010`), et
`reflectingActive` ne vient que de `agent_start` / `agent_end` de la **session
RPC de l'Assistant** (`src/js/super-agent.js:3606`, `:3272`, `:3783-3800`).

Or `delegate_to_coder` **rend la main dès la transmission**
(`src-tauri/extensions/pilot-assistant-actions.ts:433-461`, description
explicite : « L'outil rend la main dès que Pilot a TRANSMIS la demande »).
Conséquence : l'Assistant reçoit son `agent_end` alors que l'agent du projet
**commence** à travailler. Le cercle du haut (état global, `anyBusy`) respire
donc toujours, tandis que la barre de saisie retombe immédiatement au repos.

C'est exactement le symptôme décrit : on écrit dans la conversation de
l'Assistant pendant qu'un agent délégué travaille, et rien ne pulse.

### Cause n° 2 — deux calculs de « est-ce que ça travaille ? » au lieu d'un

Le dépôt revendique **une seule** vérité (`agent-activity.js:243-250` :
« Une seule source de verite pour "cet agent travaille-t-il ?" »), mais la
barre de saisie s'appuie sur un état dérivé de la seule session de l'Assistant
(`backendBusy` / `reflectingActive`). Le second calcul n'est pas faux en soi
(il répond à « l'Assistant réfléchit-il ? »), mais il ne répond pas à la
question posée par l'indicateur global (« un agent travaille-t-il ? »).

### Cause n° 3 — l'onglet de l'agent du projet n'a aucun indicateur de saisie

`agent-pi.js` ne consomme pas `subscribeAgentActivity` (aucun import) : la
barre de saisie n'y respire jamais. Ce n'est pas la cause du symptôme rapporté
(l'onglet π affiche déjà « Réflexion… » qui clignote), mais c'est une
asymétrie à connaître — **volontairement non corrigée** : sur un onglet
d'agent *d'un projet*, faire respirer la saisie sur l'activité **globale**
serait mensonger (le projet affiché pourrait être au repos alors qu'un autre
travaille).

### Cause n° 4 (écartée) — animation CSS jamais appliquée

L'animation existe et fonctionne : `.superagent-input-reflecting .agent-input`
+ `@keyframes assistant-input-breathe` (`src/css/style.css:4127`, `:4146`),
déjà utilisée en mode standard et en mode « assistant seul » (la barre est
déplacée dans l'overlay avec les mêmes classes, `src/js/super-agent.js:3390`).
Aucun style manquant, aucune règle morte.

### Cause n° 5 (écartée) — perte d'événements

`agent-state-changed` et le poll 2 s alimentent correctement le store
(`src/js/agent-activity.js:704-731`) ; le point du haut respire bien, ce qui
prouve que l'état arrive. Le défaut est en aval, côté consommateur.

## 5. Correction minimale proposée (et appliquée)

1. **Réutiliser l'état existant** : s'abonner au store partagé
   (`subscribeAgentActivity`, déjà importé dans `super-agent.js:53`) et
   conserver son booléen `busy` (= `anyBusy(list)`, exactement l'état qui fait
   respirer le point du haut).
2. **Une seule décision**, dans une fonction **pure** exportée et testable :
   `superAgentInputReflecting({ agentReflecting, agentsWorking, pendingQuestion })`
   → la barre respire si l'Assistant réfléchit **ou** si un agent travaille, et
   jamais pendant l'attente d'une question (règle du chantier #132 conservée).
3. **Même style, même animation** : on ne touche pas au CSS ; on pose la
   classe existante `superagent-input-reflecting` sur la barre existante.
4. **Rien d'autre ne change** : l'anneau du logo hero du mode immersif reste
   lié à la seule réflexion de l'Assistant (`sa-immersive-reflecting`), le
   bouton « Analyser et ranger mes données » garde son propre signal, le
   libellé d'état et le bandeau « occupé » sont intacts.
5. **Désabonnement** dans `unlisten` (`src/js/super-agent.js:3931`) pour ne
   pas laisser de fuite à la fermeture de l'onglet.

## 6. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src/js/super-agent.js` | fonction pure `superAgentInputReflecting` + abonnement au store partagé + `applyReflecting` (zone de saisie seulement) + désabonnement dans `unlisten` |
| `src/js/super-agent-reflecting.test.js` | verrou de la nouvelle décision pure (4 cas ajoutés) |
| `RAPPORT-pulsation-zone-saisie.md` | ce rapport (diagnostic + vérifications), à la racine pour être versionné |
| `.pilot/rapports/vitest-reflecting-saisie.log`, `.pilot/rapports/vitest-saisie-travail.log`, `.pilot/rapports/vite-build-saisie-travail.log` | journaux bruts des vérifications |

Aucun fichier supprimé, aucun garde-fou contourné, aucune version modifiée.

## 7. État avant / après

| Aspect | Avant | Après |
|---|---|---|
| Point du cercle en haut à droite | respire si `anyBusy(list)` (état partagé) | **inchangé** |
| Zone de saisie de l'Assistant, l'Assistant réfléchit | respire | **inchangé** |
| Zone de saisie de l'Assistant, un agent délégué travaille (Assistant au repos) | **au repos** (défaut constaté) | **respire** — même état, même classe, même animation que la liste |
| Zone de saisie pendant l'attente d'une question (#132) | pas de teinte | **inchangé** (pas de teinte) |
| Anneau du logo hero (mode assistant seul) | suit la réflexion de l'Assistant | **inchangé** |
| Bandeau « occupé », bouton « Analyser et ranger mes données », libellé d'état | signal propre | **inchangés** |
| Zone de saisie de l'onglet agent du projet (π) | aucun signal de saisie | **inchangée** (voir § 9) |

## 8. Résultat exact des vérifications

| Commande | Résultat |
|---|---|
| `npx vitest run src/js/super-agent-reflecting.test.js` | **PASS (7) / FAIL (0)** — les 3 tests existants (`superAgentReflectingFromEvent`) + 4 nouveaux (`superAgentInputReflecting`) ; log `.pilot/rapports/vitest-reflecting-saisie.log` |
| `npm test` (suite complète) | **exit 0 — 154 fichiers / 2640 tests passés, 0 échec** ; log `.pilot/rapports/vitest-saisie-travail.log` |
| `npm run build` (Vite, graphe de modules) | **exit 0** (seuls les avertissements de découpage de chunks déjà présents) ; log `.pilot/rapports/vite-build-saisie-travail.log` |

Aucun fichier Rust n'a été touché : `cargo test` n'est pas requis par cette
modification (aucune ligne de `src-tauri/` changée).

## 9. Ce qui reste à faire (hors périmètre)

- Décider si l'onglet de l'agent **d'un projet** (π) doit, lui aussi, faire respirer
  sa zone de saisie — il faudrait alors un signal **par projet** (jamais le
  booléen global), ce qui n'existe pas encore côté store. Aujourd'hui cet onglet
  affiche déjà un libellé « Réflexion… » clignotant, qui joue ce rôle.
- Mettre à jour la documentation utilisateur (`help/` / `spec_super_agent.md`
  § indicateur d'activité) si le propriétaire valide le comportement : la zone de
  saisie de l'Assistant respire désormais aussi quand un agent délégué travaille.
