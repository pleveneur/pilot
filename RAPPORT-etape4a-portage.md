# RAPPORT — Étape 4a : le POSTE se branche sur les routes de portage

> Chantier « mode réseau multi-postes » (GDS partagé). **Étape 4a uniquement.**
> Les étapes 1, 2 et 3 sont livrées et vérifiées (commits `35bee91`, `5b9e2b4`,
> puis `f8e110d` — l'équivalent local de l'étape 3 citée `c671b31` dans la
> consigne). **Rien n'a été relu, relancé ni recommité** de ces trois étapes.

## 1. Premier constat (état du dépôt au démarrage)

- Aucune trace de « handover » côté poste : `grep -rn handover src-tauri/src` et
  `src/js` ne renvoient **rien**. Le poste n'appelait donc aucune des 5 routes :
  l'étape 4a part de zéro.
- **Client GDS existant à imiter** : `src-tauri/src/gds_admin.rs` (helpers
  `http_client` / `send_get` / `send_post_json` / `Reply` / `admin_error_message`)
  et `src-tauri/src/gds_service.rs` (`ServiceSession` : ouverture de session avec
  le **compte GDS** de l'utilisateur, jeton gardé en mémoire du poste, base URL
  résolue par `admin_base_url`).
- **Config GDS locale de la MACHINE** : `~/.pilot/gds_secrets.json` — structure
  `GdsSecrets` dans `src-tauri/src/gds.rs`, lecture `read_gds_secrets`, écriture
  `write_gds_secrets`, valeurs par défaut par `#[serde(default)]`, permissions
  0600 sur Unix. C'est le seul magasin GDS **de la machine** ; `GdsConfig`
  (`.pilot/gds.json`, dans `gds-core/src/config.rs`) est **par projet** et vit
  dans le socle déclaré clos par la consigne.
- Compteurs desktop **avant** modification :
  `cargo test --manifest-path src-tauri/Cargo.toml --lib` →
  **722 passed, 1 ignored**.

## 2. Ce qui a été ajouté, et où

### 2.1 Nouveau module `src-tauri/src/gds_handover.rs` (~650 lignes, tests inclus)

Pendant **poste** des routes du socle. Il ne contient aucune règle de portage,
aucun code de statut inventé : il appelle et traduit.

| Partie | Contenu |
|---|---|
| Formes d'échange (pures) | `portage_body`, `force_body`, `state_path` + les 4 chemins (`TAKE_PATH`, `HEARTBEAT_PATH`, `RETURN_PATH`, `FORCE_PATH`) |
| Traduction des réponses (pure) | `classify_reply`, `is_business_refusal`, `accepted_value`, `refused_value` |
| Résolution | `handover_context` (config projet → compte GDS → `poste_id`), `server_project_id`, `project_id_from_listing` (pure) |
| Client des 5 routes | `take`, `state_of`, `give_back`, `heartbeat`, `force` |
| Commandes Tauri | `gds_handover_take`, `gds_handover_state`, `gds_handover_return` |

### 2.2 Trois fichiers existants touchés (ajouts seulement, aucune ligne retirée)

