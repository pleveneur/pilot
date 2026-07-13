# Spécification — Accès distant web à Pilot (mode supervision/pilotage)

> Spécification fonctionnelle et technique de l'interface web distante de Pilot.
> Statut : 🟢 **Implémentée (v1)** — socle backend + UI web + panneau Paramètres desktop livrés. Voir §14 « État d'implémentation »
> pour le détail de ce qui est en place et ce qui reste (keep-alive tray, rate limiting, toast bind, audit log formel, édition web v2). Pour l'architecture globale, voir `AGENTS.md`.

---

## 1. Objectif

Permettre d'accéder à Pilot **depuis un navigateur distant** pour :
- **Consulter** le travail fait (arborescence + visionneuse de fichiers en lecture).
- **Sélectionner le modèle** utilisé par l'agent Pi.
- **Donner des instructions** à l'agent (chat + streaming).
- **Surveiller** l'activité en temps réel (pensées, outils, stats, statut).
- **Sélectionner un projet** sur lequel travailler (changement de projet à distance).

**Cible principale : un téléphone Android** (consultation/supervision/pilotage au pouce), avec usage secondaire sur le PC portable. Le déploiement repose sur un mesh **Tailscale déjà en place** entre le PC fixe (Pilot desktop), le portable et l'Android (voir §6).

