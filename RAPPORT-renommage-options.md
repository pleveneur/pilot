# Rapport — renommage « Réglages » → « Options » à l'écran

Lot unique demandé : partout où l'utilisateur **voit** le mot « Réglages » pour
désigner le panneau de configuration (bouton ⚙, titre du panneau, onglet), le
mot devient « Options ». **Seul le texte affiché change** : aucun identifiant
interne, aucune classe CSS, aucune clé de configuration, aucun nom de fonction,
aucune commande Tauri n'a été renommé.

---

## 1. État avant / après

| Avant | Après |
|---|---|
| Bouton du haut de colonne : `⚙ Réglages` | `⚙ Options` (`id="btn-settings"` inchangé) |
| En-tête du panneau : `⚙ Réglages` | `⚙ Options` (classe `.settings-head-title` inchangée) |
| Onglet ouvert par la porte ⚙ : « Réglages » | « Options » (mode d'onglet `settings` inchangé) |
| Panneau de repli (échec de chargement) : « Réglages » | « Options » |
| Palette : catégorie « Réglages » + « Ouvrir les Réglages » | catégorie « Options » + « Ouvrir les Options » (`id: "settings"` inchangé) |
| Message d'agent (service Laya) : « (Réglages → Service Laya) » | « (Options → Service Laya) » |
| Aide intégrée : « les Réglages s'ouvrent dans un onglet » | « les Options s'ouvrent dans un onglet » |
| Aide intégrée : « le chemin de l'agent (Réglages → Agent) » | « (Options → Agent) » |
| README utilisateur : « Les Réglages s'ouvrent dans un onglet » | « Les Options s'ouvrent dans un onglet » |

Aucun changement de disposition, d'ordre, d'icône, de couleur ni de
comportement : **le mot seul**.

---

## 2. Comptage des occurrences (fait sur le disque, pas recopié)

Chaîne exacte « Réglages » (majuscule), comptée avec
`grep -o 'Réglages' <fichier> | wc -l` :

| Fichier | Avant | Après | Dont occurrences **affichées** changées |
|---|---|---|---|
| `index.html` | 5 | 3 | **2** (libellé du bouton, titre du panneau) |
| `src/js/main.js` | 6 | 0 | **2** (libellé de commande, catégorie de palette) + 4 valeurs `category:` qui suivent la catégorie |
| `src/js/tabs.js` | 8 | 6 | **2** (titre d'onglet, panneau de repli) |
| `src/js/laya-gateway.js` | 1 | 0 | **1** (message d'agent, lu par l'utilisateur) |
| **Sous-total écran / JS** | **20** | **9** | |
| `help/overview.md` (source de l'aide) | 1 | 0 | **1** |
| `spec_super_agent.md` (bloc `HELP:super-agent`) | 4 | 3 | **1** |
| `help/handbook.md` (GÉNÉRÉ, non édité à la main) | 7 | 5 | **1** |
| `README.md` (doc utilisateur) | 1 | 0 | **1** |
| **Total occurrences de la chaîne changées** | | | **14** |

**Occurrences affichées trouvées : 14. Changées : 14. Laissées dans les
fichiers touchés : 9** (3 dans `index.html`, 6 dans `tabs.js`), toutes
justifiées au § 3.

Aucune référence `fichier:ligne` de la demande n'a été recopiée : tout a été
relu et recompté ici.

---

## 3. Occurrences volontairement LAISSÉES (faux amis)

### Dans les fichiers touchés

| Emplacement | Texte | Pourquoi c'est laissé |
|---|---|---|
| `index.html:601`, `index.html:605` | « Réglages avancés » | Nom du **sous-bloc replié du service Laya**, pas le panneau. Le renommer changerait le nom d'une section, pas celui du panneau. |
| `index.html:1321` | « Réglages (nom, clients, association projet → client) » | **Rubrique de la mémoire de session** à conserver : ce sont des *données* mémorisées, pas le panneau. |
| `src/js/tabs.js:323,324,1154,1971` | commentaires | Jamais affichés à l'utilisateur. |
| `src/js/tabs.js:1193,1979` | `console.error` / `console.warn` | Messages de diagnostic console, jamais affichés. |

### Hors des fichiers touchés (aucune modification : ce n'est pas de l'écran)

- `src/js/agent-pi.js:977`, `src/js/super-agent.js:3260` — « **Réglages Windows** → Confidentialité → Micro » : réglages du **système d'exploitation**.
- `index.html` et ailleurs — « ce réglage », « le réglage », « les réglages » au **singulier/pluriel générique** (un interrupteur, une valeur) : ce n'est pas le nom du panneau.
- `src/js/settings.js`, `src/js/laya-utils.js`, `src/js/super-agent.js`, `src/css/style.css`, `src-tauri/src/*.rs` — commentaires, messages console et erreurs techniques (non affichés).
- `spec_pilot.md` § C, `spec_laya.md`, `spec_anomaly.md`, `spec_help.md`, `spec_super_agent.md` (hors bloc `HELP`), `fiche-reference-pilot.md`, `docs/proposition-*.md`, `release-notes/`, rapports : documentation de développement, pas l'écran.
- `README.md` ligne de titre « ### Paramètres (onglet ⚙️) » : le mot demandé est « Réglages », pas « Paramètres » — voir § 5.

---

## 4. Tests

### Tests de libellé mis à jour (jamais supprimés)

| Fichier | Avant | Après |
|---|---|---|
| `src/js/lot2-colonne-haut.test.js:188` | `["btn-settings", "Réglages"]` | `["btn-settings", "Options"]` |
| `src/js/retrait-ecran-aide.test.js:60` | `toContain("Réglages")` | `toContain("Options")` |
| `src/js/laya-gateway.test.js:225` | `toContain("Réglages → Service Laya")` | `toContain("Options → Service Laya")` |

### Test ajouté — `src/js/libelle-options-ecran.test.js` (14 tests)

Il échoue si « Réglages » **revient à l'écran** :

- (a) le bouton `#btn-settings` perd son libellé « Options » (et ses
  identifiant / classe / icône restent intacts) ;
- (b) l'en-tête `.settings-head-title` reprend « Réglages » ;
- (c) le titre de l'onglet ou son panneau de repli reprend « Réglages » ;
- (d) la palette reagrège sous « Réglages » ou annonce « Ouvrir les Réglages » ;
- (e) le message de panne Laya renvoie vers « Réglages → Service Laya » ;
- (f) **chasse ligne à ligne dans `index.html`** : toute occurrence de
  « Réglages » doit être un faux ami déclaré (liste blanche explicite) ;
- (g) l'aide intégrée (`help/overview.md`), le handbook **régénéré**, le renvoi
  « (Options → Agent) » et le README reprennent « Réglages ».

### Preuve que les tests mordent (fait, puis restauré)

| Sabotage volontaire | Résultat |
|---|---|
| remettre `<span class="ga-label">Réglages</span>` dans `index.html` | `libelle-options-ecran` : **FAIL (4)** ; `lot2-colonne-haut` + `retrait-ecran-aide` : **FAIL (2)** |
| remettre `new Tab(id, "", "Réglages", "settings")` dans `tabs.js` | `libelle-options-ecran` : FAIL (2 de (c)) |
| remettre `(Réglages → Service Laya)` dans `laya-gateway.js` | `laya-gateway.test.js` : **FAIL (1)** |

Après restauration, les diffs ont été revérifiés : aucun résidu de sabotage.

### Comptes `npx vitest run`

| Moment | Résultat |
|---|---|
| **Avant** | `PASS (2985) FAIL (0)` |
| **Après** | `PASS (2999) FAIL (0)` |

Delta = **+14**, exactement les 14 tests du nouveau fichier : aucun test
supprimé, 3 tests mis à jour sur place.

`npm run build:handbook` relancé : `help/handbook.md` régénéré (45 blocs,
261 494 octets), diff de **2 lignes** — exactement les deux phrases d'aide.

Aucun fichier Rust n'a été modifié : `cargo test` n'est pas requis par ce lot.

---

## 5. Ce qui reste à faire (décisions du propriétaire, hors de ce lot)

1. **Deux noms pour la même porte** : le bouton ⚙ porte le libellé **Options**
   mais son infobulle (`title`) dit toujours **« Paramètres »**. Ce lot ne
   devait changer que le mot « Réglages » : trancher si l'infobulle devient
   « Options » (et si le titre « ### Paramètres » du README suit).
2. **« Réglages avancés »** (sous-bloc du service Laya, `index.html`,
   `spec_laya.md`, messages `laya-utils.js`) : renommer en « Options avancées » ?
   Laissé tel quel pour ne pas renommer une section.
3. **Rubrique de mémoire « Réglages »** (`index.html:1321`,
   `spec_super_agent.md:2492`) : laisser (données mémorisées) ou renommer ?
4. **Documentation de développement** (`spec_pilot.md` § C, `spec_laya.md`,
   `spec_anomaly.md`, `spec_help.md`, `fiche-reference-pilot.md`,
   `docs/proposition-*.md`) : les phrases du type « onglet des Réglages » y
   décrivent encore l'ancien nom. Non touchées (hors écran) — à aligner si la
   doc interne doit suivre.
5. **`dist/`** et `.pilot/` contiennent l'ancien libellé : ce sont des artefacts
   générés / des archives locales, jamais édités à la main ; ils seront
   remplacés au prochain `npm run build`.

---

## 6. Fichiers touchés

| Fichier | Nature |
|---|---|
| `index.html` | libellé du bouton ⚙ + titre du panneau |
| `src/js/tabs.js` | titre de l'onglet + titre du panneau de repli |
| `src/js/main.js` | libellé de commande + catégorie de palette (5 valeurs) |
| `src/js/laya-gateway.js` | message d'agent (`layaOffMessage`) |
| `help/overview.md` | bloc `HELP:theme-parametres` |
| `spec_super_agent.md` | bloc `HELP:super-agent` |
| `help/handbook.md` | **régénéré** par `npm run build:handbook` (jamais édité à la main) |
| `README.md` | une phrase de la section « Paramètres (onglet ⚙️) » |
| `src/js/lot2-colonne-haut.test.js` | test de libellé mis à jour |
| `src/js/retrait-ecran-aide.test.js` | test de libellé mis à jour |
| `src/js/laya-gateway.test.js` | test de libellé mis à jour |
| `src/js/libelle-options-ecran.test.js` | **nouveau** (14 tests, verrou du renommage) |
| `RAPPORT-renommage-options.md` | ce rapport |

Aucun autre fichier n'a été modifié. Aucun envoi vers GitHub, aucun tag,
aucune publication, aucune suppression, aucun `--amend`, aucune commande de
nettoyage ou de réinitialisation Git.

VERDICT : fait et vérifié — 14 occurrences affichées de « Réglages » changées en « Options », 9 laissées et justifiées (faux amis + console/commentaires), 3 tests de libellé mis à jour et 14 ajoutés (preuve de morsure fournie), `npx vitest run` passe de 2985 à 2999 tests sans aucun échec ; reste à trancher l'infobulle « Paramètres » et le sort de « Réglages avancés ».
