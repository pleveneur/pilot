# Spec — Service Laya (pilotage du service local de classification)

> Document de spécification — Statut : **✅ Marche 4 implémentée et testée**
> (branche `feat/laya-marche2`). Marche 2 = pilotage : démarrage, veille,
> arrêt, trace. Marche 3 = interface : onglet « Service Laya » dans les
> Réglages. Marche 4 = **modèle géré par Pilot** : téléchargement automatique
> au démarrage (si la case est cochée et le modèle absent) et bouton de
> téléchargement manuel. Le **classement** lui-même est fait par le service,
> pas par Pilot.

---

<!-- HELP:laya -->
## Service Laya (classification locale)

Le **service Laya** est un classement automatique local qui tourne sur votre
ordinateur. Pilot ne classe rien lui-même : il se contente de **lancer et
surveiller** ce service, une seule fois pour toute l'application (le service
garde un gros modèle en mémoire, en lancer plusieurs épuiserait la machine).

Réglages disponibles dans **Paramètres → Service Laya** :

- **Lancer le service Laya au démarrage** : si activé, Pilot démarre le service
  à son ouverture, uniquement s'il ne répond pas déjà. Sans effet si le service
  n'est pas installé.
- **Programme du service** : le fichier `laya-service.mjs`. Laissez vide pour ne
  rien lancer.
- **Dossier du modèle à charger** : le dossier contenant le modèle de
  classification. C'est le service qui le charge, pas Pilot. Laissez vide pour
  utiliser le dossier habituel (`model-ml`, à côté du service).

**Téléchargement du modèle** : Pilot peut récupérer le modèle lui-même, sans
que vous ayez de commande à taper.

- **Télécharger le modèle automatiquement s'il manque** : à l'ouverture de
  Pilot, si le modèle est incomplet, il est d'abord téléchargé, puis le service
  est lancé. Rien n'est téléchargé si le modèle est déjà complet.
- **Télécharger le modèle maintenant** : lance le téléchargement tout de suite,
  même hors démarrage. Une barre indique l'avancement.
