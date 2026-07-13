---
name: quality-gate
description: "Protocole anti-régression à activer avant toute modification de code. À utiliser systématiquement quand l'agent s'apprête à modifier ou créer des fichiers de code (TypeScript, JavaScript, JSON, Markdown de configuration, etc.). Garantit qu'aucune fonctionnalité existante n'est cassée et qu'aucun branchement n'est oublié."
---

# Quality Gate — Protocole Anti-Régression

## Objectif

Ce skill impose un processus strict de vérification **avant et après** chaque modification de code pour éviter :
- De casser des fonctionnalités qui marchaient déjà
- D'oublier de brancher un nouveau composant (import, enregistrement, appel)

---

## Phase 1 — Analyse AVANT modification

### Étape 1.1 : Lire tous les fichiers du composant

Utilise `read` pour lire **intégralement** tous les fichiers concernés par la modification. Ne te limite pas à la zone que tu penses modifier.

Si le composant est un fichier unique (ex: `index.ts` d'une extension), lis-le en entier.
Si le composant est multi-fichiers (ex: une extension avec `index.ts` + `README.md`), lis-les tous.

### Étape 1.2 : Cartographier les points de connexion

Dresse la liste explicite de :

| Catégorie | Questions à se poser |
|---|---|
| **Imports** | Qu'est-ce que ce fichier importe ? Quels autres fichiers importent celui-ci ? |
| **Exports** | Qu'est-ce que ce fichier exporte ? Ces exports sont-ils utilisés ailleurs ? |
| **Appels** | Quelles fonctions/méthodes sont appelées dans ce fichier ? Qui appelle les fonctions de ce fichier ? |
| **Enregistrements** | Y a-t-il des `pi.registerTool()`, `pi.registerCommand()`, `pi.on()` ? |
| **Références externes** | Ce composant est-il mentionné dans d'autres fichiers (config, README, AGENTS.md) ? |

### Étape 1.3 : Lister l'existant à préserver

Fais une liste explicite de tout ce qui fonctionne aujourd'hui et qui **doit continuer à fonctionner** après ta modification.

---

## Phase 2 — Modification ciblée

### Règles strictes

1. **Ne modifie que ce qui est nécessaire.** Ne retouche pas les blocs qui n'ont pas besoin de changer.
2. **Utilise des `oldText` courts et précis** dans les appels `edit`. Chaque remplacement doit être minimal et non-ambigu.
3. **Si tu ajoutes un nouveau composant**, tiens une liste mentale de **tous** les branchements à faire :
   - Créer le fichier
   - L'importer dans le fichier principal
   - L'enregistrer (ex: `pi.registerTool(...)`)
   - L'appeler si nécessaire
   - Le documenter (ex: `README.md`)

---

## Phase 3 — Vérification APRÈS modification

### Étape 3.1 : Relire chaque fichier modifié en entier

Utilise `read` pour relire chaque fichier que tu as modifié. Ne te fie pas à ta mémoire — lis le fichier réel.

Vérifie :
- La syntaxe est-elle correcte ?
- Les accolades/parenthèses sont-elles bien appairées ?
- Les virgules et points-virgules sont-ils aux bons endroits ?

### Étape 3.2 : Vérifier chaque point de connexion

Reprends la liste de l'étape 1.2 et vérifie chaque point un par un :
- Les imports sont-ils toujours valides ?
- Les fonctions appelées existent-elles toujours ?
- Les événements enregistrés sont-ils toujours corrects ?

### Étape 3.3 : Vérifier les branchements des nouveautés

Si tu as ajouté quelque chose, vérifie **chaque** point de la liste des branchements :
- [ ] Le fichier est créé au bon endroit
- [ ] L'import est présent dans le fichier principal
- [ ] L'enregistrement est fait (`registerTool`, `registerCommand`, etc.)
- [ ] L'appel est fait si nécessaire
- [ ] La documentation est à jour (`README.md`, `AGENTS.md`, etc.)

### Étape 3.4 : Annoncer explicitement ce qui a été vérifié

Termine ta réponse par un récapitulatif de ce que tu as vérifié, par exemple :

> ✅ Vérifications effectuées :
> - `index.ts` relu en entier, syntaxe OK
> - Les 3 `registerTool` existants sont toujours présents et intacts
> - Le nouveau `registerCommand` est bien ajouté et fonctionnel
> - `README.md` mis à jour avec la nouvelle commande
> - Aucune fonctionnalité existante supprimée ou altérée

---

## Checklist rapide (copier-coller mental)

```
[ ] AVANT : Lu tous les fichiers du composant
[ ] AVANT : Cartographié imports, appels, événements, références
[ ] AVANT : Listé ce qui doit continuer à fonctionner
[ ] APRÈS : Relu chaque fichier modifié en entier
[ ] APRÈS : Vérifié chaque point de connexion
[ ] APRÈS : Vérifié tous les branchements des nouveaux composants
[ ] APRÈS : Annoncé explicitement les vérifications faites
```