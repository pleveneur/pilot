# Instructions pour l'assistant de développement — Projet Pilot

## Rôle

Tu es mon assistant de développement pour le projet **Pilot**, un éditeur texte multiplateforme conçu pour les agents IA, basé sur **Tauri v2** (Rust) + **HTML/CSS/JS** + **Vite**.

Tu m'aides à faire évoluer le projet en écrivant du code, en corrigeant des bugs et en t'assurant que les spécifications et la documentation restent cohérentes.

---

## Langue

- **Parle toujours en français**, même quand tu raisonnes ou analyses du code.
- Le code source et les commentaires dans le code restent en anglais.

---

## Règle anti-régression

- Avant toute modification de code, vérifie que tu ne casses aucune fonctionnalité existante.
- Utilise systématiquement le **protocole quality-gate** (`.pi/skills/quality-gate/SKILL.md`) avant de modifier ou créer des fichiers de code (TypeScript, JavaScript, Rust, JSON, CSS, Markdown de configuration, etc.).
- Le projet doit évoluer sans avoir besoin de refaire des corrections après chaque changement.

---

## Documentation à jour

Les fichiers suivants doivent **toujours être maintenus à jour** au fil des évolutions :

| Fichier | Rôle |
|---|---|
| `spec_pilot.md` | Spécifications fonctionnelles et techniques du projet |
| `README.md` | Description du projet (utilisateurs) |

Après chaque modification impactant le comportement de l'application ou l'architecture, mets à jour le(s) fichier(s) concerné(s).

### Règles de maintenance de la documentation

Pour minimiser les tokens consommés en nouvelle session, applique ces règles à chaque modification :

1. **Arborescence** : une seule source de vérité dans `AGENTS.md` (ce fichier). Ne pas la dupliquer ailleurs.
2. **plan_dev.md** : doit rester un résumé concis (max 30 lignes). Pas d'historique des phases terminées. Juste l'état global + liens vers les specs détaillées.
3. **spec_pilot.md** : condenser les specs fonctionnelles. Supprimer les détails obsolètes. Viser 80-100 lignes max.
4. **README.md** : orienté utilisateur uniquement. Pas de détails techniques ni d'arborescence complète.
5. **Fichiers séparés** : chaque grande feature a son fichier dédié (ex: `spec_rpc.md`, `spec_pdf2md.md`). Les charger uniquement quand la tâche les concerne.
6. **Aide intégrée (handbook)** : à chaque évolution impactant l'utilisateur, mettre à jour le bloc `<!-- HELP:* -->` de la spec concernée (ou `help/overview.md` pour les généralités), puis relancer `npm run build:handbook` (automatique via `beforeDevCommand`/`beforeBuildCommand`). Ne pas éditer `help/handbook.md` (généré).
7. **Rapports et conceptions** : les rapports de mission (`RAPPORT-*.md`) vont dans `docs/rapports/` et les documents de conception (`CONCEPTION-*.md`) dans `docs/conceptions/` — deux dossiers versionnés, plats, sans renommage des fichiers. Rien de tout cela à la racine.

### Navigation rapide

| Tâche | Fichier(s) à lire |
|---|---|
| Spécifications générales | `spec_pilot.md` |
| Agent Pi / RPC | `spec_rpc.md` |
| Multi-projets (gestionnaire de projets) | `spec_multiprojects.md` |
| Discussion inter-projets (liens + dépôt de tâche) | `spec_interproject.md` |
| Sous-projets liés (ouverture groupée, local-first + GDS) | `spec_subprojects.md` |
| Conversion PDF → MD | `spec_pdf2md.md` |
| Mode Orchestration | `spec_orchestration.md` + `spec_orchestration_observability.md` + `spec_orchestration_autotest.md` + `spec_orchestration_snapshots.md` + `spec_orchestration_reviewer.md` |
| Accès distant web | `spec_web_remote.md` |
| Dictée vocale | `spec_voice_input.md` |
| Prise en main à la première ouverture | `spec_onboarding.md` |
| Service Laya (classification locale) | `spec_laya.md` |
| Réponse sur la documentation (ex-aide intégrée ❓) | `spec_help.md` |
| Revue de code assistée (H5) | `spec_review.md` |
| Lecture des réponses à voix haute (bouton 🔊, réglage unique de la voix, voix française locale hors ligne) | `spec_read_aloud.md` |
| Trois modes d'écran (Détaillé · Assistant seul · Vocal) et écran Vocal (micro, coupure de la parole, enveloppe de parole qui suit le son, trait de niveau retiré) | `spec_modes_ecran_vocal.md` |
| Conversation parlée interruptible (couper Pilot en pleine phrase) — document de conception à trancher | `docs/architecture-conversation-vocale-interruptible.md` |
| Context Engine (auto-contexte agent) | `spec_context_engine.md` |
| Code Graph (graphe de connaissances projet) | `spec_code_graph.md` |
| Diff Review agent (modifications) | `spec_diff_review.md` |
| Détection d'anomalies (agents bloqués) | `spec_anomaly.md` |
| Passerelle Telegram (envoi + écoute + réponses + dialogue) | `spec_telegram.md` |
| Mémoire de projet auto-maintenue | `spec_project_memory.md` |
| Mode consommateur MCP (POC) | `spec_pilot.md` § MCP |
| MCP piloté par l'Assistant | `spec_pilot.md` § MCP + `spec_super_agent.md` § MCP piloté (flag `mcp_agent_confirm`, outils `mcp_state` / `run_agents(mcp_server)`) |
| Historique de sessions searchable (H9) | `spec_session_history.md` |
| Feedback utilisateurs (remarques/évolutions) | `spec_feedback.md` |
| Quality-gate interne | `spec_quality_gate.md` |
| Lancements de processus (aucune fenêtre noire) | `spec_pilot.md` § 2 (point unique `gds_core::proc::hide_console`) + garde `src/js/fenetres-noires-lancements.test.js` + `docs/rapports/RAPPORT-fenetres-noires-correction.md` |
| Gestion des modèles IA (providers + alias) | `spec_rpc.md` § Édition des modèles |
| Gestion d'agents multi-rôles | `spec_gestion_agents.md` |
| Agents du projet (multi-onglets configurés) | `spec_project_agents.md` |
| Assistant (suivi multi-projets, lecture seule) | `spec_super_agent.md` |
| Tableau de bord projet (métriques, Git, langages) | `spec_dashboard.md` |
| Coffre fort de mots de passe (chiffré) | `spec_vault.md` |
| GDS (gestionnaire de sources) | `plan_gds.md` (roadmap) → `spec_gds.md` (spec détaillée, phases A→B→C) ; **mode réseau multi-postes** (un seul poste tient un projet) : `spec_reseau.md` ; mise en place : `docs/gds-server-setup.md` (serveur, référence) + `docs/gds-guide-mise-en-place.md` (parcours de retest complet, checklist serveur → usage à plusieurs) |
| Composant web de discussion (issue #56) | `spec_web_component.md` (spec détaillée, phase D) |
| Les cinq règles de la chaîne d'agents (ce qu'elles garantissent + le test qui les tient) | `spec_cinq_regles_chaine_agents.md` (source unique) |
| Roadmap restante | `plan_dev.md` + `idees_evolutions.md` |
| Protocole anti-régression | `.pi/skills/quality-gate/SKILL.md` |