Le mode web est un **sous-ensemble** de l'application desktop : orienté supervision et pilotage, **pas** édition lourde. Le desktop reste l'éditeur de référence (CodeMirror, terminal PTY, raccourcis, export PDF, drag & drop d'images, auto-complétion inline).

---

## 2. Architecture — Option A (serveur web embarqué)

Un serveur HTTP/WebSocket tourne **dans le même processus Tauri** que Pilot desktop et **partage l'état existant** (`AppState`, `RpcSession`, `AppConfig`). Une seule instance de `pi --mode rpc` est lancée, partagée par les deux interfaces.

```
            ┌─────────────────────────────────────────────────────────┐
            │  Processus Pilot (Tauri + Rust)                         │
            │                                                         │
 Navigateur │  ┌─────────────┐     ┌────────────────────┐            │
 distant ───▶│  │ Serveur axum│────▶│  rpc_manager.rs     │── stdin ──▶│ pi --mode rpc
  HTTP/WS   │  │ /api  /ws   │     │  (instance unique)  │◀─ stdout ──│
            │  └─────┬──────┘     └──────────┬──────────┘            │
            │        │ events                  │ fan-out events        │
            │  ┌─────▼──────┐            ┌─────▼──────────┐           │
            │  │ UI web     │            │ UI desktop (JS)│           │
            │  │ (lecture + │            │ CodeMirror...  │           │
            │  │  chat)     │            └────────────────┘           │
            │  └────────────┘                                         │
            └─────────────────────────────────────────────────────────┘
```

**Principe clé** : les événements RPC (`message_update`, `tool_execution_*`, `agent_end`, `model_change`…) sont émis vers un canal de **fan-out** central auquel s'abonnent (a) l'émetteur Tauri (frontend local) **et** (b) les WebSockets connectés. Une seule source de vérité, état parfaitement cohérent entre desktop et web.

### Stack
- **Backend** : `axum` sur runtime `tokio`, thread dédié (`std::thread::spawn`) dans le processus Tauri. Routes REST + WebSocket.
- **Frontend web** : page HTML/CSS/JS servie par axum (dossier `web/`), modules ES, **sans Vite/build**. Réutilise le thème dark/light et `markdown-it` (rendu). Highlight lecture : Shiki ou highlight.js.
- **Transport temps réel** : un WebSocket `/ws/agent` diffusant tous les événements RPC + les événements de projet (`project_changed`, `tree_changed`).

---

## 3. Sélection de projet (partagée)

Le projet courant est désormais une ressource **backend partagée**, pilotable depuis le desktop **ou** le web. Changer de projet depuis l'un se reflète dans l'autre.

### Comportement
- Changer de projet ⇒ (1) arrêter l'agent pi en cours, (2) mettre à jour `project_path` + `recent_projects`, (3) recharger le watcher `notify`, (4) relancer `pi --mode rpc` avec le nouveau cwd, (5) émettre `project_changed` à tous les clients (Tauri + WS).
- **Desktop** : le redémarrage de pi est implicite (cycle fermeture/ouverture de l'onglet Agent : `stop_agent_session` à la fermeture, `start_agent_session` à l'ouverture sur le nouveau cwd). `open_project_shared` ne redémarre pas pi (pas de double).
- **Web** : le handler `POST /api/project/open` redémarre pi après `open_project_shared` (via `do_stop_agent_session` + `do_start_agent_session`, uniquement si une session était active) — le web n'a pas de cycle d'onglet, le backend le centralise.
- **Resync distant** : le web écoute `project_changed` en WS et resync projet + fichiers + état agent (changement initié par le desktop ou un autre client). Le **desktop écoute `project_changed`** (Tauri) et resync la sidebar (via `refresh_tree`, qui ne réemmet pas l'événement → pas de boucle), le titre, les favoris et les alias de modèles ; il ne relance pas pi (déjà fait par le backend) ni ne ferme les onglets. Le changement initié par le desktop lui-même est ignoré (`window._pilotProjectPath` déjà à jour → pas de double resync).

### Sécurité du choix de projet
- **Liste des projets récents** : exposée depuis `AppConfig.recent_projects` (déjà persistée).
- **Navigation disque** : optionnelle et **limitée à une racine configurable** (whitelist de dossiers autorisés, par défaut le dossier parent des projets récents). Aucun parcours arbitraire du filesystem à distance (risque d'exposition de données sensibles).
- Le projet doit exister et être un dossier valide ; validation côté backend.

### Endpoints projet
| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/project` | Projet courant + liste des récents + racines autorisées |
| `POST` | `/api/project/open` | Ouvre un projet (body : `path`). Validation + cycle complet (stop pi, watcher, restart pi) |
| `GET` | `/api/project/browse?root=` | Liste le contenu d'un dossier autorisé (sous-dossiers uniquement) |
| `POST` | `/api/project/create` | Crée un nouveau dossier projet (body : `path`) puis l'ouvre |

---

## 4. API REST (authentifiée, préfixe `/api`)

Toutes les routes requièrent le header `Authorization: Bearer <token>` sauf `/api/auth/login` et les assets statiques.

### Auth
| Méthode | Route | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Échange un mot de passe contre un token de session opaque |

Le mot de passe est configuré dans les **Paramètres** du desktop. Aucun « token d'activation » : le serveur reste désactivé tant que le mot de passe est vide, et le login délivre directement le token de session.

### Fichiers (lecture seule distant)
| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/tree?path=` | Arborescence d'un dossier (réutilise la logique de `list_dir`) |
| `GET` | `/api/file?path=` | Contenu d'un fichier (réutilise `read_file_content`) |
| `PUT` | `/api/file` | Écrit le contenu d'un fichier existant (édition web v2, body : `path`, `content` ; max 5 Mo, refus binaire/readonly) |
| `POST` | `/api/file` | Crée un nouveau fichier (body : `path`, `content` ; `path` absolu dans le projet ou relatif au project root, max 5 Mo, refus binaire/readonly/existant) |
| `GET` | `/api/file/meta?path=` | Métadonnées (taille, encodage, type, modifiable) |

### Agent Pi (délègue aux commandes Tauri existantes)
| Méthode | Route | Délègue à (lib.rs) |
|---|---|---|
| `GET` | `/api/agent/state` | `get_agent_state` |
| `GET` | `/api/agent/messages` | `get_agent_messages` |
| `GET` | `/api/agent/stats` | `get_session_stats` |
| `GET` | `/api/models` | `list_agent_models` |
| `POST` | `/api/agent/prompt` | `send_agent_prompt` (body : `message`, `images?`) |
| `POST` | `/api/agent/abort` | `abort_agent` |
| `POST` | `/api/agent/new` | `new_agent_session` |
| `POST` | `/api/agent/compact` | `compact_agent_context` |
| `POST` | `/api/agent/model` | `set_agent_model` (body : `provider`, `modelId`) |

**Format des réponses pi** : les routes agent renvoient l'enveloppe brute de pi
`{ type, command, success, data }`. Le client web extrait `data` :
- `/api/agent/state` → `data.model = { provider, id }` (modèle courant) + `data.streaming`.
- `/api/models` → `data.models = [{ provider, id, label }]` (tableau d'objets plats).
Le sélecteur construit `value = "provider/id"` et le modèle courant est
`"${data.model.provider}/${data.model.id}"` (aligné sur `src/js/agent-pi.js`).

### Édition (hors v1 — futur)
| Méthode | Route | Description |
|---|---|---|
| `PUT` | `/api/file?path=` | **Non implémenté en v1.** Prévu en v2 (éditeur simple type Monaco/CodeMirror lite, désactivable). La v1 est en lecture seule côté web. |

### Messages agent — pagination
`GET /api/agent/messages` limite la réponse aux **200 derniers messages** ; paramètre `?offset=` optionnel pour récupérer l'historique plus ancien par pages. Le client web charge les messages **à la demande** (bouton/scroll), pas automatiquement au démarrage.

---

## 5. WebSocket `/ws/agent`

Connexion authentifiée (token en query string ou header). Diffuse **en temps réel** :

- Tous les événements RPC actuels (`message_start/update/end`, `thinking_*`, `tool_execution_*`, `text_*`, `toolcall_*`, `compaction_*`, `model_change`, `agent_start`, `agent_end`, `extension_ui_request`, `process_exit`).
- Événements projet : `project_changed` (path + récents), `tree_changed` (fichier modifié/ajouté/supprimé, réutilise les événements `file-change` du watcher).
- Reconnexion auto côté client (backoff exponentiel).

### Protocole de resynchronisation (mobile)
À chaque `onopen` du WebSocket (connexion initiale **et** chaque reconnexion), le client web fait 3 fetch REST pour rattraper l'état qu'il a manqué pendant la coupure :
1. `GET /api/agent/state` (statut, modèle courant, streaming actif ?)
2. `GET /api/models` (modèles dispo, pour le sélecteur)
3. `GET /api/project` (projet courant + récents)

Le WS ne diffuse ensuite que les **deltas**. Les **messages complets** (`GET /api/agent/messages`, paginé, voir §4) sont chargés **à la demande** (scroll vers le haut / bouton « charger l'historique »), pas au démarrage, pour épargner le mobile.

### Diffusion des prompts utilisateur (user_message)
pi n'émet pas d'événement « user message » en streaming. Le backend injecte donc un événement synthétique `user_message` (champs `text` + `source`) dans le canal de fan-out pour que **chaque interface voie les prompts tapés sur l'autre** :
- Prompt tapé sur le **desktop** (`send_agent_prompt`) → émet `user_message` (source `desktop`) dans le canal broadcast (WS/remote). Le desktop l'affiche déjà localement et n'écoute pas le broadcast → pas de doublon.
- Prompt tapé sur le **remote** (`POST /api/agent/prompt`) → émet `user_message` (source `remote`) dans le broadcast **et** via `emit("rpc-event")` pour le desktop (prompt distant). Le remote l'ignore via WS (déjà affiché localement avant l'envoi).

Les commandes slash (`/…`) sont exclues (commandes système, non affichées). Le client web n'affiche que les `user_message` dont `source !== "remote"` (anti-doublon). Le format de réponse de pi à `get_messages` est `{ data: { messages: [...] } }` (extrait côté backend pour la pagination).

Le frontend web reconstruit les blocs (message / pensées / outils) exactement comme `agent-pi.js` le fait côté desktop.

---

## 6. Sécurité & accès distant

### 6.1 Contexte de déploiement

Pilot desktop tourne sur le **PC fixe**, déjà connecté à **Tailscale** avec le PC portable et (cible principale) un **téléphone Android**. Tailscale fournit le réseau privé mesh chiffré (WireGuard), l'accès restreint aux appareils approuvés et le MagicDNS.

L'accès web est conçu **prioritairement pour le mobile** (consultation + supervision + pilotage au pouce), avec usage secondaire sur le PC portable.

### 6.2 Couche réseau / transport (assurée par Tailscale)

Tailscale joue le rôle de **première barrière** et de transport chiffré :

- Aucun port à ouvrir sur le routeur du fixe (Tailscale gère le trouage NAT + chiffrement WireGuard de bout en bout).
- Trafic déjà chiffré entre appareils → **TLS/HTTPS côté axum non requis** pour la confidentialité sur le réseau (mais optionnel via Tailscale Serve, voir 6.7).
- Accès restreint aux appareils du mesh (filtré par ACL Tailscale).
- **Bind par défaut `127.0.0.1`** (invisible depuis le réseau). Pour l'accès distant, bind sur l'**IP Tailscale du fixe** (ou `0.0.0.0` si l'ACL Tailscale suffit, mais IP Tailscale est plus propre et reste invisible sur le LAN local).
- L'app desktop **avertit visiblement** (toast au démarrage / après chaque reload) si le serveur écoute sur autre chose que `127.0.0.1` 🟢 implémenté (`maybeWarnBroadBind`, `toast.js`).

### 6.3 Modèle d'authentification — défense en profondeur

Tailscale est la **première** barrière, l'authentification applicative est la **seconde** (indispensable car un appareil du mesh — téléphone volé, malware — contournerait sinon toute la protection). Concrètement :

- **Mot de passe applicatif** défini dans les Paramètres desktop, stocké **hashé argon2** (jamais en clair). Une passphrase simple suffit (pas une usine à gaz) car le réseau filtre déjà ; l'objectif est d'empêcher l'accès sans consentement, pas de résister à un bruteforce Internet.
- **Token de session opaque** (validé, pas de JWT) : `rand(32 bytes)` encodé base64url, **sans signification intrinsèque**. Le serveur garde une `Mutex<HashMap<TokenHash, Session>>` **en mémoire vive** (on stocke le **hash** du token, pas le token brut → une fuite de la map ne permet pas de rejouer). À chaque requête : hash du token reçu → lookup → 401 si absent ou expiré. **Durée longue** (7-30 jours, défaut 168h) pour éviter de retaper le mot de passe au téléphone à chaque usage — acceptable car le token reste révocable à tout moment.
- **Révocation immédiate** (triviale avec un token opaque) : changer le mot de passe ou cliquer **kick remote** vide la map → tous les tokens invalidés net. Si le PC fixe redémarre, la map disparaît → tu retapes ta passphrase une fois sur le téléphone (souhaitable : aucun token persisté sur disque).
- **Expiration** gérée par un champ `expires_at` nettoyé paresseusement à chaque lookup (pas de tâche de fond).
- **Serveur désactivé par défaut** : aucun trafic accepté tant qu'aucun mot de passe n'est défini (refus du mot de passe vide).
- **Rate limiting** sur `/api/auth/login` (5 tentatives/min/IP) — garde-fou même sur le mesh. 🟢 implémenté (`web_rate::WebGuard`, fenêtre glissante par IP via `ConnectInfo`).
- **Pas de cookie en clair** : token en header `Authorization: Bearer`. Le WebSocket authentifie via query `?token=` (header non toujours utilisable en WS navigateur) → **filtre obligatoire** pour ne pas loguer le token.

### 6.4 Couche applicative — validation des entrées (la plus critique)

Tailscale ne protège pas contre les failles logiques ni contre un token volé. La validation applicative reste **obligatoire** :

**a) Path traversal (fichiers)** — risque de lecture de fichiers sensibles (`../../`, `C:\Users\autre\.ssh\id_rsa`, chemins UNC, symlinks sortants) :
- Tout `path` est **canonicalisé** (`std::fs::canonicalize`) puis **vérifié à l'intérieur du projet courant** (`starts_with(project_root)`) ou d'une racine whitelistée.
- Refus des chemins UNC (`\\server\share`) et des symlinks qui sortent (canonicalize résout les liens). Sur Windows, `canonicalize` ajoute le préfixe verbatim `\\?\` (chemin local étendu, **non** UNC) : `is_unc_path` le distingue de `\\server\share` et de `\\?\UNC\server\share` (UNC verbatim) pour ne pas refuser à tort les chemins canoniques locaux.
- Décodage des encodages (`%2e%2e`…) et refus des chemins absolus bruts non validés.

**b) Navigation projet** — `/api/project/browse` et `/api/project/open` limités aux `web_browse_roots` whitelist canonique. Aucun parcours arbitraire du filesystem.

**c) Agent Pi / prompt injection** — pi exécute des outils (bash, lecture/écriture) dans le cwd du projet :
- cwd = projet courant → pi n'a accès qu'au projet (sauf outils type bash qui peuvent aller plus loin ; limite du modèle).
- **Mode lecture seule** `web_readonly` désactive `POST /api/agent/prompt`, `/abort`, `/project/open`, `PUT /api/file` → consultation uniquement.
- **Audit log** de toute commande d'agent envoyée depuis le web (origine, timestamp). 🟢 implémenté — module `web_audit.rs` (ring buffer 500 entrées en mémoire **+ persistance disque append-only JSONL** dans `app_data_dir/web_audit.jsonl`) : login (IP + succès/échec), prompt, abort, new, compact, set_model, project_open/create, ws_open, kick, set_password, rate_limited, file_save/create/meta. Chaque entrée = { ts, ip, subject (token-key), action, detail, ok }. Au démarrage, l'historique disque est rechargé dans le ring buffer (les 500 dernières) ; rotation automatique à 2 Mo (garde les 1000 dernières lignes) ; `clear()` vide RAM **et** archive disque. Consultable depuis le desktop via la modale « Journal d'audit distant » (bouton dans la section Accès distant), avec compteur badge, refresh, effacer.

**d) Volume / DoS / crédits** — un script malicieux (même sur le téléphone) pourrait consommer tes crédits API :
- Taille max des prompts (100 Ko) et images uploadées.
- Rate limit sur `POST /api/agent/prompt` (10/min/token) 🟢 implémenté.
- Nombre de WebSockets simultanés par token (3) 🟢 implémenté (`ws_acquire`/`ws_release`). Clé = hash SHA-256 du token (jamais le token brut).

**e) Parsing / rendu** — entrées JSON validées par types Rust typés (`serde` + validation), pas de `Value` brut vers pi. Côté web : `markdown-it` avec `html: false` ou sanitizer DOMPurify pour bloquer le HTML/script injecté dans le markdown rendu.

### 6.5 Risques spécifiques à l'architecture partagée

- **Session pi partagée** : un token web volé voit toute la conversation et peut envoyer des prompts qui apparaissent aussi dans le desktop. → Loguer l'origine (web/desktop) de chaque prompt ; **badge desktop « client distant connecté »** (nombre de WS actifs) ; **bouton « kick remote »** pour déconnecter tous les clients web d'un clic.
- **Changement de projet à distance** = puissant (redirige toute la session pi) → désactivé en mode `web_readonly` ; whitelist racines ; log obligatoire.
- **Token volé** → rotation du mot de passe depuis le desktop invalide tout ; le transport chiffré Tailscale limite fortement le vol sur le réseau.

### 6.6 Surface d'attaque du serveur

- Dépendances auditées (`cargo audit`), axum/tokio/hyper à jour.
- **CORS** : restreint aux origines du serveur (pas de wildcard) ; idéalement désactivé (l'UI est servie par le même serveur).
- Headers de sécurité HTTP : `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (anti-clicjacking), `Content-Security-Policy` sur la page web (bloquer scripts/styles tiers, `connect-src` limité au serveur + ws du même hôte).
- **Logs** sans token en clair (filtre du `?token=`).

### 6.7 Déploiement Tailscale (pratique)

- **PC fixe** : Tailscale actif (déjà fait). Serveur axum bind sur l'IP Tailscale du fixe (ex : `100.x.y.z:8787`) ; mot de passe défini dans les Paramètres.
- **Téléphone Android / PC portable** : Tailscale actif, navigateur → `http://100.x.y.z:8787` ou MagicDNS `http://fixe:8787` ; login une fois, session persistée.
- **Option confort (Tailscale Serve)** : `tailscale serve --bg 8787` expose le port local en HTTPS sur un sous-domaine MagicDNS (`https://fixe.ts.net`) avec TLS automatique → accès par nom stable, sans connaître l'IP, et HTTPS de bout en bout jusqu'au téléphone. Bonus, pas une nécessité.
- **ACL à vérifier** (admin console Tailscale) : règle autorisant le trafic `portable → fixe:8787` et `android → fixe:8787`. Par défaut tout est autorisé entre ses propres appareils, à confirmer à l'implémentation.
- **Dépendance au mesh** : si Tailscale est down sur le fixe, l'accès web l'est aussi (acceptable, c'est volontaire).

### 6.8 Adaptations mobile (Android)

L'UI web cible le mobile en priorité. Conséquences sécurité/UX :
- **Pas de stockage de secret sensible côté navigateur** au-delà du token de session (jamais le mot de passe en clair).
- **Boutons assez grands** (44px min), pas de hover-only (tactile) → n'affecte pas la sécurité mais conditionne l'utilisabilité réelle.
- **Reconnexion WS auto** (backoff) indispensable : le mobile perd souvent le réseau (sommeil, 4G/Wi-Fi switch).
- **Authentification par biométrie** optionnelle côté navigateur (WebAuthn / passkey) : à envisager plus tard pour remplacer la passphrase sur le téléphone (confort + sécurité).

### 6.9 Récapitulatif des exigences de sécurité

1. Serveur **désactivé par défaut**, bind `127.0.0.1` par défaut, avertissement visuel si bind élargi.
2. Accès distant **via Tailscale** (déjà en place) — jamais port exposé en HTTP direct.
3. **Mot de passe applicatif obligatoire** (argon2, refuse vide) + token de session longue durée révocable.
4. **Rate limiting** login + prompts.
5. **Validation stricte des chemins** : canonicalize + `starts_with`, refus UNC et symlinks sortants.
6. **Whitelist des racines** pour la navigation projet.
7. **Mode lecture seule** `web_readonly` (prompt/abort/open/edit désactivés).
8. **Audit log** des actions sensibles avec origine web/desktop.
9. **Badge desktop « client distant connecté »** + bouton **kick remote**.
10. **Limites** : taille prompt/images, nombre WS par token, rate prompts.
11. **Dépendances auditées** (`cargo audit`), CORS restreint, headers + CSP sur la page web.
12. **Logs sans token** en clair.
13. **Mobile** : reconnexion WS auto, pas de secret au-delà du token, biométrie optionnelle plus tard.

### 6.10 Approche implémentation

La sécurité se construit **en même temps** que le serveur (chantier 1), pas après. Dès la première route : middleware auth + validation des chemins + tests volontaires de path traversal (`..%2f`, symlinks, UNC). Bind `127.0.0.1` dès le départ, n'élargir que Tailscale en place. La sécurité est une propriété structurelle, pas une finition.

---

## 7. Intégration backend

### `rpc_manager.rs` (refactor minimal)
- Remplacer l'émission directe `app.emit("rpc-event", ...)` par un **canal de fan-out** : `tokio::sync::broadcast` (ou un trait `EventSink`) auquel s'abonnent (a) l'émetteur Tauri, (b) les WebSockets.
- L'envoi de commandes (`send_command` / `send_command_sync`) reste inchangé ; la corrélation par commande évite les mélanges de réponses entre clients.

**Décision figée — fan-out parallèle (zéro régression desktop)** : on garde `app_handle.emit("rpc-event", value)` inchangé pour le desktop, et on pousse **en parallèle** le même `value` dans un `tokio::sync::broadcast::Sender<Value>`. `Sender::send` n'étant pas async, l'appel depuis le thread std de `read_jsonl_loop` est valide. Les WebSockets s'abonnent via `tx.subscribe()`. Capacité du canal : 256 (événements perdus si pas de subscriber ou lent → acceptable, le client resync au reconnect).

### `lib.rs`
- Démarrer le serveur axum dans le `setup` de Tauri (thread dédié + runtime tokio multi-thread).
- Exposer une fonction interne `open_project_shared(path)` centralisant le cycle de changement de projet (arrêt pi + watcher + restart). Appelée par la commande desktop **et** par la route `/api/project/open`.
- Commande Tauri `open_project_path` existante doit émettre `project_changed` (pour cohérence bidirectionnelle).
- Paramètres serveur ajoutés à `AppConfig` : `web_enabled`, `web_port`, `web_password_hash`, `web_readonly`, `web_browse_roots: Vec<String>`.

**Décision figée — extraction de la logique métier (décision 1, §13)** : chaque commande `#[tauri::command]` existante (prompt, abort, set_model, get_messages, etc.) est refactorisée en une **fonction libre** `fn do_xxx(state: &AppState, ...) -> Result<…>` contenant toute la logique. Le `#[tauri::command]` devient un wrapper fin qui récupère l'`AppState` (via `State::inner()` ou `app.state::<AppState>()`) et appelle la fonction libre. Le serveur axum obtient l'état partagé sous `Arc<Mutex<AppState>>` (les `Mutex` internes existants restent `std::sync`) et appelle les **mêmes** fonctions libres. Aucune duplication de logique.

**Décision figée — runtime async (décision 2, §13)** : les handlers axum sont `async fn`. Toute opération bloquante — lock d'un `std::sync::Mutex` sur `AppState`, appel à `send_command_sync` (timeout jusqu'à 30 s), lecture d'un gros fichier — est encapsulée dans `tokio::task::spawn_blocking`. **Interdiction absolue** de `.await` en tenant un lock `std::sync::Mutex`.

### Nouveaux fichiers
| Fichier | Rôle |
|---|---|
| `src-tauri/src/web_server.rs` | Serveur axum (routes REST + WS), auth, fan-out events |
| `src-tauri/src/web_auth.rs` | Hash mot de passe (argon2), génération token opaque, map sessions en mémoire, middleware |
| `web/index.html` | Point d'entrée UI web |
| `web/css/web.css` | Styles (réutilise variables thème dark/light) |
| `web/js/app.js` | Orchestration UI web |
| `web/js/chat.js` | Chat agent (écoute WS, rendu streaming) — transposition de `agent-pi.js` |
| `web/js/files.js` | Arborescence + visionneuse (fetch REST) |
| `web/js/projects.js` | Sélecteur de projet |

---

## 8. Concurrence & cycle de vie

- **Une seule session pi** : lancée par Pilot desktop au démarrage (ou au changement de projet). Le serveur web **ne lance pas** pi lui-même ; il consomme l'instance partagée.
- **Si fenêtre desktop fermée** : comportement piloté par `web_keep_alive` (décision 4, §13) :
  - `web_keep_alive = true` et `web_enabled` → l'app se **minimise en tray** (icône système) au lieu de quitter : le process Tauri reste vivant, le serveur web et la session pi restent actifs. Géré via `close_requested` + plugin tray Tauri.
  - `web_keep_alive = false` → fermer la fenêtre = quitter le process = couper le serveur web et pi.
  - (Rappel : le serveur web vit dans le process Tauri ; il ne peut pas survivre au process.)
- **Prompts concurrents** : pi sérialise sur stdin ; les corrélations `send_command_sync` garantissent un appairage correct des réponses. L'UI désactive le bouton "envoyer" pendant `agent_start`→`agent_end`.
- **Arrêt propre** : `stop_agent_session` existant ; le serveur web émet un `ws_close` aux clients lors de l'arrêt de l'app.

---

## 9. UI web — périmètre

| Module | État distant | Source réutilisée |
|---|---|---|
| Sélecteur de projet (récents + browse racines) | ✅ | `AppConfig.recent_projects` + nouveau browse |
| Arborescence (lecture) | ✅ | logique `list_dir` |
| Visionneuse Markdown | ✅ | `markdown-it` |
| Visionneuse code (highlight lecture) | ✅ | Shiki / highlight.js |
| Chat agent + streaming + pensées + outils | ✅ | transposition de `agent-pi.js` |
| Sélecteur de modèle + stats + statut | ✅ | `list_agent_models` / `get_session_stats` |
| Boutons abort / new / compact | ✅ | endpoints existants |
| Édition légère | ✅ v2 | `PUT /api/file` (édition) + `POST /api/file` (création, chemin relatif/absolu) ; textarea, max 5 Mo, refus binaire/readonly/existant |
| Dictée vocale (micro 🎙️) | ✅ | bouton `#prompt-mic` dans `#prompt-form`, Web Speech API — voir `spec_voice_input.md` |

> 🎙️ **Dictée vocale & secure context** : `SpeechRecognition` exige un *secure context*. En HTTP sur l'IP Tailscale le navigateur **bloque** le micro → accès via **Tailscale Serve (HTTPS)** obligatoire pour la dictée web. Détection `window.isSecureContext` : bouton désactivé + infobulle « requiert HTTPS » si non sécurisé. Détails : [`spec_voice_input.md`](./spec_voice_input.md).

---

## 10. Hors périmètre web (desktop uniquement)

Terminal PTY · édition CodeMirror avancée · auto-complétion IA inline · export PDF · drag & drop / Ctrl+V d'images · raccourcis clavier avancés · exécution de shell arbitraire · mode Orchestration (gardé desktop pour l'instant, pourra être exposé plus tard) · palette de commandes / outline / recherche globale. **Édition web (`PUT /api/file`) : ✅ v2 livrée** (textarea, fichiers existants uniquement, refus binaire/readonly, max 5 Mo, audit `file_save`).

---

## 11. Paramètres desktop ajoutés

| Paramètre | Type | Description |
|---|---|---|
| `web_enabled` | bool | Active le serveur web embarqué (défaut false) |
| `web_port` | u32 | Port d'écoute (défaut 8787) |
| `web_bind` | string | Hôte d'écoute (défaut `127.0.0.1` ; IP Tailscale pour accès distant) |
| `web_password` | string | Mot de passe distant (hashé argon2 en stockage, vide = serveur désactivé) |
| `web_token_ttl_hours` | u32 | Durée de validité du token de session (défaut 168 = 7 jours) |
| `web_readonly` | bool | Mode lecture seule (désactive édition + prompt + changement de projet) |
| `web_browse_roots` | Vec&lt;String&gt; | Dossiers racines autorisés pour la navigation projet (whitelist canonique). **Défaut vide** → calculé automatiquement = union canonique des répertoires parents des `recent_projects` (modifiable à la main) |
| `web_keep_alive` | bool | Si true & `web_enabled`, minimise l'app en tray au lieu de quitter à la fermeture de fenêtre (serveur web + pi restent actifs). Défaut false |
| `web_tailscale_serve` | bool | Si true & `web_enabled`, configure automatiquement Tailscale Serve (HTTPS 443 → `127.0.0.1:web_port`) et resync au changement de port. Exige `web_bind == 127.0.0.1`. Défaut false (opt-in, spec §14) |
| `web_kick_remote` | (action) | Déconnecte tous les clients web (bouton dans l'UI desktop) |

---

## 12. Plan d'implémentation (chantiers)

1. **Backend serveur** : `web_server.rs` + `web_auth.rs`, démarrage axum dans le `setup`, paramètres `AppConfig`.
2. **Fan-out d'événements** : refactor `rpc_manager.rs` (broadcast channel), abonnement Tauri + WS.
3. **API REST** : routes fichiers + agent + auth, délégation aux commandes existantes.
4. **Sélection de projet partagée** : `open_project_shared`, événement `project_changed`, browse racines.
5. **UI web** : `index.html` + `app.js` + `chat.js` + `files.js` + `projects.js`, thème, reconnexion WS.
6. **Sécurité & déploiement** : doc Tailscale/tunnel, mode lecture seule, tests concurrence.
7. **Documentation** : mise à jour `README.md` (section accès distant) et `AGENTS.md`.

Chaque chantier passe par le protocole **quality-gate** avant validation.

---

## 13. Décisions techniques figées

Décisions tranchées à l'analyse pour éviter tout blocage pendant le dev. Chaque choix est motivé ; les alternatives écartées sont notées.

### 13.1 Réutilisation de la logique existante depuis axum — **extraction**
Les commandes actuelles `#[tauri::command]` injectent `State<AppState>` + `AppHandle` et ne sont pas appelables depuis un handler axum. **Décision : extraction.** Chaque commande est refactorisée en une fonction libre `fn do_xxx(state: &AppState, …) -> Result<…>` contenant toute la logique métier ; le `#[tauri::command]` devient un wrapper qui récupère l'état et appelle la fonction libre ; le serveur axum obtient l'état partagé (`Arc<Mutex<AppState>>`, mutex internes conservés en `std::sync`) et appelle les **mêmes** fonctions libres. **Zéro duplication de logique.**
- *Alternative écartée* : invoquer les commandes Tauri depuis le backend — API non prévue pour ça, async bancal, contournement fragile.
- *Coût accepté* : chantier de refactor touchant les commandes agent ; encadré par le quality-gate pour garantir zéro régression.

### 13.2 Runtime async (tokio) vs `std::sync::Mutex` — **spawn_blocking**
`AppState` utilise `std::sync::Mutex` (et `send_command_sync` bloque jusqu'à 30 s). **Décision :** handlers axum `async fn` ; toute opération bloquante (lock `std::Mutex`, `send_command_sync`, lecture gros fichier) encapsulée dans `tokio::task::spawn_blocking`. **Interdiction absolue de `.await` en tenant un lock `std::sync::Mutex`.** Tauri 2 embarque déjà tokio, on réutilise le runtime ou un runtime dédié multi-thread.
- *Alternative écartée* : handlers sync purs d'axum — bloqueraient le threadpool sur des appels de 30 s.

- **13.3 Fan-out des événements RPC — broadcast parallèle à l'émission Tauri**
**Décision :** dans `read_jsonl_loop`, on garde `app_handle.emit("rpc-event", value)` **inchangé** pour le desktop (zéro régression) et on pousse en parallèle le même `value` dans un `tokio::sync::broadcast::Sender<Value>`. `Sender::send` n'est pas async → appel valide depuis le thread std. Les WebSockets s'abonnent via `tx.subscribe()`. Capacité canal 256 ; événements perdus si pas de subscriber ou client lent → acceptable (resync au reconnect, §5). Événements projet (`project_changed`, `tree_changed`) poussés dans le même canal.
- **Arrêt propre de pi (drain mode) :** à l'arrêt (`stop_session` passe `running=false`), les read-threads stdout/stderr ne sortent plus immédiatement mais **drainent** le pipe sans émettre, jusqu'à EOF (mort de pi après `kill`). Cela garde les pipes ouverts côté lecture tant que pi n'est pas mort → évite un `EPIPE: broken pipe, write` côté pi (node) qui crasherait bruyamment (notamment lors d'un redémarrage de pi par le web pendant que le desktop a l'onglet agent ouvert) et supprime le bruit stderr de fin de process.
- *Alternative écartée* : tout router via broadcast + un subscriber qui re-emit vers Tauri — une régression potentielle sur le path desktop, rejeté pour préserver l'existant intact.

### 13.4 `web_keep_alive` — **minimisation en tray**
Le serveur web vit dans le process Tauri ; il ne peut pas survivre au process. **Décision :** `web_keep_alive` contrôle la **minimisation en tray** (icône système) plutôt que l'arrêt, à la fermeture de la fenêtre desktop. Géré via gestionnaire `on_window_event` → `CloseRequested` (Tauri v2, feature `tray-icon`) + icône système `TrayIconBuilder`. Si true & `web_enabled` → `api.prevent_close()` + `window.hide()`, process vivant, serveur + pi actifs. Si false → fermer = quitter = couper le web. Le tray (menu « Afficher Pilot » / « Quitter Pilot », double-clic pour remonter) est créé/détruit par `sync_tray(app)` selon `web_enabled`, au setup et à chaque `reload_web_server`.
- *Statut* : 🟢 implémenté (chantier 1 terminé).

### 13.5 `web_browse_roots` par défaut — **union des parents des `recent_projects`**
**Décision :** si `web_browse_roots` est vide au démarrage du serveur, on calcule automatiquement l'ensemble des **répertoires parents** (canoniques) des `recent_projects` comme racines par défaut. L'utilisateur peut ajouter/retirer des racines à la main dans les Paramètres. Toute racine fournie est canonicalisée à l'enregistrement.
- *Raison* : évite un réglage manuel obligatoire tout en bornant l'exposition ; cohérent avec l'historique de l'utilisateur.

### 13.6 Images dans `/api/agent/prompt` — **base64 dans le JSON**
**Décision :** `images` en base64 dans le corps JSON (même format que le desktop `send_agent_prompt`). Pas de `multipart/form-data`. Limites : **2 Mo/image, 4 images max** par prompt. Validation côté backend (taille décodée).
- *Raison* : cohérence avec l'existant, un seul type de contenu, plus simple côté mobile.

### 13.7 Resynchronisation WebSocket — **fetch REST au `onopen`**
**Décision :** à chaque `onopen` du WS (connexion initiale **et** chaque reconnexion), le client web fait 3 fetch REST : `GET /api/agent/state`, `GET /api/models`, `GET /api/project`. Le WS ne diffuse ensuite que les **deltas**. Les messages complets (`GET /api/agent/messages`, paginé, §4) sont chargés **à la demande** (scroll/bouton), pas au démarrage.
- *Raison* : rattrape l'état manqué pendant une coupure mobile sans alourdir la connexion initiale.

### 13.8 Édition web — **hors scope v1**
**Décision :** `PUT /api/file` ✅ implémenté en v2 (édition de fichiers existants, textarea web). `web_readonly` désactive `prompt` + `open/create project` + `file_save` (lecture seule complet quand activé).
- *Raison* : réduit la surface d'attaque et le périmètre du chantier 5 ; l'édition à distance n'est pas un besoin prioritaire (tu édites sur le desktop).

### 13.9 Dépendances Cargo à ajouter (chantier 1)
`axum` (0.7), `tokio` (1, features `full`), `tower` + `tower-http` (ServeDir/headers/rate-limit), `tower-governor` (rate limiting), `argon2` (hash mot de passe), `uuid` (token opaque, feature `v4`). Assets `web/` servis via `include_dir` (embarqué dans le binaire, pas de fichiers externes au runtime) — **décision figée** plutôt que `ServeDir` disque, pour un packaging Tauri propre.
- *Compatibilité* : Tauri 2 + edition 2021, tokio déjà présent en interne.

## 14. État d'implémentation (v1)

Livré dans cette itération :

- **Backend** (`web_server.rs`, `web_auth.rs`) : serveur axum dans un thread dédié + runtime tokio multi-thread, démarré au `setup` Tauri si `web_enabled` et mot de passe défini.
- **Auth** : mot de passe hashé argon2, token opaque (32 o, base64url) stocké par son hash SHA-256, sessions en mémoire révocables (`set_web_password`, `web_kick_remote`, `web_active_count`, `web_has_password`). Middleware `Authorization: Bearer`.
- **Fan-out événements** : `broadcast::Sender<Value>` partagé (décision 13.3) ; emit Tauri inchangé + push parallèle.
- **Extraction fonctions libres** `do_*` (décision 13.1) pour les commandes agent ; handlers axum via `spawn_blocking` (décision 13.2).
- **Routes REST** : auth/login, agent (state/messages/stats/models/prompt/abort/new/compact/model), tree, file, project (info/open/browse).
- **WebSocket `/ws/agent`** : diffusion temps réel + resync au `onopen` (décision 13.7).
- **Validation chemins** : canonicalize + `starts_with`, refus UNC/symlinks sortants, whitelist `web_browse_roots` (défaut = parents des récents, décision 13.5).
- **Sécurité HTTP** : `X-Content-Type-Options: nosniff`, CSP via headers, assets embarqués (`include_dir`, packaging propre).
- **UI web** (`web/`) : login, chat streaming (texte/pensées/outils), sélecteur modèle, fichiers (arborescence + visionneuse), projets (récents + browse), reconnexion WS backoff, mini-rendu Markdown sécurisé.
- **Paramètres** : tous les champs `web_*` ajoutés à `AppConfig`.

Reste à faire (hors v1 livrée) :

- **UI Paramètres desktop** : panneau « 🌐 Accès distant » complet dans `settings.js` — activation, adresse (`web_bind`), port, lecture seule, durée de session, racines de parcours, keep-alive (actif). Boutons **Définir/effacer le mot de passe** (→ `set_web_password`), **Déconnecter tous** (→ `web_kick_remote`), indicateur de clients connectés (`web_status`). **Badge distant** `#remote-badge` dans la barre d'actions (polling 5 s via `web_status`, s'affiche seulement si `running`, clic → ouvre la modale).
- **Badge desktop « client distant connecté »** + bouton **kick remote** : branchés dans le panneau Paramètres et la barre d'actions (badge `#remote-badge`).
- **Rechargement à chaud** : commande `reload_web_server` + `web_server::restart_web_server` (arrêt gracieux via `oneshot` stocké dans `AppState.web_shutdown`, sleep 300 ms, relance). Le panneau Paramètres appelle `reload_web_server` après sauvegarde si `web_enabled`/`web_bind`/`web_port` ont changé ; `web_readonly`/`web_browse_roots`/`web_token_ttl_hours` sont lus à la volée par les handlers (pas de reload).
- **Toast d'avertissement** au démarrage si bind élargi 🟢 implémenté (`settings.js` `maybeWarnBroadBind` + `toast.js`, un toast par session de serveur via `warnedRemoteBind`, `web_status` expose `bind`/`port`).
- **`web_keep_alive`** (minimisation en tray, décision 13.4) : 🟢 implémenté — feature cargo `tray-icon`, gestionnaire `on_window_event`/`CloseRequested` (cache la fenêtre au lieu de quitter quand `web_keep_alive && web_enabled`), icône système `TrayIconBuilder` avec menu « Afficher » / « Quitter » + double-clic, `sync_tray(app)` au setup et au reload. Checkbox activé dans le panneau Paramètres.
- **Redémarrage de pi au changement de projet distant** : 🟢 implémenté — fonctions libres `do_start_agent_session` / `do_stop_agent_session` extraites ; le handler web `POST /api/project/open` redémarre pi sur le nouveau cwd (stop+start) si une session était active. Le web écoute `project_changed` en WS et resync projet + fichiers + état agent. Le desktop n'est pas impacté (son cycle fermeture/ouverture d'onglet Agent fait déjà le redémarrage).
- **Resync visuel desktop sur `project_changed` distant** : 🟢 implémenté — listener `project_changed` dans `main.js` → `Sidebar.resyncProjectFromRemote(path)` (recharge l'arborescence via `refresh_tree` sans réemettre l'événement, titre, favoris, alias modèles) ; ne relance pas pi (déjà fait par le backend) ni ne ferme les onglets. Le changement initié par le desktop est ignoré (pas de double resync). En complément, `process_exit` n'est plus émis pour les arrêts volontaires (redémarrage web) → le desktop n'affiche plus « Déconnecté ».
- **Rate limiting** login/prompts + nombre max de WS par token (spec 6.3/6.4) : 🟢 implémenté — module `web_rate.rs` (`WebGuard`, fenêtre glissante). Login 5/60s/IP (via `ConnectInfo<SocketAddr>`), prompt 10/60s/token (clé = hash SHA-256 du token injecté par `auth_middleware` via `AuthedToken`), WS max 3/token (`ws_acquire`/`ws_release`). Réponses `429 Too Many Requests` + `Retry-After`. Compteurs purgés au kick remote / changement de mot de passe (`reset_all`). L'UI web remonte le message serveur sur 429 (login + prompt).
- **Audit log** formel (origine, timestamp) : 🟢 implémenté — `web_audit.rs` (ring buffer 500 en mémoire **+ persistance disque append-only JSONL** `app_data_dir/web_audit.jsonl`, rechargé au démarrage, rotation 2 Mo → 1000 lignes, `clear()` vide RAM + disque), commandes desktop `web_audit_log(n)` / `web_audit_clear` / `web_audit_count`, modale desktop « Journal d'audit distant ». Instrumenté sur login/prompt/abort/new/compact/set_model/project_open/project_create/ws_open/kick/set_password/rate_limited/file_save/file_create/file_meta.
- **Pagination** `GET /api/agent/messages` (`?offset=`, 200 derniers, max 500) : 🟢 implémenté — réponse `{ messages, total, offset, limit, has_more }`, slicing côté Rust (pi renvoie tout, le backend ne transmet que la page). Client web : bouton « ⏫ Historique » charge la 1re page (200 récents), puis « Charger plus (N restants) » prepend les plus anciens par pages ; état cumulé dans `state.allLoadedMessages`, reset au logout / new session.
- **`/api/file/meta`** et **`POST /api/project/create`** : 🟢 implémentés. `file_meta` = { path, name, size, modified, is_dir, is_file, ext }. `project_create` crée un dossier dans une racine autorisée (parent existant, basename sans séparateur, anti path traversal via `parent_canon.join(basename)`) puis l'ouvre. UI web : bouton « ＋ Nouveau projet » dans la vue Projets → **modale** (select racine + input nom, validation inline, Entrée/Échap/clic-overlay) — remplace l'ancien `prompt()` numéroté peu pratique sur mobile.
- **Édition web** (`PUT /api/file`) : 🟢 implémenté (v2) — handler `file_save` (fichiers existants, `validate_within`, refus binaire/readonly, max 5 Mo, audit `file_save`). UI web : bouton « ✏️ Éditer » dans la visionneuse (textarea monospace + « 💾 Enregistrer » / « Annuler »).
- **Création de nouveaux fichiers** (`POST /api/file`) : 🟢 implémenté (v2) — handler `file_create` (body `path`, `content` ; `path` absolu dans le projet ou relatif au project root ; `validate_new_within` canonicalise le **parent** + `starts_with(root)` + refuse basename avec séparateur/UNC/existant/binaire/> 5 Mo ; audit `file_create`). UI web : bouton « 📄 Nouveau » dans la visionneuse (prompt chemin relatif, ex `notes.md` ou `sub/notes.md`), éditeur vide, « Enregistrer » fait POST puis bascule en mode édition (PUT ultérieurs), `loadFiles()` rafraîchit l'arborescence.
---

## 14. Automatisation Tailscale Serve (exposition HTTPS automatique)

### 14.1 Besoin

Éviter à l'utilisateur de taper manuellement `tailscale serve reset` + `tailscale serve --bg --https=443 http://127.0.0.1:<port>`, lui fournir l'adresse HTTPS prête à copier + un QR code pour les postes distants, et **resynchroniser automatiquement le proxy quand le port change** (sinon le proxy pointe vers l'ancien port et l'accès distant tombe sur une instance obsolète — bug observé).

### 14.2 Principe (opt-in, « Niveau 2 »)

- Nouveau champ config `web_tailscale_serve: bool` (défaut false). **Opt-in** : Pilot ne modifie jamais la config Tailscale Serve sans consentement explicite.
- Si coché **et** `web_enabled` **et** `web_bind == 127.0.0.1` : Pilot configure Tailscale Serve vers `http://127.0.0.1:<web_port>` (HTTPS 443 sur le tailnet) via `tailscale serve reset` puis `tailscale serve --bg --https=443 http://127.0.0.1:<port>`.
- **Resync automatique** : `sync_serve_if_enabled(app)` est appelée par `start_if_enabled` et `restart_web_server` → reconfigure le proxy si le port a changé (idempotent : ne reset pas si déjà configuré vers le bon port).
- Détection : `tailscale status --json` → `Self.DNSName` (nettoyé du `.` final) + `Self.TailscaleIPs` + `Self.Online`. L'URL exposée = `https://<dns_name>/` (stable, sans port car 443).
- Exige `web_bind == 127.0.0.1` (Tailscale Serve forward vers `127.0.0.1`) ; sinon avertissement côté UI, pas de configuration auto.

### 14.3 Commandes Tauri (Rust → frontend desktop)

| Commande | Retour | Rôle |
|---|---|---|
| `tailscale_status` | `{ available, dns_name, ip4, online, url, serve_configured, serve_target_port }` | Détection + URL + statut du proxy (lecture seule) |
| `tailscale_enable_serve` | `{ ok, url, serve_target_port }` / `Err` | Configure le proxy vers le port courant (reset + serve --bg) |
| `tailscale_disable_serve` | `()` / `Err` | `tailscale serve reset` |
| `tailscale_serve_qrcode(url)` | `String` (SVG) / `Err` | QR code SVG de l'URL (crate `qrcode`) |

### 14.4 UI desktop (Paramètres → Accès distant)

Nouveau bloc sous le keep-alive :
- Checkbox `setting-web-tailscale-serve` « Exposer en HTTPS automatique (Tailscale Serve) » — désactivée si Tailscale non détecté.
- Badge Tailscale : « ✓ actif (`<hostname>`) » / « ❌ non détecté ».
- Adresse `https://<dns_name>/` (champ readonly) + bouton **📋 Copier** + **QR code** (SVG injecté via `tailscale_serve_qrcode`).
- Statut serve : « configuré vers `<port>` ✓ » / « ⚠️ désynchronisé » / « non configuré ».
- Bouton **Reconfigurer maintenant** → `tailscale_enable_serve`.

### 14.5 Garde-fous

- **Opt-in** : ne modifie pas Tailscale Serve sans consentement.
- `find_binary` : cherche `tailscale`/`tailscale.exe` dans le PATH puis chemins connus (`C:\Program Files\Tailscale\`, `/usr/bin/`, `/usr/local/bin/`, macOS `.app`). Message clair si introuvable.
- **Idempotent** : `configure_serve` ne reset pas si `serve status` pointe déjà vers le bon port.
- Tailscale absent/inactif → message clair ; le serveur web HTTP direct reste fonctionnel (pas de panne de l'accès distant de base).
- QR généré côté backend (crate `qrcode` 0.14, SVG manuel via parcours des modules) → zéro dépendance frontend, pas de bundle web.
- Si `web_bind != 127.0.0.1` : pas de config auto + avertissement (le proxy forward vers `127.0.0.1`, injoignable sinon).

---

<!-- HELP:web-remote -->
## Accès distant (mode remote)

Pilot peut exposer une **interface web distante** pour consulter le travail,
discuter avec l'agent et dicter du texte depuis un téléphone ou un autre poste,
via le réseau privé **Tailscale** (WireGuard chiffré).

- **Activer** : Paramètres ⚙️ → « Accès distant » → activer l'accès web, définir
  un **mot de passe distant** (hashé argon2).
- **Adresse d'écoute** : `127.0.0.1` par défaut. Pour un accès HTTP direct sur
  le mesh, élargir à l'IP Tailscale (mais préférer Tailscale Serve, ci-dessous).
- **HTTPS automatique (Tailscale Serve)** : cocher « Exposer en HTTPS
  automatique » → Pilot configure le proxy HTTPS 443 → `127.0.0.1:port`,
  affiche l'**URL** `https://<nom-magicdns>.ts.net/` et un **QR code** à scanner.
  Le proxy se **resynchronise tout seul** quand tu changes de port.
  ⚠️ exige « Adresse d'écoute » = `127.0.0.1`.
- **Connexion** : depuis l'autre appareil (Tailscale installé), scanner le QR
  code ou ouvrir l'URL, se logger avec le mot de passe.
- **Lecture seule** : option « mode lecture seule » (consultation sans
  modification). **Keep-alive (tray)** : garder le serveur + l'agent pi actifs en
  arrière-plan après fermeture de la fenêtre.
<!-- /HELP:web-remote -->
