# Rapport — construction de l'installateur en local (v0.5.0)

Date de l'exécution : 26/10/2026, de 02:23 à 02:31 (heure locale de la machine).
Aucun fichier de code n'a été modifié. Aucun commit, aucun tag, aucun push, aucun changement de version,
aucun artefact supprimé, l'application n'a **pas** été lancée ni l'installateur exécuté.

---

## 1. État du dépôt avant construction

Commande : `git status --porcelain`, `git log --oneline -5`.

- Branche : `main`, dernier commit `423d32f docs: la presentation du projet dit Options`.
- **Fichiers de code suivis modifiés : AUCUN** (`git status --porcelain | grep -v '^??'` → vide ;
  `git diff --stat` → vide). Le critère d'arrêt prévu par la mission n'est donc pas déclenché.
- Fichiers **non suivis** : 31, tous des rapports/propositions déjà présents avant mon intervention
  (27 fichiers `RAPPORT-*.md` / `VERIF-*.md` + 4 fichiers `docs/proposition-*.md`). Il s'agit de texte,
  pas de code.

## 2. Documentation embarquée (handbook)

- Commande : `npm run build:handbook` → `help/handbook.md`.
- Résultat : **45 blocs**, **272 809 octets**.
- Empreinte MD5 **avant** : `062958a0fc9a320e4169a53141b2e2e3`
  — empreinte MD5 **après** : `062958a0fc9a320e4169a53141b2e2e3` → **strictement identique**.
- `git status help/` → aucune modification : **la documentation embarquée était déjà à jour**, rien à
  signaler et rien à committer.

## 3. Tests — une seule exécution complète

### 3.1 Suite JavaScript (`npm test` = `vitest run`)

| Mesure | Valeur |
|---|---|
| Fichiers de test | **181 passés (181)** |
| Tests | **3167 passés (3167)** |
| Échecs | **0** |
| Code de sortie | **0** |
| Durée annoncée | 11,19 s (collecte 75,59 s, tests 13,11 s) |

Aucun test en échec, donc aucun nom de test à citer.

Remarque honnête sur le bruit : le journal contient **120 blocs `stderr |`** (traces de pile
`vitest/runner`) émis par des tests qui exercent volontairement des chemins d'erreur
(ex. `project-task-queue.test.js`, `verrou-par-projet.test.js`, `code-graph.test.js`). Ce sont des
sorties console de tests **réussis**, pas des échecs : le récapitulatif est `Test Files 181 passed`,
`Tests 3167 passed`, code de sortie 0.

### 3.2 Tests Rust de l'application (`cargo test --manifest-path src-tauri/Cargo.toml --lib`)

| Mesure | Valeur |
|---|---|
| Tests lancés | **776** |
| Passés | **775** |
| Échoués | **0** |
| Ignorés | **1** |
| Filtrés | 0 |
| Code de sortie | **0** |
| Durée | 11,57 s |

Avertissement unique émis par `cargo` : `the following packages contain code that will be rejected by a
future version of Rust: sqlx-postgres v0.8.0` (avertissement de compatibilité future d'une dépendance,
sans effet sur le résultat).

## 4. Construction de l'installateur

### 4.1 Méthode réellement employée (session maintenue vivante)

1. La compilation a été lancée **en arrière-plan**, sortie complète redirigée dans
   `build-installable.log` (fichier ignoré par git : `.gitignore:31:*.log`).
2. La fin du journal a été relue toutes les 50 à 60 secondes, en annonçant à chaque fois l'étape en
   cours (frontend → `Compiling pilot` → WiX/MSI → `makensis`/NSIS → `Finished 2 bundles`).
3. Durée totale bien en dessous de la borne de 30 minutes : aucune interruption n'a été nécessaire.

Commande exécutée :

