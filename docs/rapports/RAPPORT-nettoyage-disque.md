# Rapport — nettoyage disque du projet (2 postes autorisés)

> **Date** : 2026-11-15
> **Périmètre** : exactement les deux postes autorisés par le propriétaire, rien d'autre.
> **Aucun fichier suivi par Git n'a été modifié** (preuves § 5).

---

## 1. Mesure globale

| Moment | Mesure `du -sh .` | Mesure exacte (octets) |
|---|---|---|
| Avant | **122 G** | 130 451 472 384 (reconstituée par somme, voir ci-dessous) |
| Après | **911 M** | **954 589 184** |

Reconstitution de la taille de départ (le `du -s --block-size=1` du projet entier n'a
pas été capturé avant la première suppression ; il est donc calculé par somme des
postes mesurés en octets, ce qui est exact au bloc près) :

```
après (954 589 184) + target (129 420 276 736) + setup042.exe (64 380 928)
                    + tmp-pub (9 015 296)       + _goldtmp (3 210 240)
= 130 451 472 384 octets = 121,5 Gio  (du -sh affichait 122 G)
```

**Gain total : 129 496 883 200 octets** = **120,6 Gio** (129,5 Go), soit **−99,27 %**
de l'empreinte du projet.

---

## 2. Poste 1 — `G:\IA_PL\pilot\target` (dossier de compilation Cargo)

### Vérifications préalables (sorties réelles)

```
$ tasklist | grep -icE "cargo|rustc|tauri|link\.exe"
0
$ tasklist //FI "IMAGENAME eq cargo.exe"     -> aucune tâche ne correspond
$ tasklist //FI "IMAGENAME eq rustc.exe"     -> aucune tâche ne correspond
$ tasklist //FI "IMAGENAME eq link.exe"      -> aucune tâche ne correspond
$ tasklist | grep pilot.exe
pilot.exe   27128  ...   (l'IDE hôte, n'utilise pas target/)
```

Aucun `cargo` / `rustc` / `tauri` / `link` en cours (vérifié deux fois : avant analyse
et juste avant la suppression).

```
$ git check-ignore -v target
.gitignore:6:target/	target          -> ignoré, preuve formelle
$ git ls-files target
(vide)                             -> aucun fichier suivi sous target/
$ git ls-files -m | wc -l
0
```

### Taille mesurée avant

```
$ du -s --block-size=1 target
129420276736                        (120,53 Gio)
$ find target -type f | wc -l
68975
$ du -sh target/* | sort -rh | head -3
113G  target/debug
8.5G  target/release
16K   target/rapport-bip-fin-de-tour.md
```

### ⚠️ Données non reconstructibles trouvées DANS target → préservées avant suppression

`target/` contenait **11 rapports de mission** (`rapport-*.md`, 86 Kio au total)
déposés là par erreur. Contrôle d'unicité par empreinte MD5 sur tout `docs/` et
`.pilot/rapports/` : **aucun doublon**, ces fichiers n'existaient nulle part ailleurs
dans le dépôt. Les supprimer aurait détruit du travail du propriétaire, ce qui n'est
pas reconstructible par une compilation — ils ont donc été **copiés** (jamais
déplacés depuis une autre zone) vers `docs/rapports/`, conformément à la règle 7
d'`AGENTS.md` (les rapports vivent dans `docs/rapports/`, sans renommage), **avant**
la suppression :

```
rapport-bip-fin-de-tour.md                              OK (hash identique)
rapport-correction1-stale-busy-tool-in-progress.md      OK (hash identique)
rapport-correction1bis-tool-long-deux-chemins.md        OK (hash identique)
rapport-correction2-abandon-file-trace.md               OK (hash identique)
rapport-correction3-marqueurs-arrets-onglet-agent.md    OK (hash identique)
rapport-correction4-controle-negatif-etendu.md          OK (hash identique)
rapport-doc-supervision-agents.md                       OK (hash identique)
rapport-liste-agents-sans-onglet.md                     OK (hash identique)
rapport-publication-0.4.34.md                           OK (hash identique)
rapport-publication-0.4.35.md                           OK (hash identique)
rapport-test-mcp-linux.md                               OK (hash identique)
```

Ces 11 fichiers sont **laissés non suivis** (le commit de cette tâche ne contient que
le présent rapport, comme demandé) : le propriétaire décide de les versionner ou non.

### Suppression

Le premier essai (`cmd //c "rd /s /q"`) a échoué par échappement MSYS
(`exit=123`, « syntaxe du nom de fichier... incorrecte ») — **rien n'a été supprimé**.
Commande réellement utilisée, relancée sous une autre forme :

```bash
MSYS2_ARG_CONV_EXCL='*' cmd.exe /c 'rd /s /q target'
# exit=0, durée 7 s
```

### Taille après

```
$ du -s --block-size=1 target
(inexistant)          -> « target ABSENT »
$ ls -d target
ABSENT
$ du -sh .
984M                  -> 1 031 195 648 octets
```

