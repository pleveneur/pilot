# Rapport de publication — Pilot v0.6.3

**Date** : 29 octobre 2026, 05 h 06 → 05 h 16 UTC (09 h 06 → 09 h 16 heure locale UTC+4)
**Version publiée** : `0.6.3` (correctifs : dernier chiffre ; jamais reculé — `0.6.2` → `0.6.3`)
**Accord du propriétaire** : explicite, donné **avant** le début des travaux (décision 404 du suivi,
mission « Publication de la version 0.6.3 »).

---

## 1. Points de repère Git

| Élément | Valeur |
|---|---|
| Branche | `main` |
| Commit du bump | **`6fd00df3208f5dff6975f7d1b918a14c88243f2f`** — `chore: bump version to 0.6.3` |
| Étiquette | **`v0.6.3`**, étiquette **annotée**, objet `fd1025b0ad29021dcf9beeaf598d110d3b7a4060` |
| L'étiquette pointe sur | `6fd00df3208f5dff6975f7d1b918a14c88243f2f` (`git rev-parse v0.6.3^{commit}`) |
| Étiquette sur le distant | **oui** — `git ls-remote origin refs/tags/v0.6.3` → `fd1025b…` et `refs/tags/v0.6.3^{}` → `6fd00df…` |
| `origin/main` avant push | `c1217c9` ; **47 commits d'avance, 0 de retard** → avance rapide, aucun écrasement |
| `v0.6.2` | **intacte** (objet `4738a80…`, commit `57abb62…`), ni déplacée ni supprimée |
| État de l'arbre | **propre sur le code** (`git status --porcelain` : seuls des fichiers **non suivis** subsistent) |