---

## Stack technique

| Couche | Technologie |
|---|---|
| Backend | Rust (Tauri v2) |
| Frontend | HTML5, CSS3, JavaScript (modules ES), Vite |
| Icônes | Lucide (SVG inline, package `lucide`) |
| Éditeur | CodeMirror 6 |
| Rendu Markdown | markdown-it |
| File Watching | Poller custom Rust (`read_dir` filtré, 2 s) |
| Terminal intégré | `portable-pty` (Rust) + `xterm.js` |
| Prévisualisation PDF | PDF.js |
| Dialogue natif | `tauri-plugin-dialog` |
| Mises à jour auto | `tauri-plugin-updater` + `tauri-plugin-process` |

---

## Structure du projet

```
pilot/
├── AGENTS.md                  # Instructions assistant (ce fichier)
├── spec_pilot.md              # Spécifications fonctionnelles & techniques
├── spec_rpc.md                # Spécifications intégration agent Pi (RPC)
├── spec_pdf2md.md             # Spécifications conversion PDF → Markdown
├── spec_orchestration.md      # Spécifications Mode Orchestration
├── spec_orchestration_observability.md  # Observabilité des échecs du codeur (implémenté)
├── spec_orchestration_autotest.md  # Auto-test post-modification (E2, implémenté)
├── spec_orchestration_snapshots.md # Snapshots / annulation de tâche (A1, implémenté)
├── spec_orchestration_reviewer.md # Reviewer indépendant H2 V1 (implémenté)
├── spec_multiprojects.md    # Spécifications multi-projets (implémenté)
├── spec_interproject.md     # Spécifications discussion inter-projets (implémenté)
├── spec_web_remote.md         # Spécifications accès distant web (implémenté)
├── spec_voice_input.md        # Spécifications dictée vocale (implémenté)
├── spec_quality_gate.md       # Spécifications quality-gate interne (implémenté)
├── spec_cinq_regles_chaine_agents.md # SOURCE UNIQUE des 5 règles de la chaîne d'agents : garantie + test qui la tient
├── spec_help.md               # Réponse sur la documentation : socle + outil de l'Assistant (l'écran « Aide » a été retiré)
├── spec_review.md             # Spécifications revue de code assistée (H5)
├── spec_read_aloud.md         # Lecture des réponses à voix haute (bouton 🔊 + réglage UNIQUE de la voix : Paramètres → Assistant → Lecture des réponses)
├── spec_context_engine.md    # Spécifications Context Engine (H1, auto-contexte agent)
├── spec_code_graph.md        # Spécifications Code Graph (graphe de connaissances projet)
├── spec_diff_review.md       # Spécifications Diff Review agent (A4 V2, porte pré-écriture write/edit)
├── spec_session_history.md   # Spécifications historique de sessions searchable (H9)
├── spec_feedback.md          # Spécifications feedback utilisateurs (remarques/évolutions)
├── spec_super_agent.md       # Spécifications Assistant (suivi multi-projets, lecture seule)
├── spec_dashboard.md         # Spécifications Tableau de bord projet (issue #51)
├── spec_vault.md             # Spécifications Coffre fort de mots de passe (issue #52)
├── spec_telegram.md          # Spécifications Passerelle Telegram (envoi, écoute, réponses, dialogue)
├── plan_gds.md               # ROADMAP GDS (gestionnaire de sources) — plan validé
├── spec_gds.md               # Spec GDS : sources centralisées + suivi fusionné PostgreSQL (phases A→B→C)
├── spec_web_component.md     # Spec composant web (issue #56) : widget marque blanche (phase D)
├── plan_dev.md                # Plan de développement (résumé, ce qui reste)
├── idees_evolutions.md        # Idées d'évolutions futures
├── README.md                  # Documentation utilisateur
├── help/                      # Documentation embarquée (handbook généré)
│   ├── overview.md           # Source des généralités (rédigé, orienté utilisateur)
│   └── handbook.md           # GÉNÉRÉ (ne pas éditer) — embarqué via include_str!
├── scripts/
│   ├── build-handbook.js      # Agrège les blocs HELP des specs → help/handbook.md
│   ├── build-mcp-extension.js # Bundles esbuild de l'extension MCP (SDK embarqué) → pilot-mcp-client.ts
│   ├── mcp-test-server.js     # Serveur MCP stdio de test (outil `echo`) pour le POC MCP
│   ├── create-release.js      # Crée la GitHub Release (idempotent) avant les builds
│   ├── gen-latest-json.js     # Génère latest.json (updater) depuis les assets + changelog (git ou release-notes/vX.Y.Z.md) + met à jour le body + upload
│   └── latest-json-platforms.js # Logique PURE de gen-latest-json.js : artefact → cible d'updater (NSIS retenu, MSI écarté pour `windows-x86_64`)
├── release-notes/            # Changelog utilisateur (vX.Y.Z.md) rédigé à chaque release (option A)
├── .github/workflows/
│   └── release.yml            # Build + publication multi-plateforme (tag v*)
├── .github/ISSUE_TEMPLATE/   # Templates d'issue GitHub (bug/feature/remark + config contact)
├── package.json               # Dépendances npm
├── Cargo.toml                 # MANIFESTE RACINE du workspace Cargo (membres : src-tauri, gds-core, gds-server)
├── Cargo.lock                 # Verrou de dépendances du workspace — vit à la RACINE (plus dans src-tauri/)
├── vite.config.js             # Configuration Vite
├── index.html                 # Point d'entrée HTML
├── src/
│   ├── css/
│   │   └── style.css          # Styles (thème dark/light, layout, composants)
│   └── js/
│       ├── main.js            # Point d'entrée JS, orchestration, raccourcis
│       ├── agent-pi.js        # Chat agent Pi (RPC), streaming, onglet π
│       ├── agent-model-selector.js # C4 : id DOM du sélecteur de modèle propres au couple (projet, agent) — pures
│       ├── orchestration.js   # Mode Orchestration : prompts, parsing plan, validation (pures)
│       ├── agents-bus.js      # Bus d'agents (orchestration) : contexte de run, verrou par projet, restitution fiable fin-de-run (willRetry/agent_settled, erreurs différées) — les QUESTIONS d'un agent (extension_ui_request) ne sont plus auto-répondues : elles remontent à l'assistant (relais, voir agent-choice-relay.js)
│       ├── agent-choice-relay.js # SOURCE UNIQUE du relais des questions d'agent vers la conversation de l'assistant : événement `pilot-agent-relay-request`, décision `isRelayableAgentChoice` (exclusion des portes internes : diff review, action assistant, contrôle de l'écran), libellé `agentQuestionLabel` — partagé par agent-pi.js (onglet chat) et agents-bus.js (agents en arrière-plan, sans condition d'onglet actif) ; aucune réponse décidée à la place de l'utilisateur
│       ├── ephemeral-agents.js # Agent jetable (à la volée) : id réservé `eph-`, magasin mémoire, fusion dans le bus, purge en fin de tâche — aucune écriture en base
│       ├── agent-partial-text.js # SOURCE UNIQUE de la restitution du TEXTE DÉJÀ ÉCRIT d'un agent mort/planté (pures : `normalizePartialText` bornage + troncature dite, `extractDelegationResultText` lecture de `get_delegation_result` — aucun second mécanisme, `buildPartialTextDeathNotice`, `buildAgentDeathReport` : le texte produit ou la mention explicite « aucun texte recupere ») ; le texte rejoint le journal des arrêts EXISTANT (`text=` de `.pilot/agent-stops.log`), jamais un second journal — branché dans agents-bus.js (`finalizeDeadAgent`) et super-agent.js (`reportInvisibleAgentDeath`)
│       ├── orchestration-reviewer.js # Reviewer indépendant (H2 V1) : buildReviewPrompt, parseReviewResult, glob matching (pures)
│       ├── theme.js           # Gestion des thèmes dark/light
│       ├── sidebar.js         # Barre latérale, explorateur, filtre, menus
│       ├── tabs.js            # Système d'onglets (édition, prévisualisation)
│       ├── editor.js          # Éditeur CodeMirror 6
│       ├── preview.js         # Prévisualisation Markdown (markdown-it)
│       ├── pdf-preview.js     # Prévisualisation PDF (PDF.js)
│       ├── image-viewer.js    # Prévisualisation d'images
│       ├── csv-preview.js     # Prévisualisation CSV
│       ├── image-paste.js     # Drag & drop / Ctrl+V d'images dans l'éditeur
│       ├── inline-complete.js  # Auto-complétion IA inline (ghost text, Ctrl+Space/Tab/Esc)
│       ├── updater.js        # Vérification automatique des mises à jour (Tauri updater)
│       ├── languages.js       # Multi-langages CodeMirror 6 (lazy loading, folding)
│       ├── file-list.js       # Liste fichiers pour auto-complétion CodeMirror
│       ├── settings.js        # Modale des paramètres
│       ├── review.js         # Onglet « 🔍 Review » : revue de code assistée (H5, pi temporaire cadré ; réutilise les styles .help-*)
│       ├── context-engine.js  # Context Engine (H1) : injection auto-contexte projet avant 1er prompt
│       ├── code-graph.js      # Code Graph : bloc graphe injecté + wiki + état/rebuild
│       ├── code-graph-view.js # Onglet « Graphe » (Option C) : état + boutons + visualisation 2D force-graph
│       ├── icons.js          # Icônes Lucide (refreshIcons → createIcons, pour HTML statique et dynamique)
│       ├── project-memory.js # Mémoire projet (H3) : PROJECT_MEMORY.md injection + extraction post-tâche
│       ├── session-history.js # Historique sessions (H9) : index .pilot/sessions.jsonl + recherche + tags
│       ├── feedback.js       # Onglet « 💬 Feedback » : remarques/évolutions (GitHub + email + lecture issues)
│       ├── screen-mode.js    # SOURCE UNIQUE des trois modes d'écran : « Détaillé », « Assistant seul », « Vocal » — clé unique `pilot_screen_mode` + migration de l'ancien réglage binaire `pilot_superagent_immersive` (valeur conservée), cycle, infobulle du mode COURANT puis du mode SUIVANT, garde anti-double-clic `MODE_CLICK_GUARD_MS` = 400 ms, `screenModeScreen(mode)` (mode → écran, SEULE correspondance) ; LE BOUTON EST LE LOGO (`#mode-logo`, autour de `#btn-project-logo`, bandeau du haut de la colonne) — ni mot, ni icône, ni pastille, plus aucun `#screen-mode-button` nulle part ; il entre dans l'overlay des deux pleins écrans et y prend la MÊME place que dans « Détaillé » (une seule règle CSS à deux sélecteurs), puis il est restitué exactement à sa place à chaque sortie ; l'écran « Vocal » est RÉEL depuis le lot 2 (niveau du micro MESURÉ depuis le lot 3, coupure de parole = lot 4) ; aucun écran redessiné, aucun écran de réglage — couverture : trois-modes-ecran.test.js + ecran-vocal-lot2.test.js
│       ├── super-agent.js    # Onglet « 🧭 Assistant » : suivi multi-projets lecture seule (chat, config, init, relais des choix d'agent, tâche #22) + ÉCRAN DU MODE VOCAL (lot 2 : overlay `.pilot-vocal` — barre de 44 px qui ne porte RIEN (le logo, bouton des modes, se pose au-dessus d'elle, à sa place des trois modes), objet lumineux 168 px + trait 200×3 px, UNE ligne d'état, la barre de saisie DÉPLACÉE ; quatre états repos/écoute/réflexion/parole teintés par `--vocal-*`, trait de niveau piloté par `--vocal-level` (niveau réel fourni par `vocal-mic.js`) ; réduction de mouvement = `prefers-reduced-motion` + `window._pilotModalAnimations`, zéro nouveau réglage ; trois sorties — même bouton (le logo), Échap, fermeture de l'onglet — et jamais deux pleins écrans) ; fonctions pures `vocalScreenState` / `vocalStateClass` / `vocalStatusText` / `vocalReducedMotion` ; DÉTECTION DE L'ÉCOUTE (correctif « l'écran restait sur Je vous écoute… ») : pures `vocalCapte(niveau, etait)` et `vocalVoiceStep` à DEUX seuils (`VOCAL_VOICE_ON = 0,06` / `VOCAL_VOICE_OFF = 0,03`, hystérésis) + drapeau `vocalMicCapte` alimenté par le NIVEAU dans `vocalSetLevel` (qui réapplique l'état quand la décision change) et `listening: vocalMicListening && vocalMicCapte` dans `applyVocalState` — `vocal-mic.js` inchangé, lecture auto par le bouton `agent-read-btn` EXISTANT (`autoReadVocalReply`) ; LOT 4a : `vocalBargeIn` (voix par-dessus la lecture → `stopReading()`, SEULE voie existante, aucune reprise automatique, aucune API audio ici — la décision vient de `vocal-mic.js`) + `vocalSyncMicSpeaking` (l'état `READ_ALOUD_STATE_EVENT` est la seule source qui arme la garde du micro)
│       ├── assistant-persona.js # PERSONNAGE ACTIF déposé par le projet Présences (onglet 🧭 seulement) — SOURCE UNIQUE du nom et du portrait : lit `<app_data_dir>/.pilot/portrait/nom.txt` + `portrait.png` via la commande Rust `read_assistant_persona` ; fichier ABSENT = aucun personnage → nom réglé et icône 🧭 habituels, sans message ni exception ; pures `personaDirFor`, `normalizePersonaName`, `personaPortraitSrc` (uniquement `data:image/…;base64,` borné), `personaDisplayName` (SEULE règle de priorité : personnage → nom réglé → « Assistant »), `normalizePersona` ; état en MÉMOIRE seulement (aucune persistance, aucun réglage), `refreshAssistantPersona` **fail-open** ; Pilot ne fait que LIRE (jamais créer, écrire, nettoyer) — couverture : assistant-persona.test.js + tests Rust de persona.rs
│       ├── super-agent-context.js # 🧭 : contexte de suivi COURT joint automatiquement à la demande déléguée (pures : projet, tâches, décisions, mémoire)
│       ├── project-queue-view.js # SOURCE UNIQUE de la file visible d'un projet : composition ordonnée (« en cours » + rangs), texte de /file, vidage tracé /file vide, et RETRAIT CIBLÉ d'UNE mission (`removeProjectQueuedMission`, rang affiché → mission) — la traduction rang→mission n'existe qu'ici
│       ├── project-task-queue.js # File des commandes manuelles du projet (FIFO, sonde de rejeu, rangs affichés, abandon tracé) — module sans import Tauri
│       ├── dashboard.js      # Onglet « 📊 Tableau de bord » (issue #51) : métriques projet (stockage, Git, langages, activité)
│       ├── vault.js          # Onglet « 🔐 Coffre » (issue #52) : coffre fort de mots de passe chiffré (AES-256-GCM)
│       ├── diff-view.js       # Diff Review (A4) : diff inline + porte pré-écriture (renderEditGateDialog)
│       ├── models-config.js  # Onglet « Fournisseurs » : édition UI models.json + model-switch.json (pi/plh)
│       ├── mcp-tool-names.js # SEULE source du NOM des outils MCP exposés à l'agent (`mcp_<id du serveur>_<nom de l'outil>`) — pure, bundlée dans l'extension MCP : `mcpServerId` (id ?? name ?? "mcp"), `registeredToolName`, `serverIdOwners`/`serverIdClashMessage` (deux serveurs ACTIVÉS de même identifiant = mêmes noms d'outils ⇒ chargement refusé, message nommant les deux), `duplicateToolNames`/`firstDeclarationOnly`/`duplicateToolNameMessage` (un outil déclaré deux fois n'en remplace pas un autre en silence) — couverture : mcp-tool-names.test.js
│       ├── mcp-server-toggle.js # MCP piloté par l'Assistant : activer / désactiver UN serveur NOMMÉ depuis la conversation (`mcp_enable_server` / `mcp_disable_server`) — décision PURE (`planMcpServerToggle` : identifiant connu, ACTIVATION EXCLUSIVE qui coupe les autres et les NOMME, désactivation qui n'active personne, serveur déjà dans l'état = aucune écriture) + `applyMcpServerToggle` (lit `mcp_get_state`, écrit `mcp_set_servers_enabled`, fail-safe sans exception) ; texte de réponse et ligne système dans le même module ; l'écriture Rust ne change QUE le champ `enabled` (aucun serveur créé/supprimé, aucun contenu ni secret touché) — couverture : mcp-server-toggle.test.js
│       ├── conversation-export.js # Export conversation agent (F2 Markdown / F3 Copy HTML)
│       ├── loop-detection.js # Détection de boucle dans la réflexion du modèle (issue #37) — pure, branchée chat + sous-agents + assistant (issue #55) ; empreinte de CONTENU des écritures (faux positif « même fichier modifié 3 fois ») + lignes du journal des arrêts automatiques + `isReadOnlyShellCommand` (une répétition de LECTURE/consultation `git status|diff|log`, `ls`, `rg`, `sed -n`… n'est JAMAIS un motif d'arrêt) ; **classifieur PARTAGÉ `isReadOnlyAgentToolCall`** (+ `AGENT_READ_ONLY_TOOLS`, `AGENT_SHELL_TOOLS`, `toolCallCommand`) utilisé par les TROIS chemins d'arrêt automatique (`agent-pi.js`, `agents-bus.js`, `super-agent.js`) — règle 2 : une consultation ne déclenche un arrêt sur AUCUN chemin
│       ├── agent-stop-trace.js # Journal disque du MOTIF des arrêts automatiques d'agents : <projet>/.pilot/agent-stops.log (append + rotation) avec REPLI GLOBAL <app_data_dir>/agent-stops.log et échec visible (rapporteur → notify) — règle 3, tous les chemins d'arrêt (motifs de file : queue-replay-no-owner, queue-abandoned)
│       ├── agent-stop-funnel.js # RÈGLE 3 — ENTONNOIR UNIQUE des arrêts AUTOMATIQUES du bus : `stopAgentWithTrace({reason, detected, agentId, projectPath, uid, stop})` écrit la trace (attendue) PUIS exécute l'arrêt (fail-open côté arrêt) + détecteur PUR `scanAutomaticStopSites`/`findUnfunneledAutomaticStops` (site couvert = même instruction + même fonction englobante ; seul l'arrêt manuel porte `R3-EXCEPTION-MANUEL`)
│       ├── mission-identity.js # RÈGLE 4 : identité d'une MISSION mise en file (numéro monotone + agents visés) — pure : nextMissionId, makeMissionIdentity, missionTag, annotateMissionReport, stampQueuedMission (refus du double empilement), missionQueueLabel (journal/UI)
│       ├── reservations.js # Orchestration multi-agents T6 : estimation préalable (plan-maker) + fichiers réservés .pilot/reservations.json (pures + I/O, fail-open)
│       ├── backend-info.js   # Sonde backend (pi vs plh) + libellé dynamique "Agent Pi"/"Agent PLh"
│       ├── desktop-notify.js  # Notifications desktop natives (D1) — agent terminé à distance
│       ├── vocal-mic.js       # LOT 3 + LOT 4a — SEUL endroit où le micro du mode Vocal est ouvert (aucune API micro dans super-agent.js, verrouillé par test) : `createVocalMic` (demander / fermer / estActif / setSpeaking / bargeInReport), permission demandée au PREMIER GESTE seulement, arrêt RÉEL à la sortie (pistes `stop()` + `context.close()` + `cancelAnimationFrame`, prouvé en banc WebView2), pannes (refus, absence, occupation, périf. retiré) → message clair + mode utilisable ; pures : `smoothLevel` (montée 0.5 / descente 0.12), `levelToWidth` (échelle √, 8 → 100 %), `planLevel` (aucune valeur posée en mouvement réduit), `shouldAskVocalMic`, `rmsOf`, `micFailureMessage`. **LOT 4a — garde anti-auto-coupure** (le micro entend la voix de Pilot sortant des haut-parleurs) : `MIC_CONSTRAINTS` demande `echoCancellation`/`noiseSuppression`/`autoGainControl`, `echoCancellationOf` RELIT ce que la piste dit avoir appliqué (true/false/null = inconnu, jamais vrai par défaut), `stepSpeechGate` mesure le RÉSIDU d'écho pendant `BARGE_IN_CALIBRATION_MS` puis exige `max(0,05 ; résidu × 1,8)` pendant `BARGE_IN_MIN_MS` de voix continue, une seule fois par lecture ; `bargeInArmed` DÉSARME la détection si l'écho n'est pas maîtrisé (résidu > 0,03 averé / 0,01 quand le navigateur ne prouve rien) ⇒ aucune coupure, la lecture va au bout ; le module ne tient AUCUN lecteur : il signale `onSpeechStart`, l'arrêt reste à l'appelant — couverture : ecran-vocal-lot3.test.js + ecran-vocal-lot4a.test.js
│       ├── vocal-conversation.js # Écran Vocal, CONVERSATION PARLÉE (parler déclenche une demande, sans bouton) — SOURCE UNIQUE des DÉCISIONS, pures : `decideVocalDictation` (armer au repos / désarmer pendant la parole de Pilot, pendant son travail, hors du mode, sur projet sensible, après un arrêt manuel, pour une erreur en cours, sans transcription / ne rien faire si déjà ouverte — l'ordre des règles EST la spec), `planVocalConversation` (effets : fermer, annuler l'armement programmé, programmer ; jamais deux minuteries), `vocalDictationMessage` (UNE phrase par panne, `aborted`/`no-speech` = aucun message) + `VOCAL_ARM_DELAY_MS` 350 / `VOCAL_ARM_AFTER_READ_MS` 600 ; appliqué à UN SEUL endroit (`applyVocalState` via `vocalSyncConversation`), démarrage par UNE SEULE voie (`startVoiceInput`, extraite de `toggleVoiceInput`), envoi par le chemin EXISTANT (`applyVoiceEnd` → `send`), aucune API micro ici — couverture : vocal-parler-declenche-une-demande.test.js
│       ├── vocal-enveloppe-aigu.js # L'ENVELOPPE DE PAROLE SUIT LA VOIX de Pilot, l'aigu en tête (12/11) — UN SEUL afficheur, DEUX sources qui se remplacent JAMAIS ensemble (`planSpeechEnvelopeSource` tranche : mouvement réduit et contour spectral peint ⇒ personne n'écrit ; la mesure réelle l'emporte ; sinon le rythme du texte lu) : (1) voix locale (Piper) = un SEUL analyseur monté sur le SEUL son que Pilot joue lui-même (via `setLocalVoiceAudioTap` de local-voice.js), analyse de la BANDE HAUTE (>= 4 kHz, plafond d'analyse du projet) → énergie 0..1 (`highBandBins` / `highBandEnergy` : silence → 0, aigu riche → ~1, son grave → 0) ; (2) voix du SYSTÈME = AUCUN flux audio accessible (interdit de faire semblant) → le RYTHME RÉEL de la phrase lue : `speechRhythmUnits` (mots → syllabes, dernière accentuée ; ponctuation → pauses 220 / 420 / 560 ms, contiguës, aucune unité pour un texte vide) + `rhythmIntensity` (position de lecture → 0..1 : pause 0, syllabe accentuée 1, ordinaire 0,55, plancher 0,2, JAMAIS d'aléatoire) ; puis le MÊME lissage `smoothEnvelopeEnergy` (montée 0,5 / retombée 0,12), `envelopeFromEnergy` (18 px → 32 px, alpha 0,80 → 1, extension = 32 × scale donc jamais au-delà), `planSpeechEnvelope` ; mètres `createSpeechEnvelopeMeter` (son) et `createSpeechRhythmMeter` (rythme, horloge seule : aucune API audio, aucun DOM) ; `vocal-speak-glow` n'est plus que le repli quand AUCUNE source n'est disponible — couverture : vocal-enveloppe-aigu.test.js + vocal-enveloppe-rythme.test.js
│       ├── voice-auto-send.js # Envoi AUTOMATIQUE à la fin d'une dictée vocale (décision du propriétaire 2026-10-26, onglet agent π, Assistant 🧭 ET web distant) — SOURCE UNIQUE de la décision et de l'ORDRE : `decideVoiceAutoSend` (jamais de texte vide, jamais sur erreur/permission/panne/arrêt manuel, jamais quand l'utilisateur a repris la main, un seul envoi par dictée), `applyVoiceEnd` (refermer la session → écrire la zone → envoyer ; rien n'est écrit ni envoyé si l'utilisateur a tapé dans la zone pendant la dictée), `composeVoiceInputValue` (composition historique inchangée) ; l'envoi reste le chemin existant de chaque barre (`sendPrompt` dans agent-pi.js, `send()` dans super-agent.js, `submitPrompt()` dans web/js/app.js — aucun second mécanisme) ; le web distant (sans bundler) l'importe depuis `/js/voice-auto-send.js`, **servi par axum depuis ce même fichier** via `include_str!` (aucune copie dans `web/`) — couverture : envoi-auto-fin-dictee.test.js + envoi-auto-dictee-web-distant.test.js + `web_server::shared_voice_module_tests`
│       ├── read-aloud.js      # Lecture à voix haute d'une réponse assistant (bouton « Écouter / Arrêter » sous la bulle) : découpage par phrases, une seule lecture à la fois, voix de la langue de l'interface par défaut (speechSynthesis natif, aucune dépendance) + CHOIX de la voix réglé à UN SEUL endroit (Paramètres → onglet Assistant → section « Lecture des réponses »), mémorisé en config `read_aloud_voice`, repli propre si la voix a disparu, état publié par évènement `pilot-read-aloud-state` ; gère AUSSI la valeur réservée `local:piper` (voix française locale) avec repli OBLIGATOIRE et visible sur la voix du système. Le nettoyage du texte dit vit dans `speech-text.js`. Couverture : read-aloud.test.js + reglage-voix-onglet-assistant.test.js + voix-locale.test.js + voix-locale-choix.test.js (voir spec_read_aloud.md)
│       ├── reponse-lue-une-seule-fois.js # SOURCE UNIQUE de l'unicité de la lecture automatique du mode Vocal (pures : `claimAutoRead` / `isAutoReadDone`, marque `dataset.vocalAutoRead` portée par le bouton d'écoute) — un tour peut avoir plusieurs fins (`agent_end` de relance) et `autoReadVocalReply` part de CHAQUE fin : sans mémoire, la même réponse était relue en entier. La marque meurt avec la bulle, le clic manuel reste libre — couverture : reponse-lue-une-seule-fois.test.js (échoue sans la garde)
│       ├── local-voice.js     # Voix françaises LOCALES (hors ligne, sans clé, sans GPU) : moteur Piper + CATALOGUE de 4 voix mono-locuteur (`LOCAL_VOICE_MODELS` : siwis-medium femme par défaut 63 201 294 o, tom-medium homme 63 511 038 o, gilles-low homme 63 104 526 o, siwis-low femme 28 130 791 o) — SOURCE UNIQUE de `LOCAL_VOICE_VALUE` (`local:piper` = voix par défaut ; `local:piper:<modèle>` = une autre voix, même champ unique) et des libellés (genre dit en clair), statut du moteur PAR MODÈLE (`tts_local_status`, `localVoiceStatusFor`), synthèse d'un morceau en WAV (`tts_local_synthesize`), lecture audio de la suite de morceaux (synthèse d'avance, arrêt immédiat), journal du repli (`tts_local_log`) ; TÉLÉCHARGEMENT du modèle choisi sur GESTE seulement (`tts_local_download` / `tts_local_cancel_download` / `tts_local_download_state`, état lisible taille + %, arrêt sans rien supprimer) ; aucun appel réseau à la lecture, toute erreur → `null` + journal, jamais une exception
│       ├── speech-text.js     # SEUL nettoyage du texte destiné à la synthèse vocale (fonction PURE `textForSpeech`) : émojis/pictogrammes retirés, balisage Markdown/HTML retiré, blocs de code non lus (annoncés), tableaux en texte courant, liens lus par leur libellé, espaces/lignes vides réduits, accents/ponctuation/chiffres conservés ; + `cutTextAtBoundary` (coupure sur fin de phrase ou de mot, jamais dans un mot). Idempotente, appelée uniquement par read-aloud.js — jamais par l'affichage. Couverture : speech-text.test.js
│       └── terminal.js        # Terminal intégré xterm.js
├── web/                       # UI web distante (mode remote, servie par axum ; assets embarqués par include_dir!)
│   ├── index.html
│   ├── css/web.css
│   └── js/ (app, chat, files, projects)
├── gds-core/                  # Socle partagé desktop ↔ serveur (aucune dépendance Tauri)
│   ├── Cargo.toml
│   ├── migrations/            # Migrations SQL GDS partagées (0001_init → 0008_project_handover)
│   └── src/                   # config, db (pool sqlx + migrations), auth, roles, git, ssh, audit, service_control, handover (règles du portage)…
├── gds-server/                # Serveur GDS headless (binaire axum, sans Tauri) + conteneur tout-en-un
│   ├── Cargo.toml             # dépend de gds-core, axum, sqlx, tokio
│   ├── src/                   # main.rs (amorçage, routeur, écoute), config.rs
│   ├── Dockerfile             # image serveur (PostgreSQL 16 + sshd + service)
│   ├── docker-compose.yml     # service unique, ports, volumes (le fichier à utiliser)
│   ├── .env.example           # modèle des variables d'environnement (aucun secret)
│   ├── entrypoint.sh          # amorçage : base, migrations, dépôts, clefs, puis supervision
│   ├── supervisord.conf       # supervision des 3 processus internes + socket de pilotage
│   ├── sshd_config            # SSH des dépôts (clef uniquement, compte `git`)
│   └── README.md              # installation du serveur en conteneur
└── src-tauri/
    ├── Cargo.toml             # Dépendances Rust
    ├── tauri.conf.json        # Configuration Tauri
    ├── capabilities/
    │   └── default.json       # Permissions Tauri
    ├── icons/                 # Icônes de l'application
    ├── assets/                # Ressources embarquées (include_str!) : notify.ps1 (son de notification de l'assistant, installé automatiquement, jamais écrasé)
    ├── extensions/            # Extensions pi embarquées (incluses via include_str!)
    │   ├── mcp-client.src.ts # POC MCP : source extension client MCP (SDK bundlé · génère pilot-mcp-client.ts)
    │   ├── pilot-edit-gate.ts # A4 V2 : porte pré-écriture write/edit (tool_call + ctx.ui.confirm)
    │   ├── pilot-context.ts   # H1/H3 : contexte+mémoire projet → system prompt (before_agent_start)
    │   ├── pilot-skills.ts    # D6 : filtrage strict des compétences par agent (before_agent_start)
    │   ├── pilot-chrome.ts    # Navigateur : autorise les outils chrome_* (pi-chrome) dans les sessions d'agents
    │   ├── pilot-choices.ts   # Issue #30 : boutons choix/confirmation/saisie (ask_choice, ask_confirm, ask_input, ask_multi_choice)
    │   ├── pilot-assistant-files.ts # 🧭 : espace d'écriture restreint ~/.pilot/assistant/ (lecture seule projets)
    │   ├── pilot-assistant-actions.ts # 🧭 : open_project / delegate_to_coder / purge_agent_conversation / run_agents(mcp_server) / mcp_state (actions Pilot via sentinel)
    │   ├── pilot-assistant-db.ts # 🧭 : db_query / db_execute (accès contrôlé à la base de suivi de l'assistant)
    │   ├── pilot-assistant-prompt.ts # 🧭 : update_my_prompt (auto-adaptation du prompt personnalisé)
    │   └── pilot-assistant-sessions.ts # 🧭 : list_agent_sessions (vue d'ensemble des sessions d'agents, P2)
    ├── vendor/                # wry 0.55.1 patché (handler micro WebView2) — dictée vocale desktop
    │   └── wry/
    └── src/
        ├── main.rs            # Point d'entrée Rust
        ├── lib.rs             # Commandes Tauri, watcher, config, PTY, RPC (cœur restant, en cours de découpage)
        ├── agent_service.rs   # AgentService : propriétaire unique des sessions (clé composite (projet, agent), pointeur actif, parking, reviewer orch-reviewer, superagent ""), registre agents (Phase 1)
        ├── agent.rs           # Agent/AgentProcessState (registre persistant, agents multi-rôles H2 V2)
        ├── git.rs            # Git intégré (C1) : status, diff visuel, snapshots/annulation (A1)
        ├── terminal.rs       # Terminal intégré (portable-pty)
        ├── files.rs          # Opérations fichiers pures (I/O, encodage, mtime)
        ├── pdf.rs            # Export Markdown → HTML (impression PDF)
        ├── models_config.rs  # Édition registres modèles (models.json / model-switch.json)
        ├── search.rs         # Recherche / remplacement global dans les fichiers (B3)
        ├── code_check.rs     # Vérification syntaxe / lint / tests de projet (E2)
        ├── plan.rs           # Persistance du plan d'orchestration
        ├── session_history.rs # H9 : historique de sessions searchable
        ├── tabs.rs           # Persistance des onglets d'édition
        ├── web_commands.rs   # Mode remote : commandes desktop de pilotage
        ├── rpc.rs            # Agent RPC pi : prompts, reviewer, sonde backend (sessions dans l'AgentService)
        ├── agents.rs         # Commandes agents multi-rôles H2 V2 → délèguent à AgentService.start/send/stop
        ├── agents_md.rs      # Génération / mise à jour d'AGENTS.md par l'IA
        ├── help.rs           # Réponse sur la documentation : handbook (include_str) + socle `answer_from_handbook` / `ask_help_doc` (+ `ask_help`/`get_handbook`, sans appelant côté écran depuis le retrait de l'onglet Aide)
        ├── review.rs         # Revue de code (H5) : ask_review (pi temporaire cadré sur diff Git)
        ├── rpc_manager.rs    # Gestion processus pi --mode rpc
        ├── tailscale.rs      # Automatisation Tailscale Serve (HTTPS auto, resync port, QR code)
        ├── web_server.rs     # Serveur axum (mode remote) : routes REST + WS
        ├── web_auth.rs       # Auth distante : argon2, token opaque, sessions
        ├── web_rate.rs       # Rate limiting login/prompt/WS (garde-fous distants)
        ├── web_audit.rs      # Journal d'audit distant (ring buffer 500, actions sensibles)
        ├── project_agents.rs # Config des agents du projet (.pilot/agents.json, issue #35)
        ├── context_engine.rs # Context Engine V2 (RAG) : embeddings Ollama + index SQLite + cosinus
        ├── code_graph.rs     # Code Graph : extraction heuristique/tree-sitter + graphe SQLite + requêtes
        ├── dashboard.rs      # Tableau de bord projet (issue #51) : métriques fichiers/Git + activité agent
        ├── vault.rs          # Coffre fort (issue #52) : AES-256-GCM + Argon2id, ~/.pilot/vault.json
        ├── tts_local.rs      # Voix françaises LOCALES de la lecture à voix haute : moteur Piper + table `VOICES` (4 voix mono-locuteur, genre + qualité + taille exacte) dans <app_data_dir>/voix-locale/ — statut PAR MODÈLE (tts_local_status(model)), synthèse WAV en base64 via processus local sans fenêtre, plafond 30 s (tts_local_synthesize(text, model)), journal du repli (tts_local_log, voix-locale.log) ; hors ligne, sans clé, sans GPU, aucun fichier supprimé
        ├── tts_local_download.rs # Téléchargement d'un modèle de voix locale, UNIQUEMENT sur geste de l'utilisateur : URL exactes du dépôt rhasspy/piper-voices, un seul modèle/fichier à la fois (garde atomique), fichier `.part` + reprise `Range` + renommage une fois complet, progression poussée (évènement tts-local-download-progress : taille + %), arrêt (tts_local_cancel_download) qui n'efface RIEN, état relisible (tts_local_download_state) ; aucune suppression, aucun autre modèle téléchargé
        ├── mcp_config.rs     # POC MCP consommateur : mcp.json (app_data_dir), serveurs stdio, test connexion
        ├── persona.rs        # PERSONNAGE ACTIF de l'Assistant (Présences) : commande `read_assistant_persona` → { name, portrait } lus dans <app_data_dir>/.pilot/portrait/ (nom.txt, portrait.png) — seul côté qui connaît app_data_dir(), chemins en PathBuf::join (Windows/macOS/Linux) ; portrait rendu en `data:image/png;base64,…` ; nom = première ligne utile, contrôles retirés, 60 caractères maxi ; PNG obligatoire, 8 Mio maxi ; LECTURE SEULE (le dossier absent n'est jamais créé), toute panne → Persona::default() (nom et icône habituels)
        ├── gds.rs            # GDS Phase A : config projet .pilot/gds.json + provision + commandes (gds_provision/gds_validate_user/gds_add_project)
        ├── gds_web.rs        # GDS : routes axum Phase A (provision, identité, projets, git) + routes B/C réservées
        ├── gds_admin.rs      # GDS : écran « 🖥️ GDS Serveur » du poste (appels HTTP à l'API du serveur, jamais de SQL direct)
        ├── gds_service.rs    # GDS : opérations de projet parlant au SERVICE avec le compte GDS de l'utilisateur (repli sur la base directe si le projet n'a pas d'identité mémorisée)
        ├── gds_ssh.rs        # GDS : clef SSH du POSTE dev (génération/lecture, enregistrement, réponse de clef)
        ├── gds_client.rs     # GDS : synchronisation du poste (`gds_sync_project` — clone / fetch / pull depuis le remote `gds`)
        ├── gds_sync.rs       # GDS : pont bidirectionnel du suivi SQLite ↔ PostgreSQL (clients/projets/tâches/décisions)
        ├── gds_handover.rs   # Mode réseau multi-postes (côté poste) : prise en main d'un projet, présence automatique (1 appel / 3 min, repère local), restitution ORDONNÉE (code → avancement → return, reprise sans saut d'étape), verdicts d'écriture lisibles
        ├── gds_write_guard.rs # Garde d'écriture tenue par le SOCLE (pas par l'écran) : refuse une écriture de fichier / le lancement d'un agent si le serveur a confirmé qu'un AUTRE poste tient le projet — **fail-open** (panne, GDS désactivé, projet libre, prise expirée ⇒ autorisé)
        └── super_agent.rs    # Assistant : session RPC dédiée + base SQLite (clients/projets/tâches) — une remise de compte rendu n'est réputée faite que sur ACCUSÉ du moteur (`injection_ack` + `send_injection_with_ack`, attente bornée hors thread principal) ; un refus ou un délai laisse la ligne en attente, jamais `delivered=1`
