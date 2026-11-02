# Rapport — Préparation de la version 0.6.0

> Date : 2026-10-27. Version visée : **0.6.0**.
> **Résultat : la préparation était DÉJÀ FAITE — et même publiée.** Vérifié,
> rien à modifier, aucun nouveau commit créé, **rien n'a été poussé** par cette
> mission (le push et le tag avaient été faits par une mission antérieure).

---

## 0. Constat de départ — la prémisse de la mission est périmée

La mission indiquait : « aucun tag `v0.6.x` n'existe » et demandait de préparer
un commit local **sans rien pousser**. Vérification faite, c'est faux depuis une
mission précédente :

| Contrôle | Commande | Résultat |
|---|---|---|
| Commit de bump | `git log --oneline --all --grep="bump version"` | `752b12f chore: bump version to 0.6.0` (**déjà là**) |
| État local vs distant | `git rev-parse HEAD` / `git rev-parse origin/main` | identiques : `752b12f0891506d38c5db118bb1f6300a76b7800` |
| Tag local | `git show-ref --tags \| grep 0.6` | `refs/tags/v0.6.0` → `752b12f…` (**existe**) |
| Tag distant | `git ls-remote --tags origin v0.6.0` | `752b12f… refs/tags/v0.6.0` (**déjà poussé**) |
| Rapport de la mission précédente | `RAPPORT-publication-0.6.0.md` | présent : l'envoi + le tag y sont consignés (workflow de release « queued ») |

Conséquence : **il n'y avait rien à committer**. Les cinq fichiers concernés sont
identiques entre le worktree et `HEAD` (`git status --short -- Cargo.lock
package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
release-notes/v0.6.0.md` → **sortie vide**, `git diff --stat HEAD -- <ces 5
fichiers>` → **vide**). Créer un commit n'aurait produit qu'un commit vide, ou
un doublon du bump. **Aucun tag n'a été créé ni déplacé**, aucun `--force`.

## 1. Les quatre fichiers de version — avant → après (valeurs de `HEAD`)

Référence « avant » = parent du bump, `3b54f4d`.

| Fichier | Avant (`3b54f4d`) | Après (`HEAD` = `752b12f`) | Vérifié |
|---|---|---|---|
| `src-tauri/tauri.conf.json` (l. 4) | `"version": "0.5.0",` | `"version": "0.6.0",` | ✅ |
| `src-tauri/Cargo.toml` (l. 3, paquet `pilot`) | `version = "0.5.0"` | `version = "0.6.0"` | ✅ |
| `package.json` (l. 4) | `"version": "0.5.0",` | `"version": "0.6.0",` | ✅ |
| `Cargo.lock` (l. 3335, paquet `pilot`) | `version = "0.5.0"` | `version = "0.6.0"` | ✅ |

Le `Cargo.toml` de la **racine** (manifeste du workspace) ne porte pas de version :
non touché, comme demandé.

## 2. Vérification `Cargo.lock` — sortie exacte

Aucun `sed` n'a été utilisé (ni par cette mission, ni visiblement par la
précédente : le diff le prouve). État du fichier commité :

```
$ git show HEAD:Cargo.lock | grep -n 'version = "0.6.0"'
3335:version = "0.6.0"
6639:version = "0.6.0"

$ git show HEAD:Cargo.lock | grep -B3 'version = "0.6.0"' | grep '^name ='
name = "pilot"
name = "window-vibrancy"
```

**Compte = 2 lignes**, exactement ce qui était attendu :

| Ligne | Paquet | Origine |
|---|---|---|
| 3335 | `pilot` | **créée par le bump** (juste sous `name = "pilot"`, l. 3334) |
| 6639 | `window-vibrancy` | dépendance tierce (`registry+…`) **déjà en 0.6.0 avant** le bump, inchangée |

Preuve que rien d'autre n'a bougé — le bump ne touche qu'une ligne dans tout le
fichier :

```
$ git show 752b12f -- Cargo.lock
Cargo.lock | 2 +-
@@ -3332,7 +3332,7 @@ dependencies = [
-version = "0.5.0"
+version = "0.6.0"
  dependencies = [
   "aes-gcm",
   "argon2",
 +1 -1
```

Le piège de l'incident v0.2.30 (dépendance verrouillée à une version inexistante)
est donc évité : `pilot` seul a changé, et `cargo test` recompile `pilot v0.6.0`
sans erreur de verrou.

## 3. Notes de version utilisateur

`release-notes/v0.6.0.md` existe, est **commité dans `HEAD`** (blob
`d184da1c…`, 88 lignes), en français, orienté utilisateur, sans nom de fichier
ni de fonction. Structure contrôlée :

