# Rapport — L'écriture est gardée par le socle, pas par l'écran

> Mode réseau multi-postes, **étape 5**. Deux manques honnêtes avaient été
> déclarés par l'agent précédent, tous deux côté Rust. Ils ont été **vérifiés sur
> le disque avant d'être touchés**, puis fermés. Rien n'a été inventé : chaque
> affirmation ci-dessous vient d'une lecture de fichier ou d'une commande
> exécutée dans cette session.

---

## 1. Les deux manques, constatés sur le disque

### 1.1 La libération forcée existait dans la règle, mais était inatteignable depuis un poste

**Ce que j'ai trouvé (et non ce qu'on m'a raconté) :**

| Endroit | Constat |
|---|---|
| `src-tauri/src/gds_handover.rs` | `force_body(project_id, reason)` (l. 60) construisait le corps, `FORCE_PATH` (l. 43) nommait la route, mais la fonction `force()` qui devait l'envoyer était morte (aucun appelant, `#[allow(dead_code)]`). |
| `gds-core/src/http.rs` | La route `POST /api/gds/handover/force` existe bien, montée dans `admin_routes`, donc **déjà protégée par `require_admin`**. |
| `src-tauri/src/lib.rs` | **Aucune** commande Tauri ne l'exposait : `gds_handover_take`, `gds_handover_state`, `gds_handover_return`, `gds_handover_can_write`, `gds_handover_presence_now` — et rien pour `force`. |
| `src/js/gds-admin.js` | La branche `"release-confirm"` **n'appelait aucune commande**. Elle re-vérifiait le rôle, validait le motif, puis écrivait une ligne de trace locale avec `applied: false` et un commentaire avouant : « la libération depuis un poste n'est pas encore installée (aucune commande côté poste) : on ne fait pas semblant ». |
| `spec_gds.md` | Le manque était **écrit** dans la spec (limite assumée et affichée). |

**Conséquence réelle** : l'administrateur pouvait saisir un motif, confirmer, et
le projet **restait tenu**. Le bouton disait la vérité, mais il ne libérait rien.

### 1.2 Le blocage d'écriture n'était pas tenu par le socle : seul l'écran refusait

**Ce que j'ai trouvé :** `gds_handover.rs` exposait déjà la bonne décision
(`WriteVerdict`, `write_verdict(value, poste_id)` l. 1012, `gate()`,
`peek_write_gate`, `ensure_write_allowed`, `CLAIM_REQUIRED_MESSAGE`) et les
messages français étaient déjà rédigés. Mais le seul appelant de production de
cette garde était **une** fonction de synchronisation
(`gds_sync.rs::gds_force_push_suivi`).

Donc, projet tenu par un autre poste, ces gestes **passaient** :

- `files::write_file_content`, `files::write_file_binary` (écriture de fichier) ;
- `create_file`, `create_folder`, `delete_file_or_dir`, `rename_file_or_dir`,
  `copy_image_to_project` ;
- `agents::start_agent_process` et `rpc::start_agent_session` — **lancer un
  agent** sur le projet : l'agent écrivait alors tout ce qu'il voulait.

Le bandeau et les boutons refusaient ; le socle, non. **Un refus qui vit
seulement à l'écran n'est pas une garde.**

---

## 2. Ce qui a été ajouté

### 2.1 `src-tauri/src/gds_write_guard.rs` — la garde, dans le cœur (fichier neuf, 509 lignes)

- **Une seule décision, pure et partagée** :
  `decide(probe: Probe, poste_id: &str) -> GuardDecision` (l. 94), avec
  `GuardDecision::{Allow, Refuse(String)}` et `into_result()`.
- **Elle ne réinvente aucun vocabulaire** : le refus est celui du portage, rendu
  par `gds_handover::write_verdict`. Un seul jeu de messages dans tout Pilot.
- **`Probe`** = `Etat(Value)` (le serveur a répondu) ou **`Panne`** (il n'a pas
  répondu). La sonde `probe()` (l. 224) appelle `gds_handover::peek_write_gate`
  sous `tokio::time::timeout(GUARD_TIMEOUT = 3 s)` : injoignable, délai dépassé
  ou réponse inexploitable ⇒ **`Panne`, jamais un refus**.
- **Coût réseau maîtrisé** : verdict mémorisé `GUARD_TTL = 5 s`, cache borné à
  32 projets (`GUARD_CACHE`), clé normalisée (`cache_key`). Un enregistrement de
  fichier ne paie pas un aller-retour réseau à chaque frappe.