- **Interrompre** : arrête le téléchargement en cours. La reprise continuera au
  même endroit plus tard (aucun octet déjà récupéré n'est perdu).
- **Adresse d'hébergement des fichiers du modèle** : l'adresse où les fichiers
  sont publiés. Tant qu'elle n'est pas renseignée, Pilot affiche clairement
  qu'elle manque et ne tente rien (aucune erreur, aucun plantage).
- **Programme de téléchargement du modèle** : le fichier `laya-fetch.mjs`.
  Laissez vide pour qu'il soit cherché à côté du service.

**Lire l'indicateur d'état** : sous les deux champs, une ligne vous dit où en
est le service — « arrêté », « en cours de chargement du modèle… », « prêt »,
 ou « non configuré » tant que les réglages sont incomplets. Un service lancé à
la main n'est jamais arrêté par Pilot ; seul le service que Pilot a démarré est
refermé à la fermeture.

Sous les réglages du modèle, une autre ligne indique l'état du **modèle** :
« prêt », « absent », « téléchargement… n % », « interrompu », « adresse
manquante »… Tous ces messages sont en langage courant (jamais de chemin ni de
nom de fichier technique).

Enregistrez vos réglages avec le bouton **Enregistrer** de la fenêtre des
Paramètres. Les valeurs sont conservées d'une ouverture à l'autre.
<!-- /HELP:laya -->

---

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
| `laya_model_state` | commande Tauri (lecture seule) | Rend `ModelState` : dossier du modèle, présence des fichiers, téléchargement en cours, pourcentage, dernière raison d'échec |
| `laya_model_download(base_url, fetch_path)` | commande Tauri | Lance le téléchargement en arrière-plan ; rend `started` ou `alreadyRunning` (jamais deux téléchargements à la fois) |
| `laya_model_cancel` | commande Tauri | Interrompt le téléchargement tracé ; rend `true` si un téléchargement a bien été arrêté ; **conserve** les fichiers partiels |

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

Fonctions Rust internes du modèle (`laya_model::`, `laya_download::`) :

| Nom exact | Rôle |
|---|---|
| `resolve_model_dir`, `resolve_fetch_path`, `manifest_path` | Chemins **purs** (défauts : `model-ml`, `laya-fetch.mjs`, `model-manifest.json`) |
| `decide_model_action(present, enabled, downloading)` | Décision pure : `nothing` / `download` / `alreadyRunning` |
| `fetch_exit_reason(code)` | Traduit le code de sortie (0→`ok`, 1→`networkOffline`, 2→`invalidAddress`, 3→`diskFull`, 4→`integrityFailed`) |
| `percent(current, total)`, `effective_base_url`, `is_placeholder_base` | Pourcentage borné, adresse effective, détection du marqueur `A_CHOISIR` |
| `parse_manifest`, `read_manifest` | Lecture du manifeste (ne **rate jamais** : repli sur les 4 noms connus) |
| `run` / `download_blocking` / `start_background` / `cancel` | Exécution de `node <fetch> <manifeste> <dossier> [--base <url>]`, version bloquante (démarrage), version fil (bouton), interruption |
| `model_dir_has_all`, `model_state`, `is_downloading` | Vérification de complétude (un fichier partiel `.part` n'est **jamais** valide), état, garde anti-double |

Réglages dans `config.json` (dossier de configuration de Pilot) :

| Réglage | Type | Défaut |
|---|---|---|
| `laya_autostart_enabled` | booléen | `false` (un utilisateur sans service Laya ne voit aucune différence) |
| `laya_service_path` | chaîne | vide = rien n'est lancé |
| `laya_model_dir` | chaîne | vide = `<dossier du service>/model-ml` (relatif au dossier du service, ou absolu) |
| `laya_model_auto_download_enabled` | booléen | `false` (aucun téléchargement réseau sans action explicite) |
| `laya_model_base_url` | chaîne | vide = adresse non renseignée (état clair, aucun essai) ; l'adresse du manifeste sert de repli |
| `laya_fetch_path` | chaîne | vide = `laya-fetch.mjs` cherché à côté du service |

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
- **Téléchargement** : le programme `laya-fetch.mjs` (jamais modifié par Pilot)
  reçoit `node <fetch> <manifeste> <dossier> [--base <adresse>]` et écrit
  `<nom>.part` puis renomme ; c'est ce qui rend la reprise possible. Le
  manifeste (`model-manifest.json`) porte l'adresse de repli et la taille de
  chaque fichier. Trace du téléchargement : `<app_data_dir>/laya-fetch.pid`
  (même mécanisme de garde de nom que le service).
- **Progression** : Pilot ne modifie pas le programme de téléchargement ; il
  compare simplement la taille des fichiers `.part` à celle annoncée par le
  manifeste (toutes les 400 ms) et émet `laya-download-progress`
  (`{file, done, total, bytes, bytesTotal, percent}`) + `laya-download-log`
  (dernières lignes, taille bornée à 400 lignes).
- **État lu par le service** : `GET http://127.0.0.1:3017/status` →
  `{"ready":true|false,"model":"…"}` ; `ready:true` = modèle chargé.

## 4. Contrat

**Démarrage** (à l'ouverture de Pilot, dans un thread dédié : l'interface
n'attend jamais) :
1. nettoyage : `stop_owned` referme un service laissé en vie par un Pilot
   précédent (trace présente) ;
2. **modèle** : le dossier du modèle est résolu ; si la case « télécharger
   automatiquement » est cochée **et** qu'il manque des fichiers **et** qu'aucun
   téléchargement n'est déjà en cours, le téléchargement démarre et est attendu
   (thread bloquant) ; la complétude est **revérifiée après** ;
3. `launch_if_needed` : désactivé ou chemin vide → rien, en silence ; chemin en
   forme d'URL (`http://`, `hf://`…) → refusé (aucun téléchargement réseau) ;
   service qui répond déjà → **jamais doublé** ; fichier de service ou dossier de
   modèle absent → rien ; sinon lancement détaché, trace écrite, attente bornée
   à 3 s.

**Jamais de service sur un modèle incomplet** : si le modèle n'est pas complet
après l'étape 2 (téléchargement refusé, échoué, adresse manquante, interrompu),
le service n'est **pas** lancé et l'issue enregistrée est `invalidPath` — un
dossier ne contenant qu'un `.part` ne lance donc jamais le service.

**Veille** : aucune surveillance périodique en marche 2. L'état est à la
demande (`laya_status`) ; la dernière issue (`outcome`) est mémorisée.

**Arrêt** (fermeture de Pilot) : `stop_owned` → arrêt du processus tracé (garde
de nom : jamais une autre application dont le pid serait réutilisé), trace
effacée. Un service **lancé à la main** par la personne n'est jamais tracé, donc
jamais refermé.

**Issues** (`LayaOutcome`, en `camelCase` dans le JSON) : `disabled`,
`invalidPath`, `alreadyRunning`, `launched`, `launchedNotReady`, `launchFailed`.
Toute erreur est silencieuse et non bloquante (fail-open).

**Raisons d'échec du modèle** (`FetchReason`, `camelCase`) : `ok`,
`networkOffline`, `invalidAddress`, `diskFull`, `integrityFailed`,
`addressMissing` (adresse non renseignée : refus **avant** tout lancement),
`fetchMissing` (programme absent), `nodeMissing` (Node introuvable),
`cancelled`, `alreadyRunning`, `unknown`. Jamais de code brut affiché à
l'utilisateur : chaque raison a un message en langage courant.

**Garde anti-double** : un seul téléchargement à la fois pour toute
l'application (drapeau global) ; un second appel est refusé poliment
(`alreadyRunning`) au lieu de lancer un second `node`.

## 5. Preuve par les tests

`cargo test --manifest-path src-tauri/Cargo.toml --lib laya` : **28 tests** des
modules `laya`, `laya_model` et `laya_download`. Tests **réels** notables :

- `real_launch_trace_already_running_and_clean_stop` (marche 2) : écrit un vrai
  service de test, le lance par `node`, vérifie la réponse HTTP, lit la trace,
  constate qu'un second appel ne double pas le service, puis l'arrête.
- `real_download_orchestration_without_network_or_real_model` (marche 4) :
  orchestration **complète** du téléchargement avec de **faux programmes de
  téléchargement** écrits dans un dossier temporaire — aucun accès réseau,
  aucun vrai modèle. Cinq cas couverts : succès, intégrité en échec (code 4),
  interruption qui **conserve** le `.part`, refus du double lancement, refus
  « adresse non renseignée ».
- `model_state_reports_missing_files_without_final_file` : un `.part` n'est
  jamais compté comme fichier final.

Les deux tests réels sont sautés si `node` est absent du poste.

## 6. Interface (marche 3, étendue en marche 4)

Onglet **« Service Laya »** de la fenêtre des Paramètres, calqué sur le bloc
Avatar (PLface) :

- `index.html` — entrée d'onglet (`data-settings-tab="laya"`) et panneau
  (`data-settings-panel="laya"`) : case `setting-laya-autostart`, champ
  `setting-laya-service-path` + `btn-laya-service-browse`, champ
  `setting-laya-model-dir` + `btn-laya-model-browse`, indicateur
  `laya-runtime-state`, zone de message `laya-message`. Marche 4 : case
  `setting-laya-model-auto-download`, champ `setting-laya-model-base-url`,
  champ `setting-laya-fetch-path` + `btn-laya-fetch-browse`, boutons
  `btn-laya-model-download` / `btn-laya-model-cancel`, barre `laya-model-bar`,
  indicateur `laya-model-state`, message `laya-model-message`.
- `src/js/laya-utils.js` — fonctions pures `layaStatusMessage(status)`,
  `layaOutcomeMessage(outcome)`, `layaModelStateMessage(state)` (rend
  `{text, kind}`) et `layaModelProgressPercent(state)` (borné 0..100), plus la
  liste `LAYA_FETCH_REASONS`. Messages utilisateur non techniques.
- `src/js/settings.js` — constantes DOM, remplissage à l'ouverture depuis
  `currentConfig`, **ajout obligatoire** des **six** champs `laya_*` à l'objet
  transmis à `save_config` (sinon un enregistrement remet les réglages à zéro),
  parcours de fichier (`.mjs`) et de dossier, `refreshLayaState()` (échec de
  sonde = « non configuré », jamais bloquant), `refreshLayaModelState()`,
  `applyLayaModelState()` (couleur selon `kind`), sondage auto-limité (1 s,
  s'arrête seul quand le téléchargement est fini), écoute de
  `laya-download-progress` **désinscrite** à la fermeture de la modale,
  téléchargement (les champs **non enregistrés** sont passés en priorité) et
  interruption.

## 7. Ce qui n'est PAS fait (assumé)

- **Adresse d'hébergement inconnue** : à ce jour, les fichiers convertis du
  modèle n'ont **pas** d'adresse de publication. `laya_model_base_url` reste
  donc vide par défaut et le manifeste porte le marqueur `A_CHOISIR`. Dans cet
  état, Pilot affiche « adresse d'hébergement manquante » et ne tente **rien**
  (ni plantage, ni attente, ni erreur réseau). Dès que l'adresse existera, la
  renseigner suffit — aucun autre changement de code n'est nécessaire.
- **Pas de vérification SHA-256 par Pilot** : le contrôle d'intégrité est celui
  du programme de téléchargement (code de sortie 4 → « modèle abîmé »).
- **Pas de reprise automatique après coupure réseau** : le téléchargement
  s'arrête sur l'échec ; relancer le téléchargement reprend au même point.
- **Pas de publication** : aucun push, tag, binaire ou paquet — code local à la
  branche `feat/laya-marche2`.
- **Pas de fusion** dans `main` ; aucune intégration par un autre module.
- **Pas de multi-plateforme testé** : seuls Windows (MSVC) a été exercé ; le
  garde de nom de processus (`node.exe` vs `node`) et les chemins sont prévus
  pour macOS/Linux, mais non testés ici.
- **Pas d'interface** : ~~aucun onglet, bouton, réglage d'écran ni commande du
  frontend (marche 3)~~ → **fait en marche 3** : onglet « Service Laya » des
  Réglages (case de démarrage automatique, chemin du service, dossier du modèle,
  indicateur d'état) ; le réglage reste possible directement dans `config.json`.
- **Pas de classement** : Pilot ne lit aucun document, ne décide d'aucune
  étiquette ; il ne pilote que le service.
- **Pas de surveillance périodique** ni de redémarrage automatique après crash
  (le service redémarre au prochain lancement de Pilot).
- **Limite connue** : le nom tracé est celui de l'interpréteur (`node.exe`), pas
  celui du script ; c'est le couple trace/pid qui garantit qu'on ne referme pas
  le service du propriétaire.
