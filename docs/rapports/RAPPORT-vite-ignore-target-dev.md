# Rapport — le mode dev ne plante plus au démarrage (dossier `target/` ignoré par Vite)

Date : 2026-11-15

## Symptôme

Au lancement de `npm run tauri dev`, l'outil d'affichage de Vite s'arrêtait sur :

```
Error: EBUSY: resource busy or locked, watch 'G:\IA_PL\pilot\target\debug\deps\displaydoc-bbcdb45f517e1bf0.dll'
Error The "beforeDevCommand" terminated with a non-zero status code.
```

## Cause

Le workspace Cargo racine a déplacé le dossier de compilation `target/` à la
racine du dépôt. La configuration de Vite n'ignorait que `**/src-tauri/**`, donc
son guetteur de fichiers surveillait aussi `target/`, que Cargo réécrit
massivement pendant la compilation. Sous Windows, `fs.watch` renvoie alors
`EBUSY` et Vite ne rattrape pas cette erreur : le processus meurt.

## Ligne modifiée

`vite.config.js`, une seule ligne :

```diff
-      ignored: ["**/src-tauri/**"],
+      ignored: ["**/src-tauri/**", "**/target/**"],
```

Aucun autre changement dans ce fichier, aucun nouveau fichier de configuration,
aucune nouvelle dépendance. Le dossier `target/` n'a pas été supprimé.

## Autres guetteurs de fichiers

Recherche de `ignored:` / `watch:` dans les fichiers de configuration du projet
(`*.js`, `*.json`, `*.toml`, `*.ts`, hors `node_modules`, `target`, `.git`) :
seul `vite.config.js` configure un guetteur. Aucun autre endroit à corriger.

## Tests

- `npx vitest run` : **PASS (5817) FAIL (0)** — aucune régression.
- Pas de compilation Rust complète lancée (longue et hors du périmètre de la
  correction), conformément à la consigne.

## Commit

Commit local `fix(dev): Vite n'analyse plus le dossier target/` (pas de push).
