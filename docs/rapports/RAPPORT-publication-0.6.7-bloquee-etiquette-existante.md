# Rapport de publication — Pilot v0.6.7 : NON PUBLIÉE (étiquette déjà existante)

> Statut : **NON PUBLIÉE — aucune action de publication effectuée.**
> Date : session courante
> Rédigé par : agent publieur
> Motif : `v0.6.7` **existe déjà sur `origin`** et une **Release GitHub v0.6.7
> est déjà publiée**. Republier ou déplacer cette étiquette est interdit.
>
> Ce rapport est **distinct** de `docs/rapports/RAPPORT-publication-0.6.7.md`
> (preuve de la publication réelle du 2026-11-02), qui a été **lu, non modifié
> et non écrasé**.

---

## 1. État réel du dépôt à l'ouverture

| Élément | Valeur |
|---|---|
| Branche | `main` |
| `HEAD` | `9e1b7ef6b43dc65f657725f59d175e0b2c58a35f` — « fix(agents): une question d'agent trouve toujours une surface ou se termine » |
| Arbre de travail | **propre** — `git diff --stat` vide, `git diff --cached --stat` vide |
| Remote de publication | `origin` → `https://github.com/pleveneur/pilot.git` |
| Version dans `package.json` | `0.6.7` |
| Version dans `src-tauri/tauri.conf.json` | `0.6.7` |
| Version dans `src-tauri/Cargo.toml` | `0.6.7` |
| `Cargo.lock` (package `pilot`) | `0.6.7` (une seule occurrence, correcte) |

### Le GDS est-il basculé ? — NON

`.pilot/gds.json` : `"enabled": false`. La règle GDS ne bloque donc pas.
Un remote local `gds` subsiste (reliquat de test :
`src-tauri/laya.__probe2__/pilot-gds-absent-10988`) : **il n'a pas été utilisé**.

---

## 2. Le blocage : `v0.6.7` est déjà publiée

### 2.1 L'étiquette existe en local **et** sur `origin`

```
git rev-list -n1 v0.6.7        → 490ccfffd671b6ea7937a9de419ef6d93c719799
git log --oneline -1 v0.6.7    → 490ccff chore: bump version to 0.6.7
git ls-remote --tags origin
  137fd75f1bf07e97b4a46cbb596651d8d8d62421  refs/tags/v0.6.7        (objet d'étiquette)
  490ccfffd671b6ea7937a9de419ef6d93c719799  refs/tags/v0.6.7^{}     (commit étiqueté)
```

`v0.6.7` est un **ancêtre** de `HEAD` (`git merge-base --is-ancestor` → vrai).

### 2.2 La Release GitHub existe aussi, avec ses installateurs

`GET https://api.github.com/repos/pleveneur/pilot/releases/tags/v0.6.7`

| Élément | Valeur |
|---|---|
| `name` | « Pilot v0.6.7 » |
| `published_at` | `2026-11-02T08:03:06Z` |
| `draft` / `prerelease` | `false` / `false` |
| `html_url` | https://github.com/pleveneur/pilot/releases/tag/v0.6.7 |
| Assets | **11** |

Assets réellement présents :

- `latest.json`
- `Pilot_0.6.7_x64-setup.exe` + `.sig`
- `Pilot_0.6.7_x64_en-US.msi` + `.sig`
- `Pilot_0.6.7_x64.dmg`
- `Pilot_0.6.7_aarch64.dmg`
- `Pilot_x64.app.tar.gz` + `.sig`
- `Pilot_aarch64.app.tar.gz` + `.sig`

### 2.3 La mise à jour automatique annonce déjà 0.6.7

`latest.json` publié (`releases/latest/download/latest.json`) :

- `"version": "0.6.7"`
- `pub_date` : `2026-11-02T08:26:13.085Z`
- plateformes servies : **`windows-x86_64`**, **`darwin-aarch64`**, **`darwin-x86_64`**

Aucune cible Linux — défaut connu et toléré, sans action.

### 2.4 Conséquence : les trois correctifs ne sont PAS dans la version publiée

`git rev-list --count v0.6.7..HEAD` → **5 commits**. L'étiquette est **5 commits
en arrière** de `HEAD` :

