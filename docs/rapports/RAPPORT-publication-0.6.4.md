# Rapport de publication — Pilot v0.6.4 (préparation)

**Date de rédaction** : 29 octobre 2026, 07 h 00 UTC (11 h 00 heure locale UTC+4)
**Rédigé AVANT les contrôles longs** (consigne de la mission), puis complété par les résultats réels.
**Version publiée précédemment** : `0.6.3` (étiquette `v0.6.3`, commit `6fd00df`)
**Version visée** : `0.6.4` — trois correctifs depuis `v0.6.3`, donc **dernier chiffre** incrémenté
(règle du projet : correctifs = patch, jamais de recul).
**Accord du propriétaire** : explicite, donné avant le début des travaux
(« Feu vert du propriétaire (2026-10-29) pour publier la 0.6.3 en AUTONOMIE… » puis mission
« préparer la publication de la version suivante »).

---

## 1. État réel du dépôt au départ

| Élément | Valeur |
|---|---|
| Branche courante | `main` |
| Dernier commit | `a3f612d` — `fix(vocal): la reponse n'est plus lue deux fois a voix haute` |
| Dernière étiquette | `v0.6.3` (annotée) |
| Commits depuis l'étiquette | **3** |
| Distant `origin` | `https://github.com/pleveneur/pilot.git` |
| GDS | `.pilot/gds.json` → `"enabled": false` ⇒ **le projet n'est PAS basculé sur le GDS**, publication GitHub autorisée |

### Les trois commits à publier

