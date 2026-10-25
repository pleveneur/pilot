# Rapport — socle de la prise en main à la première ouverture

Lot invisible. **Rien de visible à l'écran** : aucun HTML, aucun CSS, aucun
écran, aucun bouton, aucun modal. Le produit se comporte exactement comme avant
(mêmes écrans, mêmes couleurs, même colonne de gauche, mêmes onglets, même
panneau du bas, mêmes thèmes). La première instruction de démarrage (vérification
de l'environnement de l'agent) n'a pas été touchée : elle reste la première et
n'est pas attendue.

## Vérification de la demande reçue

La tâche reçue porte bien sur **ce lot** : socle de la prise en main à la
première ouverture, documentation d'abord, un seul champ de configuration, une
**fonction pure** de décision, une **commande de lecture seule**, des tests Rust
dont un qui **échoue** si le critère « fichier de configuration absent » est
remplacé par un simple drapeau, rien de visible, un seul commit local.

Elle ne parle ni de barre du haut, ni de coin haut-droit, ni de voix locales, ni
de barre du bas, ni de sous-thèmes, ni de renommage d'« Options », ni de retrait
de l'écran « Aide », ni de file d'attente. Rien de tout cela n'a donc été touché.
Aucun `RAPPORT-*.md` d'un autre lot n'a été commité.

## Ce qui a été ajouté

### Documentation (faite en premier)

