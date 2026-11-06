# Rapport — Diagnostic : la commande de lancement du mode dev échoue

**Projet** : `G:\IA_PL\pilot` · **Branche** : `main` · **HEAD** : `3456942`
**Nature** : **diagnostic seul** — aucun fichier de code, de configuration, de script ni de dépendance
modifié, aucun commit, aucune branche changée, application **jamais** ouverte, rien installé, aucune
version de Node changée, rien publié.
**Date** : 2026-11-06.

---

## 1. Symptôme rapporté

Le propriétaire lance le mode dev et obtient :

```
Node.js v26.13.0
Error The "beforeDevCommand" terminated with a non-zero status code.
```

---

## 2. Commande exacte et chaîne réellement exécutée

| Élément | Valeur (lue sur le disque) |
|---|---|
| Commande du propriétaire | `npm run tauri dev` → `node scripts/tauri.js dev` → `tauri dev --config src-tauri/tauri.dev.conf.json` |
| `src-tauri/tauri.conf.json:33` | `"beforeDevCommand": "npm run build:mcp && npm run build:handbook && npm run prepare:laya -- --allow-missing && npm run dev"` |
| `src-tauri/tauri.conf.json:34` | `"beforeBuildCommand": "npm run build:mcp && npm run build:handbook && npm run prepare:laya && npm run build"` (ici `prepare:laya` est **strict**, sans `--allow-missing`) |
| `scripts/tauri.js` | ajoute `--config src-tauri/tauri.dev.conf.json` pour `dev` ; lance via `spawn(..., { shell: true })` |

La chaîne compte **quatre** étapes exécutées dans **un seul** shell : `build:mcp` → `build:handbook` →
`prepare:laya --allow-missing` → `dev` (vite). Le message « *beforeDevCommand terminated with a non-zero
status code* » est émis par le CLI Tauri quand **ce shell** rend un code ≠ 0 : il ne dit donc **pas**
laquelle des quatre étapes a échoué.

---

## 3. Ce que la trace dit, avant toute hypothèse

1. La **dernière ligne** de la sortie du propriétaire est `Node.js v26.13.0`. C'est le **pied de page que
   Node imprime pour une exception JavaScript NON rattrapée** (`Error: … / at … { errno, code, syscall }`
   puis `Node.js vXX`). Ce n'est donc **pas** un message d'erreur écrit à la main par un script, ni une
   sortie propre : une étape a **planté sur une exception**.
2. Le code de sortie de cette étape non nulle remonte la chaîne `&&` → shell ≠ 0 → message Tauri.

Ce double indice élimine d'emblée toutes les sorties « propres » : refus explicites des scripts
(`fail()`), erreurs de port de vite (`process.exit(1)` après impression de son propre message), message
« Missing script ». Il reste **une étape qui lève une exception** et **un chemin précis** dans cette
étape.

---

## 4. Reproductions et mesures (toutes faites sur ce poste, sans ouvrir l'application)

### 4.1 Les quatre étapes, testées une par une — **toutes OK**

| Commande | Sortie | Code |
|---|---|---|
| `npm run build:mcp` | `pilot-mcp-client.ts` 718 175 o écrit | **0** |
| `npm run build:handbook` | 49 blocs, 365 155 o écrits | **0** |
| `npm run prepare:laya -- --allow-missing` | `Embarqué : 11 entrées, 123.5 Mo (cible : win32/x64)` | **0** |
| `npm run dev` (vite) | `VITE v6.4.3 ready … http://localhost:5173/` | serveur persistant |

### 4.2 La chaîne entière, telle que Tauri l'exécute

`cmd //c "npm run build:mcp && npm run build:handbook && npm run prepare:laya -- --allow-missing && npm run dev"`,
**y compris avec les variables que Tauri pose** (`TAURI_ENV_PLATFORM=windows`, `TAURI_ENV_ARCH=x86_64`,
`TAURI_ENV_FAMILY=windows`, `TAURI_ENV_DEBUG=true`, `TAURI_ENV_TARGET_TRIPLE=x86_64-pc-windows-msvc`) :

```
[prepare-laya] Embarqué : 11 entrées, 123.5 Mo (cible : win32/x64)
> pilot@0.6.21 dev
> vite
VITE v6.4.3  ready in 287 ms
  ➜  Local:   http://localhost:5173/
```

→ la chaîne va **jusqu'au bout** (arrêt par `timeout`, code 124 = vite écoute, ce qui est le
comportement attendu). **L'environnement Tauri n'est pas en cause.**

