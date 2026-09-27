# Spec — Service Laya (pilotage du service local de classification)

> Document de spécification — Statut : **✅ Marche 5 implémentée et testée**
> (branche `feat/laya-marche2`). Marche 2 = pilotage : démarrage, veille,
> arrêt, trace. Marche 3 = interface : onglet « Service Laya » dans les
> Réglages. Marche 4 = **modèle géré par Pilot** : téléchargement automatique
> au démarrage (si la case est cochée et le modèle absent) et bouton de
> téléchargement manuel. Marche 5 = **service embarqué dans le paquet livré** :
> le service, l'interpréteur et la bibliothèque d'inférence sont livrés avec
> Pilot, le modèle va dans les données de Pilot, tout fonctionne sans rien
> installer. Le **classement** lui-même est fait par le service, pas par Pilot.
> Marche 6 = **appartenance du service** : une copie de Pilot ne referme jamais
> le service lancé par une autre, le service a un **journal**, et un bouton
> permet de le démarrer tout de suite en affichant l'issue réelle.

---

<!-- HELP:laya -->
## Service Laya (classification locale)

Le **service Laya** est un classement automatique local qui tourne sur votre
ordinateur. Pilot ne classe aucun texte à votre place : il **utilise** ce service
pour une seule décision interne (savoir si un message de l'assistant mérite
d'être envoyé vers Telegram), et il met la classification à la disposition de ses
**agents** comme un outil bon marché. Dans tous les cas, le service est **lancé et
surveillé une seule fois** pour toute l'application (il garde un gros modèle en
mémoire : en lancer plusieurs épuiserait la machine), et chaque appel partage ce
même service.

- **Ce que Pilot classe lui-même** : quand le dialogue Telegram est ouvert,
c'est Laya qui décide si un message de l'assistant est une alerte à relayer ;
si le service ne répond pas (ou si la réponse est trop peu sûre), Pilot revient
à son ancien tri par mots-clés, sans rien bloquer ni afficher d'erreur.
- **Outil des agents** : les agents disposent d'un outil `laya_classify`
(choix parmi des libellés, note sur une échelle, oui/non) qui interroge ce même
service, sans charger de modèle et sans consommer de jetons. Service éteint ou
modèle non prêt : l'agent reçoit un message clair et continue.

**Rien à installer** : Pilot livre avec lui le service, son interpréteur et sa
bibliothèque de calcul. Au premier démarrage, il ne manque que le **modèle**
(plusieurs centaines de Mo) : Pilot le télécharge tout seul, puis lance le
service. Vous n'avez aucune commande à taper. Le modèle est enregistré dans le
dossier de **données** de Pilot, jamais dans le dossier du programme.

Réglages disponibles dans **Paramètres → Service Laya** :

- **Lancer le service Laya au démarrage** : si activé, Pilot démarre le service
  à son ouverture, uniquement s'il ne répond pas déjà.
- **Programme du service** : le fichier `laya-service.mjs`. Laissez vide pour
  utiliser celui livré avec Pilot.
- **Programme interpréteur (Node.js)** : le programme qui exécute le service et
  le téléchargement du modèle. Laissez vide : Pilot prend celui qu'il livre, et
  à défaut celui installé sur l'ordinateur.
- **Dossier du modèle à charger** : le dossier contenant le modèle de
  classification. C'est le service qui le charge, pas Pilot. Laissez vide pour
  utiliser le dossier habituel (dans les données de Pilot si le service est
  livré, sinon `model-ml` à côté du service).

Ces trois champs sont **facultatifs** : les remplir sert uniquement à utiliser
un service ou un interpréteur installé à la main, ailleurs. Dans ce cas, c'est
votre réglage qui l'emporte.

- **Démarrer le service maintenant** : lance le service tout de suite, sans
  fermer puis rouvrir Pilot. L'écran indique ensuite ce qui s'est **réellement**
  passé ; si le service tourne déjà, il n'est ni arrêté ni relancé. En cas
  d'échec, la raison exacte est notée dans le fichier `laya.log`, à côté des
  données de Pilot.

