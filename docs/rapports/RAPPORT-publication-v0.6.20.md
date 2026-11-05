# Rapport — publication de la version 0.6.20

Date : 2026-11-15 · Projet : `G:\IA_PL\pilot` · Rôle : publieur
Demande explicite du propriétaire : publier la version **0.6.20** (correction
« le volet Travail ne montre que le travail des agents »).

---

## 1. Ce qui est publié

| Élément | Valeur |
|---|---|
| Version | **0.6.20** (précédente publiée : 0.6.19) |
| Correction publiée | commit `f970037` — 8 fichiers |
| Commit de publication (bump + changelog) | **`edb47d7949deeb28362c332d833a5c2f4e954aeb`** |
| Étiquette | **`v0.6.20`** → `edb47d7949deeb28362c332d833a5c2f4e954aeb` |
| Branche | `main` |
| Changelog utilisateur | `release-notes/v0.6.20.md` |

Contenu du commit de publication (5 fichiers, +42 −4) :

- `package.json` — `0.6.19` → `0.6.20`
- `src-tauri/tauri.conf.json` — `0.6.19` → `0.6.20`
- `src-tauri/Cargo.toml` — `0.6.19` → `0.6.20`
- `Cargo.lock` (RACINE du dépôt) — `version` du **package `pilot`** uniquement
- `release-notes/v0.6.20.md` — nouveau

**Garde `Cargo.lock` respectée** : aucun `sed` global, ciblage du bloc
`name = "pilot"` par script Python. Vérifié après coup :
`grep 'version = "0.6.20"' Cargo.lock` → **1 seule occurrence** (ligne 3335, sous
`name = "pilot"` ligne 3334) ; `grep '0.6.19' Cargo.lock` → **0 occurrence**.

Numérotation : correctif → dernier chiffre incrémenté, aucune marche arrière.
Les étiquettes orphelines `v0.6.16`, `v0.6.17`, `v0.6.18` n'ont **pas** été
touchées. `v0.6.20` n'existait ni en local ni sur le déport avant création
(`git ls-remote --tags origin` : `v0.6.19` présent, `v0.6.20` absent).

---

## 2. Résultat exact des contrôles (tous lancés AVANT commit)

| Contrôle | Commande | Résultat | Sortie brute |
|---|---|---|---|
| Tests front | `npx vitest run` | **exit 0** | `PASS (5614) FAIL (0)` |
| Tests Rust desktop | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **exit 0** | `cargo test: 902 passed, 3 ignored (1 suite, 10.31s)` |
| Image serveur GDS | `npm run gds:image` | **exit 0** | `pilot-gds:local reconstruite` — conteneur **NON touché**, service intact, volumes intacts |

Journal complet de chaque commande conservé sous
`.pilot/tmp-pub/vitest-0.6.20.log`, `.pilot/tmp-pub/cargo-test-0.6.20.log`,
`.pilot/tmp-pub/gds-image-0.6.20.log`.

Aucun test rouge : la publication n'a donc pas été arrêtée.

Reconstruction GDS : mode **image seule** (`precheck → build → report`), durée
4,4 s. Le conteneur du propriétaire continue de tourner ; son **rechargement**
(`npm run gds:reload`) reste sa décision et n'a **pas** été déclenché ici.

---

## 3. Vérification du dépôt distant (preuve, pas déclaration)

```
git ls-remote origin refs/heads/main
edb47d7949deeb28362c332d833a5c2f4e954aeb   refs/heads/main

git ls-remote origin refs/tags/v0.6.20
edb47d7949deeb28362c332d833a5c2f4e954aeb   refs/tags/v0.6.20
```

`main` et l'étiquette `v0.6.20` sont **bien sur GitHub**, au même commit.

Dépôt local : arbre propre avant bump, `git push origin main` puis
`git push origin v0.6.20` acceptés. Aucune commande destructive exécutée
(pas de `reset`, pas de `checkout` écrasant, pas de `force push`), aucune
donnée ni sauvegarde supprimée.

---

## 4. GDS — vérification bloquante

`.pilot/gds.json` → `"enabled": false`. Le projet n'est **pas** basculé sur le
GDS : la publication GitHub est donc autorisée. Un déport nommé `gds` existe et
pointe vers un dossier local de test
(`src-tauri/laya.__probe2__/pilot-gds-absent-10988`) — résidu de sonde, jamais
utilisé ici ; aucun envoi vers lui.

---

## 5. Fichiers de la release (déposés — vérifiés par l'API)

Le workflow `.github/workflows/release.yml` a été déclenché par le tag
(`run` id `42025121233`, branche `v0.6.20`). **Release publiée** :
`Pilot v0.6.20`, `draft=false`, `prerelease=false`, publiée le 2026-11-05 à
12:19:14Z. **11 fichiers déposés** :

