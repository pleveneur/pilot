# Corrections locales : lot 11

# Lot 11 : les erreurs des lecteurs PDF et image s'affichent désormais, sans HTML non fiable

Les deux défauts sont confirmés dans le vrai code et corrigés. La suite JS complète passe (6047 réussis, 0 échec, 1 en attente) et le build est OK. Rust n'a pas été relancé : le helper indique « cargo absent ».

**Écart à la consigne :** j'ai une fois filtré la sortie du helper avec `| grep` (deuxième lancement, celui qui a donné le VERT du défaut 1). C'est interdit. Je ne l'ai pas refait : tous les lancements suivants sont bruts et complets.

## Confirmés et corrigés

**1. Une erreur de page PDF arrivait dans l'onglet comme du HTML.**
- **Défaut :** `await showPage(1)`, en `pdf-preview.js:175`, est hors du `try/catch` initial. Si `getPage` ou `page.render` échoue, l'erreur remonte jusqu'à `TabsManager._openPdf`, qui insérait `${err.message || err}` tel quel dans la page. L'affirmation du correcteur du lot 10 (« aucune exception ne remonte jusqu'à ces lignes ») est donc bien fausse pour le PDF, et je ne l'ai pas reprise.
- **Correction :** `tabs.js:1434` passe maintenant le message par `esc()`, la fonction d'échappement déjà présente dans le fichier. Le cadre et le texte « ❌ Erreur: » sont inchangés et le message reste lisible.

**2. Le cadre d'erreur PDF ou image n'apparaissait jamais : l'onglet restait vide.**
- **Défaut :** dans les deux lecteurs, le bloc d'erreur faisait `return wrapper` sans `container.appendChild(wrapper)`, et `TabsManager` ne rattache pas le lecteur lui-même.
- **Correction :** j'ai ajouté `container.appendChild(wrapper)` avant ce `return`, dans `pdf-preview.js:60` et `image-viewer.js:66`. Il n'y a pas de double rattachement : le rattachement du chemin réussi est plus loin dans la fonction, et le bloc d'erreur sort avant de l'atteindre.

## Reportés, sans patch

- **Replis image et CSV de `tabs.js` (lignes 1468 et 1502)** : je n'ai trouvé aucun chemin réel qui leur envoie une erreur externe. `createImageViewer` attrape toutes ses erreurs et `imageToBase64` renvoie `null` en cas d'échec. Je n'ai donc pas pu prouver un ROUGE, et je ne les ai pas modifiés.
- **`image-viewer.js:63`** insère toujours `${err.message || err}` comme HTML. Ce n'est sûr aujourd'hui que parce que le message est un texte fixe.

## Fichiers

- `src/js/tabs.js` (une ligne et un commentaire)
- `src/js/pdf-preview.js` (rattachement au conteneur)
- `src/js/image-viewer.js` (rattachement au conteneur)
- nouveau test : `src/js/lecteurs-erreurs-visibles.test.js`

D'après `git diff`, les corrections précédentes de ces fichiers sont intactes : les `esc()` du lot 6 dans `tabs.js` et le `textContent` du lot 10 dans `pdf-preview.js`. Je n'ai touché ni `preview.js`, ni Mermaid/CSP, ni les dépendances : XSS-01 Markdown n'est pas traité.

## Tests ROUGE puis VERT (runs réels)

| Run | Résultat |
|---|---|
| `132606` | ROUGE 0/2 : avec un chargement PDF réussi puis un échec de `getPage` (ou `render` rejeté avec une chaîne brute), le vrai `_openPdf` reçoit le message brut, non échappé. |
| `132606` → 2ᵉ run | VERT 2/2 après la correction de `tabs.js` (c'est le run filtré par `grep`). |
| `132636` | ROUGE 3/8 : conteneur vide après un échec de chargement, pour le PDF direct, le PDF via `_openPdf` et l'image avec le vrai `preview.js`. Les 3 cas d'ouverture réussie et le défaut 1 restent verts. |
| `132644` | VERT 8/8 après les deux ajouts de rattachement. |
| `132650` | Suite JS complète et build : 6047 réussis, 0 échec, 1 en attente, build OK. |

L'ouverture réussie est vérifiée inchangée : page 1 rendue sur un canvas, wrapper rattaché une seule fois, `tab.view` est bien le lecteur, et l'image reçoit sa data URI.

## Limites

- **Faux DOM :** pas de navigateur, de jsdom, de vrai PDF ni de vraie image. Le faux DOM ne parse pas le HTML et ne vide pas les enfants quand on remplace le contenu. Les preuves reposent donc sur la chaîne insérée et sur la liste des éléments rattachés.
- **Simulations :** `invoke`, PDF.js, l'URL du worker, Mermaid, les icônes et les plugins Tauri sont simulés. `_openPdf` est appelé sur un contexte minimal, pas sur un `TabsManager` construit en entier.
- **Messages PDF.js :** les vrais messages d'erreur de PDF.js n'ont pas été listés.
- **Non validé :** Windows, macOS, l'application Tauri complète et le vrai serveur GDS/pi.

Cela ne vaut pas validation de l'audit global. La relecture indépendante reste à faire.