### 4.3 Deux serveurs vite simultanés (test du conflit de port)

Second `npm run dev` alors que le premier occupe 5173 :

```
error when starting dev server:
Error: Port 5173 is already in use
    at Server.onError (…/vite/dist/node/chunks/dep-Dm0c1Wj2.js:25119:18)
    …
```

Code **1**, mais **aucun pied de page `Node.js v26.13.0`** → cette cause **ne produit pas** la trace
rapportée (voir § 7).

### 4.4 Reproduction **fidèle** de la trace (preuve clé)

Un processus tient `G:\IA_PL\pilot\src-tauri\laya\node\node.exe` ouvert, puis l'étape 3 est relancée :

```
> node scripts/prepare-laya.js --allow-missing

node:fs:1593
  return binding.rmSync(getValidatedPath(path), opts.maxRetries, opts.recursive, opts.retryDelay);
                 ^

Error: EPERM, Permission denied: 'G:\IA_PL\pilot\src-tauri\laya'
    at Object.rmSync (node:fs:1593:18)
    at file:///G:/IA_PL/pilot/scripts/prepare-laya.js:209:4
    …
  errno: 1,
  code: 'EPERM',
  path: 'G:\\IA_PL\\pilot\\src-tauri\\laya',
  syscall: 'rm'
}

Node.js v26.13.0
```

Code de sortie **1**, en **0,42 s**. C'est **exactement** la forme de la trace du propriétaire : dernière
ligne `Node.js v26.13.0`, exception non rattrapée, code non nul → message Tauri.

Point de code fautif (aucun `try/catch` autour) — `scripts/prepare-laya.js` :

```js
const DEST = path.join("src-tauri", "laya");
// …
fs.rmSync(DEST, { recursive: true, force: true });   // ligne 209
fs.mkdirSync(DEST, { recursive: true });
```

### 4.5 Témoin d'un `npm run tauri dev` réellement en échec de cette façon, sur ce poste

Journaux npm (`%LOCALAPPDATA%\npm-cache\_logs`), relevés avant rotation :

```
verbose title npm run tauri dev          verbose argv "run" "tauri" "dev"      verbose exit 1   verbose code 1
   └ verbose title npm run build:mcp                     verbose exit 0
   └ verbose title npm run build:handbook                verbose exit 0
   └ verbose title npm run prepare:laya --allow-missing  verbose exit 1   verbose code 1
```

Lecture : un lancement réel du mode dev a échoué sur la **seule** étape `prepare:laya`, ce qui a rendu la
chaîne non nulle et déclenché le message Tauri. (Ces fichiers ont depuis été purgés par la rotation
npm — `logs-max: 10` —, ces lignes sont le relevé fait avant purge.)

---

## 5. Cause, en une phrase, et sa preuve

> **`npm run tauri dev` échoue sur la 3ᵉ étape de `beforeDevCommand`, `prepare:laya`, parce que ce script
> commence par supprimer (`fs.rmSync`) puis recréer `G:\IA_PL\pilot\src-tauri\laya` — 123,5 Mo dont un
> interpréteur `node.exe` de 96 Mo — sans aucun rattrapage : si un fichier de ce dossier est tenu ouvert à
> cet instant (un `node.exe` lancé depuis ce dossier, un service Laya encore vivant, une analyse ou un
> verrou Windows), `rmSync` lève `EPERM`/`EBUSY`, l'exception n'est pas rattrapée, le script sort en 1, la
> chaîne `&&` s'arrête et Tauri affiche « beforeDevCommand terminated with a non-zero status code ».**

Preuve : § 4.4 (trace identique, même dernière ligne, même code) + § 4.5 (un `npm run tauri dev` réel a
échoué exactement sur cette étape sur ce poste) + lecture du code (`prepare-laya.js:209`, seul point de
suppression, aucun `catch`).

### 5.1 Dégât secondaire constaté : l'échec **détruit** le dossier

État de `src-tauri/laya` **après** l'échec EPERM, mesuré immédiatement :

```
$ ls -A src-tauri/laya
node/                       # une seule entrée
$ du -sh src-tauri/laya
96M                         # 1 entrée, au lieu de 11 entrées / 123,5 Mo
```

Le service est donc **partiellement supprimé** (seul `node/node.exe` survit, verrouillé). Relancer
`prepare:laya` une fois le verrou libéré répare tout : trois exécutions successives rendent
`Embarqué : 11 entrées, 123.5 Mo`, dossier final 124 Mo. **Cette dégradation silencieuse est un défaut en
soi** : elle explique aussi pourquoi l'échec se répète tant que le détenteur est vivant.

