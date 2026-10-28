# Rapport — une répétition de LECTURE n'arrête plus jamais un agent

Mission : supprimer la dernière source d'arrêts automatiques injustifiés du bus
d'agents (JS uniquement, aucun fichier Rust, aucun push/tag).

## 1. Faits constatés (`agent-ops.log`)

- Deux runs `codeur` tuées par un `abort_agent_process` **CIBLÉ** (uid) émis par
  la détection de boucle du bus d'agents : **04:10:04 (uid 7)** et
  **04:51:13 (uid 11)**.
- Les agents travaillaient normalement : fichiers écrits **1 s avant** l'arrêt,
  travail partiel cohérent sur le disque.
- Causes écartées : timeout d'inactivité, boucle côté Rust
  (`agent_auto_stop_enabled=false`), arrêt manuel.
- Cause réelle : le détecteur comptait comme « boucle » la **répétition d'outils
  de consultation**. Un agent qui relance `git status --short`, `git diff`,
  `sed -n`, `rg` entre deux corrections légitimes atteignait le seuil
  (`detectRepeatedActions`, fenêtre 20) et se faisait couper en plein travail.

## 2. Règle implémentée (décision)

> Une répétition d'opération en **LECTURE SEULE** n'est **JAMAIS** un motif
> d'arrêt automatique. Seules les actions qui **MODIFIENT** (edit/write/patch,
> bash **mutateur**, outil inconnu) peuvent fonder un arrêt pour boucle.

Les filets de sécurité restent **inchangés et tracés** : timeout d'inactivité,
plafond de tours pi, moniteur d'anomalie Rust, détection de boucle de **TEXTE**,
et le plafond de tours de la run (`turn-cap`).

## 3. Correctif

### 3.1 `src/js/loop-detection.js` — classifieur pur `isReadOnlyShellCommand(command)`

Nouvelle fonction **pure et exportée** qui classe une ligne de commande shell
comme consultative. Principe de prudence : **cas par défaut `false`** — on ne
retire un arrêt que si la commande est **prouvée** consultative.

- La ligne est découpée en **segments** (`&&`, `||`, `;`, `|`, saut de ligne) et
  **tous** les segments doivent être consultatifs.
