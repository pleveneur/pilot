# Correctif — le lancement en mode développement échoue sur `prepare:laya`

> Correction du défaut décrit dans
> `docs/rapports/RAPPORT-diagnostic-lancement-dev.md` (pas de nouveau
> diagnostic ici : la cause était établie, elle est rappelée en une ligne).
> Branche `main`, sans changement de version, sans publication.

## 1. Résumé

`npm run tauri dev` exécute `beforeDevCommand`, dont la 3ᵉ étape est
`npm run prepare:laya -- --allow-missing`. Ce script **effaçait d'abord**
`src-tauri/laya` (123,5 Mo, dont un `node.exe` de 96 Mo) puis le reconstruisait
sur place. Dès qu'un fichier du dossier était **tenu ouvert** (session de dev
précédente restée en vie, service Laya en fond, fenêtre de l'explorateur posée
dessus), la suppression levait `EPERM`/`EBUSY`, **l'exception n'était pas
rattrapée** : pile Node brute, code de sortie 1, et Tauri ne savait plus dire
que « `beforeDevCommand` terminated with a non-zero status code ». Le dossier
restait de surcroît **amputé**.

Trois changements, et rien d'autre :

1. un effacement / renommage refusé pour une cause **passagère** est
   **réessayé** (8 tentatives, 150 ms d'écart) avant d'être déclaré en échec ;
2. au-delà du plafond, le script **dit quoi faire en français** et sort avec un
   **code explicite (2)**, sans pile d'exception ;
3. la nouvelle version est construite dans un dossier **temporaire à côté**
   (`src-tauri/laya.tmp`) puis **basculée en une fois** : un échec laisse
   `src-tauri/laya` **exactement tel qu'il était**.

## 2. Ce qui a changé, et pourquoi

| Fichier | Nature | Pourquoi |
|---|---|---|
| `scripts/prepare-laya-decision.js` | **nouveau**, module **pur** (aucune I/O, aucun `fs`, aucun minuteur ; tout est injecté) | Les trois décisions vivent à **un seul endroit** et se testent directement : `retryStep` / `removeWithRetries` (nombre de tentatives, attente, plafond, cause définitive), `installDestination` (la bascule), et les phrases d'échec |
| `scripts/prepare-laya.js` | modifié | Il ne décide plus rien : il **appelle** le module. Le `fs.rmSync(DEST)` du début a disparu ; la copie va dans `STAGE = temporaryDirFor(DEST)` ; la fin est la bascule `installDestination` |
| `scripts/prepare-laya.test.js` | modifié (fixture seulement) | Le bac à sable recopie désormais **aussi** le module de décisions à côté du script (le script en dépend). Aucun test n'est modifié, affaibli ni retiré : les 4 tests existants passent à l'identique |
| `scripts/prepare-laya-decision.test.js` | **nouveau**, 25 tests | Décisions pures + **câblage vérifié sur la source** + **reproduction réelle** d'un dossier tenu ouvert sous Windows |
| `.gitignore` | +2 lignes | `src-tauri/laya.tmp/` et `src-tauri/laya.old/` sont des dossiers de travail **transitoires** : jamais versionnés (sinon un échec polluerait `git status`), jamais supprimés d'office |

Détails qui comptent :

- **Aucune attente inutile** : la dernière tentative n'est pas suivie d'un
  `sleep`, et une cause **définitive** (`ENOSPC`, `EROFS`…) n'est **pas**
  réessayée du tout (1 tentative) — réessayer n'y changerait rien.
- **La cible n'est jamais effacée** : elle est **renommée** (`laya` → `laya.old`),
  ce qui est une seule opération atomique ; le temporaire est ensuite renommé
  sur `laya`. Si ce second renommage échoue, l'ancien dossier est **remis en
  place** (`restored`).
- **Un reste n'est jamais fatal** : si `laya.old` ne peut pas être effacé après
  la bascule, la préparation **réussit** et le script prévient qu'il sera
  repris au prochain lancement.
- **Nommer l'étape** : toute sortie d'échec commence par
  `[prepare-laya] ÉCHEC — la préparation du service Laya s'arrête ici.` — Tauri
  n'affiche plus qu'un code non nul, l'utilisateur lit la vraie cause.
- Le message de verrou est **actionnable** : trois gestes numérotés (fermer
  Pilot, arrêter le service Laya / fermer l'explorateur, relancer
  `npm run tauri dev`) puis l'état laissé (« Rien n'a été effacé… »).
