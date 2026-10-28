# RAPPORT — « Aucune mission dans la liste des tâches » : diagnostic en lecture seule

> Rédigé par une session d'analyse en LECTURE SEULE (elle n'a rien écrit sur disque) ;
> déposé tel quel par la session de correction, qui n'en est pas l'auteur.

## 1. Ce qui alimente la liste (chaîne complète, prouvée)
- Conteneur : `index.html:322-324` — `#agent-activity-pane-tasks > .sa-tasks-list`, VIDE dans le HTML (aucun message par défaut).
- Bouton d'onglet : `index.html:~310` (`#agent-activity-tab-tasks`) ; réglage `index.html:~1316`.
- Rendu : `super-agent.js:2832` `renderSuperMissions()` → `publishSuperMissionsCount()` (`:2795`) → `renderMissionsPanelHtml()` (`agent-activity.js:688`) → `innerHTML` (`super-agent.js:2840`).
- Calcul (pur) : `buildRunningMissions(getAgentActivitySnapshot().list, collectQueuedMissions())` (`agent-activity.js:616`, `super-agent.js:2796`), puis `splitMissions` (`:655`).
- Données agents : store partagé `agent-activity.js` — `subscribeAgentActivity` (`:763`), `ensureActivityStore` (`:743`) = poll 2 s (`setInterval(activityRefresh, 2000)`, `:753`) + push Tauri `agent-state-changed` (`:748`), puis `flattenAgents` (`:110`).
- Backend : `dashboard.rs:1263` → sessions de `agent_service.rs` (`collect_session_states`, `:4054`) ; état `running` uniquement depuis `agent_anomaly` : `dashboard.rs:1345-1361`. Alimentation : `anomaly.rs:171` `make_observer`, événements `agent_start…` (`anomaly.rs:107-122`), branché au spawn (`agent_service.rs:3355`, `3659`, `3856`).
- Missions « en attente » : 4 familles seulement, côté front (`super-agent.js:2863-2892`) : délégations assistant, `run_agents`, commandes manuelles du projet, file d'exclusivité du bus.
- Ce qui garde la liste VIVANTE : `startSuperMissionsWatch` (`super-agent.js:2898`) posé par `loadSuperMissions` (`:2915`) ← `onPanelTabChanged` (`:2775`) et la fabrique de l'onglet 🧭 (`:3139`) ; RETIRÉ à la fermeture de cet onglet (`:5477`).
- Le compteur du bouton, lui : abonnement PERMANENT, `startTaskCounter` (`super-agent.js:2826`) appelé au démarrage par `main.js:592`.

## 2. Questions / réponses prouvées
- Mission en arrière-plan (sans onglet) visible ? OUI — un agent qui travaille n'est jamais filtré par la visibilité (`agent-activity.js:148-161`, `:618`, `:261`).
- Mission en file d'attente visible ? OUI, mais seulement pour les 4 familles front (`super-agent.js:2863-2892`, `agent-activity.js:636-646`, `:655`, `:688`).
- État entre deux missions ? Message explicite « Aucune mission en cours. » (ou « En attente (n) »), aucun historique (`agent-activity.js:691`, test `agent-activity.test.js:1018-1019`).
- Mission d'un autre projet / de l'assistant 🧭 ? OUI, tous projets agrégés, assistant jamais filtré, libellé « Assistant » (`agent-activity.js:110-161`, `:628`, `super-agent.js:2846`).

