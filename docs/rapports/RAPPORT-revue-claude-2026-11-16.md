# Rapport de revue de code — Pilot (dépôt de Patrick Leveneur)

*Revue en lecture seule faite par Claude (Opus 5.5) pour Drass. Rapport destiné à `docs/rapports/RAPPORT-revue-claude-2026-11-16.md`. Il n'est pas commité.*

---

## 1. Synthèse

Pilot est une application de bureau : un éditeur de texte qui pilote des agents d'IA, un serveur web pour l'utiliser à distance, et un serveur de partage de sources (GDS). Le code est très commenté et pensé avec soin. Plusieurs mécanismes délicats sont bien faits : le chiffrement du coffre, les jetons de session, la vérification des chemins côté web distant, et la corrélation des requêtes avec l'agent.

La revue a quand même trouvé des problèmes réels, dont deux graves :

1. **Ouvrir un fichier Markdown piégé en prévisualisation peut suffire pour qu'un inconnu lance des commandes sur la machine.** Il peut s'agir par exemple du README d'un projet récupéré sur Internet. La prévisualisation affiche le HTML brut sans nettoyage, aucune politique de sécurité du contenu n'est active, et la page a accès à toutes les commandes internes de Pilot, dont le lancement de commandes dans un terminal.
2. **Le mode « lecture seule » de l'accès distant a des trous.** Plusieurs actions restent possibles alors que la documentation promet une « lecture seule complète ». L'une d'elles permet de rediriger la base GDS du poste vers un serveur choisi par l'appelant.
3. **L'Assistant, présenté comme « strictement en lecture seule », ne l'est pas techniquement.** Seuls deux outils d'écriture sont filtrés. L'outil shell (`bash`) de l'agent reste disponible, et dans le mode « Discussion seule » aucun filtre n'est chargé.
4. **Le coffre de mots de passe peut être perdu en entier** si l'ordinateur s'arrête pendant un enregistrement : le fichier est écrasé directement, sans copie de sécurité.
5. Des défauts plus discrets : accents parfois abîmés dans les réponses de l'agent, un délai d'attente qui ne fonctionne pas pour la conversion PDF, et des liens Markdown qui peuvent faire ouvrir un programme local par le système.

**Aucun test n'a été exécuté.** L'installation des dépendances a échoué dans le bac à sable, et Rust (Cargo) est absent. Tout ce qui suit vient de la lecture du code.

---

## 2. Référence, environnement et limites

| Élément | Valeur |
|---|---|
| Dépôt | clone local `/home/drass/Work/pilot` (projet de Patrick Leveneur) |
| Commit de référence | `6d57ddd119fbb173bf962eb2f7400e7e6ea6ca87`, vérifié dans `.git/refs/heads/review/claude-audit-2026-11-16` |
| Branche locale créée | `review/claude-audit-2026-11-16` (première action, aucun commit, aucun push) |
| Version applicative | 0.6.25 (`src-tauri/tauri.conf.json:4`) |
| Outils disponibles pendant la revue | lecture de fichiers et recherche uniquement. Le shell a été **refusé** dans le dépôt, donc pas de `git log` ni de `git ls-files`. L'inventaire vient de recherches par motif. |
| Exécution | aucune : ni Pilot, ni navigateur, ni réseau, ni tests |
| Secrets | aucun fichier `.env` ni fichier d'identifiants lu. Aucune valeur secrète reproduite ici. |

**Limites.** Je n'ai pas lu tout le dépôt. Les gros fichiers, comme `super_agent.rs` (plus de 11 000 lignes), `agent_service.rs`, `lib.rs` et `gds-core/src/http.rs`, ont été lus par tranches autour des fonctions à risque. Les dépendances vendorisées (`src-tauri/vendor/whisper-rs-sys`) n'ont pas été examinées. Quand un constat dépend du comportement d'un composant externe (Tauri v2 ou l'outil `pi`), c'est indiqué.

---

## 3. Couverture par domaine