```bash
./node_modules/.bin/tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

- Début : **02:25:07** (création du journal) — Fin : **02:28:41** (dernier bundle écrit).
- **Durée totale : 3 min 34 s**, dont frontend Vite `✓ built in 12.83s` et profil release
  `Finished release profile [optimized] target(s) in 1m 52s` (compilation incrémentale : le cache
  `target/` de 61 Go était déjà chaud, ce qui explique cette durée très courte).
- `beforeBuildCommand` exécuté intégralement : `build:mcp` (extension MCP, 681,7 Ko, 0 erreur),
  `build:handbook`, `prepare:laya` (11 entrées, 113,7 Mo, cible `win32/x64`), `vite build`.

### 4.2 Écart assumé par rapport à la CI (à lire)

`src-tauri/tauri.conf.json` porte `bundle.createUpdaterArtifacts: true`, ce qui exige la clé privée de
signature `TAURI_SIGNING_PRIVATE_KEY` (+ son mot de passe). Sur cette machine :

- `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` **ne sont pas définis** ;
- la clé locale `~/.tauri/pilot-updater.key` existe mais est **chiffrée** (`rsign encrypted secret key`),
  donc inutilisable sans le mot de passe, qui est un **secret GitHub** que la mission interdit de toucher.

J'ai donc construit avec `createUpdaterArtifacts:false`, sans lire, copier, modifier ni exposer aucun
secret, et sans modifier un seul fichier du dépôt (l'option est passée en ligne de commande).
**Conséquence : les deux installateurs sont produits et utilisables, mais il n'y a pas de fichier
`.sig`** et `latest.json` n'est pas généré. Un build signé ne peut être fait que par le workflow CI.

### 4.3 Fichiers produits — chemin, taille exacte, heure de fin

| Fichier | Taille exacte (octets) | Taille lisible | Écrit à | État |
|---|---|---|---|---|
| `G:\IA_PL\pilot\target\release\bundle\nsis\Pilot_0.5.0_x64-setup.exe` | **63 603 474** | 60,7 Mo | 26/10/2026 **02:28:41** | présent, non vide ✔ |
| `G:\IA_PL\pilot\target\release\bundle\msi\Pilot_0.5.0_x64_en-US.msi` | **82 833 408** | 79,0 Mo | 26/10/2026 **02:27:34** | présent, non vide ✔ |
| `G:\IA_PL\pilot\target\release\pilot.exe` (binaire empaqueté) | **46 081 536** | 43,9 Mo | 26/10/2026 **02:28:41** | présent, non vide ✔ |
| `.sig` de l'installateur NSIS | — | — | — | **absent (voir §4.2)** |

Dernière ligne du journal de construction :
`Finished 2 bundles at: …\Pilot_0.5.0_x64_en-US.msi`, `…\Pilot_0.5.0_x64-setup.exe` → **succès**.

### 4.4 Artefacts v0.5.0 qui existaient déjà

Avant ma construction, la machine portait **déjà** des installateurs v0.5.0, écrits à
**01:53:56** (MSI, 82 825 216 octets) et **01:55:04** (NSIS, 63 597 854 octets) — c'est-à-dire par la
**tentative précédente coupée** : celle-ci avait donc bien terminé sa compilation avant d'être
interrompue, mais n'avait produit aucun rapport.
Ces deux fichiers ont été **réécrits aux mêmes chemins** par la reconstruction (c'est le comportement
normal de `tauri build`) : je n'ai **supprimé** aucun artefact. Les installateurs des versions
antérieures (0.4.29, 0.4.40, 0.4.41, 0.4.42) sont **intacts**.

## 5. Avertissements observés (rien n'est masqué)

1. `pilot (lib) generated 22 warnings` — code mort / imports inutilisés dans le crate desktop :
   `unused imports: DELIVERABLE_ORIGIN_UNKNOWN, GateVerdict, MAX_INJECTED_MESSAGE_CHARS,
   MEMORY_FORMAT, MEMORY_VERSION, SCHEDULE_CLEAN…`, constantes jamais utilisées
   (`INSUFFICIENT_MARKER`, `SUPER_AGENT_FIXED_PROMPT_BUDGET`, `DEFAULT_MODEL_NAME`), fonctions
   jamais utilisées (`check_git_identity`, `ensure_git_repo_with_initial_commit`, `schedule_insert`,
   `schedule_next_fire_at`, `mem_conn`, `sample_memory`, `synthesize_base64`, `get_pg_id`,
   `stop_project_sessions`, `desktop_pool`, plusieurs aides de test), champs `state`/`blocked` jamais lus.
   Ces avertissements sont **antérieurs à cette mission** ; ils n'empêchent ni la compilation ni le
   fonctionnement, et la mission interdisant de corriger au hasard, **je n'ai touché à rien**.
2. `sqlx-postgres v0.8.0` : contient du code qui sera rejeté par une future version de Rust
   (avertissement de compatibilité future d'une dépendance).
3. Vite : **19** avertissements « X is dynamically imported by Y but also statically imported »
   (imports mixtes dans `src/js/*` et quelques paquets), **1** avertissement de taille de chunk
   (`Some chunks are larger than 500 kB after minification`, chunk principal `index-*.js` ≈ 3,96 Mo).
   Avertissements d'outillage, sans effet sur l'installateur.

**Échecs : aucun.** Aucune ligne `error`/`failed`/`panicked` dans le journal (la seule occurrence du mot
« erreur » est le compte d'erreurs de l'extension MCP : `0 erreur(s)`).

## 6. Ce que je n'ai pas fait (conformément aux contraintes)

- Aucune modification de fonctionnalité, aucun fichier de code touché (dépôt suivi inchangé).
- Aucun `git push`, `git tag`, `git commit`, `--amend` ; version non changée (0.5.0 partout :
  `package.json`, `tauri.conf.json`, `Cargo.toml`).
- Aucune suppression d'artefact, aucun secret lu/écrit/exposé, workflow de publication non modifié.
- Application non lancée, installateur non installé.
- Aucun outil de listage de sessions d'agents appelé.

## 7. Fichiers ajoutés par cette exécution (non suivis, non commités)

- `RAPPORT-build-installable.md` (ce rapport).
- `build-installable.log` (journal de compilation, ignoré par git).
- `test-js.log`, `test-rust.log` (journaux de tests, ignorés par git).

---

VERDICT : CONSTRUCTION RÉUSSIE, NON SIGNÉE — installateurs v0.5.0 présents et non vides (NSIS `Pilot_0.5.0_x64-setup.exe`, 63 603 474 octets, 02:28:41 ; MSI `Pilot_0.5.0_x64_en-US.msi`, 82 833 408 octets, 02:27:34) en 3 min 34 s ; dépôt suivi inchangé (aucun code modifié, donc aucun commit) ; documentation embarquée déjà à jour (empreinte identique) ; tests verts et recomptés (JS : 181 fichiers / 3167 tests / 0 échec ; Rust : 776 lancés = 775 passés + 1 ignoré / 0 échec) ; seule réserve : `createUpdaterArtifacts` désactivé en ligne de commande faute du mot de passe de la clé de signature, donc pas de `.sig` ni de `latest.json` — un build signé reste réservé à la CI.
