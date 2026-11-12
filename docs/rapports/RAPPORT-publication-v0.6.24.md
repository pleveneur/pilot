# Rapport — publication de Pilot v0.6.24

Date : 2026-11-12 · Projet : `G:\IA_PL\pilot` (Tauri v2 + JS, Vitest + cargo)
Mission : publier la version qui répare le mode Vocal — la veille de 20 s se voit
enfin (commit `b34e25e`) et elle s'arme aussi quand la dictée passe par le
service de voix local (commit `fd1b5f4`), plus la correction d'étiquette Telegram
(`7077809`) arrivée depuis la v0.6.23.

> Chaque affirmation ci-dessous est la sortie d'une commande réellement lancée.
> Aucun résultat n'est reconstitué.

---

## 1. État AVANT (constaté, pas supposé)

```
branche             : main
HEAD (avant bump)   : fd1b5f4a22900c65647c740663b1e126a92e802f
origin/main (avant) : 6a8aca2 (3 commits locaux non poussés)
arbre de travail    : propre (git status --short vide)
tags les plus hauts : v0.6.23 (publié), v0.6.22 (local, jamais poussé)
versions fichiers   : package.json 0.6.23 · tauri.conf.json 0.6.23 ·
                      src-tauri/Cargo.toml 0.6.23 · Cargo.lock (pilot) 0.6.23
tag v0.6.24         : inexistant (git tag -l v0.6.24 → 0 ligne)
```