| Domaine | Fichiers / fonctions lus | Niveau |
|---|---|---|
| Règles du projet | `AGENTS.md` l. 1-197 et 372-583 (rôle, anti-régression, tests, publication, compatibilité) | détaillé (arborescence l. 198-371 survolée) |
| Configuration Tauri | `tauri.conf.json`, `capabilities/default.json`, `build.rs` | détaillé |
| Serveur web distant | `web_server.rs` : routeur, login, toutes les routes agent/fichiers/projets/commandes, WebSocket, fichiers statiques, validation des chemins (l. 1-1745) | détaillé |
| Authentification partagée | `gds-core/src/auth.rs` (entier) ; `gds-core/src/http.rs` : routeurs, `auth_middleware`, `revalidate_session`, `require_admin`, `gds_setup`, gardes d'écriture (l. 120-335, 700-960, 1420-1505) ; `roles.rs` (`can_write`, `is_admin`) | détaillé pour l'auth, échantillonné pour les routes métier |
| GDS côté poste | `gds_web.rs` (l. 30-262), `gds_client::sync_project` (l. 1-140), `gds_sync::force_push_tracking` (l. 1000-1106) | détaillé sur ces fonctions |
| GDS : migrations, verrous, portage, `db.rs` | non lus | **non vérifié** |
| Processus Pi / RPC | `rpc_manager.rs` l. 1-625 (lancement, envoi, corrélation, attente, arrêt, lecture JSONL, stderr, conversion PDF) ; `rpc.rs` (liste des fonctions) | détaillé pour `rpc_manager`, échantillonné pour `rpc.rs` |
| Assistant / orchestration | `super_agent.rs` (démarrage l. 255-314, `super_agent_db_query` l. 1271-1344, lecture de fichier l. 6310-6342) ; `agent_service.rs` (`spawn_superagent_session` l. 3440-3624) ; extension `pilot-assistant-files.ts` (entière) ; `garde-fou-refus-lecture-seule.test.js` (début) | échantillonné, chemins sensibles suivis |
| Délégations, questions, boucles, consommation | non lus en profondeur | **non vérifié** |
| Commandes fichiers | `files.rs` l. 1-250 | détaillé |
| Terminal PTY | `terminal.rs` : `spawn_terminal`, `spawn_terminal_command` (l. 28-83) | échantillonné |
| Rendu Markdown / XSS | `preview.js` (l. 1-120 et 290-637) ; configuration markdown-it de `agent-pi.js`, `super-agent.js`, `dashboard.js`, `prompt-builder.js` | détaillé pour `preview.js` |
| Client web distant (`web/js/app.js`) | non lu | **non vérifié** (XSS possible non évalué) |
| Coffre | `vault.rs` l. 84-406 | détaillé |
| Configuration | `save_config_disk` (`lib.rs:1595-1600`) | ponctuel |
| Mises à jour / chaîne de livraison | clé publique et point de terminaison de `tauri.conf.json` seulement ; `release.yml` et `scripts/*` non lus | **non vérifié** |
| Audio / dictée / Whisper / patch vendor | non lus | **non vérifié** |
| MCP, Telegram, Laya, Code Graph, mémoire, historique | non lus | **non vérifié** |
| UI / accessibilité | non lues | **non vérifié** |
| Tests | inventaire de `src/js/*.test.js` (314 fichiers) ; comptage de `readFileSync` ; lecture d'un test ; tests sources de `http.rs` repérés | échantillonné |

Les zones non explorées (GDS en profondeur, livraison, audio, MCP, Telegram, client web, UI) l'ont été faute de tours. J'ai donné la priorité à la sécurité, aux pertes de données et aux contrats.

---

## 4. Constats