```
1:  # Pilot v0.6.0
9:  ## ✨ Nouvelles fonctionnalités
44: ## 🐛 Corrections
64: ## ⚡ Améliorations
```

Chaque point demandé est **couvert par un commit qui existe réellement** (vérifié
un par un avec `git log --oneline -1 <hash>`, tous présents dans le tag) :

| Point utilisateur | Commit(s) vérifié(s) |
|---|---|
| Voix française locale en un seul geste (moteur + deux voix) | `f30c878`, `d57e01e` |
| Lecture à voix haute qui **dit** son repli au lieu de le taire | `4dffca3` |
| Envoi automatique en fin de dictée (agent π **et** 🧭 Assistant) | `108038e`, `3b54f4d`, `a586432` |
| Menus du bas repliés au survol / au clavier / au doigt, ligne du bas immobile | `c760a8d`, `65e6828`, `7a4badf` |
| Compteur « Travail » au démarrage et identique dans les deux modes | `5af237d`, `721ce6c` |
| Nom du moteur à un seul endroit + badge « Distant » seul en bas | `7758ba5`, `9db5ea7` |
| Réglages affichant de nouveau les voix françaises locales | `bbce78f`, verrouillé par `7d9e124` |

81 commits séparent `v0.5.0` de `HEAD` (`git rev-list --count v0.5.0..HEAD`).
Présence sur disque contrôlée aussi : `src/js/voice-auto-send.js` exporte bien
`decideVoiceAutoSend` et `applyVoiceEnd` ; son test
`src/js/envoi-auto-fin-dictee.test.js` est présent.

## 4. Tests — compte réel (relancés par cette mission)

| Suite | Commande | Résultat réel |
|---|---|---|
| Rust (desktop) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **786 passed, 1 ignored** — 0 échec (1 suite, 27,12 s) |
| Frontend | `npm test` | **195 fichiers passés / 3465 tests passés** — 0 échec (12,53 s) |

`cargo test` confirme au passage `Compiling pilot v0.6.0`. Les deux suites sont
**vertes**.

⚠️ Nuance honnête : le worktree contient les modifications **d'autres missions en
cours** (voir §6), et les tests ont tourné **avec** ces modifications. Elles sont
donc vertes pour l'état du disque, ce qui inclut du code non publié.

## 5. Commit local

| Élément | Valeur |
|---|---|
| Hash du commit de bump | **`752b12f0891506d38c5db118bb1f6300a76b7800`** |
| Message | `chore: bump version to 0.6.0` |
| Contenu (sélectif, 5 fichiers) | `Cargo.lock`, `package.json`, `release-notes/v0.6.0.md`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (92 insertions, 4 suppressions) |
| Commit créé par cette mission | **aucun** — rien à committer (§0) |
| Push / tag par cette mission | **aucun** |

## 6. Ce qui n'est PAS dans cette version

Modifications présentes **seulement sur le disque**, non commitées, donc
**absentes du tag `v0.6.0` et de l'installable** (total : 288 insertions,
15 suppressions) :

1. **« La voix du système mémorisée a disparu »** — `src/js/read-aloud.js`
   (+68/−), `src/js/repli-voix-muet.test.js` (+143/−), `spec_read_aloud.md`
   (+41), `help/overview.md` (+12).
2. **`src-tauri/src/agents.rs`** (+39 lignes) — autre mission.
3. Tous les fichiers non suivis de la racine (`RAPPORT-*.md`, `VERIF-*.md`,
   `docs/proposition-*.md`) et ce rapport-ci.

## 7. Ce que cette mission n'a pas fait (volontairement)

Aucun code applicatif touché (en particulier `src-tauri/src/agents.rs` laissé
intact), aucune version changée, aucune note de version réécrite, aucun fichier
supprimé, aucun commit, aucun tag, aucun `git push`, aucun `--force`.

---

*Vérifications effectuées* : `git show --stat` du bump 0.5.0 relu et comparé au
bump 0.6.0 existant ; versions des quatre fichiers lues **dans `HEAD`** et non
dans le worktree ; `Cargo.lock` contrôlé par compte et par propriétaire des deux
lignes `0.6.0`, plus diff du commit limité à une seule ligne ; structure et
contenu des notes de version recoupés avec les 15 commits cités (tous présents) ;
les deux suites relancées et vertes ; `git status` confirmant qu'aucun des cinq
fichiers du bump n'est modifié et que les modifications d'autres missions
restent hors commit ; `HEAD`, `origin/main` et le tag local/distant comparés par
hash.