| Commit | Sujet |
|---|---|
| `9e1b7ef` | fix(agents): une question d'agent trouve toujours une surface ou se termine |
| `551c944` | fix(perf): la boucle du suivi et les commandes agent ne bloquent plus l'ui |
| `d1f57bf` | docs: consigner la reprise apres plantage |
| `c42081a` | fix(agents,vocal): la reponse n'est pas un fichier, le bas du mode Vocal nait efface |
| `35a04fc` | fix(garde-fou): la cible d'ecriture doit etre la sortie de l'ordre |

La version **déjà publiée** sous le numéro 0.6.7 contient `490ccff` et **rien
après**. Les correctifs annoncés dans la mission (gel de Pilot, questions
d'agent sans surface, refus à tort d'un agent en lecture seule) sont donc
absents du paquet que les utilisateurs ont reçu.

Le changelog de `release-notes/v0.6.7.md` (déjà publié, déjà repris dans les
`notes` de la Release et de `latest.json`) ne mentionne pas ces trois
correctifs — cohérent avec les commits qu'il couvre.

---

## 3. Contrôles : pourquoi ils n'ont pas été lancés

La séquence prévue place les contrôles **avant** la publication, mais la
condition d'arrêt absolue — « ne jamais republier, recréer ou déplacer une
étiquette existante » — est remplie **pendant l'étape 1** (relecture de l'état
du dépôt), c'est-à-dire **avant** l'étape 4.

| Contrôle | Résultat de cette session |
|---|---|
| Contrôles préalables (état, statut, versions, étiquette) | **LUS et exploités** — cf. § 1 et § 2 |
| `npm test` | **non exécuté** — arrêt sur étiquette existante |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **non exécuté** — arrêt sur étiquette existante |
| `npm run tauri build` | **non exécuté** — arrêt sur étiquette existante |

Aucun test n'a été assoupli, supprimé ni contourné ; aucune version n'a été
forcée. Les chiffres des contrôles **de la version 0.6.7 réellement publiée**
sont consignés dans `docs/rapports/RAPPORT-publication-0.6.7.md` § 9
(5051 tests frontend verts, 819 + 992 tests Rust verts).

Aucune commande d'écriture n'a été faite : ni commit, ni bump, ni
`git push`, ni `git tag`.

---

## 4. Ce que le propriétaire doit décider

Le numéro **0.6.7 est consommé**. La règle du projet (correctifs = dernier
chiffre, jamais de recul) impose donc **0.6.8** pour livrer ces correctifs —
cette décision vous appartient, elle exige un accord explicite avant que je
commence.

Si vous donnez cet accord, la préparation sera :

1. `release-notes/v0.6.8.md` en français, orienté utilisateur, avec les trois
   entrées proposées :
   - Pilot ne se fige plus quand on sollicite un agent (l'écran reste utilisable
     pendant qu'un agent travaille) ;
   - une question posée par un agent s'affiche toujours, et si elle ne peut pas
     s'afficher, l'attente s'arrête avec un message clair au lieu de bloquer ;
   - un agent en lecture seule n'est plus refusé à tort.
2. Bump **cohérent** de `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml` et de la seule ligne `version` du package `pilot`
   dans `Cargo.lock` (racine du dépôt) — **jamais** par `sed` global.
3. Contrôles complets **avant** toute publication : `npm test` et `cargo test
   --manifest-path src-tauri/Cargo.toml --lib`. Un test rouge arrête tout, je
   rends compte et je ne publie pas.
4. Ensuite seulement : étiquette `v0.6.8`, Release, suivi de `latest.json`.

## 5. À vérifier vous-même à la main

1. **Que `v0.6.7` ne doit pas être déplacée** : la Release publiée le
   2026-11-02 sert déjà les installés ; revenir dessus casserait la chaîne de
   mise à jour.
2. **Que des utilisateurs ont déjà installé 0.6.7** (sans les trois correctifs) :
   la 0.6.8 leur sera proposée automatiquement au prochain démarrage.
3. Ouvrir https://github.com/pleveneur/pilot/releases/tag/v0.6.7 et constater
   les 11 fichiers listés au § 2.2.
4. Décider du numéro et du moment : rien n'a été poussé, rien n'a été étiqueté
   pendant cette session.

---

## VERDICT : non publiée (l'étiquette `v0.6.7` et sa Release existent déjà sur origin ; les trois correctifs attendus sont 5 commits après cette étiquette, ils exigent une nouvelle version — 0.6.8 — sur votre décision)
