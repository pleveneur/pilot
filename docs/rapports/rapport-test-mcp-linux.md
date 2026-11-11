# Rapport — test MCP en échec sur Linux seulement (CI v0.4.34)

Fichier fautif : `src-tauri/src/mcp_config.rs`,
`mcp_config::tests::remote_test_connection_works_end_to_end_without_leaking_the_key`
(ligne 1839). Échec CI signalé **ligne 1885** — cette ligne est exactement
`assert!(request.contains("\"method\":\"initialize\""), "requête: {}", request);`
(`src-tauri/src/mcp_config.rs:1885`). Le message d'échec imprimait la requête
brute : `POST /mcp`, `host: 127.0.0.1:36211`, corps
`{"id":2,"jsonrpc":"2.0","method":"tools/list","params":{}}` → c'est donc bien
**la requête `tools/list` qui a été reçue là où le test attendait le
`initialize`**.

## 1. Ce que fait le test (état avant correction)

1. `TcpListener::bind("127.0.0.1:0")` → port libre (`mcp_config.rs:1842`) ;
   l'écoute est **déjà active** au retour de `bind`.
2. Il démarre **DEUX** faux serveurs « une requête » sur le **même** listener,
   chacun dans son thread, via `listener.try_clone()` :
   - `mcp_config.rs:1856` → thread A = « handshake », dont le récepteur est
     gardé dans `sent` ;
   - `mcp_config.rs:1860` → thread B = « outils », dont le récepteur est jeté.
3. `test_remote_connection` (`mcp_config.rs:731`) envoie **deux POST successifs**
   (`initialize` id=1 puis `tools/list` id=2, tâche 309), chacun sur une
   connexion neuve (la réponse du faux serveur porte `connection: close`).
4. Le test lit `sent` (`mcp_config.rs:1868`) puis affirme
   `request.contains("\"method\":\"initialize\"")` (`mcp_config.rs:1885`).

## 2. Cause racine retenue (preuve fichier:ligne)