```

---

## Commandes importantes

Toujours indiquer les commandes à taper après une modification de code.

### Tests

```bash
# Frontend (Vitest)
npm test

# Rust — espace de travail complet (desktop + socle + serveur)
cargo test --workspace

# Rust — uniquement le desktop (Tauri)
cargo test --manifest-path src-tauri/Cargo.toml --lib

# Rust — socle partagé / serveur GDS headless (sans Tauri, sans base requise)
cargo test -p gds-core
cargo test -p gds-server
cargo build -p gds-server

# Régénérer l'aide intégrée (après toute modification d'un bloc <!-- HELP:* -->)
npm run build:handbook
```

Le serveur GDS **ne dépend pas de Tauri** : ses tests (`gds-core`, `gds-server`)
s'exécutent sans application graphique ni base PostgreSQL.

### Fins de ligne (piège CI Windows)

Les tests qui lisent le source et cherchent une ancre contenant `\n` échouent
sur un worktree CRLF (runner `windows-latest` = `core.autocrlf=true`) alors
qu'ils passent en local. `.gitattributes` force `eol=lf` sur les fichiers
texte ; un test qui lit le source normalise quand même la lecture
(`.replace(/\r\n/g, "\n")`). Vérification : `.pi/skills/quality-gate/SKILL.md`
§ 3.4.

### Publication des versions (workflow de release)

**Règle** : publier une nouvelle version **uniquement sur demande explicite de
l'utilisateur** (ex: « publie le projet », « fais une release »). Ne jamais publier
automatiquement après un commit de code — attendre la demande.

Quand l'utilisateur demande la publication :

0. **Rédiger le changelog utilisateur** `release-notes/vX.Y.Z.md` en français,
   orienté utilisateur, SANS demander de validation ni de relecture (décision
   utilisateur : option A). Trié par catégorie, langage clair pour un utilisateur
   (pas de jargon technique, pas de noms de fichiers/fonctions) :
   ```
   # Pilot vX.Y.Z
   ## ✨ Nouvelles fonctionnalités
   - …
   ## 🐛 Corrections
   - …
   ## ⚡ Améliorations
   - …
   ```
   Rédigé à partir des changements **visibles** de la session depuis la dernière
   release. Ce fichier est committé avec le bump (étape suivante) pour que le
   workflow le prenne en compte comme `notes` de la release et de la modale de
   mise à jour. S'il est absent, le workflow retombe sur un `git log` catégorisé.

1. **Bumper la version** dans les **4 fichiers** (tauri.conf.json, Cargo.toml,
   package.json, `Cargo.lock` — ce dernier vit désormais à la **racine du dépôt**,
   et non plus dans `src-tauri/`, depuis la création du workspace Cargo racine) —
   même valeur partout (ex: `0.2.3` → `0.2.4`).

   ⚠️ **Cargo.lock — PIÈGE À ÉVITER (incident v0.2.30)** : `Cargo.lock` contient de
   NOMBREUSES lignes `version = "X.Y.Z"` (une par dépendance). **Ne jamais utiliser de
   `sed` global ou à ancrage `0,/pattern/`** sur ce fichier : il modifie la PREMIÈRE
   occurrence rencontrée, qui peut être une dépendance (ex: `filetime`) et pas `pilot` →
   la dépendance se retrouve verrouillée à une version inexistante sur crates.io et
   **`cargo test --lib` échoue sur toutes les plateformes** (exit 101 en CI).
   À la place, **cibler précisément le package `pilot`** : chercher `name = "pilot"`,
   puis éditer la ligne `version` juste en dessous (via un outil d'édition ciblée, pas
   un `sed`). Après le bump, VÉRIFIER : `grep 'version = "X.Y.Z"' Cargo.lock` ne doit
   retourner qu'une seule occurrence, celle de `pilot`, et lancer `cargo test
   --manifest-path src-tauri/Cargo.toml --lib` avant de committer.
2. **Reconstruire l'image du serveur GDS** (l'image est **locale**, jamais
   téléchargée d'un registre ; la version de serveur doit correspondre au code
   publié) : `npm run gds:image` — **reconstruction seule**, le conteneur du
   propriétaire n'est **pas** touché. Le **rechargement** de son conteneur
   (sauvegarde datée → reconstruction → recréation → attente du service) est sa
   **décision**, jamais automatique : `npm run gds:reload` (détail et équivalent
   manuel : `docs/gds-server-setup.md` §9.5 ; guide :
   `docs/gds-guide-mise-en-place.md` §4.6).
3. **Committer** le bump + le `release-notes/vX.Y.Z.md` : `git commit -m "chore: bump version to X.Y.Z"`.
4. **Pousser** `main` puis **créer et pousser le tag** `vX.Y.Z` :
   ```bash
   git push origin main
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
5. Le workflow `.github/workflows/release.yml` build les plateformes, signe les
   artefacts et génère `latest.json` automatiquement. Les utilisateurs installés
   reçoivent la mise à jour au prochain démarrage de Pilot.

