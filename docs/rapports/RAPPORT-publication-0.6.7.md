# Rapport de publication — Pilot v0.6.7

> Statut : **PUBLIÉE** — étiquette poussée, release GitHub créée ; artefacts en
> cours de fabrication par la CI au moment de la rédaction (§ 6).
> Date : 2026-11-02
> Rédigé par : agent publieur (mission « publie maintenant une nouvelle version »)

---

## 1. État du dépôt à l'ouverture

| Élément | Valeur |
|---|---|
| Branche | `main` |
| HEAD avant travaux | `128c94c` — « feat(sidebar): la liste « Projets en cours » prend le cadre des options du bas » |
| `origin/main` avant travaux | `128c94c` (à jour) |
| Dernière étiquette publiée | `v0.6.6` → commit `fce0c46` |
| Remote de publication | `origin` → `https://github.com/pleveneur/pilot.git` |

### Le GDS est-il basculé ? — NON

`.pilot/gds.json` : `"enabled": false`. La publication GitHub est donc autorisée
(règle absolue respectée). Un remote local nommé `gds` existe (reliquat d'un
test, `src-tauri/laya.__probe2__/pilot-gds-absent-10988`) : **il n'a pas été
utilisé** — toutes les commandes de ce rapport ciblent `origin`.

### Fichiers modifiés présents au départ — NON COMMITÉS, NON TOUCHÉS

Le disque portait six fichiers modifiés par une **autre session en cours**
(demande du propriétaire datée 2026-11-14 : le bas de l'écran Vocal masqué par
défaut) :

```
spec_modes_ecran_vocal.md
src/js/super-agent.js
src/js/vocal-chrome.js
src/js/vocal-chrome-masque.test.js
src/js/vocal-barre-effacee-pendant-la-parole.test.js
src/js/ecran-vocal-saisie-disparait-apres-dix-secondes.test.js
```

Ces modifications **ne font pas partie du lot validé par le propriétaire** et
n'ont donc **pas été commitées** : aucun `git add`, aucun `stash`, aucun
`checkout`, rien de supprimé. Elles restent intactes sur le disque. Conséquence
assumée et signalée : la fabrication locale (§ 4.3) a compilé l'arbre du disque,
donc ces six fichiers ; la CI compile l'arbre **exact** de l'étiquette
`v0.6.7`, qui n'en contient aucun. Les deux arbres ne diffèrent que par ces
fichiers d'interface (aucun fichier Rust, aucun manifeste).

---

## 2. Les 10 commits publiés (`v0.6.6..v0.6.7`)

```
490ccff chore: bump version to 0.6.7
c116aac docs: verser les rapports et conceptions produits depuis v0.6.6
128c94c feat(sidebar): la liste « Projets en cours » prend le cadre des options du bas
86db31a feat(mcp): l'assistant charge tous les serveurs actives, plus un seul
98bc079 fix(vocal): le portrait passe entierement sous le cercle, la saisie s'efface apres 10 s
36d8be2 fix(sentinelles): une sentinelle machine ne s'affiche plus brute
e2b7074 fix(vocal): le bas s'efface pendant la parole, seul le texte du champ et le geste du pointeur le retiennent
2d893bd fix: personnage actif — desactivation complete et mise a jour sans redemarrage
fc62d92 ecran vocal : cercle reduit de 17,9 % (336 -> 276 px), personnage descendu
d38f17d docs: ranger les trois rapports RAPPORT-*.md restes a la racine
```

Les sept commits du lot validé (`128c94c`, `86db31a`, `98bc079`, `36d8be2`,
`e2b7074`, `2d893bd`, `fc62d92`) sont bien tous présents, plus les deux commits
de documentation (`c116aac`, `d38f17d`) et le bump.

Volume : **149 fichiers, +23 727 / −976**.
Commit `c116aac` = 74 documents ajoutés (docs/rapports, docs/conceptions, docs/),
**ajout uniquement** : aucune suppression, aucun déplacement.

---

## 3. Version

Règle du projet : correctifs = dernier chiffre, jamais de recul.

