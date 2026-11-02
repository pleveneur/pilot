# Rapport — restes de l'ancien monde dans les textes

> Mission de vérité : traquer et corriger tout texte (commentaire, message, aide,
> titre de test) qui décrit encore l'ancien monde. Aucun changement de
> comportement : les seules lignes modifiées sont des commentaires, des titres de
> test, des messages de console (jamais affichés), un message d'`Error` interne
> et du texte d'aide. Aucune assertion, aucune fonction, aucun sélecteur, aucune
> valeur de code n'a été touchée.

## 1. Phrases fausses corrigées (20 fichiers, 66 hunks)

### a) Bande de fenêtre de 32 px décrite comme existante

| Fichier | Ce qui était faux | Corrigé en |
|---|---|---|
| `src-tauri/src/lib.rs:3567` | « ses trois boutons vivent désormais dans la bande **#window-bar** » — cette bande n'existe plus, et deux tests (`barre-fenetre-etats.test.js:101-103`) interdisent son retour | « …vivent désormais dans la rangée d'onglets (**#tab-row**, groupe **#window-controls** : la bande #window-bar a été supprimée) » |
| `src/js/barre-fenetre-disposer.test.js:14` | « le menu vit AU-DESSUS de la **bande de fenêtre** » — il n'y a plus de bande | « le menu s'ouvre AU-DESSUS des **boutons de fenêtre** » |
| `src/js/barre-fenetre-disposer.test.js:134` | titre de test « aucun autre élément de **la bande** n'ouvre le menu » | « de **la rangée d'onglets** » (aucune assertion changée) |
| `src/js/taille-et-style-panneau.test.js:198` | commentaire de mesure : « bande de fenêtre 32 px + rangée d'onglets 37 px = 69 px », décrit comme l'agencement **en vigueur** | le commentaire dit maintenant que la bande n'existe plus, que la constante reste un **majorant** (69 = 32 + 37) et que la valeur exacte serait 37 px — **la constante n'est pas touchée** (voir §3.1) |

### b) Écran / onglet « Aide » décrit comme point d'entrée

