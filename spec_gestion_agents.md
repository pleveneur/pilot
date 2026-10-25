# Spécification — Gestion d'agents (H2 V2)

> Onglet **🎭 Agents** : **écran de configuration** de l'équipe d'agents (registre : liste, éditeur, compétences) + affichage de l'**activité** des runs en cours. Les lancements se font depuis l'onglet 🧭 **Assistant** (délégation) et les **onglets d'agents** du projet.

<!-- HELP:agents -->
## Aide utilisateur — Agents

L'onglet **🎭 Agents** sert à **configurer l'équipe d'agents** et à **suivre** ce qu'elle fait. Pour lancer une tâche, utilisez l'onglet **🧭 Assistant** (ou la discussion d'un agent).

### L'écran
- **Colonne de gauche : l'équipe.** Chaque carte montre le nom, l'identifiant, les **modèles demandés** (`π` = pi, `ℓ` = plh ; « non réglé » si le champ est vide), et des badges : **lecture seule** et le **nombre de compétences**. Le **niveau de réflexion demandé** (`π` / `ℓ`) est affiché sur la carte dès qu'un niveau est réglé.
  - Attention : les modèles affichés sont **demandés**, pas **employés**. Au démarrage d'une session, Pilot applique le modèle du **backend actif**, sinon celui de l'**autre backend** (repli croisé), sinon le **modèle par défaut** du registre de modèles — et une session **déjà lancée** garde le modèle qu'elle utilise (modifier la carte ne la change pas). L'infobulle de la carte le rappelle.
