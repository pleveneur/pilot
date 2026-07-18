# API du mode web-remote (Pilot)

Référence des endpoints HTTP et WebSocket exposés par le serveur web embarqué
de Pilot (mode distant). Source d'implémentation : `src-tauri/src/web_server.rs`.
Spécification complète : `spec_web_remote.md`.

## Conventions générales

- **Préfixe API** : toutes les routes REST sont sous `/api`.
- **Authentification** : header `Authorization: Bearer <token>` requis sur toutes
  les routes sauf `POST /api/auth/login` et les assets statiques.
- **Token** : opaque (32 octets, base64url), délivré par `/api/auth/login`,
  stocké côté serveur par son hash SHA-256, révocable, durée `web_token_ttl_hours`
  (défaut 168 h = 7 jours).
- **WebSocket** : authentification par query string `?token=<token>` (header non
  toujours utilisable en WS navigateur).
- **Mode lecture seule** (`web_readonly = true`) : désactive les routes
  mutantes (prompt, abort, new, project open/create, file save/create). Réponse
  `403 Forbidden` `{ "error": "Mode lecture seule : action désactivée" }`.
- **Rate limiting** :
  - `POST /api/auth/login` : 5 tentatives / 60 s / IP → `429` + `Retry-After: 60`.
  - `POST /api/agent/prompt` : 10 / 60 s / token → `429` + `Retry-After: 60`.
  - WebSocket : 3 connexions simultanées max par token.
- **Validation des chemins** : canonicalisation + `starts_with(project_root)` ou
  racine whitelistée ; refus UNC et symlinks sortants.
- **Format d'erreur** : `{ "error": "<message>" }` avec code HTTP approprié
  (`400`, `401`, `403`, `413`, `429`, `500`).
- **Audit log** : les actions sensibles sont journalisées (origine IP + sujet
  hash du token + action + détail + ok).

---

## Authentification

### `POST /api/auth/login`

Échange un mot de passe contre un token de session.

- **Body** : `{ "password": "<string>" }` (max 1024 car.)
- **200** : `{ "token": "<base64url>" }`
- **401** : `{ "error": "Identifiants invalides" }`
- **429** : trop de tentatives (rate limit login).

Le serveur reste désactivé tant qu'aucun mot de passe n'est défini
(`web_password_hash` vide).

---

## Agent Pi

### `GET /api/agent/state`

État courant de l'agent (modèle, streaming, statut). Délègue à `get_agent_state`.

- **200** : enveloppe pi `{ type, command, success, data }` avec
  `data.model = { provider, id }` et `data.streaming`.

### `GET /api/agent/messages`