## 3. Qualification
(a) VOULU : ne lister que ce qui tourne + les files connues ; masquer les agents au repos ; pas d'historique ; agréger tous les projets.
(b) VRAI DÉFAUT n°1, cause la plus probable : la liste n'est vivante QUE tant que l'onglet 🧭 Assistant existe. Abonnement posé seulement dans la fabrique de l'onglet (`:3139`), coupé à sa fermeture (`:5477`), aucune autre installation. Comme `.sa-tasks-list` est vide dans le HTML (`index.html:323`) et que `loadSuperMissions` n'est rappelé que par un changement d'onglet du panneau (`:2775`) : onglet 🧭 jamais créé → volet BLANC (même pas « Aucune mission en cours ») ; onglet fermé → PHOTO PÉRIMÉE (mission démarrée après jamais affichée, mission finie restée « en cours »). Pendant ce temps le compteur du bouton reste vrai (abonnement permanent, `main.js:592`) : il peut afficher « 1/1 » devant un volet blanc, ce que le code s'interdit par écrit (`super-agent.js:2834-2836`). Même défaut déjà corrigé pour le COMPTE (`super-agent.js:2808-2817`), jamais pour le RENDU.
(c) VRAI DÉFAUT n°2 : une mission acceptée mais pas encore démarrée n'existe dans aucun des deux groupes. Le prompt est enregistré côté Rust dès l'envoi (`agent_service.rs:1911`, `1860`) et publié (`:2454-2458`), mais l'état publié reste `idle` tant que `agent_anomaly` n'a pas d'entrée (`dashboard.rs:1345-1361`), donc `isAgentWorking` est faux (`agent-activity.js:261`) et l'entrée est filtrée (`:618`). Fenêtre = spawn de la session (sonde backend jusqu'à 2×5 s à froid, `rpc.rs:120`, `:145-176`) + 2 s de poll (`agent-activity.js:753`). Aucun état « démarrage » n'existe.
(d) MANQUE D'INFORMATION (pas un défaut) : rien n'explique pourquoi la liste est vide/hors d'état ; une mission sans libellé dit honnêtement « mission non communiquée » (`agent-activity.js:394`).

## 4. Indicateurs existants
Compteur `#agent-activity-count` (`agentTaskCounterText` `agent-activity.js:1204`, `setAgentPanelTaskCount` `:1275`) = abonnement permanent (`startTaskCounter` `super-agent.js:2826`, `main.js:592`) ; pastille/pouls du cercle = `anyBusy` ; onglet « Agents » = `flattenAgents` (garde les sessions vivantes même au repos). Une divergence « Agents » (agent listé) vs « Tâches » (vide) est légitime mais c'est le seul endroit où l'existence d'un agent reste visible.

## 5. Tests : verrouillé / non verrouillé
Verrouillé : `panneau-suivi-trois-onglets.test.js`, `compteur-taches-travail.test.js:288-315`, `agent-activity.test.js:1018-1019`, `travail-visible.test.js`.
Trous : (1) aucun test n'exige que le volet « Tâches » soit rendu SANS onglet 🧭 ; (2) aucun test ne couvre une mission acceptée mais pas encore démarrée ; (3) aucun test n'exige la cohérence bouton ↔ volet APRÈS fermeture de l'onglet 🧭.

## 6. Correction minimale
A. Cause n°1 — 2 fichiers, 0 Rust, 0 CSS/HTML, ~15 lignes, risque faible : `main.js` appelle `startSuperMissionsWatch()` (déjà idempotent, `super-agent.js:2899`) après `startTaskCounter()` (`:592`) ; et retrait de `stopSuperMissionsWatch()` du nettoyage de fermeture de l'onglet 🧭 (`super-agent.js:5477`). Le garde `isAgentPanelPaneVisible("tasks")` (`:2838`) évite tout rendu inutile.
B. Cause n°2 — plus chère, à trancher : B1 front (5ᵉ famille « démarrage » dans `collectQueuedMissions`, ~40-60 lignes, dédoublonnée quand l'agent passe `running`) ou B2 Rust (publier `missionPending` depuis `AgentService`, risque moyen).

## 7. Incertains
État de l'onglet 🧭 chez le propriétaire au moment du constat : inconnu, donc A vs C non tranchable par l'observation seule. Aucune batterie lancée (lecture seule). Durée réelle de la fenêtre (c) non mesurée.

## 8. Aucune correction appliquée par le diagnostic
