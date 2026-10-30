# Rapport — rangement des rapports restés à la racine

Mission : terminer la mise en ordre documentaire du dépôt en sortant de la
racine les rapports de mission (`RAPPORT-*.md`) et les documents de conception
(`CONCEPTION-*.md`) qui y restaient, sans rien perdre, sans renommer, sans
supprimer, et en gardant l'historique Git.

Date du rangement : **2026-10-30** (date système du poste). Les rapports
déplacés portent leurs propres dates de rédaction.
Mission **purement documentaire** : aucune version bumpée, aucune publication,
aucun push, aucun tag, aucun code applicatif touché (`src/`, `src-tauri/`
intacts), `AGENTS.md` non modifié.

Précédent : `docs/rapports/RAPPORT-rangement-docs.md` (2026-10-28) avait déjà
sorti 168 fichiers. Ce rapport ne traite que ce qui est **apparu depuis**.

---

## 1. Comptage fait sur le disque (pas recopié de la demande)

`ls -1 RAPPORT-*.md CONCEPTION-*.md` à la racine, avant déplacement :
**3 fichiers `RAPPORT-*.md`**, **0 fichier `CONCEPTION-*.md`**.

Le nombre annoncé dans la demande (« deux rapports ») était donc incomplet :
constat sur disque, il en restait **trois**.

| Fichier racine | Taille | Lignes | Suivi par Git |
|---|---|---|---|
| `RAPPORT-MODE-VOCAL.md` | 14 028 o | 234 | oui |
| `RAPPORT-vocal-corrections-2.md` | 14 816 o | 235 | oui |
| `RAPPORT-vocal-discussion-gauche.md` | 11 341 o | 223 | oui |

Aucun `CONCEPTION-*.md` à déplacer : `docs/conceptions/` était déjà complet.

---

## 2. Déplacements effectués (`git mv`, historique conservé)

Destination contrôlée **avant** chaque déplacement (aucun écrasement) : les
trois noms étaient **libres** dans `docs/rapports/` — ni en casse exacte, ni en
casse insensible (`ls docs/rapports/` inspecté). **Aucune collision, donc aucun
fichier à conserver en double.**

| De (racine) | Vers | Outil |
|---|---|---|
| `RAPPORT-MODE-VOCAL.md` | `docs/rapports/RAPPORT-MODE-VOCAL.md` | `git mv` |
| `RAPPORT-vocal-corrections-2.md` | `docs/rapports/RAPPORT-vocal-corrections-2.md` | `git mv` |
| `RAPPORT-vocal-discussion-gauche.md` | `docs/rapports/RAPPORT-vocal-discussion-gauche.md` | `git mv` |

`git status --porcelain` après opération : **trois lignes `R`** (renommage),
**aucune ligne `D` ni `A`** — ni suppression, ni réécriture.

### Contenu prouvé inchangé

Le contenu n'a pas été réécrit : l'empreinte du blob est identique avant et
après, pour chacun des trois fichiers.

| Fichier | Blob `HEAD:racine` | Blob sur disque (après) | Verdict |
|---|---|---|---|
| `RAPPORT-MODE-VOCAL.md` | `8055465c…` | `8055465c…` | identique |
| `RAPPORT-vocal-corrections-2.md` | `c656e811…` | `c656e811…` | identique |
| `RAPPORT-vocal-discussion-gauche.md` | `52856e4b…` | `52856e4b…` | identique |

---

## 3. Liens et références — vérification

Recherche faite sur tout le dépôt (hors `node_modules`, `.git`, `target`,
`.pilot`) :

- **Liens Markdown relatifs** (`](…RAPPORT-…md)`) vers ces trois fichiers :
  **aucun**. Les trois rapports ne contiennent eux-mêmes **aucun** lien
  (`grep -nE '\]\([^)]*\)'` : 0 résultat) : le déplacement d'un cran plus
  profond ne peut donc casser aucun chemin interne.
- **Références textuelles** (noms cités sans chemin, entre accents graves ou
  en clair) — inchangées et toujours justes, puisqu'aucun fichier n'a été
  renommé :
  - `AGENTS.md` (l. 226 et 229) — **non modifié** (règle du projet) ;
  - `docs/rapports/RAPPORT-preparation-release-0.6.5.md` (l. 49) ;
  - `docs/rapports/RAPPORT-cadres-arrondis-panneaux.md` (l. 310 et 330).
- **Référence déjà au bon chemin** : `spec_modes_ecran_vocal.md` (l. 1457)
  cite `docs/rapports/RAPPORT-MODE-VOCAL.md`. Ce chemin était **cassé avant**
  le déplacement (le fichier vivait à la racine) et devient **correct** grâce à
  lui. Aucune retouche nécessaire.
- **Scripts de build de documentation** (`scripts/build-handbook.js`,
  `help/overview.md`, `.github/`) : **aucune** mention de `docs/rapports`,
  `docs/conceptions` ni d'un nom `RAPPORT-*`. `help/handbook.md` (généré) n'a
  pas été touché.
- **Tests** : aucun test ne lit ces trois fichiers (recherche par nom dans
  `src/` et `scripts/`) — cohérent avec la suite verte ci-dessous.

**Aucune correction de lien n'a donc été nécessaire.**

---

## 4. Vérification anti-régression

| Commande | Résultat exact | Verdict |
|---|---|---|
| `ls -1 RAPPORT-*.md CONCEPTION-*.md` (racine, après) | aucun fichier | ✅ |
| `git diff --cached -M --stat` | 3 renommages, contenu 100 % | ✅ |
| `npx vitest run` (suite front complète) | **266 fichiers / 4958 tests passés, 0 échec** (`Test Files 266 passed`, `Tests 4958 passed`) | ✅ vert |

Aucun test n'a rougi : rien à corriger.

---

## 5. Hors périmètre — signalé, non traité

À la racine restent **22 fichiers `rapport-*.md` en minuscules** (convention
antérieure à la règle actuelle : `rapport-380bis-verif.md`,
`rapport-delai-inactivite.md`, `rapport-p1-ordre-arrivee.md`,
`rapport-publication-0.4.36.md`, `rapport-relecture-finale.md`, etc.), tous
suivis par Git.

Ils ne respectent pas le motif exact demandé (`RAPPORT-*.md`) et plusieurs sont
cités **dans du code et des tests** (`src/js/project-key.js`,
`src/js/super-agent.js`, `src/js/help-delai-inactivite.test.js`,
`spec_gestion_agents.md`, `spec_super_agent.md`, `fiche-reference-pilot.md`).
Les déplacer est une opération distincte, plus large, qui demande de mettre à
jour ces références : **elle n'a pas été faite ici** pour ne pas dépasser
l'objectif de la mission. Décision à prendre séparément (les déplacer tels
quels, ou les renommer en `RAPPORT-*` — ce qui toucherait aux références).

Également hors périmètre : les fichiers de travail/propositions encore à la
racine et non suivis (`vocal.md`, `vocal-defauts-visuels.md`,
`VERIF-*.md`, `PLAN-mode-reseau-multipostes.md`…), laissés en place.
