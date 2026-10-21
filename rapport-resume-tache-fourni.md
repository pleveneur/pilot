# Rapport — le résumé court de la tâche est FOURNI avec la demande

Projet Pilot 0.4.37 · micro-tâche « resume fourni » · rapport écrit **avant** les
tests longs (consigne du propriétaire).

## 1. Demande du propriétaire

> « Dans le panneau des événements/tâches (bas à droite de l'onglet Assistant),
> je veux lire une phrase courte qui dit vraiment ce que fait la tâche. Le
> remède : que **la demande porte elle-même son résumé court**, au lieu de le
> déduire après coup du texte envoyé à l'agent. »

Le correctif précédent (`bd116a9`) avait élargi la fenêtre de prompt conservée
(80 → 600 caractères) et amélioré l'extraction (`shortMission`). Le propriétaire
demande maintenant la cause racine : **celui qui lance la tâche sait ce qu'il
demande** ; il doit pouvoir le dire en une phrase, et cette phrase doit être
conservée avec la tâche puis affichée **en premier**.

## 2. Diagnostic (pourquoi l'extraction seule ne suffit pas)

- Le panneau n'avait qu'**une** source : le texte du prompt, réduit après coup
  par `shortMission` (agent-activity.js). Deux limites structurelles :
  1. un prompt contient d'abord le **rôle**, la spécialité, le contexte projet —
     l'extraction doit sauter tout cela (heuristique, donc fragile) ;
  2. quand le prompt ne contient aucune phrase de tâche (processus démarré sans
     demande, relance, prompt tronqué), l'extraction ne peut produire qu'un
     **repli**.
- Aucun champ du protocole d'envoi ne transportait un résumé : `run_agents` /
  `run_assistant_agents` recevaient `task` (le texte long), et rien de plus.
- Le résumé n'était **pas conservé avec la tâche** : une mission mise en file
  n'avait que son `label` (texte long), et une mission démarrée n'avait que le
  prompt.

## 3. Remède mis en œuvre

### 3.1 Champ facultatif `resume` (120 caractères maximum)

`resume` est accepté par **les deux familles de lancement** :

| Famille | Outil | Effet |
|---|---|---|
| Agents d'un projet | `run_agents` | `resume` joint au lancement, transmis à chaque agent visé et conservé avec la mission |
| Agents d'assistant (sans projet) | `run_assistant_agents` | idem (espace `~/.pilot/assistant/`) |

- **Facultatif** : aucun caractère obligatoire, aucun format imposé. Absent →
  comportement **identique** à avant (aucune régression d'appel).
- **Plafonné à 120 caractères** (`MISSION_RESUME_MAX_CHARS`, JS **et** Rust) :
  espaces et retours à la ligne réduits à une espace, coupe **propre sur un mot**
  avec « … » au-delà de la limite.
- Jamais déduit par un traitement approximatif : si l'appelant ne fournit rien,
  rien n'est inventé (voir § 3.3).

### 3.2 Le résumé voyage AVEC la tâche

Chaîne complète (un seul fil, aucune dérivation) :

```
outil run_agents / run_assistant_agents (champ resume)
   → assignments des agents visés                        (agents-bus.js)
   → entrée de file « en attente » (entry.resume)        (super-agent.js)
   → commande { type:"prompt", message, pilotResume }     (agents.rs)
   → AgentService : résumé EXTRAIT puis RETIRÉ de la
     commande avant écriture vers pi                     (agent_service.rs)
   → list_agent_sessions → get_agent_supervision (champ
     additif `resume`)                                   (agent_service.rs, dashboard.rs)
   → flattenAgents → buildRunningMissions                (agent-activity.js)
   → renderMissionsPanelHtml : résumé SOUS l'agent et le projet (position d'origine)
```

- `pilotResume` est un champ **de Pilot**, pas du protocole RPC : il est retiré
  de la commande avant qu'elle parte vers pi (aucun octet inconnu envoyé au
  moteur).
- Une commande qui **n'est pas** un prompt (`get_state`, `set_model`, …) ne
  touche jamais au résumé conservé (même règle que pour `prompt`).
- Un prompt **sans** `resume` **efface** le résumé précédent de la session : un
  résumé périmé n'est jamais attribué à une autre mission.

### 3.3 Ordre de repli STRICT (aucun résumé fabriqué)

1. **`resume` fourni** → affiché tel quel (normalisé, plafonné à 120 caractères).
2. Sinon **extrait de l'objectif** de la demande (comportement du correctif
   précédent : `shortMission`, inchangé).
3. Sinon, **libellé honnête court** déjà en place : « mission non communiquée »
   (prompt réduit au rôle) ou « (demande non précisée) » (texte introuvable).

**Aucune** étape n'invente un résumé : pas de modèle, pas de devinette.

### 3.4 Affichage

