# Rapport — vérification technique indépendante avant l'essai à la main

> Vérificateur **externe** (n'a écrit aucune ligne de ce code). Aucun fichier de code
> modifié, aucun test réécrit, aucun commit, aucun tag, aucun envoi vers un dépôt
> distant, aucune application lancée, aucun outil de listage de sessions d'agents appelé.
> Le **seul** fichier écrit est ce rapport (plus un journal de construction ignoré par git).
> Date : **2026-10-28**, de 10:00 à 10:09 (heure locale).

---

## 1. Les trois vérifications, avec les chiffres recomptés

### 1.1 Batterie de tests du front — `npm test` (Vitest 2.1.9)

```
Test Files  203 passed (203)
     Tests  3678 passed (3678)      — 0 échec, 0 test ignoré
  Duration  11.55 s
```

- Recommandé par moi : `197` fichiers dans `src/js/` + `6` dans `scripts/` = **203** ✔
  (le dépôt contient 272 `*.test.js` au total, mais 69 vivent dans `.pilot/_goldtmp`
  et `.pilot/tmp-pub`, copies de travail **ignorées par git** que Vitest ne collecte pas).
- Du bruit sur la sortie standard/erreur (`window is not defined` dans `code-graph.test.js`,
  `getCurrentWindow` dans `agent-activity-assistant-tab.test.js`) : ce sont des
  avertissements **attendus** de code qui parle à Tauri, aucun test ne tombe.

### 1.2 Batterie de tests Rust de l'espace de travail entier — `cargo test --workspace`

```
cargo test: 965 passed, 12 ignored (6 suites)        — 0 échec
```

Décompte refait par crate (trois exécutions séparées, la somme doit tomber juste) :

| Crate | Résultat |
|---|---|
| `gds-core` | `139 passed, 11 ignored` (2 suites) |
| `gds-server` | `34 passed` (1 suite) |
| desktop `pilot` (`src-tauri`) | `792 passed, 1 ignored` (3 suites : lib, main, doc-tests) |
| **Somme** | **965 passés / 12 ignorés** — identique au run global ✔ |

Avertissements (antérieurs, sans effet) : `pilot (lib) generated 23 warnings` (imports et
constantes jamais utilisés) et `sqlx-postgres v0.8.0` signalé comme rejeté par une future
version de Rust.

### 1.3 Construction de l'application

Méthode du projet, options en ligne de commande (aucun fichier modifié, aucun secret lu) :

```bash
./node_modules/.bin/tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

| Étape | Résultat |
|---|---|
| `beforeBuildCommand` (`build:mcp`, `build:handbook`, `prepare:laya`, `vite build`) | OK — MCP 685,1 Ko / **0 erreur**, Laya 11 entrées / 113,7 Mo, Vite `✓ built in 12.71 s` |
| Profil release Rust | `Finished release profile [optimized] target(s) in 1m 54s` |
| Bundles | `Finished 2 bundles` |
| Durée totale | **3 min 33 s** (10:04:24 → 10:07:57) |
| Lignes `error` / `failed to compile` / `panicked` dans le journal | **0** |

Artefacts produits (tailles exactes relevées par moi) :

| Fichier | Octets | Écrit à |
|---|---|---|
| `target/release/bundle/nsis/Pilot_0.6.2_x64-setup.exe` | 63 707 970 | 10:07:57 |
| `target/release/bundle/msi/Pilot_0.6.2_x64_en-US.msi` | 82 952 192 | 10:06:55 |
| `target/release/pilot.exe` | 46 407 680 | 10:07:57 |

- **Pas de `.sig`, pas de `latest.json`** : `createUpdaterArtifacts` est désactivé en ligne
  de commande (la clé de signature n'est pas sur cette machine). C'est un build
  **d'installateur local pour l'essai**, pas un build publiable — normal et sans incidence ici.
- Version **0.6.2 partout** (recompté) : `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, `Cargo.lock` (package `pilot` uniquement — le piège du `sed`
  global n'a pas été déclenché : une seule occurrence `version = "0.6.2"` pour `pilot`).
- Avertissements Vite : **19** « dynamically imported by … but also statically imported »
  + **1** « chunks larger than 500 kB » → préexistants, outillage seulement.

### 1.4 Effet de bord du build sur les fichiers suivis : **aucun**

`git status --porcelain` après construction : **aucun fichier suivi modifié**, aucun index
modifié. Empreintes identiques avant/après :

- `help/handbook.md` : `14eaa8388f8c9e7a3158987d1fd16095` (avant = après) → la
  documentation embarquée était **déjà** à jour, `build:handbook` la reproduit à l'octet près ;
- `src-tauri/extensions/pilot-mcp-client.ts` : `29a1bdf88517f4d1e35a26caf40a1b12` (avant = après).

---

## 2. Journal des modifications récentes — ce que j'ai vérifié

Sept enregistrements locaux couvrent les six chantiers (le dernier chantier en occupe deux),
tous **sur `main`, non poussés** (`origin/main` est 7 commits en arrière, `HEAD` n'est pas taggé) :

| Commit | Chantier |
|---|---|
| `523c7df` | Assistant seul remanié (+ `spec_super_agent.md`, `RAPPORT-mode-assistant-seul-3-retouches.md`) |
| `8a8e99c` | Menu du bas renommé « Action » + filet bleu (`var(--accent)`) |
| `9a8c2cf` | Correction de l'état de l'écran Vocal |
| `ccc5422` | Écran Vocal rendu nu |
| `903708b` | Coupure de la réflexion quand le propriétaire parle |
| `535ceb1` + `a55a2b2` | Logo Pilot = bouton unique des trois modes (lots 1-3, puis tests + docs 4-5) |

Contrôles faits sur `c1217c9..HEAD` (aucun fichier de code lu « de confiance ») :

- **Fichiers de production touchés = exactement les cinq attendus** : `index.html`,
  `src/css/style.css`, `src/js/screen-mode.js`, `src/js/super-agent.js`, `src/js/vocal-mic.js`.
  Aucun autre fichier de production n'a été ouvert « au passage ».
- **Aucune trace de travail en cours laissée dans le code** : pas un seul `console.log`,
  `debugger`, `TODO`, `FIXME`, `TEMP` ajouté.
- **Aucun test affaibli** : pas un seul `.skip`, `.only`, `.todo`, `xit` ajouté dans tout le
  dépôt. Les adaptations de tests de `a55a2b2` remplacent des vérifications sur
  `#screen-mode-button` par des vérifications sur `#mode-logo` **et ajoutent des assertions
  négatives** (« l'ancien nœud est revenu », « la pastille est revenue »). Le filet est plus
  serré, pas moins.
- **Tous les fichiers attendus sont présents** (21 vérifiés nominativement) : `screen-mode.js`,
  `vocal-mic.js` et les 8 verrous `trois-modes-ecran`, `ecran-vocal-lot2/lot3/lot4a`,
  `ecran-vocal-nu`, `logo-bouton-trois-modes`, `vocal-couper-la-reflexion`,
  `barre-fenetre-assistant-seul`, `lot3-colonne-bas`, `repli-menus-bas` ; les 5 rapports de
  mission, le document de conception et les deux specs.
- **Aucun rapport annoncé n'est absent** : toutes les références `RAPPORT-*.md`,
  `CONCEPTION-*.md` et `docs/*.md` citées par `spec_pilot.md`, `spec_modes_ecran_vocal.md`,
  `spec_super_agent.md`, `spec_help.md`, `AGENTS.md` et `README.md` existent (contrôle
  automatique des 6 fichiers → 0 manquant).
- Tests des chantiers relancés **fichier par fichier** (tous verts) : `logo-bouton-trois-modes`
  27, `trois-modes-ecran` 23, `ecran-vocal-nu` 15, `vocal-couper-la-reflexion` 21,
  `ecran-vocal-lot3` 37, `lot3-colonne-bas` 21, `repli-menus-bas` 62,
  `barre-fenetre-assistant-seul` 12 → **218 tests** ciblés.

---

## 3. Ce qui me paraît douteux (signalé, rien corrigé)

### 3.1 ❗ Documentation vivante non alignée sur le logo-bouton (le seul vrai défaut)

`535ceb1` a changé le bouton des trois modes **sans mettre à jour trois documents vivants**
(seul `help/overview.md`, `spec_pilot.md` et `spec_help.md` ont suivi) :

| Fichier | Ce qui est encore écrit, et qui est faux depuis `535ceb1` |
|---|---|
| `spec_modes_ecran_vocal.md` § 2 (l. 34-45) | « `#screen-mode-button`, dans la rangée d'onglets (`#tab-row`) », « le **libellé** est le mode courant… et une **pastille** reprend la teinte du mode courant » |
| `spec_modes_ecran_vocal.md` l. 61, 95, 268, 278 | « le même bouton de mode (il affiche « Vocal »… », « seuls la barre de saisie et le bouton des modes le sont », « le bouton des modes, la barre de saisie » |
| `spec_modes_ecran_vocal.md` l. 99 | la barre de 44 px décrite comme portant le bouton (elle est désormais **vide**, ce que le code et `ecran-vocal-lot2.test.js` affirment) |
| `README.md` l. 108-113 | « Un **seul bouton**, à gauche de la rangée d'onglets … Son libellé et sa pastille montrent le mode courant » |
| `AGENTS.md` l. 201 (`screen-mode.js`) | « cycle, libellé du mode COURANT, infobulle du mode SUIVANT, **pastille** » |
| `AGENTS.md` l. 202 (`super-agent.js`) | « barre de 44 px **avec le bouton de mode** » |

Le code, lui, est cohérent : le nœud est `#mode-logo`, il n'a **ni mot ni pastille**, et la
barre de 44 px ne reçoit plus rien (vérifié par les tests, pas par la doc).

**Conséquence pratique pour l'essai à la main** : aucun effet sur le comportement. Mais un
lecteur du README ou de `spec_modes_ecran_vocal.md` cherchera un bouton étiqueté dans la
rangée d'onglets, et consultera un état qui n'existe plus. `help/handbook.md` (l'aide dans
l'application) est, lui, **à jour** — c'est ce que verra l'utilisateur.

### 3.2 ❗ Un rapport de la série n'a pas été enregistré, et un rapport l'affirme à tort

- `RAPPORT-diagnostic-etat-ecran-vocal.md` (écrit le 2026-10-28 à **08:45**, donc **entre**
  `523c7df` et `8a8e99c`) est **resté non suivi**. Son rapport de correction
  (`RAPPORT-correction-etat-ecran-vocal.md`) a bien été enregistré dans `9a8c2cf`. Le couple
  diagnostic → correction est donc à moitié dans l'historique : celui qui relira le commit
  `9a8c2cf` ne verra pas le diagnostic qui l'a motivé.
- `RAPPORT-logo-lots-4-5.md` § 7 conclut « la documentation et l'aide intégrée disent la même
  chose que le code ». **C'est vrai pour l'aide intégrée, faux pour `README.md` et
  `spec_modes_ecran_vocal.md`** (§ 3.1). L'affirmation n'a pas été vérifiée avant d'être écrite.

### 3.3 🟡 Hygiène d'enregistrement (sans gravité)

- `a55a2b2` est étiqueté `test(screen-modes): …` alors qu'il modifie **trois documents de
  référence** (`spec_pilot.md`, `spec_help.md`, `help/overview.md`) en plus des tests. Le
  contenu est légitime (règle « doc à jour »), l'étiquette est incomplète.
- Convention instable sur les rapports : **101** `RAPPORT-*.md` sont suivis, **52** restent
  non suivis à la racine. Deux règles coexistent, ce n'est pas nouveau, mais cela rend le
  contenu de l'historique imprévisible.

### 3.4 🟡 Résidus anciens, antérieurs à cette série (rien à voir avec elle)

- `git remote gds` pointe sur `G:\IA_PL\pilot\src-tauri\laya.__probe2__\pilot-gds-absent-10988`
  — un **chemin temporaire de sonde qui n'existe plus**. Configuration locale datée du
  2026-09-28, sans effet (aucun `push` ne l'utilise), mais c'est du mort qui traîne.
- Zones de travail d'agents, **toutes ignorées par git** : `.pilot/bak-super.js` (359 Ko),
  `.pilot/bak-questions.js`, `.pilot/bak-telegram.rs`, `.pilot/_goldtmp` (3,1 Mo, 2026-09-28),
  `.pilot/tmp-pub` (2,3 Mo), `.pilot/log-*.txt`, `laya-inc*.mjs`, `tmp-neutralize*.py`.
  Rien de tout cela n'entre dans un build ni dans un installateur.

---

## 4. Ce qui reste en attente dans l'arbre de travail

Recompté par moi à 10:09 :

| Élément | Nombre | Verdict |
|---|---|---|
| Fichiers **suivis modifiés** | **0** | normal — tout le code livré est enregistré |
| Fichiers dans l'**index** (staged) | **0** | normal |
| Fichiers **non suivis** | **56** | voir ci-dessous |
| dont `RAPPORT-*.md` + `VERIF-*.md` à la racine | 52 | **normal** (rapports de mission) |
| dont `docs/proposition-*.md` | 4 | **normal** (documents de conception) |
| dont **un seul** de la série du jour | 1 (`RAPPORT-diagnostic-etat-ecran-vocal.md`) | **à enregistrer** — voir § 3.2 |
| Fichiers **non suivis autres que `.md`** | **0** | normal — aucun code, aucun binaire, aucun temporaire hors zone ignorée |
| Journaux ignorés à la racine | `verification-build.log` (le mien), `build-installable.log`, `test-js.log`, `test-rust.log`, `job_macos.log`, `job_ubuntu.log`, `pi_stderr*.log` | normal (`.gitignore:31 *.log`) |

Les 55 autres rapports non suivis datent du **2026-10-27 ou avant** : ils sont antérieurs à
cette série et ne la concernent pas.

---

## 5. Conclusion

**PRÊT POUR L'ESSAI.** La base est saine, et je le dis sans réserve sur le code :

- les **trois** vérifications complètes passent, chiffres recomptés par moi :
  **203 fichiers / 3678 tests front, 0 échec** ; **965 tests Rust passés / 12 ignorés / 0 échec**
  sur les **trois** crates (desktop + socle + serveur) ; **construction réussie en 3 min 33 s**,
  deux installateurs v0.6.2 non vides à `target/release/bundle/` ;
- le build ne modifie **aucun** fichier suivi (empreintes identiques) et l'arbre est **propre**
  côté code ;
- rien de suspect dans les sept enregistrements : fichiers de production touchés = les cinq
  attendus, aucun marqueur de travail en cours, aucun test affaibli ni contourné, tous les
  fichiers et rapports attendus présents, aucun rapport annoncé manquant.

**Deux réserves à traiter — aucune ne bloque l'essai, les deux se corrigent en documentation :**

1. `README.md` (l. 108-113), `spec_modes_ecran_vocal.md` (§ 2, l. 34-45, plus l. 61, 95, 99,
   268, 278) et deux lignes de `AGENTS.md` décrivent encore l'ancien bouton étiqueté avec
   pastille dans la rangée d'onglets. Faux depuis `535ceb1`. L'aide intégrée, elle, est juste.
2. `RAPPORT-diagnostic-etat-ecran-vocal.md` devrait être enregistré avec le commit de
   correction `9a8c2cf` (c'est le seul rapport de la série resté hors historique).

Je n'ai **rien corrigé**, ni code, ni test, ni documentation, et je n'ai rien enregistré ni
publié : ces deux points sont signalés pour décision.
