# Web to Markdown — Extension Pi

Extension Pi qui récupère une page web (documentation, article) et la convertit en Markdown.

## Fonctionnalités

- **Outil custom `fetch_webpage`** : l'IA peut l'appeler automatiquement quand tu demandes d'aller chercher une doc en ligne
- **Commande slash `/fetch <url>`** : lancement manuel, sauvegarde le résultat dans `docs/<titre>.md`

## Utilisation

### Commande slash

```
/fetch https://pi.dev/docs/latest/rpc
```

→ Sauvegarde le contenu dans `docs/rpc.md` et affiche une notification.

### Via l'IA (outil automatique)

Dis simplement à l'IA :

> *« Va chercher la documentation sur https://pi.dev/docs/latest/rpc et résume-la moi »*

L'IA utilisera automatiquement l'outil `fetch_webpage`.

## Dépendances

- `@mozilla/readability` — Extraction du contenu principal (ignore menus, pubs, sidebars)
- `jsdom` — Parseur DOM pour Node.js
- `turndown` — Conversion HTML → Markdown

## Installation des dépendances

```bash
cd .pi/extensions/web-to-markdown
npm install
```

Puis lancer Pi normalement ou faire `/reload`.

## Fichiers générés

Par défaut, les fichiers Markdown sont sauvegardés dans le dossier `docs/` à la racine du projet.
Le nom du fichier est dérivé du titre de la page (slugifié).
