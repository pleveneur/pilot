# Pilot_Modif

> Fichier de suivi des évolutions et bugs à traiter.
>
> **Convention de statut** : `[x]` = implémentation terminée par l'assistant.
> Les tests de validation sont listés dans la section **« Tests à faire par moi »**
> à la fin du fichier.

---

## 📦 Évolutions (Améliorations)

### 1. Brouillons par projet
- [x] **1 brouillon par projet**
  - Permettre de créer et gérer un brouillon unique associé à chaque projet.
  - Le brouillon doit être automatiquement sauvegardé et rattaché au projet courant.
  - **Fait :** le brouillon (scratchpad) est désormais stocké par projet dans localStorage via une clé distincte `pilot-scratchpad::<projectPath>` (méthode `_scratchpadKey()` dans `tabs.js`). `_openScratchpad` charge la clé du projet courant et migre une fois l'ancien brouillon global (`pilot-scratchpad`) vers le premier projet ouvert. `_saveScratchpad` sauvegarde dans la clé du projet courant. L'auto-save existant (`_doAutoSave`) et la sauvegarde à la fermeture (`closeTab`) utilisent désormais la clé par projet via `_saveScratchpad`. Label de la barre d'outils mis à jour. Fallback sur la clé globale si aucun projet n'est ouvert.

### 2. Déplacement des onglets
- [x] **Pouvoir déplacer les onglets**
  - Ajouter la possibilité de réorganiser les onglets par glisser-déposer.
  - L'ordre des onglets doit être persistant entre les sessions.
  - **Fait :** drag & drop implémenté dans `tabs.js` (`_initTabDragHandlers`, `_reorderTab`, indicateurs `_setManualDropIndicator`/`_clearAllDragIndicators`). Indicateur visuel d'insertion avant/après (classes `.tab-drop-before`/`.tab-drop-after`, CSS dans `style.css`). L'ordre réorganise `this.tabs` + le DOM puis appelle `_scheduleSave()`.
  - **Correctif 2026-07-10 :** l'API HTML5 dragstart/drop était neutralisée par Tauri `dragDropEnabled=true` (réservée aux fichiers externes via `onDragDropEvent`). Réimplémenté en **drag manuel** (mousedown/mousemove/mouseup avec seuil de 4px) qui préserve le clic de sélection, le clic sur la croix `.tab-close`, le double-clic pour renommer et le drag de fichiers externes. Les listeners globaux sont installés une fois dans le constructeur (`_bindDragGlobalListeners`). Pendant le renommage, `btn.dataset.renaming="1"` bloque le drag.
  - **Correctif 2026-07-11 :** bug de comparaison `number === string` dans `_reorderTab` (ID des onglets sont des nombres, mais le code passait des chaînes) → corrigé en stringifiant les deux côtés.
  - **Validé 2026-07-11 :** glisser-déposer des onglets fonctionne (indicateur bleu + semi-transparence), ordre persiste après fermeture/ouverture du projet.
  - **Persistance :** aucun changement de `session-persistence.js` nécessaire — `saveTabSession` itère déjà sur `tabs.tabs` dans l'ordre et `restoreTabs` rouvre les onglets dans l'ordre de `session.tabs`, donc l'ordre est automatiquement persisté et restauré (onglets fichiers + scratchpad ; les onglets agent/terminal/prompt-builder ne sont pas persistés, comportement existant).

### 3. Menu contextuel (clic droit)
- [x] **Enlever les options du clic droit**
  - Nettoyer le menu contextuel pour ne conserver que les actions pertinentes.
  - Supprimer les entrées inutiles ou redondantes.
  - **Fait :** handler global `contextmenu` dans `main.js` qui supprime le menu natif du système (Reload, Inspect, Save as…) partout, sauf dans l'éditeur CodeMirror et les champs `input`/`textarea` (copier/coller préservé). Les menus contextuels Pilot (sidebar, futur onglets) restent fonctionnels car ce sont des DOM personnalisés.