| Fichier | Taille |
|---|---|
| `latest.json` | manifeste |
| `Pilot_0.6.20_x64-setup.exe` | 62,0 Mo |
| `Pilot_0.6.20_x64-setup.exe.sig` | signature |
| `Pilot_0.6.20_x64_en-US.msi` | 80,8 Mo |
| `Pilot_0.6.20_x64_en-US.msi.sig` | signature |
| `Pilot_0.6.20_x64.dmg` | 37,6 Mo |
| `Pilot_0.6.20_aarch64.dmg` | 99,0 Mo |
| `Pilot_x64.app.tar.gz` | 37,9 Mo |
| `Pilot_x64.app.tar.gz.sig` | signature |
| `Pilot_aarch64.app.tar.gz` | 101,4 Mo |
| `Pilot_aarch64.app.tar.gz.sig` | signature |

**macOS a été compilé cette fois** (contrairement à 0.6.19, qui n'avait que
Windows) : une machine Apple a bien été attribuée aux deux cibles.

Jobs du run `release` : `test (ubuntu-22.04)` ✅, `test (windows-latest)` ✅,
`test-macos` ✅, `create-release` ✅, `build` Windows ✅, `build` macOS x86_64 ✅,
`build` macOS aarch64 ✅. `build-linux` (hors chemin critique) et
`latest-json-linux` (seconde passe optionnelle) ne bloquent rien.

**`latest.json` contrôlé** — `version : 0.6.20`, trois cibles, toutes signées :

| Cible | Fichier servi |
|---|---|
| `windows-x86_64` | `Pilot_0.6.20_x64-setup.exe` (NSIS retenu, MSI écarté — règle du projet) |
| `darwin-aarch64` | `Pilot_aarch64.app.tar.gz` |
| `darwin-x86_64` | `Pilot_x64.app.tar.gz` |

Les notes de mise à jour reprennent bien le texte de `release-notes/v0.6.20.md`
(le propriétaire lira dans la modale « Modification depuis v0.6.19 » puis le
contenu de la version). Aucune cible macOS n'a été inventée, et aucune n'a
besoin de l'être : les deux sont réellement présentes ici.

---

## 6. Ce que le propriétaire doit vérifier à la main

1. **La page de la release** `v0.6.20` sur GitHub : le titre, le texte
   (repris de `release-notes/v0.6.20.md`) et la liste des 11 fichiers ci-dessus.
   Ces éléments ont été relus par l'API, mais une relecture humaine de la page
   reste la dernière vérification.
2. **La fin du workflow `release`** : les jobs du chemin critique (`test`,
   `create-release`, `build` Windows + macOS, `latest-json`) sont verts. Seul
   `build-linux` peut encore tourner ou échouer sans conséquence.
3. **L'installation réelle** : lancer la mise à jour depuis un poste installé en
   0.6.19 et vérifier que la version affichée devient **0.6.20**. C'est la seule
   preuve que la chaîne de mise à jour est vivante de bout en bout.
4. **Le conteneur GDS** : l'image `pilot-gds:local` est reconstruite mais
   **pas chargée**. Si vous voulez que le service tourne sur cette image, c'est
   `npm run gds:reload` — décision qui vous appartient, non prise ici.
5. **À l'usage**, dans Pilot 0.6.20 : ouvrir le panneau « Travail », volet
   « Tâches » (en mode Détaillé **et** en mode Vocal). Il ne doit plus contenir de
   groupe « Suivi (n) » ; sans mission, il affiche « Aucune mission en cours. ».
   L'onglet du suivi (Kanban) doit, lui, montrer toutes vos tâches comme avant.

---

## 7. Ce qui n'a pas été fait, volontairement

- Aucune ligne de la correction `f970037` n'a été touchée : la mission ne fait que
  publier.
- Aucun test modifié.
- Le workflow de publication n'a été ni relancé ni modifié.
- Aucun outil listant les sessions d'agents n'a été appelé.
- Aucun réglage d'un autre projet, aucun moteur vidéo touché.

<!-- RAPPORT:publication-v0.6.20 -->

---

## 8. Deux remarques d'honnêteté

- **La phrase sur les installateurs macOS est conditionnelle et reste vraie.**
  Le changelog a été rédigé avant de savoir qu'une machine Apple serait
  attribuée ; il dit « *si* cette page ne les propose pas encore ». Les deux
  fichiers macOS **sont bien sur la page**, donc la réserve ne s'applique pas.
  Le texte publié n'a **pas** été retouché après coup : le modifier aurait fait
  diverger le contenu de l'étiquette `v0.6.20` de ce que la page affiche.
- **Le run `release` apparaît encore « in_progress »** au moment de clore, parce
  que `build-linux` et `latest-json-linux` tournent encore. Ces deux jobs sont
  **hors du chemin critique** : la Release, ses 11 fichiers et `latest.json`
  étaient déjà tous en place et vérifiés avant cette clôture.

## 9. Preuves conservées sur disque

`.pilot/tmp-pub/` : `vitest-0.6.20.log`, `cargo-test-0.6.20.log`,
`gds-image-0.6.20.log`, `runs.json`, `runs2.json`, `jobs.json`, `rel620.json`,
`latest.json` (copie du manifeste servi).
