# Rapport — finitions de l'interface (Fermer en sombre, etats de texte, nom de la version de test)

## Fichiers touches (2)
- `src/css/style.css` : bloc « Finitions de contraste » ajoute apres celui du lot 0.4. Aucun
  jeton de palette modifie, aucune couleur en dur, aucun selecteur existant reecrit.
- `src-tauri/src/lib.rs` : `window_title()` (source unique du nom affiche),
  `resolve_window_title()`, titre pose au demarrage (`setup`), a la fermeture de projet et
  via `set_window_title`.

## Point 1 — croix « Fermer » en theme sombre (plancher 3:1), avant -> apres
| Sous-theme | Avant | Apres | Fond de survol |
|---|---|---|---|
| Nord | **2,11** | **3,42** | `--surface-1` (#272c36) |
| One Dark | 3,30 | 3,30 (inchange) | `--surface-3` |
| Dracula | 3,42 | 3,42 (inchange) | `--surface-3` |
| Tokyo Night | 4,66 | 4,66 (inchange) | `--surface-3` |

La croix reste `--danger`, le fond reste un gris de surface (le test interdisant le fond rouge passe).

## Point 2 — etats de texte entre 3 et 4,5 dans deux themes clairs, avant -> apres
| Sous-theme / etat | Avant | Apres |
|---|---|---|
| Solarized Light — survol de la bande | 3,28 | **4,39** (`--text-secondary` sur `--surface-2`) |
| Solarized Light — croix Fermer au survol | 3,41 | 3,77 (effet de bord du meme fond) |
| Tokyo Night Day — repos de la bande | 3,62 | **4,52** (`--text-primary` sur `--bg-app`) |
| Tokyo Night Day — survol de la bande | 4,05 | **4,84** (`--text-primary` sur `--surface-2`) |
| Tokyo Night Day — croix Fermer au survol | 3,22 | 3,22 (inchange) |

Reste sous 4,5 : Solarized Light au survol (4,39) — il faudrait un `--text-secondary` plus
sombre, jeton partage par toute l'application : non touche. Proposition : assumer 4,39
(au-dessus du plancher non textuel 3:1) ou le descendre dans `.theme-solarized` plus tard.

## Point 3 — la version de test se distingue de la version installee
- Source unique : `window_title()` dans `src-tauri/src/lib.rs` (juste avant la commande
  `set_window_title`). Critere : `cfg!(debug_assertions)`, le meme que celui qui decale le
  port web en dev (issue #25).
- Pose en trois endroits, tous par cette fonction : au demarrage (`setup`, apres la
  suppression du cadre systeme), a la fermeture de projet (`close_project`, qui ecrivait
  « Pilot » en dur) et dans `set_window_title` (`resolve_window_title`).
- Developpement : « Pilot (dev) ». Installee : « Pilot ». Aucun identifiant, cablage ni
  libelle de bouton modifie ; `tauri.conf.json` reste « Pilot ».

## Verifications
1. `npm test` : **164 fichiers, 2858 tests passes, 0 echec**.
2. `cargo test --manifest-path src-tauri/Cargo.toml --lib` : **722 passes, 1 ignore, 0 echec**.
3. `cargo check --manifest-path src-tauri/Cargo.toml` : OK (aucun avertissement sur les ajouts).
4. Contrastes ci-dessus recalcules depuis les jetons lus dans `src/css/style.css`.

## Non verifie (sans ecran)
Rendu visuel des trois etats et nom affiche dans la barre des taches des deux versions cote a cote.