**Gain du poste 1 : 129 420 276 736 octets (120,5 Gio) — 68 975 fichiers.**

`target` ne contenait, hors rapports préservés, que des artefacts de compilation
(`debug/`, `release/`, `CACHEDIR.TAG`, `.rustc_info.json`,
`.future-incompat-report.json`) : entièrement reconstructible par `cargo build`.

---

## 3. Poste 2 — Déchets de pilotage (`.pilot/`, non versionné)

Preuve de non-versionnement, pour les trois chemins :

```
$ git check-ignore -v .pilot/tmp-pub .pilot/_goldtmp .pilot/tmp/diag/setup042.exe
.gitignore:44:.pilot/	.pilot/tmp-pub
.gitignore:44:.pilot/	.pilot/_goldtmp
.gitignore:44:.pilot/	.pilot/tmp/diag/setup042.exe
$ git ls-files .pilot/tmp-pub .pilot/_goldtmp .pilot/tmp | wc -l
0
```

Aucun processus d'installation actif avant suppression :

```
$ tasklist | grep -iE "setup042|nsis|setup"
aucun processus d'installation
```

| Poste | Taille avant (blocs) | Contenu | Commande | Après | Gain réel |
|---|---|---|---|---|---|
| `.pilot/tmp/diag/setup042.exe` | 64 380 928 o (61,4 Mio) | installateur 0.4.2, 1 fichier | `rm -f` | absent (`rc=0`) | **61,4 Mio** |
| `.pilot/tmp-pub/` | 9 015 296 o (8,6 Mio) | 68 fichiers — journaux de build et rapports vitest JSON des publications 0.6.x | `rm -rf` | absent (`rc=0`) | **8,6 Mio** |
| `.pilot/_goldtmp/` | 3 210 240 o (3,1 Mio) | 162 fichiers — copie de travail `src/` + `node_modules/` servant de comparateur (`gold-old.json`, `gold-summary.txt`) | `rm -rf` | absent (`rc=0`) | **3,1 Mio** |

**Gain du poste 2 : 76 606 464 octets (73,1 Mio), 231 fichiers.**

Taille du projet après le poste 2 : `911M` / `954 589 184` octets.

---

## 4. Ce qui n'a PAS été touché (vérifié présent après coup)

```
OK present : .git                      OK present : src-tauri/assets
OK present : node_modules               OK present : src-tauri/assets/PilotBase.vrm
OK present : dist                       OK present : src-tauri/assets/plface.exe
OK present : src-tauri/laya             OK present : .pilot/context-index.db
OK present : .pilot/rapports            OK present : .pilot/sessions.jsonl
```

`.pilot/` conserve aussi `graph-wiki/`, `sessions/`, `tmp/`, `tests/`,
`test-results/`, `reservations` implicites (`commands.json`, `gds.json`), les
journaux de tests vitest et `agent-stops.log` — intacts.
Aucun `git gc`, aucune commande Git destructive, aucun déplacement dans
`.pilot/rapports/`.

---

## 5. Preuve « aucun fichier suivi par Git touché »

```
$ git ls-files -m | wc -l          0      (fichiers suivis modifiés)
$ git diff --cached --numstat      (vide) (rien d'indexé)
$ git status
* main
? Untracked: 11 files
   docs/rapports/rapport-bip-fin-de-tour.md
   ... (les 11 rapports préservés du § 2)
```

Un seul écart par rapport à l'état initial : **11 ajouts non suivis** dans
`docs/rapports/`, qui sont les rapports **sauvegardés** depuis `target/` (aucune
perte). Aucun fichier suivi n'est modifié, aucun n'est supprimé, l'index Git est
vide. Le seul fichier versionné ajouté par la tâche est le présent rapport.

`git status --short` de ce dépôt répond une forme compacte propriétaire (`ok` quand
l'arbre est propre) ; les preuves ci-dessus utilisent donc `git ls-files -m`,
`git diff --cached` et `git status` en clair, qui sont sans ambiguïté.

---

## 6. Vérification que le projet reste utilisable

```
$ npm test
 Test Files  312 passed (312)
      Tests  5807 passed (5807)
   Duration  14.40s
```

Tous les tests front passent **après** le nettoyage (le code n'a pas été touché :
les 5807 tests valident l'état `HEAD` intact). Le dossier `target` étant supprimé,
le backend Rust doit être recompilé avant son premier test :

```bash
cargo test --workspace          # reconstruit target/, puis teste
# ou
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Aucun fichier source, aucune spec, aucun rapport existant n'a été modifié.

---

## 7. Taille finale du projet

```
$ du -sh .
911M
$ du -s --block-size=1 .
954589184            (0,89 Gio — 954 Mo)   <- juste après les suppressions
```

Mesure la plus tardive (après `npm test`, qui réécrit ses rapports dans
`.pilot/` et après l'ajout du présent rapport) : `911M` / `954 627 072` octets
(+37 888 octets d'artefacts de test et de rapport, sans rapport avec le
nettoyage).

**Projet : 122 G → 911 M (129,5 Go libérés, −99,27 %).**
