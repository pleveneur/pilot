# Corrections locales : lot 6

# Rapport — Lot 6 : messages d'erreur injectés dans l'interface (COMP-06, P3)

Sur les six emplacements repérés au départ, seuls ceux de `vault.js` reçoivent vraiment une erreur venue du programme Rust. J'ai corrigé ces 3 emplacements de `vault.js` et 2 autres dans `tabs.js`, qui n'étaient pas dans la liste. Ceux de `code-graph-view.js` et de `tabs.js` ne peuvent pas recevoir de message externe : je les écarte sans les modifier. Toute la suite JS et le build passent. Travail local uniquement, sans commit. HEAD est toujours `6d57ddd119fbb173bf962eb2f7400e7e6ea6ca87` et les fichiers des lots 1 à 5 n'ont pas été touchés.

## Points écartés (le message ne peut pas venir de l'extérieur)

| Emplacement | Raison |
|---|---|
| `code-graph-view.js:592` | `rebuildGraph` (`code-graph.js:105-113`) intercepte l'erreur de `build_code_graph` et renvoie `null`. `load()` fait de même pour `graph_status` et `graph_export`. Seule une erreur JS interne peut arriver ici. |
| `code-graph-view.js:607` | Même chose : `load()` ne laisse jamais remonter d'erreur Tauri. |
| `tabs.js:1357` et `:1405` | `createTerminal` (`terminal.js:131-147`) intercepte l'erreur de `spawn_terminal` et de `spawn_terminal_command`. Cela inclut « dossier introuvable : <cwd> » (`terminal.rs:74`). Elle l'affiche ensuite dans xterm avec `term.write`, donc en texte et pas en HTML. Seules des erreurs JS internes atteignent ces deux lignes. |

## Points confirmés et corrigés

| Emplacement | Chemin réel | Correction |
|---|---|---|
| `tabs.js:690` (`_openAgent`) | `start_agent_session` est refusé, puis le message est inséré dans `innerHTML`. Le refus d'écriture GDS (`gds_handover.rs:1020-1028`, via `gds_write_guard.rs:117`) contient une date d'échéance qui vient de l'état renvoyé par le serveur. | Le message passe par `esc()`, qui existait déjà dans `tabs.js:71` |
| `tabs.js:55` (`showAgentOpenError`) | Même refus, quand l'onglet de l'agent est déjà ouvert (`tabs.js:557`) | `esc()` |
| `vault.js:113` | Refus de `vault_list`, inséré dans `innerHTML` | Nouvel élément `div.vault-error` rempli par `textContent` (fonction `errorBox`) |
| `vault.js:251` | Refus de `vault_delete`, inséré avec `insertAdjacentHTML` | `prepend(errorBox(err))` : même endroit, en tête de liste |
| `vault.js:410` | Refus de `vault_status`, inséré dans `innerHTML` | `errorBox` |

Pour le coffre, la provenance externe est faible : les messages de `vault.rs` sont surtout des textes fixes, plus des erreurs de lecture et de format. Une erreur de format JSON peut recopier un morceau de `~/.pilot/vault.json`. Le chemin de code est réel et la correction ne change rien d'autre ; je la classe donc en durcissement P3.

L'affichage reste le même : même élément, même classe, mêmes styles, même texte. Seul le balisage contenu dans le message est maintenant affiché tel quel au lieu d'être interprété.

## Points reportés (hors du périmètre autorisé)

- **`code-graph-view.js:539`** : les noms de fichiers du projet sont insérés en `innerHTML` dans les `<option>` du filtre par fichier.
- **`code-graph-view.js:557`** : le nom du fichier envoyé par la progression du graphe (`graph-build-progress`) est inséré en `innerHTML`.
- **`code-graph-view.js:209`** : la date `built_at` est insérée en `innerHTML`.

  Ces trois cas ne sont pas des messages d'erreur. Les deux premiers sont pourtant les plus exposés : un dépôt peut contenir un fichier dont le nom renferme du HTML. Ils méritent un lot dédié.
- **`pdf-preview.js:55`, `image-viewer.js:63`, `csv-preview.js:219`** : ces trois fichiers insèrent `err.message` en `innerHTML`, alors que la lecture porte sur un fichier du projet. Ils n'étaient pas autorisés et la provenance du message n'a pas été vérifiée. Les lignes `tabs.js:1433`, `:1467` et `:1501` ne reçoivent en pratique que des erreurs internes.
- **Les autres `${e}` de `tabs.js`** (lignes 780 à 1325, erreurs à la création des onglets) ne reçoivent pas d'erreur externe démontrée. Je ne les ai pas modifiées.
- **`vault.js:308`** : le nom du dossier du projet est inséré en `innerHTML` dans l'éditeur d'entrée. Ce n'est pas un message d'erreur.

## Fichiers

- Modifiés : `src/js/tabs.js` (2 lignes) et `src/js/vault.js` (3 emplacements, plus la fonction `errorBox`).
- Créé : `src/js/erreurs-interface-echappees.test.js` (5 tests).
- `code-graph-view.js` n'a pas été modifié.

## Commandes et runs

| Étape | Commande | Run | Résultat |
|---|---|---|---|
| ROUGE | `check.py --test src/js/erreurs-interface-echappees.test.js` | `20261116-122358-535017` | 0/5. Les 5 tests échouent tous sur le balisage brut (`<b id=` présent ou version échappée absente). Les vérifications de lisibilité placées avant passent. |
| Après `tabs.js` | idem | `20261116-122408-032987` | 2/5 (les deux tests `tabs.js` passent, le coffre reste rouge) |
| VERT | idem | `20261116-122418-959154` | 5/5 |
| Suite complète et build | `check.py` | `20261116-122423-933632` | 6020 tests : 6019 réussis, 0 échec, 1 en attente (6014 avant le lot, plus 5 nouveaux). `npm run build` réussi. |

Les tests Rust n'ont pas été lancés : `cargo` est absent du bac à sable du helper, et ce lot ne touche que du JS.

## Limites

- Le test monte les vrais modules (`TabsManager.prototype._openAgent`, `createVault`) avec des appels Tauri simulés. Il utilise un petit faux DOM explicite, sans jsdom ni navigateur. Ce faux DOM ne lit pas le HTML : le test vérifie la chaîne transmise à `innerHTML` ou `insertAdjacentHTML` et le `textContent` des éléments créés.
- Je n'ai validé ni la vraie interface graphique, ni Windows ou macOS, ni un vrai serveur GDS. La provenance externe du refus GDS est établie en lisant le Rust, sans l'avoir exécutée.
- L'audit global n'est pas terminé et d'autres risques d'injection HTML subsistent, notamment les points reportés ci-dessus.

✅ Vérifications faites (protocole quality-gate) :
- J'ai lu en entier `code-graph-view.js` et `vault.js`. Dans `tabs.js`, j'ai lu les lignes 1 à 1660, qui couvrent tous les gabarits d'erreur ; les lignes 1660 à 3430 n'ont été vérifiées que par recherche des insertions HTML.
- J'ai vérifié les appelants et les fonctions appelées utiles : `code-graph.js`, `terminal.js`, `tab-scoping.js` et les captures d'erreur de pdf, image et csv.
- `esc` existait déjà dans `tabs.js` ; `errorBox` est déclarée en tête de module, donc accessible partout dans `createVault`. Aucun import ni export n'a changé, aucune dépendance n'a été ajoutée, et les tests précédents n'ont pas été modifiés.