Le commit de publication contient **exactement 5 fichiers** : `Cargo.lock`, `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `release-notes/v0.6.3.md`
(97 insertions, 4 suppressions). Aucun fichier `RAPPORT-*.md` / `docs/proposition-*.md` non suivi
n'a été committé.

### Contenu de la version

**53 commits** depuis `v0.6.2` (dont 46 de code/doc déjà livrés et testés avant cette mission).
Les chantiers visibles annoncés au propriétaire :

| # | Chantier | Commits |
|---|---|---|
| 1 | Halo plus large et plus doux, enveloppe pilotée par la voix réelle | `279c33c`, `bbd1803`, `169486f`, `87330ae`, `9023c1d` |
| 2 | Phrase d'état déplacée au-dessus de la zone de saisie | `bbd1803` |
| 3 | Bouton rond « Réveiller *nom* » sur toute la surface du cercle | `3e1dcee`, `4fd0dea` |
| 4 | La dictée se réarme après un long silence (silence ≠ panne) | `dbf0c35` |
| 5 | Plus d'arrêts prématurés d'agents (compilation, session neuve, run ancienne) | `e7fbdbd`, `c7e0026`, `f5ce1fa` |

S'y ajoutent, livrés dans la même période et donc présents dans la version (annoncés aussi dans le
changelog pour ne rien taire à l'utilisateur) : les trois modes d'écran et le logo-bouton
(`535ceb1`), l'écran Vocal dépouillé (`ccc5422`), la conversation parlée (`f81897e`), la coupure de
la parole (`174cc45`, `903708b`), la longueur des réponses orales réglable (`ab144a6`, `a58d647`),
le délai d'envoi réglable (`d3b3772`, `1c92460`), le personnage actif de *Présences* (`7fe7cc5`),
l'activation MCP depuis la conversation (`b805966`), le point unique de masquage console
(`5a27c51`), la liste des tâches vivante (`d694e28`, `400be3e`).

### GDS : le projet n'est **pas** basculé

- `.pilot/gds.json` → `"enabled": false` ⇒ **publication GitHub autorisée**.
- `git diff --stat v0.6.2..HEAD -- gds-core gds-server` → **3 fichiers** : `gds-core/src/git.rs`
  (+2 lignes de commentaire), `gds-core/src/proc.rs` (fonction `hide_console`, point unique de
  masquage de la console), `gds-core/src/service_control.rs`. Ce sont des changements **partagés**
  avec le poste (masquage des fenêtres noires), **pas** une bascule GDS.
- **Image du serveur NON reconstruite, conteneur NON rechargé** : hors périmètre de cette
  publication, décision du propriétaire (consigne respectée).

---

## 2. Version — les quatre fichiers

| Fichier | Valeur | Preuve |
|---|---|---|
| `package.json` (l. 4) | `0.6.3` | `git diff` : 1 ligne |
| `src-tauri/tauri.conf.json` (l. 4) | `0.6.3` | `git diff` : 1 ligne |
| `src-tauri/Cargo.toml` (l. 3, paquet `pilot`) | `0.6.3` | `git diff` : 1 ligne |
| `Cargo.lock` (**racine**) — bloc `name = "pilot"` (l. 3334-3335) | `0.6.3` | `git diff --numstat Cargo.lock` → **1 ajout / 1 suppression**, ligne 3335 |

`Cargo.lock` a été édité **de façon ciblée** (bloc `[[package]] name = "pilot"`), **aucun `sed`,
aucune ancre glissante** : le piège de l'incident v0.2.30 est évité.

**Écart à signaler (exigence de la consigne non tenable telle qu'écrite)** : la consigne demande que
`grep '0.6.3' Cargo.lock` ne renvoie qu'une occurrence. Il en existe **27**, dont **4 lignes
`version = "0.6.3"`** :

| Ligne | Paquet | État |
|---|---|---|
| 2481 | `jsonptr` | dépendance, **déjà** en 0.6.3 avant le bump |
| **3335** | **`pilot`** | **la seule ligne modifiée** |
| 4676 | `socket2` | dépendance, **déjà** en 0.6.3 avant le bump |
| 5783 | `toml_datetime` | dépendance, **déjà** en 0.6.3 avant le bump |

Les 23 autres occurrences sont des sommes de contrôle (checksums) ou des références
(`toml_datetime 0.6.3`). Le contrôle réellement pertinent — **une seule ligne modifiée, celle de
`pilot`** — est vert, et la compilation Rust passe en `pilot v0.6.3` (voir §3).

`npm run build:handbook` relancé (via la chaîne de fabrication) : **aucune modification** de
`help/handbook.md` (`git status` ne le liste pas). La documentation embarquée était déjà à jour.

---

## 3. Contrôles AVANT publication — tous verts

### Tests JavaScript (Vitest)

| Passe | Commande | Résultat exact | Code de sortie |
|---|---|---|---|
| Avant le bump | `npx vitest run` | **229 fichiers passés (229)**, **4249 tests passés (4249)**, **0 échec** | 0 |
| Après le bump | `./node_modules/.bin/vitest run --reporter=json` | **229 fichiers**, **4249 tests**, **4249 passés**, **0 échec**, 1322 suites, **0 suite en échec** | 0 |

Le second comptage a été fait sur le **fichier JSON de Vitest** (1,5 Mo), recompté par script, et
non sur une sortie écran : chiffres lus dans `numTotalTests` / `numPassedTests` / `numFailedTests` /
`testResults[].status`.

### Tests Rust (Tauri, crate `pilot`)

| Passe | Commande | Résultat exact | Code de sortie |
|---|---|---|---|
| Avant le bump | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **807 passés, 0 échec, 1 ignoré** (10,61 s) — binaire compilé en `pilot v0.6.2` | 0 |
| Après le bump | idem | **807 passés, 0 échec, 1 ignoré** (10,51 s) — ligne de compilation : **`Compiling pilot v0.6.3`** | 0 |

Les deux exécutions longues ont été lancées **en tâche de fond**, sortie redirigée dans un fichier
(`/tmp/pub063/*.log`), jamais au premier plan et jamais silencieusement.

### Fabrication

| Étape | Commande | Résultat exact |
|---|---|---|
| Extensions MCP + handbook + Laya + front | `npm run build:mcp && npm run build:handbook && npm run prepare:laya && npm run build` | **`✓ built in 13.57s`**, code de sortie 0 |
| Application installable | `npm run tauri build` | **binaire + 2 installateurs produits** (ci-dessous), code de sortie **1** à cause de la **seule** étape de signature |

Artefacts réellement produits sur disque :

| Fichier | Taille |
|---|---|
| `target/release/pilot.exe` | 46 559 232 o (44,4 Mo) — contient `0.6.3` |
| `target/release/bundle/msi/Pilot_0.6.3_x64_en-US.msi` | **83 005 440 o (79,2 Mo)** |
| `target/release/bundle/nsis/Pilot_0.6.3_x64-setup.exe` | **63 768 584 o (60,8 Mo)** |

Message final du build : `A public key has been found, but no private key. Make sure to set
TAURI_SIGNING_PRIVATE_KEY`. **La fabrication est réussie** ; seule la **signature de mise à jour**
ne peut pas être produite en local, la clé privée n'existant que dans les secrets GitHub. Le
workflow CI signe les artefacts qu'il publie.

Avertissements sans effet : `sqlx-postgres` signalé « code rejeté par une future version de Rust »
et paquets plus gros que 500 kB côté front. Aucun n'a fait échouer quoi que ce soit.

---

## 4. Publication réelle sur GitHub

| Élément | Valeur |
|---|---|
| Dépôt | `pleveneur/pilot`, branche `main` |
| Push `main` | accepté (avance rapide de `c1217c9` à `6fd00df`) |
| Tag poussé | `v0.6.3` (annoté, objet `fd1025b…` → commit `6fd00df…`) |
| Workflow | `.github/workflows/release.yml`, **exécution #168**, identifiant **`40822161332`** |
| Déclenchement | `2026-10-29T05:13:44Z` (tag `v0.6.3`, `head_sha = 6fd00df…`) |
| URL | <https://github.com/pleveneur/pilot/actions/runs/40822161332> |
| **Release créée** | **`427489986`** — « Pilot v0.6.3 », `draft: false`, `prerelease: false`, publiée `2026-10-29T05:13:54Z` |
| URL release | <https://github.com/pleveneur/pilot/releases/tag/v0.6.3> |

### État de départ du workflow (relevé à 05 h 16 UTC, **sans attendre la fin**)

| Job | État au relevé |
|---|---|
| `create-release` | ✅ **success** (la release existe : vérifié par l'API, identifiant ci-dessus) |
| `test (windows-latest)` | 🔄 in_progress |
| `test (macos-latest)` | 🔄 in_progress |
| `test (ubuntu-22.04)` | 🔄 in_progress |
| jobs `build` (Windows x64, macOS Intel, macOS Apple Silicon) et `latest-json` | pas encore créés (ils attendent les tests) |

**Artefacts de la release au moment du rapport : 0** (normal : les builds n'ont pas commencé).
Le corps de la release est encore **vide** : il est rempli par l'étape `latest-json`
(`scripts/gen-latest-json.js`) à la fin du workflow, qui y dépose le texte de
`release-notes/v0.6.3.md`.

Contenu attendu de la release (mêmes cibles qu'en 0.6.2) : `Pilot_0.6.3_x64-setup.exe` (NSIS,
Windows), `Pilot_0.6.3_x64_en-US.msi`, `Pilot_x64.app.tar.gz` + `Pilot_aarch64.app.tar.gz` (macOS),
`Pilot_0.6.3_x64.dmg` + `Pilot_0.6.3_aarch64.dmg`, les fichiers `.sig` correspondants et
`latest.json` — soit **11 fichiers**. Le job `build-linux` reste séparé en `continue-on-error` : il
ne bloque ni ne retarde la publication (il était déjà en échec sur `v0.6.1` et `v0.6.2`).

---

## 5. Changelog publié (texte exact de `release-notes/v0.6.3.md`)

Titre : **Pilot v0.6.3** — chapeau : « L'écran Vocal devient un vrai bouton de conversation… ».

Trois catégories, 9 nouvelles fonctionnalités, 6 corrections, 4 améliorations :
trois modes d'écran pilotés par le logo, écran Vocal dépouillé, demande envoyée en parlant,
bouton rond « Réveiller *nom* », voix qui coupe Pilot, longueur des réponses réglable (4 niveaux),
délai d'envoi réglable (1 à 5 s), nom et portrait du personnage actif, MCP piloté depuis la
conversation ; dictée qui se réarme après un silence, plus d'arrêts prématurés d'agents, plus de
fenêtre noire, mission visible dès l'envoi, coupure de lecture fiable, mesure du niveau dès le
premier son ; halo plus large et plus doux, phrase d'état au-dessus de la saisie, « Outils » au lieu
d'« Action », lueur visible au bord du cercle. Le fichier compte **93 lignes**, accentué, sans nom de
fichier, sans nom de fonction, sans numéro de commit.

---

## 6. Ce que le propriétaire doit vérifier à la main

1. **La fin du workflow** — <https://github.com/pleveneur/pilot/actions/runs/40822161332> :
   les jobs `build` (Windows, macOS Intel, macOS Apple Silicon), puis `latest-json`, doivent finir
   en **success**. C'est `latest-json` qui signe, publie les 11 fichiers et **remplit le corps de la
   release** avec le changelog.
2. **La page de release** — <https://github.com/pleveneur/pilot/releases/tag/v0.6.3> : titre
   « Pilot v0.6.3 », texte des notes = le changelog français, **11 fichiers** présents.
3. **La mise à jour s'installe** : ouvrir Pilot **v0.6.2** installé → la proposition doit annoncer
   **0.6.3** (Windows : `Pilot_0.6.3_x64-setup.exe`).
4. **Les cinq vérifications visibles** :
   - un clic sur le **logo** en haut à gauche doit faire passer Détaillé → Assistant seul → Vocal,
     l'infobulle annonçant l'écran suivant ;
   - en mode Vocal : halo plus large et plus doux, phrase d'état **au-dessus** de la zone de saisie,
     bouton rond **« Réveiller *nom* »** visible hors écoute et effacé pendant l'écoute ;
   - parler après un long silence : la dictée **repart** et aucun message de panne n'apparaît ;
     un micro réellement refusé/absent doit, lui, être annoncé ;
   - laisser un agent travailler pendant une compilation : il ne doit plus être arrêté ;
   - lancer une commande en arrière-plan sur Windows : **plus de fenêtre noire**.
5. **Le point `build-linux`** (préexistant, hors de cette publication) et **l'image du serveur GDS**
   (non reconstruite volontairement) restent des **décisions du propriétaire** : rien n'a été touché
   ici.
6. **`v0.6.2`** doit rester à `57abb62` — à ne pas retoucher.

---

## 7. Ce qui n'a pas été fait (volontairement)

- **Aucune modification du code de l'application** : le commit ne porte que les quatre numéros de
  version et le changelog.
- **Aucune reconstruction ni rechargement de l'image du serveur GDS** (`npm run gds:image` /
  `npm run gds:reload` **non lancés**).
- **Aucun geste Git destructif** : pas de `reset`, pas de force push, aucun tag supprimé ou déplacé.
- **Aucun fichier non suivi touché** (rapports de mission, documents de conception, propositions).
- **Aucun outil listant les sessions d'agents n'a été appelé.**
- Aucune correction de défaut découverte en chemin : aucun défaut bloquant n'a été rencontré. Le
  seul écart est la signature locale impossible (§3), sans effet sur la publication.