### 4. Export PDF d'un fichier .md
- [x] **Export en PDF d'un fichier .md**
  - Problème rencontré : *"J'ai fermé le logiciel en pensant qu'un aperçu du PDF a été ouvert."* 
  - Amélioration : ouvrir un aperçu explicite ou un dialogue de confirmation avant de quitter.
  - Ajouter un indicateur visuel clair lorsqu'un export PDF est en cours ou terminé.
  - **Fait :** nouveau module `src/js/pdf-export.js` (`exportMarkdownToPdf`) qui ouvre un **aperçu explicite plein écran** (overlay `#pdf-export-overlay`) avec barre d'outils : titre, nom du fichier, **indicateur de statut** (« Génération… » → « Aperçu prêt » → « Impression… » → « Export terminé »), bouton « 🖨️ Imprimer / Enregistrer en PDF » (lancement explicite par l'utilisateur) et bouton « ✕ Fermer » (ou Échap). L'iframe est désormais **visible** (rendu du document affiché) au lieu d'être invisible. Le `print()` n'est plus automatique — l'utilisateur clique pour imprimer. Toast de confirmation à chaque étape. CSS `.pdf-export-*` dans `style.css`. Branchement dans `sidebar.js` : handler `ctxExportPdf` simplifié, import `exportMarkdownToPdf` (remplace l'ancien `imageToBase64` déplacé dans le module).
  - **Validé 2026-07-11 :** aperçu plein écran, indicateur de statut, boutons Imprimer/Fermer fonctionnels, Échap ferme proprement.

### 5. Mode orchestration – Liste des tâches
- [x] **Figer la jauge de progression et les informations fixes**
  - En mode orchestration, la jauge de progression, la tâche en cours, les boutons pause/arrêt, etc., doivent rester fixes (ne pas défiler).
- [x] **Faire défiler uniquement la liste des tâches**
  - Seule la liste des tâches doit être scrollable, le reste de l'interface (barre de progression, contrôles) reste en place.
  - **Fait :** `.orchestration-panel` passé en `display:flex; flex-direction:column; overflow:hidden`. `flex-shrink:0` ajouté à `.orchestration-header`, `.orchestration-progress` et `.orch-metrics` (parties fixes). `.orchestration-tasks` rendu scrollable (`overflow-y:auto; flex:1 1 auto; min-height:0`). Bonus : scroll automatique de la liste vers la tâche active (`renderOrchestrationPlan` dans `agent-pi.js`) pour qu'elle reste visible.

### 6. Renommer un onglet
- [x] **Renommer le fichier via le nom de l'onglet**
  - Double-clic sur le nom d'un onglet lié à un fichier → édition inline → renomme le fichier sur le disque.
  - Non applicable aux onglets sans fichier (agent, terminal, prompt-builder, brouillon).
  - **Fait :** double-clic sur `.tab-name` dans `tabs.js` (`_renderTabButton`) déclenche `_startTabRename` qui crée un `<input>` inline (Entrée = valider, Échap = annuler, blur = valider). À la validation : appelle la commande Tauri existante `rename_file_or_dir`, met à jour tous les onglets liés via `renameTabPath` (améliorée pour boucler sur tous les onglets du fichier — cas edit+preview), et rafraîchit l'arbre via `getSidebar()._rebuildTree()`. Curseur désactivé pendant l'édition (`btn.draggable = false` restauré à la fin). Toast de confirmation/erreur. CSS `.tab-rename-input` dans `style.css`. Sélection automatique du nom sans l'extension.

### 7. Quality-gate interne (skill embarqué, activable dans l'onglet agent)
- [x] **Option pour activer un quality-gate géré par Pilot**
  - L'utilisateur supprime le skill `quality-gate` global de pi ; Pilot fournit son propre `SKILL.md` **embarqué dans le binaire** (copie du protocole global), activable via un bouton 🛡️ dans la toolbar de l'onglet agent.
  - **Pas de `--no-skills`** : les autres skills globaux de pi restent chargés (découverte auto). Pilot ajoute simplement `--skill <config_dir>/skills/quality-gate/SKILL.md` quand l'option est active.
  - Persistance : `quality_gate_enabled: bool` dans `AppConfig` (config.json), relu à chaque démarrage de Pilot.
  - Au clic 🛡️ : toggle + `save_config` + **relance immédiate** de l'agent (les skills se chargent au démarrage de pi). Si `rpc_no_session` est coché, l'historique est perdu ; sinon conservé (`--session-dir`).
  - **Spécification détaillée :** voir [`spec_quality_gate.md`](./spec_quality_gate.md).
  - **Fait :**
    - `src-tauri/skills/quality-gate/SKILL.md` (nouveau) — skill embarqué via `include_str!("../skills/quality-gate/SKILL.md")`, écrit dans `<app_data_dir>/skills/quality-gate/SKILL.md` au démarrage de l'agent quand l'option est active.
    - `src-tauri/src/rpc_manager.rs` — `spawn_and_start` reçoit `skill_path: Option<&str>`, ajoute `--skill <path>` si fourni.
    - `src-tauri/src/lib.rs` — `AppConfig.quality_gate_enabled` (`#[serde(default)]`) ; `do_start_agent_session` lit le flag, écrit le `SKILL.md`, passe le chemin à `spawn_and_start`.
    - `src/js/agent-pi.js` — bouton 🛡️ (`data-action="quality-gate"`) dans la toolbar, `refreshQualityGate()` init l'état depuis la config, `case "quality-gate"` (toggle + save + relance).
    - `src/js/settings.js` — préserve `quality_gate_enabled` dans l'objet config (sinon un save dans les Paramètres le resetterait à false).
    - `src/css/style.css` — `.agent-btn.active` (fond vert `--success`).

### 8. Dictée vocale (micro à côté du bouton envoyer)
- [x] **Bouton micro pour dicter l'instruction à l'agent**
  - Ajouter un bouton 🎙️ à côté du bouton envoyer (➤ web / ▶️ desktop) dans la barre de saisie du chat agent, pour dicter directement le texte de l'instruction.
  - Fonctionne sur les **deux interfaces** : web remote (`web/`) et desktop (`agent-pi.js`).
  - **Web Speech API** natif du navigateur (zéro backend, zéro Whisper).
  - Langue **`fr-FR` figée** dans un premier temps.
  - **Web remote :** dictée conditionnée à un accès **HTTPS** (le micro exige un *secure context*) → accès via **Tailscale Serve** (`https://fixe.ts.net`). En HTTP, le navigateur bloque le micro (détection `window.isSecureContext`).
  - **Desktop :** pas de contrainte (Tauri = `localhost`/`tauri://`, déjà un secure context).
  - **Confidentialité :** sur Chrome/WebView2, `SpeechRecognition` transcrit via le cloud du moteur (pas 100% local) — trade-off accepté vs Whisper backend (écarté, trop lourd).
  - Bouton masqué si non supporté (Firefox, WebKit à vérifier), désactivé si `web_readonly` ou `isStreaming`.
  - **Fait :** bouton 🎙️ ajouté à côté du bouton envoyer sur les deux interfaces. **Web remote** (`web/index.html` + `web/js/app.js` + `web/css/web.css`) : `#prompt-mic` dans `#prompt-form`, logique `SpeechRecognition` (`interimResults`+`continuous`, injection à la fin du textarea via snapshot `preText`, `finalText` accumulé + interim remplacé), masqué si non supporté, désactivé si `isStreaming`/`readonly`/`!isSecureContext` (avertissement HTTPS/Tailscale Serve), état visuel `.rec` (rouge pulsant). `updateMicState()` appelée depuis `updateStatusUi` et `applyProject`. **Desktop** (`src/js/agent-pi.js` + `src/css/style.css`) : bouton `data-action="voice"` dans la barre de saisie (avant ▶️), `case "voice"` dans le switch d'event-delegation existant, refus si `isStreaming` (avec message), arrêt auto de la dictée à l'envoi (`stopVoiceInput()` dans `sendPrompt`), masqué si WebKit non supporté, classe `.rec`. Langue `fr-FR` figée (`const VOICE_LANG`). Option 1 (duplication minimale) choisie pour la mutualisation — pas de module partagé (web et desktop = codebases séparées). **Correctif anti-doublon (Android, 2026-07-10)** : Chrome Android en `continuous=true` finalise des résultats *cumulatifs* (chaque résultat contient les précédents, ex « salut », « salut comment », « salut comment ça va ») ; les concaténer dupliquait le texte (« salutsalut comment… »). On distingue mode **cumulatif** (Android : garder le résultat le plus complet) vs **incrémental** (Chrome desktop : concaténer les segments) via `norm(finals[last]).startsWith(norm(finals[last-1]))` (et idem pour l'interim). Cache-busting `app.js?v=2` dans `web/index.html` pour forcer le rechargement par le navigateur (sinon cache).
  - **Spécification détaillée :** voir [`spec_voice_input.md`](./spec_voice_input.md) (décisions, mécanisme, contrainte secure context, UX, plan d'implémentation web + desktop, compatibilité, points ouverts).

### 9. Confirmation de sortie
- [x] **Demander confirmation avant de quitter Pilot**
  - Au clic sur le bouton de fermeture (×) de la fenêtre, afficher une demande de confirmation avant de quitter l'application.
  - **Fait :** gestionnaire `CloseRequested` dans `lib.rs` (`on_window_event`) : on appelle `api.prevent_close()` (synchrone) puis on affiche un dialogue natif OK/Annuler via `tauri-plugin-dialog` (`DialogExt` + `MessageDialogButtons::OkCancel`). Si l'utilisateur confirme, on détruit la fenêtre via `window.destroy()` (qui ne réémet pas `CloseRequested` → pas de boucle de re-confirmation) ; sinon on ne fait rien. Le cas `web_keep_alive && web_enabled` (mode keep-alive, fenêtre cachée au lieu de quitter) est préservé avant la confirmation. Import ajouté : `use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};`.

---

## 🐛 Bugs

### 1. Reprise intempestive de l'agent après arrêt
- [x] **Parfois, alors qu'on a arrêté l'agent, il reprend soudainement là où il s'est arrêté**
  - L'agent ne tient pas compte de l'ordre d'arrêt dans certains cas.
  - Vérifier la gestion des signaux d'interruption et l'état du thread/processus.
  - Ajouter un mécanisme de confirmation ou de vérification d'état avant toute reprise automatique.
  - **Fait :** cause racine identifiée côté frontend (`agent-pi.js`) : le bouton d'arrêt ⏹️ (`case "abort"`) mettait `isStreaming=false` mais ne touchait pas à l'orchestration. En mode orchestration, l'`agent_end` qui suit l'abort déclenchait `handleOrchestrationAgentEnd` (qui voyait `orchestrationRunning=true`) → il traitait la fin et relançait `executeNextTask` → l'agent reprenait tout seul. Correctif : l'abort met désormais `orchestrationPaused=true` + `orchestrationRunning=false` + annule le timeout, avec un message « ⏹️ Agent arrêté — plan mis en pause ». Tous les chemins de reprise automatique sont ainsi gardés (`handleOrchestrationAgentEnd`, `executeNextTask`, `handleOrchestrationTimeout`, `resetOrchestrationIdleTimer`, `handleOrchestrationConnectionError`). La reprise devient **manuelle** (bouton ▶️ `orch-resume`), qui réactive `orchestrationRunning=true` + `orchestrationPaused=false`. Côté Rust (`rpc_manager.rs`), `stop_session` gérait déjà correctement l'arrêt (abort + kill + drain) — pas de changement nécessaire.

### 2. NO_CHANGE non géré comme succès (boucle jusqu'à escalade)
- [x] **Le codeur répond `DONE` en indiquant qu'aucune modification n'est nécessaire (ex. « déjà aligné sur pi, aucun changement requis »), sans produire de bloc `SEARCH/REPLACE`/`CREATE` → la validation échouait (aucun fichier modifié) → retry → boucle (jusqu'à « tentative 4+ ») → escalade abusive vers l'orchestrateur qui fait tout le travail.**
  - Symptôme observé : avec un codeur cloud (deepseekV4Flash), le plan fait une tâche puis s'arrête ; le compteur d'attempts grimpe à 4+ sans subdivision/escalade propre.
  - **Fait (2026-07-13) :** ajout d'une branche `else if (hasDone && !sr.hasBlocks && detectNoChangeDone(responseText))` dans le bloc de validation post-tâche (`agent-pi.js`), qui force `validation = { ok: true, reason: "NO_CHANGE — ..." }`. La détection `detectNoChangeDone` couvre le marqueur explicite `NO_CHANGE:` ET les formulations naturelles (« aucun changement », « déjà aligné », « rien à modifier », « déjà implémenté », « already aligned », etc.). La tâche est marquée `completed` et le plan avance normalement.

### 3. Enchaînement des tâches bloqué après retry transitoire (Bug 7)
- [x] **L'orchestration de zéro : le codeur fait la tâche 1 (3 phases, DONE avec modifications), puis plus rien n'avance — la tâche 1 n'est pas rayée comme effectuée.**
  - Cause racine (Bug 9 — la vraie cause du symptôme) : dans le bloc `validation.ok`, `logTaskAttempt` utilisait le shorthand `filesChanged,` référençant une variable inexistante (elle s'appelle `changedFiles`). À chaque tâche réussie, `ReferenceError: filesChanged is not defined` était levée → `appendSystemMessage` et `executeNextTask` jamais atteints → tâche pas rayée, plan arrêté. Bug introduit par l'observabilité E0.
  - **Fait (2026-07-13) :** `filesChanged: changedFiles` (propriété explicite).
  - Cause secondaire (Bug 7) : pi RPC émet `auto_retry_start` (retry transitoire — latence cloud, 429) → `handleOrchestrationConnectionError` met `orchestrationConnectionError = true` + `orchestrationPaused = true`. Le codeur finit quand même par répondre (DONE + blocs), mais `handleOrchestrationAgentEnd` voyait le flag et **returnait immédiatement sans traiter la fin** → la tâche n'était jamais marquée `completed` → plan bloqué en pause.
  - **Fait (2026-07-13) :** si `orchestrationConnectionError` est true mais la réponse contient un marqueur valide (`DONE`/`SELF_FIX`/`NEED_HELP`/`NO_CHANGE`/blocs), on traite quand même la fin (reset flags, reprise). Sinon, comportement inchangé (vraie erreur → pause).
  - **Fait (Bug 8, 2026-07-13) :** le timer d'inactivité (120 s) n'était reset qu'à `text_delta` — une longue Phase 1 (réflexion + `read_file` > 120 s) déclenchait le timeout → abort du codeur en plein travail. Corrigé : reset du timer à `thinking_delta`, `toolcall_start/delta`, `tool_execution_start/end`. Le timer ne se déclenche plus que si vraiment rien ne se passe pendant 120 s.
  - **Diagnostic ajouté :** si un plan existe mais `orchestrationRunning` est false à la fin d'une réponse, un message `⚠️ [diagnostic]` s'affiche pour localiser le blocage.

---

## 🧪 Tests à faire par moi

Liste des tests de validation à réaliser par l'utilisateur. Cocher `[x]` une fois le test validé.

- [ ] **Bug 2 — NO_CHANGE non géré** : en mode orchestration (2 modèles cloud), lancer un plan comportant une tâche déjà satisfaite (ex. code déjà aligné) → vérifier que le codeur répond `DONE` avec « aucun changement requis » et que la tâche est marquée ✅ completed (pas de boucle, pas d'escalade). Vérifier que le plan enchaîne sur la tâche suivante automatiquement.
- [ ] **Évolution 2 — Déplacement des onglets** : ouvrir plusieurs fichiers, glisser-déposer les onglets pour réorganiser, fermer/rouvrir le projet → vérifier que l'ordre est conservé.
- [x] **Évolution 5 — Mode orchestration** : activer le mode orchestration, lancer un plan → vérifier que la jauge de progression, les boutons pause/arrêt et la tâche en cours restent fixes en haut, et que seule la liste des tâches défile. ✅ Validé 2026-07-11.
- [x] **Évolution 6 — Renommer un onglet** : double-clic sur le nom d'un onglet lié à un fichier → éditer le nom, Entrée → vérifier que le fichier est renommé sur le disque, l'onglet et l'arbre mis à jour. Vérifier qu'Échap annule et que l'agent/terminal/brouillon ne sont pas renommables. ✅ Validé 2026-07-11 (correctif : le setTimeout de focus éditeur dans switchTab volait le focus de l'input au dblclick → garde de renommage ajoutée).
- [x] **Évolution 1 — Brouillons par projet** : ouvrir un projet A, écrire dans le brouillon, changer de projet B → vérifier que le brouillon de B est indépendant (vide ou contenu propre). Revenir au projet A → vérifier que le contenu de A est restauré. Vérifier la migration de l'ancien brouillon global vers le premier projet ouvert. ✅ Validé 2026-07-11.
- [ ] **Évolution 4 — Export PDF** : clic droit sur un .md → Exporter en PDF → vérifier qu'un aperçu plein écran s'ouvre avec le rendu du document, un indicateur de statut et les boutons Imprimer/Fermer. Cliquer Imprimer → vérifier le dialogue d'impression puis le toast « Export terminé ». Vérifier qu'Échap ferme l'aperçu.
- [x] **Bug 1 — Reprise intempestive de l'agent après arrêt** : en mode orchestration, lancer un plan, puis cliquer ⏹️ (Arrêter) pendant une tâche → vérifier que l'agent ne reprend pas tout seul et qu'un message « plan mis en pause » s'affiche. Vérifier que ▶️ (Reprendre) relance bien le plan manuellement. ✅ Validé 2026-07-11.
- [x] **Évolution 8 — Dictée vocale (desktop)** : onglet Agent π → cliquer 🎙️ → autoriser le micro si demandé → vérifier que le bouton passe en rouge pulsant (REC) et que le texte dicté s'injecte en continu dans le textarea. Re-cliquer pour arrêter → vérifier que le texte final reste. Vérifier que pendant le streaming de l'agent le bouton refuse (message « Agent en cours ») et qu'un envoi pendant la dictée l'arrête proprement. **❌ Option A (2026-07-10)** : dictée desktop bloquée par wry/Tauri (aucune API pour autoriser le micro du WebView) ; voie web remote retenue. Le bouton 🎙️ desktop reste présent mais affiche un message informatif (pas de patch wry). **✅ Validé 2026-07-11 (solution retenue)** : la voie web remote (HTTPS via Tailscale Serve) couvre le besoin desktop — le micro fonctionne dans Chrome sur le portable Windows (et sur Android), ce qui suffit au cas d'usage. L'Option A (micro du WebView Tauri) reste écartée (limite wry/Tauri, pas de patch prévu).
- [x] **Évolution 8 — Dictée vocale (web remote HTTPS)** : depuis le téléphone via `https://<nom>.ts.net/` (Tailscale Serve), cliquer 🎙️ → autoriser le micro → vérifier la transcription en continu. Vérifier qu'en HTTP (sans HTTPS) le bouton est désactivé avec l'infobulle « requiert HTTPS ». ✅ Validé 2026-07-10 (transcription sans doublon après correctif anti-cumulatif Android). ✅ Re-validé 2026-07-11 (correctif accès distant : `web_bind` remis sur `127.0.0.1`, Tailscale Serve aligné sur le port courant `8787`, instance orpheline sur 8790 tuée — bouton 🎙️ restauré sur Android + Chrome Windows).
- [x] **Évolution 7 — Quality-gate interne** : onglet Agent π → cliquer 🛡️ → vérifier que le bouton passe en vert (actif) et qu'un message « Quality-gate activé. Agent redémarré » s'affiche. Demander à l'agent de modifier un fichier de code → vérifier qu'il applique le protocole (lit les fichiers avant, cartographie, relit après, récapitule les vérifications). Re-cliquer 🛡️ → vérifier qu'il redevient inactif et que l'agent ne suit plus le protocole. Vérifier qu'un redémarrage de Pilot conserve l'état (relu depuis config). Vérifier qu'ouvrir les Paramètres puis sauvegarder ne reset pas l'option à false. ✅ Validé 2026-07-11.
- [x] **Évolution 9 — Confirmation de sortie** : cliquer le bouton × de la fenêtre → vérifier qu'un dialogue « Quitter Pilot / Êtes-vous sûr de vouloir quitter Pilot ? » s'affiche avec boutons OK/Annuler. Cliquer Annuler → l'app reste ouverte. Cliquer OK → l'app se ferme proprement (pas de boucle de re-confirmation). Vérifier que le cas keep-alive + serveur web activé cache la fenêtre sans dialogue (comportement existant préservé). ✅ Validé 2026-07-11.

---

*Document créé le 10/07/2026*
