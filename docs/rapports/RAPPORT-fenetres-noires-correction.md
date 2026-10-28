# Rapport de correction — fenêtres noires (lancements de processus)

Suite de `docs/rapports/RAPPORT-fenetres-noires.md` (diagnostic). Objet : **aucun
processus lancé par Pilot ne peut plus faire clignoter une fenêtre de console**, et
une **garde automatique** empêche la réintroduction du défaut.

## 1. Ce qui est corrigé

| # | Défaut | État |
|---|---|---|
| Point unique | `CREATE_NO_WINDOW` recopié **5 fois** + **3** littéraux `0x08000000` | **corrigé** : **1** seule définition (`gds-core/src/proc.rs`) |
| P1 | `src-tauri/src/gds.rs` : élévation `powershell` lancée **sans masque** (2 sites) | **corrigé** |
| P2 | `src-tauri/src/web_server.rs` : commande projet `cmd /C` du web distant **sans masque** | **corrigé** |
| P3 | `src-tauri/src/lib.rs` : `cmd.exe` intermédiaire du terminal intégré qui clignote avant `start` | **corrigé** (et vérifié en conditions réelles, § 4) |
| Exceptions | lancements légitimement visibles, non marqués | **corrigé** : **11** marques `FENETRE-CONSOLE-EXCEPTION :` motivées, aucune silencieuse |
| Garde | seul `src/js/voix-locale.test.js` vérifiait la présence du drapeau, pour `tts_local.rs` uniquement | **corrigé** : `src/js/fenetres-noires-lancements.test.js` couvre **toutes** les sources Rust |

Aucun lancement supprimé, aucun chemin d'exécutable ni commande shell modifié.
Aucune dépendance ajoutée.

## 2. Le point unique : `gds_core::proc::hide_console`

```rust
// gds-core/src/proc.rs — SEULE définition du drapeau dans le dépôt
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn hide_console(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; cmd.creation_flags(CREATE_NO_WINDOW); }
    #[cfg(not(windows))]
    { let _ = cmd; }   // neutre : macOS/Linux n'ont pas de fenêtre de console
}
```

**Pourquoi le socle (`gds-core`) et non le desk ?** C'est le module le plus bas qui
peut porter le helper : `gds-core` ne dépend **pas** de Tauri (il est aussi compilé
par le serveur headless `gds-server`), donc le point unique est partageable et ne
crée aucun cycle. Le desk le réutilise via une seule ligne, dans `lib.rs` :

```rust
pub(crate) use gds_core::proc::hide_console;
```

tous les autres modules du desk (`code_check`, `gds`, `help`, `laya`,
`laya_download`, `pi_update`, `mcp_config`, `tailscale`, `rpc_manager`, `plface`,
`tts_local`, `agent_service`, `web_server`, `lib`) appellent désormais
`crate::hide_console(&mut cmd)`. Le socle l'appelle par `crate::proc::hide_console`
(`service_control.rs`).

Le masquage est **transitif** (prouvé au banc, diagnostic § 1.2 essai C) : masquer
un processus suffit pour toute sa descendance — d'où la suffisance d'un seul point
par lancement.

## 3. Sites avant / après

| Compteur | Avant | Après |
|---|---|---|
| Définitions du drapeau (`const`, littéraux `0x08000000`, `creation_flags`) | **8** (5 copies + 3 littéraux) | **1** (`gds-core/src/proc.rs`) |
| Sites `Command::new` en code de production (desk + socle + serveur) | 38 | 38 (aucun supprimé) |
| Sites masqués par le point unique | 27 | 27 |
| Sites en exception marquée et motivée | 0 | 11 |
| Sites réels sans masque (fenêtre parasite possible) | **3** (P1 ×2, P2) + 1 artefact (P3) | **0** |

Les 11 exceptions sont toutes des lancements dont la fenêtre est **voulue** par
l'utilisateur ou sans objet hors Windows, chacune avec sa raison sur la même ligne :