---

## 6. Le verrou est un motif **déjà connu du projet**

`spec_laya.md` documente le même phénomène sur ce dossier :

- § fermeture avant mise à jour : « *sinon le service garderait `node.exe` et les fichiers ONNX ouverts,
  et l'installateur ne pourrait pas les remplacer* » ;
- § arrêt raté : l'installateur NSIS « *échouait sur `laya\node\node.exe` et les DLL ONNX encore mappés
  (erreur d'ouverture du fichier pour écriture)* ».

C'est **le même mécanisme** (fichier tenu ouvert dans `laya\node\`), appliqué ici au script de
préparation. Rien n'a été changé pour l'occasion : `scripts/prepare-laya.js` est **inchangé depuis le
2026-09-30** (`2a5be82`).

---

## 7. Causes écartées, avec la preuve de chacune

| Hypothèse | Verdict | Preuve |
|---|---|---|
| Version Node v26.13.0 incompatible | **écartée** | mêmes versions ici (`node v26.13.0`, `npm 11.14.1`) et les 4 étapes + la chaîne entière passent (§ 4.1, 4.2) |
| Outil manquant (tauri, vite, esbuild, vitest) | **écartée** | `npx tauri --version` = 2.11.2, vite 6.4.3 démarre, esbuild bunddle `build:mcp` sort 0, `node_modules/.bin` complet |
| Commande obsolète / `--` mal transmis | **écartée** | le journal npm de l'étape 3 prouve `argv "run" "prepare:laya" "--" "--allow-missing"` : l'option atteint bien le script, qui l'applique (`--allow-missing` → code 0 quand la source manque) |
| Fichier / dossier absent | **écartée** | source `G:\IA_PL\LayaPL` présente (11 entrées, 123,5 Mo) ; et une absence serait **tolérée** (`--allow-missing` → sortie 0). Le dossier `src-tauri/laya` est **gitignoré** et régénéré à chaque lancement |
| Modification récente du code ou du script | **écartée** | `git log` de `scripts/prepare-laya.js` : dernière modification `2a5be82` (2026-09-30) ; `beforeDevCommand` non modifié ; le dernier commit `3456942` ne touche ni `package.json`, ni `scripts/`, ni `tauri.conf.json` |
| Conflit de port 5173 (instance dev déjà lancée) | **écartée pour cette trace** | reproduit § 4.3 : code 1 mais message vite **sans** pied de page `Node.js v26.13.0`. Cause réelle possible d'un échec *différent*, pas de celui-ci |
| Espace disque insuffisant | **écartée** | `G:` 373 Go libres, `C:` 100 Go libres |
| Mauvais commit / mauvaise branche | **écartée** | `main` propre sur les fichiers suivis (seul `help/handbook.md` en `M` de fins de ligne, antérieur à la mission) |

---

## 8. Correction proposée — **NON appliquée**

### A. Minimum (le défaut tel quel) — `scripts/prepare-laya.js`

1. **Réessayer** au lieu de planter : Node ne réessaie `EPERM`/`EBUSY`/`ENOTEMPTY` que si on le demande
   explicitement :
   ```js
   fs.rmSync(DEST, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
   ```
2. **Rattraper et dire** (jamais une pile brute dans la figure de l'utilisateur) :
   ```js
   try { fs.rmSync(DEST, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); }
   catch (e) {
     fail(`le dossier ${DEST} est tenu ouvert par un autre programme (${e.code}) — `
        + `fermez l'application Pilot / le service Laya puis relancez`);
   }
   ```
   même traitement autour de `fs.copyFileSync` (le `node.exe` de 96 Mo).

### B. Robuste (recommandée)

3. **Ne plus détruire** : construire dans `src-tauri/laya.tmp` puis **renommer** (`fs.renameSync`) sur la
   cible ; en cas d'échec du renommage, on garde l'ancien dossier **intact** — plus aucun état
   intermédiaire détruit (§ 5.1 disparaît) et plus de fenêtre de 0,4 s où 123 Mo sont supprimés.
4. **Idempotence par comparaison** : si `node/node.exe` existe déjà avec la bonne taille, ne pas le
   réécrire du tout (c'est la seule pièce lourde et la seule qui soit verrouillée en pratique).

### C. Lisibilité

5. Message final de la chaîne : le script doit nommer l'étape fautive (`[prepare-laya] échec : …`) pour
   que Tauri n'affiche pas seulement « beforeDevCommand terminated ».

### D. Aucun changement nécessaire côté Tauri

`beforeDevCommand` et `--allow-missing` sont corrects : l'option couvre bien le cas « service absent ».

---

## 9. Vérifications à faire après correction

```bash
# 1) le verrou ne fait plus échouer (ou il est expliqué en français)
./src-tauri/laya/node/node.exe -e "setTimeout(()=>{},40000)" &
npm run prepare:laya -- --allow-missing      # attendu : code 0, ou refus lisible nommant le dossier

# 2) la chaîne complète va au bout
npm run build:mcp && npm run build:handbook && npm run prepare:laya -- --allow-missing

# 3) le mode dev démarre
npm run tauri dev

# 4) aucun état détruit après un échec simulé
ls -A src-tauri/laya                          # attendu : 11 entrées, ~124 Mo dans tous les cas

# 5) anti-régression
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run build:handbook                        # inchangé
```

---

## 10. Ce que je n'ai **pas** pu prouver (honnêteté du diagnostic)

1. **La sortie stdout/stderr de la tentative du propriétaire n'existe plus** : npm ne garde que 10
   journaux et mes propres exécutions les ont fait tourner. La conclusion repose donc sur : (a) le pied de
   page `Node.js v26.13.0` = exception JS non rattrapée, (b) la seule étape de la chaîne capable d'en
   produire une sur un poste sain, (c) la reproduction fidèle (§ 4.4), (d) un `npm run tauri dev` réel en
   échec exactement sur cette étape (§ 4.5).
2. **Le détenteur exact du verrou au moment de l'échec d'origine n'est pas identifiable après coup** : le
   processus est terminé. Il faut le surligner : un `node.exe` lancé depuis `src-tauri\laya` (service Laya
   lancé à la main, session dev précédente, analyse antivirus, fenêtre de l'explorateur) produit ce
   verrou ; la commande de contrôle est donnée ci-dessous.
3. Le **port 5173** est un second motif d'échec de la même commande, mais il produit un **message
   différent** (§ 4.3) : il ne peut pas expliquer la trace rapportée.

### Contrôle immédiat, sans rien modifier

```powershell
# qui tient un exécutable du dossier laya du dépôt ?
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.ExecutablePath -like '*src-tauri\laya*' } |
  Select-Object ProcessId, CreationDate, ExecutablePath
