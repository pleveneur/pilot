# Rapport — la zone de saisie de l'assistant clignotait alors qu'il ne travaillait pas

> Symptôme signalé par le propriétaire, diagnostiqué puis corrigé.
> Rapport à la racine du projet pour être versionné (`.pilot/` est ignoré par Git,
> `.gitignore:44`) ; les journaux bruts des vérifications y sont déposés quand
> même (`.pilot/rapports/*.log`).

---

## 1. Le symptôme exact

Dans l'onglet **🧭 Assistant** (suivi multi-projets), la **zone de saisie du chat
clignote en boucle** alors que l'assistant ne travaille pas. Le propriétaire
précise le point décisif : **un seul agent travaille dans Pilot, et ce n'est pas
l'assistant**. L'affichage donne donc l'impression d'un travail qui n'existe pas
dans cet onglet.

## 2. Quelle des quatre causes c'était — tranché par la preuve

Les quatre hypothèses de la mission ont été testées une par une :

| Hypothèse | Verdict | Preuve |
|---|---|---|
| ① le focus est repris en boucle (curseur qui clignote sans focus) | **écartée** | aucun `focus()` périodique : seulement `src/js/super-agent.js:3444` (clic sur une suggestion) et `:7493` (après une question, une seule fois). Aucun `setInterval` ne touche le champ (`:3825` poll de statut, `:4212` ticker de relances, `:4786` sonde de reconnexion : aucun ne fait `focus()`). |
| ② un indicateur d'attente reste affiché | **c'est la cause, sous sa forme « animation »** | voir §3 : la classe d'état reste **posée**, donc l'animation CSS tourne sans fin. |
| ③ une animation de bordure/fond tourne en boucle sur la zone | **c'est exactement elle** | `src/css/style.css:5081` (`.agent-chat-input-bar.superagent-input-reflecting .agent-input`) → `src/css/style.css:5092` `animation: assistant-input-breathe 1s ease-in-out infinite;`, images clés `src/css/style.css:5100`. Rien d'autre n'anime `.agent-input` (`:5130-5150` : bordure de focus **statique**). |
| ④ la zone est reconstruite plusieurs fois par seconde | **écartée** | la barre et son `<textarea>` sont créés **une seule fois** à la construction de l'onglet ; aucun `innerHTML` n'est réappliqué sur la barre ; un seul `requestAnimationFrame` existe (fin de flux, `:1848`), et il ne concerne que le rendu du texte de la réponse. |

**Conclusion : cause ③** — une animation CSS `infinite` posée par une classe
d'état, que **rien ne retirait** dans le cas signalé.

## 3. La cause exacte (preuve fichier:ligne)

L'animation est commandée par la classe `superagent-input-reflecting`. La
décision de la poser incluaitt **deux** sources :

1. `agentReflecting` — l'assistant lui-même (correct, remis à zéro : voir §4) ;
2. `agentsWorking` — **l'état GLOBAL « au moins un agent travaille »** du store
   partagé `agent-activity.js`.

Ce second terme est la cause. Il est introduit par le commit
`9d4ee92` (« la zone de saisie respire aussi quand un agent délégué travaille »),
qui a fait exactement l'inverse de ce que le propriétaire souhaite :

