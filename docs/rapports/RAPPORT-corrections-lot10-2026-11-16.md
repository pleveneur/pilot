# Corrections locales : lot 10

# Lot 10 : erreurs des lecteurs PDF, image et CSV

**Résultat :** j'ai corrigé un seul point, le lecteur PDF. C'est un durcissement : je n'ai pas prouvé d'attaque avec un vrai PDF. Les points image et CSV sont rejetés, preuve à l'appui. La suite JS complète passe et le build est OK. HEAD est toujours `6d57ddd`, rien n'a été commité ni poussé, et les changements des lots 1 à 9 ne sont pas touchés.

## D'où viennent les messages d'erreur

- **Commandes Rust** (`src-tauri/src/files.rs:20-28`) : `read_file_binary` et `read_file_content` renvoient « Erreur lecture: » suivi du texte d'erreur du système (par exemple « No such file or directory (os error 2) » ou « stream did not contain valid UTF-8 »). Ce texte ne contient ni le chemin, ni le nom du fichier, ni son contenu.
- **Appelants** : les trois lecteurs ne sont appelés que par `tabs.js:1431`, `:1465` et `:1499`. Je n'ai trouvé aucun pont qui expose ces lecteurs à l'accès distant web.

## Bilan par point

| Point | Verdict | Raison |
|---|---|---|
| `pdf-preview.js:55` | **Corrigé (durcissement)** | Le message est celui de PDF.js, qui analyse les octets d'un fichier non fiable. Pilot ne maîtrise pas ce texte. Je n'ai pas pu lire le code de PDF.js ici (`node_modules` n'est pas dans le dossier de travail), donc aucune attaque n'est démontrée avec un vrai PDF. |
| `image-viewer.js:63` | **Rejeté** | `imageToBase64` (`preview.js:308-322`) attrape toutes ses erreurs et renvoie `null`. Le seul message qui peut s'afficher est le texte fixe « Impossible de charger l'image ». Le test le confirme avec le vrai `preview.js`. |
| `csv-preview.js:219` | **Rejeté** | Les seules erreurs possibles sont le texte fixe de Rust ou des erreurs internes du navigateur (par exemple une chaîne trop longue). Aucune ne vient du fichier. Un test JS ne peut pas prouver ce point, qui repose sur la lecture de `files.rs`. Je n'ai donc pas fait de patch. |
| Hors périmètre | **Reporté** | `tabs.js` (lignes 1405, 1433, 1467 et 1501) utilise le même schéma avec `${err.message \|\| err}`. Ce fichier n'était pas autorisé. Aujourd'hui, les lecteurs ne laissent remonter aucune exception jusqu'à ces lignes. |

## Correctif

Dans `src/js/pdf-preview.js`, le cadre reste identique : même `div.pdf-error`, même phrase, même `<br><small>`. Le message est maintenant placé dans `<small>` comme texte (`textContent`) au lieu d'être inséré comme du balisage. Un commentaire en anglais a été ajouté.

Un effet de bord mineur : `err?.message` évite une erreur si `err` est `null`. Dans ce cas, l'écran affiche « null » au lieu de planter dans le `catch`.

## Tests : nouveau fichier `src/js/lecteurs-erreurs-texte.test.js`

Le test charge les vrais modules. Les appels Tauri et PDF.js sont simulés, et Mermaid est neutralisé.

1. **Premier run, invalide** : mon assertion `"<b"` correspondait aussi au `<br>` du cadre, donc les 3 tests échouaient. J'ai corrigé l'assertion pour viser `<b id="piege">` et `piege`.
2. **ROUGE attendu** (run `20261116-131547-766517`) : les 2 tests PDF échouent sur l'insertion de `<b id="piege">` et `<img`. Le test image passe déjà sans aucun patch, ce qui confirme son rejet.
3. **VERT** après le correctif (run `20261116-131554-654484`) : 3/3.
4. **Suite complète et build** (run `20261116-131558-271399`) : 6040 tests, dont 6039 réussis, 0 échec et 1 en attente (baseline 6036, plus les 3 nouveaux). Le build est OK.
5. **Rust** : non exécuté, car `cargo` est absent du bac. Je n'ai pas modifié de Rust.

## Limites

- **Pas de vrai navigateur** : pas de jsdom, pas de navigateur. Le faux DOM ne parse pas le HTML. Le test lit la chaîne passée à `innerHTML` et le texte du nœud `<small>`, qu'un `querySelector` simulé fournit.
- **Pas de vrai PDF** : aucun vrai PDF ni vrai fichier n'a été utilisé, et je n'ai pas pu lister les messages réels de PDF.js.
- **Non validés** : l'interface réelle, Windows et macOS.
- **Markdown (XSS-01)** : comme décidé par Drass, la prévisualisation Markdown n'est pas corrigée. `preview.js` n'a pas été modifié. L'audit global n'est pas résolu.

Vérifications faites : j'ai relu la zone modifiée, et le diff ne touche que `pdf-preview.js`. `image-viewer.js` et `csv-preview.js` n'ont aucun diff. L'import `invoke` et l'export `createPdfPreview` sont inchangés. Je n'ai ajouté aucune dépendance, modifié aucun ancien test et écrit aucun rapport.