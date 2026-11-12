# Rapport — publication de Pilot v0.6.25

Date : 2026-11-12 · Projet : `G:\IA_PL\pilot` (Tauri v2 + JS, Vitest + cargo)
Mission : publier la version **0.6.25**, déjà préparée et commitée (`3db8721`) —
l'**oreille locale Whisper** entre dans l'application **livrée** (le modèle se
télécharge sur un geste), **sans rien changer par défaut** ni pour la voix ni
pour la transcription existante.

> Chaque affirmation ci-dessous est la sortie d'une commande réellement lancée.
> Aucun résultat n'est reconstitué.

---

## 1. État AVANT (constaté, pas supposé)

```
branche             : main
HEAD                : 3db8721c8ec1c8e5107576899dc74a4b94c8dac2
origin/main (avant) : f4a029bb553f8804160ab65d4b789595c40d84c1 (3 commits locaux non poussés)
arbre de travail    : propre (git status --porcelain → 0 ligne)
tag v0.6.25         : inexistant (git tag -l v0.6.25 → 0 ligne)
tag le plus haut    : v0.6.24 (publié, laissé intact)
```

**GDS** : `.pilot/gds.json` est **hors suivi** (`git check-ignore -v` →
`.gitignore:44: .pilot/`) et contient `"enabled": false`, avec `server_url` et
`db_host` vides. Le projet n'est **pas** basculé sur le GDS : la publication
GitHub est permise.

Changements depuis la v0.6.24 (`git log --oneline v0.6.24..v0.6.25`, 4 commits) :

```
3db8721 feat(voix): l'oreille Whisper intégrée entre dans l'application livrée (0.6.25)
c8c366c fix(vocal): oreille intégrée Whisper — compile sans outillage C++
e044e89 feat(vocal): oreille intégrée Whisper, additive et désactivée par défaut
f4a029b docs(rapports): rapport de publication v0.6.24
```

## 2. Numéro de version — cohérent partout

```
package.json              : 0.6.25
src-tauri/tauri.conf.json : 0.6.25
src-tauri/Cargo.toml      : 0.6.25   (package `pilot`, ligne 3)
Cargo.lock                : 0.6.25   (package `pilot`, ligne 3409 — UNE SEULE
                                       occurrence de « version = "0.6.25" », piège
                                       du sed global évité)
```

Aucun recul de numéro, aucun tag réutilisé : `v0.6.24` reste intact et n'est
**pas** republié.

## 3. Notes de version

`release-notes/v0.6.25.md` : présent, 44 lignes, en français, accents compris,
orienté utilisateur (aucun nom de fichier, aucune fonction). La porte de
publication (`scripts/release-gates.js`) le juge lisible.

Le message de publication dit exactement ce qui est demandé : **nouvelle oreille
locale optionnelle** (le modèle se télécharge sur un geste), **rien ne change par
défaut** ni pour la voix ni pour la transcription existante.

## 4. Contrôles qualité — AVANT le tag

Aucun test assoupli, désactivé ou supprimé.

| Contrôle | Commande | Résultat exact |
|---|---|---|
| Tests front (Vitest) | `npm test` | **325 fichiers, 5 995 tests, 0 échec** (16,60 s) |
| Tests Rust (workspace complet) | `cargo test --workspace` | **1 147 passed, 14 ignored, 0 échec** (exit 0, 6 suites) |
| Tests Rust sous la feature livrée | `cargo test --manifest-path src-tauri/Cargo.toml --features whisper --lib` | **975 passed, 3 ignored, 0 échec** (exit 0) |
| Fabrication de l'application | `npm run tauri build -- --features whisper` | binaire + **2 installateurs produits** (voir ci-dessous) |
| Changelog lisible | `release-notes/v0.6.25.md` | présent et rédigé |

Fabrication réellement écrite sur disque (`stat -c '%s'`) :

```
target/release/pilot.exe                            51 396 608 o  (49,0 Mo)
target/release/bundle/nsis/Pilot_0.6.25_x64-setup.exe  68 332 736 o  (65,2 Mo)
target/release/bundle/msi/Pilot_0.6.25_x64_en-US.msi   89 370 624 o  (85,2 Mo)
```

Le `beforeBuildCommand` complet a tourné sans échec
(`build:mcp && build:handbook && prepare:laya && build`) et `git status` est
resté **propre** après la fabrication (documentation embarquée régénérée
identique au dépôt).

Le drapeau `--features whisper` a bien compilé le moteur localement
(`whisper-rs-sys` construit, liaisons pré-générées employées faute de
`libclang`, exactement le chemin documenté), et le binaire Windows le
**contient** :

```
grep -a -c "whisper_full_with_state" target/release/pilot.exe   → 13
grep -a -c "ggml_backend"          target/release/pilot.exe     → 22
```

### ⚠️ Une ligne d'erreur en fin de `tauri build` (même cas qu'en 0.6.24)

```
A public key has been found, but no private key.
Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
```