- Le **code de sortie 2** distingue « dossier tenu ouvert » d'un échec de
  garde-fou (code 1 : pièce manquante/vide, cible d'architecture différente…).
- Le mode `--allow-missing` (utilisé par **seul** `beforeDevCommand`, jamais par
  `beforeBuildCommand`) efface aussi la cible **avec réessais** et, s'il
  n'y arrive pas, le **dit** et continue — il ne peut plus faire échouer le
  lancement pour un fichier tenu ouvert.

Rien d'autre n'a été touché : aucun numéro de version, aucun fichier de
workflow de publication, aucun comportement de l'application.

## 3. Comportement avant / après

| Situation | Avant | Après |
|---|---|---|
| Dossier libre | effacement + copie sur place | copie à côté puis bascule (~identique, plus sûr) |
| Un fichier tenu ouvert, libéré en < 1 s | `EPERM` → **échec immédiat**, code 1, pile brute | **réussit** après réessais |
| Dossier tenu ouvert en permanence | pile Node brute, code 1, Tauri : « code non nul », dossier **amputé** | message français actionnable, code **2**, dossier **intact**, message disant ce qu'est devenu le temporaire |
| Copie impossible (disque, permission) | pile Node brute | message nommant la **pièce** et le **code**, dossier existant intact |

## 4. Preuve AVANT / APRÈS (manipulation exacte)

**Manipulation** (reproductible, Windows) : un processus Node dont le
**répertoire courant** est le dossier cible est lancé. Windows refuse alors de
renommer et d'effacer ce dossier (`EBUSY` / `EPERM`) — c'est exactement ce que
produit un `node.exe` de Laya lancé depuis `src-tauri/laya`. Le script est
ensuite exécuté dans un **bac à sable** (`os.tmpdir()`), avec une source LayaPL
factice complète, pour ne jamais toucher le vrai dossier du projet.

Mesures :

```
AVANT (scripts/prepare-laya.js de HEAD 3456942) — code de sortie : 1
node:fs:1593
  return binding.rmSync(getValidatedPath(path), opts.maxRetries, ...
Error: EPERM, Permission denied: '...\src-tauri\laya'
    at Object.rmSync (node:fs:1593:18)
    at file:///.../scripts/prepare-laya.js:209:4
  errno: 1, code: 'EPERM', syscall: 'rm'
Node.js v26.13.0
```

Puis, avec le verrou portant sur `laya/node/` (le cas de l'incident, où la
suppression **avait commencé**) :

```
AVANT — code de sortie : 1
1re ligne      : node:fs:1593
dernière ligne : Node.js v26.13.0
fichiers dans src-tauri/laya : 11 avant, 0 après        ← dossier AMPUTÉ
après : (vide)
```

```
APRÈS — code de sortie : 2
[prepare-laya] ÉCHEC — la préparation du service Laya s'arrête ici.
[prepare-laya] ❌ Le dossier des fichiers du service Laya n'a pas pu être remplacé.
[prepare-laya]     ...\src-tauri\laya
[prepare-laya]     Un autre programme le tient ouvert : 8 tentative(s) espacée(s)
[prepare-laya]     de 150 ms ont échoué (EBUSY).
[prepare-laya] Ce qu'il faut faire :
[prepare-laya]   1. fermez Pilot s'il est ouvert (...)
[prepare-laya]   2. arrêtez le service Laya resté en fond (...) et fermez toute
[prepare-laya]      fenêtre de l'explorateur Windows ouverte dans ce dossier ;
[prepare-laya]   3. relancez la commande (npm run tauri dev).
[prepare-laya] Rien n'a été effacé : le dossier existant est intact, tel qu'il était.
[prepare-laya] La copie préparée (...\src-tauri\laya.tmp) a été supprimée.
fichiers dans src-tauri/laya : 11 avant, 11 après        ← INTACT
```

Aucune ligne `    at `, aucune mention de `node:fs` : c'est vérifié
automatiquement, pas seulement à l'œil.

Cas intermédiaire couvert par les tests : verrou **libéré** → le lancement
suivant aboutit (code 0) et remplace le contenu ; le temporaire et le `.old` ont
disparu.

## 5. Chemin normal vérifié (aucun fichier tenu ouvert)

Sur le **vrai** projet (`node scripts/prepare-laya.js`, exactement ce que fait
`beforeDevCommand`) :

- avant : `src-tauri/laya` = 124 Mo, **69 entrées** (chemin + taille relevés) ;
- exécution : `Embarqué : 11 entrées, 123.5 Mo (cible : win32/x64)` ;
- après : **69 entrées**, manifeste **identique au caractère près** (`diff` :
  « Files are identical ») ;
- aucun dossier de travail restant (`laya.tmp`, `laya.old` absents).

Deux exécutions successives (idempotence) sont aussi couvertes par le test
« chemin normal ».

## 6. Preuve par mutation

Le test `scripts/prepare-laya-decision.test.js` a été rejoué sur le script
**d'AVANT** (`git show HEAD:scripts/prepare-laya.js`, module de décisions
conservé) :

