# Rapport — publication de Pilot v0.5.0

Rédigé par le publieur. Aucune publication n'a été décidée de sa propre initiative :
l'accord du propriétaire pour CETTE version était donné avant le début du travail.

## Version publiée

- Version : **0.5.0** (précédente installée : 0.4.46 — dernier chiffre incrémenté, aucun recul).
- Bump identique dans les 4 fichiers : `package.json`, `src-tauri/Cargo.toml`,
  `src-tauri/tauri.conf.json`, `Cargo.lock`.
- `Cargo.lock` : **seule** la ligne du paquet `pilot` a changé (`git diff Cargo.lock` =
  1 insertion / 1 suppression, dans le bloc `name = "pilot"`). Le `0.4.46` restant
  appartient à la dépendance `tar` et n'a pas été touché. Aucun remplacement global.
- Changelog : `release-notes/v0.5.0.md` (français, orienté utilisateur, 3 catégories), non soumis à validation.

## Commit et étiquette

- Commit de publication : `5a230eb` « chore: bump version to 0.5.0 » — 7 fichiers
  (4 fichiers de version, `release-notes/v0.5.0.md`, `README.md`, `spec_pilot.md`).
- `main` poussé : `origin/main` = `5a230eb…` (18 commits depuis `v0.4.46`).
- Étiquette **`v0.5.0`** créée et poussée : `refs/tags/v0.5.0` → `5a230eb…` (vérifié par
  `git ls-remote` après le push). Elle n'existait ni en local ni sur GitHub avant.

## Contrôles (exécutés avant tout push)

| Contrôle | Commande | Résultat |
|---|---|---|
| Tests frontend | `npx vitest run` | **PASS (2917) FAIL (0)** — 168 fichiers de test (162 `src/js` + 6 `scripts`), conforme à l'attendu |
| Tests Rust | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **722 passed, 1 ignored** (compilation `pilot v0.5.0` réussie → verrou Cargo sain) |
| Fabrication frontend | `npm run build` | réussi (`dist/` produit ; seuls des avertissements de découpage de chunks) |

## Serveur GDS

- Aucun changement de `gds-core/`, `gds-server/` ni du pont GDS desktop entre
  `v0.4.46` et `v0.5.0` (`git diff --stat` vide) → **image du serveur non reconstruite**,
  volontairement.

## Publication automatique

- Projet **non basculé** sur le GDS (`.pilot/gds.json` → `"enabled": false`) : publication
  GitHub autorisée, vérifiée juste avant le commit et le push.
- Workflow `release` déclenché par l'étiquette : run **#164**, id `40182504898`,
  « in_progress » au moment du rapport —
  https://github.com/pleveneur/pilot/actions/runs/40182504898

## Ce que le propriétaire doit vérifier à la main

1. La fin du workflow sur GitHub (build Windows + macOS, signature, `latest.json`).
2. La release `v0.5.0` publiée et son corps de texte (issu de `release-notes/v0.5.0.md`).
3. La mise à jour reçue au prochain démarrage de Pilot installé.
4. À l'ouverture : fenêtre sans barre de titre, boutons Réduire/Agrandir/Fermer,
   clic droit sur Agrandir (menu « Disposer »), Réglages en onglet, entrée « Travail »
   à droite des onglets.