Ce n'est **pas** un échec de fabrication : l'application et ses deux
installateurs sont sur le disque (tailles ci-dessus). Seule la **signature de la
mise à jour automatique** est impossible en local, la clé privée d'`updater`
étant le secret GitHub `TAURI_SIGNING_PRIVATE_KEY` utilisé par la CI. La
signature a bien été faite par le workflow (`.sig` présents dans la Release).

## 5. Étiquette et envoi

```
tag       : v0.6.25 annoté, objet 9c555d42886518f1ee37105ec121325a6473b6d8
            -> pointe sur 3db8721c8ec1c8e5107576899dc74a4b94c8dac2
message   : « Pilot 0.6.25 — nouvelle oreille locale optionnelle (le modèle se
            télécharge sur un geste). Rien ne change par défaut […] »
push      : git push origin main  → ok
            git push origin v0.6.25 → ok
```

Vérification **par le distant** (`git ls-remote origin`) :

```
refs/heads/main          : 3db8721c8ec1c8e5107576899dc74a4b94c8dac2  (identique au local)
refs/tags/v0.6.25        : 9c555d42886518f1ee37105ec121325a6473b6d8  (identique au local)
refs/tags/v0.6.25^{}     : 3db8721c8ec1c8e5107576899dc74a4b94c8dac2  (le commit de version)
commits non poussés      : aucun (git log origin/main..HEAD → vide)
```

## 6. Workflow de publication — résultat réel

`gh` n'est pas installé sur ce poste : l'état est lu par l'API GitHub.

```
run 43234871618 · release       · v0.6.25 · créé 2026-11-12T14:12:55Z
run 43234862877 · quality-gate  · main    · completed · success  (commit 3db8721)
```

Jobs du workflow `release` (état lu dans `/actions/runs/43234871618/jobs`) :

| Job | Statut | Conclusion |
|---|---|---|
| `test (ubuntu-22.04)` | completed | **success** |
| `test (windows-latest)` | completed | **success** |
| `test-macos` | completed | **success** |
| `create-release` | completed | **success** (Release publiée à 14:19:56Z) |
| `build (windows-latest, x86_64-pc-windows-msvc)` | completed | **success** |
| `build (macos-latest, aarch64-apple-darwin)` | completed | **échec** |
| `build (macos-latest, x86_64-apple-darwin)` | completed | **échec** |
| `latest-json` | completed | **success** |
| `build-linux` | in_progress | — (hors chemin critique, ne bloque rien) |

## 7. Release publiée — fichiers réellement présents

`GET /repos/pleveneur/pilot/releases/tags/v0.6.25` → `draft: false`,
`prerelease: false`, `published_at: 2026-11-12T14:19:56Z`, nom `Pilot v0.6.25`.

```
latest.json                              3 431 o
Pilot_0.6.25_x64-setup.exe          65 491 736 o   (NSIS, Windows x64)
Pilot_0.6.25_x64-setup.exe.sig             416 o   (signature updater)
Pilot_0.6.25_x64_en-US.msi          85 458 944 o   (MSI, Windows x64)
Pilot_0.6.25_x64_en-US.msi.sig             416 o   (signature updater)
```

`latest.json` téléchargé depuis la Release :

```
version   : 0.6.25
platforms : ["windows-x86_64"]  -> Pilot_0.6.25_x64-setup.exe (signature présente)
notes     : contient le changelog v0.6.25 ET la phrase d'absence de macOS
```

## 8. ⚠️ macOS : les deux fabrications ont échoué (livraison incomplète ANNONCÉE)

- Les deux cibles macOS échouent sur **la même étape**, `Build and sign Tauri app`
  (les dix étapes précédentes sont vertes : checkout, Node, LayaPL, cache Rust,
  npm ci, bundle MCP...). Durées : 6 min 41 s (Intel) et 7 min 13 s (Apple
  Silicon) — la compilation a donc tourné un moment avant d'échouer.
- Le **journal détaillé n'est pas lisible sans authentification** :
  `GET /actions/jobs/<id>/logs` répond **403** avec `curl` anonyme, et `gh`
  n'est pas installé sur ce poste. Les seules annotations publiques sont des
  avertissements sans rapport (`Node.js 20 is deprecated…`). **La cause exacte
  n'est donc pas prouvée ici** — elle est à lire par le propriétaire.
- **Cause la plus probable, documentée d'avance** : la v0.6.24, fabriquée **sans**
  `--features whisper`, avait réussi sur macOS ; le seul changement de
  fabrication est ce drapeau. Le rapport du codeur le notait noir sur blanc
  (`docs/rapports/RAPPORT-oreille-integree-whisper-livraison.md` § 8.6) : «
  **macOS** (Intel et Apple Silicon) : le seul point non mesuré ici » — c'est
  exactement ce point qui échoue.
