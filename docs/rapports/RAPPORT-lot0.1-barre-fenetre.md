# Rapport — lot 0.1 : bande de fenetre (controle, doublons, documentation)

## Constat d'entree
Le lot 0.1 est **deja applique** (code du socle dans `c277f93`, puis `b40c96b` lot 0.2,
`efe1cfe` lot 0.4) et **deja clos** par le commit `4778198` (Q2 « Pilot » + doc §8.3).
Cette passe est donc un **controle preuve a l'appui**, pas une reprise.

## Les cinq controles demandes (fichier:ligne)
| # | Controle | Resultat |
|---|---|---|
| 1 | Une seule bande, exactement trois boutons | **Conforme.** `index.html:24` (`#window-bar`) — 1 occurrence ; `index.html:25` (`#window-controls`) ; `index.html:26` `#win-min`, `:29` `#win-max`, `:32` `#win-close` — 1 occurrence chacun. Aucun autre bouton dans la bande. Premier enfant de `body`, avant `#app-body` (`:40`) |
| 2 | Quatre permissions, une seule fois chacune | **Conforme, aucune manquante.** `src-tauri/capabilities/default.json:7` `core:window:allow-minimize`, `:8` `allow-toggle-maximize`, `:9` `allow-close`, `:10` `allow-start-dragging` (chacune comptee a 1) |
| 3 | Fenetre sans cadre systeme / macOS garde son cadre | **Conforme.** `src-tauri/src/lib.rs:3430-3434` : `#[cfg(not(target_os = "macos"))] { win.set_decorations(false); }` — une seule occurrence de `set_decorations`. `tauri.conf.json` ne contient **ni** `decorations` **ni** `titleBarStyle` (`app.windows[0]`, `:39-50`) |
| 4 | Pastille d'activite sous la bande, visible et cliquable | **Conforme.** `src/css/style.css:1525` (`#agent-activity`), `:1532` `top: calc(var(--window-bar-height) + 8px)` ; la bande est en `z-index: 100001` (`:91`) mais la pastille est **sous** elle geometriquement : aucun recouvrement |
| 5 | Regles en double / restes d'une premiere tentative | **Aucun.** `#window-bar` : 1 bloc (`style.css:77`). `--window-bar-height: 32px` : 1 seule definition (`:193`, `:root`), 3 consommateurs (`:79`, `:109`, `:1532`). Aucun `#window-bar` dans une media query. Aucun reste `titlebar` / `title-bar` / `window-title` / `data-tauri-drag-region` dans `index.html`, `src/css/`, `src/js/` |

## Ce qui a ete corrige
**Rien.** Les cinq controles sont conformes au document de conception : corriger
aurait introduit un ecart. Aucun identifiant renomme (`#window-bar`, `#win-min`,
`#win-max`, `#win-close` intacts), aucun cablage touche (`src/js/window-controls.js`
appele une fois, `src/js/main.js:35` import + `:381` `initWindowControls()`).

## Ce qui manquait — et qui etait deja fait
- Documentation §8.3 : faite par `4778198`. `README.md:17-20` (section « Barre de
  fenetre »), `README.md:39` « Titre de fenetre : `Pilot` — jamais le chemin »,
  `README.md:552` `set_window_title` = « toujours `Pilot` » ; `spec_pilot.md:13`
  (bande de 32 px, 3 boutons, `close()` jamais `destroy()`, 4 permissions, pastille
  decalee) et `spec_pilot.md:15` (nom systeme toujours `Pilot`, jamais le chemin).
- Decision du proprietaire appliquee : le nom systeme est **`Pilot`** seul —
  `src/js/sidebar.js:496` et `:534` (`invoke("set_window_title", { title: "Pilot" })`),
  `src-tauri/src/lib.rs:2877` (`set_title("Pilot")`). Plus de chemin ni de dossier.
- Aucun document de `docs/` modifie ; aucun `<!-- HELP:* -->` ne parlait de la barre
  de titre (verifie dans `help/overview.md` et `help/handbook.md`).

## Tests (resultat exact)
- `npm test` : **163 fichiers passes / 163**, **2834 tests passes / 2834**, **0 echec**.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` : **722 passes, 1 ignore,
  0 echec** (avertissement `sqlx-postgres v0.8.0` sans rapport).

## Commit
Aucun nouveau commit : rien n'a ete modifie (code et documentation deja commités par
`4778198`). `git log -1 --oneline` -> `4778198 feat(ui): lot 0.1 — bande de fenetre
integree et boutons systeme`. Ce rapport reste **non committe**.

## Ce que seul un essai a l'ecran peut confirmer
1. Glissement de la fenetre depuis la bande (hors boutons).
2. Double-clic sur la bande = agrandir / restaurer, icone synchronisee.
3. Redimensionnement par les 4 bords et 4 coins d'une fenetre **sans cadre**.
4. `Alt+F4` (doit passer par la confirmation de fermeture, pas `destroy()`).
5. Agrandir / Restaurer au clic : etat lu au demarrage (fenetre agrandie d'office).
6. `Win` + fleches (perdu avec la barre systeme — lot 0.5, hors mission).
7. Rendu macOS (feux natifs) et Linux sans cadre — lot 0.6, non verifie ici (aucune machine).