- **Résolution du projet d'un chemin** : `project_of_path(projects, path)` (l. 131)
  choisit le projet **le plus spécifique** qui contient le chemin (sous-projets
  liés), avec la normalisation de `lib.rs` (antislashs, `/` final, casse Windows
  seulement) ; `ensure_path_writable` (l. 243) et `ensure_project_writable`
  (l. 255) sont les deux portes publiques.

### 2.2 La règle cardinale : **jamais** de blocage du travail local (fail-open)

`ensure_project_writable` rend `Ok(())` **sans même interroger le serveur** si :

1. le projet est vide ou inconnu des projets ouverts ;
2. GDS est désactivé globalement (`gds_globally_enabled`) ;
3. `.pilot/gds.json` est absent ou porte `enabled: false` ;
4. `gds::poste_id()` échoue ;
5. le serveur ne répond pas, répond trop tard (3 s), ou répond quelque chose
   d'inexploitable (`Probe::Panne`, l. 98).

Autrement dit : **mode réseau non configuré, serveur muet, projet libre ou tenu
par soi ⇒ comportement identique à aujourd'hui, au bit près.** Un refus ne peut
naître que d'une réponse **du serveur** disant qu'un **autre** poste tient le
projet, ou que la prise en main de ce poste a **expiré**.

### 2.3 La libération forcée, enfin atteignable

- `gds_handover.rs` : l'ancienne `force()` morte est remplacée par quatre
  **pures**, testables sans réseau —
  `force_payload` (l. 387 : projet > 0, motif non vide **contrôlé avant l'appel**),
  `force_trace_key` (l. 403), `force_trace_line` (l. 414 : poste + projet +
  compte + motif + `resultat=liberee|refusee`, champs nettoyés et bornés),
  `trace_force_release` (l. 444, repère local via `gds_sync::write_sync_marker`).
- `gds_admin.rs` : nouvelle commande **`gds_handover_force`** (l. 1007), dans le
  même style que les autres commandes d'administration — elle ouvre la session
  d'administration (`admin_action`, jeton du compte, une seule reconnexion sur
  401), poste le corps sur `gds_handover::FORCE_PATH`, puis **écrit la trace dans
  les deux cas** et **rend la ligne à l'écran** (`trace`, `traced`) : une
  libération refusée est aussi une action qu'on doit pouvoir relire.
- `lib.rs` : `mod gds_write_guard;` déclaré, et la commande **enregistrée**.

### 2.4 L'écran envoie vraiment le geste

`src/js/gds-admin.js` : la branche `"release-confirm"` appelle désormais
`gds_handover_force` via `buildProjectReleaseArgs` (charge utile pure, testée),
garde ses deux protections existantes (`canReleaseProject(service.role)` et
`handoverReleaseReasonError(motif)`), **relit le motif avant tout redessin**,
recharge la liste des projets, puis affiche soit la libération, soit **la raison
du refus** (`handoverReleaseTraceLine({applied:false, error})`). Le texte
« la libération depuis un poste n'est pas encore installée » a disparu du dépôt :
il était devenu **faux**.

---

## 3. Où la garde s'applique réellement

Recompté dans les sources de production : **9 commandes gardées** (9 appels
`ensure_*`), plus la garde d'écran (qui reste, comme première ligne).

