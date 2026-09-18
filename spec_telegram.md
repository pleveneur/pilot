# Spécification — Passerelle Telegram (étape 1 : ENVOI + étape 2, lot 0 : SOCLE D'ÉCOUTE)

> **Statut : ✅ Implémenté.** Étape 1 (envoi) en v0.4.14 ; **étape 2, lot 0
> (socle d'écoute)** implémentée ensuite (branche `feat/telegram-etape2-lot0-ecoute`).
> Composant : `src-tauri/src/telegram.rs` (moteur d'envoi **et** de réception) +
> `src/js/desktop-notify.js` (branchement des avis sortants) + `src/js/telegram-inbound.js`
> (écoute au démarrage de l'application) + Paramètres ⚙️ → onglet **Assistant**.
>
> **Étape 1 = ENVOI.** Pilot prévient le propriétaire sur Telegram quand il a
> quelque chose à lui dire : fin de tâche d'un agent, anomalie d'agent bloqué,
> arrêt automatique d'une session.
> **Étape 2 = RÉCEPTION.** **Lot 0 (ce document)** : pilot livre le **socle** —
> Pilot lit les messages que le propriétaire écrit à son bot et les remet à la
> conversation de l'Assistant (porte durable existante). Le **branchement des
> questions de l'assistant** (répondre depuis Telegram, boutons de choix, dépôt
> d'une réponse sur Telegram) reste à faire dans un **lot suivant**.

<!-- HELP:telegram -->
## Aide utilisateur — Notifications Telegram

Pilot peut vous prévenir **sur Telegram** quand il a quelque chose à vous dire,
même si vous êtes loin de l'ordinateur :

- **fin de tâche d'un agent** (chat de l'agent π, tâche déléguée, run d'agents) ;
- **alerte d'anomalie** : un agent semble bloqué (actif sans progression) ;
- **arrêt automatique d'une session** (agent bloqué arrêté, verrou de run
  libéré).

**Réglage** : dans **Paramètres ⚙️ → onglet Assistant**, section
**« Notifications Telegram »** :

1. cochez **« Envoyer les avis sur Telegram »** ;
2. collez le **jeton du bot** (fourni par **@BotFather** dans Telegram) ;
3. indiquez l'**identifiant de discussion** qui recevra les avis (votre
   identifiant personnel, ou celui d'un groupe).

Pour obtenir ces deux valeurs : créez un bot auprès de **@BotFather**
(`/newbot`), puis envoyez un message à votre bot et récupérez votre identifiant
auprès de **@userinfobot** (ou de l'API `getUpdates`).

**Comportement quand c'est désactivé (par défaut)** : tant que l'interrupteur
est décoché **ou** qu'un des deux champs est vide, **rien n'est envoyé**,
Pilot ne contacte aucun serveur et **aucun message d'erreur** ne s'affiche.
Décocher le réglage suffit à tout arrêter.

**Détails utiles** :

- l'envoi se fait **en arrière-plan** : il ne ralentit ni ne bloque jamais
  Pilot ;
- si Telegram est injoignable (pas de réseau, jeton erroné), l'avis est
  simplement perdu — **cela n'interrompt jamais le travail en cours** et
  n'affiche aucune erreur ;
- ces avis sont **indépendants** des notifications natives (fenêtre Windows) :
  vous pouvez avoir l'un sans l'autre ;
- le jeton est conservé dans votre configuration locale et n'est utilisé que
  pour l'envoi ; il n'apparaît dans aucun journal.

⚠️ **La réception est partielle (lot 0)** : Pilot **lit désormais** ce que vous
écrivez à votre bot et le transmet à la conversation de l'Assistant (onglet 🧭),
qui peut donc tenir compte de votre message. En revanche, **Pilot ne répond pas
encore sur Telegram** : les réponses de l'Assistant restent dans Pilot. Un
message écrit par une **autre personne** que vous est **ignoré** (jamais de
réponse).
<!-- /HELP:telegram -->

---

## 1. Problème

Pilot notifie l'utilisateur localement (notifications natives Windows/OS, son,
bandeaux). Ces avis supposent que l'utilisateur soit devant la machine. Pour un
agent qui travaille longtemps (tâche déléguée, orchestration, run d'agents), il
est utile d'être prévenu **ailleurs** : Telegram est un canal simple (un bot
officiel, une API HTTP, aucun serveur à héberger).

## 2. Périmètre

**Dans le périmètre (étape 1, implémentée)** :
- envoyer un avis texte au propriétaire sur Telegram, depuis les points d'avis
  qui existent déjà dans Pilot ;
- un réglage explicite (interrupteur + jeton + identifiant de discussion),
  désactivé par défaut ;
- un comportement strictement inerte si le réglage est absent/partiel.

**Dans le périmètre (étape 2, lot 0, implémentée)** :
- **lire** les messages entrants (`getUpdates`, interrogation courte) et les
  remettre à la conversation de l'Assistant ;
- **filtrage strict** sur l'identifiant de discussion du propriétaire : tout
  autre expéditeur est ignoré **silencieusement**, sans jamais recevoir de
  réponse ;
- **curseur persistant** pour ne jamais retraiter deux fois le même message ;
- **inertie totale** quand la passerelle n'est pas configurée (aucun accès
  réseau, aucune erreur visible).

**Hors périmètre (étape 2, lot suivant)** :
- brancher les **questions de l'assistant** (répondre depuis Telegram, boutons
  de choix/confirmation, renvoi de la réponse sur Telegram) ;