- `lib.rs` : `osascript` / `open` / `sh` / émulateurs de terminal (macOS, Linux) ;
- `lib.rs` : `explorer` / `open` / `xdg-open` (ouvrir le dossier dans le
  gestionnaire de fichiers — la fenêtre EST le service demandé) ;
- `plface.rs` : `ps` (macOS/BSD) et `kill` (hors Windows) — `#[cfg]`, sans drapeau ;
- `gds-core/src/git.rs` : `chown` (`#[cfg(unix)]`) ;
- `gds-core/src/service_control.rs` : `/bin/sh` détaché (Unix, `supervisord`) ;
- `agent_service.rs` : helper de test non-Windows.

## 4. P3 — le terminal intégré : ce qui a été fait et comment le revérifier

**Ce qui a été fait.** Dans `open_system_terminal` (branche Windows), le `cmd.exe`
intermédiaire (`/c start cmd.exe /k "<cmd>"`) est construit dans une variable
`launcher`, masqué par `hide_console(&mut launcher)`, puis lancé. Le masque ne
s'applique **qu'au porteur** `start` : la fenêtre finale du terminal est créée par
`start` lui-même, donc elle s'ouvre normalement (le masquage ne se propage pas
« en avant » vers une fenêtre que `start` demande explicitement).

**Vérification en conditions réelles (faite, reproductible).** Banc hors
application, pour ne pas dépendre d'un build complet :

1. un lanceur `#![windows_subsystem = "windows"]` (équivalent Pilot : pas de
   console) qui exécute `cmd.exe /c start cmd.exe /k "ping -n 4 127.0.0.1 & exit"`,
   avec ou sans `creation_flags(0x08000000)` selon l'argument ;
2. un détecteur PowerShell qui échantillonne toutes les 50 ms pendant 8 s le
   nombre de fenêtres `cmd` **visibles** (`MainWindowHandle -ne 0`) ;
