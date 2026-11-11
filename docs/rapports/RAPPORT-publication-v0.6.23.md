# Rapport — publication de Pilot v0.6.23

Date : 2026-11-16 · Projet : `G:\IA_PL\pilot` (Tauri v2 + JS, Vitest + cargo)
Mission : livrer **une seule version 0.6.23** embarquant **tout** le travail
depuis la v0.6.21 (contenu prévu pour 0.6.22 + les correctifs d'après-tag), la
0.6.22 n'étant pas publiée telle quelle (décision du propriétaire).

> Ce rapport est écrit **au fil des étapes** : chaque affirmation ci-dessous est
> la sortie d'une commande réellement lancée. Aucun résultat n'est reconstitué.

---

## 1. État AVANT (constaté, pas supposé)

Commandes : `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse
origin/main`, `git status --porcelain`, `git tag -l "v0.6.2*"`, `grep`.

```
branche            : main
HEAD               : e3c3120c535f63e72010c39998e646a7381484f5
origin/main        : 2d446fdf34907db1be1d3205fc9191a83dd81a7c
commits non poussés: 13 (origin/main..HEAD)
tags locaux        : v0.6.2 v0.6.20 v0.6.21 v0.6.22
version publiée    : package.json 0.6.22 · tauri.conf.json 0.6.22 ·
                     src-tauri/Cargo.toml 0.6.22 · Cargo.lock (pilot) 0.6.22
fichiers modifiés  : release-notes/v0.6.22.md (+14 lignes)
fichiers non suivis: 16, tous dans docs/rapports/
```

Les 13 commits jamais poussés (`git log --oneline origin/main..HEAD`) :

```
e3c3120 fix(vocal): le son de la voix repousse l'echeance de fin d'ecoute
4c32f6f fix(dictation): close the previous ear before opening, and ignore stale session ends
ef3cabd fix(dictation): notify the voice bridge when a local listening session is abandoned
b213d9a docs(rapports): rapport de publication v0.6.22 (etiquette locale, aucun envoi)
17f4b86 chore: bump version to 0.6.22
137e114 docs(registre): registre des comportements valides + garde-fou qui le lit
e1b2234 docs(rapports): purge des sorties Vitest brutes regenérables
b956128 fix(vocal): l'ordre d'arrete d'ecoute arrete vraiment l'ecoute (outil...)
551c0f3 fix(assistant): La barre de saisie respire encore en mouvement réduit
0bbca62 fix(parametres): exemple exact pour les mots de reveil de l'ecran Vocal
6118d0b fix(dev): Vite n'analyse plus le dossier target/ (EBUSY au lancement...)
58699d2 fix(vocal): la veille de 20 s est suspendue pendant le tour et la lecture
8958a67 docs(rapports): rapport de nettoyage disque (target Cargo + dechets...)
```

**Constat important** : le tag `v0.6.22` existe en local (sur `17f4b86`) mais
`origin/main` s'arrête à `2d446fd` — aucun envoi. `release-notes/v0.6.22.md`
porte bien, en working tree, les **14 lignes** décrivant les trois correctifs
d'après-tag (vérifié par `git diff release-notes/v0.6.22.md` : `1 file changed,
14 insertions(+)`). Ce texte est donc réutilisé tel quel comme base de la 0.6.23.

`Cargo.lock` : `grep -n -A3 '^name = "pilot"'` → `3334:name = "pilot"` /
`3335:version = "0.6.22"`, et `grep -c 'version = "0.6.22"' Cargo.lock` → **1**
seule occurrence. Le bump sera donc ciblé sur cette ligne, sans remplacement
global.

---

## 2. Bump vers 0.6.23 (quatre fichiers)

Édition **ciblée** (aucun `sed` global), puis vérification :

```
grep '"version": "0.6.23"' package.json src-tauri/tauri.conf.json
  → package.json:4       "version": "0.6.23",
  → tauri.conf.json:4    "version": "0.6.23",
grep '^version = "0.6.23"' src-tauri/Cargo.toml
  → src-tauri/Cargo.toml:3   version = "0.6.23"
grep -n -A1 '^name = "pilot"' Cargo.lock
  → 3334:name = "pilot"
  → 3335-version = "0.6.23"
grep -c 'version = "0.6.23"' Cargo.lock
  → 1        (UNE seule occurrence — la ligne du paquet `pilot`)
grep -rn '0\.6\.22' package.json src-tauri/tauri.conf.json \
     src-tauri/Cargo.toml Cargo.lock
  → (aucune occurrence)
```

`Cargo.toml` à la racine est un manifeste de **workspace virtuel** (`[workspace]`
seul, aucun bloc `[package]`) : il n'y a pas de version à y porter, conformément
à la consigne.

## 3. Notes de version

`release-notes/v0.6.23.md` écrit en français : chapeau + `## ✨ Nouvelles
fonctionnalités` / `## 🐛 Corrections` / `## ⚡ Améliorations`, reprenant le
contenu de `release-notes/v0.6.22.md` (qui portait déjà, en working tree, les
trois correctifs d'après-tag) et y ajoutant deux lignes d'amélioration.

```
wc -l -c release-notes/v0.6.23.md
  → 77  4661  release-notes/v0.6.23.md
grep -n '^#' release-notes/v0.6.23.md
  → 1: # Pilot v0.6.23
  → 13: ## ✨ Nouvelles fonctionnalités
  → 31: ## 🐛 Corrections
  → 62: ## ⚡ Améliorations
test -s release-notes/v0.6.23.md → fichier non vide : OUI
```

## 4. Commits

Deux commits, pour ne pas mêler de la documentation au bump :

```
5c7297d docs(rapports): seize rapports de mission non suivis (dictee, vocal, supervision)
         16 files changed, 2806 insertions(+)
e14f620 chore: bump version to 0.6.23
         6 files changed, 95 insertions(+), 4 deletions(-)
         (package.json, tauri.conf.json, src-tauri/Cargo.toml, Cargo.lock,
          release-notes/v0.6.23.md, release-notes/v0.6.22.md)
```

Sort des 16 fichiers non suivis : **tous commités** dans `docs/rapports/`
(`git status --porcelain | grep -c '^??'` = 16 avant l'ajout, 1 après — le seul
restant étant ce présent rapport). **Aucun fichier supprimé.** La modification
non commitée de `release-notes/v0.6.22.md` (+14 lignes, les correctifs
d'après-tag) est commitée elle aussi : elle documente le contenu réel de la
0.6.23 et rien du travail de l'utilisateur n'est jeté.

## 5. Tests sur l'arbre étiqueté (HEAD = e14f620)

### `npx vitest run` — 308 fichiers de test

```
PASS (5895) FAIL (0)          début 20:46:10 · fin 20:46:31 (21 s)
```

### `cargo test --workspace` — sortie complète dans le terminal, exit 0

```
test result: ok. 139 passed; 0 failed; 11 ignored; ... finished in 1.17s
test result: ok.  34 passed; 0 failed;  0 ignored; ... finished in 0.70s
test result: ok. 964 passed; 0 failed;  3 ignored; ... finished in 10.49s
test result: ok.   0 passed; ...  (doc-tests / binaires sans test)
total : passed=1137 failed=0 ignored=14     EXIT_CODE=0     erreurs de compilation : 0
```

33 avertissements `dead_code` / `unused_imports` préexistants (aucun nouveau).

### `npm run build` — exit 0

```
✓ 4171 modules transformed.
✓ built in 11.76s
EXIT_CODE=0
```

Après les trois commandes, `git status --porcelain` ne montre **aucune**
modification parasite : le build n'a rien réécrit dans le suivi.

## 6. Envoi de la branche

```
git remote -v            → origin https://github.com/pleveneur/pilot.git
git push origin main     → ok main
git branch --set-upstream-to=origin/main main → ok
git fetch origin && git rev-parse HEAD origin/main
  HEAD        : e14f6204da46d266bf7c999fda451a24bb89511d
  origin/main : e14f6204da46d266bf7c999fda451a24bb89511d
git log --oneline origin/main..HEAD → (vide)
git status -sb → ## main...origin/main
```

## 7. Tag

```
git tag -a v0.6.23 e14f6204da46d266bf7c999fda451a24bb89511d -m "Pilot v0.6.23 ..."
git rev-parse v0.6.23            → 558fe8c40523ffd3e5d74a143af1777a20fcd878
git cat-file -t v0.6.23          → tag          (annoté, pas un tag léger)
git rev-list -n 1 v0.6.23        → e14f6204da46d266bf7c999fda451a24bb89511d
git rev-parse HEAD               → e14f6204da46d266bf7c999fda451a24bb89511d
  => LE TAG DÉSIGNE BIEN LE COMMIT DE VERSION
git push origin v0.6.23          → ok v0.6.23
git ls-remote --tags origin 'refs/tags/v0.6.23*'
  → 558fe8c40523ffd3e5d74a143af1777a20fcd878  refs/tags/v0.6.23
  → e14f6204da46d266bf7c999fda451a24bb89511d  refs/tags/v0.6.23^{}
```

`v0.6.22` **n'a pas été touché** : `git rev-parse v0.6.22` → `5d279f7d...`
(tag annoté), toujours local, jamais poussé, jamais déplacé.

---

## 8. Fabrication et publication par le workflow

Aucun `gh` n'est installé sur ce poste (`which gh` → *no gh in ...*) : la
vérification passe par l'API REST publique de GitHub (dépôt `pleveneur/pilot`).

### Déclenchement

```
GET /repos/pleveneur/pilot/actions/runs?per_page=2
  release       | v0.6.23 | push | in_progress   (run id 43061827158)
  quality-gate  | main    | push | in_progress
```

### Jobs du run `release` (état constaté)

```
test-macos                                              completed  success
test (ubuntu-22.04)                                     completed  success
test (windows-latest)                                   completed  success
create-release                                          completed  success
build (windows-latest, x86_64-pc-windows-msvc, win32/x64) completed  success
build (macos-latest, aarch64-apple-darwin, darwin/arm64) completed  success
build (macos-latest, x86_64-apple-darwin, darwin/x64)    completed  success
latest-json                                             completed  success
build-linux                                             in_progress
```

**Point honnête** : la machine macOS **a été attribuée cette fois** (contrairement
aux tâches 409/410 du suivi) — `test-macos` et les deux builds macOS sont en
`success`. La livraison n'est donc **pas** incomplète : `detect-macos-gap.js`
n'a rien eu à autoriser, et aucune phrase d'absence de macOS n'apparaît dans les
notes (vérifié dans `latest.json`, cf. ci-dessous).

> **Dernier constat daté** (re-vérifié après l'envoi de ce rapport) :
> `build-linux` = `in_progress`, tous les autres jobs = `success`,
> `run 43061827158` = `in_progress` **du seul fait de ce job**, qui est hors
> chemin critique. Conséquence : les fichiers livrés et `latest.json` restent
> ceux décrits en § 8, aucune autre plateforme n'est retirée.

**Seul élément non terminé au moment de ce rapport** : `build-linux`. Il est
**hors chemin critique** par construction (plafond 90 min, `continue-on-error`,
aucun job ne le déclare dans ses `needs`) : son absence ne retire rien aux
plateformes livrées et ne retarde aucune mise à jour. Les paquets Linux ne sont
donc pas joints pour l'instant ; la seconde passe optionnelle `latest-json-linux`
les ajouterait à `latest.json` s'ils étaient déposés.

### La Release existe

```
GET /repos/pleveneur/pilot/releases/tags/v0.6.23
  id         : 441967518
  tag        : v0.6.23
  nom        : Pilot v0.6.23
  draft      : False          (publiée)
  prerelease : False
  publiee le : 2026-11-11T16:58:43Z
  assets     : 11             (439 639 229 octets au total, ≈ 419 Mio)
```

Fichiers réellement attachés (`name | taille | type`) :

```
latest.json                        6 561        application/json
Pilot_0.6.23_aarch64.dmg         103 922 480    application/zip
Pilot_0.6.23_x64-setup.exe        65 074 410    application/zip   (+ .sig 416 o)
Pilot_0.6.23_x64.dmg              39 511 679    application/zip
Pilot_0.6.23_x64_en-US.msi        84 848 640    application/zip   (+ .sig 416 o)
Pilot_aarch64.app.tar.gz         106 439 399    application/zip   (+ .sig 404 o)
Pilot_x64.app.tar.gz              39 834 420    application/zip   (+ .sig 404 o)
```

Soit **Windows** (installateur NSIS `.exe` signé, `.msi` signé) et **macOS**
(`.dmg` x64 et arm64, `.app.tar.gz` signés pour la mise à jour automatique).

### `latest.json` (ce que reçoivent les installations existantes)

```
version   : 0.6.23
pub_date  : 2026-11-11T17:15:47.941Z
platforms : darwin-aarch64  -> Pilot_aarch64.app.tar.gz   signature : oui
            darwin-x86_64   -> Pilot_x64.app.tar.gz       signature : oui
            windows-x86_64  -> Pilot_0.6.23_x64-setup.exe signature : oui
notes     : 4 552 caracteres (les notes de release-notes/v0.6.23.md)
```

**Aucune mention d'absence de macOS** n'y figure : la règle
`macosMissingNotice()` de `scripts/release-gates.js` ne s'est pas déclenchée,
ce qui confirme que la livraison est complète.

### Corps de la Release

4552 caractères, préfixés par `## Modifications depuis v0.6.21` puis le contenu
exact de `release-notes/v0.6.23.md` (chapeau + ✨ / 🐛 / ⚡). Le changelog
obligatoire a bien été pris par le workflow : la Release n'aurait pas été créée
sans lui (refus code 2 de `scripts/create-release.js`).

---

## 9. VERDICT

### ✅ PUBLIÉE — et complète pour Windows et macOS

- Release **`Pilot v0.6.23`** publiée le 2026-11-11T16:58:43Z, 11 fichiers
  attachés, ~419 Mio.
- `latest.json` sert **trois cibles** (Windows x64, macOS Intel, macOS Apple
  Silicon), toutes **signées** : les installations existantes se mettront à
  jour au prochain démarrage.
- Notes de version en français, présentes dans la Release **et** dans
  `latest.json`.
- Tests sur l'arbre étiqueté : **5895 tests front OK**, **1137 tests Rust OK**,
  **build Vite OK**.

### ⚠️ Ce qui n'est PAS livré (dit clairement)

- **Paquets Linux** : le job `build-linux` n'était pas terminé à l'heure de ce
  rapport. Il est hors chemin critique ; s'il aboutit, `latest-json-linux`
  ajoutera les cibles Linux à `latest.json` sans nouvelle release à créer.
- Rien d'autre ne manque : ce n'est **pas** une livraison incomplète au sens de
  la porte de publication (Windows + les deux macOS sont présents et signés).

---

## 10. Points restants et geste propriétaire

| Point | Geste exact |
|---|---|
| Vérifier que `build-linux` a fini et que Linux apparaît dans `latest.json` | `curl -s https://api.github.com/repos/pleveneur/pilot/actions/runs/43061827158` puis `curl -sL https://github.com/pleveneur/pilot/releases/download/v0.6.23/latest.json` |
| Lancer une version Linux à la main si `build-linux` échoue | relancer le workflow sur le tag : onglet *Actions* → *release* → *Run workflow*, ou `git tag -d` interdit — **ne pas republier le tag** : le rejeu se fait par `ALLOW_EXISTING_RELEASE=1` sur un run manuel |
| Tag local `v0.6.22` jamais poussé, sur `17f4b86` | le laisser tel quel (consigne) ; s'il gêne, `git tag -d v0.6.22` — **décision du propriétaire**, non exécutée ici |
| Tester l'installation réelle | télécharger `Pilot_0.6.23_x64-setup.exe` (Windows) ou `Pilot_0.6.23_aarch64.dmg` (Mac ARM) et vérifier que Pilot affiche `0.6.23` dans Options → À propos |

---

## 11. Intégrité — empreintes après envoi

```
HEAD (commit de version) : e14f6204da46d266bf7c999fda451a24bb89511d
origin/main              : e14f6204da46d266bf7c999fda451a24bb89511d   (identiques)
tag annoté v0.6.23       : 558fe8c40523ffd3e5d74a143af1777a20fcd878
  -> pointe sur          : e14f6204da46d266bf7c999fda451a24bb89511d
tag distant v0.6.23      : 558fe8c40523ffd3e5d74a143af1777a20fcd878
  (^{} = e14f6204da46d266bf7c999fda451a24bb89511d)
tag v0.6.22 (inchangé)   : 5d279f7d7f19d07a615ca9a1f2e521da22109ffe  (local, jamais poussé)
commits non poussés      : aucun (git log origin/main..HEAD vide)
Release GitHub           : id 441967518, publiée, 11 assets
workflow                 : run 43061827158 (release, v0.6.23)
```

Ceinture de sécurité respectée : **aucun tag déplacé ni republié**, **aucun
secret touché**, **aucun poids de modèle modifié**, **aucun fichier du travail de
l'utilisateur supprimé** (les 16 rapports non suivis ont été commités, la
modification de `release-notes/v0.6.22.md` aussi).