- commandes entrantes, boutons Telegram, gestion multi-utilisateurs.

**Hors périmètre (à jamais)** : aucune dépendance nouvelle (le projet réutilise
`reqwest::blocking`, déjà présent), aucune modification des seuils d'inactivité,
aucun jeton écrit dans un journal ou un fichier de log.

## 3. Configuration

Trois champs dans `AppConfig` (`src-tauri/src/lib.rs`), tous `#[serde(default)]`
pour qu'un `config.json` ancien reste **inerte** (aucune migration requise) :

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `telegram_notify_enabled` | `bool` | `false` | Interrupteur principal. |
| `telegram_bot_token` | `String` | `""` | Jeton du bot (secret d'envoi). |
| `telegram_chat_id` | `String` | `""` | Discussion cible (personne ou groupe). |

- Les champs sont exposés par les commandes **existantes** `get_config` /
  `save_config` (aucune commande dédiée).
- `settings.js` **relit et réécrit** les trois clés (l'enregistrement des
  Paramètres envoie un `AppConfig` complet : une clé omise serait réinitialisée
  par `serde`), avec repli sur `currentConfig` si un champ manquait.
- Le jeton est saisi dans un champ **masqué** (`type=password`).
- Les trois réglages sont rangés dans **Paramètres ⚙️ → onglet « Assistant »**,
  section « Notifications Telegram » (l'onglet « Assistant » est le propriétaire
  du canal d'avis ; les identifiants DOM et les clés de configuration sont
  inchangés).
- Les réserves du lot 3-bis sont préservées : lecture non bloquante, jamais de
  réécriture de valeurs par défaut, annulation de l'ouverture de la modale si
  `get_config` échoue (réserve R-B). Une configuration non lisible ⇒ **aucun
  envoi** (`read_gateway_config` retourne `None`), jamais un envoi avec des
  valeurs par défaut.

## 4. Moteur d'envoi (`src-tauri/src/telegram.rs`)

```
TelegramConfig { enabled, token, chat_id }
  .inert_reason() -> Option<&'static str>   // désactivé / jeton vide / chat id vide
  .is_ready() -> bool
  .api_url() -> String                      // https://api.telegram.org/bot<token>/sendMessage

clean_text(text) -> String                  // purge des caractères de contrôle,
                                            // lignes vides compactées, borné à 3500 car.
redact_token(msg, token) -> String          // retire tout jeton d'un message d'erreur
dispatch(cfg, text, send) -> TelegramOutcome // cœur pur, envoyeur INJECTÉ
notify_background(app, text)                // thread détaché, fire-and-forget
telegram_notify(app, text)                  // commande Tauri appelée par l'interface
```

Règles de comportement :

1. **Inertie** : `dispatch` retourne `Inert(raison)` sans appeler l'envoyeur si
   la passerelle est désactivée, si le jeton est vide, si l'identifiant de
   discussion est vide, ou si le texte nettoyé est vide. `notify_background` ne
   lance **même pas** de thread dans ce cas (aucun réseau touché).
2. **Non-bloquant** : envoi dans un `std::thread` détaché, client
   `reqwest::blocking` à délais courts (connexion 2 s, total 5 s). L'interface
   n'attend jamais la réponse.
3. **Jamais d'erreur visible** : `telegram_notify` ne retourne rien ;
   côté interface l'appel est `invoke(...).catch(...)` non attendu. Un échec
   réseau/API ne remonte nulle part — au plus une ligne de journal.
4. **Secret** : le jeton vit dans l'URL `sendMessage`. Il n'est jamais
   journalisé, et `dispatch` applique `redact_token` au message d'erreur (le
   client HTTP est en plus appelé avec `without_url`, qui retire l'URL donc le
   jeton).
