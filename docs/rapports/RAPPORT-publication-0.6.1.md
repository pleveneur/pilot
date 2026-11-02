# Rapport — Publication de la version 0.6.1

> Mission : publier **0.6.1** de bout en bout (notes, bump, tests, commit, envoi,
> tag, suivi du workflow). Aucun code applicatif modifié, `src-tauri/src/agents.rs`
> non touché, rien de supprimé, aucun `--force`, aucun tag republié.

---

## 1. Pourquoi 0.6.1 et pas une republication de 0.6.0

Le tag `v0.6.0` a été poussé, son workflow a **échoué** sur le test Rust
`tts_local::tests::dossier_vide_moteur_non_installe_et_le_dit` (Ubuntu et macOS),
les builds ont été annulés : **aucun installateur, aucun `latest.json`**. Aucun
utilisateur n'a donc jamais reçu la 0.6.0. Le correctif était déjà commité
(`29e03e0`) mais **pas encore poussé** (l'`origin/main` était resté à `752b12f`) :
le `git push origin main` de cette mission l'a poussé avec le bump. Un tag déjà
poussé ne se republie jamais → nouvelle version **0.6.1**.

---

## 2. Valeurs avant / après (les 4 fichiers de version)

Méthode reprise à l'identique du bump précédent (`git show --stat 752b12f`).

| Fichier | Ligne | Avant | Après |
|---|---|---|---|
| `package.json` | 4 | `"version": "0.6.0",` | `"version": "0.6.1",` |
| `src-tauri/tauri.conf.json` | 4 | `"version": "0.6.0",` | `"version": "0.6.1",` |
| `src-tauri/Cargo.toml` | 3 | `version = "0.6.0"` | `version = "0.6.1"` |
| `Cargo.lock` | 3335 | `version = "0.6.0"` (paquet `pilot`) | `version = "0.6.1"` |

Le `Cargo.toml` de la **racine** est le manifeste du workspace et **ne porte pas
de version** : il n'a pas été touché (comme au bump 0.6.0).

---

## 3. Preuve que `Cargo.lock` n'a qu'UNE ligne modifiée

`Cargo.lock` contient **deux** lignes `version = "0.6.0"` :

- ligne **3335** — paquet `pilot` → **changée** ;
- ligne **6639** — dépendance tierce `window-vibrancy` → **non touchée**.

Édition **ciblée par texte** (`name = "pilot"` + la ligne `version` juste en
dessous), jamais de `sed` (incident v0.2.30 : un `sed` ancré avait verrouillé
`filetime` à une version inexistante et cassé `cargo test` sur toutes les
plateformes).

Le diff du commit le prouve — une seule ligne, une insertion, une suppression :

```
$ git show c2eabd4 -- Cargo.lock
Cargo.lock | 2 +-
1 file changed, 1 insertion(+), 1 deletion(-)
  @@ -3332,7 +3332,7 @@ dependencies = [
  -version = "0.6.0"
  +version = "0.6.1"
   dependencies = [
    "aes-gcm",
    "argon2",
```

Contrôles complémentaires :

- `git diff --stat` des 4 fichiers avant commit : `4 files changed, 4 insertions(+), 4 deletions(-)` ;
- `window-vibrancy` toujours en `0.6.0` (ligne 6639, vérifiée après commit) ;
- le commit ne contient que 5 fichiers (voir § 5).

---

## 4. Notes de version (`release-notes/v0.6.1.md`)

Créées **enrichies depuis `v0.6.0.md`**, jamais réduites à une ligne de correctif :
les utilisateurs n'ayant jamais vu la 0.6.0, ces notes portent **tout** ce qu'elle
apportait, **plus** la correction. Structure exigée respectée : `# Pilot v0.6.1`,
`## ✨ Nouvelles fonctionnalités`, `## 🐛 Corrections`, `## ⚡ Améliorations`.
Français, orienté utilisateur, sans nom de fichier ni de fonction, sans jargon.

Ajouts par rapport aux notes 0.6.0 :

1. un encadré « Bon à savoir » : la version précédente n'a jamais pu être
   installée, tout ce qu'elle apportait arrive avec celle-ci ;
2. une correction explicite : **la version précédente ne pouvait pas être
   installée, elle n'a jamais été diffusée** ;
3. le repli de lecture précisé : la ligne d'information **ne réécrit jamais le
   réglage de voix** ;
4. les menus du bas : le **clavier** est nommé (entrée par tabulation, ouverture,
   circulation dans les entrées, sortie sans repli, `Échap`, focus rendu), et le
   doigt précise que **le panneau reste ouvert** jusqu'à un appui à l'extérieur ;
5. la reprise de la main au clavier pendant une dictée est dite explicitement
   (aucun envoi).

Chaque point a été **vérifié sur le disque avant écriture** (code et verrous
commités) :

| Point des notes | Preuve sur le disque (commité) |
|---|---|
| Moteur + deux voix en un geste, arrêt, reprise | `f30c878`, `d57e01e` |
| Repli de lecture dit à côté du bouton, réglage non réécrit | `4dffca3` |
| Envoi automatique en fin de dictée (agent **et** Assistant), garde-fous | `108038e`, `3b54f4d`, `a586432` |
| Menus du bas : survol, **clavier**, doigt, ligne du bas immobile, mouvement réduit | `c0a4304`, `65e6828`, `7a4badf` (`src/js/sidebar-footer-fold.js`, verrou `repli-menus-bas.test.js`) |
| Compteur « Travail » au démarrage, même valeur dans les deux modes | `5af237d`, `721ce6c`, verrou `80adab2` |
| Nom du moteur à un seul endroit, badge « Distant » seul en bas | `9db5ea7`, `7758ba5` |
| Voix françaises locales de nouveau affichées dans les réglages | `7d9e124` (verrou) |

---

## 5. Tests (ÉTAPE 2, avant tout envoi)

| Suite | Commande | Résultat réel |
|---|---|---|
| Rust (Windows) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **786 passed, 1 ignored** (0 échec) |
| Front | `npm test` | **195 fichiers, 3465 tests passés, 0 échec** |

Les deux suites étaient vertes **avant** le commit et le push — condition posée
par la mission : si l'une avait été rouge, rien n'aurait été publié.

Côté Linux (l'échec de la 0.6.0), le correctif `29e03e0` avait déjà été reproduit
puis vérifié dans un conteneur `ubuntu:22.04` par la mission précédente
(`RAPPORT-tests-rust-linux-0.6.0.md` : même paquets que le workflow, 783 passés).
La preuve de bout en bout est apportée ici par le job `test (ubuntu-22.04)` du
workflow (voir § 7).

---

## 6. Commit et envoi

Commit **sélectif**, chaque fichier ajouté **par son chemin**, un par un :

```
Cargo.lock
package.json
release-notes/v0.6.1.md
src-tauri/Cargo.toml
src-tauri/tauri.conf.json
```

- Message : `chore: bump version to 0.6.1`
- Hash : **`c2eabd4e140d6e4d46ac9115900994c422d2988d`** (`c2eabd4`)
- Stat : `5 files changed, 105 insertions(+), 4 deletions(-)`

**Restés hors du commit** (vérifié dans `git status` juste après) : `help/overview.md`,
`spec_read_aloud.md`, `src-tauri/src/agents.rs`, `src/js/read-aloud.js`,
`src/js/repli-voix-muet.test.js`. Aucun de ces fichiers n'est entré dans le commit.

Envoi (aucun `--force`) :

```
git push origin main        # pousse 29e03e0 (correctif Rust) puis c2eabd4
git tag v0.6.1              # tag créé sur c2eabd4
git push origin v0.6.1
```

Vérifications :

- `git rev-parse origin/main` → `c2eabd4e140d6e4d46ac9115900994c422d2988d` ;
- `git ls-remote --tags origin` → `refs/tags/v0.6.1` = `c2eabd4…` (et `v0.6.0`
  toujours sur `752b12f`, **non republié**) ;
- `git rev-parse v0.6.1` (local) = même hash.

---

## 7. État du workflow au moment d'écrire

Workflow `release` déclenché par le tag (run **40362130323**, run number 166,
`head_sha` = `c2eabd4`) :

| Job | État observé |
|---|---|
| `create-release` | **completed / success** |
| `test (ubuntu-22.04)` | **completed / success** ✅ — l'échec de la 0.6.0 (exit 101 sur l'étape « Run Rust unit tests ») **ne se reproduit pas** |
| `test (macos-latest)` | **completed / success** (l'autre plateforme qui échouait en 0.6.0) |
| `test (windows-latest)` | **completed / success** |
| `build` (Windows NSIS, macOS arm64, macOS x64) | **in_progress** au moment de la rédaction |
| `build-linux` | **in_progress** au moment de la rédaction |
| `latest-json` | pas encore démarré (attend `build`) |

Les **trois** suites de tests de la matrice sont vertes : le point bloquant de la
0.6.0 (Ubuntu **et** macOS) est levé. La fabrication des installateurs et
`latest.json` se poursuit après ; elle n'était pas terminée au moment de ce
rapport (une fabrication complète dure ~15 à 25 min).
URL de suivi : `https://github.com/pleveneur/pilot/actions/runs/40362130323`.

API interrogée : `https://api.github.com/repos/pleveneur/pilot/actions/runs/40362130323/jobs`
(joignable).

---

## 8. Ce qui n'est PAS dans cette version

1. **L'annonce du repli quand c'est la voix du SYSTÈME qui a disparu.** Le
   correctif est **écrit, testé et documenté sur le disque** (`src/js/read-aloud.js`,
   `src/js/repli-voix-muet.test.js`, `spec_read_aloud.md`, `help/overview.md` —
   rapport `RAPPORT-voix-systeme-disparue.md`) mais **non commité** au moment de
   la publication. La consigne de cette mission limitait son commit aux quatre
   fichiers de version et aux notes : ces fichiers **n'ont donc pas été embarqués**
   et la note de version ne promet, pour le repli de lecture, que ce qui est
   réellement dans le tag (voix **locale** annoncée, réglage jamais réécrit).
   → Une 0.6.2 (ou un commit dédié avant une prochaine version) l'apportera.
2. **Les 39 lignes non commitées de `src-tauri/src/agents.rs`** et les rapports
   non suivis (`RAPPORT-*.md`, `docs/proposition-*.md`) : hors périmètre, laissés
   en l'état.
3. **La fabrication des installateurs / `latest.json`** n'était pas terminée à
   l'heure de ce rapport (voir § 7) : les trois suites de tests sont vertes, les
   builds sont en cours.
4. Aucune modification fonctionnelle n'a été apportée par cette mission : elle ne
   livre que le numéro de version et les notes.

---

## 9. Nettoyage

Le conteneur de test Linux `pilot-linux-test` (≈ 10 Go, inactif : aucun processus,
aucun espace de travail monté) a été supprimé en fin de mission avec
`docker rm -f pilot-linux-test`. Le conteneur `pilot-gds` (service du poste) n'a
**pas** été touché.