Historique des messages (paginé, plus récents d'abord).

- **Query** :
  - `offset` (optionnel, défaut 0) : nombre de messages récents à skipper.
  - `limit` (optionnel, défaut 200, max 500) : taille de la page.
- **200** :
  ```json
  {
    "messages": [...],
    "total": 1234,
    "offset": 0,
    "limit": 200,
    "has_more": true
  }
  ```

### `GET /api/agent/stats`

Statistiques de session (tokens, coûts, durées). Délègue à `get_session_stats`.

### `GET /api/models`

Liste des modèles disponibles. Délègue à `list_agent_models`.

- **200** : enveloppe pi avec `data.models = [{ provider, id, label }, ...]`.
  Le sélecteur web construit `value = "provider/id"`.

### `POST /api/agent/prompt`

Envoie un prompt à l'agent. Délègue à `send_agent_prompt`.

- **Body** :
  ```json
  {
    "message": "<string>",
    "images": [{ "data": "<base64>" }, ...]
  }
  ```
  - `message` : max 100 Ko.
  - `images` : max 4, 2 Mo/image (base64 décodé).
  - Les commandes slash (`/…`) sont exclues de l'événement `user_message` diffusé.
- **200** : `{ "ok": true }`
- **403** : mode lecture seule.
- **413** : prompt ou image trop volumineux.
- **429** : rate limit prompt.

Injecte un événement synthétique `user_message` (`source: "remote"`) dans le
fan-out (WS) **et** via `emit("rpc-event")` pour le desktop, afin que chaque
interface voie les prompts tapés sur l'autre.

### `POST /api/agent/abort`

Interrompt la génération en cours. Délègue à `abort_agent`.

- **200** : `{ "ok": true }`
- **403** : mode lecture seule.

### `POST /api/agent/new`

Démarre une nouvelle session agent (vide l'historique). Délègue à `new_agent_session`.

- **200** : `{ "ok": true }`
- **403** : mode lecture seule.

### `POST /api/agent/compact`

Compacte le contexte de la session. Délègue à `compact_agent_context`.

- **200** : `{ "ok": true }`

### `POST /api/agent/model`

Change le modèle utilisé par l'agent. Délègue à `set_agent_model`.

- **Body** : `{ "provider": "<string>", "modelId": "<string>" }`
- **200** : `{ "ok": true }`

---

## Fichiers

### `GET /api/tree?path=<string>`

Arborescence d'un dossier (réutilise `build_tree` / `list_dir`).

- **Query** : `path` (optionnel, défaut = racine du projet courant).
- **200** : arborescence JSON (nœuds `FileNode`).
- **400** : chemin invalide ou hors projet.

### `GET /api/file?path=<string>`

Contenu d'un fichier texte (lecture).

- **200** : `{ "content": "<string>" }`
- **400** : fichier binaire (octet NUL détecté), hors projet, ou erreur UTF-8.

### `GET /api/file/meta?path=<string>`

Métadonnées d'un fichier (sans contenu).

- **200** :
  ```json
  {
    "path": "<canonique>",
    "name": "<string>",
    "size": 1234,
    "modified": 1700000000000,
    "is_dir": false,
    "is_file": true,
    "ext": "md"
  }
  ```
- **400** : chemin invalide ou hors projet.

### `PUT /api/file`

Écrit le contenu d'un fichier **existant** (édition web v2).

- **Body** : `{ "path": "<string>", "content": "<string>" }`
  - `content` : max 5 Mo, refus binaire (octet NUL).
  - `path` doit être dans le projet (validation `validate_within`).
- **200** : `{ "ok": true }`
- **400** : chemin invalide, dossier, binaire, ou erreur d'écriture.
- **403** : mode lecture seule.
- **413** : contenu > 5 Mo.

### `POST /api/file`

Crée un **nouveau** fichier (inexistant).

- **Body** : `{ "path": "<string>", "content": "<string>" }`
  - `path` : absolu dans le projet **ou** relatif au project root.
  - `content` : max 5 Mo, refus binaire.
  - Refus si le fichier existe déjà (utiliser `PUT` pour éditer).
  - Refus basename avec séparateur / `..` / `.` / UNC.
- **200** : `{ "ok": true, "path": "<canonique>" }`
- **400** : chemin invalide, existant, binaire, hors projet.
- **403** : mode lecture seule.
- **413** : contenu > 5 Mo.

---

## Projet

### `GET /api/project`

Projet courant + récents + racines autorisées + flag readonly.

- **200** :
  ```json
  {
    "current": "<path>",
    "recent": ["<path>", ...],
    "roots": ["<canonique>", ...],
    "readonly": false
  }
  ```
  - `roots` : whitelist `web_browse_roots` (ou union des parents des récents
    si vide, décision 13.5).

### `POST /api/project/open`

Ouvre un projet existant. Cycle complet : validation racine →
`open_project_shared` (arrêt pi + watcher + restart pi si session active) →
émission `project_changed`.

- **Body** : `{ "path": "<string>" }`
  - `path` doit être dans une racine autorisée (whitelist).
- **200** : arborescence JSON du nouveau projet (`FileNode`).
- **403** : mode lecture seule **ou** chemin hors racines autorisées.
- **500** : échec d'ouverture.

### `POST /api/project/create`

Crée un nouveau dossier projet dans une racine autorisée puis l'ouvre.

- **Body** : `{ "path": "<string>" }`
  - Le parent doit exister et être dans une racine.
  - Basename sans séparateur / `..` / `.` (anti path traversal).
  - Refus si le dossier existe déjà.
- **200** : arborescence JSON du projet créé.
- **400** : chemin invalide, UNC, existant, parent hors racines.
- **403** : mode lecture seule.

### `GET /api/project/browse?root=<string>`

Liste les sous-dossiers d'une racine autorisée (navigation projet, dossiers
uniquement).

- **Query** : `root` (chemin à lister, doit être dans une racine whitelistée).
- **200** : `{ "path": "<canonique>", "dirs": ["<path>", ...] }` (trié).
- **400** : racine invalide ou hors whitelist.

---

## WebSocket

### `GET /ws/agent?token=<token>`

Diffuse en temps réel tous les événements RPC et projet.

- **Auth** : `?token=<token>` (validé, refus `401` si invalide).
- **Limite** : 3 connexions simultanées par token (au-delà, fermeture immédiate).
- **Reconnexion** : backoff exponentiel côté client.

#### Événements diffusés

- **RPC** : `message_start` / `message_update` / `message_end`,
  `thinking_*`, `tool_execution_*`, `text_*`, `toolcall_*`, `compaction_*`,
  `model_change`, `agent_start`, `agent_end`, `extension_ui_request`,
  `process_exit`.
- **Projet** : `project_changed` (`{ path, recent }`),
  `tree_changed` (fichier modifié/ajouté/supprimé, issu du watcher `notify`).
- **Synthétique** : `user_message` (`{ text, source }`, `source = "desktop"` ou
  `"remote"`) — prompt tapé sur l'une des interfaces, diffusé à l'autre.

#### Protocole de resynchronisation

À chaque `onopen` (connexion initiale **et** reconnexion), le client web fait
3 fetch REST pour rattraper l'état manqué :

1. `GET /api/agent/state` (statut, modèle, streaming)
2. `GET /api/models` (modèles disponibles)
3. `GET /api/project` (projet courant + récents)

Le WS ne diffuse ensuite que les **deltas**. Les messages complets sont chargés
**à la demande** via `GET /api/agent/messages` (pagination).

---

## Assets statiques

Le serveur sert l'UI web (dossier `web/`) embarquée dans le binaire via
`include_dir`. Toute route non API/WS retombe sur le fallback statique
(`index.html` si racine, sinon le fichier demandé).

- **Headers de sécurité** : `X-Content-Type-Options: nosniff`, CSP via headers.
- **404** : fichier statique introuvable.

---

## Codes de statut récapitulatifs

| Code | Cas |
|---|---|
| `200` | Succès. |
| `400` | Requête invalide (chemin, binaire, existant, validation). |
| `401` | Non authentifié (token manquant/invalide/expiré). |
| `403` | Mode lecture seule ou hors racines autorisées. |
| `413` | Payload trop volumineux (prompt > 100 Ko, image > 2 Mo, fichier > 5 Mo). |
| `429` | Rate limit dépassé (login ou prompt) + header `Retry-After: 60`. |
| `500` | Erreur interne (pi, I/O, canonicalisation). |