- Un segment est refusé dès qu'il contient une **redirection d'écriture**
  (`>`, `>>`) ou `tee` (les duplications de descripteur `2>&1` ne sont **pas**
  des écritures : elles sont neutralisées avant l'examen).
- Commandes / sous-commandes reconnues comme consultatives :
  - `git status|log|diff|show|rev-parse|ls-files|ls-tree|blame|describe|shortlog|grep|cat-file|name-rev|reflog|whatchanged|help|version` ;
  - `git stash list|show` uniquement ;
  - `git branch|tag|remote` **seulement sans argument positionnel**
    (`git branch` liste ; `git branch nom` **crée** → `false`) ;
  - `ls`, `dir`, `cat`, `head`, `tail`, `wc`, `rg`, `grep`, `findstr`, `find`,
    `pwd`, `type`, `sort`, `uniq`, `cut`, `cd`, `diff`, `stat`, `du`, `df` ;
  - `sed` **uniquement** avec `-n`/`--quiet`/`--silent` et **sans** `-i`/`--in-place` ;
  - `node -v|--version`, `npm ls|list|view|info|show|outdated|why`,
    `cargo --version|-V|--help|-h`.
- Refus explicites (même s'ils seraient « inconnus » de toute façon) :
  `rm`, `mv`, `cp`, `mkdir`, `touch`, `rmdir`, `chmod`, `chown`, `ln`, `dd`,
  `truncate`, `install`, `patch`, `tee` ;
  `find -delete|-exec|-execdir|-ok|-okdir|-fprint|-fprintf|-fls` ;
  `sort -o|--output` (écrit un fichier) ; `uniq entree sortie` (2 arguments
  positionnels = écriture).
- Préfixes neutres gérés : affectations d'environnement (`FOO=bar …`),
  `time`, `command`. Noms de commande normalisés (chemin retiré, `.exe/.cmd/
  .bat/.ps1` retirés, minuscules).

### 3.2 `src/js/agents-bus.js` — routage + suppression du motif d'arrêt

1. Nouvel ensemble `AGENT_SHELL_TOOLS = { "bash", "shell" }` et helper
   `pushReadOnlyToolCall()` (historique de lecture borné à 40, comme
   l'historique principal).
2. Dans `tool_execution_start` : une commande shell **consultative** est routée
   vers l'historique de **LECTURE** (`ctx.readOnlyToolCallsByAgent`) au lieu de
   `ctx.toolCallsByAgent` → elle ne peut plus fonder d'arrêt, mais reste
   enregistrée pour l'observabilité.
3. `maybeDetectAgentLoop` : la clause
   `detectRepeatedActions(ctx.readOnlyToolCallsByAgent[agentId], { minRepeat: 8 })`
   est **retirée** de la condition d'arrêt. L'historique de lecture n'est plus
   jamais examiné ; il reste alimenté.
4. Inchangés : `detectRepeatedToolCalls` + `detectRepeatedActions` sur
   l'historique **mutateur** (mêmes seuils : 3 consécutifs / 5 dans une fenêtre
   de 20), détection de boucle de texte, escalade, plafonds, journalisation
   `.pilot/agent-stops.log`.

## 4. Table de cas (`isReadOnlyShellCommand`)

| Commande | Attendu | Obtenu |
|---|---|---|
| `git status --short` | `true` | `true` |
| `git diff --stat` | `true` | `true` |
| `git log --oneline -5` | `true` | `true` |
| `git branch -a` | `true` | `true` |
| `git stash list` | `true` | `true` |
| `sed -n 1,20p fichier` | `true` | `true` |
| `rg TODO src` / `grep -n x f` / `findstr x f` | `true` | `true` |
| `ls -la`, `cat f`, `head -20 f`, `tail -5 f`, `wc -l f`, `pwd`, `type f` | `true` | `true` |
| `sort f`, `uniq /tmp/in.txt`, `cut -d, -f1 data.csv` | `true` | `true` |
| `node -v`, `npm ls`, `cargo --version` | `true` | `true` |
| `cd x && git status` | `true` | `true` |
| `git log --oneline \| head -5` | `true` | `true` |
| `git status --short 2>&1` | `true` (dup. de descripteur, pas d'écriture) | `true` |
| `git commit -am x` | `false` | `false` |
| `git push` / `git checkout main` / `git restore f` / `git reset --hard` / `git add .` / `git rm f` / `git mv a b` | `false` | `false` |
| `git stash push` / `git stash apply` | `false` | `false` |
| `git branch nouvelle-branche` / `git tag v1.0.0` | `false` | `false` |
| `echo x > f` / `cat a >> f` / `git log > out.txt` | `false` | `false` |
| `sed -i s/a/b/ f` / `sed -i.bak …` | `false` | `false` |
| `rm -f f` / `mv a b` / `cp a b` / `mkdir d` / `touch f` | `false` | `false` |
| `find . -delete` / `sort -o out.txt f` / `uniq in.txt out.txt` | `false` | `false` |
| `npm install` / `npm run build` / `npm test` | `false` | `false` |
| `cargo fmt` / `cargo fix --allow-dirty` / `cargo test --lib` | `false` | `false` |
| `node script.js` | `false` | `false` |
| `git status && rm -f x` / `git status; npm install` / `cat f \| tee out.txt` | `false` | `false` |
| `commandeInconnue --flag`, `""`, `null`, `42`, `{}` | `false` | `false` |

Vérification hors suite (script ad hoc) : **67/67** cas conformes
(32 positifs + 35 négatifs). Dans la suite : 39 entrées positives et 44
entrées négatives (dont des cas dégénérés : `""`, `"   "`, `null`,
`undefined`, `42`, `{}`) — `loop-detection.test.js`,
`describe("isReadOnlyShellCommand …")`.

## 5. Tests ajoutés / adaptés

### `src/js/loop-detection.test.js` (nouveau bloc)
- `classe comme consultatives les commandes de LECTURE prouvées` (table positives)
- `refuse toute commande qui MODIFIE, redirige ou exécute du code` (table négatives)
- `est consultative seulement si CHAQUE segment de l'enchaînement l'est`
- `n'est pas consultative dès qu'une redirection écrit un fichier`

### `src/js/agents-bus.test.js` (nouveau bloc « une répétition de LECTURE n'arrête jamais l'agent »)
- **12 `git status --short` entrecoupés de 12 `edit` DIFFÉRENTS → AUCUN
  `abort_agent_process` / `stop_agent_process`** ; les 12 consultations sont
  dans l'historique de lecture, les 12 `edit` dans l'historique mutateur.
- 12 consultations identiques sans aucune écriture → aucun arrêt
  (observabilité seulement).
- **NON-RÉGRESSION** : 3 `edit` au **même contenu** → toujours détecté et
  arrêté (`abort_agent_process` ciblé sur l'agent).
- **NON-RÉGRESSION** : 9 `bash` **MUTATEURS** identiques
  (`rm -rf build && npm run build`) → toujours détecté et arrêté, et rien dans
  l'historique de lecture.

### Adaptation autorisée (une seule)
`src/js/agents-bus.test.js`, bloc « boucle d'outils — les outils de LECTURE sont
exclus du comptage (règle 2) », cas *« 9 lectures strictement identiques : la
boucle SOUTENUE est détectée »* : ce cas exigeait l'inverse de la décision (un
arrêt sur répétition de lectures). Assertions **retournées** : aucune lecture ne
déclenche d'arrêt, les 9 lectures restent tracées dans l'historique de lecture,
la run reste `running`. **Pourquoi** : c'est exactement le comportement qui a
tué les deux runs (seuil de lectures) ; le conserver aurait maintenu le bug.

Conséquences **non fonctionnelles** (renommage/documentation uniquement, aucune
assertion changée) : le cas voisin « 7 + 7 lectures identiques » est renommé
(`7 + 7 lectures identiques (deux fichiers) ne coupent rien`) et son commentaire
ne parle plus d'un « seuil dédié » qui n'existe plus.

**Aucun autre test existant n'a été modifié.** Aucun autre test n'a rougi.

## 6. Preuves d'échec (obligatoires)

1. **Classification neutralisée** (`isReadOnlyShellCommand` → `return false`) :
   **5 tests échouent** :
   - `loop-detection.test.js` : 3 cas du classifieur
     (« … : "git status": expected false to be true ») ;
   - `agents-bus.test.js` : `12 git status … : AUCUN arrêt`
     (`expected [ [ 'abort_agent_process', … ] ] to deeply equal []`) et
     `12 consultations identiques … : AUCUN arrêt`.
2. **Ancien comportement restauré** (clause
   `detectRepeatedActions(ctx.readOnlyToolCallsByAgent…, { minRepeat: 8 })`
   remise dans `maybeDetectAgentLoop`) : **3 tests échouent** — le cas adapté
   `9 lectures … AUCUN arrêt` et les deux cas du nouveau bloc
   (`12 git status …`, `12 consultations identiques …`). C'est la preuve que
   l'adaptation du cas « 9 lectures » était **nécessaire** et non cosmétique.

Les deux neutralisations ont été faites sur une copie de sauvegarde puis
**restaurées** (fichiers vérifiés après restauration).

## 7. Vérifications finales

- `npm test` (complet) : **115 fichiers / 1971 tests, tous verts**.
- `npm run build:handbook` relancé (bloc `HELP:loop-detection-writes` réécrit).
- Documentation mise à jour : `spec_super_agent.md` (paragraphe technique
  « Faux positif corrigé (lectures et consultations) » + bloc HELP orienté
  utilisateur) et `AGENTS.md` (description de `loop-detection.js`).
- Aucun fichier Rust touché, aucun push, aucun tag. `geminiReport.md` non touché.

## 8. Suites à surveiller (non faites ici, hors mission)

- La détection de boucle de **TEXTE** et le `turn-cap` restent des filets : si
  d'autres arrêts injustifiés apparaissent, la même méthode s'applique
  (`detected=` dans `.pilot/agent-stops.log`).
- `rg "a|b"` est classé **non** consultatif (découpage sur `|` sans tenir compte
  des guillemets) : choix de prudence assumé, à affiner si des arrêts
  réapparaissent sur ce motif.
