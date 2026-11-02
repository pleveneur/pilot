# Rapport — Reglages en onglet, LOT A (preparation invisible)

Document applique : `docs/proposition-reglages-en-onglet.md` § 7 (lot A).

## Etat avant / apres (visible pour l'utilisateur)

- Avant : ⚙ « Reglages » (et la commande de palette) ouvre la FENETRE des Reglages.
- Apres : identique. Aucun onglet n'est cree, aucun contenu n'est deplace. La
  seule nouveaute visible : une entree de palette « Ouvrir les Reglages » qui
  emprunte exactement la meme porte que le bouton (meme lecture de config, meme
  message d'echec). Le lot B la fera aboutir a l'onglet.

## Fichiers touches

- `src/js/settings.js` : remplissage extrait dans
  `async function fillSettingsFromConfig(config)` (une seule source, corps
  inchange) ; l'ouverture lit la config puis l'appelle ; les deux ecouteurs
  d'apercu de theme sont lies UNE fois dans `initSettings` (piege 2 : ils
  s'empilaient a chaque ouverture).
- `src/css/style.css` : bloc inert `#settings-modal.modal-in-tab` +
  `.editor-wrapper.settings-wrapper`, apres `.modal-content.settings-content`.
- `src/js/tab-scoping.js` : `"settings"` ajoute a `GLOBAL_TAB_MODES`
  (onglet transverse, survit a une bascule de projet).
- `src/js/tabs.js` : `"settings"` ajoute a la liste `special` (`.tab-special`),
  sans icone.
- `src/js/main.js` : commande de palette `settings` → « Ouvrir les Reglages »
  (categorie Reglages) ; elle clique `#btn-settings` (aucun second chemin).
- `src/js/reglages-lot-a.test.js` (nouveau) : 9 tests.

## Ecarts entre le document et le disque

1. Numeros de ligne : tous verifies, ils correspondent encore (`index.html:389`,
   `style.css:3006`, `:3068`, `tabs.js:3012`, `settings.js:1643-1881`).
2. Le document place `_openSettings`, le `mode` avec son titre, la branche
   `closeTab` ET la commande de palette au **lot B** (§ 7). La mission demandait
   la fonction d'ouverture des le lot A. Je ne l'ai PAS ecrite : sans
   `createSettings` (lot B) elle monterait un onglet vide, donc soit du code
   mort, soit une regression visible. Preparation retenue a la place : le mode
   est declare (liste `special`), le style et le scoping sont en place, et la
   palette est branchee sur la porte existante — le lot B n'aura qu'a changer
   ce que fait cette porte.
3. `apercu-voix-parametres.test.js` (§ 5) reste vert sans adaptation : les deux
   `classList.add("hidden")` de `btnClose` / `btnSave` sont du lot B, non
   touches ici.

## Tests

- `npm test` : **168 fichiers, 2930 tests, tous verts** (avant : 167 / 2921).
  Les 9 tests ajoutes tiennent des invariants reels : un seul remplissage (avec
  la config en argument, aucune seconde lecture), ecouteurs de theme non
  empiles, la fenetre s'ouvre apres remplissage, reserve R-B intacte,
  `shouldCloseTab({mode:"settings"}) === false`, style porte par l'id seul.
- Aucun fichier Rust modifie : `cargo test` non necessaire.

## Reste a faire (lot B)

`_openSettings` (creation de l'onglet, import dynamique, deplacement du noeud
dans `.settings-wrapper` puis retour dans `body` par `unlisten`), branche
`closeTab` (« Annuler » sans confirmation), suppression des deux
`add("hidden")` et de la boucle des quatre acces directs, `exitImmersive()`
avant ouverture, redirection de `#btn-settings` et de `pilot-open-settings`,
et adaptation du test du § 5.
