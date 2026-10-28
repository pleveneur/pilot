# Rapport — fenêtres de console noires (lancements de processus sous Windows)

Mission de **diagnostic en lecture seule**. Aucun fichier de code n'a été modifié,
aucun script supprimé, aucun test complet lancé. Seul ce rapport est ajouté au
dépôt.

Projet : `G:\IA_PL\pilot` — version en cours (`Cargo.toml` 0.6.2), commit de
départ `892782c`.

---

## 0. Résumé en trois phrases

1. **Tous** les lancements du chemin « mission d'agent » (sessions `pi`, `git`,
   auto-test, son de notification, voix locale, MCP, aide, Laya, GDS, arrêt
   d'agents) sont aujourd'hui **masqués** par `CREATE_NO_WINDOW`
   (`0x08000000`) — preuve : 20 sites d'exécution masqués (+ 2 en test), aucun oubli.
2. Il reste **trois** lancements non masqués qui, depuis Pilot (application GUI,
   sans console), ouvrent réellement une fenêtre de console : `gds.rs:1502`,
   `gds.rs:1539` et `web_server.rs:1361` — plus un artefact du terminal intégré
   (`lib.rs:1797/1803`) qui est voulu.
3. Le défaut structurel qui explique qu'un clignotement puisse **réapparaître**
   n'importe quand : la constante `CREATE_NO_WINDOW` existe en **5 copies** et le
   drapeau est écrit **en dur** (`0x08000000`) à 3 endroits ; aucun test global ne
   verrouille « tout lancement Windows est masqué » (seul
   `src/js/voix-locale.test.js:277` vérifie – pour `tts_local.rs` seulement – que
   le mot `CREATE_NO_WINDOW` est présent).

---

## 1. Méthode

### 1.1 Lecture (commandes utilisées, sans exécution de l'application)

```bash
rg -n "Command::new|CommandBuilder::new" src-tauri/src gds-core/src gds-server/src
rg -c "\.spawn\(\)|\.output\(\)|\.status\(\)"  src-tauri/src gds-core/src gds-server/src
grep -rn "creation_flags" src-tauri/src/*.rs gds-core/src/*.rs
grep -rn "0x08000000"      src-tauri/src/*.rs gds-core/src/*.rs
sed -n '<n>,<m>p' <fichier>            # relecture du contexte de chaque site
git log --oneline -S "creation_flags"  # historique des masques
```

Inventaire : **56 occurrences de `Command::new`** (dont 8 en commentaire) dans
18 fichiers, et **29 sites réellement lancés** (`spawn`/`output`/`status`) côté
Rust. Le crate `gds-server` n'exécute aucun processus (les 90 correspondances
`\.status\(\)` y sont des codes HTTP).

### 1.2 Banc d'essai (hors du projet)

Trois essais dans `%LOCALAPPDATA%\Temp\wintest2` (aucun fichier du projet touché) :
un **détecteur** PowerShell qui énumère les fenêtres visibles de classe
`ConsoleWindowClass` toutes les 50 ms, et un **déclencheur**.

| Essai | Déclencheur | Fenêtre console visible ? |
|---|---|---|
| A | parent héritant d'une console **sans fenêtre** (`CREATE_NO_WINDOW`) → `powershell` lancé **sans** drapeau | **non** (`BASELINE 0` / `END`) |
| B (témoin +) | `powershell Start-Process cmd.exe -WindowStyle Normal` | **oui** (`WINDOW_COUNT 1` puis `0`) |
| C | **parent GUI sans console** (`wscript.exe`) → `cmd /c ping …` **sans** drapeau | **oui** (`WINDOW_COUNT 1` puis `0`) |

**Deux faits mesurés, qui structurent tout le reste :**

- **F1** — Pilot (Tauri = sous-système GUI, **sans console**) qui lance un
  programme console **sans** `CREATE_NO_WINDOW` ⇒ **une vraie fenêtre console
  apparaît** (essai C). C'est le clignotement observé.