`serve_once_raw` (`mcp_config.rs:1768`) commence par
`listener.accept()` **sans aucun ordre imposé**. Deux threads sont en attente
d'acceptation simultanément sur le même port d'écoute. Quand le client ouvre la
connexion du `initialize`, **le noyau peut réveiller n'importe lequel des deux**
(tas d'attente `accept()` non FIFO, ordonnanceur). Si c'est le thread B
(« outils »), alors :

- la réponse du `initialize` est écrite par B (inoffensive : même corps JSON) ;
- le thread A accepte la **seconde** connexion, c'est-à-dire le `tools/list` ;
- `sent` (récepteur de A) livre donc `{"id":2,…"tools/list"…}` ;
- l'assertion `mcp_config.rs:1885` échoue en imprimant exactement la requête
  `tools/list` observée en CI.

C'est **un vrai défaut de déterminisme du test**, pas un défaut de production :
le test suppose que « thread créé en premier = connexion acceptée en premier »,
ce qu'aucune API ne garantit. L'ordre de réveil des deux `accept()` diffère
selon l'ordonnanceur : Windows réveille systématiquement le premier thread en
attente (d'où 5/5 verts en local), Linux non (d'où l'échec CI). Aléa
d'ordonnancement, pas aléa de port.

## 3. Pistes examinées et écartées (vérifiées, pas supposées)

| Piste | Verdict | Preuve |
|---|---|---|
| Course démarrage serveur / 1re requête | **écartée** | `TcpListener::bind` rend une socket **déjà en écoute** avant `serve_once` (`mcp_config.rs:1842`) ; le client ne peut pas arriver « trop tôt ». |
| Attente trop courte (`recv_timeout` 5 s) | **écartée** | L'attente n'expire pas : le test a reçu une requête et a échoué sur son **contenu** (`mcp_config.rs:1868` puis `:1885`). |
| Lecture d'une réponse partielle / bloquante | **écartée** | `response.text()` lit jusqu'à EOF ; le faux serveur envoie `content-length` (JSON) ou termine le flux puis `connection: close` (`mcp_config.rs:1808-1826`). |
| Fermeture de socket / keep-alive / `accept: text/event-stream` | **écartée** | Les deux réponses portent `connection: close` ; la branche SSE du test (phase 2) n'échoue pas — l'échec est en phase 1, JSON pur. |
| IPv6 vs `127.0.0.1` | **écartée** | Liaison et URL client sont toutes deux littéralement `127.0.0.1` (`:1842` et `:1843`) — aucune résolution de nom. |
| Résolution de nom / proxy d'environnement du runner | **écartée** | Aucun nom d'hôte (IP littérale) ; `reqwest` n'utilise pas `HTTP_PROXY` pour une adresse de boucle locale, et une éventuelle interception aurait produit une autre requête (autre `Host`, autre chemin) que celle imprimée. |
| **Deux threads concurrents dans `accept()` sur le même listener** | **RETENUE** | `mcp_config.rs:1768` (`accept()` sans ordre) + deux appels à `serve_once(try_clone)` `mcp_config.rs:1856` et `:1860` ; l'assertion `:1885` échoue sur la requête `tools/list`. |

Aucun défaut de production n'est révélé : `test_remote_connection` enchaîne
correctement `initialize` → `tools/list` sur deux connexions, et la clé ne
voyage que dans l'en-tête `authorization` (jamais dans l'URL ni le corps).

## 4. Autres serveurs locaux du dépôt (même schéma ?)

Recherche `try_clone()` sur un **listener** dans `src-tauri/src/` : seuls les
4 appels du test fautif (`mcp_config.rs:1857,1861,1891,1893`) clonent un
*listener*. Les autres faux serveurs HTTP du dépôt utilisent **une boucle
d'acceptation unique**
(`gds_service.rs:844` `fake_service` → `for stream in listener.incoming()`,
`gds_admin.rs:1265` `spawn_fake_server` → idem) : ordre d'arrivée naturellement
déterministe, **aucun risque du même genre**. Les autres usages de
`try_clone()` portent sur un **flux** déjà accepté (`gds_admin.rs:1273,1681`,
`gds_service.rs:851`), sans effet sur l'ordre.

Conclusion : un seul harnais est concerné, celui du test fautif. Aucun harnais
partagé à corriger.

## 5. Correction appliquée

Voir la section « Après correction » ci-dessous.

## 5 bis. Correction appliquée (détail)

Aucune modification de production : le défaut était **dans le harnais de test**.
Trois changements, tous dans `src-tauri/src/mcp_config.rs` (module `tests`) :

1. **Nouveau harnais ordonné `serve_in_order(listener, responses)`** : un SEUL
   thread accepte puis sert chaque connexion **avant** d'accepter la suivante,
   et rend les requêtes brutes **dans l'ordre d'arrivée** avec la réponse de même
   index. L'ordre `initialize` → `tools/list` n'est plus espéré, il est
   **imposé par construction**. Les deux appels concurrents
   `serve_once(listener.try_clone())` (anciennes lignes 1856/1860 et 1890/1892)
   sont supprimés : plus aucun `try_clone()` de listener dans le fichier.
2. **Lecture partagée `read_one_http_request`** (extraite de `serve_once_raw`,
   comportement identique) : une seule implémentation de la lecture
   en-têtes + corps `Content-Length`, utilisée par les deux harnais.
3. **Acceptation bornée, jamais bloquante** : l'écoute est passée en mode non
   bloquant et sondée jusqu'à `REQUEST_WAIT` (10 s). Ce délai ne conditionne
   aucune réussite — il garantit seulement que le `join()` du test rend la main
   (avec un message explicite « deux requêtes attendues…, reçues : … ») si le
   client ouvrait moins de connexions que prévu. Le socket accepté est
   explicitement remis en mode **bloquant** : Linux le rend bloquant, Windows et
   macOS peuvent hériter du mode non bloquant — c'est la seule différence de
   plateforme réellement rencontrée dans ce code, et elle est neutralisée.

Ce qui est **prouvé reste identique, et deux points sont renforcés** :

| Preuve | Avant | Après |
|---|---|---|
| Bout en bout JSON : `ok: true`, `protocolVersion`, pas de clé dans le résultat | oui | oui (inchangé) |
| Ligne de requête = `POST /mcp`, sans la clé | oui (sur la requête du thread A) | oui (sur la **1re** requête, ordre garanti) |
| En-tête `authorization: Bearer <clé>` présent | oui | oui |
| Corps sans la clé | oui | oui |
| 1re requête = `initialize` | espéré (aléatoire) | **garanti** |
| 2e requête = `tools/list` | non vérifié | **vérifié** |
| Flux SSE : `ok: true` + aucune clé | oui | oui |
| Sans clé : aucun en-tête `authorization` | sur 1 requête sur 2 | sur les **deux** |
| Serveur injoignable : `ok: false`, message masqué | oui | oui (inchangé) |

## 6. Vérifications exécutées

| Commande | Résultat |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib mcp_config::` | **34 passés**, 0 échec |
| Test corrigé relancé **7 fois de suite** (`--exact`) | **7/7 verts**, 2,05 s à chaque fois (aucun des deux `join()` n'a atteint le garde-fou) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` (complet) | **651 passés, 1 ignoré, 0 échec** ; aucun nouvel avertissement (seul le `sqlx-postgres` préexistant) |
| `npm test` | **2062 tests passés** (120 fichiers) |
| `npm run build` | OK (avertissements Vite préexistants : import dynamique/statique de `search-panel.js`, taille de chunk) |

### Anti-vacuité (mutations temporaires, puis restauration)

1. **Production cassée : en-tête `authorization` non envoyé** dans
   `build_remote_request` → test **ROUGE** :
   `mcp_config.rs:1951 panicked: en-tête d'authentification attendu: POST /mcp HTTP/1.1`.
2. **Production cassée : `tools/list` plus jamais demandé** (retour anticipé
   après le handshake) → test **ROUGE** :
   `mcp_config.rs:1939 panicked: deux requêtes attendues (handshake puis tools/list), reçues : ["…initialize…"]`
   (et le test rend la main au bout de 10 s, sans blocage).

Production restaurée à l'identique (`grep MUTATION` = 0 occurrence,
`git diff` = un seul fichier, `mcp_config.rs`).

