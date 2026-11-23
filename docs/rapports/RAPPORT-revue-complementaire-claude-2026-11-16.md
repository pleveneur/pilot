# Addendum au rapport de revue Pilot : revue complémentaire du 2026-11-16

*Revue en lecture seule par Claude (Opus 5.5), pour Drass. Elle complète `docs/rapports/RAPPORT-revue-claude-2026-11-16.md` sans le réécrire. Référence : branche locale `review/claude-audit-2026-11-16`, HEAD `6d57ddd`. Rien n'a été modifié, commité, poussé ni publié. Aucun shell, réseau ou secret n'a été utilisé.*

> Statuts : **CL** = confirmé par lecture du code ; **H** = hypothèse qui dépend d'un comportement non vérifié. Aucun constat de cet addendum n'est confirmé par exécution.

---

## (a) Synthèse

**Situation des tests (mise à jour).** Le premier rapport indiquait « aucun test exécuté », parce que l'installation npm avait échoué dans le bac à sable (`bwrap: Can't create file /work`). Ce passage reste exact pour la date du premier rapport. Depuis, le harnais a été relancé et validé (run `20261116-070539-661120`, copie jetable sous bubblewrap, Node v26.12.0) :
- **Vitest** : 5 994 tests, 5 993 réussis, 0 échec, 1 en attente (code 0).
- **`npm run build`** : code 0.
- **Rust** : non exécuté (`cargo` absent).
- **Rendu graphique** : non validé.

Ces tests verts ne contredisent aucun constat ci-dessous. Aucun des tests lus ne couvre les comportements en cause. Autre point : les tests Rust qui ont besoin de PostgreSQL semblent **s'arrêter en silence sans base** (motif `None => return`, `gds-core/src/db.rs:3612-3614`). Même avec `cargo`, une partie des tests de rôles et de portage pourrait donc passer sans rien vérifier.

**Ce que la revue complémentaire ajoute :**
1. **GDS / SSH.** La désactivation d'un compte coupe ses sessions HTTP, mais **pas son accès SSH aux dépôts** (COMP-01). L'accès SSH ne distingue ni le rôle, ni le dépôt, ni le portage : un compte `standard` peut pousser du code dans n'importe quel dépôt (COMP-02). La prise en main d'un projet est ouverte à tout compte authentifié (COMP-03). En revanche, les transactions du portage sont solides (contre-preuve, §d).
2. **Nouvelles injections HTML dans l'application de bureau, hors prévisualisation.** Le tableau de bord insère des **noms de fichiers du projet** dans `innerHTML` (COMP-06). L'historique des sessions et la revue réutilisent le rendu `html: true` de la prévisualisation (COMP-07). La chaîne d'exploitation est la même que XSS-01.
3. **Plafonds de consommation.** Le plafond de tours, la détection de boucle et le délai d'inactivité n'existent **que dans l'interface**. Fermer l'onglet 🎭 les supprime alors que les agents continuent de tourner (COMP-08).
4. **Confirmations de l'Assistant.** Activer un serveur MCP ou lancer un agent sur un serveur MCP n'est soumis qu'à une **consigne donnée au modèle**. Le réglage `mcp_agent_confirm`, actif par défaut, n'est pas appliqué techniquement (COMP-09).
5. **Telegram.** Le filtre porte sur la discussion (`chat.id`) et non sur la personne. Les messages modifiés sont rejoués (COMP-11).
6. **Client web distant (`web/js/app.js`).** Aucun défaut XSS trouvé : le rendu échappe tout le texte d'abord, et le jeton circule en en-tête Bearer, ce qui écarte le CSRF (contre-preuves, §d).

---

## (b) Couverture de cette revue complémentaire

| Domaine | Fichiers / lignes lus | Niveau | Non vérifié |
|---|---|---|---|
| Règles du projet | `AGENTS.md` l. 1-197 et 372-583 | détaillé (parties normatives) | arborescence l. 198-371 |
| GDS : migrations | `0006_roles.sql`, `0008_project_handover.sql` (entiers) | détaillé | 0001-0005 et 0007 |
| GDS : `db.rs` | liste des fonctions (grep) ; l. 479-498 ; l. 1740-2340 (garde de publication, garde d'ajout, portage complet) | détaillé sur ces blocs | `migrate` (l. 215-250), synchro du suivi (l. 978-1420), tickets |
| GDS : routes `http.rs` | l. 440-484 (création de compte), 575-619 (statut), 820-899 (revalidation, middleware), 966-1001 (inscription), 2050-2109 (création de projet), 2185-2262 (clé SSH), 2340-2640 (routes de portage) | détaillé sur ces handlers | montage exact de `gds_handover_state`, autres routes |
| GDS : SSH | `ssh.rs` l. 1-40, 80-160, 675-734, 926-967 ; grep `useradd`, `git-shell` | détaillé sur ces blocs | `provision_server_ssh`, `restrict_git_account_to_git_shell` (corps) |
| GDS : hooks Git | grep `pre-receive`, `hooks/`, `core.hooksPath` dans `gds-core`, `gds-server`, `src-tauri/src/gds*.rs` : aucun résultat | recherche | fichiers Docker et image (non trouvés ni lus) |
| GDS côté poste | grep seulement (`gds.rs:1699`, `gds_sync.rs:1042`, `gds_handover.rs:1185`) | ponctuel | `gds_handover.rs` (voie HTTP ou base directe ?) |
| Délégations et boucles | `agents-bus.js` l. 1069-1091, 2179-2201, 2636-2909, grep 3030 ; grep des plafonds dans `src-tauri/src` | détaillé | `super-agent.js` l. 9925-10651 (traitement des sentinelles), `pilot-assistant-delegation.ts`, `pilot-choices.ts`, `exclusivity-queue.js` |
| Assistant : lancement | `agent_service.rs` l. 3440-3627 ; `rpc_manager.rs` (grep des arguments) | détaillé | — |
| Assistant : actions | `pilot-assistant-actions.ts` l. 10-50, 196-241, 372-396 ; grep des outils et des confirmations | détaillé sur ces parties | `open_project`, `create_agent`, `delegate_to_coder` (corps), `stop_listening` |
| Discussion seule | `pilot-persona-fiche.ts` (entier) | détaillé | comportement réel de pi sans extension |
| Client web (`web/js/app.js`) | l. 560-680, 780-870, 1085-1175 ; grep de tous les `innerHTML`, du jeton et du WebSocket dans `web/` | détaillé sur le rendu, échantillonné ailleurs | `files.js`, `chat.js`, `projects.js` (seulement : aucun `innerHTML` dans `web/` hors `app.js`) ; listes de projets l. 351-392 |
| Rendus HTML du bureau | grep des options markdown-it et Mermaid ; grep des gabarits `innerHTML` avec interpolation ; `dashboard.js` l. 415-436, 866-885, 1060-1077 ; `session-history.js` l. 218-237 | détaillé sur ces lignes | `review.js`, `updater.js` (import seul), `dashboard.rs:819` (origine de `recent_files`) |
| Configuration Tauri | `capabilities/default.json` (entier) ; grep de `tauri.conf.json` | détaillé | comportement IPC à l'exécution |
| Telegram | `telegram.rs` l. 640-748 ; grep `chat_id` | détaillé sur la réception | envoi, `telegram-dialog.js`, curseur, traitement en aval |
| MCP | `mcp_config.rs` (grep des fonctions et commentaires) | échantillonné | `mcp-client.src.ts`, `attach_mcp_secrets`, `pilot-mcp-client.ts` |
| Chaîne de livraison | aucun fichier lu (inventaire seulement) | **non vérifié** | tout |
| Audio, dictée, Whisper, patch vendor | aucun fichier lu | **non vérifié** | tout |
| Code Graph, mémoire, historique (Rust) | aucun en profondeur | **non vérifié** | `code_graph.rs`, `session_history.rs`, `pilot-assistant-session-memory.ts` |
| Accessibilité | aucune | **non vérifié** | tout |

Je ne prétends pas avoir examiné chaque ligne de ces fichiers.

---

## (c) Nouveaux constats

### COMP-01 — Un compte GDS désactivé garde son accès SSH aux dépôts (P1)
- **Statut** : CL. **Confiance** : élevée sur le code. Qu'un `sshd` réel accepte encore la clé est une H, faute d'exécution.
- **Code** :
  - `gds-core/src/ssh.rs:926-942` (`stored_key_lines`) : `SELECT k.public_key, u.email FROM ssh_keys k JOIN users u …`, **sans filtre sur `u.status`** ;
  - `gds-core/src/db.rs:479-487` (`set_user_status`) : met seulement à jour la colonne ;
  - `gds-core/src/http.rs:609-618` : après le changement de statut, seules les sessions HTTP sont révoquées (`ctx.auth().revoke_user`). Pas de suppression de clé, pas de régénération de `authorized_keys` ;
  - `gds-server/src/main.rs:276-278` : la maintenance régénère le fichier toutes les 30 s (`http.rs:2196`) à partir de la même requête. Les clés du compte désactivé y sont donc **réécrites**.
- **Chemin d'appel** : l'administrateur désactive le compte → `set_user_status` → les sessions HTTP sont révoquées → la boucle de maintenance → `regenerate_authorized_keys` → `stored_key_lines` → la clé du compte désactivé reste dans `~git/.ssh/authorized_keys`.
- **Préconditions** : le compte a enregistré une clé (`http.rs:2200-2262`, ouvert à tous les rôles, `standard` compris), et le serveur SSH est exposé.
- **Impact** : un collaborateur écarté garde `git clone` et `git push` sur les dépôts (voir COMP-02). Le contraste avec le HTTP est net : `auth_middleware` revalide le statut à chaque requête (`http.rs:877-896`).
- **Correction minimale** : `WHERE u.status = 'active'` dans `stored_key_lines`, puis `regenerate_authorized_keys` juste après le changement de statut (et de rôle).
- **Test suggéré** : test de base jetable. Créer un compte actif avec une clé, régénérer, vérifier que la ligne est présente ; désactiver, régénérer, vérifier que la ligne a disparu. À exécuter **avec** PostgreSQL : la base absente ne doit pas faire passer le test en silence.

### COMP-02 — L'accès SSH ne vérifie ni le rôle, ni le dépôt, ni le portage (P1 ; à trancher avec Patrick)
- **Statut** : CL pour l'absence de restriction dans le code lu. H sur l'absence de hook ailleurs (image Docker non lue). **Confiance** : moyenne.
- **Code** :
  - les lignes `authorized_keys` ont la forme `type base64 email`, **sans option** `restrict` ni `command=` (`ssh.rs:88-91`, `950-967`). Toutes les clés ouvrent le même compte système `git` ;
  - `http.rs:2187-2189` : « Tout rôle avec identité est accepté, `standard` compris… la clef ouvre le dépôt ». L'intention écrite est la **lecture** (« récupérer sa copie »), mais rien n'interdit l'écriture ;
  - aucun hook `pre-receive` ou `update` trouvé, et aucune référence au portage dans `git.rs`, `ssh.rs` ou `git_cmd.rs` (recherches sans résultat) ;
  - les gardes de rôle n'existent que sur les routes HTTP : `ensure_project_publisher` (`db.rs:1750-1783`) et `ensure_can_add_project` (`db.rs:1831-1864`, appelée en `http.rs:2089`) ;
  - **poste dev** : le compte est créé par `useradd -m -s /bin/bash git` (`ssh.rs:228`). Le remplacement par `git-shell` n'est fait « que dans le conteneur, jamais au poste dev » (`ssh.rs:678-686`). Sur un poste dev qui sert du SSH, toute clé enregistrée ouvre donc un **shell bash complet** sous `git` (H : dépend de l'usage réel de `provision_server_ssh`, non lu).
- **Chemin d'appel** : `POST /api/gds/ssh/keys` (tout compte actif) → `authorized_keys` → `ssh git@serveur git-receive-pack <dépôt>` → `git-shell` autorise `receive-pack` (comportement standard de Git).
- **Impact** : un compte `standard`, qui n'a pas le droit de publier par l'API, peut publier par `git push`. Le portage reste indicatif pour Git : un autre poste peut pousser pendant qu'un porteur tient le projet.
- **Correction minimale** : `restrict,command="<garde> <user_id>"` sur chaque ligne. La garde vérifie le rôle, le statut, le dépôt demandé et le portage, puis lance `git-upload-pack` ou `git-receive-pack`. Ou un hook `pre-receive` équivalent. Utiliser `git-shell` aussi sur le poste dev.
- **Test suggéré** : test pur du rendu (chaque ligne commence par `restrict,command=`). Test d'intégration en conteneur jetable : un compte `standard` qui pousse est refusé, un compte `dev` sans portage est refusé.

### COMP-03 — Prise en main d'un projet ouverte à tout rôle et renouvelable sans limite (P2)
- **Statut** : CL. **Confiance** : élevée sur le code. L'impact dépend du respect du portage par les postes.
- **Code** : `http.rs:2362-2424` (`gds_handover_take`, « route du membre, authentification seule »). Seuls sont vérifiés `poste_id` non vide, `user_id != 0` et l'existence du projet. Aucun contrôle de rôle ni d'appartenance. `gds_handover_heartbeat` (`2439-2479`) prolonge de 15 min à chaque appel.
- **Préconditions** : un compte actif, même `standard`.
- **Impact** : un compte `standard` (ou un compte compromis) peut bloquer un projet (409 pour les autres) jusqu'à une libération forcée par un administrateur (`2605-2640`).
- **Correction minimale** : exiger `roles::can_publish_project(&authed.role)` dans `take` et `heartbeat`.
- **Test suggéré** : route `take` appelée avec un compte `standard` → 403.

### COMP-04 — Inscription : adresse non validée, mot de passe vide accepté, échec de hachage masqué (P3)
- **Statut** : CL. **Confiance** : élevée.
- **Code** : `http.rs:985-997`. L'adresse est seulement nettoyée des espaces de bord (`trim()`), les retours à la ligne internes passent. Aucun contrôle du mot de passe. `WebAuth::hash_password(...).unwrap_or_default()` enregistre une **empreinte vide** si le hachage échoue. Le compte est créé en `pending`, ce qui limite l'effet.
- **Contre-preuve** : une injection de ligne dans `authorized_keys` par l'adresse est **neutralisée**. `render_authorized_keys` ne garde que trois éléments par ligne (`ssh.rs:950-967`, via `parse_authorized_key` `95-105`, `split_whitespace`).
- **Correction minimale** : valider l'adresse (sans espace ni caractère de contrôle, un seul `@`), exiger une longueur minimale de mot de passe, et propager l'erreur de hachage.
- **Test suggéré** : inscription avec `"a@b\nc"` → 400 ; mot de passe vide → 400.

### COMP-05 — L'ajout de projet laisse passer une identité inconnue, y compris côté serveur (P2)
- **Statut** : CL. **Confiance** : moyenne. Qui reçoit des jetons avec `user_id == 0` n'a pas été vérifié.
- **Code** :
  - `db.rs:1838-1840` : `let Some(user) = get_user_by_email(...)? else { return Ok(()) }`. Un compte inconnu **passe** (choix documenté de compatibilité, `1818-1821`) ;
  - `http.rs:2074-2091` : quand `authed.user_id == 0` (« session historique du poste »), l'adresse vaut `""`, donc la garde passe et `create_project_in_root` crée le dépôt ;
  - côté poste, l'identité vient de `.pilot/gds.json` (`gds_sync.rs:1042`, `cfg.identity_email`). Cela précise le point « identité déclarative » du premier rapport.
- **Impact** : une session sans compte GDS peut créer des projets et des dépôts sur le serveur sans aucun rôle.
- **Correction minimale** : refuser `user_id == 0` sur `projects/create` ; derrière un réglage explicite si la compatibilité doit rester.
- **Test suggéré** : route de création appelée avec un jeton sans compte → 403.

### COMP-06 — Tableau de bord : des noms de fichiers du projet sont insérés en HTML (P1, même chaîne que XSS-01)
- **Statut** : CL pour l'injection. H pour l'appel aux commandes internes (comme XSS-01). **Confiance** : élevée sur l'injection.
- **Code** :
  - `src/js/dashboard.js:881` : `` li.innerHTML = `<span … title="${f.path}">${rel}</span>…` ``. `f.path` vient du parcours du disque (`src-tauri/src/dashboard.rs:186-240`, `path.to_string_lossy()`) ;
  - `dashboard.js:1073` : `${f.path}` des derniers fichiers modifiés (origine `dashboard.rs:819`, non lue en détail) ;
  - `dashboard.js:433` : `${it.name}` et `${rel}` des éléments à purger.
- **Chemin d'appel** : ouverture du tableau de bord d'un projet → la commande Rust renvoie la liste des fichiers les plus lourds → `innerHTML`.
- **Préconditions** : un dépôt non fiable contient un fichier nommé par exemple `<img src=x onerror=…>`. Ce nom est valide sous Linux et macOS, interdit sous Windows (NTFS refuse `<` et `>`). Le fichier doit être assez gros pour entrer dans les cinq plus lourds, ce que l'auteur du dépôt contrôle.
- **Impact** : identique à XSS-01 (aucune CSP, `tauri.conf.json:53`). Ce chemin **ne dépend pas de la prévisualisation Markdown** : corriger `preview.js` seul ne suffit pas.
- **Autres insertions non échappées (P3)** : des messages d'erreur `${e}` dans `code-graph-view.js:592,607`, `dashboard.js:391,492`, `tabs.js:1357,1405`, `vault.js:113,410`. Ils peuvent contenir des chemins.
- **Correction minimale** : `textContent` ou `esc()`, qui existe déjà dans `icons.js:69` et `search-panel.js:191`.
- **Test suggéré** : jsdom. Rendre la section stockage avec `heaviest: [{ path: "/p/<img src=x onerror=1>", … }]`, puis vérifier qu'aucun `<img>` n'est créé.

### COMP-07 — Historique, revue et notes de mise à jour réutilisent le rendu `html: true` (P1/P2)
- **Statut** : CL. **Confiance** : élevée sur le code, H sur l'exploitation.
- **Code** : `renderMarkdown` (`preview.js:318`, `html: true` en `preview.js:12`) est importé par `session-history.js:12`, `review.js:18` et `updater.js:25`. Dans `session-history.js:224-236`, le texte enregistré de l'agent est rendu puis inséré par `innerHTML`. Or la discussion en direct le neutralise : `html: false` dans `agent-pi.js:276` et `super-agent.js:695`.
- **Chemin d'appel** : un agent recopie du HTML venu d'un fichier non fiable, d'une page web ou d'une injection de prompt → le texte est enregistré dans l'historique → l'utilisateur ouvre l'historique → le HTML est exécuté.
- **Impact** : le HTML qui ne s'exécute pas dans la discussion **s'exécute plus tard dans l'historique**. Pour les notes de mise à jour, le risque relève de la chaîne de livraison : je n'ai pas vérifié si les notes de `latest.json` sont couvertes par la signature (H : la signature de l'updater porte en principe sur les artefacts).
- **Correction minimale** : une instance markdown-it `html: false` pour ces trois usages, ou un nettoyage commun.
- **Test suggéré** : rendre un historique contenant `<img src=x onerror=1>` et vérifier qu'il ne reste aucun attribut `on*`.

### COMP-08 — Les plafonds de tours, de boucles et d'inactivité disparaissent quand l'interface se démonte (P2)
- **Statut** : CL pour le code JavaScript. H sur une reprise éventuelle des sessions à la réouverture (`initAgentsBus` non lu). **Confiance** : moyenne à élevée.
- **Code** :
  - les plafonds sont dans `agents-bus.js` : `DEFAULT_MAX_PI_TURNS_PER_AGENT = 200`, `MAX_TURNS = 50` (`2675-2676`), plafond de tours (`2853-2877`), `MAX_TURNS` (`3030-3031`), détection de boucle (`2685-2763`), délai d'inactivité `resetTimeout` (`2179-2201`) ;
  - côté Rust, `agent_max_turns` n'est qu'un champ de configuration (`lib.rs:648-649, 1169, 1341`). Aucun chien de garde ni délai d'inactivité dans `agent_service.rs` (recherche) ;
  - `destroyAgentsBus` (`agents-bus.js:2639-2667`, appelée en `agents-ui.js:675` : fermeture de l'onglet 🎭, bascule ou fermeture de projet) annule les délais, **désabonne les écouteurs** et vide les runs (`clearAllRuns`, `1069-1075`). Elle n'arrête volontairement pas les agents (« Les agents continuent en arrière-plan », `2659-2665`). Ensuite, `handleAgentEvent` ne trouve plus de contexte (`2844-2848`).
- **Préconditions** : un agent en boucle, ou une mission longue, quand l'utilisateur ferme l'onglet ou change de projet.
- **Impact** : consommation de jetons (et coût fournisseur) **sans aucun plafond** jusqu'à la fin naturelle du processus. La règle du propriétaire (« l'écran ne commande plus le travail ») est respectée, mais la surveillance part avec l'écran.
- **Correction minimale** : déplacer le plafond de tours et le délai d'inactivité dans l'observateur Rust de session (le point d'accroche existe : `anomaly::make_observer`, cité en `agent_service.rs:3616-3621`), indépendamment de l'interface.
- **Test suggéré** : test Rust de l'observateur. Une rafale de `turn_start` au-delà de `agent_max_turns` déclenche un arrêt, sans interface.

### COMP-09 — La confirmation MCP et les changements de réglages de l'Assistant ne sont pas appliqués techniquement (P1/P2)
- **Statut** : CL dans l'extension. H sur le traitement côté interface (`super-agent.js:9925-9935`, `10608-10651` non lus). **Confiance** : moyenne à élevée.
- **Code** :
  - `pilot-assistant-actions.ts:29-31` : la sentinelle d'action est interceptée et Pilot « exécute l'action au lieu d'afficher des boutons Oui/Non » ;
  - `mcp_state` (`350-357`) : la règle « si `confirm` vaut vrai, TOUJOURS demander » n'est qu'une **consigne au modèle** ;
  - `mcp_enable_server` (`372-396`) : « c'est TOI qui demandes confirmation… l'outil applique ensuite l'action » ;
  - côté Rust, `mcp_agent_confirm` (vrai par défaut, `lib.rs:1263`) n'est qu'exposé (`mcp_config.rs:670-678, 762`) ;
  - `run_agents` (`196-241`) accepte un `project` en chemin absolu libre, des agents jetables à `readonly` facultatif et un `mcp_server`.
- **Chemin d'appel** : contenu non fiable (fichier lu, message Telegram, réponse d'un outil MCP) → injection de prompt → l'Assistant appelle `mcp_enable_server` puis `run_agents` avec `mcp_server` → Pilot exécute sans geste de l'utilisateur.
- **Distinction** : déléguer à un agent codeur est une **capacité voulue**. La frontière franchie, c'est la **promesse de confirmation** du réglage, qui n'est tenue que si le modèle obéit.
- **Correction minimale** : quand `mcp_agent_confirm` est vrai, le traitement côté interface de `MCP_SERVER_TOGGLE` et de `RUN_AGENTS` avec `mcp_server` ouvre une **vraie boîte Oui/Non** et refuse sans clic. Restreindre `project` aux projets enregistrés (à vérifier, voir §f).
- **Test suggéré** : test de comportement du traitement de sentinelle. Avec `confirm=true` et sans clic, l'action est refusée et aucune commande Rust n'est appelée.

### COMP-10 — Telegram : filtre par discussion et non par personne, et messages modifiés rejoués (P2/P3)
- **Statut** : CL. **Confiance** : élevée sur le code. L'impact dépend de la configuration.
- **Code** : `telegram.rs:663-748`. L'identité testée est `message.chat.id == cfg.chat_id` (`718-725`), sans contrôle de `from.id`. `edited_message` est accepté comme un message neuf (`679-681`).
- **Contre-preuve** : un expéditeur inconnu est ignoré sans réponse. Les boutons sont filtrés de la même façon (`686-713`).
- **Impact** : si `chat_id` désigne un **groupe**, chaque membre parle à l'Assistant, qui a `run_agents` et `delegate_to_coder`. Modifier un ancien message renvoie la commande.
- **Correction minimale** : contrôler aussi `from.id` (identifiant du propriétaire), refuser par défaut les identifiants de groupe (négatifs), et ignorer `edited_message` ou le dédoublonner.
- **Test suggéré** : test pur de `collect_inbound` : groupe avec un `from.id` étranger → rien retenu ; `edited_message` → rien retenu.

### Autres observations (P3)

| ID | Observation | Fichier:lignes | Statut |
|---|---|---|---|
| COMP-11 | Le portage décide l'expiration avec l'horloge de l'application (`Utc::now()`), alors que la migration parle de `now()` de la base. Un décalage d'horloge entre deux processus qui écrivent dans la même base (serveur, et poste si `set_desktop_pool` y accède directement) fausse l'expiration. | `db.rs:2153, 2197, 2235, 2273` ; `0008:7` | H (voie directe du poste non vérifiée) |
| COMP-12 | Les tests de base sautent en silence sans PostgreSQL : « tests verts » ne veut pas dire « rôles et portage vérifiés ». | `db.rs:3612-3614` (motif observé une fois) | CL ponctuel, généralisation non vérifiée |
| COMP-13 | `write_mcp_config` fait une sauvegarde `.bak`, puis `std::fs::write` sans écriture atomique (même famille que VLT-01). | `mcp_config.rs:184-191` | CL |
| COMP-14 | Le commentaire de `pilot-persona-fiche.ts:8-9` promet qu'« un outil de travail appelé par erreur reçoit une réponse… sans rien exécuter ». Aucun intercepteur `tool_call` n'existe dans ce fichier : documentation fausse (voir AST-01, §d). | `pilot-persona-fiche.ts:8-9, 48-101` | CL |

---

## (d) Constats du premier rapport : confirmés, nuancés ou rejetés

| Constat initial | Verdict | Contre-preuves et précisions |
|---|---|---|
| **XSS-01** (prévisualisation) | **Confirmé par lecture et élargi** | `preview.js:12` `html: true`. Mermaid est en `securityLevel: "loose"` à **deux** endroits : `preview.js:30` et `preview.js:133` (le second n'était pas cité). `tauri.conf.json:53` `"csp": null`. `capabilities/default.json` ne liste que des permissions `core`, `dialog`, `updater`, `process` et `notification` pour `main`, sans aucune restriction des commandes applicatives. **Nuance** : la discussion des agents, l'Assistant, le tableau de bord (Markdown) et le constructeur de prompt utilisent `html: false` (`agent-pi.js:276`, `super-agent.js:695`, `dashboard.js:19`, `prompt-builder.js:17`). Le risque vient de `preview.js` **et de ses réutilisateurs** (COMP-07), plus d'insertions directes (COMP-06). |
| **Accès IPC depuis un script injecté** | **Toujours une H forte, non exécutée** | Rien dans la configuration lue ne le restreint : `build.rs` sans manifeste (premier rapport), capacités sans liste de commandes. La confirmation demande un essai en environnement jetable. |
| **AST-01** (lecture seule de l'Assistant) | **Confirmé par lecture, avec une nuance sur la portée** | `agent_service.rs:3476-3507` : la liste d'extensions est *remplacée* en discussion seule. `3554-3560` : session lancée sans extension si le dossier est inutilisable. `3605-3624` : `spawn_and_start` sans argument de restriction. `rpc_manager.rs` ne pose que `--no-session` et `--extension` (l. 60, 75, 506) : aucun argument qui limite les outils intégrés. **Nuance** : même avec `bash` bloqué, l'Assistant écrit **par délégation** (`run_agents`, `delegate_to_coder`, `pilot-assistant-actions.ts:196-241, 514-537`). C'est voulu (« lecture seule » veut dire « n'écrit pas lui-même », l. 10-11). L'enjeu réel est l'absence de porte humaine (COMP-09). |
| **Outils en « Discussion seule »** | **Confirmé pour Pilot, H pour pi** | Aucun outil de travail de Pilot n'est chargé : MCP est exclu (`3511`, `3591`), Laya, PDF et la règle d'agents aussi (`3535-3551`). Seul `ecrire_ma_fiche` existe. Aucun garde n'est chargé non plus : si pi expose `bash`, `read`, `write` et `edit` par défaut (H), le personnage les a, avec un modèle local. COMP-14 : le commentaire qui promet le contraire est faux. |
| **WEB-01** (mode lecture seule distant) | **Non re-vérifié** | Aucune contre-preuve trouvée. Côté client (`app.js`), rien ne remplace une garde serveur. |
| **WEB-04** (jeton dans l'URL du WebSocket) | **Confirmé** | `web/js/app.js:243-244` `/ws/agent?token=…`. |
| **Client web : XSS** (non évalué au départ) | **Rejeté par lecture** | `mdRender` échappe tout d'abord (`app.js:785-820`) et ne produit ni lien ni attribut. Les commandes passent par `escapeHtml` (`1430-1436`). Les fichiers du générateur de prompt sont échappés dans des attributs entre guillemets doubles (`1538-1539`), donc l'apostrophe non échappée (`785-791`) ne pose pas de problème ici. Aucun `innerHTML` dans `files.js`, `chat.js` ou `projects.js`. |
| **Client web : CSRF** (non évalué) | **Rejeté par lecture** | Jeton en `localStorage` envoyé dans l'en-tête `Authorization: Bearer` (`app.js:20, 30, 143, 197-198`), pas de cookie. Contrepartie : tout XSS futur sur cette origine lirait le jeton. |
| **GDS-02** (revalidation si la base est injoignable) | **Confirmé tel quel (H)** | `http.rs:857-860` garde le rôle du jeton si `pool()` échoue. En revanche, une **lecture** en échec refuse l'accès (`866`). |
| **Identité GDS déclarative** | **Nuancé** | La voie serveur utilise l'identité du jeton (`http.rs:2085-2091`). La voie du poste se fie à `.pilot/gds.json` (`gds_sync.rs:1042`). La garde d'ajout est ouverte pour un compte inconnu (COMP-05). |
| **GDS : verrous et transactions** (non vérifiés au départ) | **Contre-preuve : solide** | Index unique partiel `WHERE returned_at IS NULL` (`0008:43-45`). `SELECT … FOR UPDATE` (`db.rs:1973-1991`). La violation de contrainte est reconnue par code SQLSTATE et nom d'index, puis traduite en refus (`1904-1912`, `2108-2127`). Prise en main, présence, restitution et libération forcée se font chacune en une transaction (`2147-2289`). Chaque mise à jour vérifie qu'une ligne et une seule a été touchée (`2033`, `2064`, `2093`). Les contraintes `CHECK` sur les rôles et statuts sont en base (`0006`). Le motif de libération forcée est obligatoire en base (`0008:35-36`). |
| **GDS : revalidation des sessions HTTP** | **Contre-preuve** | Statut et rôle relus en base à chaque requête (`http.rs:877-896`). Le défaut est côté SSH (COMP-01). |
| **MCP : configuration venue d'un dépôt** | **Contre-preuve** | `mcp.json` vit dans `<app_data_dir>` (`mcp_config.rs:7, 162-169`), pas dans le projet : un dépôt cloné ne peut pas déclarer de serveur MCP. |
| **GDS-01** (administrateur au premier arrivé) | **Nuancé (non re-lu en détail)** | `gds-server/src/main.rs:376-379` crée l'administrateur initial à partir de la configuration (`BootstrapAdminDecision::Create`), ce qui réduit la fenêtre si le propriétaire s'en sert. Je n'ai pas vérifié si la route publique `setup` est alors fermée. |
| **ORC-01** (agents `readonly`) | **Toujours une H, indice supplémentaire** | La consigne de `run_agents` dit « Pilot refuses the launch » (`pilot-assistant-actions.ts:211`). Le refus est donc au lancement, côté interface, pas au niveau des outils. Traitement non lu. |

---

## (e) Corrections : sûres localement ou à décider avec Patrick

**Corrections locales sûres** (petites, faible risque de régression, testables) :
1. COMP-01 : filtre `status = 'active'` dans `stored_key_lines`, plus régénération juste après un changement de statut ou de rôle.
2. COMP-06 : `textContent` ou `esc()` aux trois endroits de `dashboard.js`, et échappement des `${e}` d'erreur.
3. COMP-07 : un rendu Markdown `html: false` pour l'historique et la revue (et les notes de mise à jour).
4. COMP-04 : validation de l'adresse et du mot de passe, propagation de l'erreur de hachage.
5. COMP-13 : écriture atomique de `mcp.json`, via la fonction commune proposée pour VLT-01.
6. COMP-14 : corriger le commentaire, ou ajouter le garde annoncé (voir le point 5 de la liste suivante).
7. COMP-12 : faire *échouer* ou *signaler explicitement* les tests de base quand PostgreSQL est absent en CI.

**Décisions à valider avec Patrick :**
1. **COMP-02** : modèle d'autorisation SSH (commande forcée ou hook), droit d'écriture des comptes `standard`, portage obligatoire pour `git push`, `git-shell` sur le poste dev.
2. **COMP-03** : quel rôle peut prendre la main sur un projet ?
3. **COMP-05** : faut-il garder la compatibilité « compte inconnu accepté », et les sessions `user_id == 0` ?
4. **COMP-08** : plafonds dans le Rust, tout en gardant la règle « l'écran ne commande plus le travail ».
5. **COMP-09 et AST-01** : vraie boîte de confirmation (effet sur l'ergonomie et sur le mode Vocal), restriction de `project` aux projets enregistrés, restriction des outils pi en discussion seule.
6. **COMP-10** : un groupe Telegram est-il un usage voulu ? Les messages modifiés doivent-ils compter ?
7. **XSS-01** (repris) : faut-il garder `html: true` en prévisualisation, et quelle CSP compatible avec KaTeX et Mermaid ?

---

## (f) Ce qui reste non couvert, et limites réelles

**Non lus du tout** (pour cibler la suite) :
- **Chaîne de livraison** : `.github/workflows/release.yml`, `quality-gate.yml`, `gds-server-image.yml` ; `scripts/create-release.js`, `gen-latest-json.js`, `latest-json-platforms.js`, `release-gates.js`, `detect-macos-gap.js`, `tauri.js`, `prepare-laya.js`, `prepare-laya-decision.js`, `gds-reload.js`, `build-mcp-extension.js`.
- **Patch vendor** : `src-tauri/vendor/whisper-rs-sys` et son `VENDOR-PATCH.md`.
- **Audio et dictée** : `vocal-*.js`, l'oreille intégrée Whisper, l'événement `asr-whisper-transcript`, `read-aloud.js` (seule la l. 1579 a été vue), `vocal-conversation.js` (seule la constante l. 155 a été vue).
- **Accessibilité** : rien.
- **GDS** : migrations 0001-0005 et 0007 ; `db.rs::migrate` (l. 215-250, verrou consultatif) ; synchronisation du suivi (`db.rs:978-1420`) ; `git.rs`, `git_cmd.rs`, `handover.rs` (règles pures), `rate.rs`, `audit.rs`, `service_control.rs` ; `gds-server/src/main.rs` hors recherches ; `src-tauri/src/gds_handover.rs` (le poste passe-t-il par HTTP ou par la base ?) ; `gds_sync.rs` hors l. 1042 ; montage de `GET /api/gds/handover/state` (public ou authentifié ?) ; fichiers Docker de l'image.
- **Délégations et questions** : `super-agent.js` l. 9925-10651 (traitement des sentinelles, validation de `project`) ; `pilot-assistant-delegation.ts`, `pilot-choices.ts`, `agent-choice-relay.js`, `pilot-edit-gate.ts`, `pilot-reserve-gate.ts`, `exclusivity-queue.js` ; `initAgentsBus` (reprise des sessions après démontage).
- **MCP** : `mcp-client.src.ts`, `pilot-mcp-client.ts`, `attach_mcp_secrets` (passage des secrets en variables d'environnement).
- **Telegram** : envoi, `telegram-dialog.js`, persistance du curseur, ce que devient un message entrant en aval.
- **Code Graph, mémoire, historique** : `code_graph.rs`, `code-graph-view.js` (hors deux lignes), `session_history.rs`, `pilot-assistant-session-memory.ts`, `pilot-assistant-db.ts`, `pilot-assistant-files.ts` (non relu).
- **Accès distant** : `web_server.rs` non relu (WEB-01 à 04 repris tels quels) ; listes de projets de `app.js` (l. 351-392).

**Limites réelles :**
- Aucun constat n'est confirmé par exécution. Les tests Vitest verts et le build réussi ne couvrent pas ces chemins, et le Rust n'a pas tourné.
- La partie SSH (COMP-01, COMP-02) dépend du déploiement réel (`sshd`, image du conteneur, hooks éventuels hors du code lu).
- L'exploitation de COMP-06 et COMP-07 repose sur la même hypothèse IPC que XSS-01, non exécutée.
- COMP-09 dépend du traitement côté interface, non lu : il pourrait contenir une confirmation que je n'ai pas vue. Ce serait alors une contre-preuve à vérifier en priorité dans `super-agent.js:10608-10651`.