```

Si cette commande nomme un processus : le fermer, puis `npm run prepare:laya -- --allow-missing` (une
fois) et `npm run tauri dev`. Si elle ne nomme personne, l'échec est passé : l'état du dossier a été
régénéré (voir § 11.3).

---

## 11. État laissé par cette mission

1. **Aucun fichier de code, de configuration, de script ou de dépendance modifié.** `git status` est
   identique à l'état d'arrivée : ` M help/handbook.md` (fins de ligne, antérieur) + deux rapports non
   suivis, plus le présent rapport. Aucun commit, aucun changement de branche.
2. **Aucun processus laissé en vie** : les `node.exe` de test (verrou volontaire, 40 s) sont terminés ;
   aucune application graphique n'a été ouverte.
3. **État réparé, pas aggravé** : `src-tauri/laya` (dossier **gitignoré**, régénéré à chaque lancement) est
   complet — 11 entrées, 124 Mo — après l'échec volontaire qui l'avait réduit à `node/node.exe`.
4. **Artefacts régénérés par les tests** : `src-tauri/extensions/pilot-mcp-client.ts` (gitignoré) et
   `help/handbook.md` — ce dernier est **identique à l'octet près** à la sauvegarde prise avant la mission
   (`diff` vide), donc aucun contenu documentaire n'a bougé.
5. Sauvegardes des tests : `/tmp/diag/` (`handbook.before.md`, sorties des essais).

---

DONE: diagnostic terminé — l'échec de `npm run tauri dev` vient de `prepare:laya` (3ᵉ étape de `beforeDevCommand`), dont le `fs.rmSync` de `src-tauri/laya` (123,5 Mo, `node.exe` de 96 Mo) lève une exception `EPERM` non rattrapée dès qu'un programme tient un fichier de ce dossier : reproduction fidèle de la trace (`Node.js v26.13.0`, code 1) et témoin d'un lancement réel en échec sur cette étape ; Node v26, les outils, la syntaxe des commandes, l'absence de fichier et la modification récente sont écartés avec preuve ; correction proposée (réessai + message clair, puis construction dans un dossier temporaire renommé) **non appliquée** ; rapport écrit dans `docs/rapports/RAPPORT-diagnostic-lancement-dev.md`, aucun code touché, aucun commit, application jamais ouverte.