5. **Texte** : `clean_text` supprime `\r` et les caractères de contrôle,
   compacte les lignes vides, rogne les espaces, et tronque en **caractères**
   (jamais au milieu d'un caractère multi-octets) à `MAX_TEXT_CHARS` (3500).

### Résultat d'un envoi

```rust
enum TelegramOutcome { Inert(&'static str), Sent, Failed(String) }
```

Aucun variant ne peut contenir le jeton (`Failed` est nettoyé).

## 5. Branchement sur les avis existants

Aucune logique de notification n'est dupliquée : un seul point d'entrée côté
interface, `forwardToTelegram(title, body)` (`src/js/desktop-notify.js`),
appelé **en tête** des trois fonctions d'avis existantes :

| Fonction | Couvre |
|---|---|
| `notifyAgentDone` | fin de tâche d'un agent (chat local, tâche distante, timeout de run) |
| `notifySuperAgentDone` | événements importants de l'Assistant 🧭 (dont fin de run d'agents) |
| `notifyAnomaly` | anomalies, sessions silencieuses, **arrêt automatique** d'une session |

- L'appel est placé **avant** les filtres de notification native (réglage
  `notify_agent_done` / `notify_super_agent_done` / `anomaly_detection_enabled`,
  permission OS) : Telegram est un **canal indépendant**.
- `notifyAgentDoneFromRemote` délègue à `notifyAgentDone` → **un seul** envoi.
- Chaque événement ne traverse qu'**une** des trois fonctions : pas de doublon.
- **Aucun** envoi côté surveillance Rust (`anomaly.rs`) : le branchement unique
  côté interface évite les doubles envois et couvre tous les chemins d'avis.

## 6. Tests

