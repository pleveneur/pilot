# Notes de version (release-notes)

Ce dossier contient les **résumés de mise à jour orientés utilisateur**,
affichés dans la modale de mise à jour de Pilot et sur la page GitHub de
la release.

## Usage

Avant de publier une version `vX.Y.Z`, créez un fichier nommé
**`vX.Y.Z.md`** (ex: `v0.2.11.md`) contenant un résumé clair en français,
destiné aux utilisateurs. Exemple :

```markdown
### ✨ Nouveautés

- Ajout d'un mode sombre/clair automatique selon l'heure.

### 🐛 Corrections

- L'aperçu Markdown ne plantait plus sur les très longs fichiers.
```

Le script `scripts/gen-latest-json.js` détecte automatiquement ce fichier
et l'utilise comme `notes` du `latest.json` et comme body de la release
GitHub.

## Sans fichier de notes

Si aucun `vX.Y.Z.md` n'est présent, un changelog est généré automatiquement
à partir des commits (`git log`) entre le tag précédent et le tag courant,
catégorisé (✨ Nouveautés / 🐛 Corrections / ⚡ Performances / 🔧 Maintenance),
avec retrait du préfixe technique (`fix(rpc):` → `🐛 Corrections`). Les
commits `chore: bump version` sont filtrés.

## Recommandation

Pour les versions destinées aux utilisateurs, **rédigez un résumé humain** :
les messages de commits restent techniques et peu parlants pour un
utilisateur non-développeur.