- **`spec_onboarding.md`** (nouveau, 77 lignes) : le besoin (sur une installation
  neuve, « Lancer l'agent » ouvre un terminal, parce que `rpc_agent_enabled` vaut
  faux par défaut), le **critère d'affichage et pourquoi celui-là**, les **deux
  niveaux**, **ce qui est écrit en configuration et quand**, **ce que la prise en
  main ne fait jamais** (aucun appel payant, aucun réglage coûteux, aucune
  suppression, aucune modification d'apparence), et les renvois utiles
  (`spec_gestion_agents.md`, `spec_rpc.md`, `spec_super_agent.md`).
- **`help/overview.md`** : le bloc `<!-- HELP:demarrage -->` reçoit une section
  « **La toute première ouverture** » (ligne 39), en langage utilisateur : quoi
  faire à la première ouverture (le mode de l'agent, puis un projet), ce qu'on
  peut **passer** (le niveau 2), et **comment la revoir plus tard** (ses deux
  étapes restent accessibles : `Options ⚙️ → Agent Pi` et
  `Autres écrans ▾ → Équipe d'agents`). Le texte est vrai dans les deux
  situations : s'il n'y a pas de modale, les mêmes étapes y mènent — aucun bouton
  « revoir » n'est promis puisqu'il n'existe pas.
- **`help/handbook.md`** : régénéré par `npm run build:handbook` (45 blocs,
  266 020 octets). Aucun bloc ajouté ni supprimé : le `demarrage` est enrichi.
- **`AGENTS.md`** : une ligne de plus dans la table « Navigation rapide »
  (`| Prise en main à la première ouverture | spec_onboarding.md |`).

### Code

Tous les chiffres ci-dessous ont été **recomptés par script sur les fichiers
réels** avant et après (jamais repris de la demande).

**Recensement avant → après, dans `src-tauri/src/lib.rs`**

| Élément | Avant | Après |
|---|---|---|
| Champs de `struct AppConfig` | **157** | **158** |
| Entrées de `impl Default for AppConfig` | **157** | **158** |
| Conditions de `config_is_default` (`&& config.…`) | **17** | **18** |
| Commandes enregistrées dans `tauri::generate_handler!` (doublons : 0) | **375** | **376** |

1. **Champ unique** `onboarding_seen: bool` (`lib.rs:971`), avec
   `#[serde(default)]` — absent d'une configuration ancienne ⇒ pas encore vu ;
   présent ⇒ vu. Défaut `false` dans `AppConfig::default` (`lib.rs:1260`).
2. **Il entre dans la liste explicite de la décision « configuration restée par
   défaut »** : `&& config.onboarding_seen == default.onboarding_seen`
   (`lib.rs:1360`). Sans cette ligne, une configuration dont **seul** ce champ
   est posé serait jugée « par défaut » et le chargement paresseux pourrait
   l'écraser : la prise en main reviendrait après un redémarrage.
3. **Fonction pure** `fn onboarding_should_show(config_file_exists: bool,
   onboarding_seen: bool) -> bool` (`lib.rs:1304`) :
   `!config_file_exists && !onboarding_seen`. Elle ne lit aucun fichier et
   n'écrit rien.
4. **État exposé** `struct OnboardingState { config_file_exists, onboarding_seen,
   show }` (`lib.rs:1310`) avec `from_facts(...)` : le `show` est **calculé par
   la fonction pure**, jamais recalculé côté écran.
5. **Commande de lecture seule** `get_onboarding_state` (`lib.rs:2155`),
   enregistrée dans `tauri::generate_handler!` (`lib.rs:3657`). Elle lit le
   **disque** (`load_config_disk_if_present`) : fichier trouvé ⇒
   `(true, cfg.onboarding_seen)` ; absent ⇒ `(false, false)` ; présent mais
   illisible ⇒ `(true, false)` (une configuration corrompue ne déclenche pas de
   modale). Elle n'écrit rien.
6. **`src/js/settings.js`** (`:2858`) : la clé `onboarding_seen` est **préservée**
   dans l'objet envoyé à `save_config`. Nécessaire parce que `save_config`
   réécrit **toute** la configuration : sans cette ligne, un simple enregistrement
   des Paramètres remettrait le champ à faux et la prise en main reviendrait.

## Comment le critère d'affichage est verrouillé

Trois verrous, à trois endroits :

1. **La fonction pure** exige les **deux** faits (`!config_file_exists` **et**
   `!onboarding_seen`) : le drapeau seul ne suffit jamais.
2. **Les tests Rust** couvrent les quatre combinaisons, et le cas « fichier
   présent + jamais vu » y est explicitement interdit d'affichage.
3. **Le test JS** `src/js/settings-onboarding.test.js` relit la **source réelle**
   et vérifie que la ligne contient bien les **deux** négations : la réduire au
   seul drapeau fait échouer le test.

**Mesure de morsure (faite, puis annulée)** : en remplaçant temporairement le
critère par `let _ = config_file_exists; !onboarding_seen`, la suite Rust ciblée
donne **2 échecs / 2 succès** (`onboarding_show_criterion_needs_the_absent_config_file`,
`onboarding_state_exposes_both_facts_and_the_decision`), et le test JS devient
rouge. Restauration vérifiée (la ligne est revenue à
`!config_file_exists && !onboarding_seen`). La morsure du côté `settings.js` a été
mesurée de la même façon : clé retirée ⇒ test JS rouge ; clé remise ⇒ vert.

## Les tests

**Rust** (`lib.rs`) : 4 tests, à côté des tests de persistance existants.

- `onboarding_seen_field_survives_restart` (`:4552`) — défaut faux ;
  sérialisation contenant `"onboarding_seen":true` ; aller-retour (redémarrage) ;
  retour à faux persistant.
- `onboarding_absent_from_old_config_means_not_seen` (`:4580`) — une
  configuration ancienne `{"theme":"light","auto_save":true}` reste lisible, vaut
  « pas encore vu », **conserve ses autres réglages**, et le champ posé sort la
  configuration de l'état « par défaut ».
- `onboarding_show_criterion_needs_the_absent_config_file` (`:4607`) — affichage
  **seulement** pour (absent, jamais vu) ; pas d'affichage pour (présent, jamais
  vu), (absent, vu), (présent, vu). **C'est ce test qui tombe** si le critère est
  réduit à un drapeau.
- `onboarding_state_exposes_both_facts_and_the_decision` (`:4623`) — l'état rend
  les deux faits **et** la décision, cohérente avec la fonction pure.

**JS** : `src/js/settings-onboarding.test.js` (5 tests) — le champ et son défaut
côté Rust, sa présence dans `config_is_default`, sa préservation dans
`settings.js`, la forme cumulative de la fonction pure, et l'enregistrement de la
commande (avec l'interdiction d'écrire la configuration). Écrit avec
`sliceSource`/`sliceFrom` (découpage vérifié) et lecture normalisée en LF, comme
l'exigent `source-slice.test.js` et la règle CRLF de la qualité-gate.

## Comptes avant / après

| Vérification | Avant | Après |
|---|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **759 passed, 1 ignored** | **763 passed, 1 ignored** |
| `npx vitest run` | **PASS (3012) FAIL (0)** | **PASS (3017) FAIL (0)** |
| `npm run build` | **4127 modules**, built in 12,72 s | **4127 modules**, built in 12,70 s |

Les écarts sont exactement ceux des tests ajoutés (+4 Rust, +5 JS) ; le bundle ne
change pas (le champ de configuration n'ajoute aucun module). Aucun avertissement
nouveau.

## Ce qui reste (hors de ce lot)

Les **écrans** : le niveau 1 (mener à un mode utilisable) et l'accès au niveau 2
(réutiliser l'écran « Équipe d'agents » existant), ainsi que leur branchement :
lire `get_onboarding_state`, afficher si `show`, puis écrire `onboarding_seen`
avec la sauvegarde des réglages choisis. Rien de cela n'est fait ici, et le socle
est prêt pour ces lots : ils n'ont aucune décision à reprendre.

VERDICT : socle posé et verrouillé — un champ (`onboarding_seen`), une fonction
pure cumulative (fichier de configuration absent **et** jamais vu), une commande
de lecture seule enregistrée, préservation du champ à l'enregistrement des
Paramètres ; rien de visible à l'écran ; 763 tests Rust (+4) et 3017 tests JS
(+5) au vert, build identique à l'avant ; critère prouvé par morsure mesurée ;
écrans restant à faire.