**Plusieurs fenêtres de Pilot ouvertes** : elles partagent le même service. Une
fenêtre ne referme jamais le service lancé par une autre : elle le réutilise
tant qu'il répond, et chaque fenêtre ne referme que le sien.

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
  sont publiés. Laissez vide pour utiliser l'adresse indiquée par le modèle —
  c'est le cas normal. La renseigner **force** une autre adresse (hébergement
  personnel, miroir).
- **Programme de téléchargement du modèle** : le fichier `laya-fetch.mjs`.
  Laissez vide pour qu'il soit cherché à côté du service.

**Lire l'indicateur d'état** : sous ces champs, une ligne vous dit où en est le
service — « arrêté », « en cours de chargement du modèle… », « prêt », « modèle
pas encore téléchargé », ou « cette version de Pilot n'embarque pas le service
Laya » (paquet construit sans lui). Un service lancé à la main n'est jamais
arrêté par Pilot ; seul le service que Pilot a démarré est refermé à la
fermeture.

Sous les réglages du modèle, une autre ligne indique l'état du **modèle** :
« prêt », « absent », « téléchargement… n % », « interrompu », « adresse
manquante »… Tous ces messages sont en langage courant (jamais de chemin ni de
nom de fichier technique). **Un échec dit toujours sa cause réelle** : « le
serveur d'hébergement a refusé la demande » (surcharge, quota) n'est jamais
présenté comme une absence de connexion Internet, et inversement.

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
| `laya_status` | commande Tauri (lecture seule, reçoit `AppHandle`) | Rend `{configured, reachable, ready, embedded, outcome}` — aucune écriture, aucune modification du service |
| `laya_service_start` | commande Tauri | Démarre le service **tout de suite** (bouton), sans redémarrer Pilot ; rend l'issue `LayaOutcome` réelle ; service qui répond déjà → `alreadyRunning`, jamais doublé ni arrêté |
| `laya_model_state` | commande Tauri (lecture seule, reçoit `AppHandle`) | Rend `ModelState` : dossier du modèle, présence des fichiers, téléchargement en cours, pourcentage, dernière raison d'échec |
| `laya_model_download(base_url, fetch_path)` | commande Tauri | Lance le téléchargement en arrière-plan ; rend `started` ou `alreadyRunning` (jamais deux téléchargements à la fois) |
| `laya_model_cancel` | commande Tauri | Interrompt le téléchargement tracé ; rend `true` si un téléchargement a bien été arrêté ; **conserve** les fichiers partiels |

Fonctions Rust internes (`laya::`) :

| Nom exact | Rôle |
|---|---|
| `launch_if_needed(enabled, service_path, node_path, model_dir, pid_path)` | Sonde, décide, lance, attend (≤ 3 s) |
| `stop_owned(pid_path)` | **Fermeture de Pilot** : referme le service tracé **uniquement s'il nous appartient** (trace portant notre identifiant de processus) |
| `cleanup_stale(pid_path)` | **Démarrage suivant** : referme un service orphelin, mais **jamais** celui d'une autre copie de Pilot encore vivante, dont la trace est laissée intacte |
| `decide_shutdown_stop(owner, self_pid)` / `decide_startup_cleanup(owner, owner_alive, self_pid)` | Règles d'appartenance **pures** (une seule source de vérité, testée) |
| `format_trace` / `parse_trace` / `read_trace` / `write_trace` | Trace disque à quatre lignes ; trace illisible ou d'une ancienne version (deux lignes) → **on ne referme rien** |
| `status(enabled, service_path, model_dir, embedded)` | Compose l'état (config + sonde live + dernière issue) |
| `resolve_service_path(configured, embedded)` | Priorité **réglage → ressource embarquée** (pure) |
| `resolve_node_path(configured, embedded)` | Priorité **réglage → ressource embarquée → `None`** (= `node` du système) (pure) |
| `node_exe_name()` | Nom de l'interpréteur (`node.exe` sous Windows, `node` ailleurs) |
| `process_name_for(node_path)` | Nom inscrit dans la trace, déduit de l'interpréteur réellement lancé |
| `set_outcome` / `last_outcome` | Mémorise / relit la dernière issue d'un contrôle de démarrage |
| `probe()` / `probe_status(host, port, timeout)` | `GET /status` (sonde < 1 s, timeout 400 ms) |
| `wait_until_reachable(deadline, interval)` | Attend une réponse sans jamais dépasser le délai |
| `spawn_detached(node, service_path, model_dir)` | `<interpréteur> <service> <dossier-modèle>`, détaché, sans console (Windows) |
| `looks_like_url`, `decide_launch`, `is_configured`, `status_ready` | Décisions et analyse **pures** (testables sans I/O) |