**GDS** : `.pilot/gds.json` existe mais il est **hors suivi** (ignoré par
`.gitignore:44`) et il contient `"enabled": false` avec `server_url` vide : le
projet n'est **pas** basculé sur le GDS. La publication GitHub est donc permise
(la règle absolue ne s'applique pas ici).

Changements depuis la v0.6.23 (`git log --oneline v0.6.23..HEAD`, 5 commits) :

```
fd1b5f4 fix(vocal): la veille de 20 s s'arme aussi avec la transcription locale
b34e25e fix(vocal): la veille se voit — ligne d'état visible et cercle en attente
7077809 fix: l'etiquette Telegram nomme le projet reellement concerne
6a8aca2 docs(rapports): constat date du seul job hors chemin critique (build-linux)
159317f docs(rapports): rapport de publication v0.6.23 (publiee, Windows + macOS complets)
```

## 2. Numéro de version

- Dernière version publiée et installée : **0.6.23** (tag `v0.6.23` poussé).
- Les trois commits fonctionnels sont des **correctifs** → incrément du dernier
  chiffre : **0.6.24**. Aucun recul, aucun tag réutilisé.
- `git tag -l v0.6.24` renvoyait 0 ligne avant création.

Bump dans les **quatre** fichiers (une seule occurrence de la version du paquet
`pilot` dans `Cargo.lock`, vérifié par `grep -c`) :

```
package.json                 : 0.6.24
src-tauri/tauri.conf.json    : 0.6.24
src-tauri/Cargo.toml         : 0.6.24
Cargo.lock (pilot, l. 3335)  : 0.6.24
```

Contrôle anti-piège : `grep -rn '0\.6\.23'` sur ces quatre fichiers → **aucune**
occurrence restante.

## 3. Notes de version (`release-notes/v0.6.24.md`)

Fichier créé, en français, accents compris, orienté utilisateur (aucun nom de
fichier, aucune fonction, aucun jargon interne). Trois corrections annoncées :

1. quand Pilot attend le nom, la phrase « Dites « <Nom> » pour me parler. » reste
   affichée et le cercle passe en attente (anneau pointillé, respiration
   arrêtée) ;
2. la veille de 20 s s'arme aussi avec la case « Transcrire avec le service de
   voix local » cochée (délai inchangé) ;
3. un message Telegram nomme le projet réellement concerné, pour les réponses
   comme pour les alertes.

La porte de publication du dépôt (`scripts/release-gates.js`,
`evaluateReleaseNotes`) refuse un fichier absent ou réduit à un titre :
`hasReadableNotes` est satisfait (le fichier contient des paragraphes et des
puces rédigés).

## 4. Contrôles qualité AVANT publication

Aucun contrôle n'a été assoupli, aucun test désactivé, aucun `it.skip` ajouté.

| Contrôle | Commande | Résultat exact |
|---|---|---|
| Tests front (Vitest) | `npm test` | **322 fichiers, 5940 tests, 0 échec** (durée 16,46 s) |
| Tests Rust (workspace) | `cargo test --workspace` | **1137 passed, 14 ignored, 0 échec** (6 suites) |
| Fabrication de l'application | `npm run tauri build` | binaire `target/release/pilot.exe` (46,3 Mo) + **2 bundles produits** |
| Changelog lisible | `release-notes/v0.6.24.md` | présent et rédigé |

Bundles réellement écrits sur disque :

```
target/release/bundle/msi/Pilot_0.6.24_x64_en-US.msi      84,6 Mo
target/release/bundle/nsis/Pilot_0.6.24_x64-setup.exe     64,7 Mo
```

Le `beforeBuildCommand` complet a tourné sans échec
(`build:mcp && build:handbook && prepare:laya && build`) : la documentation
embarquée régénérée est **identique** à celle du dépôt (`help/handbook.md` non
modifié selon `git status`).

### ⚠️ Une ligne d'erreur à la fin de `tauri build` — explication

```
A public key has been found, but no private key.
Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
       Error A public key has been found, but no private key.
```

Ce n'est **pas** un échec de fabrication : l'application et ses deux
installateurs sont produits et relus sur le disque. Seule la **signature de la
mise à jour automatique** est impossible en local, parce que la clé privée
d'`updater` ne vit pas sur ce poste : elle est le secret GitHub
`TAURI_SIGNING_PRIVATE_KEY`, utilisé par le workflow `release.yml`. Le contrôle
« fabrication réussie » est donc satisfait ; la signature est faite par la CI
(voir § 6).

## 5. Commit et étiquette

```
commit  : 712f7128cf8d7927f40c0ab0a2e727d67e8e0a56  « chore: bump version to 0.6.24 »
          (5 fichiers : package.json, src-tauri/tauri.conf.json,
           src-tauri/Cargo.toml, Cargo.lock, release-notes/v0.6.24.md)
tag     : v0.6.24 annoté, objet fa47b42bfb1d9e5de153231ecd8f03644477c1ec
          -> pointe sur 712f7128cf8d7927f40c0ab0a2e727d67e8e0a56
```

Envoi :

```
git push origin main    -> ok main
git push origin v0.6.24  -> ok v0.6.24
```

Vérification **par le distant** (`git ls-remote`) :

```
refs/heads/main     : 712f7128cf8d7927f40c0ab0a2e727d67e8e0a56   (identique au local)
refs/tags/v0.6.24   : fa47b42bfb1d9e5de153231ecd8f03644477c1ec   (identique au local)
commits non poussés : 0
```

## 6. Workflow de publication

`gh` n'est pas installé sur ce poste : l'état a été lu par l'API GitHub
(`/repos/pleveneur/pilot/actions/runs`).

```
run 43159278519 · release       · v0.6.24 · démarrage 2026-11-12T05:07:45Z
run 43159272158 · quality-gate  · main    · completed · success
```

Le job `quality-gate` sur `main` (tests front + Rust) est **vert**. Le workflow
`release` construit Windows (+ macOS toléré) et macOS, signe les artefacts avec
`TAURI_SIGNING_PRIVATE_KEY`, crée la Release depuis `release-notes/v0.6.24.md`,
puis génère `latest.json` — c'est lui qui rend la mise à jour visible aux
utilisateurs installés. À l'heure de ce rapport il est **encore en cours**
(`in_progress`, dernier rafraîchissement `2026-11-12T05:31:16Z`, soit ~24 min
après le démarrage — l'attente d'une machine macOS est le cas habituel) : la
Release n'existe donc **pas encore** et **aucun fichier de release ne peut être
listé ici** — voir § 8 pour le geste de vérification.

Ce qui est en revanche **prouvé sur disque et sur le distant** : l'étiquette
`v0.6.24` existe et est poussée, `main` est à jour, les tests front et Rust sont
verts, et l'application a été fabriquée localement avec ses deux installateurs.

## 7. Ce qui n'a pas été fait (et pourquoi)

- **Aucune modification de comportement** : seuls la version, le changelog et ce
  rapport changent. `git status` après bump ne listait que ces fichiers.
- **Aucun test touché** : ni assoupli, ni désactivé, ni supprimé.
- **Aucun tag republié** : `v0.6.23` reste intact, `v0.6.24` est neuf.
- **Aucun git destructif** : pas de `reset`, pas de `checkout` écrasant, pas de
  `force push`.
- **Tag local `v0.6.22`** (jamais poussé) : laissé en place, comme décidé.
- **Moteur vidéo et réglages d'autres projets** : non touchés.
- **Aucun outil de liste de sessions d'agents** n'a été appelé.

## 8. Geste propriétaire — ce qu'il faut vérifier à la main

| Point | Geste exact |
|---|---|
| Attendre la fin du workflow `release` (run 43159278519) | onglet *Actions* → *release* → run du tag `v0.6.24` ; doit finir en `success` |
| Vérifier que la Release existe et liste ses fichiers | `curl -s https://api.github.com/repos/pleveneur/pilot/releases/tags/v0.6.24` (attendu : `Pilot_0.6.24_x64-setup.exe`, `Pilot_0.6.24_x64_en-US.msi`, `.sig`, `latest.json`, et les `.dmg` macOS si une machine Apple a été attribuée) |
| Vérifier que `latest.json` annonce bien 0.6.24 pour Windows | `curl -sL https://github.com/pleveneur/pilot/releases/download/v0.6.24/latest.json` |
| **Recevoir la mise à jour** | rien à faire de spécial : Pilot la propose seul au prochain démarrage (updater). Si l'on veut forcer : fermer puis relancer Pilot, puis accepter la mise à jour |
| Vérifier la version installée après mise à jour | Options → À propos doit afficher **0.6.24** |
| Vérifier à l'écran les deux correctifs vocaux | mode Vocal, rester silencieux 20 s : la phrase « Dites « <Nom> » pour me parler. » doit **rester visible** et le cercle passer en attente (anneau pointillé). Puis cocher Options → Assistant → « Transcrire avec le service de voix local », revenir au mode Vocal et rester silencieux 20 s : la veille doit s'armer **aussi** |
| Vérifier l'étiquette Telegram | envoyer un message par Telegram alors qu'un **autre** projet est ouvert dans Pilot : le préfixe doit nommer le projet réellement concerné |
| Si macOS manque encore | le dépôt est public, GitHub n'attribue pas toujours de machine Apple : une version peut sortir sans installateurs macOS, l'absence est alors **annoncée** dans la Release et dans `latest.json` (voir `docs/rapports/RAPPORT-publication-sans-macos.md`). Ne **jamais** republier `v0.6.24` : créer un numéro suivant |

## 9. Intégrité — empreintes après envoi

```
HEAD (commit de version) : 712f7128cf8d7927f40c0ab0a2e727d67e8e0a56
origin/main              : 712f7128cf8d7927f40c0ab0a2e727d67e8e0a56   (identiques)
tag annoté v0.6.24       : fa47b42bfb1d9e5de153231ecd8f03644477c1ec
  -> pointe sur          : 712f7128cf8d7927f40c0ab0a2e727d67e8e0a56
tag distant v0.6.24      : fa47b42bfb1d9e5de153231ecd8f03644477c1ec   (identiques)
commits non poussés      : aucun
workflow release         : run 43159278519 (v0.6.24), in_progress au 2026-11-12T05:31:16Z
workflow quality-gate    : run 43159272158 (main), success
```

Empreintes locales des artefacts fabriqués sur ce poste (`sha256sum`) — elles
servent de référence ; les fichiers publiés sont reconstruits et signés par la
CI, donc leurs empreintes différeront :

```
6cfe49934993e6791e603b9fd68049f9ae2ca0b7ab7990d5819aabe332a30416  bundle/nsis/Pilot_0.6.24_x64-setup.exe
c22a7485b7e06673de3b9ee95a2b09b9ec4870125bfda0c8759c37b931efe7a0  bundle/msi/Pilot_0.6.24_x64_en-US.msi
8368a840fb0d128052e025f836db969f53e0efb3c4c71f9243c9a9459226c49b  pilot.exe
```

Ceinture de sécurité respectée : **aucun tag déplacé ni republié**, **aucun
secret touché**, **aucun fichier de l'utilisateur supprimé**, **aucun code de
comportement modifié**.