3. résultat : **3 exécutions sur 3** avec le masque → `MAX_FENETRES_VISIBLES=1`
   (la fenêtre du terminal s'ouvre bien, une seule), aucune fenêtre
   intermédiaire.

**À revérifier par le propriétaire après installation** (le geste métier, 30 s) :

1. ouvrir un projet, clic sur « Ouvrir un terminal » ;
2. attendre 2 s : **une** fenêtre de terminal doit apparaître, avec l'invite
   (`cmd.exe` sous Windows, `$SHELL` ailleurs) dans le dossier du projet ;
3. taper une commande (`dir` / `ls`), vérifier la sortie ;
4. fermer la fenêtre (`exit` ou la croix) : Pilot ne doit pas protester ni rester
   bloqué ;
5. pendant l'ouverture, **aucun** rectangle noir ne doit clignoter avant la
   fenêtre.

Si ce contrôle échouait chez le propriétaire, la marche arrière est locale : retirer
la seule ligne `hide_console(&mut launcher)` de `open_system_terminal` (le reste de
la correction n'en dépend pas).

## 5. La garde automatique

`src/js/fenetres-noires-lancements.test.js` (Vitest) balaie **tous** les `.rs` de
`src-tauri/src`, `gds-core/src`, `gds-server/src` et exige, pour chaque
`Command::new` hors commentaires et hors modules de test Rust :

- soit un appel à `hide_console(…)` dans la fonction englobante ;
- soit une marque `FENETRE-CONSOLE-EXCEPTION : <raison>` sur une ligne (la raison
  est **obligatoire** : une marque nue fait échouer le test).

Elle refuse en outre :

- tout littéral `0x08000000` et tout `creation_flags(` **hors** de
  `gds-core/src/proc.rs` (c'est ce qui empêche une future copie du drapeau) ;
- la disparition du point unique, de sa branche neutre `#[cfg(not(windows))]`, ou
  du réexport `pub(crate) use gds_core::proc::hide_console;` dans `lib.rs` ;
- un balayage vide (garde anti-faux-vert : ≥ 40 fichiers, ≥ 25 sites trouvés) ;
- une régression des trois causes du rapport (P1, P2, P3 vérifiées nommément).

La lecture **normalise les fins de ligne** (`.replace(/\r\n/g, "\n")`) : sans cela
le test passerait en local et échouerait sur un runner Windows en CRLF
(`.pi/skills/quality-gate/SKILL.md` § 3.4).

**Preuve que la garde mord** (faite, puis restaurée) — masque retiré de P2 dans
`web_server.rs` :

```
$ npx vitest run src/js/fenetres-noires-lancements.test.js
   × fenêtres noires — chaque lancement est masqué ou exception motivée > aucun lancement sans `hide_console` ni marque d'exception
     → expected [ 'src-tauri/src/web_server.rs:1361' ] to deeply equal []
   × ... > les trois causes du rapport sont corrigées (P1, P2, P3)
 Tests  2 failed | 6 passed (8)
```

Masque remis → `Tests 8 passed (8)`.

## 6. Ce qui est délibérément hors périmètre

- `src-tauri/src/terminal.rs` (`CommandBuilder::new` de `portable-pty`) : le
  terminal intégré passe par **ConPTY**, qui ne crée pas de fenêtre de console
  (c'est un pseudo-terminal in-process). Rien à masquer.
- Les sites d'exécution des missions d'agents étaient **déjà** masqués (20 sites) :
  ils passent par le point unique désormais, sans changement de comportement.
- Aucun réglage utilisateur, aucun mode d'écran, aucune fonctionnalité vocale,
  aucun seuil n'a été touché.

## 7. Commandes de vérification (à relancer par le propriétaire)

```bash
npx vitest run src/js/fenetres-noires-lancements.test.js   # la garde seule
npx vitest run                                             # suite front
cargo test -p gds-core                                     # socle (point unique)
cargo test -p gds-server                                   # serveur headless
cargo test --manifest-path src-tauri/Cargo.toml --lib      # desk (Tauri)
cargo test --workspace                                     # tout, si le temps le permet
```

Compteurs réels de cette correction (mesurés sur le poste de dev, 2026) :

```
cargo test -p gds-core                                   139 passed, 11 ignored, 0 failed
cargo test -p gds-server                                  34 passed, 0 failed
cargo test --manifest-path src-tauri/Cargo.toml --lib    792 passed,  1 ignored, 0 failed
cargo test --workspace                                   965 passed, 12 ignored, 0 failed (6 suites)
npx vitest run                                          3963 passed, 0 failed
```

La compilation ne produit **aucun** nouvel avertissement (ni import inutilisé :
les `use std::os::windows::process::CommandExt;` des modules concernés ont été
retirés avec les constantes locales).

Une assertion **existante** a dû être mise à jour, pas supprimée :
`src/js/voix-locale.test.js` vérifiait que `tts_local.rs` contient
`CREATE_NO_WINDOW` — l'invariant visé (« le moteur local se lance sans fenêtre
noire ») est désormais tenu par `hide_console(&mut cmd)`, et c'est cela que le test
exige maintenant (il aurait sinon interdit le point unique).

## 8. Fichiers touchés

Socle : `gds-core/src/proc.rs` (point unique), `gds-core/src/service_control.rs`,
`gds-core/src/git.rs`.

Desk : `lib.rs` (réexport + P3 + son de notification + exceptions macOS/Linux),
`gds.rs` (P1), `web_server.rs` (P2), `agent_service.rs`, `code_check.rs`,
`help.rs`, `laya.rs`, `laya_download.rs`, `mcp_config.rs`, `pi_update.rs`,
`plface.rs`, `rpc_manager.rs`, `tailscale.rs`, `tts_local.rs`.

Tests : `src/js/fenetres-noires-lancements.test.js` (nouveau),
`src/js/voix-locale.test.js` (assertion obsolète remplacée, invariant conservé).

Documentation : `spec_pilot.md` § 2 (règle du point unique + garde), `AGENTS.md`
(navigation), `docs/rapports/RAPPORT-fenetres-noires.md` (diagnostic, déplacé
depuis la racine) et le présent rapport de correction.
