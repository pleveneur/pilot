# Rapport — agent jetable (rôle fourni à la volée, sans écriture en base)

Date : 2026-10-21 · version en cours 0.4.37 · objectif : permettre à l'assistant
de lancer un agent dont le **rôle est fourni dans la demande**, sans **aucune
écriture dans la base du registre**, la session **disparaissant** à la fin de la
tâche (son travail restant visible).

## 1. Ce que j'ai trouvé (état avant modification)

Chaîne réelle d'un lancement `run_agents` :

| Étape | Fichier | Constat |
|---|---|---|
| 1. Validation des identifiants | `src/js/super-agent.js` (`action === "run_agents"`) | `loadAgentRegistry()` → `known` : **seuls** les agents présents en base sont acceptés (`unknownAgentsError` sinon). |
| 2. Envelope + contexte de suivi | `super-agent.js` (`applyAssistantBriefEnvelope`, `attachDelegationContext`) | inchangé par la mission. |
| 3. Lancement | `agents-bus.js` (`runAgentsForAssistantAsync` → `reloadAgentsRegistry`) | la map `busState.agents` est **reconstruite depuis la base** à chaque run : un agent non persisté disparaîtrait. |
| 4. Résolution du rôle | `agents.js` (`buildAgentPrompt`) | le rôle vient de l'objet agent **en mémoire** (`=== SPÉCIALITÉ === Rôle : …`), pas de la base. |
| 5. Spawn du process | `agents-bus.js` → `start_agent_process` → `AgentService::start` | **si l'agent n'existe pas en base, `start` le CRÉE** (`upsert_agent`) avant de lancer : ligne persistante, `visible = 1`, donc agent visible dans le registre 🎭. |

`create_agent` (`super-agent.js`) écrit lui aussi durablement (`upsertAgent` →
`upsert_agent` en base) : c'est un agent **durable**, pas jetable.

Conclusion : la création à la volée est **partielle** — le rôle est libre, mais
l'agent atterrit en base et y reste.

## 2. Approche retenue

Un **agent éphémère** = un objet `Agent` **en mémoire uniquement**, aux deux
étages :

- **JS** : magasin mémoire `src/js/ephemeral-agents.js` (id `eph-<horodatage>`,
  jamais écrit en base). Le bus le fusionne dans `busState.agents` **après**
  chaque `reloadAgentsRegistry()` (sinon la relecture disque l'effacerait).
- **Rust** : magasin mémoire dans `AgentService` (`ephemeral_agents`), consulté
  en **repli de `get_agent`** quand la base ne connaît pas l'identifiant. Effet :
  `AgentService::start` ne « seed » plus la ligne (le seed n'a lieu que si
  `get_agent` répond `None`), `set_state` / `set_visible` n'écrivent plus en base
  pour un agent éphémère (mise à jour mémoire + événement), et **rien** n'est
  créé dans le registre visible (`list_agents` lit la base seule).

Durée de vie : l'agent éphémère vit **le temps de la mission** ; à la
libération de la run (`settleRun`), ses sessions sont arrêtées et l'entrée
mémoire est **purgée aux deux étages** (JS + Rust). Son travail reste visible :
messages de session, rapport de fin de run, journal d'arrêts.

## 3. Fichiers touchés

- `src/js/ephemeral-agents.js` (**nouveau**) : magasin mémoire + helpers purs
  (id éphémère, normalisation, fusion registre, détection).
- `src/js/agents-bus.js` : fusion des agents éphémères dans `busState.agents`
  (init **et** rechargement), sans toucher au registre persistant.
- `src/js/super-agent.js` : `run_agents` accepte un **rôle fourni à la volée**
  (`agents: [{ name, role, … }]`) → agents éphémères enregistrés (JS + Rust),
  lancés comme les autres, **purgés** à la fin de la mission (`settleRun`) et
  à l'abandon d'une mission jamais lancée. `create_agent` **reste** le chemin
  des rôles **réutilisables** (aucune modification de son comportement).
- `src-tauri/src/agent_service.rs` : magasin `ephemeral_agents` + repli de
  `get_agent`, gardes `set_state` / `set_visible` / `upsert_agent`, purge à
  l'arrêt de la session.
- `src-tauri/src/agents.rs` : commandes `register_ephemeral_agent`,
  `clear_ephemeral_agent`, `list_ephemeral_agents`.
- `src-tauri/src/lib.rs` : enregistrement des 3 commandes.
- `src/js/agent-jetable.test.js` (**nouveau**) : preuves (a) lancement sans
  écriture en base, (b) rien ne subsiste après la tâche, (c) agents du registre
  inchangés.
- `src-tauri/src/agent_service.rs` (module de tests) : preuves Rust du magasin
  mémoire (aucun `upsert`, purge).
- `spec_super_agent.md` / `spec_gestion_agents.md` + bloc `<!-- HELP:* -->` :
  comportement documenté (agent jetable).

## 4. Ce qui reste si je dois m'arrêter avant la fin

État réel à la fin de la session : **terminé et mesuré**.

| Preuve | Mesure |
|---|---|
| Lancement réel d'un agent jetable, **sans aucune écriture de registre** | `src/js/agent-jetable.test.js` : `start_agent_process` appelé sur l'id `eph-…` **et** aucune commande `upsert_agent` / `replace_agents` / `delete_agent` dans les appels instrumentés. |
| Rien ne subsiste après la tâche | magasin JS vidé, `clear_ephemeral_agent` appelé, arrêt tracé dans `.pilot/agent-stops.log` (`ephemeral-task-ended`), session et rapport **toujours lisibles**. |
| Agents du registre inchangés | fusion : le persistant gagne toujours ; purge sélective (mission mixte) : seuls les `eph-…` sont purgés. |
| Côté Rust | `agent_jetable_vit_en_memoire_et_disparait_a_la_purge`, `etat_d_un_agent_jetable_reste_en_memoire` (+ 47 tests `agent_service` verts). |
| Non-régression | suite JS complète : **2130 tests / 0 échec** ; `cargo check -p pilot --lib` OK (17 avertissements préexistants). |

Reste hors périmètre (assumé) : un agent éphémère **reste listé pendant qu'il
travaille** dans le panneau d'activité (il travaille réellement, marqué
`visible=false`) ; il disparaît dès la fin de la mission. Un agent jetable sans
modèle explicite retombe sur le **modèle par défaut** de l'application (repli
existant du bus) ; sans modèle par défaut configuré, le bus refuse de démarrer
et l'échec est tracé (`spawn-failed`), comme pour tout agent.