| Fichier | Ajout | Pourquoi |
|---|---|---|
| `src-tauri/src/gds.rs` | champ `poste_id` dans `GdsSecrets`, fonctions `poste_id_from` (pure) et `poste_id()` | identifiant de machine, rangé dans la config GDS locale existante, même mécanique (défaut serde, écriture disque, relecture) |
| `src-tauri/src/gds_admin.rs` | `Reply::body()` (accesseur) | le portage doit classer sur (statut, **corps**), pas sur un message déjà aplati ; un refus métier n'est pas une panne |
| `src-tauri/src/gds_service.rs` | `post_reply()` / `get_reply()` | appels authentifiés **bruts** (statut conservé) avec le jeton du compte GDS de toujours ; aucune autorité nouvelle, même politique 401 (session oubliée → reconnexion à l'appel suivant) |
| `src-tauri/src/lib.rs` | `mod gds_handover;` + les 3 commandes enregistrées dans `tauri::generate_handler!` | une commande non enregistrée ne marche pas |

**Aucune modification** de `gds-core/*`, des migrations, des workflows, d'un
fichier JS/CSS, d'une spec, du plan ni de `plan_dev.md`.

## 3. `poste_id` : généré une fois, jamais par projet

- **Emplacement** : `~/.pilot/gds_secrets.json`, champ `poste_id` de `GdsSecrets`
  (config GDS **de la machine**, à côté des fiches serveur et de l'identité
  globale). **Pas** dans `.pilot/gds.json`, qui est par projet — deux postes
  ouverts sur le même projet doivent porter des identifiants différents.
- **Génération** : `UUID v4` (crate `uuid`, déjà dépendance du desk), au **premier
  besoin** seulement, puis écrit sur disque immédiatement.
- **Stabilité** : une valeur déjà mémorisée est reprise telle quelle (rognée) et
  le générateur n'est **jamais** rappelé. Un échec d'écriture remonte une erreur
  explicite (sinon l'identifiant serait régénéré au démarrage suivant et le
  serveur verrait un « autre poste »).
- **Indépendance vis-à-vis du projet** : `poste_id()` ne reçoit aucun chemin de
  projet ; la même valeur est recopiée dans chaque appel, projet par projet.
  L'idempotence de la prise en main reste faite **projet par projet** par le
  serveur (même compte + même machine = `renew`).
- **Concurrence** : le cycle « lire → générer si absent → écrire » est protégé par
  un verrou statique (`POSTE_ID_LOCK`), pour que deux projets ouverts en même
  temps ne produisent pas deux identifiants dont un seul serait conservé.

## 4. Forme exacte des échanges avec le serveur (relevée dans `gds-core/src/http.rs`)

Authentification : jeton de session du **compte GDS** de l'utilisateur
(`POST /api/gds/users/login` via `ServiceSession`), en-tête `Authorization:
Bearer …`. Base URL : celle de la fiche serveur du projet (`admin_base_url`).

| Opération | Requête | Succès | Refus |
|---|---|---|---|
| Prendre en main | `POST /api/gds/handover/take` corps `{ "project_id": 12, "poste_id": "<uuid>" }` | `200 { ok, action: "insert"\|"renew"\|"close_then_insert", state }` | `409 { error, project_id, holder{user_id,poste_id}, until }` ; `403`, `404`, `400` |
| État | `GET /api/gds/handover/state?project_id=12` (paramètre de requête, **pas** de corps) | `200 { ok, state }` | `400`, `404` |
| Rendre | `POST /api/gds/handover/return` corps `{ "project_id", "poste_id" }` | `200 { ok, id, state }` | `409 { error, project_id, holder }` ; `403`, `404`, `400` |
| Présence (4b) | `POST /api/gds/handover/heartbeat` corps `{ "project_id", "poste_id" }` | `200 { ok, state }` | `409 { error, project_id, holder }` |
| Libération forcée (admin) | `POST /api/gds/handover/force` corps `{ "project_id", "reason" }` | `200 { ok, id, returned_by, return_reason, state }` | `403` non-admin, `409` motif vide / aucune prise en main |

`state` (relu par le serveur après écriture) :
`{ project_id, open_row_id, holder{user_id,poste_id}, taken_at, heartbeat_at, expires_at, expired }`.

**Traduction côté poste** (`classify_reply`, fonction pure) :

- `2xx` → **accepté** : corps du serveur conservé (`ok`, `action`, `id`, `state`)
  enrichi de `handover` (type d'opération) et `poste_id` ;
- `400 / 403 / 404 / 409` → **refus métier lisible** :
  `{ ok:false, refused:true, handover, status, error, poste_id }` + `project_id`,
  `holder`, `until` quand le serveur les donne. Ce n'est **jamais** une erreur
  technique : la commande rend `Ok(...)`, l'interface peut l'afficher ;
- `401` → erreur lisible « Session GDS refusée (401) : relancez l'opération… »
  (la session a déjà été oubliée par l'appel, donc un nouvel essai se reconnecte) ;
- `5xx` / réponse inattendue / réseau → erreur (`Err`), seul cas de panne.

Le **`project_id`** n'existe pas dans `.pilot/gds.json` : il est résolu côté
poste par `GET /api/gds/projects` (route déjà utilisée), en cherchant le nom du
projet (dossier local) puis le `repo_name` (`project_id_from_listing`, pure). Si
le projet est absent du serveur : message d'action (« ajoutez-le d'abord au
GDS »), jamais un identifiant deviné.

## 5. Tests — résultats RÉELS

- **Desktop, avant** : `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  → **722 passed, 1 ignored**.
- **Desktop, après** : même commande → **735 passed, 1 ignored** (+13 tests,
  **aucun écart** : aucun test existant cassé, aucune régression de compteur
  ailleurs).
- **Frontend** : `npm test` → **168 fichiers / 2917 tests passed** (aucun fichier
  JS touché ; vérification de non-régression seulement).
- `cargo check --lib` sur les 4 fichiers touchés → **aucun avertissement** nouveau.

Les 13 tests ajoutés (`src-tauri/src/gds_handover.rs`, module `tests`) ne
dépendent **ni d'un vrai serveur, ni d'une vraie base** (la couche réseau reste
isolée dans `gds_service` ; tout ce qui est vérifié ici est pur) :

| Test | Ce qui est verrouillé |
|---|---|
| `poste_id_is_generated_once_then_never_regenerated` | deux lectures = même valeur, format UUID, valeur réellement écrite dans la config GDS locale |
| `poste_id_is_the_same_for_every_project_of_the_machine` | deux `gds.json` de projets différents ne changent pas l'identifiant (3 lectures identiques) |
| `poste_id_from_keeps_an_existing_value_and_only_writes_when_created` | une valeur mémorisée n'est jamais régénérée (générateur non appelé), écriture seulement à la création |
| `portage_body_matches_server_shape` | corps `{project_id, poste_id}` = `HandoverPortageBody`, `poste_id` rogné, **aucun champ inventé** |
| `force_body_carries_project_and_trimmed_reason` | corps `{project_id, reason}` = `HandoverForceBody` |
| `state_path_uses_the_query_parameter_the_route_expects` | `?project_id=` (paramètre de requête) + les 4 chemins de route |
| `business_refusals_are_recognised_as_refusals` | 400/403/404/409 = refus ; 401/500 = pas des refus métier |
| `refusal_409_keeps_the_server_message_and_the_holder` | 409 (corps exact du serveur) → `ok:false, refused:true, status, error, holder, until` |
| `refusal_403_and_404_are_readable_and_never_technical` | 403 et 404 restent des refus lisibles (jamais `Err`) |
| `refusal_without_error_field_falls_back_to_a_generic_libelle` | corps vide/non-JSON → libellé générique, pas de panique |
| `technical_failures_stay_errors` | 500 et 401 remontent une erreur, message lisible |
| `accepted_reply_keeps_server_fields_and_adds_context` | succès : `action`/`state` conservés + `handover`/`poste_id` |
| `project_id_is_found_by_name_then_by_repo_name` | résolution par `name`, puis `repo_name`, tolérance de casse, et `None` si absent (jamais un id deviné) |

## 6. Ce que cette étape NE fait PAS (étape 4b)

- **Aucune présence périodique automatique** : `heartbeat` existe dans le client
  mais n'est appelé par rien (`#[allow(dead_code)]` assumé, commenté).
- **Aucune séquence de restitution complète** (publier le code → pousser
  l'avancement → rendre) : `give_back` fait le seul appel `return`, sans rien
  publier ni pousser avant.
- **Aucun blocage des écritures hors portage.**
- **Aucune interface** : ni bandeau, ni bouton, ni fichier JS (étape 5). Les trois
  commandes sont enregistrées et appelables, rien de plus.
- **Aucune commande de libération forcée** (`force`) : action d'administration,
  hors périmètre du portage d'un poste. Le client existe pour ne pas réinventer
  la route plus tard.

## 7. Écarts et doutes signalés (non corrigés seul)

1. **Hash de l'étape 3** : la consigne citait `c671b31`, le dépôt porte
   `f8e110d` (« feat(gds): etape 3 portage projet (routes HTTP) ») comme HEAD.
   Aucune action prise : je n'ai pas relu ni recommité cette étape ; le contenu
   (routes handover présentes dans `gds-core/src/http.rs`) est bien là. Si
   `c671b31` devait exister, c'est à vérifier par le demandeur.
2. **Résolution du `project_id` par la liste des projets** : le socle n'expose
   aucune route « id par nom ». Le poste appelle donc `GET /api/gds/projects` à
   chaque opération (une requête HTTP de plus, lecture seule). Une route dédiée
   serait plus directe, mais elle toucherait le socle **clos** : non fait.
3. **Correspondance par nom** : le nom employé est celui du dossier local
   (`project_name`), avec un repli sur `repo_name` puis une passe insensible à la
   casse (dossiers Windows). Si un jour deux projets du serveur ne différaient que
   par la casse, la première correspondance exacte gagne — cas non rencontré
   aujourd'hui, documenté ici plutôt que corrigé au hasard.
4. **`401` classé comme panne, pas comme refus** : la consigne cite 409/403/404
   comme refus ; 401 (session expirée) n'est pas une décision de portage. Le
   jeton est oublié pour que l'essai suivant se reconnecte. À confirmer si
   l'étape 5 veut un message de refus plutôt qu'une erreur.
5. **Deux accesseurs ajoutés hors du nouveau module** (`Reply::body`,
   `gds_service::{post_reply,get_reply}`) : c'est la façon la moins coûteuse de
   réutiliser la session et le style HTTP existants sans dupliquer la
   connexion. Aucun comportement existant n'est modifié (ajouts purs) — signalé
   parce que la consigne demandait de ne toucher que le nécessaire.
6. **`poste_id` dans le fichier de secrets 0600** : techniquement ce n'est pas un
   secret, mais c'est là que vit la config GDS **de la machine** ; l'y mettre
   évite un second fichier de config à gérer. Si le propriétaire préfère un
   fichier dédié (`~/.pilot/poste_id`), le changement est local à `gds.rs`.

VERDICT : ÉTAPE 4a LIVRÉE — `poste_id` de machine stable (une génération, jamais
par projet), client des 5 routes conforme aux formes du socle, refus métier
(400/403/404/409) rendus lisibles et jamais transformés en pannes, 3 commandes
enregistrées, 13 tests ajoutés sans serveur ni base, desktop 722 → 735 passed /
1 ignored, frontend 2917 passed, aucun écart ni régression constatée.