| Commande | Porte | Fichier |
|---|---|---|
| `write_file_content` | `ensure_path_writable` | `files.rs` (l. 89) |
| `write_file_binary` | `ensure_path_writable` | `files.rs` (l. 134) |
| `create_folder` | `ensure_path_writable` | `lib.rs` (l. 2869) |
| `delete_file_or_dir` | `ensure_path_writable` | `lib.rs` (l. 2879) |
| `create_file` | `ensure_path_writable` | `lib.rs` (l. 2894) |
| `copy_image_to_project` | `ensure_project_writable` | `lib.rs` (l. 3211) |
| `rename_file_or_dir` | `ensure_path_writable` (sur la **source**) | `lib.rs` (l. 4157) |
| `start_agent_process` (bus d'agents) | `ensure_project_writable` | `agents.rs` (l. 222) |
| `start_agent_session` (onglet agent) | `ensure_project_writable` | `rpc.rs` (l. 482) |

Deux conséquences de méthode, dites explicitement :

- `write_file_content` / `write_file_binary` sont devenus **`async`** et
  reçoivent `State<'_, AppState>` ; `start_agent_session` aussi. Ce sont des
  changements de **signature côté Rust uniquement** — les noms de commandes et
  leurs arguments côté JS ne bougent pas, aucun appelant n'est cassé.
- `copy_image_to_project` est gardé **au niveau du projet** (et non du chemin) :
  la cible est calculée à partir du projet actif et le dossier `images/` peut ne
  pas exister encore — demander une garde sur un chemin inexistant serait un
  faux refus.

### 3.1 Côté serveur, la libération reste réservée à l'administrateur — trois étages

1. **Écran** : `canReleaseProject(role)` (bouton absent et refus dit pour un
   autre rôle).
2. **Session** : `open_admin_session` interroge `GET /api/gds/admin/server` ; un
   compte `dev` reçoit 403 ⇒ `admin_action` rend `{ ok: false, error }`.
3. **Socle** : la route est montée dans `admin_routes` avec `require_admin` (et
   `gds_core::roles::can_force_publish`). C'est le seul juge.

Un **non-administrateur** reçoit donc un refus **lisible** : `invokeAccounts`
transforme tout rejet en `{ ok: false, error }` (`gds-admin.js`), l'écran affiche
la raison, **et la tentative est tracée**. Aucun plantage, aucun mensonge.

---

## 4. Preuve que la commande est enregistrée (l'oubli silencieux)

Une commande Rust non enregistrée **compile parfaitement** : le bouton ne fait
simplement rien. C'est exactement le défaut qu'on vient de corriger ; il ne peut
pas revenir en silence.

- `tauri::generate_handler![` compte **377 entrées** recomptées entre son
  ouverture et son `])` (l. 3642 → 4102 de `lib.rs`) ;
- `gds_admin::gds_handover_force` y figure **une seule fois** (l. 4010), et un
  test l'exige : `gds-garde-ecriture.test.js` découpe le bloc par `sliceSource`
  et vérifie **présence + unicité**.
- `mod gds_write_guard;` est déclaré **une fois** dans `lib.rs`, également
  vérifié par test.

---

## 5. Preuve des quatre situations (et de leur morsure)

Les quatre situations sont jouées **séparément** dans
`gds_write_guard::tests` (`cargo test --lib gds_write_guard`) :

| Situation | Test | Attendu |
|---|---|---|
| **Tenu par un autre poste** | `situation_1_projet_tenu_par_un_autre_poste_est_refuse` | `Refuse`, message contenant « autre poste », l'échéance et « lecture seule » |
| **Tenu par ce poste** | `situation_2_projet_tenu_par_ce_poste_est_accepte` (+ casse et espaces) | `Allow` |
| **Libre** | `situation_3_projet_libre_est_accepte` (+ état hérité sans `holder`) | `Allow` |
| **Réseau muet / injoignable** | `situation_4_reseau_muet_est_accepte_jamais_un_blocage` | `Allow` |

Plus : prise en main expirée ⇒ accepté ; refus rendu en **erreur lisible** et non
en plantage ; chemin dans / hors projet ; séparateurs Windows et mélangés ;
sous-projet le plus spécifique ; verdict **réutilisé puis oublié** (TTL) ; verdict
remplacé et mémoire **bornée**.

### 5.1 Les morsures ont été vérifiées par mutation (fait, pas promesse)

Trois sabotages temporaires ont été appliqués, les tests ont **échoué**, puis les
fichiers ont été restaurés et les suites sont redevenues vertes :

| Sabotage | Résultat observé |
|---|---|
| Retirer `ensure_path_writable` de `write_file_content` (garde devenue purement visuelle) | **FAIL** — « MORSURE : écrire un fichier texte passe par la garde du socle, AVANT d'écrire » |
| Faire refuser `Probe::Panne` (une panne réseau bloquerait) | **FAIL** — `situation_4_reseau_muet_est_accepte_jamais_un_blocage` |
| Retirer `gds_admin::gds_handover_force` de `generate_handler!` | **FAIL** — « MORSURE : la commande est dans la liste des commandes de l'application » |

C'est ce qui distingue un test d'une décoration : **il tombe quand le défaut
revient**.

---

## 6. Tests — comptes avant / après

| Suite | Avant ce lot | Après ce lot |
|---|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **759 passed, 1 ignored** | **775 passed, 1 ignored** (+16) |
| `npx vitest run` | **3140 passed, 0 failed** | **3153 passed, 0 failed** (+13) |

Aucun test supprimé. Deux fichiers de tests existants ont été **ajustés, pas
affaiblis** :

- `src/js/gds-handover.test.js` : la branche de libération a **grandi** (elle
  appelle maintenant le socle) ; son découpage de source est passé d'un
  `slice(idx, idx + 1400)` à un **`sliceSource`** (ancre qui bouge ⇒ échec, plus
  jamais un fragment vide vrai par construction). Les assertions sont les mêmes,
  aucune n'a été retirée.
- Aucun autre test touché.

Nouveaux fichiers de preuve :

- **Rust** : `gds_write_guard.rs` (12 tests) et `gds_handover.rs` (+4 tests :
  charge utile refusée avant l'appel, trace qui nomme tout et ne ment jamais,
  trace qui survit aux champs vides ou contenant le séparateur, clé unique par
  projet).
- **JS** : `src/js/gds-garde-ecriture.test.js` (13 tests) — il lit **le source
  Rust** et échoue si : une des 7 commandes d'écriture ou un des 2 lancements
  d'agent perd sa garde ; `Probe::Panne => Allow` disparaît ; la commande de
  libération quitte la liste d'enregistrement ; elle cesse de passer par la
  session d'administration ; le motif cesse d'être contrôlé avant l'appel ; la
  tentative cesse d'être tracée ; l'écran cesse d'envoyer la commande.

---

## 7. Ce qui reste ouvert (dit franchement)

1. **Un agent déjà lancé n'est pas arrêté** quand un autre poste prend le projet :
   la garde s'applique **au lancement** et à chaque écriture d'outil passant par
   les commandes gardées ; elle ne révoque pas une session en cours.
2. **Le terminal intégré n'est pas gardé** (et ne doit pas l'être : un shell sert
   justement à tout faire). C'est une porte de sortie assumée, pas un oubli.