- Ce n'est **pas** un échec silencieux, et c'est conforme à la décision du
  dépôt (`docs/rapports/RAPPORT-publication-sans-macos.md`) :
  - l'étape `scripts/detect-macos-gap.js` n'autorise la livraison incomplète que
    si **seul macOS** manque (Windows livré ici) ;
  - l'absence est **annoncée** en français dans le corps de la Release et dans
    les notes de `latest.json` ;
  - Windows reste servi, la mise à jour automatique fonctionne pour lui ;
  - les postes macOS **ne reçoivent pas** cette version et restent sur leur
    version actuelle.
- Le changelog publié annonce encore « les trois plateformes publiées
  (Windows, macOS Intel, macOS Apple Silicon) ». C'est exact pour le **code**
  (le drapeau est posé sur les trois cibles), mais **faux pour la livraison du
  jour** : la phrase d'absence ajoutée automatiquement en fin de notes le dit.
  À corriger dans la rédaction d'une prochaine version si macOS reste en échec.

## 9. Ce qui n'a pas été fait (et pourquoi)

- **Aucune modification de code, de test ni de workflow** : le publieur ne touche
  pas aux fichiers du codeur. Le contenu publié est exactement `3db8721`.
- **Aucun tag republié** : `v0.6.24` et les précédents sont intacts ; `v0.6.25`
  est neuf.
- **Aucun git destructif** : ni `reset`, ni `checkout` écrasant, ni `force push`.
- **Aucune suppression** de fichier, de sauvegarde ou de donnée du propriétaire.
- **Aucun autre projet touché** (moteur vidéo et réglages d'autres projets
  intacts).
- **Aucun outil de liste de sessions d'agents** n'a été appelé.

## 10. Geste propriétaire — ce qu'il faut vérifier à la main

| Point | Geste exact |
|---|---|
| **Lire le journal de l'échec macOS** (le seul vrai inconnu) | GitHub → *Actions* → run **43234871618** → job `build (macos-latest, aarch64-apple-darwin)` → étape `Build and sign Tauri app` |
| Attendre la fin du run (Linux en cours, ne bloque rien) | même page ; `latest-json` est déjà vert, la Release existe |
| Vérifier la Release et ses fichiers | `curl -s https://api.github.com/repos/pleveneur/pilot/releases/tags/v0.6.25` — attendu : NSIS + MSI Windows, leurs `.sig`, `latest.json` |
| Vérifier que `latest.json` annonce 0.6.25 | `curl -sL https://github.com/pleveneur/pilot/releases/download/v0.6.25/latest.json` → `"version": "0.6.25"` |
| **Recevoir la mise à jour (Windows)** | rien à faire : Pilot la propose au prochain démarrage ; Options → À propos doit afficher **0.6.25** |
| Vérifier l'oreille intégrée | Options → Assistant → « Mode Vocal » → moteur **« Moteur intégré (dans Pilot) »** : la page doit proposer le **téléchargement du modèle (~874 Mo)** avec une barre de progression et un bouton d'arrêt. Rien ne doit se télécharger sans ce geste |
| Vérifier que le défaut n'a pas bougé | sans toucher au réglage : la dictée reste celle d'avant (service de voix local / navigateur), la voix et la lecture à voix haute sont inchangées |
| Vérifier le repli annoncé | moteur intégré choisi **sans** modèle installé : message en français disant où en est la situation et ce qui se passe à la place — jamais un silence |
| **Ne jamais republier `v0.6.25`** | si une correction macOS est nécessaire, créer un **numéro suivant** (0.6.26) : un tag poussé ne se répare pas |

## 11. Intégrité

```
HEAD (commit publié)   : 3db8721c8ec1c8e5107576899dc74a4b94c8dac2
origin/main            : 3db8721c8ec1c8e5107576899dc74a4b94c8dac2   (identiques)
tag annoté v0.6.25     : 9c555d42886518f1ee37105ec121325a6473b6d8
  -> pointe sur        : 3db8721c8ec1c8e5107576899dc74a4b94c8dac2
tag distant v0.6.25    : 9c555d42886518f1ee37105ec121325a6473b6d8   (identiques)
Release                : publiée (draft: false) le 2026-11-12T14:19:56Z
workflow release       : run 43234871618 — Windows ✅ · macOS ❌❌ · latest-json ✅
workflow quality-gate  : run 43234862877 (main, 3db8721) — success
```

Empreintes des artefacts fabriqués **sur ce poste** (`sha256sum`) — référence
locale ; les fichiers publiés sont reconstruits et **signés** par la CI, donc
leurs empreintes diffèrent :

```
07420a6d0dc1f93e309824c1eeb9954a7c4cf6dcfb52246cf4b7e12d611a0071  bundle/nsis/Pilot_0.6.25_x64-setup.exe
a96782f37efbd661cedfccc4eec3a91d9309d7ae40644b70d00c66d3de49bd99  bundle/msi/Pilot_0.6.25_x64_en-US.msi
3cdaa91290170b9e151c896f89c347c33265819c7ccbe66d0814613263869f4f  pilot.exe
```

Ceinture de sécurité respectée : **aucun tag déplacé ni republié**, **aucun
secret touché**, **aucun fichier de l'utilisateur supprimé**, **aucun code de
comportement modifié**.