### Linux : ce qui n'a pas pu être exécuté ici

Le poste de travail est Windows ; je n'ai pas de runner Linux localement. La
correction est **indépendante de la plateforme** par construction :

- elle ne dépend plus de l'ordre de réveil des threads dans `accept()` (il n'y a
  plus qu'un seul thread d'acceptation) ;
- elle ne fait aucune hypothèse de temporisation (le listener écoute dès
  `bind`, la connexion attend dans la file d'écoute jusqu'à l'acceptation) ;
- le seul point réellement dépendant de la plateforme (héritage du mode non
  bloquant sur le socket accepté) est **explicitement normalisé**
  (`sock.set_nonblocking(false)`), donc le comportement est le même sur Linux,
  Windows et macOS ;
- l'adressage reste littéralement `127.0.0.1` (aucune résolution de nom, ni
  IPv6, ni proxy).

La CI de la 0.4.35 sur `ubuntu-latest` sera la vérification finale.

## 7. Portée

Un seul fichier modifié : `src-tauri/src/mcp_config.rs` (module `tests` +
doc du faux serveur). Aucun autre test touché, aucun changement de production,
aucune modification de la CI. Les autres faux serveurs du dépôt
(`gds_service.rs:844`, `gds_admin.rs:1265`) utilisent une boucle d'acceptation
unique et ne présentent pas ce risque.
