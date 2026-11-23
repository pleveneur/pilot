# Corrections locales : lot 8

## Bilan lot 8 : le défaut du formulaire du coffre est confirmé et corrigé

Le défaut se reproduit en passant par le vrai module `createVault`. Une valeur stockée qui contient déjà une entité HTML ressort modifiée dans le formulaire d'édition. Si on réenregistre sans rien toucher, c'est cette valeur modifiée qui part vers `vault_update`. La correction est faite, et la suite JS complète et le build passent.

**Chemin suivi :**
1. `tabs.js` ouvre le coffre.
2. Le coffre déverrouillé affiche la liste, puis le bouton « Modifier » ouvre le formulaire (`openEditor`).
3. La description, le login et le mot de passe sont insérés dans `value="…"` via `escAttr`.
4. « Enregistrer » relit les trois champs et les envoie à `vault_update` (ou `vault_add` pour une nouvelle entrée).

**Correctif** (`src/js/vault.js`, fonction `escAttr`) : `&` est maintenant échappé en `&amp;`, et avant les autres caractères. J'ai ajouté un commentaire en anglais. Une valeur sans `&` produit exactement le même HTML qu'avant, et la liste des entrées s'affichait déjà en texte brut, donc l'affichage ne change pas. Le reste du fichier n'a pas bougé : les corrections du lot 6 (`errorBox`) et du lot 7 (`escHtml` sur le nom du projet), la portée et le `projectPath` envoyé. Aucun changement Rust, crypto, format ou dépendance.

## Fichiers
- Modifié : `src/js/vault.js` (uniquement `escAttr`).
- Créé : `src/js/coffre-formulaire-entites.test.js`, avec 11 tests :
  - Quatre jeux de valeurs : entités nommées et numériques (dont la valeur de Hermes `secret&lt; &amp; &#34; fin`), caractères bruts `& " < > '`, références hexadécimales et doubles (`&amp;amp;`, `&#x3C;`, `&copy;`), valeurs ordinaires.
  - Chaque jeu est testé en portée globale et en portée projet. Le test vérifie la liste affichée, les trois champs relus, puis l'objet exact passé à `vault_update` (id, valeurs, portée, chemin du projet, dates), et que `vault_add` n'est pas appelé.
  - Le HTML produit pour des valeurs ordinaires est comparé au caractère près.
  - Création d'une entrée : les champs sont vides, et ce que l'utilisateur saisit arrive tel quel à `vault_add`.

## Exécutions réelles (outil autorisé)
| Run | Résultat |
|---|---|
| `20261116-124836-490719`, avant correctif | **ROUGE** : 4 échecs sur 11 (les deux jeux à entités, dans les deux portées). Par exemple, `Accès &lt;prod&gt;` est relu `Accès <prod>` et `Copie &copy; &#xA9;` est relu `Copie © ©`. Les cas bruts et ordinaires passaient déjà, c'était attendu. |
| `20261116-124843-768067`, après correctif | **VERT** : 11/11 |
| `20261116-124846-727338`, suite complète + build | **6033 réussis, 0 échec, 1 en attente, build OK.** Soit la baseline de 6022 plus les 11 nouveaux tests. |

Rust n'a pas été exécuté : l'outil indique « cargo absent ». Ce lot ne touche pas au Rust.

## Limites : faux DOM et vrai navigateur
- Le dépôt n'a ni navigateur ni jsdom, et le test utilise un faux DOM qui **ne lit pas le HTML**. Le passage « HTML de l'attribut → `input.value` » est donc **simulé** par une fonction du test (`decodeAttr`) : elle décode en une passe les références décimales et hexadécimales et quelques entités nommées (`amp`, `lt`, `gt`, `quot`, `apos`, `nbsp`, `copy`).
- Cette simulation ne remplace aucune logique de production. Ce qui est contrôlé reste le vrai HTML produit par `openEditor`, et le test vérifie aussi que chaque attribut `value` se referme bien juste avant `>`.
- Elle ne connaît pas les ~2200 entités nommées d'un vrai navigateur, ni les anciennes formes sans point-virgule. Comme tout `&` est maintenant échappé, ces formes ne devraient plus être décodées, mais je ne l'ai pas prouvé dans un vrai navigateur.
- Un test vérifie que la simulation donne le même résultat que celui que Hermes a observé en vrai navigateur : `secret&lt; &amp; &#34; fin` → `secret< & " fin`. Ce n'est qu'un seul point de comparaison.
- **Il reste à faire** : le contrôle en vrai navigateur de Hermes après correctif, l'interface réelle Tauri, Windows/macOS, et la suite Rust.

✅ Vérifications quality-gate :
- `vault.js` lu en entier.
- Branchements vérifiés : `tabs.js` vers `createVault`, `openEditor` puis `vault_update`/`vault_add`.
- Le diff relu ne touche que `escAttr`.
- Les tests des lots précédents qui montent `createVault` (dont `noms-projets-fichiers-echappes.test.js`) sont toujours verts.
- Aucun commit ni push, aucun rapport créé, aucun autre fichier touché.