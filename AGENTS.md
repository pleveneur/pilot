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
| Conversion PDF → MD **et export Markdown → PDF** (sans impression) | `spec_pdf2md.md` |
| Mode Orchestration | `spec_orchestration.md` + `spec_orchestration_observability.md` + `spec_orchestration_autotest.md` + `spec_orchestration_snapshots.md` + `spec_orchestration_reviewer.md` |
| Accès distant web | `spec_web_remote.md` |
| Dictée vocale (+ **oreille locale, § 9 : pont machine + écran branché** — case « Transcrire avec le service de voix local », repli vers le navigateur **toujours annoncé**, jamais silencieux) | `spec_voice_input.md` |
| Prise en main à la première ouverture | `spec_onboarding.md` |
| Service Laya (classification locale) | `spec_laya.md` |
| Réponse sur la documentation (ex-aide intégrée ❓) | `spec_help.md` |
| Revue de code assistée (H5) | `spec_review.md` |
| Lecture des réponses à voix haute (bouton 🔊, réglage unique de la voix, voix française locale hors ligne, **voix IMITÉE de l'utilisateur via le service local VoiceStudio** — service absent → repli visible sur Piper) | `spec_read_aloud.md` (voix générale + **voix propre au personnage actif** § 3 bis) |
| Trois modes d'écran (Détaillé · Assistant seul · Vocal) et écran Vocal (micro, coupure de la parole, enveloppe de parole qui suit le son, trait de niveau retiré, **état nu § 4ter** : tout masquable sauf le portrait, un seul bouton-œil, aucune mémorisation ; **§ 8bis : aucun calque ne capte les clics** — le calque plein écran est traversant, seuls six hôtes captent, verrou `src/js/vocal-aucun-calque-ne-capte-les-clics.test.js`, issue #381 ; **le texte d'une tâche de la colonne de droite est celui de la mission qui tourne réellement**, relu juste après l'envoi du prompt, verrou `src/js/libelle-tache-en-cours-mission-reelle.test.js` ; **§ 6quater : l'écran n'obéit qu'à son nom** — rien ne part, ne s'écrit ni ne s'affiche tant que le nom de l'assistante n'a pas été prononcé, le bouton « Réveiller <Nom> » vaut pour UNE phrase, le clavier n'est jamais filtré, verrou `src/js/vocal-nom-garde.test.js` ; **§ 6quater.1 : mots de réveil réglables** — champ texte unique `vocal_wake_words` (Paramètres → Assistant → « Mode Vocal », défaut **vide** = nom seul, à l'identique), un mot saisi suffit, le nom reste **toujours** accepté en plus, verrou `src/js/mots-de-reveil.test.js`) | `spec_modes_ecran_vocal.md` |
| Conversation parlée interruptible (couper Pilot en pleine phrase) — document de conception à trancher | `docs/architecture-conversation-vocale-interruptible.md` |
| Portrait **sous le cercle** + deux colonnes (discussion à gauche, travail à droite) — **point 7 LIVRÉ le 2026-11-13** : le milieu est une seule colonne de grille (`.vocal-center`, disque puis médaillon + nom sur le même axe), le médaillon se mesure sur la **hauteur** de la rangée (96 → **276 px**, ≈ 2,9× ; la cible de 288 px du module, 3×, est bornée par le diamètre du cercle), la liste des tâches ne perd plus aucune rangée, et sans image le cercle est **exactement centré** ; largeur et budget par `src/js/vocal-sides.js`, verrou `src/js/ecran-vocal-point7-photo-sous-le-cercle.test.js` | `spec_modes_ecran_vocal.md` § 3ter (« Le cercle en haut, le personnage dessous ») + `docs/rapports/RAPPORT-ecran-vocal-point7-cercle-photo.md` + `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md` (**§ 6 : tout masquer d'un geste, sauf le portrait** — décision 9 du 2026-10-29) |
| Context Engine (auto-contexte agent) | `spec_context_engine.md` |
| Code Graph (graphe de connaissances projet) | `spec_code_graph.md` |
| Diff Review agent (modifications) | `spec_diff_review.md` |
| Détection d'anomalies (agents bloqués) | `spec_anomaly.md` |
| Passerelle Telegram — **canal de conversation seule** (décision 2026-11 : plus aucun message d'ÉVÉNEMENT ; couperet `isTelegramEventMessageAllowed()` dans `telegram-dialog.js`, garde `src/js/telegram-conversation-seule.test.js`, `spec_telegram.md` § 16) : écoute, questions/réponses, dialogue | `spec_telegram.md` |
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
├── spec_voice_input.md        # Spécifications dictée vocale (implémenté) + OREILLE LOCALE § 9 (pont machine livré, écran pas encore branché)
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
│   ├── create-release.js      # Crée la GitHub Release (idempotent) avant les builds ; REFUSE un tag déjà publié, et refuse sans changelog lisible (décisions pures dans release-gates.js)
│   ├── detect-macos-gap.js    # macOS absent : seule source de `ALLOW_INCOMPLETE_RELEASE` — lit les fichiers déposés, applique la règle pure `evaluateMacosGap`, n'autorise la livraison incomplète QUE si seul macOS manque, et annonce l'absence (journal + phrase de release)
│   ├── publication-sans-macos.test.js # Verrous : une annulation de machine Apple ne peut plus faire sauter la publication ; une livraison incomplète ne repart jamais sans autorisation explicite ni sans annonce
│   ├── gen-latest-json.js     # Génère latest.json (updater) depuis les assets + changelog (git ou release-notes/vX.Y.Z.md) + met à jour le body + upload ; REFUSE une livraison incomplète sur le chemin critique
│   ├── latest-json-platforms.js # Logique PURE de gen-latest-json.js : artefact → cible d'updater (NSIS retenu, MSI écarté pour `windows-x86_64`)
│   └── release-gates.js       # DÉCISIONS PURES de publication (source unique) : changelog obligatoire, livraison complète (portée de l'autorisation = `MACOS_PLATFORMS` seulement : l'absence de macOS peut être autorisée, pas celle de Windows), tag déjà publié, phrase d'annonce de l'absence de macOS (`macosMissingNotice`) — chaque refus nomme sa sortie de secours explicite (ALLOW_*_RELEASE)
├── release-notes/            # Changelog utilisateur (vX.Y.Z.md) rédigé à chaque release (option A)
├── .github/workflows/
│   ├── release.yml            # Build + publication multi-plateforme (tag v*)
│   └── quality-gate.yml        # Contrôle minimal des propositions de modification et de `main` : tests front + Rust, aucune permission d'écriture, ne publie rien
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
│       ├── machine-sentinel.js # FILET DE SÉCURITÉ DES SENTINELLES MACHINE — une chaîne `PILOT_<FAMILLE>::<charge utile>` (appel de fonction interne d'une extension) n'est JAMAIS peinte brute : `hasMachineSentinel` / `machineSentinelOf` / `isAssistantSentinel` / `scheduleRequestFrom` / `scheduleSentence` / `isSelfAnsweredMachineRequest` (une action interne exécutée par le relais ne réclame pas de réponse) + `readableMachineText` / `readableQuestion` (famille connue → phrase française ; famille inconnue → formulation neutre ; texte sans sentinelle → INCHANGÉ) — appliqué au moment de PEINDRE dans super-agent.js (renderSuperAgent{Choice,Confirm,Input} + les trois barres de #pendingBar, relais des questions d'agents), agent-pi.js (renderInline{Choice,Confirm,Input}), agent-choice-relay.js (libellé d'alerte) et agents-bus.js (message d'attente honnête) ; le relais EXÉCUTE la planification (`runSuperAgentScheduleOp`, point unique, canal assistant ET relais) au lieu de l'afficher — couverture : sentinelle-jamais-affichee-brute.test.js ; rapport : docs/rapports/RAPPORT-sentinelle-brute-confirmation.md
│       ├── agent-lifespan-rule.js # SOURCE UNIQUE de la règle « agent JETABLE par défaut » de l'Assistant : `AGENT_LIFESPAN_RULE` (la consigne en clair : besoin ponctuel → agent jetable via `agents` de run_agents / run_assistant_agents, rien en base ; `create_agent` RÉSERVÉ aux rôles DURABLES ; dans le doute ne rien créer, l'Assistant ne peut pas supprimer une entrée du registre), `AGENT_LIFESPAN_RULE_GUIDELINE` (même règle en une phrase, pour les `promptGuidelines`), `AGENT_LIFESPAN_RULE_SNIPPET`, `decideAgentKind(need)` (pure : seul `durable === true` autorise `create_agent`) et `findAmbiguousLifespanWording(text)` + `AMBIGUOUS_LIFESPAN_MARKERS` (pure : détecte les formulations qui rendraient un agent permanent acceptable PAR DÉFAUT — « si nécessaire », « agent sur mesure », « aucun agent ne convient », « when needed »… ; une consigne qui DÉCONSEILLE la création n'est jamais signalée) — AUCUNE phrase de la règle n'est écrite ailleurs : `super_agent.rs` embarque le fichier entier (`include_str!`) et en EXTRAIT la consigne entre deux délimiteurs contractuels (`extract_agent_lifespan_rule`, bloc poussé après « Outils d'agents »), `pilot-assistant-actions.ts` l'IMPORTE (descriptions et consignes de `create_agent` / `run_agents` / `run_assistant_agents`), et `AgentService::write_agent_lifespan_rule` l'écrit sur disque dans les DEUX chemins d'extensions (sinon l'import casse) — verrous : `la_regle_de_l_agent_jetable_est_injectee_dans_le_prompt` (super_agent.rs) + `write_agent_lifespan_rule_ecrit_la_source_unique` (agent_service.rs) + src/js/agents-jetables-par-defaut.test.js
│       ├── ephemeral-agents.js # Agent jetable (à la volée) : id réservé `eph-`, magasin mémoire, fusion dans le bus, purge en fin de tâche — aucune écriture en base
│       ├── agent-partial-text.js # SOURCE UNIQUE de la restitution du TEXTE DÉJÀ ÉCRIT d'un agent mort/planté (pures : `normalizePartialText` bornage + troncature dite, `extractDelegationResultText` lecture de `get_delegation_result` — aucun second mécanisme, `buildPartialTextDeathNotice`, `buildAgentDeathReport` : le texte produit ou la mention explicite « aucun texte recupere ») ; le texte rejoint le journal des arrêts EXISTANT (`text=` de `.pilot/agent-stops.log`), jamais un second journal — branché dans agents-bus.js (`finalizeDeadAgent`) et super-agent.js (`reportInvisibleAgentDeath`)
│       ├── orchestration-reviewer.js # Reviewer indépendant (H2 V1) : buildReviewPrompt, parseReviewResult, glob matching (pures)
│       ├── theme.js           # Gestion des thèmes dark/light
│       ├── sidebar.js         # Barre latérale, explorateur, filtre, menus
│       ├── tabs.js            # Système d'onglets (édition, prévisualisation)
│       ├── editor.js          # Éditeur CodeMirror 6
│       ├── preview.js         # Prévisualisation Markdown (markdown-it)
│       ├── pdf-preview.js     # Prévisualisation PDF (PDF.js)
│       ├── pdf-export.js     # Export Markdown → PDF SANS fenêtre d'impression : modale locale (#pdf-export-overlay, « Fermer » jamais désactivé, Échap) + DEUX points uniques — `runPdfExportRequest` (invoke `markdown_to_pdf`, ne lève jamais) et `runPdfSentinelRequest` (même appel pour les trois canaux agents) ; plus d'iframe, plus de `contentWindow.print()`
│       ├── pdf-gateway.js     # CŒUR PUR de l'export PDF partagé fenêtre ↔ extension agent ↔ Vitest : `normalizePdfRequest` (dédoublonnage, sources vides refusées), `formatPdfReport` (une ligne par fichier, succès/échec nommé), `PDF_SOURCE_EXTENSIONS`, messages ; aucun DOM, aucun import Tauri
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
│       ├── conversation-scroll.js # POSITION DE LA CONVERSATION AU RETOUR D'UN PLEIN ÉCRAN (§8ter de `spec_modes_ecran_vocal.md`) — décisions PURES, aucun DOM, aucun minuteur : `CONVERSATION_SCROLL_BOTTOM_THRESHOLD` (60, valeur UNIQUE), `conversationAtBottom`, `conversationScrollMax`, `conversationScrollSnapshot`, `conversationScrollTarget`, `conversationScrollReplayTarget` (la même décision rejouée UNE fois sur la géométrie réelle au premier signal de rendu : la mise en page de « Détaillé » est parfois TRANSITOIRE et la conversation était écrite tout en haut) et `conversationScrollReturnSnapshot` (quelle photographie rendre : celle de « Détaillé », prise en le QUITTANT, l'emporte sur le bas forcé par l'entrée en « Assistant seul » — issue #82 — sauf si l'utilisateur a remonté la conversation pendant le plein écran) ; écritures dans `super-agent.js` : `memoizeSuperScroll` (à la sortie, avant les déplacements de nœuds), `memoizeSuperDetailScroll` (depuis `enterImmersive`, avant le bas forcé), `restoreSuperScroll` (dernière instruction de `exitImmersive` ET de `exitVocal` : les TROIS voies de sortie — logo, Échap, fermeture de l'onglet — se comportent pareil) et `replaySuperScrollAfterLayout` — couverture : conversation-scroll.test.js + retour-mode-conversation-en-bas.test.js
│       ├── super-agent.js    # Onglet « 🧭 Assistant » : suivi multi-projets lecture seule (chat, config, init, relais des choix d'agent, tâche #22) + ÉCRAN DU MODE VOCAL (lot 2 : overlay `.pilot-vocal` — barre de 44 px qui ne porte RIEN (le logo, bouton des modes, se pose au-dessus d'elle, à sa place des trois modes), objet lumineux 168 px + trait 200×3 px, UNE ligne d'état, la barre de saisie DÉPLACÉE ; quatre états repos/écoute/réflexion/parole teintés par `--vocal-*`, trait de niveau piloté par `--vocal-level` (niveau réel fourni par `vocal-mic.js`) ; réduction de mouvement = `prefers-reduced-motion` + `window._pilotModalAnimations`, zéro nouveau réglage ; trois sorties — même bouton (le logo), Échap, fermeture de l'onglet — et jamais deux pleins écrans) ; fonctions pures `vocalScreenState` / `vocalStateClass` / `vocalStatusText` / `vocalReducedMotion` ; DÉTECTION DE L'ÉCOUTE (correctif « l'écran restait sur Je vous écoute… ») : pures `vocalCapte(niveau, etait)` et `vocalVoiceStep` à DEUX seuils (`VOCAL_VOICE_ON = 0,06` / `VOCAL_VOICE_OFF = 0,03`, hystérésis) + drapeau `vocalMicCapte` alimenté par le NIVEAU dans `vocalSetLevel` (qui réapplique l'état quand la décision change) et `listening: vocalMicListening && vocalMicCapte` dans `applyVocalState` — `vocal-mic.js` inchangé, lecture auto par le bouton `agent-read-btn` EXISTANT (`autoReadVocalReply`) ; LOT 4a : `vocalBargeIn` (voix par-dessus la lecture → `stopReading()`, SEULE voie existante, aucune reprise automatique, aucune API audio ici — la décision vient de `vocal-mic.js`) + `vocalSyncMicSpeaking` (l'état `READ_ALOUD_STATE_EVENT` est la seule source qui arme la garde du micro)
│       ├── assistant-genre.js # GENRE DE L'ASSISTANT (tâche 402) — décisions PURES de la FENÊTRE : clé unique `assistant_gender` (`ASSISTANT_GENDER_KEY`), trois valeurs seulement (`ASSISTANT_GENDER_NONE` = "" non précisé, `ASSISTANT_GENDER_FEMININE`, `ASSISTANT_GENDER_MASCULINE`), `normalizeAssistantGender` (casse/accents tolérés, valeur INCONNUE ⇒ « non précisé », jamais un genre imposé), `assistantGenderIsUnspecified`, `assistantGenderLabel`, `decideAssistantGenderValue` (aller-retour sans perte) + `ASSISTANT_GENDER_OPTIONS` (la liste affichée) ; AUCUNE phrase de genre n'est composée ici — elle vit dans `assistant_identity.rs` (seule source) ; branché aux Options (`settings.js` lit ET enregistre le champ, sinon il serait perdu à chaque enregistrement qui réécrit toute la configuration) — couverture : genre-et-modele-par-personnage.test.js
│       ├── assistant-persona.js # PERSONNAGE ACTIF déposé par le projet Présences (onglet 🧭 seulement) — SOURCE UNIQUE du nom et du portrait : lit `<dossier personnel>/.pilot/portrait/nom.txt` + `portrait.png` (emplacement que Présences dépose, sa décision D23 ; repli sur `<app_data_dir>/.pilot/portrait` et sur `PRESENCES_PILOT_DIR` — l'ordre est décidé par `persona_dir_candidates`, côté Rust) via la commande Rust `read_assistant_persona` ; fichier ABSENT = aucun personnage → nom réglé et icône 🧭 habituels, sans message ni exception ; pures `personaDirFor`, `normalizePersonaName`, `personaPortraitSrc` (uniquement `data:image/…;base64,` borné), `personaDisplayName` (SEULE règle de priorité : personnage → nom réglé → « Assistant »), `normalizePersona` ; état en MÉMOIRE seulement (aucune persistance, aucun réglage), `refreshAssistantPersona` **fail-open** ; Pilot ne fait que LIRE (jamais créer, écrire, nettoyer) — couverture : assistant-persona.test.js + tests Rust de persona.rs
│       ├── super-agent-context.js # 🧭 : contexte de suivi COURT joint automatiquement à la demande déléguée (pures : projet, tâches, décisions, mémoire)
│       ├── project-queue-view.js # SOURCE UNIQUE de la file visible d'un projet : composition ordonnée (« en cours » + rangs), texte de /file, vidage tracé /file vide, et RETRAIT CIBLÉ d'UNE mission (`removeProjectQueuedMission`, rang affiché → mission) — la traduction rang→mission n'existe qu'ici
│       ├── project-task-queue.js # File des commandes manuelles du projet (FIFO, sonde de rejeu, rangs affichés, abandon tracé) — module sans import Tauri
│       ├── taches-suivies-ecran.js # LE SUIVI DES TÂCHES (module INTACT, mais PLUS inséré dans le volet « Travaux » du panneau Travail — décision du propriétaire 2026-11-05 : ce volet ne montre QUE le travail des agents, le suivi garde son onglet Kanban) — `openTrackedTasks` (règle UNIQUE `isOpenTaskStatus` + dédoublonnage par identifiant), `renderTrackedTasksGroupHtml` (groupe « Suivi (n) — aucun agent ne travaille dessus », RIEN quand la liste est vide ; plus aucun appelant à l'écran, conservé tel quel), `loadTrackedTasks` (mémoire 5 s, une seule requête en vol, panne ⇒ dernière liste connue) et `notifyTrackedTasksChanged` / `onTrackedTasksChanged` (SEUL signal « le suivi a changé », posé par toute écriture du Kanban + fin de tour de l'Assistant, écouté par le Kanban ; `super-agent.js` n'en importe plus QUE `notifyTrackedTasksChanged`) — verrou `src/js/taches-suivies-affichees.test.js` (il ÉCHOUE si le groupe revient dans le volet), rapports `docs/rapports/RAPPORT-liste-travail-sans-suivi.md` (retrait) et `docs/rapports/RAPPORT-liste-taches-affichee.md` (historique)
│       ├── dashboard.js      # Onglet « 📊 Tableau de bord » (issue #51) : métriques projet (stockage, Git, langages, activité)
│       ├── vault.js          # Onglet « 🔐 Coffre » (issue #52) : coffre fort de mots de passe chiffré (AES-256-GCM)
│       ├── diff-view.js       # Diff Review (A4) : diff inline + porte pré-écriture (renderEditGateDialog)
│       ├── models-config.js  # Onglet « Fournisseurs » : édition UI models.json + model-switch.json (pi/plh)
│       ├── mcp-tool-names.js # SEULE source du NOM des outils MCP exposés à l'agent (`mcp_<id du serveur>_<nom de l'outil>`) — pure, bundlée dans l'extension MCP : `mcpServerId` (id ?? name ?? "mcp"), `registeredToolName`, `serverIdOwners`/`serverIdClashMessage` (deux serveurs ACTIVÉS de même identifiant = mêmes noms d'outils ⇒ chargement refusé, message nommant les deux), `duplicateToolNames`/`firstDeclarationOnly`/`duplicateToolNameMessage` (un outil déclaré deux fois n'en remplace pas un autre en silence) — couverture : mcp-tool-names.test.js
│       ├── mcp-servers-session.js # QUELLE LISTE DE SERVEURS MCP UNE SESSION CHARGE — décision PURE partagée par l'extension et les tests : `mcpEnabledServers` (`enabled !== false`, règle historique), `mcpAmbiguousServerIds` (deux entrées de même identifiant ⇒ refusées ENSEMBLE), `planMcpSessionServers` (cible `PILOT_MCP_SERVER` ⇒ UN serveur, comportement des agents inchangé ; cible vide ⇒ **TOUS les serveurs activés**, décision du 2026-11-02), `planMcpRefresh` (charge ce qui manque, retire ce qui n'est plus voulu, ne double jamais une connexion en cours), `mcpServerFingerprint` (une fiche inchangée n'est pas retentée à chaque tour), `mcpServerStillEnabled` (un serveur désactivé n'exécute plus rien) et les messages de panne/absence — ne nomme jamais une adresse, une commande ni une clé ; couverture : mcp-servers-session.test.js
│       ├── mcp-server-toggle.js # MCP piloté par l'Assistant : activer / désactiver UN serveur NOMMÉ depuis la conversation (`mcp_enable_server` / `mcp_disable_server`) — décision PURE (`planMcpServerToggle` : identifiant connu, activation NON EXCLUSIVE depuis la décision du 2026-11-02 — elle n'écrit QUE l'état du serveur nommé, ne coupe AUCUN autre et nomme les autres restés activés — désactivation qui n'active personne, serveur déjà dans l'état = aucune écriture) + `applyMcpServerToggle` (lit `mcp_get_state`, écrit `mcp_set_servers_enabled`, fail-safe sans exception) ; texte de réponse et ligne système dans le même module ; l'écriture Rust ne change QUE le champ `enabled` (aucun serveur créé/supprimé, aucun contenu ni secret touché) — couverture : mcp-server-toggle.test.js
│       ├── conversation-export.js # Export conversation agent (F2 Markdown / F3 Copy HTML)
│       ├── loop-detection.js # Détection de boucle dans la réflexion du modèle (issue #37) — pure, branchée chat + sous-agents + assistant (issue #55) ; empreinte de CONTENU des écritures (faux positif « même fichier modifié 3 fois ») + lignes du journal des arrêts automatiques + `isReadOnlyShellCommand` (une répétition de LECTURE/consultation `git status|diff|log`, `ls`, `rg`, `sed -n`… n'est JAMAIS un motif d'arrêt) ; **classifieur PARTAGÉ `isReadOnlyAgentToolCall`** (+ `AGENT_READ_ONLY_TOOLS`, `AGENT_SHELL_TOOLS`, `toolCallCommand`) utilisé par les TROIS chemins d'arrêt automatique (`agent-pi.js`, `agents-bus.js`, `super-agent.js`) — règle 2 : une consultation ne déclenche un arrêt sur AUCUN chemin
│       ├── agent-stop-trace.js # Journal disque du MOTIF des arrêts automatiques d'agents : <projet>/.pilot/agent-stops.log (append + rotation) avec REPLI GLOBAL <app_data_dir>/agent-stops.log et échec visible (rapporteur → notify) — règle 3, tous les chemins d'arrêt (motifs de file : queue-replay-no-owner, queue-abandoned)
│       ├── agent-stop-funnel.js # RÈGLE 3 — ENTONNOIR UNIQUE des arrêts AUTOMATIQUES du bus : `stopAgentWithTrace({reason, detected, agentId, projectPath, uid, stop})` écrit la trace (attendue) PUIS exécute l'arrêt (fail-open côté arrêt) + détecteur PUR `scanAutomaticStopSites`/`findUnfunneledAutomaticStops` (site couvert = même instruction + même fonction englobante ; seul l'arrêt manuel porte `R3-EXCEPTION-MANUEL`)
│       ├── mission-identity.js # RÈGLE 4 : identité d'une MISSION mise en file (numéro monotone + agents visés) — pure : nextMissionId, makeMissionIdentity, missionTag, annotateMissionReport, stampQueuedMission (refus du double empilement), missionQueueLabel (journal/UI)
│       ├── reservations.js # Orchestration multi-agents T6 : estimation préalable (plan-maker) + fichiers réservés .pilot/reservations.json (pures + I/O, fail-open)
│       ├── backend-info.js   # Sonde backend (pi vs plh) + libellé dynamique "Agent Pi"/"Agent PLh"
│       ├── desktop-notify.js  # Notifications desktop natives (D1) — agent terminé à distance
│       ├── vocal-chrome.js    # LA DECISION DU BAS QUI S'EFFACE AU REPOS (13/11, §4bis de `spec_modes_ecran_vocal.md`) — PURE (aucun DOM, aucune minuterie) : `VOCAL_CHROME_IDLE_MS` (10 000 ms, valeur de `98bc079` ; elle valait 2 500 ms avant), `VOCAL_CHROME_MOVE_PX` (4 px), `VOCAL_CHROME_HIDDEN_CLASS`, `vocalChromeVisible` (les quatre regles qui INTERDISENT le masquage, DANS L'ORDRE : micro ferme, champ occupe, etat ecoute/parole, pointeur sur le bas — et le repos avec la dictee armee mais silencieuse MASQUE, cas voulu), `vocalChromeClass`, `vocalChromeWakeKey` (Echap excepte : il sort du mode), `vocalChromeMoved` ; seul point d'ecriture `vocalSyncChrome(state)` en derniere ligne de `applyVocalState` (super-agent.js) — couverture : vocal-chrome-masque.test.js
│       ├── vocal-mic.js       # LOT 3 + LOT 4a — SEUL endroit où le micro du mode Vocal est ouvert (aucune API micro dans super-agent.js, verrouillé par test) : `createVocalMic` (demander / fermer / **setKeepOpen** / estActif / setSpeaking / bargeInReport) — **LA CAPTURE SE ROUVRE SEULE** (correctif 2026-11-15, `docs/rapports/RAPPORT-micro-arret-mode-vocal.md`) : une perte PASSAGÈRE (piste `ended` : casque débranché, micro changé, autre application) est réessayée tant que l'ÉCRAN tient le micro (`setKeepOpen(true)` à l'entrée, `false` à la sortie) — pures `micFailureIsRecoverable` (une cause DÉFINITIVE, refus/absence, n'est JAMAIS redemandée), `micReopenDelay` (400 ms → plafond 5 s), `shouldReopenVocalMic` ; point unique `panneCapture`, une seule capture à la fois (`demandeEnCours`), `fermer()` annule toute reprise — verrou `src/js/micro-reste-ouvert-mode-vocal.test.js` ; permission demandée au PREMIER GESTE seulement, arrêt RÉEL à la sortie (pistes `stop()` + `context.close()` + `cancelAnimationFrame`, prouvé en banc WebView2), pannes (refus, absence, occupation, périf. retiré) → message clair + mode utilisable ; pures : `smoothLevel` (montée 0.5 / descente 0.12), `levelToWidth` (échelle √, 8 → 100 %), `planLevel` (aucune valeur posée en mouvement réduit), `shouldAskVocalMic`, `rmsOf`, `micFailureMessage`. **LOT 4a — garde anti-auto-coupure** (le micro entend la voix de Pilot sortant des haut-parleurs) : `MIC_CONSTRAINTS` demande `echoCancellation`/`noiseSuppression`/`autoGainControl`, `echoCancellationOf` RELIT ce que la piste dit avoir appliqué (true/false/null = inconnu, jamais vrai par défaut), `stepSpeechGate` mesure le RÉSIDU d'écho pendant `BARGE_IN_CALIBRATION_MS` puis exige `max(0,05 ; résidu × 1,8)` pendant `BARGE_IN_MIN_MS` de voix continue, une seule fois par lecture ; `bargeInArmed` DÉSARME la détection si l'écho n'est pas maîtrisé (résidu > 0,03 averé / 0,01 quand le navigateur ne prouve rien) ⇒ aucune coupure, la lecture va au bout ; le module ne tient AUCUN lecteur : il signale `onSpeechStart`, l'arrêt reste à l'appelant — couverture : ecran-vocal-lot3.test.js + ecran-vocal-lot4a.test.js
│       ├── demande-pendant-le-tour.js # UNE DEMANDE ARRIVÉE PENDANT UN TRAVAIL N'EST JAMAIS PERDUE (correctif « le mode vocal ne répond plus quand l'assistante travaille », RAPPORT-MODE-VOCAL.md) — SOURCE UNIQUE des décisions, PURES : `decideDemandePendantLeTour` (texte vide ⇒ refusée ; moteur libre ⇒ envoyée par le chemin existant ; moteur occupé ⇒ ENFILÉE avec accusé immédiat ; file pleine ⇒ refusée avec message, texte conservé), `prendreDemandeEnAttente` (seul endroit qui décide de l'ORDRE de sortie : premier arrivé, premier servi ; ne rend rien tant que le moteur travaille), `DEMANDES_EN_ATTENTE_MAX` (5) + les trois phrases (accusé conversation, accusé ligne d'état du mode Vocal, file pleine) — vidée sur la FIN DE TOUR réelle (`agent_end`) et, pour un `agent_end` manqué, sur le REPOS OBSERVÉ dans le magasin partagé du travail (`assistantWorkState` de `agent-activity.js`, seule vérité — `super-agent.js` ne tient plus aucune boucle de `get_agent_supervision`, garde `assistant-une-seule-verite-du-travail.test.js`), jamais par un délai ; le texte repart par la SEULE voie d'envoi (`send`) — couverture : demande-pendant-le-tour.test.js
│       ├── vocal-conversation.js # Écran Vocal, CONVERSATION PARLÉE (parler déclenche une demande, sans bouton) — SOURCE UNIQUE des DÉCISIONS, pures : `decideVocalDictation` (armer au repos / désarmer pendant la parole de Pilot, pendant son travail, hors du mode, sur projet sensible, après un arrêt manuel, pour une erreur en cours, sans transcription / ne rien faire si déjà ouverte — l'ordre des règles EST la spec), `planVocalConversation` (effets : fermer, annuler l'armement programmé, programmer ; jamais deux minuteries), `vocalDictationMessage` (UNE phrase par panne, `aborted`/`no-speech` = aucun message) + `VOCAL_ARM_DELAY_MS` 350 / `VOCAL_ARM_AFTER_READ_MS` 600, et **reprise bornée** d'un armement refusé pour une raison PASSAGÈRE (`vocalResumeRetry` : `VOCAL_RESUME_RETRY_MS` 400 × `VOCAL_RESUME_MAX_RETRIES` 8 au plus, `VOCAL_RESUME_TRANSIENT_REASONS` = pilot-parle / tour-en-cours / mesure-fermee / sensibilite-inconnue ; un refus DÉFINITIF n'est jamais repris) — l'écoute repart donc seule après chaque réponse, le rond « Réveiller » n'est qu'un secours ; appliqué à UN SEUL endroit (`applyVocalState` via `vocalSyncConversation`), démarrage par UNE SEULE voie (`startVoiceInput`, extraite de `toggleVoiceInput`), envoi par le chemin EXISTANT (`applyVoiceEnd` → `send`), aucune API micro ici — couverture : vocal-parler-declenche-une-demande.test.js + vocal-reprise-ecoute-auto.test.js
│       ├── vocal-question-utilisable.js # LA QUESTION AFFICHÉE REND LA SAISIE ET LES BOUTONS PLEINEMENT ACTIFS (§4bis de `spec_modes_ecran_vocal.md`) — PURE (aucun DOM, aucun minuteur) : `decideVocalQuestionFocus` (cinq règles DANS L'ORDRE : hors du mode Vocal ⇒ jamais ; aucune question en tête ⇒ non ; une modale ouverte ⇒ non ; le curseur est DÉJÀ sur cette question ⇒ non (le re-rendu d'un choix multiple ne le retire pas au champ) ; sinon ⇒ oui) et `planVocalQuestionFocus` → `{focus, memoire}` (décision + mémoire du curseur, pour UN SEUL appelant : `pendingQuestionChromeSync`, le rappel déjà appelé à chaque changement de la file — ni `enterVocal` ni `applyVocalState` ne tournent à l'arrivée d'une question) ; l'ORDRE DE PEINTURE est réglé par `.vocal-input` (`position: relative; z-index: 1`, sous le logo 2 et « Travail » 3, sans nouveau hôte cliquable) ; la dictée ouverte par le GESTE 🎙️ n'est pas refermée par une question (`ouvertureParGeste` + règle 4b de vocal-conversation.js) — couverture : ecran-vocal-question-utilisable.test.js
│       ├── vocal-nom-garde.js # L'ÉCRAN VOCAL N'OBÉIT QU'À SON NOM (§6quater de `spec_modes_ecran_vocal.md`, décision du propriétaire) — PURE, sans import : le micro reste ouvert, l'écoute continue, mais une phrase qui ne contient PAS le nom de l'assistante n'est NI envoyée, NI conservée, NI affichée, sans aucun message répété ; `foldSpoken` (casse, accents, ponctuation, espaces ignorés), `phoneticKey` (TRÈS peu de variantes : ph→f, qu→k, y→i, consonne finale muette — AUCUNE distance d'édition, AUCUN dictionnaire, AUCUNE réduction des lettres doublées qui faisait déclencher « bonne année » sur « Anne »), `mentionsAssistantName` (nom accepté n'importe où, y compris coupé en deux par la reconnaissance), `decideVocalNameGate` (six règles DANS L'ORDRE : hors mode, texte vide, reprise en main, réveil, **nom puis mot de réveil** — `nom-inutilisable` = fail-open, qui ne joue plus que si AUCUN mot de réveil utilisable n'est réglé), **MOTS DE RÉVEIL § 6quater.1** : `VOCAL_WAKE_WORDS_KEY` (`vocal_wake_words`), `wakeWordsFrom` (virgule/point-virgule/retour à la ligne, doublons et vides ignorés, un mot peut contenir des espaces), `wakeWordsText` (SEULE forme mémorisée), `mentionsWakeWord` (même comparaison que le nom ; champ vide = rien ne change), `vocalNameSentence` (« Dites « X » pour me parler. »), `vocalNameGateArmed` (armée aussi par un mot de réveil utilisable) ; le NOM est REÇU (`superAgentDisplayLabel()`, source unique existante : personnage → nom réglé → défaut), jamais recalculé ici ; appliqué à UN SEUL endroit (`super-agent.js` : rien ne s'écrit dans les résultats du moteur, la phrase est jetée AVANT le chemin d'envoi unique `applyVoiceEnd` — jamais dupliqué —, et la ligne d'état EXISTANTE dit lequel des deux états est actif) ; le bouton de secours « Réveiller <Nom> » lève la garde pour UNE phrase (`vocalReveilUnePhrase`) ; la saisie CLAVIER n'est jamais filtrée ; HORS de l'écran Vocal, RIEN ne change (agent-pi.js et web distant n'importent pas ce module) — couverture : vocal-nom-garde.test.js + mots-de-reveil.test.js
│       ├── oreille-locale.js # OREILLE LOCALE (DÉCISIONS, pures) : la case unique `local_dictation` (`localDictationRequested`), le plan d'exécution lu dans la réponse du pont (`planLocalEar` → use/reason/modelId/modelLabel/sentence/fallback), les phrases du repli (`localEarFallbackSentence` : chacune dit qu'on repart vers un SERVICE EN LIGNE, sinon muette = interdit), la phrase de la ligne d'état (`localEarStatusLine`, qui importe `vocalNameSentence` de vocal-nom-garde.js pour rester la SEULE composition du nom), la phrase de panne en cours d'écoute (`localEarFailureMessage`, seulement si `ev.local === true`) et le format du son (`downsamplePcm` 16 kHz, `pcm16Bytes` PCM 16 bits petit-boutiste écartelé, `splitPcmChunks` 3 200 octets = 100 ms) — aucune adresse, aucun appel Tauri ici
│       ├── oreille-locale-moteur.js # OREILLE LOCALE (le MOTEUR) : `createLocalEar({invoke, listen, mic, onModel})` rend un objet de la MÊME FORME qu'une session `SpeechRecognition` (`lang`, `interimResults`, `continuous`, `localEar: true`, `start/stop/onresult/onerror/onend`) — c'est ce qui garde la garde du nom, l'envoi sur silence, la reprise en main et l'envoi automatique ÉCRITS UNE FOIS dans super-agent.js ; il n'ouvre AUCUNE capture (il consomme le robinet `setAudioTap` de vocal-mic.js), joint le service UNIQUEMENT par les commandes de l'étape 1 et l'évènement `asr-voicestudio-transcript`, impose le dernier morceau AVANT `_stop` (aucun mot perdu), et toute panne remonte par `onerror({error:"local-ear", local:true, message})` — verrou oreille-locale-etape2.test.js
│       ├── vocal-discussion-turns.js # LA COLONNE DE GAUCHE NE MONTRE QUE CE QUI A ÉTÉ DIT (correctif « la discussion est vide et ne s'actualise pas », `RAPPORT-vocal-discussion-gauche.md`) — SOURCE UNIQUE du filtre, PURE (aucun DOM) : `normalizeVocalTurnRole` (rôle → `user` / `assistant`, alias tolérés), `isVocalSpeechTurn` (trois conditions DANS L'ORDRE : rôle de parole, famille de parole si un `kind` est déclaré, texte non vide), `vocalSpeechTurns`, et les deux listes qui rendent la règle testable : `VOCAL_SPEECH_ROLES` + `VOCAL_SILENT_KINDS` (réflexion, appel/resultat d'outil, système, trace, diff, journal) / `VOCAL_SPEECH_KINDS` ; la lecture du chat et la peinture restent dans `super-agent.js` (`collectVocalDiscussion` / `vocalRenderDiscussion`) — couverture : vocal-discussion-turns.test.js + vocal-colonne-discussion-alimentee.test.js
│       ├── vocal-enveloppe-aigu.js # L'ENVELOPPE DE PAROLE SUIT LA VOIX de Pilot, l'aigu en tête (12/11) — UN SEUL afficheur, DEUX sources qui se remplacent JAMAIS ensemble (`planSpeechEnvelopeSource` tranche : mouvement réduit et contour spectral peint ⇒ personne n'écrit ; la mesure réelle l'emporte ; sinon le rythme du texte lu) : (1) voix locale (Piper) = un SEUL analyseur monté sur le SEUL son que Pilot joue lui-même (via `setLocalVoiceAudioTap` de local-voice.js), analyse de la BANDE HAUTE (>= 4 kHz, plafond d'analyse du projet) → énergie 0..1 (`highBandBins` / `highBandEnergy` : silence → 0, aigu riche → ~1, son grave → 0) ; (2) voix du SYSTÈME = AUCUN flux audio accessible (interdit de faire semblant) → le RYTHME RÉEL de la phrase lue : `speechRhythmUnits` (mots → syllabes, dernière accentuée ; ponctuation → pauses 220 / 420 / 560 ms, contiguës, aucune unité pour un texte vide) + `rhythmIntensity` (position de lecture → 0..1 : pause 0, syllabe accentuée 1, ordinaire 0,55, plancher 0,2, JAMAIS d'aléatoire) ; puis le MÊME lissage `smoothEnvelopeEnergy` (montée 0,5 / retombée 0,12), `envelopeFromEnergy` (18 px → 32 px, alpha 0,80 → 1, extension = 32 × scale donc jamais au-delà), `planSpeechEnvelope` ; mètres `createSpeechEnvelopeMeter` (son) et `createSpeechRhythmMeter` (rythme, horloge seule : aucune API audio, aucun DOM) — **LE PLAN DE RYTHME NE S'ÉPUISE JAMAIS** (défaut corrigé « le halo se fige sur une parole longue », `docs/rapports/RAPPORT-halo-parole-longue.md`) : le débit est une hypothèse (190 ms/syllabe) que la lecture réelle dépasse de 35 à 63 % sur du texte technique épelé (mesuré sur la voix fr-FR du système), et `rhythmIntensity` vaut 0 au-delà de la dernière unité ⇒ l'enveloppe se posait au repos alors que la voix continuait ; la POSITION est donc ramenée dans le texte (`ecoule % total`, le motif continue de respirer) et l'HORLOGE repart du PREMIER SON via `reancrer()` sur `READ_ALOUD_SOUND_EVENT` (pas de l'annonce qui précède `ensureVoices` et le démarrage du moteur) ; `vocal-speak-glow` n'est plus que le repli quand AUCUNE source n'est disponible — couverture : vocal-enveloppe-aigu.test.js + vocal-enveloppe-rythme.test.js (le § 6 échoue sur le code d'avant)
│       ├── voice-auto-send.js # Envoi AUTOMATIQUE à la fin d'une dictée vocale (décision du propriétaire 2026-10-26, onglet agent π, Assistant 🧭 ET web distant) — SOURCE UNIQUE de la décision et de l'ORDRE : `decideVoiceAutoSend` (jamais de texte vide, jamais sur erreur/permission/panne/arrêt manuel, jamais quand l'utilisateur a repris la main, un seul envoi par dictée), `applyVoiceEnd` (refermer la session → écrire la zone → envoyer ; rien n'est écrit ni envoyé si l'utilisateur a tapé dans la zone pendant la dictée), `composeVoiceInputValue` (composition historique inchangée) ; l'envoi reste le chemin existant de chaque barre (`sendPrompt` dans agent-pi.js, `send()` dans super-agent.js, `submitPrompt()` dans web/js/app.js — aucun second mécanisme) ; le web distant (sans bundler) l'importe depuis `/js/voice-auto-send.js`, **servi par axum depuis ce même fichier** via `include_str!` (aucune copie dans `web/`) — couverture : envoi-auto-fin-dictee.test.js + envoi-auto-dictee-web-distant.test.js + `web_server::shared_voice_module_tests`
│       ├── read-aloud.js      # Lecture à voix haute d'une réponse assistant (bouton « Écouter / Arrêter » sous la bulle) : découpage par phrases, une seule lecture à la fois, voix de la langue de l'interface par défaut (speechSynthesis natif, aucune dépendance) + CHOIX de la voix réglé à UN SEUL endroit (Paramètres → onglet Assistant → section « Lecture des réponses »), mémorisé en config `read_aloud_voice`, repli propre si la voix a disparu, état publié par évènement `pilot-read-aloud-state` ; gère AUSSI la valeur réservée `local:piper` (voix française locale) avec repli OBLIGATOIRE et visible sur la voix du système, ET `local:voicestudio:<profil>` (voix IMITÉE de l'utilisateur, service local VoiceStudio : branche dédiée dans `speak`, réutilise `playLocalChunks`, repli `voicestudio-fallback` → Piper → système, phrase `readAloudVoiceStudioFallbackNotice`). Le nettoyage du texte dit vit dans `speech-text.js`. Couverture : read-aloud.test.js + reglage-voix-onglet-assistant.test.js + voix-locale.test.js + voix-locale-choix.test.js + voix-imitee-voicestudio.test.js (voir spec_read_aloud.md)
│       ├── character-voices.js # VOIX PROPRE AU PERSONNAGE ACTIF (Présences) — SOURCE UNIQUE des DEUX règles, PURES : `voiceForCharacter` (ordre : aucun personnage ⇒ voix générale ; pas de voix attribuée ou valeur inutilisable ⇒ voix générale ; voix devenue indisponible sur cette machine ⇒ voix générale ; sinon la voix du personnage ; un état INCONNU ne condamne jamais une voix) et `characterVoiceRow` (`visible: false` sans personnage actif ⇒ aucune ligne à l'écran, aucun message) + `withCharacterVoice` (retrait = entrée supprimée, une seule entrée par nom) ; champ de configuration ADDITIF `character_voices` (`AppConfig`, `serde(default)`, objet nom → voix) à côté du champ général `read_aloud_voice`, JAMAIS à sa place ; grammaire des valeurs NON recopiée (`isLocalVoiceChoice` / `isVoiceStudioChoice`) ; branché à UN SEUL endroit : `resolveReadingVoice` dans read-aloud.js ; couverture : voix-par-personnage.test.js, rapport docs/rapports/RAPPORT-voix-par-personnage.md
│       ├── voicestudio-explication.js # CE QUE L'UTILISATEUR DOIT COMPRENDRE DE LA VOIX IMITÉE, écrit à UN SEUL endroit : `VOICESTUDIO_EXPLAIN_TEXT` (VoiceStudio est un **logiciel séparé**, à installer **soi-même** sur cet ordinateur, à **lancer** et à laisser ouvert, que Pilot n'installe pas / ne lance pas / ne télécharge pas ; service absent ⇒ la lecture ne s'arrête pas — voix française locale puis voix du système — et l'annonce est faite à côté du bouton « Écouter » ; « où le récupérer » **sans aucune adresse inventée** : le dépôt n'en contient aucune, la phrase le dit et nomme le geste existant « Vérifier à nouveau ») + `fillVoiceStudioExplanation(nœud)` (n'écrit que dans le nœud qu'on lui passe, `textContent` seulement, aucun DOM global) ; affiché **toujours** dans la section « Lecture des réponses » des Paramètres, écrit au rendu par `settings.js` (`renderReadAloudVoice`), copie de repli lisible dans `index.html` **comparée au caractère près** ; aucun réglage nouveau (`read_aloud_voice` reste le seul champ) — couverture : voicestudio-explique-dans-les-reglages.test.js, rapport docs/rapports/RAPPORT-voicestudio-explique-a-l-utilisateur.md
│       ├── voicestudio-voice.js # VOIX IMITÉE de l'utilisateur (service local VoiceStudio, 127.0.0.1:3900) : SOURCE UNIQUE de la valeur `local:voicestudio:<id de profil>` (`voiceStudioChoiceValue`/`voiceStudioProfileIdFor`/`isVoiceStudioChoice`), des libellés (`voiceStudioProfileLabel`, `voiceStudioUnavailableLabel` quand le service ne peut pas annoncer le choix mémorisé), du DÉCOUPAGE en groupes de phrases (`groupSentencesForVoiceStudio` : premier morceau = 1 phrase pour un son rapide, puis 4 phrases / 700 caractères au plus, jamais une phrase coupée), du dialogue avec la MACHINE (`tts_voicestudio_status` / `_synthesize` / `_warmup` / `_log` — la fenêtre ne joint JAMAIS le service elle-même), de l'état du service (`refreshVoiceStudioStatus`, `keepKnownProfiles` qui garde la dernière liste connue quand le service ne répond plus) et de la synthèse d'un morceau en WAV base64 en mémoire (aucun fichier audio, aucun flux) ; `voiceStudioKnowsProfile` détecte une voix retirée du service (qui répondrait 200 avec sa voix par défaut) ; PRÉCHAUFFAGE AU DÉMARRAGE (deuxième déclencheur, avec le geste des Paramètres) : décision PURE `shouldPrewarmVoiceStudio` (oui SEULEMENT pour `local:voicestudio:<profil>` — système, Piper, vide, inconnu ⇒ non, grammaire non recopiée) + `prewarmVoiceStudioAtStartup` (appelée `void` APRÈS le masquage de l'écran de chargement dans main.js, jamais attendue ; garde mémoire `prewarmStartupStarted`/`resetPrewarmStartupGuard`, UNE tentative + au plus UNE seconde tentative à `VOICESTUDIO_PREWARM_RETRY_MS` = 5 s si `isTransientWarmupFailure`, silence total en échec, aucun son) — couverture : voix-imitee-voicestudio.test.js + prechauffage-voix-imitee-demarrage.test.js, rapport docs/rapports/RAPPORT-predemarrage-voix-voicestudio.md
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
    │   ├── pilot-pdf.ts       # Outil `export_markdown_pdf` (sources .md → PDF sur disque, sans impression, `executionMode: "sequential"`) ; délai d'attente LITTÉRAL (`PILOT_UI_OPTS = { timeout: 180_000 }`, garde-fou statique) ; importe le cœur `./pdf-gateway.js`
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
        ├── pdf.rs            # Export Markdown → HTML (impression PDF) — chemin HTML, distinct de l'export PDF direct
        ├── pdf_export.rs     # ÉCRIVAIN PDF EN RUST PUR (sans fenêtre d'impression, sans dépendance nouvelle) : Markdown → PDF A4 par `pulldown-cmark`, polices base 14 + WinAnsi (largeurs AFM réelles pour ASCII et latin-1), listes en pile d'index de blocs, tableaux alignés par rangée, images JPEG/PNG 8 bits (flate2) sinon ligne visible « image non incorporée » ; commande `markdown_to_pdf(sources, out_dir)` en `spawn_blocking` (aucun gel de l'interface), lot fichier par fichier, PDF RELU après écriture (`%PDF` + taille réelle) ; une ligne = UN SEUL objet texte (le moteur PDF avance entre les morceaux : aucun décalage cumulé) ; verrous `src/js/pdf-gateway.test.js` + tests du module (23)
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
        ├── tts_voicestudio.rs # VOIX IMITÉE de l'utilisateur (service local VoiceStudio 0.5.7, http://127.0.0.1:3900 UNIQUEMENT) : module FRÈRE de `tts_local` (Piper, intact) — liveness `/health`, liste des voix `/profiles`, synthèse `POST /v1/audio/speech` en JSON **UTF-8** (serde_json) demandant un WAV vérifié (RIFF/WAVE) rendu en base64 en mémoire (AUCUN fichier audio, AUCUN flux) ; une voix inconnue est refusée **AVANT** l'appel (`voice_error`) parce que le service répondrait 200 en jouant sa voix par défaut ; `VoiceStudioStatus` (reachable, version, device, profils, hint qui nomme TOUJOURS le repli Piper) ; commandes `tts_voicestudio_status` / `_synthesize` / `_warmup` / `_log` TOUTES `pub async fn` + `spawn_blocking` (jamais le thread principal), journal `[voix imitée]` dans voix-locale.log — couverture : ses tests unitaires + src/js/voix-imitee-voicestudio.test.js
        ├── asr_voicestudio.rs # OREILLE LOCALE de la dictée (service local VoiceStudio, même BASE_URL que le frère) : module FRÈRE de `tts_voicestudio` — **pont machine (2026-11-04) + écran BRANCHÉ (2026-11-15** : case « Transcrire avec le service de voix local » → `src/js/oreille-locale-moteur.js`, repli vers le navigateur TOUJOURS annoncé, verrou `oreille-locale-etape2.test.js`) ; `asr_voicestudio_status` (possible ? sinon POURQUOI : `disponible` / `service-absent` / `service-muet` / `aucun-modele-francais` / `modele-non-accepte` / `dictee-non-prete` + une phrase française, 5 s de délai), `_start(model?)` (session de flux `?pcm=1&sr=16000&model=<id>`, modèle IMPOSÉ jamais celui du service), `_send` (PCM 16 kHz mono 16 bits ≤ MAX_CHUNK_BYTES, jamais bloquant), `_stop` (le service rend son texte final), `_cancel` (en pleine dictée, rien n'est gardé) — TOUTES `pub async fn` + `spawn_blocking` ; un seul évènement `asr-voicestudio-transcript` (`started` moteur RÉEL / `partial` / `final` + `final_kind` / `error` en français / `ended`) ; le modèle préféré `sherpa-parakeet-tdt-v3` est essayé d'abord, puis tout modèle INSTALLÉ capable de français — un modèle absent est une erreur dite, JAMAIS un téléchargement ; la licence d'un modèle est LUE (`GET /models/licenses/acceptance/<repo>`, jamais acceptée : c'est un acte de l'utilisateur) et un refus nomme la serrure ; aucun fichier audio sur le disque, aucun autre appel réseau, la fenêtre ne joint jamais le service — couverture : ses tests unitaires (21) + preuves réelles `#[ignore]` (transcription française mesurée, port fermé) + src/js/oreille-locale-etape1.test.js
        ├── assistant_identity.rs # SOURCE UNIQUE des DEUX réglages de l'assistant (modules PURS, aucun disque, aucun état) : GENRE (tâche 402) — `parse_assistant_gender` tolérant, `canonical_assistant_gender`, `effective_assistant_gender` (fiche du personnage > réglage de Pilot > rien), `assistant_gender_instruction` (UNE phrase, VIDE par défaut) et `assistant_identity_block` (bloc du prompt) ; MODÈLE PAR PERSONNAGE (tâche 403) — `decide_assistant_model(persona, choisi, dédié, global, registre)` → `AssistantModelDecision { model, source, trace }`, fiche acceptée SEULEMENT si bien formée ET présente dans le registre, sinon repli sur la chaîne de Pilot AVEC une trace lisible (`pilot-assistant-model-trace`, affichée dans le volet « Événements » par `initAssistantModelTraceWatch`, une écoute unique posée au démarrage), jamais un échec ; branché à UN SEUL endroit (`SuperAgentPromptBlocks.identity` + `super_agent::assistant_session_model`) — couverture : ses tests unitaires + verrous de super_agent.rs + src/js/genre-et-modele-par-personnage.test.js
        ├── persona.rs        # PERSONNAGE ACTIF de l'Assistant (Présences) : commande `read_assistant_persona` → { name, portrait, gender, model } lus dans `<dossier personnel>/.pilot/portrait/` (nom.txt, portrait.png + genre.txt et modele.txt, OPTIONNELS et ADDITIFS : absents ⇒ `null` ⇒ réglages de Pilot, aucune erreur ; `read_persona_identity` lit SANS le portrait) — l'emplacement que Présences DÉPOSE (sa décision D23), avec repli sur `<app_data_dir>/.pilot/portrait/` (ancien emplacement) et sur `PRESENCES_PILOT_DIR` ; ordre et choix du dossier fixés par la fonction PURE `persona_dir_candidates` (premier dossier contenant un des deux fichiers, aucune fusion entre deux dépôts) — chemins résolus par Tauri (`home_dir`, `app_data_dir`), PathBuf::join (Windows/macOS/Linux), aucun chemin en dur ; portrait rendu en `data:image/png;base64,…` ; nom = première ligne utile, contrôles retirés, 60 caractères maxi ; PNG obligatoire, 8 Mio maxi ; LECTURE SEULE (le dossier absent n'est jamais créé), toute panne → Persona::default() (nom et icône habituels)
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
   utilisateur : option A). **Il est OBLIGATOIRE** : la publication est refusée
   (code 2, annotation d'erreur) si le fichier manque ou ne contient qu'un titre
   — décision pure dans `scripts/release-gates.js`. Sortie de secours explicite :
   `ALLOW_MISSING_RELEASE_NOTES=1`. Trié par catégorie, langage clair pour un utilisateur
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

- Job `test` (Ubuntu + Windows) = **chemin critique** : c'est lui que
  `create-release` attend. Il ne contient **aucune machine Apple**.
- Job `test-macos` = les **mêmes tests** sur `macos-latest`, hors chaîne
  critique : `continue-on-error: true` et **aucun job ne le déclare dans ses
  `needs`**. Une machine Apple jamais attribuée (job annulé par GitHub après
  ~15 min) ne fait donc sauter ni la Release, ni la fabrication, ni
  `latest.json` — c'était la panne des 0.6.16 / 0.6.17 / 0.6.18.
- Job `build` (Windows + macOS) = **chemin critique** de `latest-json`, donc de la
  mise à jour automatique. `latest-json` ne dépend **que** de lui. Les deux
  cibles macOS y sont tolérées (`continue-on-error` par plateforme) : un échec
  **ou une annulation** macOS ne met plus le job en `cancelled`.
- Job `build-linux` = séparé : plafond **90 min**, `continue-on-error`, aucun job
  ne dépend de lui. Il ne retarde et ne bloque jamais une publication.
- Job `latest-json-linux` = seconde passe optionnelle : si (et seulement si) Linux
  a déposé ses artefacts, elle les ajoute à `latest.json`. Sinon elle ne fait rien.
- Le front est construit **une seule fois** (`beforeBuildCommand`, qui lance aussi
  `prepare:laya`) et les paquets npm sont mis en cache par système (`~/.npm`).
  Ne pas réintroduire de `cargo build` manuel ni d'étape `prepare:laya` explicite.
- Ces règles sont sous clé : `scripts/release-workflow.test.js` (`npx vitest run`).

### Publier quand macOS n'est pas disponible (décision du 2026-11-15)

Le dépôt est **public** : le manque de machines Apple n'est pas une affaire de
minutes, c'est GitHub qui n'en attribue pas. Décision appliquée :
**« Contourne sans macOS »** — une version peut sortir sans installateurs macOS,
**mais jamais en silence**.

- L'autorisation de livraison incomplète n'est **jamais** posée à la main dans le
  workflow : l'étape `scripts/detect-macos-gap.js` constate l'absence sur les
  fichiers réellement déposés et n'écrit `ALLOW_INCOMPLETE_RELEASE=1` que si
  **seul macOS manque** (une annotation `::warning::` le dit dans le journal).
  Windows manquant = échec, même drapeau posé (`allowIncompleteScope`).
- L'absence est **annoncée** : phrase en français dans le corps de la Release et
  dans les notes de `latest.json` (donc dans la modale de mise à jour), source
  unique `macosMissingNotice()` dans `scripts/release-gates.js`.
- `latest.json` ne liste que les plateformes dont l'artefact signé existe :
  aucune cible macOS n'y est jamais inventée, Windows reste servi.
- Le refus par défaut reste : sans autorisation, une livraison incomplète
  échoue (code 2). Sortie de secours manuelle : `ALLOW_INCOMPLETE_RELEASE=1`.
- Ne JAMAIS remettre `macos-latest` dans la matrice du job `test` : le verrou
  `scripts/publication-sans-macos.test.js` échoue alors (c'est voulu).
- Détail, mesures et preuves par mutation :
  `docs/rapports/RAPPORT-publication-sans-macos.md`.

Ne jamais republier un tag déjà existant (créer un nouveau numéro de version à la place).
C'est désormais **refusé net** par `scripts/create-release.js` (code de sortie 2) ;
un re-run volontaire passe par `ALLOW_EXISTING_RELEASE=1`.
Vérifier que le secret GitHub `TAURI_SIGNING_PRIVATE_KEY` est bien en place (sinon le
build échoue à la signature).

**Verrous de la chaîne de publication** (source unique : `scripts/release-gates.js`) :
la Release n'est créée qu'après un verdict de tests favorable (`create-release`
`needs: [test]`), un changelog lisible est obligatoire, une livraison incomplète sur
le chemin critique (Windows + les deux macOS) est un ÉCHEC et non un avertissement
(`ALLOW_INCOMPLETE_RELEASE=1` pour forcer, portée limitée à macOS par
`allowIncompleteScope`), et `.github/workflows/quality-gate.yml`
fait échouer toute proposition de modification ou poussée sur `main` dont les tests
front ou Rust échouent. Détail et preuves : `docs/rapports/RAPPORT-verrous-livraison-lot-b.md`
+ `docs/rapports/RAPPORT-publication-sans-macos.md` (verrou
`scripts/publication-sans-macos.test.js`).

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