| Fichier | Ce qui était faux | Corrigé en |
|---|---|---|
| `src-tauri/src/help.rs:49` | « L'historique est géré par `help.js` » — ce module n'existe plus | « était géré par l'ancien module d'écran `help.js` (retiré avec l'écran « ❓ Aide ») ; il ne sert plus qu'à l'emballage `ask_help`, sans appelant côté écran » |
| `src-tauri/src/help.rs:70` | « L'écran Aide **reste** un simple emballage (`ask_help`), son comportement ne change pas » | « L'écran « ❓ Aide » a été **RETIRÉ** : `ask_help` n'est plus qu'un emballage historique conservé, sans appelant côté écran » |
| `src-tauri/src/help.rs:332` | « Commande **de l'écran** « ❓ Aide » » (présent) | « Commande **de l'ancien** écran « ❓ Aide » (**retiré**) … n'a plus d'appelant côté écran » |
| `help/overview.md:634` (texte **affiché**, donc embarqué) | « …voisines de Brouillon, Paramètres, **Coffre, Remarque et Aide** » + désignait les écrans GDS comme des **icônes du haut de la barre latérale gauche** : ni « Aide », ni ces quatre icônes ne sont dans le haut de la colonne depuis les lots 2 et 7 | « rangée **Accès directs** de l'onglet **Options ⚙️** », avec les libellés réels des boutons (« Serveur GDS », « GDS mon compte ») et leurs infobulles exactes |

### c) « Réglages » pour désigner le panneau qui s'appelle « Options »

Corrigé partout où le mot nommait **le panneau** (53 lignes) :
`index.html:66,70` · `src/js/main.js:404,832,834,845,852,859` · `src/js/laya-utils.js:1` ·
`src/css/style.css:773,3234` · `src/js/settings.js:1,83,422,428,1961,1982,1991,2007,2632,3238,3240,3249,3259,3267,3272,3274,3286,3314` ·
`src/js/tabs.js:323,1154,1193,1971,1979,3017,3019` · `src/js/tab-scoping.js:43` ·
`src/js/super-agent.js:3499` · `src-tauri/src/lib.rs:2681` —
et dans les **fichiers de test** (commentaires d'en-tête et chaînes de titre
`describe`/`it` — jamais leur contenu) :
`src/js/reglages-lot-a.test.js:4,93,118,131` · `src/js/reglages-lot-b.test.js:3,12,95,145` ·
`src/js/settings-laya-elements.test.js:5,10` · `src/js/apercu-voix-parametres.test.js:236` ·
`src/js/lot2-colonne-haut.test.js:11,26` · `src/js/retrait-ecran-aide.test.js:11`.

Trois lignes ont en plus cessé de parler au futur alors que le lot est livré
(`main.js:404` « au lot B, la même porte **ouvrira** l'onglet »).

### d) Second moyen de lire la documentation

| Fichier | Ce qui était faux | Corrigé en |
|---|---|---|
| `help/overview.md:258` (texte **affiché**) | « Cette documentation est **écrite au démarrage de Pilot dans un dossier de fichiers lisibles** (sous-dossier `aide` du dossier de données) » — **mesuré faux** : aucun code n'écrit un tel dossier (`grep '"aide"'` sur `src-tauri/src` et `src/js` : 0 occurrence ; `create_dir_all` n'est appelé que pour la config, les images et le projet), et `get_handbook` n'a **aucun appelant** côté écran | « Cette documentation est **embarquée dans le programme** au moment de la compilation (`help/handbook.md` inclus dans le binaire)… il n'existe **aucune copie sur le disque** à ouvrir à côté — l'Assistant est le **seul** chemin pour la lire » |

## 2. Ce qui a été LAISSÉ, et pourquoi

**Légitime — le texte dit qu'une chose a été supprimée ou en explique la raison :**

- `index.html:19` (« Bande de fenêtre de 32 px SUPPRIMÉE… »), `src/css/style.css:71, 263, 1035, 1833, 1841, 2016, 10795-10798`, `src/js/window-controls.js:3`, `src/js/barre-fenetre-etats.test.js:3,23,100` : tous décrivent la disparition de la bande (ou mesurent le gain de 37 px qui la remplace). Un commentaire qui explique *pourquoi* une bande a disparu est la mémoire du projet, pas un reste.
- `index.html:75-76`, `src/js/main.js:805`, `src/js/review.js:14`, `src/css/style.css:7348, 7486`, `src-tauri/src/lib.rs:491, 2789`, `src-tauri/src/help.rs:4-13`, `src/js/super-agent.js` (un seul chemin `ask_help_doc`), `help/overview.md:245`, `README.md:333`, `spec_pilot.md:59`, `spec_help.md` (§ Statut, § 9), `spec_gds.md:324`, `spec_telegram.md:368` : tous disent explicitement que l'écran/onglet « Aide » **n'existe plus** et que l'Assistant est le seul chemin.

**Faux amis du mot « Réglages » (le mot ne nomme pas le panneau) :**

- `index.html:602,606`, `src/css/style.css:3597`, `spec_laya.md` : « **Réglages avancés** » = nom affiché d'un sous-bloc replié du service Laya.
- `index.html:1322` : « **Réglages** (nom, clients, association projet → client) » = libellé affiché d'une rubrique de la mémoire de projet.
- `src/js/agent-pi.js:977`, `src/js/super-agent.js:3267` : « **Réglages Windows** → Confidentialité → Micro » = réglages du système d'exploitation.
- « Réglages de la file » (`project-task-queue.js:29`), « Réglages par défaut » (`screen-guard.js:20`), « Réglages miroir de screen-guard » (`settings.js:1314`), « Réglages du contrôle de l'écran » (`mcp_config.rs:489`, `mcp-client.src.ts:81,293,493`), « Réglages consommés par la boucle du moniteur » (`anomaly.rs:693`) : sens commun, minuscule, aucun rapport avec le panneau.
- « **LOT A/LOT B « Reglages en onglet »** » (`main.js:79`, `settings.js:82,1728,1951`, `tabs.js`, `tab-scoping.js:44`, `style.css:3099`, titres de `reglages-lot-*.test.js`, `apercu-voix-parametres.test.js:239`, `super-agent.js:3499`) : nom d'un **document de conception** (`docs/proposition-reglages-en-onglet.md`). Le renommer casserait la référence au document ; il est laissé tel quel.
- `src/js/libelle-options-ecran.test.js` : ce verrou **documente** le renommage (« ce que l'utilisateur lit « Réglages » s'appelle désormais « Options » »). C'est sa raison d'être.

**Hors périmètre (fichiers non suivis, artefacts, archives) :** `dist/`, `.pilot/_goldtmp/`, `.pilot/mesure/`, `docs/proposition-barre-fenetre.md`, `docs/proposition-presentation-ui.md`, `docs/rapport-*.md` (rapports datés), `index.html` : identifiants internes (`btn-settings`, mode `settings`, `#settings-modal`) volontairement **non** renommés (décision du lot de renommage : seul le texte affiché change).

## 3. Ce qui reste faux et n'a PAS été corrigé (hors périmètre « textes seulement »)

1. **`src/js/taille-et-style-panneau.test.js:212` — `const DECALAGE_HAUT = 69;`**
   Depuis la suppression de la bande, le décalage réel du panneau est de **37 px**
   (rangée d'onglets : 36 px + 1 px de filet), la constante garde 32 px de trop.
   Effet mesuré : `hauteurPanneau(vp) + DECALAGE_HAUT <= vp.h` est **plus strict**
   qu'il ne devrait → **aucun débordement n'est masqué**, le test reste valide.
   Corriger la valeur est un **changement de test** : non fait, signalé ici.
2. **« Paramètres ⚙️ » au lieu de « Options » dans la documentation affichée.**
   79 lignes de specs + `help/overview.md` écrivent encore « Paramètres ⚙️ → Agent »,
   « Paramètres → Service Laya », etc. Ce n'est pas l'un des quatre thèmes de la
   mission (le mot n'est pas « Réglages ») et le corriger impose une réécriture
   de la doc embarquée + régénération du handbook : lot dédié à part entière.
   `help/overview.md:161` dit déjà « les Options s'ouvrent dans un onglet », ce qui
   rend l'incohérence visible à quelques lignes d'intervalle.
3. **`fiche-reference-pilot.md:240`** affirme « **43 blocs**, `help/handbook.md`
   **200 759 octets** ». Mesuré aujourd'hui : **45 blocs, 272 751 octets**. Fiche de
   référence périodique (beaucoup d'autres chiffres datés) : non touchée, signalée.
4. **`src-tauri/src/help.rs` — `get_handbook`** n'a plus aucun appelant côté écran
   (l'écran qui l'utilisait a été retiré). API morte, sans texte faux : laissée
   en place (la retirer est un changement de code et des commandes Tauri).

## 4. État de la documentation embarquée (vérifié par la mesure)

`help/handbook.md` est inclus à la compilation par `include_str!` (`src-tauri/src/help.rs:47`).

- **Avant** mes corrections : sauvegarde du fichier, `node scripts/build-handbook.js`
  → 45 blocs / **272 636** octets, `diff` avec la sauvegarde **identique** : la
  documentation embarquée était **à jour**.
- **Après** mes corrections de `help/overview.md` : régénération → 45 blocs /
  **272 751** octets, puis **seconde** régénération → `diff` **identique** : le
  fichier embarqué est de nouveau **exactement** le dernier généré.
- Un test existant verrouille déjà cette propriété :
  `src/js/help-delai-inactivite.test.js` — « l'aide intégrée générée est à jour
  (`npm run build:handbook`) ». Il passe.

## 5. Comptes de tests (avant / après, identiques)

| Suite | Avant | Après |
|---|---|---|
| `npx vitest run` | **3153** PASS / **0** FAIL | **3153** PASS / **0** FAIL |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **775** passed, **1** ignored | **775** passed, **1** ignored |

Aucun test supprimé, aucun test ajouté, aucune assertion modifiée (dans les
fichiers de test, seuls des commentaires et des `describe(...)`/`it(...)` — des
chaînes de titre — ont changé).

## 6. Fins de ligne

`.gitattributes` force `eol=lf` sur les fichiers texte : les fichiers modifiés ont
été écrits sans conversion (aucun `CRLF` introduit), vérifié par
`git diff --stat` (112 insertions / 96 suppressions, sans réécriture globale).

VERDICT : les quatre thèmes de l'ancien monde sont traités — bande de 32 px (1 commentaire Rust faux + 3 formulations de tests), écran « Aide » (3 commentaires Rust + 1 paragraphe d'aide affiché), « Réglages » → « Options » (53 lignes de code/tests) et second moyen de lire la documentation (1 affirmation d'aide **démontrée fausse** et corrigée) ; la documentation embarquée était à jour avant et l'est de nouveau après régénération mesurée, les deux suites de tests donnent des comptes strictement identiques (3153/0 et 775+1), et les trois restes qui exigeraient du code ou une réécriture de la doc affichée sont signalés ci-dessus sans avoir été touchés.
