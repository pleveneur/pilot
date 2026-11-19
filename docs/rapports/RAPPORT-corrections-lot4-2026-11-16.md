# Corrections locales : lot 4

## Bilan lot 4 : WEB-01, vrai mode distant lecture seule

WEB-01 est confirmé puis corrigé : en lecture seule, plus aucune mutation de l'API protégée du poste (routes du poste et routes GDS fusionnées) n'atteint son handler. Le test qui le prouve a été lu ROUGE puis VERT, et les suites Rust et JS restent vertes. Rien n'a été commité, HEAD est toujours `6d57ddd`.

### Constat
- **Confirmé par un test ROUGE**, avec `web_readonly=true` et un jeton valide :
  - les 14 mutations du poste atteignent leur handler (réponse 200) ;
  - `POST /api/gds/provision` exécute `provision_db` avec l'adresse fournie par l'appelant ;
  - `gds/projects` (POST), `gds/sync`, `gds/tracking/force`, `users/register` et `projects/create` vont jusqu'au pool ;
  - les autres mutations GDS montées ne s'arrêtent qu'au décodage du corps ou au contrôle d'identité, jamais sur la lecture seule.
- **Corrigé** par un garde unique, `readonly_guard`, posé par une nouvelle fonction `protect_api`. C'est elle qui fait maintenant la fusion de `gds_web::gds_router` et pose les couches de protection, à un seul endroit. L'ordre est : authentification d'abord (401 sans jeton), puis le garde, puis le handler.
  - En lecture seule, toute méthode autre que GET/HEAD/OPTIONS reçoit `403 "Mode lecture seule : action désactivée"` et une entrée d'audit `readonly_denied`.
  - Le réglage est relu à chaque requête : une session ouverte avant l'activation est bloquée tout de suite.
- **Rejeté :** la mission citait `project/browse` comme consultation en POST, mais cette route est montée en **GET** dans le code. Elle passe donc sans exception.
- **Reporté (hors mandat, le modèle de rôles ne devait pas changer) :** les routes GDS du poste ne vérifient ni le rôle ni l'identité de l'appelant HTTP. Le contrôle de rôle de `tracking/force` se fait plus loin, à partir de l'identité écrite dans le `.pilot/gds.json` du projet. J'ai seulement corrigé le commentaire trompeur de `gds_web.rs` pour le dire.

### Routes couvertes et exceptions
- **Poste, refusées en lecture seule :**
  - agent : prompt, abort, new, compact, changement de modèle ;
  - `superagent/prompt` ;
  - fichiers : PUT et POST `/api/file` ;
  - projets : open, select, create ;
  - commandes : `commands/run` et `commands/stop` ;
  - réglages : POST `/api/settings`.
- **GDS montées, refusées en lecture seule :**
  - provision, ajout de projet (`POST /api/gds/projects`), sync, `tracking/force` ;
  - register ;
  - les 8 écritures et suppressions du suivi ;
  - tickets : création, commentaires, statut ;
  - `projects/create`, `ssh-keys` ;
  - portage : `handover/take`, `heartbeat`, `return`.
- **Routes d'administration GDS :** elles ne sont pas montées sur le poste. Le serveur GDS autonome n'est pas modifié.
- **Deux exceptions explicites et testées**, dans `READONLY_POST_EXCEPTIONS` :
  - `POST /api/gds/users/login` : authentification seule ;
  - `POST /api/gds/projects/repo-exists` : lecture en base et test d'existence d'un chemin, sans effet.
- `POST /api/auth/login` reste hors de l'API protégée, donc inchangé.
- Les contrôles `is_readonly` déjà présents dans certains handlers sont conservés en défense en profondeur.

### Fichiers modifiés
- **`src-tauri/src/web_server.rs`** :
  - le trait injectable `WebReadonly` (lecture à chaud du réglage pour `WebCtx`) ;
  - `protect_api`, `readonly_allows`, `readonly_guard` ;
  - le module de tests `readonly_guard_tests`.
  - Les changements des lots 1 à 3, dont `stream_pipe`, sont intacts.
- **`src-tauri/src/gds_web.rs`** : deux commentaires seulement.
- **`spec_web_remote.md`** : § 6.4 c, tableau `web_readonly`, § 13.8 et rechargement à chaud. Le bloc HELP n'est pas modifié, parce que `handbook.md` est généré et hors du périmètre autorisé.

### Commandes et runs réels
| Run | Commande | Résultat |
|---|---|---|
| ROUGE | `check-rust-compat.py --package pilot --filter readonly_guard_tests` | 2 réussis, 2 échecs (`…refuse_chaque_mutation_avant_effet`, `activation_a_chaud_sans_reconnexion`) ; fuites listées ci-dessus |
| VERT | même commande, après ajout du garde | 4 réussis, 0 échec |
| Non-régression | `--filter gds_web` | 4 réussis, 0 échec |
| Rust complet | `--package pilot` (exécute `-p pilot --lib`) | 987 réussis, 0 échec, 3 ignorés |
| JS et build | `check.py` | 6000 réussis, 0 échec, 1 en attente, build OK |

La baseline annonçait 1156 réussis et 14 ignorés pour Rust. Le helper ne lance ici que `-p pilot --lib`, ce qui explique sans doute l'écart. Je n'ai pas pu exécuter un périmètre plus large avec les commandes autorisées.

### Limites
- **Branchement de production :** les tests utilisent la vraie fonction `protect_api` avec le vrai `gds_router`, mais un contexte espion sans Tauri. Les handlers propres au poste exigent un `AppHandle` : ils sont remplacés par des espions montés sur les mêmes méthodes et chemins que `build_router`. Le passage de `build_router` par `protect_api` est vérifié par lecture, pas par un test, car la fonction de test de Tauri n'est pas activée et changer `Cargo.toml` était interdit.
- **Nouvelles routes :** le refus repose sur la méthode, donc une route ajoutée plus tard sera couverte automatiquement. En revanche, la table recopiée dans le test ne se mettra pas à jour seule.
- **Changement de comportement voulu :** en lecture seule, le mode d'interface (assistant ou agents) se change encore dans la page, mais n'est plus enregistré sur le poste. Le client affiche seulement une erreur dans la console du navigateur.
- **Routes GET :** je n'ai pas audité en profondeur les GET du GDS ni `/ws/agent`. Je les ai considérés comme des lectures.
- **Journaux du helper :** ils sont hors du dossier de travail et je n'ai pas pu les lire, donc je n'ai pas vérifié l'absence d'avertissements de compilation.
- **Non validés :** vrai serveur, PostgreSQL, GUI, Windows et macOS.
- **Commande refusée :** une tentative de retouche du fichier par script Python a été refusée. J'ai fait la modification avec l'éditeur, sans contournement.

Ce lot ne termine pas l'audit global.