> Légende du statut : **CL** = confirmé par lecture ; **H** = hypothèse (dépend d'un comportement non vérifié) ; **CE** = confirmé par exécution (aucun dans cette revue).

### P0 — critique

#### XSS-01 — Prévisualisation Markdown : le HTML brut peut piloter toutes les commandes internes
- **Statut** : CL pour l'injection HTML/JS. La chaîne complète jusqu'à l'exécution de commandes est une **H forte** : elle suppose qu'un script dans la page Tauri v2 peut appeler l'IPC interne (`window.__TAURI_INTERNALS__`). C'est le fonctionnement standard de Tauri v2, mais je ne l'ai pas exécuté.
- **Confiance** : élevée.
- **Code en cause** :
  - `src/js/preview.js:11-16` : `markdownit({ html: true, … })` ;
  - `src/js/preview.js:318-320` et `581`, `632` : `wrapper.innerHTML = renderMarkdown(...)`, sans aucun nettoyage ;
  - `src/js/preview.js:27-34` : Mermaid avec `securityLevel: "loose"` ;
  - `src-tauri/tauri.conf.json:52-54` : `"csp": null` (aucune politique de sécurité du contenu) ;
  - `src-tauri/build.rs:15` : `tauri_build::build()` sans manifeste d'application, donc toutes les commandes de `generate_handler!` (`lib.rs:3833`) sont autorisées pour la fenêtre `main` ;
  - cibles atteignables : `terminal.rs:62-83` (`spawn_terminal_command(cwd, command)`), `files.rs:83-91` (`write_file_content`), `files.rs:19-28` (lecture de n'importe quel fichier), `vault_list` (`vault.rs:336-340`, mots de passe en clair si le coffre est déverrouillé).
- **Chemin d'appel** : ouverture d'un `.md` en prévisualisation → `createPreview` / `updatePreview` → `innerHTML` → un gestionnaire comme `onerror` s'exécute dans la fenêtre principale.
- **Préconditions** : l'utilisateur prévisualise un Markdown dont il ne contrôle pas le contenu (README d'un dépôt cloné, fichier produit par un agent, fichier synchronisé par GDS).
- **Impact** : exécution de commandes avec les droits de l'utilisateur, lecture et écriture de fichiers, fuite du coffre déverrouillé. C'est une vraie traversée de frontière : du contenu de fichier, censé être une donnée, devient du code.
- **Scénario sûr à reproduire** : en environnement jetable, prévisualiser un `.md` contenant `<img src=x onerror="document.title='XSS'">`. Si le titre change, l'injection est prouvée. Ne pas tester d'appel de commande sur une vraie machine.
- **Correction proposée (non appliquée)** : `html: false` dans `preview.js`, ou passage du rendu par DOMPurify. Mermaid en `securityLevel: "strict"`. Définir une CSP (`script-src 'self'`, pas de `unsafe-inline`). Restreindre les commandes par fenêtre avec un manifeste d'application Tauri v2 (`tauri_build::Attributes::app_manifest`).
- **Test de régression** : un test de comportement qui rend `<img onerror>`, `<script>`, `<a href="javascript:">` et `<svg onload>` dans le DOM d'un conteneur jsdom, puis vérifie qu'il ne reste aucun attribut `on*` ni `<script>`. Un test de config qui échoue si `csp` vaut `null`.

### P1 — majeur

#### WEB-01 — Le mode lecture seule distant laisse passer plusieurs actions qui modifient l'état
- **Statut** : CL. **Confiance** : élevée.
- **Code en cause** : ces handlers n'appellent pas `is_readonly`, contrairement à `agent_prompt` (`web_server.rs:470`) et `file_save` (`801`) :
  - `web_server.rs:638-649` `agent_compact` (compacte le contexte de l'agent, perte de détail irréversible) ;
  - `web_server.rs:658-683` `agent_set_model` ;
  - `web_server.rs:1075-1113` `project_select` (change le projet actif et **arrête puis relance** la session agent) ;
  - `web_server.rs:971-991` `web_settings_set` (écrit la configuration sur disque) ;
  - `gds_web.rs:159-174` `gds_provision_web` : provisionne une base avec `db_addr`/`db_user`/`db_password` **fournis par l'appelant**, puis remplace le pool GDS du poste (`set_desktop_pool`, l. 172) ;
  - `gds_web.rs:185-197` (ajout de projet), `211-232` (`sync` : `git pull` dans un chemin fourni), `237-258` (`tracking/force` : écrase le suivi distant).
- **Contrat contredit** : `spec_web_remote.md:482` (« lecture seule complet quand activé ») et `:425`. Le commentaire `gds_web.rs:234-236` annonce une restriction de rôle que la route ne vérifie pas. Sur la voie historique, la garde `ensure_project_publisher` (`gds_sync.rs:1042`) se fie à l'`identity_email` lu dans `.pilot/gds.json` du projet, pas à l'identité authentifiée.
- **Chemin d'appel** : HTTP → `auth_middleware` (jeton valide) → handler, sans contrôle de `web_readonly`.
- **Préconditions** : serveur distant actif, mode lecture seule coché, appelant en possession du mot de passe distant (par exemple un tiers à qui l'on a donné l'accès « consultation »).
- **Impact** : la promesse « consultation uniquement » est fausse. Le scénario le plus sérieux est le provisionnement : il redirige les opérations GDS du poste vers une base PostgreSQL contrôlée par l'appelant.
- **Preuve** : lecture directe des handlers cités.
- **Correction proposée** : une seule couche (middleware) qui refuse toute méthode non-GET en mode lecture seule, avec une liste blanche explicite (`/api/auth/login`). Les routes GDS du poste devraient aussi exiger un rôle et une identité réels.
- **Test de régression** : un test axum qui active `web_readonly`, appelle chaque route POST/PUT du routeur et vérifie un 403 partout sauf sur la liste blanche. Il doit énumérer les routes réellement montées, pas chercher des chaînes dans les sources.

#### AST-01 — La « lecture seule stricte » de l'Assistant n'est pas appliquée techniquement
- **Statut** : CL côté Pilot. **H** sur un point : que `pi` expose par défaut ses outils intégrés (`bash`, `write`, `edit`, `read`) quand aucune restriction n'est passée. **Confiance** : moyenne à élevée.
- **Code en cause** :
  - `src-tauri/extensions/pilot-assistant-files.ts:35-36` : seuls `write` et `edit` sont interceptés, **`bash` passe** ;
  - `pilot-assistant-files.ts:59-62` : en cas d'erreur, l'outil est autorisé (le garde s'ouvre au lieu de bloquer) ;
  - `pilot-assistant-files.ts:25-29` : `resolve()` sans `realpath`, donc un lien symbolique placé dans `~/.pilot/assistant` permet d'écrire ailleurs ;
  - `agent_service.rs:3605-3624` : `spawn_and_start` sans aucun argument qui restreigne les outils ;
  - `agent_service.rs:3554-3560` et `3472` : si le dossier d'extensions est inutilisable ou si les extensions ne sont pas prises en charge, la session est **lancée sans aucune extension**, donc sans aucun garde ;
  - `agent_service.rs:3502-3507` : en « Discussion seulement via llama », la liste d'extensions est *remplacée* par `pilot-persona-fiche.ts` seule. `pilot-assistant-files` n'est donc pas chargée, alors que le commentaire affirme « ce qui n'est pas listé ici n'existe pas dans cette session ». Les outils intégrés de pi ne dépendent pas de cette liste.
- **Distinction** : un agent de codage qui exécute du shell est normal. Ici, le produit **promet** à l'utilisateur que l'Assistant ne modifie jamais les projets (`super_agent.rs:685`). Le seul rempart réel est la consigne textuelle. Du contenu de projet lu par l'Assistant (injection de prompt) peut donc mener à des écritures.
- **Correction proposée** : lancer la session de l'Assistant avec une liste d'outils explicite (option de restriction des outils de pi, à confirmer pour le moteur `plh`). Bloquer `bash`, ou le limiter aux commandes de consultation. Bloquer en cas d'erreur au lieu d'autoriser. Refuser de démarrer l'Assistant sans son garde. Utiliser `realpath`.
- **Test de régression** : un test qui démarre l'extension avec un faux `pi` et vérifie qu'un `tool_call` `bash` portant `echo x > projet/f` est bloqué. Un test Rust qui vérifie que les arguments de lancement de l'Assistant contiennent la restriction d'outils, dans les deux modes.

#### LNK-01 — Les liens de prévisualisation ouvrent n'importe quel schéma via le système
- **Statut** : CL (code), H (effet exact selon l'OS). **Confiance** : moyenne.
- **Code en cause** : `src/js/preview.js:515-520`. Tout `href` qui ressemble à `schéma:` est passé à `open_in_browser`, qui fait `open::that(&path)` sans filtre (`src-tauri/src/files.rs:200-202`).
- **Préconditions** : l'utilisateur clique sur un lien d'un Markdown non fiable, par exemple `file:///…/setup.exe`, un chemin réseau `\\serveur\…` ou un schéma d'application enregistré.
- **Impact** : sous Windows, `ShellExecute` peut lancer un exécutable ou un raccourci local. Ailleurs, le gestionnaire associé est ouvert.
- **Correction proposée** : liste blanche `http`, `https`, `mailto` côté Rust, avec refus de tout le reste.
- **Test de régression** : un test unitaire Rust de la fonction de filtrage (`file:`, `smb:`, `javascript:` refusés).

#### VLT-01 — Le coffre de mots de passe est réécrit sans écriture atomique
- **Statut** : CL. **Confiance** : élevée sur le mécanisme. Probabilité faible, impact maximal.
- **Code en cause** : `src-tauri/src/vault.rs:227-231` (`write_entries`) et `325-329` (`vault_set_master_password`) utilisent `std::fs::write` directement sur `~/.pilot/vault.json`, qui est tronqué puis réécrit. Il n'y a ni fichier temporaire, ni renommage, ni sauvegarde.
- **Impact** : une coupure de courant, un plantage ou un disque plein pendant l'écriture laisse un JSON tronqué. Le déchiffrement devient impossible et **tous les secrets sont perdus**. Même schéma, avec un impact moindre, pour la configuration (`lib.rs:1595-1600`) et l'édition web (`web_server.rs:825`).
- **Point annexe (P3)** : la séquence lecture-modification-écriture n'est pas verrouillée (`vault_add`, `vault_update`, `vault_delete`). Deux appels simultanés peuvent faire perdre une entrée.
- **Correction proposée** : une fonction commune d'écriture atomique (fichier temporaire dans le même dossier, `sync_all`, `rename`), plus une sauvegarde `vault.json.bak` de la version précédente.
- **Test de régression** : simuler une écriture interrompue (helper injectable) et vérifier que le coffre précédent reste déchiffrable.

### P2 — notable

#### RPC-01 — Les caractères UTF-8 coupés entre deux lectures sont corrompus
- **Statut** : CL. **Confiance** : élevée.
- **Code en cause** : `rpc_manager.rs:313` et `341` : lecture par blocs de 4096 octets puis `String::from_utf8_lossy` **sur chaque bloc**. Un caractère sur plusieurs octets (é, è, à, emoji) à cheval sur deux blocs devient `��`. Ces événements partent ensuite vers l'interface, le WebSocket et l'historique. Même défaut dans `web_server.rs:1545-1547` (`stream_pipe`), en pire : le bloc entier est **retiré** du journal final si `from_utf8` échoue.
- **Impact** : texte français abîmé de façon aléatoire dans les longues réponses. Un JSON stocké avec des caractères de remplacement peut aussi fausser des comparaisons de texte en aval.
- **Correction proposée** : accumuler des octets (`Vec<u8>`), couper sur `\n` au niveau des octets, puis décoder ligne par ligne. Ou garder le reste incomplet d'un bloc à l'autre.
- **Test de régression** : passer à `read_jsonl_loop` un lecteur factice qui coupe `{"t":"é"}\n` au milieu du « é » (le code est déjà testable par callback, l. 142-143).

#### RPC-02 — Le délai de 2 minutes de la conversion PDF→Markdown n'est jamais appliqué si pi se tait
- **Statut** : CL (blocage), H (effet de la fermeture de stdin). **Confiance** : élevée pour le blocage.
- **Code en cause** : `rpc_manager.rs:553-563`. Le délai n'est vérifié que *quand une ligne arrive*. `reader.lines()` bloque sans fin si pi ne produit rien. En plus, `stdin` est fermé dès la l. 550, avant toute réponse : selon le comportement de pi en mode RPC, cela peut interrompre la requête (H).
- **Impact** : un fil d'exécution et un processus pi restent bloqués indéfiniment, et la conversion ne rend jamais la main.
- **Correction proposée** : lecture dans un fil séparé avec `recv_timeout`, et `kill` du processus à l'échéance. Garder stdin ouvert jusqu'à `agent_end`.
- **Test de régression** : un faux pi qui ne répond jamais doit produire une erreur de délai en moins du délai prévu.

#### WEB-03 — L'édition distante écrase sans détecter les conflits
- **Statut** : CL. **Confiance** : moyenne (l'impact dépend des usages).
- **Code en cause** : `web_server.rs:796-836`. `file_save` écrit sans vérifier la date de modification ni un contenu de référence. L'écriture n'est pas atomique.
- **Impact** : une modification faite en parallèle sur le poste ou par un agent est effacée sans alerte.
- **Correction proposée** : exiger un `mtime` ou un hash attendu (`If-Match`) et renvoyer 409 en cas d'écart.
- **Test de régression** : enregistrer avec un `mtime` périmé doit donner 409.

#### GDS-01 — Initialisation de l'administrateur au premier arrivé
- **Statut** : CL (code). L'exposition réelle est une H qui dépend du déploiement. **Confiance** : moyenne.
- **Code en cause** : `gds-core/src/http.rs:254-258` et `705-743`. `POST /api/gds/setup` est public et crée l'administrateur tant qu'aucun n'existe (protection contre la création en double correcte, l. 731-741).
- **Impact** : si le service est joignable sur le réseau avant son initialisation, n'importe qui peut en devenir administrateur.
- **Correction proposée** : un jeton d'initialisation à usage unique affiché dans les journaux du conteneur, ou une initialisation limitée à localhost.
- **Test de régression** : un setup sans jeton d'initialisation doit renvoyer 401.

#### ORC-01 — Les agents « lecture seule » sont restreints par analyse du texte de mission
- **Statut** : H. Je n'ai trouvé aucun garde au niveau des outils : `readonly` est seulement stocké (`agent_service.rs:1205, 4309-4371`) et aucune extension ne le lit (recherche dans `src-tauri/extensions`). **Confiance** : faible à moyenne, à confirmer.
- **Indice** : `src/js/garde-fou-refus-lecture-seule.test.js` montre que le refus repose sur `detectExplicitWriteRequest` (analyse de phrases), donc sur une heuristique de langue.
- **Correction proposée** : propager `readonly` à la session pi (restriction d'outils ou garde `tool_call` comme AST-01).
- **Test** : un agent `readonly` qui reçoit un `tool_call` `write` doit être bloqué.

### P3 — mineur

| ID | Titre | Fichier:lignes | Statut | Correction proposée |
|---|---|---|---|---|
| RPC-03 | Identifiant RPC = 32 bits bas de l'horloge en nanosecondes. Collision possible entre deux fils (résolution de 100 ns sous Windows), ce qui remplace l'émetteur en attente et envoie la réponse au mauvais demandeur | `rpc_manager.rs:233, 481-488` | CL (code), probabilité faible | compteur atomique ou UUID v4 |
| RPC-04 | Après un délai dépassé, l'entrée `pending` n'est pas retirée : petite fuite, réponse tardive avalée | `rpc_manager.rs:254-266` | CL | retirer l'id quand le délai expire |
| RPC-05 | Tampon de ligne sans borne, et `buffer = buffer[pos+1..].to_string()` est quadratique sur les longues sorties | `rpc_manager.rs:341-346` | CL | `drain(..=pos)` et plafond de taille |
| WEB-02 | Les chemins relatifs de `validate_within` sont résolus depuis le dossier courant du processus et non depuis la racine du projet, alors que `file_create` les joint à la racine | `web_server.rs:1683-1695` vs `848-852` | CL | joindre à `root` avant de canonicaliser |
| WEB-04 | Jeton de session dans l'URL du WebSocket (`?token=`), donc présent dans les journaux de proxy. Aucun en-tête CSP ni anti-iframe sur les fichiers statiques | `web_server.rs:1561-1575, 1631-1633` | CL | jeton dans le premier message WS ou sous-protocole ; en-têtes `CSP` et `frame-ancestors` |
| GDS-02 | `revalidate_session` garde le rôle du jeton si la base est injoignable. Une route d'administration qui n'interroge pas la base (redémarrage ou arrêt du service) resterait accessible à un compte rétrogradé pendant une panne de la base | `gds-core/src/http.rs:857-860` | H | refuser les routes admin quand la revalidation est impossible |
| SQL-01 | `super_agent_db_query` filtre sur le préfixe « SELECT » et ouvre une connexion en lecture-écriture | `super_agent.rs:1274-1280` | CL (code), impact limité | ouvrir la base en `SQLITE_OPEN_READ_ONLY` |

---

## 5. Tests et builds réellement exécutés

| Élément | Résultat réel (fichiers du harnais) |
|---|---|
| Résumé | `validation-summary.json` : `"tests": []`, `"commands": []`, `"ok": false` |
| Installation npm isolée | **échec, code 1**. Journal `validation-logs/dependency-install.log` : `bwrap: Can't create file /work: Read-only file system`. Le bac à sable n'a pas pu créer son dossier de travail : c'est une panne d'environnement, pas du projet. |
| Node | v26.12.0 (version du harnais. Je n'ai pas vérifié si elle correspond à celle attendue par le projet) |
| Isolation prévue | bubblewrap, copie jetable, espaces de noms PID et réseau séparés |
| Rust | **non exécuté** : `cargo` absent, installation non autorisée |
| Tests front (Vitest) | **0 exécuté** |
| Tests Rust (`cargo test --workspace`) | **0 exécuté** |

**Nature des tests (observation par lecture) :**
- `src/js` contient **314** fichiers `*.test.js`, dont **234** utilisent `readFileSync` (310 appels). Beaucoup sont des « verrous de source » qui cherchent des chaînes dans le code au lieu de tester un comportement.
- Même pratique côté Rust : `gds-core/src/http.rs:2697-2922` (`body_of("pub async fn auth_middleware…")`) et `lib.rs:4518-4525` (`assert!(!extension.contains("bash"))`).
- Ces verrous empêchent des retours en arrière textuels. Ils ne prouvent pas que le comportement est correct et cassent au moindre renommage.
- **Point trompeur** : aucun test trouvé ne vérifie que la prévisualisation neutralise le HTML, que le mode lecture seule distant couvre toutes les routes, ou que la session de l'Assistant est réellement privée de `bash`.
- **Plateformes** : aucune validation Linux, Windows ou macOS n'a été faite dans cette revue. `AGENTS.md:474-484` décrit une CI Ubuntu + Windows (chemin critique) et macOS hors chemin critique. Je n'ai pas vérifié ses résultats.

---

## 6. Risques d'architecture et dette technique (distincts des défauts prouvés)

1. **Modules géants.** `super_agent.rs` dépasse 11 000 lignes (tests inclus), et `agent_service.rs`, `lib.rs` (plus de 5 000 lignes) et `gds-core/src/http.rs` (environ 3 000 lignes) suivent. La revue, les tests ciblés et la répartition des responsabilités deviennent difficiles.
2. **Sécurité par consignes plutôt que par capacités.** Lecture seule de l'Assistant, agents `readonly`, « Discussion seule » : les garanties sont surtout textuelles (consignes, heuristiques de phrases). Les capacités réelles des processus ne sont pas limitées.
3. **Front de bureau tout-puissant.** Toutes les commandes Tauri acceptent n'importe quel chemin (`files.rs` sans validation) et aucun manifeste ne les restreint. N'importe quelle XSS du front devient une compromission complète. XSS-01 en est l'exemple.
4. **Contenu de projet injecté dans les agents.** `.pilot/context-inject.md` part dans le prompt système (`files.rs:111-125`), et `.pilot/commands.json` est exécutable depuis le web distant (`web_server.rs:1322-1368`). Ces fichiers vivent dans le projet et voyagent avec lui (git, GDS). Je n'ai pas vérifié si un dépôt cloné peut injecter du contexte avant sa réécriture par Pilot.
5. **État partagé par `Mutex` std et `.lock().unwrap()` partout.** Une panique sous verrou empoisonne le `Mutex`, et les appels suivants paniquent en chaîne. C'est une hypothèse de fragilité, pas un défaut observé.
6. **Écritures non atomiques en général** (coffre, configuration, fichiers distants, commandes) : il faudrait une fonction commune.
7. **Confiance « première venue » et identité déclarative en GDS.** Initialisation de l'administrateur publique. Sur la voie historique, l'identité de publication vient de `.pilot/gds.json` et non d'une preuve.
8. **Tests à base de chaînes** (voir §5) : ils coûtent en maintenance et donnent un faux sentiment de couverture.

---

## 7. Plan de corrections priorisé (rien n'a été appliqué)

| Lot | Contenu | Dépend de | Remarques |
|---|---|---|---|
| **A — Front et contenus non fiables** (P0/P1) | XSS-01 (désinfection, CSP, Mermaid strict), LNK-01 (liste blanche de schémas), manifeste de commandes Tauri | — | La CSP peut casser KaTeX, Mermaid ou des styles en ligne : à valider à l'écran sur les trois OS. Le manifeste demande d'inventorier tous les `invoke`. |
| **B — Distant** (P1) | WEB-01 (middleware lecture seule unique, rôle et identité sur les routes GDS du poste), WEB-04, WEB-02 | — | Indépendant de A. |
| **C — Assistant et agents** (P1/P2) | AST-01 (restriction d'outils, blocage en cas d'erreur, `realpath`), ORC-01 | vérifier que pi et `plh` prennent en charge la restriction d'outils | Dépend du moteur pi. |
| **D — Intégrité des données** (P1/P2) | fonction d'écriture atomique, puis VLT-01, configuration, `file_save` + détection de conflit (WEB-03), verrou du coffre | — | D en premier si l'on craint la perte du coffre. |
| **E — Robustesse RPC** (P2/P3) | RPC-01 (UTF-8), RPC-02 (délai réel), RPC-03 à 05 | — | Faible risque, bien testable par callback. |
| **F — GDS** (P2/P3) | GDS-01 (jeton d'initialisation), GDS-02, plus une revue dédiée des migrations, verrous et portage | revue complémentaire | Domaine non couvert ici. |
| **G — Tests** | remplacer progressivement les verrous de source par des tests de comportement sur A à E | A à E | — |

**À confirmer avec Patrick avant toute modification :**
1. Le HTML brut en prévisualisation (`html: true`) est-il une fonction voulue ? Quels usages en dépendent (balises `<details>`, images dimensionnées…) ?
2. Le mode lecture seule distant doit-il couvrir le GDS, le changement de modèle et la compaction ? La spec dit oui (« complet »).
3. L'Assistant a-t-il besoin de `bash` (consultation `git log`, etc.) ? Faut-il une liste blanche de commandes ?
4. Quels outils pi sont actifs par défaut, et `pi`/`plh` acceptent-ils une restriction d'outils au lancement ?
5. Le service GDS est-il prévu pour être joignable avant son initialisation ?

---

## 8. Conclusion

Je ne certifie pas que le code est « sans bug ». La revue couvre en détail le serveur distant, l'authentification, le coffre, la prévisualisation, le cœur RPC et le lancement de l'Assistant. Elle ne couvre que par échantillons ou pas du tout le GDS en profondeur, la chaîne de livraison, l'audio, MCP, Telegram, le client web et l'interface.

**Aucun test, aucun build, aucune validation visuelle et aucune exécution sous Linux, Windows ou macOS n'ont eu lieu.** L'installation npm a échoué dans le bac à sable et Cargo est absent. Les constats marqués « CL » viennent de la lecture du code au commit `6d57ddd`. Ceux marqués « H » dépendent d'un comportement externe (Tauri v2, outils par défaut de pi) à confirmer par exécution en environnement jetable.

Les deux priorités sont :
1. **Neutraliser le HTML de la prévisualisation et restreindre les commandes du front** (XSS-01).
2. **Rendre réellement effectives les promesses de lecture seule** de l'accès distant (WEB-01) et de l'Assistant (AST-01).

Ces deux chantiers sont indépendants et peuvent être menés en parallèle, après accord de Patrick sur les points du §7.