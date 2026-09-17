# Spécification — Passerelle Telegram (étape 1 : ENVOI seulement)

> **Statut : ✅ Implémenté (étape 1, v0.4.14).**
> Composant : `src-tauri/src/telegram.rs` (moteur d'envoi) + `src/js/desktop-notify.js`
> (branchement sur les avis existants) + Paramètres ⚙️ → onglet **Agent**.
>
> **Étape 1 = ENVOI uniquement.** Pilot prévient le propriétaire sur Telegram
> quand il a quelque chose à lui dire : fin de tâche d'un agent, anomalie d'agent
> bloqué, arrêt automatique d'une session.
> **La RÉCEPTION des messages (répondre à Pilot depuis Telegram, piloter Pilot
> par chat) n'est PAS prise en charge à cette étape** — elle fera l'objet d'une
> étape 2 distincte.

<!-- HELP:telegram -->
## Aide utilisateur — Notifications Telegram

Pilot peut vous prévenir **sur Telegram** quand il a quelque chose à vous dire,
même si vous êtes loin de l'ordinateur :

- **fin de tâche d'un agent** (chat de l'agent π, tâche déléguée, run d'agents) ;
- **alerte d'anomalie** : un agent semble bloqué (actif sans progression) ;
- **arrêt automatique d'une session** (agent bloqué arrêté, verrou de run
  libéré).

**Réglage** : dans **Paramètres ⚙️ → onglet Agent**, section
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

⚠️ **La réception des messages Telegram n'existe pas encore** : vous recevez les
avis de Pilot, mais **Pilot ne lit pas** ce que vous écrivez sur Telegram
(pas de réponse, pas de pilotage à distance par Telegram à ce stade).
<!-- /HELP:telegram -->

---

## 1. Problème

Pilot notifie l'utilisateur localement (notifications natives Windows/OS, son,
bandeaux). Ces avis supposent que l'utilisateur soit devant la machine. Pour un
agent qui travaille longtemps (tâche déléguée, orchestration, run d'agents), il
est utile d'être prévenu **ailleurs** : Telegram est un canal simple (un bot
officiel, une API HTTP, aucun serveur à héberger).

## 2. Périmètre

**Dans le périmètre (étape 1)** :
- envoyer un avis texte au propriétaire sur Telegram, depuis les points d'avis
  qui existent déjà dans Pilot ;
- un réglage explicite (interrupteur + jeton + identifiant de discussion),
  désactivé par défaut ;
- un comportement strictement inerte si le réglage est absent/partiel.

**Hors périmètre (étape 2, non implémentée)** :
- recevoir des messages (webhook/polling `getUpdates`), répondre, piloter Pilot
  depuis Telegram ;
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
l'onglet ❓ Aide répond donc sur les notifications Telegram.

## 8. Limites assumées

- Pas de réception (étape 2) : Pilot parle, il n'écoute pas.
- Pas de bouton « Tester l'envoi » : un avis n'est émis que sur un événement
  réel. Le réglage est validé par la réception du prochain avis.
- Un avis perdu (hors ligne) n'est jamais rejoué : c'est un confort, pas un
  canal garanti.