| Rôle | Preuve (avant correctif, commit `9d4ee92` / état courant) |
|---|---|
| Décision « la barre respire » incluant l'état global | `src/js/super-agent.js:409` (commit `9d4ee92`) : `return e.agentReflecting === true \|\| e.agentsWorking === true;` |
| Alimentation par le store global | `src/js/super-agent.js:3073` (commit `9d4ee92`) : `subscribeAgentActivity((_list, busy) => { … agentsWorkingActive = working; applyReflecting(); })` |
| L'état global est **tous les agents de tous les projets** | `src/js/agent-activity.js:734` : `currentActivityBusy = anyBusy(list)` ; `:237` : `anyBusy(list) = list.some(isAgentWorking)` ; `:261-267` : travail réel = `working \|\| busy \|\| toolInProgress` |
| Un agent qui travaille est **toujours** dans la liste, quel que soit son projet ou son onglet | `src/js/agent-activity.js:157-161` : une session qui travaille n'est jamais écartée (`if (!isSuper && !isAssistant && !working) { … continue; }`) |
| Abonnement notifié **immédiatement** avec le dernier état connu | `src/js/agent-activity.js:763-770` (`subscribeAgentActivity` : `cb(currentActivityList, currentActivityBusy)` dès l'abonnement) |
| Animation sans fin | `src/css/style.css:5092` (`animation: … infinite`) |

Conséquence mécanique : dès qu'**un seul** agent travaille — agent d'un projet,
agent délégué, agent sans onglet, ou agent resté `running` — `anyBusy(list)` est
vrai, la classe reste posée sur la barre de saisie de l'onglet 🧭, et
`assistant-input-breathe` tourne **en boucle à 1 s** : c'est le clignotement
observé, alors que l'assistant est au repos.

## 4. Pourquoi cela ne touchait que ce cas

Trois éléments expliquent la précision du symptôme :

- **L'assistant, lui, était correctement remis à zéro.** Sa part
  (`reflectingActive`) est alimentée par sa **seule** session et retombe à `false`
  dès qu'il ne traite plus : `src/js/super-agent.js:3676` (envoi → `true`),
  `:3341` (fin de tour, rappel `onEnd` de `handleSuperAgentEvent` → `false`),
  `:3686` (échec d'envoi), et surtout le poll 2 s
  `src/js/super-agent.js:3871-3887` (branche `else if (!processing)` →
  `setReflecting(false)`). En clair : **la moitié « assistant » de la décision se
  remettait bien à zéro ; c'est la moitié « état global » qui restait vraie.**
- **Un seul agent suffit.** `anyBusy` est un `some(...)` sur la liste de **tous**
  les projets : il n'y a aucune notion de « l'agent de cet onglet ». Le drapeau ne
  dit pas *qui* travaille — exactement la piste de la mission (« plusieurs
  sources, une seule remise à zéro »).
- **Rien n'était visible ailleurs** : le point qui respire de la liste des agents
  et le compteur « Travail » **doivent** réagir au travail de n'importe quel
  agent — c'est leur rôle. Seule la zone de saisie de l'assistant n'aurait pas dû
  suivre cet état global.

## 5. Lien avec l'autre diagnostic en cours (compte-rendu de fin de mission)

Oui, les deux sont liés, sans être la même chose : si un agent délégué ne remonte
pas sa fin de mission, son état reste `running` → `anyBusy` reste vrai **très
longtemps** → la barre clignotait **sans limite**, ce qui explique le « en
permanence » du symptôme. La correction ci-dessous **supprime cette dépendance** :
même un état global bloqué ne peut plus faire clignoter la zone de saisie de
l'assistant. Le défaut de remontée du compte-rendu, lui, **n'est pas corrigé
ici** (hors périmètre) et reste à traiter par son propre chantier.

## 6. La correction appliquée (et pourquoi elle est minimale)

Trois changements, aucun ajout de fonctionnalité :

1. **`src/js/super-agent.js:398-427`** — `superAgentInputReflecting` ne répond
   plus qu'à **une** question : « l'assistant travaille-t-il, lui ? »
   (`agentReflecting`), la règle `pendingQuestion` (chantier #132) étant
   conservée. Toute autre clé d'un objet d'états est **ignorée** : aucun second
   état ne peut rallumer la barre sans passer par cette fonction.
2. **`src/js/super-agent.js:3073-3090`** — `applyReflecting` ne compose plus
   qu'avec la session de l'assistant ; l'abonnement au store global
   (`agentsWorkingActive` + `subscribeAgentActivity((_list, busy) => …)`, qui se
   trouvait juste après) et son désabonnement dans `unlisten` sont **supprimés**.
3. Commentaires remis en accord avec le code (`:3052-3055`, `:3865-3866`,
   `:3883-3886`) — un commentaire qui décrit un comportement disparu est un piège
   pour la prochaine session.

Pourquoi c'est **minimal** :

- **une seule ligne de décision** change de sens (le `|| …agentsWorking`) ;
- le style et l'animation CSS **ne bougent pas** d'un caractère : la classe, le
  dégradé et les images clés existants sont réutilisés tels quels ;
- l'indicateur d'attente **n'est pas supprimé** : il fonctionne quand il est
  justifié (l'assistant travaille → la barre respire, et s'arrête dès la fin) ;
- **aucun** autre indicateur n'est touché : point qui respire de la liste,
  pastilles d'onglet, compteur « Travail », bandeau « occupé », bouton
  « Analyser et ranger mes données », anneau du logo du mode assistant seul,
  libellé d'état gardent leur propre signal et leur propre alimentation ;
- **aucun** envoi de message, contenu de conversation, file d'attente de projet,
  bandeau, logo, colonne de gauche ni coin haut droit n'est modifié.

## 7. Ce qui ne devait pas bouger et n'a pas bougé

| Zone | État |
|---|---|
| Envoi des messages, streaming, contenu des conversations | inchangé |
| File des commandes du projet (`project-task-queue.js`, `project-queue-view.js`) | **non modifiée** |
| Bandeau, logo/moteur, colonne de gauche, boutons du coin haut droit | **non modifiés** |
| Point qui respire de la liste des agents + compteur « Travail » (état global) | **non modifiés** — ils réagissent toujours au travail de n'importe quel agent |
| Anneau pulsant du logo hero (mode assistant seul) | inchangé (lié à la seule réflexion de l'assistant, comme avant) |
| Bandeau « occupé », bouton « Analyser et ranger mes données », libellé d'état | inchangés |
| CSS (aucune règle ajoutée, retirée ou modifiée) | **inchangé** |
| Rust (`src-tauri/`) | **aucun fichier touché** → `cargo test` non requis |

## 8. Vérification : ce qui est vérifiable sans écran, et comment

Le défaut **est** vérifiable sans écran, à deux niveaux :

1. **La décision** est une fonction pure : elle est maintenant verrouillée par
   des tests qui **échouent si le défaut revient** —
   `src/js/super-agent-reflecting.test.js` :
   - « NE respire PAS quand seul un AUTRE agent travaille » : `{ agentReflecting: false, agentsWorking: true }` → `false` (et une clé `busy` globale est
     également ignorée) ;
   - la règle `pendingQuestion` et le cas « l'assistant réfléchit » restent
     vérifiés (comportement normal préservé) ;
   - **verrou de source** : `src/js/super-agent.js` ne contient plus la chaîne
     `agentsWorking`, et **aucun** `subscribeAgentActivity(...)` n'y consomme le
     drapeau global `busy`. C'est ce second verrou qui attrape le retour du
     défaut là où il vivait vraiment (dans l'alimentation, pas dans la fonction).

2. **Ce qui n'est pas vérifiable sans écran**, et que j'annonce franchement : le
   rendu visuel de l'animation (le clignotement lui-même) et le fait qu'un agent
   réel reste bloqué en `running`. Je ne les ai pas simulés ; ce que j'ai vérifié
   à la place, c'est la chaîne complète **état → décision → classe**, et le fait
   qu'aucune autre source ne peut poser cette classe (test de source ci-dessus +
   `applyReflecting` désormais alimenté par un seul état).

## 9. Tests et vérifications réellement passés

| Commande | Résultat |
|---|---|
| `npx vitest run src/js/super-agent-reflecting.test.js` | **PASS (9) / FAIL (0)** — 3 tests historiques (`superAgentReflectingFromEvent`) + 6 tests de la nouvelle décision et des verrous de source |
| `npm test` (suite complète) | **exit 0 — PASS (3226) / FAIL (0)** ; journal `.pilot/rapports/vitest-clignotement-saisie.log` |
| `npm run build` (Vite, graphe de modules réel) | **exit 0** — seuls les avertissements de découpage de chunks déjà présents ; journal `.pilot/rapports/vite-build-clignotement-saisie.log` |
| `npm run build:handbook` (aide intégrée régénérée) | **exit 0** — `help/handbook.md` régénéré (45 blocs) : la phrase utilisateur décrit désormais le comportement corrigé |
| `cargo test` | **non lancé, volontairement** : aucun fichier de `src-tauri/` ni de `gds-*` n'a été modifié |

## 10. Documentation mise à jour

| Fichier | Nature |
|---|---|
| `spec_super_agent.md` § « Mode Assistant seul » | la phrase utilisateur dit maintenant : la zone respire **uniquement** pendant le travail de l'assistant ; le travail d'un autre agent n'allume jamais cette zone (c'est le point de la liste et le compteur « Travail » qui l'indiquent) |
| `spec_super_agent.md` § « Technique — signal de travail de la zone de saisie 🧭 » | section réécrite : une seule décision, une seule alimentation, plus aucun couplage `anyBusy`, ce que gardent les autres indicateurs, et les tests |
| `spec_super_agent.md` (fin de section) | renvoi vers ce rapport ; l'ancien rapport est cité comme **historique** |
| `RAPPORT-pulsation-zone-saisie.md` | bandeau d'avertissement en tête : correction **abandonnée** (elle produisait ce clignotement), renvoi vers ce rapport |
| `src/js/agent-activity.test.js` (commentaire) | précise que la liste aplatie alimente le point, les pastilles et le compteur — plus la zone de saisie |
| `help/handbook.md` | **généré** via `npm run build:handbook` (jamais édité à la main) |

## 11. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src/js/super-agent.js` | décision pure `superAgentInputReflecting` (une seule source) ; suppression de l'abonnement à l'état global et de son désabonnement ; commentaires alignés |
| `src/js/super-agent-reflecting.test.js` | verrou anti-retour du défaut : décision pure + absence de couplage à l'état global (lecture du source, CRLF normalisé) |
| `src/js/agent-activity.test.js` | un commentaire rendu exact (aucune assertion modifiée) |
| `spec_super_agent.md` | spec utilisateur + section technique corrigées |
| `RAPPORT-pulsation-zone-saisie.md` | avertissement d'abandon (documentation honnête) |
| `help/handbook.md` | régénéré (sortie de `scripts/build-handbook.js`) |
| `RAPPORT-clignotement-saisie-assistant.md` | ce rapport |

Aucun fichier supprimé, aucun garde-fou contourné, aucune version modifiée, aucun
outil de liste des sessions d'agents appelé.
