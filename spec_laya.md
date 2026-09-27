# Spec — Service Laya (pilotage du service local de classification)

> Document de spécification — Statut : **✅ Marche 2 implémentée et testée**
> (branche `feat/laya-marche2`). Marche 2 = pilotage : démarrage, veille,
> arrêt, trace. Le **classement** lui-même est fait par le service, pas par Pilot.

## 1. Rôle

Le service Laya (`laya-service.mjs`, HTTP `127.0.0.1:3017`, lancé par `node`)
charge un modèle de classification (≈ 1,6 Gio en mémoire). Le module Rust
`src-tauri/src/laya.rs` ne classe rien : il **pilote ce service une seule fois
pour toute l'application** — un processus par session d'agent coûterait 1,6 Gio
par session. Patron repris de `plface.rs`, adapté aux différences du service.

## 2. Commandes exposées (noms exacts)

| Nom exact | Type | Rôle |
|---|---|---|
| `laya_status` | commande Tauri (lecture seule) | Rend `{configured, reachable, ready, outcome}` — aucune écriture, aucune modification du service |

Fonctions Rust internes (`laya::`) :

| Nom exact | Rôle |
|---|---|
| `launch_if_needed(enabled, service_path, model_dir, pid_path)` | Sonde, décide, lance, attend (≤ 3 s) |
| `stop_owned(pid_path)` | Referme **uniquement** le service tracé dans `pid_path` |
| `status(enabled, service_path, model_dir)` | Compose l'état (config + sonde live + dernière issue) |
| `set_outcome` / `last_outcome` | Mémorise / relit la dernière issue d'un contrôle de démarrage |
| `probe()` / `probe_status(host, port, timeout)` | `GET /status` (sonde < 1 s, timeout 400 ms) |
| `wait_until_reachable(deadline, interval)` | Attend une réponse sans jamais dépasser le délai |
| `spawn_detached(service_path, model_dir)` | `node <service> <dossier-modèle>`, détaché, sans console (Windows) |
| `looks_like_url`, `decide_launch`, `is_configured`, `status_ready` | Décisions et analyse **pures** (testables sans I/O) |

Réglages dans `config.json` (dossier de configuration de Pilot) :

| Réglage | Type | Défaut |
|---|---|---|
| `laya_autostart_enabled` | booléen | `false` (un utilisateur sans service Laya ne voit aucune différence) |
| `laya_service_path` | chaîne | vide = rien n'est lancé |
| `laya_model_dir` | chaîne | vide = rien n'est lancé (relatif au dossier du service, ou absolu) |

## 3. Fichiers et chemins

- **Service** : le fichier `laya-service.mjs` désigné par `laya_service_path` ;
  le répertoire courant du processus enfant est son dossier.
- **Modèle** : le dossier désigné par `laya_model_dir`, passé en argument au
  service ; c'est le service qui le charge (jamais Pilot).
- **Trace** : `<app_data_dir>/laya.pid` (dossier de données de l'application),
  deux lignes — identifiant du processus, nom du programme (`node.exe` sous
  Windows, `node` ailleurs). Constantes : `PID_FILE_NAME`, `LAYA_API_HOST`
  (`127.0.0.1`), `LAYA_API_PORT` (`3017`), `PROBE_TIMEOUT` (400 ms),
  `READY_DEADLINE` (3 s), `PROBE_INTERVAL` (200 ms).
- **État lu par le service** : `GET http://127.0.0.1:3017/status` →
  `{"ready":true|false,"model":"…"}` ; `ready:true` = modèle chargé.

## 4. Contrat

**Démarrage** (à l'ouverture de Pilot, dans un thread dédié : l'interface
n'attend jamais) :
1. nettoyage : `stop_owned` referme un service laissé en vie par un Pilot
   précédent (trace présente) ;
2. `launch_if_needed` : désactivé ou chemin vide → rien, en silence ; chemin en
   forme d'URL (`http://`, `hf://`…) → refusé (aucun téléchargement réseau) ;
   service qui répond déjà → **jamais doublé** ; fichier de service ou dossier de
   modèle absent → rien ; sinon lancement détaché, trace écrite, attente bornée
   à 3 s.

**Veille** : aucune surveillance périodique en marche 2. L'état est à la
demande (`laya_status`) ; la dernière issue (`outcome`) est mémorisée.

**Arrêt** (fermeture de Pilot) : `stop_owned` → arrêt du processus tracé (garde
de nom : jamais une autre application dont le pid serait réutilisé), trace
effacée. Un service **lancé à la main** par la personne n'est jamais tracé, donc
jamais refermé.

**Issues** (`LayaOutcome`, en `camelCase` dans le JSON) : `disabled`,
`invalidPath`, `alreadyRunning`, `launched`, `launchedNotReady`, `launchFailed`.
Toute erreur est silencieuse et non bloquante (fail-open).

## 5. Preuve par les tests

`cargo test --manifest-path src-tauri/Cargo.toml --lib` : 14 tests du module
`laya`, dont un test **réel** (`real_launch_trace_already_running_and_clean_stop`)
qui écrit un vrai service de test, le lance par `node`, vérifie la réponse
HTTP, lit la trace (`pid` + nom), constate qu'un second appel ne double pas le
service, puis l'arrête et constate la disparition du service et de la trace. Il
est sauté si `node` est absent, et réduit au seul « jamais doublé » si un
service tourne déjà sur le poste (le service réel n'est jamais perturbé).

## 6. Ce qui n'est PAS fait (assumé)

- **Pas de publication** : aucun push, tag, binaire ou paquet — code local à la
  branche `feat/laya-marche2`.
- **Pas de fusion** dans `main` ; aucune intégration par un autre module.
- **Pas de multi-plateforme testé** : seuls Windows (MSVC) a été exercé ; le
  garde de nom de processus (`node.exe` vs `node`) et les chemins sont prévus
  pour macOS/Linux, mais non testés ici.
- **Pas d'interface** : aucun onglet, bouton, réglage d'écran ni commande du
  frontend (marche 3) ; le réglage se fait dans `config.json`.
- **Pas de classement** : Pilot ne lit aucun document, ne décide d'aucune
  étiquette ; il ne pilote que le service.
- **Pas de surveillance périodique** ni de redémarrage automatique après crash
  (le service redémarre au prochain lancement de Pilot).
- **Limite connue** : le nom tracé est celui de l'interpréteur (`node.exe`), pas
  celui du script ; c'est le couple trace/pid qui garantit qu'on ne referme pas
  le service du propriétaire.