- **F2** — un processus lancé **avec** `CREATE_NO_WINDOW` obtient une console
  **sans fenêtre**, et **toute sa descendance** reste sans fenêtre, même si
  elle-même ne met pas le drapeau (essai A). Le masquage est donc **transitif** :
  masquer le `pi` d'une session suffit à masquer tous les outils que `pi` lance.

Complément : le paquet installé `@earendil-works/pi-coding-agent` (1.4.0) pose
lui-même `windowsHide:!0` sur **tous** ses lancements
(`dist/bundle/chunks/chunk-MM3LKT73.js:723,886`,
`chunk-N43LRJ4N.js:3`, `chunk-RISAW7OQ.js:2,9`) — double protection, donc le CLI
`pi` **ne peut pas** être la source des fenêtres noires. Candidat écarté, avec
preuve.

---

## 2. Où le masque est déjà en place (20 sites d'exécution, 13 fichiers)

Tous ces sites appellent `creation_flags(CREATE_NO_WINDOW)` sur la **même**
variable `Command` que celle lancée :

| Site (lancement) | Ce qui est lancé | Masque |
|---|---|---|
| `gds-core/src/proc.rs:21` | `run_captured` (git, ssh, cmd GDS…) | `:25` |
| `gds-core/src/proc.rs:63` | `run_captured_full` | `:67` |
| `src-tauri/src/code_check.rs:144` | `where` (détection d'outil) | `:146` |
| `src-tauri/src/code_check.rs:160` | `run_command` (lint/tests) | `:163` |
| `src-tauri/src/code_check.rs:368` | `run_command_timed` (auto-test E2) | `:372` |
| `src-tauri/src/help.rs:608` | `pi --mode rpc` (réponse sur la doc) | `:617` (littéral) |
| `src-tauri/src/laya.rs:496` | service Laya (`node`) | `:519` |
| `src-tauri/src/laya_download.rs:273` | node (téléchargement) | `:287` |
| `src-tauri/src/lib.rs:2035` | **son de notification** (`powershell -File notify.ps1`) | `:2046` |
| `src-tauri/src/mcp_config.rs:835` | serveur MCP (stdio) | `:846` |
| `src-tauri/src/pi_update.rs:148` | `pi update --self` | `:154` |
| `src-tauri/src/plface.rs:366` | `tasklist` (identité d'un pid) | `:371` |
| `src-tauri/src/plface.rs:498` | `taskkill` | `:503` |
| `src-tauri/src/plface.rs:640` | PLface (détaché) | `:656` |
| `src-tauri/src/rpc_manager.rs:63` | **`pi --mode rpc` = toutes les sessions d'agents** | `:100` |
| `src-tauri/src/rpc_manager.rs:515` | `pi --mode rpc` (PDF → MD) | `:525` (littéral) |
| `src-tauri/src/tailscale.rs:80` | `tailscale version` | `:83` |
| `src-tauri/src/tailscale.rs:113` | `tailscale` (chemin connu) | `:116` |
| `src-tauri/src/tailscale.rs:131` | `tailscale` (serve) | `:134` |
| `src-tauri/src/tts_local.rs:531` | moteur Piper (voix locale) | `:547` |

Sites de **test** masqués : `agent_service.rs:5048` (`:5053`),
`laya.rs:1582` (`:1590`). Les lancements de test `plface.rs:1038/1050/1155` et
`agent_service.rs:5209` ne sont pas masqués : c'est sans effet, ils ne sont
jamais exécutés par l'application (voir §4).

Le chemin « mission d'agent » passe **intégralement** par `rpc_manager.rs:63` :
`agent_service.rs` appelle `rpc_manager::spawn_and_start` à **6 endroits**
(`:2569, :2961, :3343, :3495, :3647, :3842`) — aucun autre lancement de `pi`
n'existe dans le produit. **Le lancement des sessions d'agents ne peut donc pas
produire de fenêtre noire.**

---

## 3. Causes classées par probabilité

### P1 — Élévation PowerShell du GDS (2 sites, non masqués) — probabilité **la plus forte**

**Preuve** : `src-tauri/src/gds.rs:1502`

```rust
let out = std::process::Command::new("powershell")   // :1502
    .args(["-NoProfile", "-Command", script])        // script = Start-Process -Verb RunAs -Wait -WindowStyle Hidden
    .output()                                        // :1506
```

et `src-tauri/src/gds.rs:1539` (même forme, `-EncodedCommand`).
Aucun `creation_flags` dans les deux fonctions (`escalate_service_trust` /
`escalate_system_service_trust`).

**Pourquoi c'est le plus probable** : (a) `gds_enabled: true` sur le poste du
propriétaire (config réelle), (b) ces deux lancements se produisent sur une
action **de fond** du produit (pose de la confiance Git du compte de service,
`gds_service_trust`, `gds.rs:1599`), sans qu'aucune fenêtre ne soit attendue par
l'utilisateur, (c) conformément à F1, l'outer `powershell` (non masqué) **ouvre
une fenêtre** ; le `-WindowStyle Hidden` du script ne cache que le processus
**élevé**, pas l'outer `powershell` qui, lui, clignote pendant toute la durée de
l'invitation UAC.

**Correctif minimal (une phrase)** : appliquer `CREATE_NO_WINDOW` aux deux
`Command::new("powershell")` (une ligne chacun, dans un bloc `#[cfg(windows)]`).
**Lignes** : 6 (2×3). **Risque de régression** : **très faible** — le drapeau ne
change que la fenêtre, pas l'élévation ni `-Wait` ; `output()` continue de
capturer stdout/stderr.

### P2 — Exécution d'une commande projet par le web distant — probabilité moyenne

**Preuve** : `src-tauri/src/web_server.rs:1361`

```rust
let mut cmd = std::process::Command::new(prog);   // prog = "cmd" (Windows), args "/C"
…
let mut child = cmd.spawn()                        // :1365
```

Aucun `creation_flags` dans la fonction (`shell_prog_args()` à `:1517`). Depuis
F1, un `cmd /C` lancé par Pilot **clignote**.

**Probabilité moyenne** : il faut que l'exécution de commandes soit déclenchée
depuis le web distant (bouton « ▶ » d'une commande de `.pilot` via le navigateur,
`web_server.rs:1267`). Rare en usage local, mais réel si le propriétaire pilote
depuis un autre poste/téléphone.

**Correctif minimal** : ajouter `CREATE_NO_WINDOW` sur le `Command` avant
`spawn()` (bloc `#[cfg(target_os = "windows")]`). **Lignes** : 5.
**Risque** : faible ; les sorties sont déjà capturées par pipes (`stream_pipe`),
le drapeau ne les affecte pas.

### P3 — Terminal intégré : l'`cmd.exe` intermédiaire clignote — probabilité faible (artefact connu)

**Preuve** : `src-tauri/src/lib.rs:1797`

```rust
std::process::Command::new("cmd.exe")
    .args(["/c", "start", "cmd.exe", "/k", cmd])   // :1798
    .spawn()                                       // :1800
```

Non masqué **volontairement** (la fenêtre du terminal doit s'ouvrir), mais l'`cmd`
**intermédiaire** est un programme console lancé sans drapeau : il ouvre donc sa
propre fenêtre avant que `start` n'ouvre la vraie (même chose pour `:1803`
quand `runDefault` est vrai). C'est un artefact réel, mais l'utilisateur voit
surtout le terminal demandé ; il n'est pas corrélé aux missions
(`auto_run_command: false` dans la config).

**Correctif minimal** : masquer **seulement** l'`cmd` intermédiaire
(`creation_flags` sur `:1797/1803`) et laisser `start` ouvrir la fenêtre finale.
**Lignes** : 8. **Risque** : **moyen** — dépend du comportement de `start`
lancé depuis un processus sans console ; à vérifier par un essai manuel sur les
trois plateformes (Windows seulement concerné).

### P4 — Une copie de la constante perdue à la prochaine évolution — **risque**, pas cause actuelle

- 5 définitions : `lib.rs:27`, `rpc_manager.rs:17`, `mcp_config.rs:50`,
  `tailscale.rs:25`, `gds-core/src/proc.rs:15`.
- 3 littéraux en dur : `help.rs:617`, `rpc_manager.rs:525`,
  `agent_service.rs:5053` (test).
- Aucun test ne vérifie globalement « tout lancement Windows est masqué ».

C'est ce qui permet à un futur lancement (ou à un refactor) de réintroduire un
clignotement sans que rien ne le signale. Traité en §5.

---

## 4. Causes écartées (avec la preuve)

| Candidat | Verdict | Preuve |
|---|---|---|
| Sessions d'agents (`pi`) | **écarté** | `rpc_manager.rs:63` masqué `:100` ; 6 appels seulement, tous par `spawn_and_start` |
| Outils lancés par `pi` (`bash`, `git`, `npm`…) | **écarté** | F2 (masquage transitif, essai A) **et** `windowsHide:!0` dans le CLI `pi` |
| Son de notification `notify.ps1` | **écarté** | `lib.rs:2035` masqué `:2046` ; `notify.ps1` ne lance **aucun** processus (`System.Media.SoundPlayer`) |
| Voix locale Piper | **écarté** | `tts_local.rs:531` masqué `:547` |
| Téléchargement de voix (Rust) | **écarté** | `tts_local_download.rs` : HTTP + `zip` en mémoire, aucun `Command` |
| Serveur MCP | **écarté** | `mcp_config.rs:835` masqué `:846` |
| Service Laya / node | **écarté** | `laya.rs:496` masqué `:519`, `laya_download.rs:273` masqué `:287` |
| GDS : git / ssh / cmd | **écarté** | `gds-core/src/proc.rs:21/63` masqués `:25/:67` ; `gds-core/src/ssh.rs:187` passe par `run_captured` |
| PLface (`tasklist`, `taskkill`, exe) | **écarté** | `plface.rs:366/498/640` masqués ; `plface_autostart_enabled: false` dans la config |
| Notification desktop native | **écarté** | `notify-rust 4.18.0` = WinRT **dans le processus** (`src/windows.rs`), aucun `Command::new` |
| `open_in_browser` (liens, mailto) | **écarté** | crate `open 5.x`, `src/windows.rs` : `cmd /c start … ` **avec** `CREATE_NO_WINDOW` |
| `open_explorer` | **écarté** | `lib.rs:2857` → `explorer` = application GUI, pas de console |
| Terminal intégré (`portable-pty`) | **écarté** | `terminal.rs:109` `CommandBuilder` (ConPTY), pas de `std::process` |
| `gds-core/src/service_control.rs:262` (`supervisorctl`) | **écarté** | conteneur Linux du serveur GDS, jamais exécuté par le poste |
| `gds-core/src/git.rs:211` (`chown`) | **écarté** | `#[cfg(unix)]` |
| Tests Rust (`agent_service.rs:5048/5209`, `laya.rs:1007/1569/1582`, `plface.rs:1038/1050/1155`, `laya_download.rs:443`) | **écarté** | lancés par `cargo test`, jamais par l'application (ceux de `plface.rs`/`agent_service.rs:5209` ne portent même pas le drapeau : sans conséquence) |

---

## 5. Cause structurelle et correctif recommandé

**Constat** : la règle « toute fenêtre de console doit être masquée » est
aujourd'hui respectée par **discipline**, pas par **construction** : 5 copies
d'une même constante, 3 littéraux, et un seul test partiel.

**Correctif recommandé (un seul endroit, pas sept)** :

1. `gds-core/src/proc.rs` — exporter le masque à côté de `run_captured` :
   ```rust
   #[cfg(windows)] pub fn hide_console(cmd: &mut std::process::Command) { cmd.creation_flags(CREATE_NO_WINDOW); }
   #[cfg(not(windows))] pub fn hide_console(_: &mut std::process::Command) {}
   ```
2. `src-tauri/src/lib.rs` — même helper `pub(crate) fn hide_console(…)` à côté
   de `CREATE_NO_WINDOW:27` (les deux crates compilent séparément, c'est déjà le
   cas assumé de la constante).
3. Remplacer les 5 constantes locales + les 3 littéraux par ce helper.
4. L'appliquer aux 3 sites non masqués retenus (P1, P2) — `lib.rs:1797/1803`
   seulement après essai manuel (P3).

**Volume** : ~35 lignes au total (2 helpers + 6 appels + suppression des copies).
**Risque de régression** : faible pour P1/P2 (le drapeau ne touche ni les pipes
ni le code de retour), moyen pour P3 (comportement de `start`).

---

## 6. Test qui manque (et où l'ajouter)

Aucun test ne verrouille globalement le comportement : le seul existant est
`src/js/voix-locale.test.js:277` (`expect(rust).toMatch(/CREATE_NO_WINDOW/)`),
limité à `tts_local.rs` et à la **présence** du mot, pas à son **appariement**
avec un lancement.

**À ajouter** : `src/js/fenetres-noires-lancements.test.js` (Vitest, ~110 lignes,
aucune dépendance, exécuté par `npm test` sur les trois OS — c'est le style déjà
en place pour verrouiller un source, cf. `scripts/release-workflow.test.js`).

Contenu attendu :

1. Pour chaque `src-tauri/src/*.rs` et `gds-core/src/*.rs`, trouver les
   `Command::new(` / `CommandBuilder::new(` **hors commentaires**.
2. Pour chacun, considérer la fenêtre de ±25 lignes comme « fonction
   englobante » et **exiger** la présence de `creation_flags(` **ou** l'appartenance
   à une **liste d'exceptions motivées** (chemin + raison) :
   - `lib.rs` terminal (`:1797`, `:1803`) et `macOS/Linux` (`:1820`–`:1848`) ;
   - `lib.rs` `explorer`/`open`/`xdg-open` (`:2857`–`:2871`) : GUI ;
   - `gds-core/src/git.rs` `chown` et `service_control.rs` : `#[cfg(unix)]` ;
   - blocs `mod tests` (tests Rust) et fichiers de test.
3. Refuser tout littéral `0x08000000` **hors** de la définition de la constante
   (`expect(literals).toHaveLength(0)`), ce qui pousse mécaniquement vers le
   helper unique — verrouille §5.
4. Normaliser la lecture du source (`.replace(/\r\n/g, "\n")`) : **obligatoire**
   (AGENTS.md §3.4, piège CRLF du runner Windows) ; les ancres du test ne doivent
   pas contenir `\n` littéral.

Vérification ensuite : `npx vitest run src/js/fenetres-noires-lancements.test.js`
puis `npm test`.

---

## 7. Hors périmètre (non traité, comme demandé)

- Aucun fichier de code modifié, aucun script supprimé.
- Aucun test complet lancé (`npm test`, `cargo test --workspace` non exécutés).
- Mode Vocal, cercle, délai d'envoi, seuils de coupure : **non touchés**.
- Outil de listage des sessions d'agents : **jamais appelé**.
- Le binaire **PLface** (`G:\IA_PL\PLface`) et le service **Laya**
  (`G:\IA_PL\LayaPL`) sont hors de ce dépôt : s'ils lancent eux-mêmes des
  programmes console sans masque (ils sont GUI), une vérification chez eux serait
  nécessaire — mais `plface_autostart_enabled: false` écarte PLface pour ce poste.
- Si le propriétaire observe un clignotement **à chaque** lancement de mission,
  alors la cause n'est pas dans ce dépôt (les 22 sites du chemin mission sont
  masqués) : la première vérification à faire est la **version installée**
  (un binaire antérieur à `81f182e`, 2026-07-22, et `ee4708b`, 2026-08-25,
  clignoterait), puis P1/P2 ci-dessus.

---

## 8. Synthèse actionnable

| Priorité | Site | Lignes à changer | Risque |
|---|---|---|---|
| 1 | `src-tauri/src/gds.rs:1502` + `:1539` | 6 | très faible |
| 2 | `src-tauri/src/web_server.rs:1361` | 5 | faible |
| 3 | `src-tauri/src/lib.rs:1797` + `:1803` (après essai manuel) | 8 | moyen |
| 4 | Helper unique (§5) + test global (§6) | ~35 + ~110 | faible |