Dans le volet « En cours » du panneau de la cloche, la **disposition d'origine
est conservée** : la ligne de chaque mission porte, **au-dessus**, l'identité de
l'agent et du projet (« codeur — pilot ») avec son statut ; le **résumé court**
remplace seulement le contenu du **texte d'indication existant**, **EN DESSOUS**,
à sa place actuelle. Les deux groupes « En cours (n) » / « En attente (n) » et la
numérotation de la file sont inchangés. Cette position est **figée par un test**
(un futur changement qui remettrait le résumé au-dessus fait rougir la suite).

## 4. Non-régression (existant à préserver)

- **Appels existants** : une demande sans `resume` produit exactement le
  comportement antérieur (mêmes champs, même affichage par extraction).
- **Sentinels** `PILOT_ASSISTANT_RUN_AGENTS::` /
  `PILOT_ASSISTANT_RUN_ASSISTANT_AGENTS::` et le parsing JSON restent
  rétrocompatibles (champ lu seulement s'il est présent).
- La **file d'attente**, les **verrous de projet**, l'**identité de mission**
  (règle 4) et les correctifs récents (agent jetable, étiquette de projet,
  changement de projet) ne sont **pas** touchés : le résumé est un champ
  **additif** posé sur l'entrée de file existante.
- Le **prompt entier** n'est jamais stocké (seul le texte déjà tronqué l'était,
  et le résumé fait au plus 120 caractères).
- Les entrées de mission gardent **exactement** la même forme
  (`{ agent, project, mission, waiting }`) : seul le **contenu** de `mission`
  change de source, et le contenu du texte d'indication change (sa position, elle,
  ne bouge pas : sous l'agent et le projet).

## 5. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `src-tauri/extensions/pilot-assistant-actions.ts` | paramètre `resume` (facultatif) des outils `run_agents` et `run_assistant_agents`, joint au payload |
| `src/js/super-agent.js` | lecture/normalisation de `resume`, transmission aux agents visés et à l'entrée de file, exposition des missions en attente |
| `src/js/agents-bus.js` | `resume` transmis au tour d'agent puis à la commande d'envoi (projet **et** assistant) |
| `src-tauri/src/agents.rs` | `send_agent_process_prompt` / `send_assistant_agent_prompt` acceptent `resume` et le joignent à la commande (`pilotResume`) |
| `src-tauri/src/agent_service.rs` | extraction + retrait du champ, conservation par session, exposition dans `list_agent_sessions`, tests unitaires |
| `src-tauri/src/dashboard.rs` | champ additif `resume` recopié dans la supervision |
| `src/js/agent-activity.js` | `normalizeMissionResume`, `resolveMissionLabel` (ordre de repli strict), `resume` dans `flattenAgents`, affichage du résumé en première position |
| `src/js/agent-activity.test.js` | tests du résumé fourni / trop long / absent / introuvable / jamais inventé + ordre d'affichage |
| `spec_super_agent.md`, `help/handbook.md` | documentation utilisateur du champ `resume` et de l'ordre de repli |

## 6. Tests

Couvrent les cinq points demandés :

1. `resume` fourni → **affiché tel quel** ;
2. `resume` **trop long** → tronqué **proprement** (sur un mot, « … ») ;
3. `resume` **absent** → repli sur l'**objectif** de la demande ;
4. `resume` absent **et** objectif introuvable → **libellé honnête** (jamais
   vide, jamais inventé) ;
5. **aucun** résumé inventé (entrée de mission toujours de la même forme, texte
   fourni rendu sans transformation sémantique).

Plus, côté Rust : le résumé est **retiré** de la commande envoyée à pi, une
commande non-prompt ne l'écrase pas, un prompt sans résumé l'efface, et le
plafond de 120 caractères est respecté.

## 7. Résultats mesurés

Tests ciblés (avant la suite complète) :

| Commande | Résultat |
|---|---|
| `npx vitest run src/js/agent-activity.test.js` | **PASS 94 / FAIL 0** |
| `npx vitest run` (file d'attente, identité de mission, bus, UI, contexte) | **PASS 41 + 152 / FAIL 0** |
| `cargo test --lib agent_service` | **55 tests passés / 0 échec** (dont les 6 nouveaux tests `resume`) |
| `cargo test --lib resume` | **7 passés / 0 échec** |
| `cargo test --lib super_agent_fixed_prompt` | **1 passé** — textes fixes : **5532 caractères** (plafond 5550) |

Suite complète, lancée **une seule fois** :

| Commande | Résultat |
|---|---|
| `npx vitest run` (toute la suite JS) | **PASS 2159 / FAIL 0** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **661 passés, 1 ignoré, 0 échec** |

Note : un premier passage de la suite Rust a échoué sur le **garde-fou
anti-regonflement** du prompt de l'assistant (`super_agent_fixed_prompt_stays_under_budget`,
5724 > 5550). La consigne ajoutée a été **compactée** (formulation du `resume`
resserrée, consigne détaillée laissée au seul guideline de coordination qui n'est
pas compté) : **5532 ≤ 5550**, garde-fou respecté sans relever le plafond.