`0.6.6` → **`0.6.7`** (l'étiquette `v0.6.6` existe déjà : aucun numéro réutilisé).

| Fichier | Avant | Après |
|---|---|---|
| `src-tauri/tauri.conf.json` | `0.6.6` | `0.6.7` |
| `package.json` | `0.6.6` | `0.6.7` |
| `src-tauri/Cargo.toml` (paquet `pilot`) | `0.6.6` | `0.6.7` |
| `Cargo.lock` (**racine**, paquet `pilot` seulement) | `0.6.6` | `0.6.7` |

⚠️ Piège `Cargo.lock` évité : la ligne `version` a été éditée **sous**
`name = "pilot"` (ligne 3334-3335), par script à ancrage unique, jamais par
remplacement global. Contrôle :

- `git diff Cargo.lock` → **1 seule ligne changée** (`-version = "0.6.6"` /
  `+version = "0.6.7"`) ;
- `Cargo.lock` contient **deux** occurrences de `0.6.7` : celle de `pilot` et
  celle de la dépendance `zlib-rs` (déjà en 0.6.7 avant le bump, **non
  modifiée**) — c'est la seule ambiguïté possible et elle est levée ;
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` après bump : OK (§ 4.2).

---

## 4. Contrôles — résultat exact (avant étiquette)

### 4.1 Tests du frontend (Vitest) — VERTS

**Avant le bump** (`npm test`, arbre du disque) :

```
Test Files  273 passed (273)
     Tests  5051 passed (5051)
  Duration  16.01s
EXIT = 0
```

**Après le bump**, rapport JSON neuf (`.pilot/tmp-pub/0.6.7-vitest-postbump.json`,
sortie brute `.pilot/tmp-pub/0.6.7-vitest-postbump.log`) :

```
npx vitest run --reporter=json --outputFile=.pilot/tmp-pub/0.6.7-vitest-postbump.json
EXIT = 0
suites  : 1549 / 1549 passées, 0 en échec
tests   : 5051 / 5051 passés, 0 échec, 0 en attente, 0 todo
success : true
fichiers de test sans aucun test : 0
```

Contrôle du piège « fichier qui ne se charge pas » rejoué : aucun fichier de
test vide. Total cohérent avec les annonces des commits du lot (4978 → 5017 →
5048 → 5051).

### 4.2 Tests Rust — VERTS

```
cargo test --workspace        → 992 passed, 12 ignored (6 suites), EXIT = 0
cargo test --lib (après bump) → 819 passed, 1 ignored (1 suite), EXIT = 0
```

Les 12 tests ignorés sont **préexistants** (6 `gds-core/db.rs` et 5
`gds-core/http.rs` qui exigent `PILOT_GDS_TEST_URL`, 1 `help.rs` qui exige `pi`
dans le PATH). Aucun `#[ignore]` ajouté par ce lot : `git diff v0.6.6..HEAD --
'*.rs' | grep '^+#\[ignore'` → aucune ligne.

### 4.3 Fabrication de l'application — RÉUSSIE (signature faite en CI)

```
npm run tauri build      (journal : .pilot/tmp-pub/0.6.7-build.log)
Finished `release` profile [optimized] in 1m 54s
Built application at: target\release\pilot.exe                         44,5 Mo
Running light  → target\release\bundle\msi\Pilot_0.6.7_x64_en-US.msi   79,2 Mo
Running makensis → target\release\bundle\nsis\Pilot_0.6.7_x64-setup.exe 60,8 Mo
Finished 2 bundles                                                    EXIT = 1
```

Le binaire et les **deux** installeurs versionnés 0.6.7 sont produits. La
commande ne rend pas 0 pour une seule raison, en fin de chaîne :

```
A public key has been found, but no private key.
Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
```

C'est le comportement attendu sur le poste : la clé privée de signature n'y est
pas exposée, le workflow la fournit (`.github/workflows/release.yml`). Ce n'est
pas un contrôle rouge du code — la v0.6.6 a été publiée par ce même chemin. Le
journal ne contient **aucune autre ligne d'erreur** (`grep -ci error` → 1).

Empreintes locales (contrôle d'intégrité, pas des artefacts publiés) :

```
sha256 8b8f2708…  Pilot_0.6.7_x64_en-US.msi
sha256 58d474e6…  Pilot_0.6.7_x64-setup.exe
```

### 4.4 Image du serveur GDS — reconstruite, conteneur NON touché

```
npm run gds:image   →  IMAGE SEULE (service intact), EXIT = 0, durée 16,9 s
Image   : pilot-gds:local reconstruite
Conteneur : NON touché — le service continue de tourner
Volumes : intacts
```

`npm run gds:reload` **n'a pas été lancé** : le rechargement du conteneur est la
décision du propriétaire.

### 4.5 Verdict

| Contrôle | Résultat |
|---|---|
| Vitest (5051 tests, 1549 suites) | ✅ verts |
| Fichiers de test vides | ✅ aucun |
| `cargo test --workspace` (992) | ✅ verts |
| `cargo test --lib` après bump (819) | ✅ verts |
| Fabrication binaire + MSI + NSIS 0.6.7 | ✅ réussie |
| Signature des artefacts | ✅ faite en CI (pas de clé privée sur le poste) |
| Image GDS reconstruite (conteneur intact) | ✅ |

**Aucun test rouge → étiquette autorisée.**

---

## 5. Étiquette et dépôt

| Élément | Valeur |
|---|---|
| Commit de bump | `490ccfffd671b6ea7937a9de419ef6d93c719799` — « chore: bump version to 0.6.7 » |
| Fichiers du commit de bump | `Cargo.lock`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `release-notes/v0.6.7.md` (5 fichiers, +75 / −4) |
| `origin/main` après push | `490ccff` (0 commit d'avance / 0 de retard) |
| Étiquette | `v0.6.7` **annotée**, message = `release-notes/v0.6.7.md` |
| Objet étiquette | `137fd75f1bf07e97b4a46cbb596651d8d8d62421` → commit `490ccff` |
| Étiquette poussée | oui — `git push origin v0.6.7` → `ok v0.6.7`, confirmé par `git ls-remote` |
| `v0.6.6` | **intacte** : objet local `79975e9b…` = objet distant, commit `fce0c46` inchangé |

Historique : aucun `reset`, aucun `checkout` écrasant, aucun `push --force`,
aucune réécriture, aucun changement de dépôt, aucune donnée supprimée.

---

## 6. Publication GitHub

Workflow `release`, run **172**, id `41410231171`, branche `v0.6.7`,
commit `490ccff`, démarré le 2026-11-02 à 08:02:56 UTC.
<https://github.com/pleveneur/pilot/actions/runs/41410231171>

Release **créée et publiée** (pas un brouillon) :

```
tag        : v0.6.7
nom        : Pilot v0.6.7
publiée    : 2026-11-02T08:03:06Z
brouillon  : false
préversion : false
```

Au moment de la rédaction, `create-release` est `success` et les tâches `test`
(ubuntu, macos, windows) sont `in_progress` : les installateurs sont donc encore
en cours de fabrication et la liste des fichiers de la release est **vide à cet
instant**. L'état final se lit sur la page de la release (§ 8) — je ne peux pas
l'affirmer avant qu'il existe, et je ne l'invente pas.

---

## 7. Texte exact du changelog publié (`release-notes/v0.6.7.md`)

```markdown
# Pilot v0.6.7

Cette version corrige quatre choses que vous avez signalées, et en finit deux
chantiers en cours : l'écran **Vocal** et la conversation de l'**Assistant**.

## ✨ Nouvelles fonctionnalités

- **L'Assistant peut utiliser tous vos serveurs d'outils à la fois.** Il n'est
  plus obligé d'en choisir un seul : tout ce qui est activé est chargé dans la
  même conversation, et leurs outils sont utilisables directement, sans passer
  par un agent intermédiaire. Activer un serveur n'en coupe plus un autre :
  ceux qui restent actifs vous sont nommés dans la réponse.

- **Le personnage se change sans redémarrer.** Activer, changer ou retirer un
  personnage dans Présences se voit tout de suite dans Pilot : le nom de
  l'onglet et le portrait suivent en quelques secondes, même si Pilot est resté
  ouvert au premier plan. Et « Aucun personnage » veut désormais dire qu'il n'y
  en a pas — ce n'est plus un nom qui s'affiche.

## 🐛 Corrections

- **Plus de texte technique à l'écran.** Quand un agent de l'Assistant
  déclenchait une action interne (planifier une tâche, par exemple), Pilot
  affichait un charabia du genre
  « PILOT_ASSISTANT_SCHEDULE::{"op":"list"} » avec deux boutons Valider /
  Annuler. L'action est maintenant exécutée comme prévu, sans que rien de
  technique n'apparaisse. Le filet couvre toutes les actions internes, y
  compris celles dont Pilot ne connaît pas encore la famille : dans ce cas il
  affiche une phrase neutre, jamais le texte brut.

- **Le portrait n'est plus touché par la lueur du cercle.** La photo du
  personnage mordait de 17 à 60 pixels dans le halo lumineux selon que Pilot se
  taisait ou parlait. Mesuré au banc : il reste maintenant 43 pixels de
  dégagement au repos et le contact tient à moins d'un pixel en pleine voix,
  dans les trois états de l'écran. Si la place manquait, c'est l'espace qui
  cède, jamais le visage.

- **La barre du bas s'efface vraiment au repos.** Deux situations la retenaient
  pour toute la session, alors que vous ne parliez pas : Pilot croyait vous
  entendre dans une pièce silencieuse, ou il lisait une réponse — et un champ
  de saisie vide gardait le curseur après un envoi. Il ne reste que deux raisons
  de la garder : du texte dans le champ, ou votre souris en mouvement dessus.
  Elle revient au geste, et aussi dès que vous prenez la parole.

- **Un personnage retiré disparaît complètement.** Nom et photo pouvaient
  rester affichés après une désactivation, et une ancienne copie du portrait
  pouvait réapparaître. Le dossier personnel fait désormais seul autorité,
  même vide : plus de nom fantôme, plus d'image héritée d'un ancien réglage.
  Rien n'est supprimé de votre disque.

- **La liste « Projets en cours » a le même cadre que les options du bas.**
  Elle est encadrée comme le reste de la colonne, avec les mêmes couleurs de
  thème. Les noms un peu longs sont coupés proprement par des points de
  suspension au lieu de déborder.

## ⚡ Améliorations

- **Le cercle de l'écran Vocal est plus discret et le personnage plus grand.**
  Le cercle lumineux est 17,9 % plus petit et le halo garde exactement son
  aspect. La place libérée profite au personnage, sensiblement plus grand à
  toutes les tailles de fenêtre. Les deux colonnes gardent leur hauteur, la
  liste des tâches ne perd aucune ligne, et sans personnage le cercle reste
  parfaitement centré.

- **La zone de saisie de l'écran Vocal reste plus longtemps.** Elle s'efface
  après 10 secondes sans mouvement de souris (au lieu de 2,5 secondes), pour
  laisser le temps de lire et de répondre.

- **Rien d'autre ne change.** La dictée vocale, la lecture à voix haute, les
  trois modes d'écran, les conversations en cours et vos réglages restent
  identiques.
```

---

## 8. Ce que le propriétaire doit vérifier à la main

1. **La page de la release** : <https://github.com/pleveneur/pilot/releases/tag/v0.6.7>
   — attendue avec 11 fichiers : `Pilot_0.6.7_x64-setup.exe` (+ `.sig`),
   `Pilot_0.6.7_x64_en-US.msi` (+ `.sig`), les deux `.dmg` macOS,
   `Pilot_x64.app.tar.gz` / `Pilot_aarch64.app.tar.gz` (+ `.sig`) et
   `latest.json`. Si macOS échoue (runners arm64), la règle du projet rend cet
   échec non bloquant : Windows part quand même.
2. **Les signatures** : chaque `.sig` doit commencer par
   `untrusted comment: signature from tauri secret key`. Sans cela la mise à
   jour automatique est refusée.
3. **`latest.json`** doit annoncer `0.6.7` et les bons noms de fichiers
   (`windows-x86_64` → `Pilot_0.6.7_x64-setup.exe`).
4. **Le job `latest-json`** doit être `success` (c'est lui qui alimente la mise
   à jour automatique) ; `build-linux` est **séparé** et ne bloque rien.
5. **Installation réelle** : lancer l'installeur 0.6.7 et vérifier à la main les
   quatre points validés (plus de texte technique dans l'Assistant, portrait
   dégagé sous le cercle, barre du bas qui s'efface, tous les serveurs d'outils
   ensemble) — la fabrication locale ne prouve pas le ressenti.
6. **Rien à faire pour le GDS** : l'image est reconstruite, le conteneur tourne
   toujours. Le rechargement (`npm run gds:reload`) reste **votre** décision.
7. **Six fichiers restent modifiés, non publiés**, dans le dépôt de travail
   (le bas de l'écran Vocal masqué par défaut, session du 2026-11-14). Ils
   attendent leur propre validation : ne pas les confondre avec ce lot.

---

## 9. Traçabilité des commandes

| Commande | Résultat |
|---|---|
| `npm test` (avant bump) | 273 fichiers / 5051 tests verts, EXIT 0 |
| `npx vitest run --reporter=json …` (après bump) | 1549/1549 suites, 5051/5051 tests, EXIT 0 |
| `cargo test --workspace` | 992 passed / 12 ignored, EXIT 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 819 passed / 1 ignored, EXIT 0 |
| `npm run gds:image` | image reconstruite, conteneur intact, EXIT 0 |
| `npm run tauri build` | binaire + MSI + NSIS 0.6.7, EXIT 1 sur la signature locale uniquement |
| `git push origin main` | ok — `origin/main` = `490ccff` |
| `git tag -a v0.6.7 -F release-notes/v0.6.7.md` | objet `137fd75f…` |
| `git push origin v0.6.7` | ok — confirmé par `git ls-remote --tags origin v0.6.7` |