| Commit | Objet | Effet visible |
|---|---|---|
| `00312f2` | `fix(questions): une question posée à l'utilisateur n'expire plus` | Les 4 dialogues humains (`ask_choice`, `ask_multi_choice`, `ask_confirm`, `ask_input`) n'ont plus d'échéance de 30 min : la question reste posée et une réponse tardive est reçue. Une réponse qui n'a pas pu être transmise est désormais **signalée** au lieu d'être jetée en silence. Les dialogues de machine (outils) gardent leur borne (exception nommée `HUMAN_DIALOG_NO_DEADLINE`, fichiers `src-tauri/extensions/pilot-choices.ts` et `src/js/super-agent.js`). |
| `6acddb8` | `Mode Vocal : le bouton « Travail » sur l'écran, à gauche des boutons système` | Le bouton « Travail » (tâches et agents en cours) est présent sur l'écran du mode Vocal, en haut à droite, à gauche des boutons de fenêtre. Même bouton, même panneau, même source : le nœud `#agent-activity` est déplacé puis restitué (`src/js/super-agent.js`, `src/css/style.css`). |
| `a3f612d` | `fix(vocal): la reponse n'est plus lue deux fois a voix haute` | La lecture automatique du mode Vocal ne prononce plus deux fois la même réponse (marque d'unicité `src/js/reponse-lue-une-seule-fois.js`), et la voix du système n'enchaîne plus deux fois le morceau suivant quand la fin d'un énoncé est signalée deux fois (`src/js/read-aloud.js`). Le clic manuel reste libre. |

Contenu cumulé : **20 fichiers**, +1456 / −27 lignes (dont les rapports et les tests des trois
correctifs).

---

## 2. Travail non commité présent dans l'arbre — LAISSÉ INTACT

Une autre mission a des modifications en cours dans le même arbre. **Aucune de ces lignes n'a été
touchée, ni committée, ni restaurée** :

```
 M help/handbook.md                                  (+6/−6)
 M spec_modes_ecran_vocal.md                         (+21/−…)
 M spec_voice_input.md                               (+6/−…)
 M src/js/super-agent.js                             (+27)
 M src/js/vocal-conversation.js                      (+68)
 M src/js/vocal-mesure-en-premier.test.js            (+15/−…)
 M src/js/vocal-parler-declenche-une-demande.test.js (+3/−…)
```

Les fichiers **non suivis à la racine** du dépôt (`VERIF-git-gds-inchange.md`, `vocal.md`,
`vocal-defauts-visuels.md`, `«`, `ça`, `.pi/vitest-report.json`) et les rapports/propositions non
suivis sous `docs/` n'ont pas été touchés non plus. Seuls **six** chemins sont ajoutés au commit de
publication (voir §6).

⚠️ Conséquence à signaler : `src/js/super-agent.js` et `help/handbook.md` sont **à la fois** modifiés
par la mission en cours et concernés par les correctifs déjà commités. Le commit de publication ne
les ajoute **pas** ; leur contenu non commité reste dans l'arbre pour la mission qui l'a produit.

---

## 3. Contrôles AVANT publication — tous verts

| Contrôle | Commande | Résultat réel (29/10/2026, 11 h 00 → 11 h 07 locale) |
|---|---|---|
| Tests JavaScript | `npm test` (= `vitest run`) | **233 fichiers / 4296 tests — 0 échec**, 13,21 s |
| Tests Rust + socle + serveur | `cargo test --workspace` | **980 passés / 12 ignorés / 0 échec** (6 suites, 12,60 s ; compilation 1 min 07) |
| Fabrication de l'application | `npm run tauri build` | **binaire + 2 installateurs produits** (ci-dessous) ; code de sortie **1** à cause de la **seule** étape de signature de mise à jour |

Ces chiffres sont **recomptés au moment de ce run**, pas recopiés d'un rapport antérieur
(la v0.6.3 affichait 231 fichiers / 4275 tests JS et 807 tests Rust : le total a monté avec les
tests des trois correctifs).

---

## 4. Configuration de publication — vérifiée, NON modifiée

| Élément | Constat |
|---|---|
| `src-tauri/tauri.conf.json` | `version` = la version bumpée ; `bundle.createUpdaterArtifacts` = `true` ; `plugins.updater` avec `pubkey` présent |
| `beforeBuildCommand` | `npm run build:mcp && npm run build:handbook && npm run prepare:laya && npm run build` |
| `.github/workflows/release.yml` | déclenché sur `push` d'un tag `v*` ; job `test` (matrice 3 OS, bloquant hors macOS) → `build` → `latest-json` |
| Secrets | **aucun secret lu, écrit ou modifié** ; `TAURI_SIGNING_PRIVATE_KEY` reste côté GitHub |

Aucune de ces valeurs n'a été changée par cette mission.

---

## 5. Bump de version — les quatre fichiers

| Fichier | Avant | Après |
|---|---|---|
| `package.json` | `0.6.3` | `0.6.4` |
| `src-tauri/tauri.conf.json` | `0.6.3` | `0.6.4` |
| `src-tauri/Cargo.toml` (paquet `pilot`) | `0.6.3` | `0.6.4` |
| `Cargo.lock` (**racine**) — bloc `[[package]] name = "pilot"` uniquement | `0.6.3` | `0.6.4` |

`Cargo.lock` est édité **de façon ciblée** (bloc du paquet `pilot`), **sans `sed`** : le piège de
l'incident v0.2.30 (une dépendance verrouillée par erreur) est évité par construction.

---

## 6. Contenu du commit de publication

Cinq chemins, rien d'autre — exactement comme les publications précédentes :

1. `package.json` (version)
2. `src-tauri/tauri.conf.json` (version)
3. `src-tauri/Cargo.toml` (version du paquet `pilot`)
4. `Cargo.lock` (racine — bloc `[[package]] name = "pilot"`)
5. `release-notes/v0.6.4.md` (changelog utilisateur, lu par la CI pour la note de release et la
   modale de mise à jour)

Ce rapport (`docs/rapports/RAPPORT-publication-0.6.4.md`) reste **hors du commit**, comme les
rapports de publication `0.6.0` → `0.6.3` : il n'entre pas dans le paquet livré et le committer
mêlerait la trace de la mission au contenu de la version.

---

## 7. Résultats réels des contrôles (détail et preuves)

### 7.1 Tests JavaScript — VERTS

```
 Test Files  233 passed (233)
      Tests  4296 passed (4296)
   Duration  13.21s
```

### 7.2 Tests Rust du workspace — VERTS

`cargo test --workspace` (desktop `pilot`, `gds-core`, `gds-server`) :

```
cargo test: 980 passed, 12 ignored (6 suites, 12.60s)
```

Aucun échec. 23 avertissements de compilation (fonctions jamais utilisées dans les tests, tous
préexistants) : aucun effet sur le résultat.

### 7.3 Fabrication de l'application — RÉUSSIE (non signée)

| Étape | Résultat |
|---|---|
| `build:mcp` | OK — `pilot-mcp-client.ts` 685,1 Ko, 0 erreur |
| `build:handbook` | OK — `help/handbook.md` régénéré, **empreinte identique** (aucune modification du travail en cours) |
| `prepare:laya` | OK — pièces du service Laya recopiées depuis `../LayaPL` |
| `vite build` | OK — 4141 modules, `built in 12.71s`, `dist/` 13 Mo |
| `cargo build --release` | OK — `target/release/pilot.exe` (46 576 128 octets) en 1 min 57 |
| Paquet MSI | OK — `Pilot_0.6.4_x64_en-US.msi`, **83 021 824 octets** |
| Paquet NSIS | OK — `Pilot_0.6.4_x64-setup.exe`, **63 770 189 octets** |
| Signature de mise à jour | **non produite en local** : `A public key has been found, but no private key` |

**Pourquoi la signature manque, et pourquoi ce n'est pas un échec** : la clé privée
`TAURI_SIGNING_PRIVATE_KEY` (et son mot de passe) sont un **secret GitHub**, volontairement absent de
cette machine — et il est **interdit** de la chercher ou de la modifier. C'est la **CI** qui signe et
produit `latest.json`. Même constat, déjà documenté, que pour `v0.6.3`
(`RAPPORT-publication-0.6.3.md`, §3) et `RAPPORT-build-installable.md`.

**Travail en cours d'une autre mission : intact.** Empreintes MD5 relevées avant le build puis
revérifiées après : `help/handbook.md`, `spec_modes_ecran_vocal.md`, `spec_voice_input.md`,
`src/js/super-agent.js`, `src/js/vocal-conversation.js`, `src/js/vocal-mesure-en-premier.test.js`,
`src/js/vocal-parler-declenche-une-demande.test.js` → **7/7 OK, à l'octet près**. Le build n'a rien
écrasé et rien n'a été restauré.

### 7.4 Verdict des contrôles

**TOUS VERTS** ⇒ la préparation de publication est valide. Seule réserve : la signature de
l'installeur, réservée à la CI (secret du propriétaire).

---

## 8. Ce qui n'a PAS été fait, et ce qui reste

- **Aucune étiquette**, **aucune release**, **aucun push** : la consigne demande de préparer la
  publication sans la diffuser, et de rendre la main sur ce point.
- **Image du serveur GDS non reconstruite**, conteneur non rechargé (hors périmètre).
- **Aucun secret lu, écrit ni modifié** ; **aucune configuration de publication modifiée**.

Pour publier, le propriétaire (ou une mission suivante sur accord explicite) doit :

```bash
cd G:\IA_PL\pilot
git push origin main
git tag -a v0.6.4 -m "Pilot v0.6.4"
git push origin v0.6.4
```

La CI prend ensuite le relais : tests (3 OS) → fabrication signée → GitHub Release → `latest.json`
→ mise à jour automatique chez les utilisateurs installés.

### À vérifier à la main par le propriétaire

1. **Avant de taguer** : que le travail non commité de l'autre mission (`src/js/super-agent.js`,
   `src/js/vocal-conversation.js`, les deux specs et le handbook) est bien dans l'état attendu.