- **Colonne de droite : l'activité.** Tableau de bord des runs en cours : qui travaille, sur quel outil, la **chaîne des appels**, le **budget restant** et la **profondeur**. L'agent en cours est surligné. Le bilan reste visible après la fin de la run.
  - **Un agent qui travaille sans onglet ouvert** (lancé en arrière-plan, ou dont vous avez fermé l'onglet) y apparaît quand même, dans un bloc **« Travail en arrière-plan (aucun onglet ouvert) »** : nom de l'agent, projet et tâche en cours. Ce bloc est purement informatif : **aucun onglet ne s'ouvre** tout seul.
- **➕ Ajouter** crée un agent ; **✏️ Modifier** ouvre l'éditeur ; **🗑️ Supprimer** retire un agent.
- **🔄 Réinitialiser** restaure les **7 agents fournis** (coordinateur, architecte, codeur, reviewer, testeur, documenteur, plan-maker). **Vos agents personnalisés sont conservés.**

### Créer / modifier un agent
- L'éditeur s'ouvre dans une **fenêtre large** organisée en **deux colonnes** : à gauche l'**identité** et les **modèles**, à droite le **rôle**, les **compétences** et les **garde-fous**. Le champ **Rôle** est haut et **redimensionnable verticalement**. Sur une fenêtre étroite, les deux colonnes se replient en **une seule** (rien n'est coupé) et la fenêtre défile si la hauteur manque.
- **ID** : identifiant machine en kebab-case, non modifiable après création. Un identifiant fourni par Pilot (ex. `codeur`) est refusé à la création : la réinitialisation écraserait cet agent.
- **Nom, icône, description, rôle** : la **description** sert au coordinateur pour router les tâches ; le **rôle** est le prompt système de l'agent.
- **Modèles** : modèle `π` (pi) et `ℓ` (plh) séparés ; « Modèle par défaut » laisse Pilot choisir. Ce réglage est une **intention** pour les sessions à venir (cf. l'encadré ci-dessus) : il n'est pas réappliqué à une session en cours.
- **Niveau de réflexion (`π` / `ℓ`)** : combien le modèle réfléchit avant de répondre (Désactivé → Maximal). Le menu ne propose que les paliers **réellement supportés** par le modèle ; « Non réglé » suit le réglage général de Pilot. Un modèle incapable de raisonner (ex. `llama-cpp`) affiche un sélecteur **désactivé** avec la raison. Au lancement, le niveau est **ajusté** aux capacités du modèle (jamais un palier supérieur).
- **Lecture seule** : consigne stricte de ne pas écrire de fichiers. **Garder le contexte** : la session n'est pas remise à zéro entre deux appels.
- **Max appels / run** et **Profondeur max** : garde-fous propres à l'agent.

### Compétences par agent
- Les compétences (skills) forment une **bibliothèque commune** dans `~/.pilot/skills/` : un dossier par compétence, contenant un fichier `SKILL.md`.
- Cochez dans l'éditeur les compétences que **cet** agent peut voir. Un agent ne voit **que** les compétences cochées (filtrage strict) — plus la compétence `quality-gate`, jamais filtrée.
- Compétence absente de la liste mais déjà cochée = dossier introuvable dans `~/.pilot/skills` : elle reste affichée pour ne pas disparaître sans que vous le sachiez.
- Pour en ajouter une : créez le dossier `<nom>/SKILL.md` dans `~/.pilot/skills`, puis rouvrez l'éditeur de l'agent.

### Poser une question : elle vous revient toujours
- Un agent **peut poser une question** (choix d'une approche, confirmation, saisie) : c'est souvent indispensable, et la question **remonte jusqu'à vous**. Elle s'affiche dans la conversation de l'**Assistant**, avec ses options, et **vous** y répondez (champ de précision optionnel).
- Cela vaut **aussi pour les agents lancés en arrière-plan** par l'Assistant, même si vous n'êtes pas sur l'onglet 🧭 : la question est relayée de la même façon, et elle est **signalée** dans le suivi. **Aucune réponse n'est décidée à votre place** (ni approbation, ni première option, ni annulation).
- Si vous ne répondez pas, la demande **reste en attente** : la limite d'attente de **45 minutes** déjà en place évite qu'elle bloque la file indéfiniment. Aucune réponse de repli n'est inventée.
- Les **demandes internes** (validation d'écriture, action Pilot, contrôle de l'écran) gardent leur propre dialogue et ne sont jamais tranchées automatiquement.

### Suivre et arrêter
- Une tâche lancée sur un agent **peut en appeler un autre** : Pilot relaie le résultat à l'appelant, un seul agent travaille à la fois (hors sous-tâches parallèles).
- **Détection de cycle** : un agent déjà dans la chaîne ne peut pas être rappelé.
- **Consulter n'est jamais une boucle** : relire `git status`, `git diff`, `git log`, `ls`, `grep`/`rg`, `sed -n`… entre deux corrections est un travail normal — ces lectures **ne déclenchent aucun arrêt**, quel que soit l'écran d'où la tâche a été lancée (onglet d'agent, bus d'agents, Assistant). Seules les **modifications** (écriture d'un fichier, commande qui écrit ou exécute) et la répétition d'un même **texte** peuvent fonder un arrêt.
- **Chaque arrêt automatique laisse une trace** dans `.pilot/agent-stops.log` du projet (cause, type de détection, agent, session) : boucle, inactivité, plafond de tours, agent bloqué, libération de verrou. Rien ne s'arrête sans motif écrit.
- **Un agent qui meurt ne perd plus son travail écrit** : s'il s'arrête brutalement (processus mort, plantage), ce qu'il avait **déjà rédigé** est conservé. Le compte rendu de la tâche affiche ce texte, avec la phrase qui dit que la mission n'est **pas** terminée, et il est écrit dans le **même** journal des arrêts (champ `text=`) — jamais un second journal. Si la mémoire de la session est vide, Pilot relit la session de l'agent **sur le disque** ; s'il n'y a vraiment rien, c'est dit explicitement (« **aucun texte récupéré** »). Ni silence, ni texte inventé, et **aucune relance automatique**.
- **Timeout d'inactivité** : si un agent reste silencieux trop longtemps (**10 min par défaut**, soit 600 000 ms), la run s'arrête et un message le signale. Réglable dans **Paramètres → Agents** (champ « Timeout d'inactivité (ms) », de 10 s à 30 min) ; la nouvelle valeur est relue à l'ouverture de l'onglet Agents ou au redémarrage de Pilot.
- **⏹ Arrêter** arrête les agents lancés depuis cet écran.
- **Changer de projet, fermer un projet ou en ouvrir un autre n'arrête JAMAIS un agent en cours** — quel que soit l'écran (agent du projet, agents multi-rôles 🎭, Assistant). L'agent du projet quitté est simplement **mis en pause** et reprend là où il en était au retour sur ce projet ; les agents des autres projets ouverts continuent leur travail. Seul un agent **au repos** (qui ne travaille pas) est libéré à la fermeture de son projet.
- **Travailler sans onglet reste visible** : dans la **liste des agents** (cercle en haut à droite) et dans le panneau du suivi du travail, une session qui travaille sans onglet ouvert reste **listée** avec son nom et son projet, sa pastille **respirant** — vous voyez qu'elle travaille, sur quel projet, même sans onglet. Cette liste n'affiche **aucune mention « arrière-plan »** (texte ou infobulle) : l'information est portée par la pastille et le nom en gras ; le libellé explicite reste dans la fiche de l'agent et dans le panneau Activité de l'onglet Agents. Elle reste listée **tant qu'elle travaille** (ou que son processus tourne) et **disparaît** dès qu'elle s'arrête : aucune entrée fantôme. Une session simplement **au repos** n'est jamais présentée comme travaillante. Ouvrir son onglet reste **votre** décision (bouton « Afficher l'onglet ») : rien ne s'ouvre ni ne change d'onglet tout seul.
- **Fond de la liste** : le fond de la liste des agents est **légèrement translucide** — on devine la page derrière, sans jamais gêner la lecture : les noms restent nets, en thème clair comme en thème sombre. Les pastilles ne changent pas (atténuées au repos, pleines et lumineuses quand l'agent travaille).
- **Taille et présentation du panneau** : le panneau du suivi (cercle en haut à droite) est assez large pour ses trois onglets **sur une seule ligne** — jamais plus de **40 % de la largeur** de la fenêtre — et ne dépasse jamais **60 % de la hauteur** de l'écran : au-delà, seule la liste défile, et le panneau reste **entièrement visible**. Les trois listes ont exactement la même présentation, celle du panneau d'origine (mêmes lignes, mêmes textes).

### Voir le travail en cours (une compilation n'est pas un arrêt)
- Pendant une **commande longue** (construction, série de tests, installation), l'écran **prouve** que le travail avance — à trois endroits :
  - dans l'**onglet de l'agent** : la commande en cours porte un **point qui respire**, un **compteur de durée** (« 3 min 12 s ») et la **sortie en direct** (les dernières lignes produites) ;
  - dans le **panneau d'activité** (cercle en haut à droite, clic) : la ligne « **En cours depuis 3 min 12 s** » et une « Dernière activité » **qui avance** ;
  - dans la **liste des tâches** (en bas à droite) : la mission porte un point qui respire et sa durée (« depuis 3 min »).
- Le libellé d'état dit la **vérité** : pendant une commande, il annonce « **⏳ bash en cours… (3 min 12 s)** » — jamais « Prêt », jamais « Réflexion… » (le modèle n'attend pas, il fait tourner un programme).
- **Ce que cela ne change PAS** : la détection des agents bloqués, les arrêts automatiques et les durées d'exécution. Seul l'**affichage** progresse ; la sortie en direct est **bornée** (dernières lignes) et aucun **défilement automatique** ne vous est imposé.

### Agent jetable (à la volée, jamais enregistré)
- Pour un besoin **ponctuel**, nul besoin de créer un agent : le rôle peut être
  décrit **dans la demande** elle-même. Cet agent est **jetable** — il existe
  pendant la tâche, puis n'existe plus.
- Il **n'entre pas** dans la liste des agents, **ne modifie rien** dans cette
  liste et **ne survit pas** à la tâche : aucun enregistrement, avant comme
  après.
- Son **travail reste visible** (session et compte rendu) : vous pouvez relire
  ce qu'il a fait après sa disparition.
- Dans une même mission, agents du registre et agents jetables peuvent
  cohabiter : seuls les jetables disparaissent ensuite.

### Écrire un fichier : il faut un agent qui écrit
- Un agent **lecture seule** ne modifie **aucun** fichier : il analyse, planifie
  ou rend un avis. Si on lui demande **explicitement** d'écrire, de créer ou de
  modifier un fichier, Pilot **refuse le lancement** : rien ne démarre et le
  message nomme l'agent, rappelle qu'il ne modifie aucun fichier et indique la
  sortie (désigner un agent qui écrit, par exemple le codeur).
- Le refus ne vise **que** les demandes claires. Une demande de **lecture**
  (« analyse », « vérifie », « relis »…) part normalement, et une demande
  **ambiguë** aussi (dans le doute, l'agent est lancé comme avant). Une mission
  qui contient **au moins un agent qui écrit** n'est jamais refusée.
- **Ce qui compte, c'est l'ORDRE, pas les mots.** Le refus se fonde sur une
  consigne **positive** adressée à l'agent (« écris », « modifie », « génère »,
  « il faut écrire », « merci de créer », « n'oublie pas de créer »…) **et** sur
  la cible qu'elle désigne (un fichier), dans la **même phrase**. Tout le reste
  ne déclenche **aucun** refus : une phrase **négative** (« n'écrire aucun
  rapport », « ne modifier aucun fichier », « sans rien modifier »), une
  **étiquette** de verdict (« À CORRIGER »), le mot « correction »,
  l'évocation d'un fichier **déjà** modifié, un message de commit **cité** ou un
  **nom de fichier** qui ressemble à un verbe (« corrige-guard.md »).
  Une mission de lecture seule n'est donc plus bloquée à cause d'un mot.
- **Fichiers attendus** : quand la demande **déclare** les fichiers réellement
  attendus, Pilot vérifie **en fin de tâche** que **chacun existe**. Un fichier
  déclaré **absent** fait **échouer** la tâche avec un message qui le nomme et
  dit où il était attendu — jamais « terminé » sans le fichier. Présent (même
  vide), la tâche se déroule comme avant, avec une confirmation.
- **Sans fichier déclaré, rien ne change.** Ce contrôle s'applique aussi aux
  **agents jetables** et aux demandes **mises en file** (vérification au moment
  où la tâche se termine réellement).

### Conseils
- Donnez un modèle puissant au coordinateur : c'est lui qui route les tâches.
- Le codeur et le testeur peuvent utiliser un modèle local plus léger.

### File d'attente du projet
- Sur un projet, **une seule tâche tourne à la fois**. Les demandes suivantes ne sont **pas perdues** : elles **attendent leur tour** et démarrent **automatiquement** dès que la place se libère.
- **L'ordre d'arrivée est respecté à l'admission** : une demande déposée alors qu'une autre attend déjà ne passe **jamais devant** — elle se place **derrière** et démarre à son tour. Une seule nuance, écrite noir sur blanc dans les **limites connues** (aucune perte, aucun doublon) : une mission **déjà sortie de file** qui ne peut pas démarrer repart **derrière** les suivantes. L'écran vous le dit (« N demande(s) attendent déjà — votre demande est mise en file DERRIÈRE elles ») et la raison reste écrite dans `.pilot/agent-stops.log`.
- Un **bloc discret** sous la barre d'outils de l'onglet de l'agent montre la file : la tâche **en cours**, puis les demandes **en attente** avec leur rang et **l'agent qui va les traiter** (« en attente (2e) : mission « … » · agent : Codeur »). Il n'apparaît que s'il y a quelque chose à dire.
- **Chaque demande en attente dit quel agent la traite** : l'agent est celui **enregistré avec la demande** au moment de sa mise en file (jamais un nom supposé à l'affichage). Si l'agent n'est pas connu, la ligne l'écrit noir sur blanc (« agent : agent non défini ») : **jamais un blanc** à la place du nom. La tâche **en cours** garde son affichage habituel.
- La commande **`/file`** affiche la file complète du projet dans la discussion (mêmes rangs, mêmes agents) ; **`/file vide`** abandonne les demandes **en attente** et annonce **combien** ont été abandonnées (la tâche en cours n'est jamais arrêtée).
- **Aucune demande ne disparaît en silence** : une demande en attente dont la tâche porteuse s'est arrêtée reste **visible** et **relançable** ; si elle est abandonnée (par vous, par le chien de garde ou par « tout arrêter »), son libellé est écrit dans `.pilot/agent-stops.log` et l'écran vous le signale.
<!-- /HELP:agents -->

### Agent `plan-maker` (planificateur)

Le `plan-maker` est un agent **lecture seule** qui ne modifie jamais le code : il
analyse une demande et produit un **plan structuré en JSON** (tâches + fichiers
concernés + coût estimé en tokens + contraintes suggérées + dépendances).

- **Rôle** : découper la demande en micro-tâches (1 à 3 fichiers par tâche),
  estimer le coût en tokens de chaque tâche, et proposer des contraintes
  (ex : « ne pas modifier `lib.rs` », « budget max 2000 tokens »).
- **Format de sortie** : un JSON valide
  ```json
  {"plan": [{"id": 1, "title": "...", "description": "...",
            "files": ["..."], "estimated_tokens": 0,
            "suggested_constraints": ["..."], "depends_on": []}]}
  ```
- **Quand l'utiliser** : pour les demandes importantes nécessitant un découpage
  et une validation avant délégation au codeur — **sur demande** uniquement. Il
  n'est **jamais lancé automatiquement** avant un codeur : un lancement démarre
  exactement les agents demandés (mission 381).
- **Livrable obligatoire (mission 384)** : nommé seul dans une mission, il doit
  produire un **plan exploitable** (au moins une tâche, chacune avec un intitulé
  et des fichiers) ; la session **reste ouverte** tant que le plan n'est pas
  arrivé. Une session qui se termine **sans livrable** est rapportée en **échec**
  explicite nommant l'agent — jamais un faux succès. Une mission de **lecture**
  ne prouve jamais son travail par le disque (un commit tombé pendant la run
  vient d'ailleurs).
- **Utilisation par l'Assistant (Magnus)** : l'Assistant peut appeler le
  `plan-maker` via `run_agents` (extension `pilot-assistant-actions`) pour
  obtenir un plan structuré, le présenter à l'utilisateur (via `ask_multi_choice`
  pour cocher les tâches à exécuter + `ask_confirm` pour valider), puis déléguer
  au codeur avec le plan approuvé et les contraintes.

---

## 1. Objectifs

- Définir des agents nommés dans un **registre global** persisté en base SQLite (`pilot.db`, tables `agents` / `agent_views`) — et non dans un fichier `~/.pilot/agents.json` (voir § 3).
- Chaque agent a un rôle (system prompt), un modèle par backend (`pi` / `plh`), un **niveau de réflexion** par backend (colonnes `thinking_pi` / `thinking_plh` ; voir `spec_rpc.md` § 4ter) et une liste de **compétences** (skills) visibles.
- Un coordinateur reçoit la demande utilisateur et déclenche les agents spécialisés.
- Protocole séquentiel `[[CALL:agent_id]]` / `[[RESULT from agent_id]]`.
- Garde-fous : profondeur, budget, cycle, timeout, stop global.

## 2. Architecture

```
Utilisateur
   │
   ▼
Coordinateur (session longue)
   │ [[CALL:architecte]]
   ▼
Agent cible (session vierge ou conservée)
   │
   ▼
Pilot renvoie le résultat à l'appelant
```

- **Une session `pi --mode rpc` par agent** (généralisation du reviewer H2 V1).
- Canal d'événements unique `rpc-event-agents` avec enveloppe `{agent_id, event}`.
- Toutes les sessions vivent dans le **registre unique de l'AgentService** (`agent_service.rs`), indexé par clé composite `(projet, agent)`. Les agents multi-rôles H2 V2 y sont stockés avec un `SpawnMode::AgentProcess` (canal `rpc-event-agents`), distincts de la session principale (`MainSession`).

## 3. Données

### Registre global (base SQLite)

Le registre global vit dans la base SQLite de l'application (`pilot.db`, dossier de configuration Pilot), tables `agents` et `agent_views` :

- `agents` : objet agent (id, nom, icône, description, rôle, modèles, **compétences**, drapeaux, limites d'appel) avec `project_path IS NULL` pour le périmètre global (les agents rattachés à un projet portent leur chemin).
- **Clé de projet canonique (`chemin_normalise`)** : toutes les lectures/écritures du registre passent par `crate::normalize_project_path` (`/` vs `\`, casse, slash final) et l'index `UNIQUE (id, chemin_normalise)` — le même projet écrit sous deux formes ne crée plus deux fiches. Migration automatique dans `init_db` : copie de sûreté `pilot.db.bak-chemins-normalises` (jamais écrasée) puis fusion des doublons existants (fiche la plus ancienne conservée) et alignement de `agents.project_path` + `agent_views.project_path`.
- `agent_views` : vues d'onglets (ordre, nom affiché, onglet actif).
- La colonne `skills` est un tableau JSON de noms de dossiers de `~/.pilot/skills` (migration idempotente `NOT NULL DEFAULT '[]'`).
- Un ancien fichier `~/.pilot/agents.json` peut subsister sur une installation ancienne : il **n'est plus lu ni écrit** et peut être supprimé sans risque (retiré de l'installation de référence, avec sauvegarde datée, point 333).

```jsonc
// forme sérialisée d'un agent (colonne → JSON)
{
  "id": "coordinateur",
  "name": "Coordinateur",
  "icon": "🧠",
  "description": "Pilote l'équipe d'agents.",
  "role": "Tu es le chef d'orchestre...",
  "models": { "pi": "deepseek/deepseek-chat", "plh": "deepseek/deepseek-chat" },
  "capabilities": ["delegate", "synthesize"],
  "skills": ["quality-gate"],
  "readonly": false,
  "keep_context": true,
  "max_calls_per_run": 20,
  "call_depth": 0
}
```

### Champs

| Champ | Description |
|---|---|
| `id` | Identifiant machine unique (kebab-case). Un id fourni par Pilot n'est pas créable (D4). |
| `name` | Nom affiché. |
| `icon` | Emoji/icône. |
| `description` | Description fonctionnelle utilisée par le coordinateur pour router. |
| `role` | Instructions système injectées en début de chaque prompt. |
| `models.pi` / `models.plh` | Modèle selon le backend actif. |
| `skills` | Noms de dossiers de `~/.pilot/skills` que **cet** agent voit (filtrage strict, § 3.1). |
| `readonly` | `true` → agent qui ne doit pas écrire. |
| `keep_context` | `true` → ne pas faire `new_session` entre deux appels. |
| `max_calls_per_run` | Limite d'appels pour cet agent dans une run. |
| `call_depth` | Profondeur max à laquelle cet agent peut être appelé (0 = coordinateur). |

### 3.1 Compétences par agent (skills)

- **Bibliothèque commune** : `~/.pilot/skills/<nom>/SKILL.md` (dossier utilisateur Pilot, résolu cross-platform). Un dossier sans `SKILL.md` lisible est ignoré. Aucun fichier n'est créé par Pilot (création à l'usage, par l'utilisateur).
- **Un skill n'ajoute pas d'outil** : c'est un document de consignes (frontmatter `name`, `description`, `disable-model-invocation`) chargé dans le prompt système.
- **Filtrage STRICT (D6)** : un agent ne voit que les compétences de sa liste. Pilot passe à la session pi les chemins `--skill` correspondants (`common_skill_path` refuse tout nom vide ou contenant `/`, `\`, `..`) et exporte `PILOT_AGENT_SKILLS` (JSON des noms). L'extension embarquée `pilot-skills.ts` (`filterSkillsForAgent`), chargée dans TOUTES les sessions d'agent (jamais conditionnée à un autre réglage), retire alors de `event.systemPromptOptions.skills` toute compétence auto-découverte non listée.
- **`quality-gate` n'est jamais filtré** : il reste disponible même s'il n'est pas listé (il est aussi chargé via `--skill` par les sessions concernées).
- **Fail-open** : si `PILOT_AGENT_SKILLS` est absent (session non-agent), aucun filtrage n'a lieu.
- Les agents **fournis** n'ont pas de compétence par défaut : la liste se remplit dans l'éditeur de l'onglet 🎭.

### 3.2 Agent jetable (mémoire seule)

Un agent peut être fourni **à la volée** par l'Assistant (`run_agents`, paramètre
`agents`), sans passer par le registre :

- `AgentService.ephemeral_agents` (`Mutex<HashMap<String, Agent>>`) porte la
definition ; les commandes `register_ephemeral_agent`, `clear_ephemeral_agent`,
`list_ephemeral_agents` (`agents.rs`) la manipulent. **Aucune ligne n'est écrite**
in `agents` / `agent_views` — ni création ni suppression, donc aucune entrée
existante ne peut être touchée.
- `get_agent` résout l'agent jetable **en mémoire** (repli éphémère) : c'est ce
qui empêche `AgentService::start` de « seeder » une ligne (`start` ne crée une
ligne que si `get_agent` répond `None`). `upsert_agent`, `set_visible` et
`set_state` court-circuitent la base pour un identifiant jetable.
- **Résolution de portée tolérante** : l'agent jetable d'une mission est résolu
quelle que soit la forme du chemin (`\` vs `/`, slash final, portée vide) et par
une requête de portée globale ; un agent jetable d'un **autre projet nommé**
reste refusé.
- **Identifiant réservé `eph-`** : `isEphemeralAgentId`, `makeEphemeralAgentId`,
`buildEphemeralAgent`, `mergeAgentsWithEphemeral` (le persistant gagne),
`splitEphemeralIds`, `persistEphemeralAgent`, `disposeEphemeralAgent(s)`
(`src/js/ephemeral-agents.js`). Le préfixe est **vérifié à l'écriture côté Rust**
(`EPHEMERAL_AGENT_PREFIX`, `is_ephemeral_agent_id`) : `register_ephemeral_agent`
refuse un agent jetable qui ne le porte pas (il masquerait sinon un agent du
registre par le repli mémoire de `get_agent`), et le point d'écriture en base
(`upsert_agent_conn`) refuse un identifiant du registre qui le porterait. Les
deux espaces d'identifiants restent ainsi disjoints, sans dépendre du seul
appelant JS.
- **Fusion après chaque lecture du registre** : `mergeEphemeralAgentsIntoBus`
(`agents-bus.js`) est appelée par `initAgentsBus` **et** par
`reloadAgentsRegistry` — sinon l'agent serait « inconnu » au lancement.
- **Durée de vie = la tâche** : purge à `settleRun`, à l'abandon de mission,
à l'arrêt de session (entonnoir `stopAgentWithTrace`, motif
`ephemeral-task-ended`), à `stop_all_agent_processes` et `shutdown_all`.
- **Preuve** : `src/js/agent-jetable.test.js` (aucune commande
`upsert_agent` / `replace_agents` / `delete_agent` appelée, purge des deux
étages, arrêt tracé, registre inchangé) + tests Rust d'`agent_service.rs`.

### 3.3 Garde-fou du livrable (lecture seule + fichiers attendus)

Ferme le défaut « l'agent rend un plan » : `readonly` n'était qu'un texte de
prompt et la fin de mission ne vérifiait aucun fichier.

- **Module pur** `src/js/deliverable-guard.js` (aucune dépendance UI, testé
  unitairement) :
  - `detectExplicitWriteRequest(taskText, {expectedFiles})` →
    `{explicit, verb, target, via}`. `via` ∈ `expected_files` | `file-path` |
    `file-noun`. Deux signaux seulement : un **livrable déclaré**
    (`expected_files`), ou un **ORDRE** d'écriture (`findWriteOrder`) **et** sa
    cible de fichier dans la **même proposition** (`splitSegments`).
    - Le texte est découpé en propositions ; un ordre et sa cible doivent s'y
      trouver **ensemble** (une étiquette, une citation ou une description
      ailleurs dans le texte ne compte pas).
    - Les **accents sont conservés** (`normalizeForMatch`) : ils séparent
      l'impératif du participe (« modifie » vs « modifié », « écris » vs
      « écrit »), seul moyen fiable de distinguer un ordre d'un état.
    - Seules les **formes d'ordre** comptent : impératif 2e personne, base
      verbale anglaise, infinitif **gouverné** par une consigne (« il faut »,
      « merci de », « tu dois »…) ou en **tête** de proposition (« - modifier
      src/js/main.js »). Un infinitif après un sujet à la 3e personne (« il
      modifie ») est une **description**, une question (« s'il faut… ») n'est
      pas un ordre.
    - Neutralisés avant analyse : **négations** (« sans rien modifier », « ne …
      pas/jamais/rien/aucun », « n'écrire aucun rapport », « without writing »),
      **étiquettes** (« à corriger »), **citations** (« … », `…`), **chemins de
      fichier** (un nom comme `corrige-guard.md` n'est pas un verbe). La virgule
      borne la négation : « ne modifie pas X, puis écris Y » reste un refus.
    - Un verbe d'écriture **sans cible** (« écris un plan ») ou toute forme
      ambiguë ⇒ `explicit: false` (dans le doute, la demande part).
  - `readOnlyWriteRefusalMessage({tool, agents, task, expectedFiles})` →
    message de refus **ou `null`** : refus seulement si **tous** les agents sont
    `readonly: true` **et** la demande est explicitement une écriture.
  - `normalizeExpectedFiles`, `verifyExpectedFiles({declared, base, invokeFn})`
    (résolution via `resolvePath` d'`orchestration.js` + `file_exists`),
    `deliverableFailed` (vrai **seulement** si `missing.length > 0`),
    `deliverableVerdictText` / `appendDeliverableVerdict`.
- **Branchement** : `super-agent.js` refuse **avant tout démarrage** dans
  `run_agents`, `run_assistant_agents` et `delegate_to_coder` (jetons jetables
  purgés, réponse `{error, launched:false}`) ; les assignments portent
  `expectedFiles` + `expectedFilesBase` (projet cible, sinon projet actif, sinon
  espace assistant). `agents-bus.js` (`startParallelRun`) vérifie les fichiers à
  la fin et livre la mission en **échec** si l'un manque — la **file d'attente**
  suit la même règle puisque la vérification a lieu à la fin réelle.
- **Fail-open** : sonde `file_exists` en erreur → `unreadable` (jamais un
  échec) ; base de référence inconnue → `skipped: true` annoncé.
- **Rétrocompatibilité** : sans `expected_files`, aucun appel de vérification,
  aucun texte ajouté.
- **Preuve** : `src/js/garde-fou-livrable.test.js` (refus lecture seule,
  lecture acceptée, fichier absent ⇒ échec, présent ⇒ succès, sans champ ⇒
  inchangé, agent jetable, verrou de source sur les 3 chemins de lancement) +
  `src/js/garde-fou-refus-lecture-seule.test.js` (les 4 formulations réelles qui
  étaient refusées à tort sont **acceptées** : verbe dans une phrase négative,
  consigne « ne modifier aucun fichier », étiquette « À CORRIGER », « relancer
  une correction » ; les vraies demandes d'écriture restent **refusées** ; deux
  mutations du module — décision sur un mot, garde-fou permissif — font échouer
  respectivement 15 et 14 tests).

### Commandes Tauri (compétences)

- `list_common_skills() → [{ name, description }]` : inventaire de `~/.pilot/skills` pour le sélecteur de l'éditeur (lecture seule).
- `default_agent_ids() → [String]` : identifiants des 7 agents fournis (source unique, sert au garde-fou de création).

## 4. Protocole inter-agents

### Appel sortant (dans la réponse d'un agent)

```text
Voici mon analyse.

[[CALL:codeur]]
{
  "task": "Crée la route GET /api/search...",
  "files": ["src/routes/search.js"],
  "context": "Utilise Express."
}
[[/CALL]]
```

- Prendre le **dernier** bloc `[[CALL:...]]`.
- JSON optionnel ; si invalide, le brief reste le texte brut entre les marqueurs.

### Résultat renvoyé à l'appelant

```text
[[RESULT from codeur (status: done)]]
DONE: Route GET /api/search créée.
[[/RESULT]]
```

- `status` : `done`, `need_help`, `timeout`, `error`.
- Contenu tronqué selon le budget configuré.

### Délégation parallèle (H2 V2 parallèle)

Pour des sous-tâches **indépendantes**, un agent (typiquement le coordinateur) peut
lancer plusieurs agents **simultanément** via un bloc `[[PARALLEL]]` :

```text
[[PARALLEL]]
agent: codeur
task: Implémente la route GET /api/search.
---
agent: testeur
task: Écris les tests de la route GET /api/search.
---
agent: documenteur
task: Documente la nouvelle route dans le README.
[[/PARALLEL]]
```

- Chaque bloc `agent:` + `task:` est une sous-tâche confiée à un agent distinct,
  exécutée **en parallèle** (chacun dans son propre processus pi).
- Les agents parallèles sont des agents « feuille » : ils exécutent leur brief et
  retournent leur résultat (pas de délégation `[[CALL]]` imbriquée en V1).
- Quand tous ont terminé, leurs résultats sont **agrégés** et renvoyés à
  l'appelant via `[[RESULT from parallel (status: done)]]`.
- Garde-fous appliqués par agent : budget (`max_calls_per_run`), budget total,
  timeout d'inactivité. `stopAgentsRun` abort **tous** les agents actifs.

### Mode parallèle piloté par l'Assistant

Le mode parallèle de l'onglet 🎭 (sélection d'agents + envoi depuis un champ de saisie) **n'existe plus** : la colonne « discussion » a été retirée de l'écran de configuration. Les runs parallèles restent possibles via le bloc `[[PARALLEL]]` du coordinateur et via `runAgentsForAssistant(assignments)` (bus d'agents), utilisés par l'Assistant.

### L'Assistant comme coordinateur (spec_super_agent.md)

L'**Assistant** (onglet 🧭) est le **coordinateur de la redistribution des
tâches** entre les agents du registre. Via les outils `create_agent` et
`run_agents` (extension `pilot-assistant-actions`), il peut :

1. **Créer un agent sur mesure** dans le registre global (base SQLite) s'il
   estime que les agents disponibles ne conviennent pas (rôle construit selon
   son besoin).
2. **Choisir quels agents utiliser** (sélection par id) et lancer une tâche sur
   eux (en parallèle), en recevant le résultat agrégé pour continuer son
   raisonnement.

Le bus d'agents expose `runAgentsForAssistant(assignments)` (Promise résolue
avec le résultat agrégé) pour ce cas d'usage, distinct de l'UI de l'onglet 🎭.

## 5. Backend Rust

### AgentService (propriétaire unique des sessions)

Les sessions des agents multi-rôles H2 V2 vivent dans le **registre unique de
l'AgentService** (`agent_service.rs`), indexé par clé composite `(project, agent)`,
au même titre que la session principale (chat Agent Pi), le reviewer
`orch-reviewer` et le super-agent `superagent`. Elles y sont marquées
`SpawnMode::AgentProcess` (canal `rpc-event-agents`) pour être arrêtées par
`stop_all_agent_processes` et distinctes des sessions `MainSession`.

```rust
// agent_service.rs
sessions: Mutex<HashMap<String, SessionEntry>>,  // clé composite (project, agent)
active:   Mutex<Option<String>>,                 // agent_id actuellement affiché
```

Les commandes `agents.rs` (`do_start_agent_process`, …) délèguent à
`AgentService.start` / `AgentService.send` / `AgentService.stop` au lieu de
toucher une map `agent_sessions` d'`AppState` (champ retiré en phase 2).

### Commandes Tauri

- `start_agent_process(agent_id, cwd, pi_path, no_session)`
- `stop_agent_process(agent_id)`
- `stop_all_agent_processes()`
- `send_agent_process_prompt(agent_id, message)`
- `new_agent_process_session(agent_id)`
- `set_agent_process_model(agent_id, provider, model_id)`
- `abort_agent_process(agent_id)`
- `get_agent_process_state(agent_id)`
- `load_agent_registry()` / `save_agent_registry(registry)` : anciennes commandes fichier ; elles persistent désormais en base via `list_agents` / `replace_agents`.
- `list_common_skills()` : inventaire des compétences de `~/.pilot/skills`.
- `default_agent_ids()` : identifiants des agents fournis.
- `register_ephemeral_agent(agent, project?)` / `clear_ephemeral_agent(agent_id)` / `list_ephemeral_agents()` : agents **jetables** en mémoire seule (aucune écriture en base).

### Dossier global

`~/.pilot/` résolu cross-platform (dossier utilisateur Pilot). Il contient la base du registre (`pilot.db`), la bibliothèque de compétences (`skills/`) et les espaces de l'Assistant.

## 6. Frontend

### Modules

| Fichier | Rôle |
|---|---|
| `src/js/agents.js` | Fonctions pures : registre, modèles, prompts, parsing (`[[CALL]]`, `[[PARALLEL]]`), agrégation, garde-fous. |
| `src/js/agents-bus.js` | Bus d'exécution : pile, timeouts, envois/réceptions, dispatch parallèle (`dispatchParallel`, `startParallelRun`), buffers par agent. |
| `src/js/agents-ui.js` | Rendu de l'onglet Agents : **configuration** (liste + éditeur, dont le sélecteur de compétences) et panneau d'**activité** des runs. |
| `src/js/project-task-queue.js` | File d'attente **par projet** (mission 385) : rangs et libellés en français (purs), vue de la file, textes affichés, et état de la file des **commandes manuelles** du chat (mise en file + démarrage automatique à la libération). |
| `src/js/project-queue-view.js` | Composition de la file **visible** d'un projet à partir des files réelles (commandes, missions, délégations, agents en file) + abandon des demandes en attente (`/file vide`). Aucune logique de lancement. |

### File d'attente des tâches par projet (mission 385)

**Invariant** : sur un projet, une seule tâche tourne à la fois ; les suivantes
attendent leur tour, avec leur rang, et démarrent **automatiquement** à la
libération de la place. La place est rendue sur **réussite, erreur, arrêt
utilisateur, mort de session et par le chien de garde** ; une activité résiduelle
sans session vivante ne bloque plus le projet.

La file **n'invente aucune file parallèle** : elle compose celles qui existent
(dans l'ordre de démarrage observé) et n'ajoute que celle qui manquait, les
**commandes manuelles** du chat d'agent (auparavant un refus sec perdait la place).

| Famille | Source de vérité (existante) | Rejeu |
|---|---|---|
| Commande manuelle du chat | `project-task-queue.js` (nouvelle file) | sonde périodique `QUEUE_TICK_MS` (5 s) |
| Mission de l'assistant (`run_agents`) | `runAgentsQueueByProject` (`super-agent.js`) | `armQueueReplay` (existant) |
| Délégation (`delegate_to_coder`, #66) | `delegationState(p).queue` (`super-agent.js`) | `armDelegationQueueReplay` (existant) |
| Demande d'agent (spécialité occupée) | `exclusivityQueue` (`agents-bus.js`) | `launchNextQueued` / drains (existants) |

- **Sonde d'admission** : la politique existante `canSendManualCommandAsync(...)`
  (`isRunInProgress` + activité réelle de l'agent + `releaseOrphanRunLock`).
  **Fail-closed** : sonde en échec ou absente → rien ne démarre, la demande
  reste en file. Une commande en file ne démarre donc jamais en parallèle d'une
  tâche en cours.
- **Le lanceur d'une commande en file réutilise `sendPrompt()` à l'identique** :
  aucune modification du lancement d'agent, de l'estimation préalable ni du
  plan-maker (périmètre strict de la mission).
- **Démarrage non confirmé** (toujours libre après `QUEUE_CONFIRM_MS` = 10 s, ou
  lanceur en échec) : la demande est remise **en tête** de file ; après
  `QUEUE_MAX_ATTEMPTS` (3) elle est abandonnée **avec un message** — jamais en
  silence. Une demande identique déjà en file n'est jamais dupliquée ; la file
  est plafonnée à `QUEUE_MAX_LENGTH` (50).
- **Affichage** : bloc discret `.agent-queue-block` sous la barre d'outils de
  l'onglet de l'agent (masqué si la file est vide), titré « 🧾 File d'attente —
  N en cours · M en attente », lignes « en cours : … », « en attente (2e) : … ».
  **Chaque ligne de demande en attente nomme l'agent qui la traitera**
  (« … · agent : <agent> »), à partir de l'agent **réellement enregistré avec
  la demande** : `agentIds` d'une mission de l'assistant (`allocateMissionIdentity`),
  `agentId` d'une commande manuelle (`enqueueProjectCommand`), d'une délégation
  (`delegationState(p).queue`) ou d'une demande d'agent en file d'exclusivité
  (`listProjectExclusivityEntries`). Aucun nom n'est **déduit** ni **inventé** à
  l'affichage ; quand la demande ne porte aucun agent, la ligne affiche
  `AGENT_UNKNOWN_LABEL` (« agent non défini ») — **jamais un vide**. La ligne
  « en cours » est **inchangée** (elle ne reçoit pas de suffixe d'agent).
  Point d'affichage **unique** : `entryLine` (`project-task-queue.js`), partagé
  par le bloc de l'onglet et `/file` — aucune seconde copie du format.
  Rafraîchi par l'événement `pilot-queue-changed` (émis par la boucle) et aux
  `agent_start` / `agent_end`.
- **Commandes de chat** : `/file` affiche la file (`formatProjectQueueReport`) ;
  `/file vide` abandonne les demandes **en attente** et annonce les décomptes par
  famille (`formatQueueClearedMessage`). Traitées **localement** (jamais envoyées
  au moteur), sur le modèle de `/verrou`.
- **Tests** : `src/js/project-task-queue.test.js` (ordre, une seule tâche
  démarre, la suivante démarre seule, place rendue, rien perdu),
  `src/js/project-queue-wiring.test.js` (composition de la file visible,
  `/file vide`, câblage de l'onglet, style, agent réel de chaque famille de
  demande) et `src/js/file-attente-nom-agent.test.js` (le nom de l'agent ne
  peut pas disparaître d'une demande en attente ; un agent inconnu est **dit**
  et jamais laissé vide ; ordre, rangs et nombre de demandes inchangés ; ligne
  « en cours » inchangée).

#### Ordre d'arrivée à l'admission (P1)

**Défaut corrigé** (cf. `rapport-file-attente-pertes-doublons.md` §4.1) : à
l'admission d'une demande, la file du projet n'était **jamais consultée** — seul
le verrou de run décidait. Dès qu'il paraissait libre, la demande qui arrivait
démarrait **devant** les missions déjà en attente.

**Règle** : les trois points d'entrée d'une demande d'agents (`run_agents` via
`launchOrQueue`, `run_agents` via `startRun`, `run_assistant_agents`) décident
par le **point unique** `decideMissionAdmission(target, {busy, dequeue})`
(`super-agent.js`), dans cet ordre :

1. des missions attendent déjà → la demande s'empile **derrière** elles
   (`reason: "queue-ahead"`), même si le projet paraît libre ;
2. le projet est réellement occupé → empilement (comportement historique) ;
3. sinon → démarrage immédiat.

**Décision explicite et tracée** : un cas `queue-ahead` écrit une ligne de
journal (`reason=queue-order-respected`, `detected=admission-fifo`) nommant les
missions déjà en attente, et affiche à l'écran le nombre de demandes devant.
`armQueueReplay` est armé dans tous les cas : la file est drainée dans l'ordre.

**Pas de boucle** : le lancement issu du rejeu (`launchQueuedMission` →
`entry.launch({dequeue: true})`) ne se compte pas comme « une mission devant ».

**Limite connue (L1), assumée en l'état** : la garantie d'ordre vaut à
l'**admission**, pas sur le **rebouclage** d'une mission déjà sortie de file.
Si le projet est encore occupé au moment du rejeu (mission de **lecture**,
commande **manuelle**, run d'un autre agent), la mission est remise en file par
`enqueueMissionForProject` — donc **en queue** (`push`) et non en tête : avec
`[B, C]`, la file devient `[C, B]`. Aucune perte, aucun doublon (même mission,
même numéro, rejeu réarmé) ; seul l'**ordre d'attente** peut changer. Détail et
preuves : `spec_super_agent.md` § 13 « Limites connues » (L1). Tests : aucun ne
couvre ce cas aujourd'hui (prouvé par lecture).

**Tests** : `src/js/file-attente-fifo-admission.test.js` (décision, ordre
d'exécution réel [A puis B], trace, câblage des trois points d'entrée, vue de la
file).

#### Fiche d'agent (éditeur, deux colonnes)

L'éditeur d'agent (`.modal-content.agent-editor-content` : largeur 900 px plafonnée à `92 vw`, `max-height: 88 vh`) présente la fiche sur **deux colonnes** (`.agent-form-cols`, grille `minmax(0, 1fr) minmax(0, 1.1fr)`) :

- **colonne gauche** — identité et modèles : `#ae-id`, `#ae-name`, `#ae-icon`, `#ae-description`, `#ae-model-pi` + `#ae-thinking-pi` (+ note), `#ae-model-plh` + `#ae-thinking-plh` (+ note) ;
- **colonne droite** — rôle, compétences et garde-fous : `#ae-role` (textarea haut, `resize: vertical`), `#ae-skills`, `#ae-readonly`, `#ae-keep`, `#ae-max-calls`, `#ae-depth`.

Les identifiants `#ae-*` sont **inchangés** : l'enregistrement relit exactement les mêmes valeurs (aucune perte). Sous `max-width: 900px`, la grille repasse en **une seule colonne** (aucun champ coupé) ; l'`overflow-y` de `.agent-form` conserve le défilement quand la hauteur manque. Test de cablage : `src/js/agents-editor-layout.test.js`.

### Résolution du modèle

1. `backendKind()` → `"pi"` / `"plh"`.
2. `models.{backend}` → fallback sur l'autre backend → fallback modèle par défaut du backend → modèle courant.

### Garde-fous (configurables dans Paramètres)

- Profondeur max d'appel : 3 (défaut).
- Budget total d'appels : 30.
- Timeout d'inactivité : **600 000 ms (10 min, défaut)** — `default_agent_timeout_ms()` (`src-tauri/src/lib.rs`), même valeur côté front (`DEFAULT_TIMEOUT_MS`, `src/js/agents-bus.js`), dans le champ de l'interface (`index.html`, `min="10000"`, `max="1800000"`) et au repli d'enregistrement (`src/js/settings.js`). Réglable par `agent_timeout_ms` ; relevé de 120 s → 300 s (issue #10) puis de 300 s → 600 s (issue #19, commit `31707a9`) parce que les agents enchaînent des outils longs (codeur/builds). À l'échéance, un message d'erreur clair est affiché et la run s'arrête SANS message « arrêtée par l'utilisateur » (issue #10). Garde-fou : `src/js/help-delai-inactivite.test.js` compare la valeur annoncée ici et dans l'aide intégrée à la valeur réelle du code.
- Taille max résultat renvoyé : 4000 tokens.
- Détection de cycle : interdit de rappeler un agent déjà dans la pile.

## 7. Cycle de vie

- **Règle propriétaire (2026-10-21) — l'écran ne commande plus le travail** :
  un **changement de projet**, une **fermeture de projet** ou l'**ouverture d'un
  autre projet** n'arrête **JAMAIS** un agent en cours, quel que soit son mode
  (chat du projet, agents multi-rôles 🎭, agent d'assistant hors projet).
  - L'onglet 🎭 (`mode "agents"`) est **TRANSVERSE** (`GLOBAL_TAB_MODES`,
    `src/js/tab-scoping.js`) : il n'est plus fermé par une bascule. Avant, sa
    fermeture déclenchait le nettoyage ci-dessous → arrêt **GLOBAL** de tous les
    processus (projet quitté, projet ouvert, troisième projet).
  - Les deux appels `invoke("stop_all_agent_processes")` de `tabs.js` passent
    sous la garde `skipAgentStop` : un **geste d'interface** (fermeture/
    démontage d'onglet lié à une bascule) n'émet plus d'arrêt global.
    `destroyAgentsBus()` ne fait plus que détacher le bus.
  - Fermer un projet **parke** l'agent de chat (`close_project` → `pause`) et
    libère seulement les sessions **oisives** du projet
    (`stop_idle_project_sessions`) : un agent qui **travaille** continue.
- `stop_all_agent_processes()` reste réservé à l'**arrêt explicite global**
  (décision utilisateur) et à la fermeture de l'application ; il n'est plus
  appelé par un changement/fermeture de projet.
- Les **arrêts ciblés** sont protégés par l'identifiant de session
  (`expectedUid` / `sessionUid`) : contrôle et action dans la même section
  critique (`stop_owned`, `send_owned` côté `agent_service.rs`) — un arrêt
  périmé ne peut plus emporter la session neuve du même couple (projet, agent).
- Sous-agents avec `keep_context: false` reçoivent `new_session` avant chaque appel.
- Le coordinateur garde son contexte pendant toute la run.

## 8. Anti-régression

### 8.1 Affichage du travail en cours (attente silencieuse)

> Origine : `.pilot/rapports/rapport-diagnostic-attente-silencieuse.md`. Pendant
> une compilation de dix minutes, l'écran laissait croire que tout était arrêté.
> La cause était l'**affichage** (un outil traité comme un événement
> instantané), pas la tuyauterie RPC. **Aucune** règle de détection, d'arrêt ou
> de délai n'a changé.

- **Module pur dédié `src/js/duree-travail.js`** : `formatElapsed` /
  `shortElapsed` (durées), `formatWorkingSince` / `formatWorkingSinceShort`
  (« En cours depuis … »), `resolveAgentStatus` (**seul** décideur du libellé
  d'état : « ⏳ bash en cours… (3 min 12 s) » pendant un outil), `clipLiveOutput`
  + `LIVE_OUTPUT_MAX_LINES`/`_CHARS` (sortie en direct bornée, dernières lignes),
  `toolUpdateText`. Testé sans DOM (`travail-visible.test.js`).
- **Onglet agent (`agent-pi.js`)** : `tool_execution_update` n'est plus ignoré —
  il écrit la sortie en direct (throttle `LIVE_OUTPUT_THROTTLE_MS = 300`, un seul
  `<pre class="agent-tool-live">` réutilisé, jamais de `scrollIntoView`).
  `tool_execution_start` mémorise `toolStartedAt` **avant** tout retour
  d'affichage ; `appendToolBlock(..., live=true)` ajoute la classe `running`, le
  point et le compteur ; `finalizeToolBlock` retire la sortie en direct et
  **fige** la durée. Les blocs rejoués depuis l'historique passent `live=false`
  (markup d'origine, jamais de faux « en cours »). Un `statusTicker` de **1 s
  sans aucun appel IPC** reformate les compteurs ; le poll de 2 s lit
  `toolInProgress`.
- **Panneaux (`agent-activity.js`)** : `flattenAgents` alimente un magasin
  `workingSince` (purgé à l'arrêt, donc aucune durée périmée),
  `buildRunningMissions` expose `since` (missions **en cours** seulement),
  `renderCard` affiche « En cours depuis … », `anyBusy` s'appuie sur
  `isAgentWorking` (et non `busy` seul : un outil long laissait la pastille
  s'éteindre).
- **Backend (`dashboard.rs`)** : `get_agent_supervision` recopie des champs
  **additifs** déjà calculés par `agent_service.rs` (`lastActivity`,
  `lastActivityRelative`, `isWorking`) à côté de `toolInProgress`. Aucune
  sémantique modifiée.
- **Ne pas régresser** : la sortie en direct ne doit jamais forcer le défilement
  (`shouldFollowBottom`), les plafonds de sortie existants restent, et un libellé
  rassurant (« Prêt », « Réflexion… », « Agents au repos ») ne doit jamais
  s'afficher pendant qu'un outil tourne.

- Ne pas toucher à `agent-pi.js`, `orchestration.js`, `agents-bus.js` (logique d'orchestration frontend).
- Toutes les sessions passent par l'AgentService (une seule indirection `send`), jamais par un accès direct à une map dans `AppState`.
- Utiliser un canal séparé `rpc-event-agents` pour ne pas polluer les canaux existants.
- Tous les agents sont lazy et arrêtés proprement.
- Les sessions d'agents reçoivent leurs `--skill` + `PILOT_AGENT_SKILLS` dans `spawn_agent_process` (agent_service.rs) : ne pas revenir à un spawn sans compétences.
- **Réinitialiser** ne doit jamais faire de `DELETE` du périmètre global (D5) : un upsert par agent fourni, sans toucher aux agents personnalisés. Le frontend doit **réafficher le registre réel relu en base** (`list_agents`), jamais le retour de `reset_agent_registry` (qui ne contient que les fournis) : sinon les agents personnalisés disparaissent à l'écran, puis en base à la sauvegarde suivante (le frontend redessine et renvoie la liste affichée).
- **D4 (création avec l'id d'un fourni) refusé aussi dans le cœur** : la commande `upsert_agent` refuse la création d'un agent GLOBAL dont l'id est celui d'un agent fourni (mise à jour d'un fourni existant et agents de projet restent autorisés). Un appel IPC direct ne doit pas pouvoir contourner la règle appliquée par l'interface.

---

*Voir aussi : `plan_gestion_agents.md` (plan d'implémentation détaillé).*