```
PASS (20) FAIL (5)
1. câblage — le script n'efface plus la cible d'abord (défaut d'origine)
2. câblage — il réessaie et il bascule par les décisions du module dédié
3. câblage — il construit dans le dossier temporaire, pas dans la cible
4. câblage — il nomme l'étape fautive
5. reproduction — échec LISIBLE (code 2) puis cible INTACTE
```

Les 20 tests de décision pure restent verts : ils portent sur le module
**nouveau**, qui n'existe pas dans le code d'avant (c'est attendu, et c'est ce
qui rend la mutation lisible : ce sont le câblage et la reproduction qui
prouvent le correctif).

Après restauration du correctif : **PASS (29) FAIL (0)** sur
`prepare-laya-decision.test.js` + `prepare-laya.test.js`.

## 7. Résultats réels des tests

`npm test` (Vitest, suite complète du projet) :

```
 Test Files  310 passed (310)
      Tests  5777 passed (5777)
   Duration  15.79s
```

Aucun test n'a été affaibli, ignoré ni supprimé : les 4 tests existants de
`prepare-laya.test.js` passent inchangés (seule la fixture du bac à sable
recopie le module de décisions, sans quoi le script ne peut pas démarrer), et
25 tests s'ajoutent.

Aucun fichier Rust n'a été touché : `cargo test --workspace` n'est pas concerné
par ce correctif.

## 8. Ce qui reste incertain

- **La cause du verrou, à la source.** Le correctif rend l'échec lisible et sans
  perte, il ne supprime pas le verrou : si une session de développement
  précédente reste vivante, il faudra toujours la fermer (le message le dit).
  Empêcher la survie de cette session est un autre sujet.
- **La mesure du verrou dépend de Windows.** La reproduction automatique est
  donc conditionnée à `process.platform === "win32"` ; ailleurs, seules les
  décisions pures et le chemin normal sont exercés (sous Linux/macOS, un fichier
  tenu ouvert donne `ETXTBSY`/`EBUSY` selon les cas — le module traite `EBUSY`
  et `EPERM` de la même façon, mais ce n'est pas mesuré en CI).
- **Nombre de tentatives (8 × 150 ms ≈ 1,2 s)** : choisi pour couvrir la
  libération d'un handle par un processus qui se ferme, sans faire attendre le
  lancement. Aucune mesure de terrain ne prouve que c'est le bon plafond ; il
  est nommé par une constante, donc réglable en un endroit.
- **`laya.old` laissé sur place** (cas rare : effacement de l'ancien dossier
  impossible après une bascule réussie) n'est pas repris automatiquement avant
  le lancement suivant — la préparation **réussit** quand même ; le dossier fait
  ~124 Mo tant qu'il reste.
- Les messages citent « Paramètres → Service Laya → Arrêter » et
  `npm run tauri dev` : si l'un de ces libellés change dans l'interface, le
  message doit suivre (il est écrit à un seul endroit, dans le module).

## 9. Fichiers touchés

- `scripts/prepare-laya-decision.js` (nouveau, décisions pures) ;
- `scripts/prepare-laya.js` (câblage : réessais + construction à côté + bascule) ;
- `scripts/prepare-laya-decision.test.js` (nouveau, 25 tests, dont la
  reproduction réelle d'un dossier tenu ouvert) ;
- `scripts/prepare-laya.test.js` (fixture du bac à sable : le module de
  décisions est recopié à côté du script) ;
- `.gitignore` (`laya.tmp/`, `laya.old/`) ;
- ce rapport.

Comment vérifier :

```bash
npm test                                        # 310 fichiers / 5777 tests
node scripts/prepare-laya.js                     # chemin normal, 11 entrées
npx vitest run scripts/prepare-laya-decision.test.js
```

VERDICT : le lancement dev ne peut plus tomber sur une pile `EPERM` ; un dossier
tenu ouvert donne un message français actionnable et un code 2, la version
existante restant intacte ; le chemin normal produit la même cible qu'avant,
vérifié sur le vrai dossier (69 entrées identiques) ; preuve par mutation à
l'appui (5 échecs sur le code d'avant, 29 tests verts après).