2. **Le texte du changelog** (`release-notes/v0.6.4.md`) : c'est lui que verront les utilisateurs dans
   la modale de mise à jour.
3. **Le tag ne se répare pas** : une fois `v0.6.4` poussé, la version est figée.
4. **Après le tag** : que la CI a bien produit les installateurs Windows et macOS et que `latest.json`
   contient `0.6.4`.

## 9. Points de repère Git après la préparation

| Élément | Valeur |
|---|---|
| Branche | `main` |
| Commit de publication | **`160611f`** — `chore: bump version to 0.6.4` (5 fichiers, +40 / −4) |
| Parent | `a3f612d` (dernier correctif) |
| Dernière étiquette | **`v0.6.3`** — **aucune étiquette `v0.6.4` créée** |
| `origin/main` | `6fd00df`, soit **4 commits de retard, 0 d'avance** ⇒ avance rapide possible, aucun écrasement |
| Push | **aucun** |
| Release GitHub | **aucune** |
| Worktree après coup | seuls les **7 fichiers de l'autre mission** restent modifiés (intacts) + les fichiers **non suivis** préexistants |

## 10. Addendum — vérifications finales

- `git show --stat 160611f` : **5 fichiers**, aucun fichier d'une autre mission, aucun rapport.
- `git tag --sort=-v:refname | head -1` → `v0.6.3` : **aucun tag n'a été posé**.
- `git rev-list --count origin/main..HEAD` → `4` : **rien n'a été poussé**.
- `md5sum -c` sur les 7 fichiers de l'autre mission → **7/7 OK** (même empreinte qu'avant les
  travaux, y compris après le build qui régénère la documentation embarquée).