### Chaîne d'intégration — topologie à ne pas casser

- Job `build` (Windows + macOS) = **chemin critique** de `latest-json`, donc de la
  mise à jour automatique. `latest-json` ne dépend **que** de lui.
- Job `build-linux` = séparé : plafond **90 min**, `continue-on-error`, aucun job
  ne dépend de lui. Il ne retarde et ne bloque jamais une publication.
- Job `latest-json-linux` = seconde passe optionnelle : si (et seulement si) Linux
  a déposé ses artefacts, elle les ajoute à `latest.json`. Sinon elle ne fait rien.
- Le front est construit **une seule fois** (`beforeBuildCommand`, qui lance aussi
  `prepare:laya`) et les paquets npm sont mis en cache par système (`~/.npm`).
  Ne pas réintroduire de `cargo build` manuel ni d'étape `prepare:laya` explicite.
- Ces règles sont sous clé : `scripts/release-workflow.test.js` (`npx vitest run`).

Ne jamais republier un tag déjà existant (créer un nouveau numéro de version à la place).
Vérifier que le secret GitHub `TAURI_SIGNING_PRIVATE_KEY` est bien en place (sinon le
build échoue à la signature).

```bash
# Lancer en mode développement
# (wrapper scripts/tauri.js : identifiant séparé com.pilot.editor.dev + port
#  web décalé de +1 → la version dev tourne en parallèle de l'installée, issue #25)
npm run tauri dev

# Builder pour la production
npm run tauri build

# Générer la paire de clés de signature de l'updater (une seule fois)
# ⚠️ "npm run tauri" intercepte le -w (workspaces npm). Utiliser npx à la place.
# Sur Windows cmd.exe, remplacer ~ par un chemin explicite (ex: C:\Users\...\.tauri\).
# La clé publique va dans tauri.conf.json (plugins.updater.pubkey).
# La clé privée va dans le secret GitHub TAURI_SIGNING_PRIVATE_KEY.
npx tauri signer generate -w ~/.tauri/pilot-updater.key

# Publier une nouvelle version :
# 1. Bumper la version dans tauri.conf.json, Cargo.toml, package.json ET Cargo.lock
#    (Cargo.lock vit à la RACINE du dépôt — workspace Cargo — et non plus dans
#    src-tauri/ ; cibler le package `pilot` précisément, jamais de sed global —
#    cf. la précaution ci-dessus).
# 2. Vérifier cargo test --lib (anti-régression).
# 3. Committer, tagger, pousser.
# Le workflow .github/workflows/release.yml build et publie tout seul.
git tag v0.2.0 && git push origin v0.2.0
```

---

## Compatibilité

Le projet doit être compatible avec les trois plateformes :

| OS | Shell terminal intégré |
|---|---|
| **Windows** | `cmd.exe` |
| **macOS** | `$SHELL` ou `/bin/zsh` |
| **Linux** | `$SHELL` ou `/bin/bash` |

Toute modification doit fonctionner sur ces trois environnements. En cas de code spécifique à une plateforme, toujours prévoir le fallback pour les autres.

---

## Convention de nommage

- Commandes Tauri (Rust) : `snake_case` (ex: `open_project_path`, `read_file_content`)
- Fonctions JS : `camelCase` (ex: `openFile`, `closeTab`)
- Fichiers JS : `kebab-case` (ex: `pdf-preview.js`, `image-paste.js`)