Fonctions Rust internes du modèle (`laya_model::`, `laya_download::`) :

| Nom exact | Rôle |
|---|---|
| `resolve_model_dir`, `resolve_model_dir_with_default`, `resolve_fetch_path`, `manifest_path` | Chemins **purs** (défauts : `model-ml`, `laya-fetch.mjs`, `model-manifest.json`) |
| `decide_model_action(present, enabled, downloading)` | Décision pure : `nothing` / `download` / `alreadyRunning` |
| `fetch_exit_reason(code)` | Traduit le code de sortie (0→`ok`, 1→`networkOffline`, 2→`invalidAddress`, 3→`diskFull`, 4→`integrityFailed`, 5→`serverRefused`, autre→`unknown`) |
| `percent(current, total)`, `effective_base_url`, `is_placeholder_base` | Pourcentage borné, adresse effective, détection du marqueur `A_CHOISIR` |
| `parse_manifest`, `read_manifest` | Lecture du manifeste (ne **rate jamais** : repli sur les 4 noms connus) |
| `run` / `download_blocking` / `start_background` / `cancel` | Exécution de `<interpréteur> <fetch> <manifeste> <dossier> [--base <url>]`, version bloquante (démarrage), version fil (bouton), interruption |
| `model_dir_has_all`, `model_state`, `is_downloading` | Vérification de complétude (un fichier partiel `.part` n'est **jamais** valide), état, garde anti-double |

Réglages dans `config.json` (dossier de configuration de Pilot) :

| Réglage | Type | Défaut |
|---|---|---|
| `laya_autostart_enabled` | booléen | `true` (le service livré démarre tout seul ; un `false` enregistré reste `false`) |
| `laya_service_path` | chaîne | vide = le service **livré avec Pilot** |
| `laya_node_path` | chaîne | vide = l'interpréteur **livré avec Pilot**, sinon celui du système |
| `laya_model_dir` | chaîne | vide = `<données de Pilot>/laya/model-ml` (service livré) ou `<dossier du service>/model-ml` (service externe) (relatif au dossier du service, ou absolu) |
| `laya_model_auto_download_enabled` | booléen | `true` (le modèle manquant est récupéré tout seul ; un `false` enregistré reste `false`) |
| `laya_model_base_url` | chaîne | vide = l'adresse du manifeste est utilisée ; une adresse saisie **prend le pas** sur elle |
| `laya_fetch_path` | chaîne | vide = `laya-fetch.mjs` cherché à côté du service |

## 3. Fichiers et chemins

- **Service** : le fichier `laya-service.mjs` désigné par `laya_service_path` ;
  le répertoire courant du processus enfant est son dossier.
- **Modèle** : le dossier désigné par `laya_model_dir`, passé en argument au
  service ; c'est le service qui le charge (jamais Pilot).
- **Trace** : `<app_data_dir>/laya.pid` (dossier de données de l'application),
  **quatre** lignes — identifiant du processus du service, nom du programme du
  service (`node.exe` sous Windows, `node` ailleurs), identifiant du processus de
  l'application Pilot qui l'a lancé, nom de programme de cette application.
  C'est cette **appartenance** qui permet de ne jamais refermer le service d'une
  autre copie de Pilot. Constantes : `PID_FILE_NAME`, `LOG_FILE_NAME`
  (`laya.log`), `LAYA_API_HOST` (`127.0.0.1`), `LAYA_API_PORT` (`3017`),
  `PROBE_TIMEOUT` (400 ms), `READY_DEADLINE` (3 s), `PROBE_INTERVAL` (200 ms).
- **Journal** : `<app_data_dir>/laya.log`, à côté de la trace — la sortie standard
  **et** la sortie d'erreur du service y sont écrites (ajout), avec un repère
  `=== démarrage : … ===` par tentative. C'est là que se lit la cause exacte d'un
  service qui démarre puis meurt (port déjà pris, module manquant…).
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
1. nettoyage : `cleanup_stale` referme un service laissé en vie par un Pilot
   **disparu** ; une autre copie de Pilot **encore ouverte** garde le sien (trace
   laissée intacte) et le service qui répond est réutilisé tel quel ;
2. **modèle** : le dossier du modèle est résolu ; si la case « télécharger
   automatiquement » est cochée **et** qu'il manque des fichiers **et** qu'aucun
   téléchargement n'est déjà en cours, le téléchargement démarre et est attendu
   (thread bloquant) ; la complétude est **revérifiée après** ;
3. `launch_if_needed` : désactivé ou chemin vide → rien, en silence ; chemin en
   forme d'URL (`http://`, `hf://`…) → refusé (aucun téléchargement réseau) ;
   service qui répond déjà → **jamais doublé** ; fichier de service ou dossier de
   modèle absent → rien ; sinon lancement détaché, sortie et erreurs vers
   `laya.log`, trace écrite (avec l'identité du propriétaire), attente bornée à
   3 s.

**Jamais de service sur un modèle incomplet** : si le modèle n'est pas complet
après l'étape 2 (téléchargement refusé, échoué, adresse manquante, interrompu),
le service n'est **pas** lancé et l'issue enregistrée est `invalidPath` — un
dossier ne contenant qu'un `.part` ne lance donc jamais le service.

**Veille** : aucune surveillance périodique en marche 2. L'état est à la
demande (`laya_status`) ; la dernière issue (`outcome`) est mémorisée.

**Arrêt** (fermeture de Pilot) : `stop_owned` → arrêt du processus tracé **si et
seulement si la trace nous appartient** (garde de nom : jamais une autre
application dont le pid serait réutilisé), trace effacée. Un service **lancé à
la main** par la personne n'est jamais tracé, donc jamais refermé ; le service
d'une autre copie de Pilot est laissé à son propriétaire.

**Démarrage à la demande** (`laya_service_start`, bouton « Démarrer le service
maintenant ») : mêmes règles que le démarrage automatique, à une exception près —
le réglage « au démarrage » ne s'y oppose pas (l'utilisateur l'a demandé). Un
service qui répond déjà rend `alreadyRunning` : **il n'est ni arrêté ni relancé**
(rien n'est modifié quand tout va bien).

**Issues** (`LayaOutcome`, en `camelCase` dans le JSON) : `disabled`,
`invalidPath`, `alreadyRunning`, `launched`, `launchedNotReady`, `launchFailed`.
Toute erreur est silencieuse et non bloquante (fail-open).

**Raisons d'échec du modèle** (`FetchReason`, `camelCase`) : `ok`,
`networkOffline`, `serverRefused`, `invalidAddress`, `diskFull`, `integrityFailed`,
`addressMissing` (adresse non renseignée : refus **avant** tout lancement),
`fetchMissing` (programme absent), `nodeMissing` (Node introuvable),
`cancelled`, `alreadyRunning`, `unknown`. Jamais de code brut affiché à
l'utilisateur : chaque raison a un message en langage courant.

**Classement honnête des échecs** (corrigé) : le programme de téléchargement
rend un code **5** quand le serveur a **répondu en refusant** la demande
(surcharge, quota, statut HTTP distinct de 200/206/401/403/404) et un code **6**
quand l'échec est inattendu (ni réseau, ni adresse, ni disque, ni intégrité). Le
code **1** (`networkOffline`) est **réservé** aux vraies pannes de réseau
(`fetch` qui échoue) : un refus de serveur n'est plus jamais annoncé comme « la
connexion à Internet semble indisponible ». Les refus passagers (5) restent
retentés comme les pannes réseau (3 essais) — le motif final, lui, reste honnête.

**Garde anti-double** : un seul téléchargement à la fois pour toute
l'application (drapeau global) ; un second appel est refusé poliment
(`alreadyRunning`) au lieu de lancer un second `node`.

## 5. Preuve par les tests

`cargo test --manifest-path src-tauri/Cargo.toml --lib laya` : **34 tests** des
modules `laya`, `laya_model` et `laya_download` (28 en marche 4, +6 en marche 5).
Tests **réels** notables :

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

Marche 5 — décisions **pures** couvertes par des tests qui ne lancent rien :
`interpreter_priority_is_manual_then_embedded_then_system`,
`service_path_priority_is_manual_then_embedded`,
`traced_process_name_follows_the_interpreter_used`,
`status_exposes_whether_the_service_is_embedded`,
`absent_configuration_defaults_to_the_whole_chain_enabled`,
`an_explicitly_disabled_flag_stays_disabled`,
`embedded_service_sends_default_model_dir_to_writable_dir` (dossier par défaut =
dossier de **données**, jamais le dossier livré). Côté interface,
`src/js/laya-utils.test.js` : service livré pas encore exploitable → message
« livré avec Pilot », paquet **sans** Laya → message « n'embarque pas »,
service livré et prêt → succès.

## 6. Interface (marche 3, étendue en marche 4)

Onglet **« Service Laya »** de la fenêtre des Paramètres, calqué sur le bloc
Avatar (PLface) :

- `index.html` — entrée d'onglet (`data-settings-tab="laya"`) et panneau
  (`data-settings-panel="laya"`) : case `setting-laya-autostart`, champ
  `setting-laya-service-path` + `btn-laya-service-browse`, champ
  `setting-laya-node-path` + `btn-laya-node-browse` (marche 5), champ
  `setting-laya-model-dir` + `btn-laya-model-browse`, bouton
  `btn-laya-service-start` (« Démarrer le service maintenant », marche 6),
  indicateur `laya-runtime-state`, zone de message `laya-message`. Marche 4 : case
  `setting-laya-model-auto-download`, champ `setting-laya-model-base-url`,
  champ `setting-laya-fetch-path` + `btn-laya-fetch-browse`, boutons
  `btn-laya-model-download` / `btn-laya-model-cancel`, barre `laya-model-bar`,
  indicateur `laya-model-state`, message `laya-model-message`.
- `src/js/laya-utils.js` — fonctions pures `layaStatusMessage(status)`,
  `layaOutcomeMessage(outcome)`, `layaModelStateMessage(state)` (rend
  `{text, kind}`) et `layaModelProgressPercent(state)` (borné 0..100), plus la
  liste `LAYA_FETCH_REASONS`. Messages utilisateur non techniques.
  `layaStatusMessage` affiche **l'issue réelle** enregistrée dans le statut
  (`outcome`) quand le service ne répond pas ; « arrêté » n'est plus qu'un repli
  quand aucune issue n'est connue.
- `src/js/settings.js` — constantes DOM, remplissage à l'ouverture depuis
  `currentConfig`, **ajout obligatoire** des **sept** champs `laya_*` à l'objet
  transmis à `save_config` (sinon un enregistrement remet les réglages à zéro),
  parcours de fichier (`.mjs`) et de dossier, `refreshLayaState()` (échec de
  sonde = « non configuré », jamais bloquant), démarrage à la demande
  (`btn-laya-service-start` → `laya_service_start`, issue affichée via
  `layaOutcomeMessage`), `refreshLayaModelState()`,
  `applyLayaModelState()` (couleur selon `kind`), sondage auto-limité (1 s,
  s'arrête seul quand le téléchargement est fini), écoute de
  `laya-download-progress` **désinscrite** à la fermeture de la modale,
  téléchargement (les champs **non enregistrés** sont passés en priorité) et
  interruption.

## 7. Ce qui n'est PAS fait (assumé)

- **Pas de trace par copie de Pilot** (marche 6) : les deux copies partagent le
  même `<app_data_dir>/laya.pid`. Chaque copie ne referme donc que le service
  qu'elle a lancé, mais si le propriétaire se ferme, le service disparaît aussi
  pour une copie restée ouverte (elle le relance au besoin : bouton de démarrage
  à la demande ou redémarrage). Un fichier de trace par copie serait le remède
  si le partage gênait en pratique.
- **Pas de rotation du journal** `laya.log` : un repère par tentative, le service
  écrit très peu — la taille reste négligeable ; aucune purge automatique.
- **Trace d'une version antérieure** (deux lignes) : traitée comme illisible →
  **rien n'est refermé** ; au premier redémarrage après mise à jour, un service
  orphelin peut donc rester en vie (sans conséquence : il est réutilisé tel quel).
- ~~**Adresse d'hébergement inconnue**~~ → **résolu (marche 5)** : le manifeste
  porte désormais l'adresse réelle
  (`https://huggingface.co/pleveneur/laya-multilingual-onnx/resolve/main`).
  `laya_model_base_url` vide par défaut ⇒ c'est **l'adresse du manifeste** qui
  sert ; une adresse saisie **prend le pas** (`effective_base_url`). Le marqueur
  `A_CHOISIR` reste refusé **avant** tout lancement si le manifeste revenait en
  arrière → `invalidAddress`.
- **Pas de vérification SHA-256 par Pilot** : le contrôle d'intégrité est celui
  du programme de téléchargement (code de sortie 4 → « modèle abîmé »).
- **Pas de reprise automatique après coupure réseau** : le téléchargement
  s'arrête sur l'échec ; relancer le téléchargement reprend au même point.
- **Pas de publication** : aucun push, tag, binaire ou paquet — code local à la
  branche `feat/laya-marche2`.
- **Licence** : LayaPL a sa propre licence ; ses fichiers restent **hors du
  dépôt** Pilot et ne sont copiés qu'au moment de la construction (§8.1).
- **Pas de fusion** dans `main` ; aucune intégration par un autre module.
- **Pas de multi-plateforme testé** : seuls Windows (MSVC) a été exercé ; le
  garde de nom de processus (`node.exe` vs `node`), l'interpréteur embarqué et
  les chemins sont prévus pour macOS/Linux (le script de préparation prend
  `process.platform`/`process.arch`), mais **non testés ici**. Chaque paquet
  n'embarque que le binaire natif de son système.
- **Pas d'interface** : ~~aucun onglet, bouton, réglage d'écran ni commande du
  frontend (marche 3)~~ → **fait en marche 3** : onglet « Service Laya » des
  Réglages (case de démarrage automatique, chemin du service, dossier du modèle,
  indicateur d'état) ; le réglage reste possible directement dans `config.json`.
- **Pas de classement d'office de vos documents** : ~~Pilot ne lit aucun
  document, ne décide d'aucune étiquette ; il ne pilote que le service~~ →
  **étendu (marche 13)** : Pilot décide **une** chose de lui-même (le genre d'un
  message de l'assistant, pour le relais Telegram) et **expose** la
  classification aux agents (`laya_classify`). Aucun document n'est classé sans
  qu'un agent ou une décision nommée le demande — voir §9.
- **Pas de surveillance périodique** ni de redémarrage automatique après crash
  (le service redémarre au prochain lancement de Pilot).
- **Limite connue** : le nom tracé est celui de l'interpréteur (`node.exe`), pas
  celui du script ; c'est le couple trace/pid qui garantit qu'on ne referme pas
  le service du propriétaire.

## 8. Marche 5 — service embarqué dans le paquet livré

**Objectif** : une version livrée de Pilot démarre le service Laya, télécharge le
modèle et classe **sans rien installer** ; un service désigné à la main continue
de fonctionner exactement comme avant.

### 8.1 Fichiers embarqués

Préparés par `scripts/prepare-laya.js` (`npm run prepare:laya`) dans
`src-tauri/laya/`, déclaré dans `bundle.resources` sous la clé `"laya": "laya"`
(résolu en `$RESOURCE/laya/`) :

| Élément | Rôle | Windows x64 |
|---|---|---|
| `node/node.exe` | interpréteur (la machine cible peut n'en avoir aucun) | 85,7 Mo |
| `…/bin/napi-v6/win32/x64/*` | moteur d'inférence natif (`onnxruntime.dll` + `onnxruntime_binding.node`) | 27,7 Mo |
| `laya-service.mjs` | le service | ≈ 0,1 Mo |
| `laya-fetch.mjs` | téléchargeur du modèle | ≈ 0,1 Mo |
| `model-manifest.json` | adresse + tailles/empreintes | ≈ 0,005 Mo |
| `laya-ts/dist/*.js` | bibliothèque compilée | ≈ 0,1 Mo |
| `onnxruntime-node/dist/*.js`, `onnxruntime-common/dist/*.js` | liaison ONNX Runtime | ≈ 0,1 Mo |
| `package.json` (laya-ts + 2 paquets) | `type:module` / points d'entrée | négligeable |
| **Total** | | **≈ 113,7 Mo** |

Le **strict nécessaire** est établi par exécution réelle du service depuis une
copie préparée, pas par supposition : `DirectML.dll`, `dxcompiler.dll` et
`dxil.dll` sont **écartés** (le service demande le fournisseur CPU), et les
`.d.ts`/`.map`/binaires d'autres plateformes ne sont jamais copiés.

Le dossier source (`LAYA_SOURCE_DIR`, défaut `<dépôt>/../LayaPL`) est **hors
dépôt** : `src-tauri/laya/` est dans `.gitignore`, aucun fichier de LayaPL n'est
versionné. Dossier source absent → avertissement explicite et **sortie 0** (le
paquet n'embarque pas Laya, Pilot le dit à l'écran) ; dossier présent mais
incomplet → **sortie 1** (mieux vaut échouer que livrer une copie incomplète).
Le dossier cible est vidé puis reconstruit : deux exécutions donnent un résultat
identique.

### 8.2 Résolution des chemins

Un seul point de calcul (`laya_effective_paths(app, cfg, override)` dans
`lib.rs`) alimente le **lancement**, l'**état**, le **téléchargement** et
l'**arrêt** — jamais deux calculs divergents.

| Chemin | Priorité |
|---|---|
| service | `laya_service_path` → embarqué (`$RESOURCE/laya/laya-service.mjs`) |
| interpréteur | `laya_node_path` → embarqué (`$RESOURCE/laya/node/node[.exe]`) → `node` du système |
| dossier du modèle | `laya_model_dir` → (embarqué) `<données>/laya/model-ml`, sinon `<dossier du service>/model-ml` |
| téléchargeur | `laya_fetch_path` → à côté du service |

`LayaPaths.embedded` (vrai seulement si **rien n'est réglé** et que la ressource
existe) est le même drapeau que celui exposé par `laya_status`.

### 8.3 Écriture dans le dossier livré : jamais

Le dossier livré est **en lecture seule** en version installée. Le modèle est
donc écrit dans le dossier de **données** de l'application
(`app_data_dir()/laya/model-ml`), reprise des `.part` comprise. Un
`laya_model_dir` réglé à la main reste prioritaire (chemin absolu, ou relatif au
dossier du service).

### 8.4 Défauts sans réglage

`laya_autostart_enabled` et `laya_model_auto_download_enabled` valent **`true`**
par défaut (`#[serde(default = "default_true")]` **et** `impl Default`) : un
`config.json` qui ne les mentionne pas obtient `true`, un `false` **enregistré**
reste `false`. Un champ absent de l'objet enregistré par les Réglages reste le
piège connu : tous les champs `laya_*`, y compris le nouveau `laya_node_path`,
sont transmis à `save_config`.

## 9. Marche 13 — Laya par Pilot lui-même, et par les agents

**Objectif** : utiliser le service déjà lancé pour **deux** usages réels, sans
jamais charger un second modèle ni consommer de jetons.

### 9.1 Pilot décide lui-même (incrément 1)

Quand le **dialogue Telegram** est ouvert, le relais d'un message de l'assistant
(`src/js/super-agent.js`, dans `appendSystemMessage`) demande d'abord à Laya le
**genre** du message (`assistant_message_kind` : `alert`, `approval`, `question`,
`report`, `intermediate`) par la question typée `choice` définie dans
`buildAssistantKindQuestion()` (`src/js/laya-gateway.js`). Seul `alert` déclenche
le relais ; la décision, sa confiance (`answer_confidence`, seuil 0,5) et la durée
sont tracées (`[Laya] relais sortant : …`) dans la console.

- **Repli strict** : service éteint, réponse illisible, étiquette inconnue ou
  confiance < 0,5 → l'ancien tri par mots-clés (`classifyAssistantMessage`) décide,
  exactement comme avant. Aucun message d'erreur, aucun blocage, aucun
  changement d'itinéraire. Les messages sans contenu utile (`empty`) n'interrogent
  même pas le service.
- **Appel** : commande Rust `laya_classify(text, questions)` (`src-tauri/src/lib.rs`)
  → `laya::classify` (`src-tauri/src/laya.rs`), `POST /classify` par `TcpStream`
  (même patron que `probe_status`, aucune dépendance ajoutée). Le **connect** est
  borné à 400 ms (`PROBE_TIMEOUT`) pour que « service éteint » reste instantané ;
  la **lecture** de la réponse est bornée à 30 s (le premier appel charge le
  modèle).

### 9.2 Laya comme outil des agents (incrément 2)

L'extension **`src-tauri/extensions/pilot-laya.ts`** (une seule extension, un
seul fichier), écrite dans `<app_data_dir>/extensions/` et passée en
`--extension` à **toute** session d'agent (`agent_service.rs`,
`spawn_session` **et** `spawn_agent_process` — agents lancés par l'assistant
et agents multi-rôles) avec son cœur `laya-gateway.js` (testé par Vitest),
expose **un** outil :

| | |
|---|---|
| Nom | `laya_classify` |
| Paramètres | `text`, `type` (`choice` \| `score` \| `noul`), `instructions` (le texte à juger s'y écrit `` `body` ``), `options[]` (au moins deux pour `choice`/`score`) |
| Retour | `Laya : choice « … » — confidence … / answer_confidence … — probabilities {…}` (+ ` en N ms`) ou `score …` / `noul …` ; en panne, un message clair avec `isError` |

- Aucun modèle n'est chargé par la session : l'outil ne fait qu'un **appel local**
  au service unique, qui garde le modèle en mémoire pour toute l'application.
- **Fail-open** : service éteint → « Le service Laya ne répond pas… » ; modèle non
  prêt → message 400 du service recopié ; question mal formée → refus **sans**
  toucher au réseau. Jamais d'exception.
- Les sessions qui ne reçoivent pas cette extension (Assistant 🧭, Aide, Review)
  **ne voient pas** l'outil.

### 9.3 Preuve

`npm test` (Vitest) couvre le cœur (`src/js/laya-gateway.test.js`,
`src/js/telegram-dialog.test.js` : service simulé, aucun réseau) ; `cargo test
--lib laya` couvre le client Rust (faux service en `TcpListener`). Un test Rust
(`write_laya_extension_ecrit_extension_et_coeur`) prouve que le couple
`pilot-laya.ts` + `laya-gateway.js` est bien écrit sur disque par le chemin
partagé. Les preuves
d'exécution réelle (réponses, confiances, durées, mémoire, un seul processus,
cas de panne) sont consignées dans le rapport de mission, avec ses traces
locales réexécutables (`.pilot/laya-inc1.*`, `.pilot/laya-inc2.*`).