3. **Les outils d'écriture internes de l'agent** (write/edit du moteur pi) ne
   repassent pas tous par ces commandes : la protection vient du lancement
   (point 1) et de la porte pré-écriture existante (A4). Les réunir demanderait
   de brancher la garde dans l'extension Rust de l'agent — hors de ce lot.
4. **Le refus 403 d'un non-administrateur** est prouvé par la règle du socle
   (`require_admin` sur `admin_routes`, ses propres tests avec base) et par la
   sonde de session ; je n'ai **pas** de serveur vivant ici pour le rejouer de
   bout en bout. Je ne prétends donc pas l'avoir observé sur un vrai serveur.
5. `rename_file_or_dir` garde la **source** — un renommage déplace aussi la
   cible ; dans le cas normal les deux sont dans le même projet, cas d'un
   déplacement entre deux projets non couvert.

---

## 8. Documentation mise à jour

- `spec_gds.md` : §5.4 (libération désormais atteignable : commande, session
  d'administration, route du socle, motif contrôlé avant l'appel, trace auditée,
  refus propre d'un non-administrateur) et **nouvelle §5.5** « Garde d'écriture
  tenue par le SOCLE » (règle cardinale fail-open, liste exacte des commandes
  gardées, coût, messages, preuves).
- `PLAN-mode-reseau-multipostes.md` §6 d) : la garde côté poste est **implémentée**
  (module, commandes, fail-open), renvoi vers `spec_gds.md` §5.5.
- `help/overview.md` (bloc `HELP:gds`, **puis `npm run build:handbook`**) : dit à
  l'utilisateur que le refus d'écriture **n'est pas qu'un message** (Pilot refuse
  d'enregistrer, créer, supprimer, renommer, coller une image et **de lancer un
  agent**), que **sans réseau rien ne change**, et que le bouton **Libérer**
  libère **réellement** le projet (aucune donnée supprimée, action auditée).
  `help/handbook.md` n'a **pas** été édité à la main : il est régénéré.

---

## 9. Portée du lot

Aucune donnée, migration ou fichier utilisateur supprimé. Aucune modification de
`release.yml`, du CI de publication, de la colonne de gauche, des thèmes, de la
prise en main, de la barre du bas, du coin haut-droit ni des voix locales. La
restitution ordonnée (code → avancement → return) et le cycle de présence ne sont
pas touchés : la garde ne fait que **lire** l'état du portage (`peek_write_gate`).

VERDICT : les deux manques déclarés sont fermés et tenus par le socle — la libération forcée est atteignable par une commande enregistrée (administrateur seul, motif obligatoire, tentative tracée et auditée), et les 9 commandes d'écriture et de lancement d'agent refusent au cœur un projet tenu par un autre poste en disant la raison, tandis qu'une panne réseau ne bloque jamais rien (fail-open prouvé par un test qui tombe si elle se met à bloquer) — morsures vérifiées par mutation, 759 → 775 tests Rust et 3140 → 3153 tests JS, aucun test supprimé, aucune donnée touchée.