- **Rust** (14 tests dans `telegram.rs`, `cargo test --lib`) — envoyeur
  **injecté**, aucun accès réseau :
  - inerte si désactivé / jeton vide / chat id vide / texte vide (l'envoyeur
    injecté panique s'il est appelé : prouve qu'aucun envoi n'a lieu) ;
  - actif → un avis de fin de tâche et une alerte sont transmis (URL, chat id,
    texte enregistrés par un faux envoyeur), texte nettoyé/rogné, valeurs de
    config rognées ;
  - `clean_text` : caractères de contrôle, lignes vides, Unicode/emoji intact,
    troncature sur frontière de caractère ;
  - sécurité : un échec ne divulgue jamais le jeton (`***`).
- **Interface** (`src/js/telegram-notify.test.js`, 13 tests) — `invoke` et le
  plugin de notification sont **mockés** : le branchement des trois avis, le
  non-doublon, l'avalement des échecs, la cohérence des réglages
  (moteur/HTML/settings.js) et la préservation de la réserve R-B.
- **Compte-test tracé** : branchement de `notifyAnomaly` retiré → 2 tests
  **rouges** (`expected [] to deeply equal [Array(1)]`), restauration → 13 tests
  **verts**, arbre de travail propre.

## 7. Aide intégrée

Bloc `<!-- HELP:telegram -->` ci-dessus, agrégé par `scripts/build-handbook.js`
(source ajoutée à la liste `SOURCES`) puis embarqué via `include_str!` :
l'onglet ❓ Aide répond donc sur les notifications Telegram. Le réglage associé
est rangé dans **Paramètres ⚙️ → onglet Assistant**.

## 8. Limites assumées

- **Réception partielle** : le socle d'écoute est livré (lot 0), mais
  l'assistant ne **répond pas encore** sur Telegram.
- Pas de bouton « Tester l'envoi » : un avis n'est émis que sur un événement
  réel. Le réglage est validé par la réception du prochain avis.
- Un avis perdu (hors ligne) n'est jamais rejoué : c'est un confort, pas un
  canal garanti.

## 9. Étape 2, lot 0 — socle d'écoute

### 9.1 Moteur de réception (`src-tauri/src/telegram.rs`)

```
TelegramConfig
  .api_updates_url(offset) -> String   // https://api.telegram.org/bot<token>/getUpdates?offset=…&timeout=0

InboundMessage { update_id, text }
InboundPoll { messages, next_offset, inert: Option<&'static str> }

collect_inbound(cfg, offset, response) -> InboundPoll   // cœur PUR (aucune I/O)
poll_inbound(cfg, offset, fetch)       -> Result<InboundPoll, String>  // transport INJECTÉ
http_get_updates(url)                  -> Result<Value, String>        // requête réelle

telegram_poll_inbound(app)             // commande Tauri : une passe (aucune persistance)
telegram_inbound_commit(app, offset)   // commande Tauri : valide le curseur (monotone)
```

Règles de comportement :

1. **Réception non bloquante** : `getUpdates` avec `timeout=0` (aucun long
   polling), délais courts (connexion 2 s / total 5 s), comme l'envoi.
2. **Filtrage par propriétaire** : `collect_inbound` ne retient que les updates
   dont l'identifiant de discussion est **exactement** celui de la configuration
   (`telegram_chat_id`, nombres et identifiants textuels `@canal` acceptés). Tout
   autre expéditeur est ignoré **silencieusement** : aucune erreur, **jamais de
   réponse**.
3. **Curseur** : le curseur avance jusqu'à `dernier update_id + 1`, y compris
   pour les updates des inconnus (sinon ils seraient relus à chaque passe). Il
   est rangé dans `<app_data_dir>/telegram_inbound_state.json` — **pas dans
   `AppConfig`** : aucun réglage ajouté, aucune modification des Paramètres.
4. **Inertie identique à l'envoi** : `poll_inbound` consulte `inert_reason()`
   (même champs, mêmes règles que l'envoi) et retourne `inert` **sans appeler le
   transport** si la passerelle est décochée, si le jeton est vide ou si
   l'identifiant de discussion est vide.
5. **Aucune erreur visible, aucun jeton exposé** : un échec réseau/API renvoie
   `{ status: "error" }` (une ligne de journal au plus) ; le jeton est retiré de
   tout message d'erreur (`redact_token`) et le client HTTP est appelé avec
   `without_url`.
6. **Aucun doublon, aucune perte** : `telegram_poll_inbound` **n'avance pas** le
   curseur ; l'interface appelle `telegram_inbound_commit(offset)` **après** la
   remise durable réussie de chaque message. Un message non remis est donc relu
   à la passe suivante (pas de perte) tandis que les messages déjà remis ne sont
   plus relus (pas de doublon). Le curseur est monotone.

### 9.2 Écoute côté interface (`src/js/telegram-inbound.js`)

- `createTelegramInbound({ invokeFn, deliver, intervalMs, timers })` :
  `start()` / `stop()` / `pollOnce()` (jamais deux passes concurrentes),
  dépendances **injectées** (testable sans réseau, sans Tauri, sans horloge).
- `initTelegramInbound()` : **idempotent**, appelé **au démarrage de
  l'application** (`main.js`), **indépendamment de l'onglet 🧭 Assistant**.
- Intervalle court (`TELEGRAM_INBOUND_INTERVAL_MS = 4000`).
- Chaque message reçu est remis par `injectExternalMessageToSuperAgent(text)`
  (`src/js/super-agent.js`) : **même porte durable que les comptes rendus
  d'agents** (`inject_session_summary` écrit la ligne en base avant toute
  tentative d'injection ; le rejeu Rust la délivre dès que l'assistant est
  libre). Aucun effet de bord sur les délégations.
- Message remis sous la forme `[Message Telegram de l'utilisateur] <texte>`.
- Tout échec est silencieux (journal au plus) : la réception ne perturbe jamais
  le reste de l'application.

### 9.3 Configuration

**Aucun nouveau réglage** : le lot 0 réutilise strictement les trois champs de
l'étape 1 (`telegram_notify_enabled`, `telegram_bot_token`, `telegram_chat_id`).
L'interface des Paramètres n'est **pas modifiée**.

### 9.4 Tests

- **Rust** (`telegram.rs`, transport injecté, aucun réseau) : message du
  propriétaire retenu / message d'un inconnu ignoré ; curseur qui évite le
  doublon (deux passes, la seconde ne renvoie rien) ; inertie totale quand la
  passerelle est décochée / jeton vide / chat id vide (le transport injecté
  panique s'il est appelé) ; un message d'erreur ne contient jamais le jeton.
- **Interface** (`src/js/telegram-inbound.test.js`, `invoke` et la remise
  mockés) : remise et validation du curseur, ordre des messages, curseur **non**
  validé si la remise échoue, échec de réception avalé, pas de passe
  concurrente, `start`/`stop` idempotents, `initTelegramInbound` démarre une
  seule instance.
