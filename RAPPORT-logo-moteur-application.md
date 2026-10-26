# RAPPORT D'APPLICATION — logo du bandeau + libelle du moteur

Mission : appliquer **tel quel** le cadrage de `RAPPORT-bandeau-logo-moteur.md`
(lots **A**, **A2**, **B**). Les trois questions de ce cadrage etant deja
tranchees, elles n'ont pas ete rouvertes. Le lot C (logo pale en theme clair)
n'a **pas** ete touche.

---

## 1. Etat avant / apres

| Element | Avant | Apres |
|---|---|---|
| `#btn-project-logo` — `height` | `20px` | **`24px`** (lot A) |
| `#btn-project-logo` — `margin-left` | *(aucune)* | **`-3px`** (lot A2) |
| Sous-titre du moteur (`#project-engine`) | `agentDisplayLabel()` → « Agent Pi » | **`"Moteur · " + agentDisplayLabel()`** → « Moteur · Agent Pi » (lot B) |
| Fichier image du logo | `public/logo_pilot_vector.svg` | **inchange** (aucun recadrage) |
| Hauteur du bandeau `#project-selector` | `48px` | **`48px`** (inchange) |
| Largeur de la colonne `#sidebar` | `280px` (min 280) | **inchangee** |
| Trois boutons du coin haut droit | 46 x 28 px, air 4 px | **inchanges** (autre rangee, aucun contact) |
| Ecran de chargement `#boot-logo` | `width: 160px` | **inchange** (regle propre) |
| Filigrane `#empty-logo` | `width: 65%`, `opacity .08` | **inchange** (regle propre) |
| Les DEUX affichages du moteur | bandeau + barre du bas | **les deux conserves** — aucun retire |

Le libelle suit **les deux moteurs** : la source unique reste
`agentDisplayLabel()` (`src/js/backend-info.js:69-71`), donc « Moteur · Agent Pi »
**ou** « Moteur · Agent PLh » selon la sonde, et le texte se corrige a chaque
re-sonde (`pilot-backend-changed`). Le mot ajoute est devant, jamais a la place.

---

## 2. Mesures recalculees sur le disque (pas reprises du cadrage)

Source des mesures : `src/css/style.css` (bandeau 48 px, remplissage
`8px 8px 8px 16px`, filet 1 px → **31 px utiles** ; colonne 280 px), encre reelle
du SVG relevee dans `public/logo_pilot_vector.svg` : **x 30 → 188, y 16 → 210**
sur une boite `224 x 225`. Calculs reproduits par script (`node -e`), pas a la main.

| Grandeur | Avant (20 px) | Apres (24 px + -3 px) | Ecart |
|---|---|---|---|
| Boite du logo | 19,911 px de large | **23,893 px** | +3,982 |
| Bord gauche de la BOITE | 16,00 px | **13,00 px** | -3,00 |
| Bord gauche du **DESSIN** | **18,67 px** | **16,20 px** | **-2,47** (regle d'inset 16 px respectee a 0,2 px) |
| Largeur du dessin | 14,04 px | **16,85 px** | +2,81 |
| Hauteur du dessin | 17,24 px | **20,69 px** | +3,45 |
| Air au-dessus / au-dessous de la boite | 5,50 / 5,50 px | **3,50 / 3,50 px** | -2,00 |
| Air reellement vu autour du dessin | 6,92 px | **5,21 px** | -1,71 |
| Place du nom + sous-titre | 144,59 px | **143,61 px** | -0,98 (l'agrandissement est presque entierement rendu) |

Conclusion : le bandeau **n'est jamais touche** (31 px utiles pour une boite de
24 px = 3,5 px d'air en haut et en bas, comme annonce), et le dessin visible
repart bien du meme bord que le texte au-dessous.

---

## 3. Ce que j'ai verifie explicitement

| Point a ne pas bouger | Verification |
|---|---|
| Hauteur du bandeau | `#project-selector` toujours `height: 48px` — verrouille par `lot2-colonne-haut.test.js` (vert) |
| Largeur de la colonne | `#sidebar` toujours `width/min-width: 280px` — non touche |
| Trois boutons du coin haut droit | `#window-controls` non touche ; autre rangee |
| Ecran de chargement + filigrane | `#boot-logo` et `#empty-logo` ont leurs **propres** regles ; seul `#btn-project-logo` change ; **le SVG n'est pas recadre** |
| Les deux affichages du moteur | bandeau = `main.js:634` ; barre du bas = `tabs.js` (« (Suivi) » / « (RPC) ») — **non touchee** |
| Aucune valeur en dur | la regle ne contient que des longueurs ; `.project-engine` garde `11 px`, `--text-secondary`, l'ellipse et `.project-engine:empty { display: none; }` (test vert) |
| Une seule source du libelle | `backend-info.js` inchange ; `main.js` continue de contenir `agentDisplayLabel()` **ecrit tel quel** (le test du bandeau le cherche litteralement) |

---

## 4. Fichiers touches (3 + ce rapport)

| Fichier | Retouche |
|---|---|
| `src/css/style.css` | `#btn-project-logo` : `height: 20px` → `24px` ; ajout `margin-left: -3px` ; commentaire du bloc mis a jour. Commentaire du bandeau (« logo 24 px ») aligne. |
| `src/js/main.js` | `syncEngineSubtitle` : `textContent = "Moteur · " + agentDisplayLabel()` + commentaire. |
| `index.html` | **commentaire HTML seulement** du bandeau (« Logo 24 px ») — aucun identifiant, aucune classe, aucune structure modifies. |
| `RAPPORT-logo-moteur-application.md` | ce rapport (nouveau, a la racine). |

Aucun autre fichier n'a ete modifie. Le dossier `dist/` a ete regenere par le
controle de build (ignore par Git).

---

## 5. Tests et compilation — resultats exacts

```
# AVANT modification (reference)
npm test   ->  Test Files 184 passed (184) | Tests 3219 passed (3219)

# APRES modification
npx vitest run src/js/lot2-colonne-haut.test.js  ->  PASS (27) FAIL (0)
npm test   ->  Test Files 184 passed (184) | Tests 3219 passed (3219)

# controle de build (CSS/JS reellement compiles)
node node_modules/vite/bin/vite.js build  ->  "built in 15.09s"
   CSS produit : btn-project-logo{height:24px;width:auto;flex:0 0 auto;
                 object-fit:contain;margin-left:-3px}
```

**Aucun test n'a eu besoin d'etre mis a jour.** Verification faite avant de
modifier : aucun test ne nomme `#btn-project-logo` (`grep` exhaustif sur
`src/js/*.test.js`), et le seul test qui parle du sous-titre
(`lot2-colonne-haut.test.js`, § « LOT 2 (h) ») cherche la presence de
`agentDisplayLabel()` et de la ligne d'ecoute `pilot-backend-changed` — les deux
sont conservees intactes. Le test « aucun texte du bandeau ne depasse 13 px » ne
regarde que des `font-size` : une hauteur d'image ne le concerne pas.

`cargo test` n'a pas ete lance : la mission ne touche **aucun** fichier Rust.

---

## 6. Controle visuel — ce que j'ai pu faire, et ce que je n'ai pas pu faire

**Non fait, dit franchement :** je n'ai **pas** capture le rendu a l'ecran.
- Le pont Chrome (`chrome_*`) a refuse : « the Chrome extension is not polling » ;
- aucun navigateur sans fenetre n'est installe dans le projet (ni puppeteer, ni
  playwright, ni jsdom) ;
- lancer l'application (`npm run tauri dev`) depasse le cadre de cette mission
  (compilation lourde, fenetre non capturable par mes outils).

**Ce que j'ai fait a la place :** serveur de developpement Vite demarre pour
verifier que la page et la feuille se chargent sans erreur (demarre puis arrete),
build complet vert, et **mesures recalculees sur le SVG et le CSS reels** (§ 2),
plus la lecture du CSS produit par le build.

**Deux chiffres restent des estimations** (comme le signalait deja le cadrage) :
la largeur du texte « Moteur · Agent Pi » a 11 px (de l'ordre de 90 px pour
**143,61 px** disponibles — marge confortable sur **une** ligne, ellipse toujours
en place si la place manquait), et le rendu du dessin a 24 px sur un ecran a
forte densite.

---

## 7. Ecarts entre le cadrage et le disque — signales, non corriges

1. **Libelle ecrit en dur (hors perimetre) — SIGNALE SEULEMENT.** L'onglet des
   reglages s'appelle « Agent Pi » en texte **fige** : `index.html:499`
   (le cadrage indiquait `index.html:469` : la ligne a bouge depuis, l'endroit
   est le meme). Ce libelle **peut mentir** si c'est PLh qui tourne. Il n'est
   pas dans le perimetre des lots A / A2 / B : je ne l'ai **pas** corrige.
   *(Note : `index.html:707` est un titre « Agent Pi ou PLh », qui est correct
   puisqu'il nomme les deux.)*
2. **Position du menu « Projets » : coherent, rien a faire.** `.projects-dropdown`
   est a `left: 16px` (`style.css:1198`), avec un commentaire « il demarre sous
   le logo ». Avec le lot A2, la **boite** du logo commence a 13 px mais le
   **dessin** a 16,2 px : le menu s'aligne donc desormais sur ce que l'oeil voit
   (16 px) et non plus sur la boite. L'alignement est *meilleur* qu'avant, aucun
   code n'est a changer — simplement a savoir si quelqu'un relit ce commentaire.
3. **Aucune valeur du cadrage ne s'est revelee fausse sur le disque :** encre du
   SVG (30/188, 16/210), 31 px utiles dans le bandeau, 280 px de colonne,
   transparence laterale, place rendue au nom (143,61 px pour ~143,6 annonces)
   sont exacts. Le cadrage annoncait 2 chiffres en estimation : je les ai
   recalcules, ils tombent au dixieme.
4. **Documentation : rien a mettre a jour.** Aucun fichier de doc ne figeait les
   anciennes valeurs (`grep` sur « logo 20 px », « 48 px », « sous-titre du
   moteur », « project-engine » dans `README.md`, `spec_pilot.md`,
   `help/overview.md` : aucune occurrence). Le handbook n'a donc pas eu besoin
   d'etre regenere (`npm run build:handbook` sans objet ici).

---

## 8. Ce qui reste a faire

- **Lot C (non demande, non fait)** : logo pale en theme clair (contraste cyan
  1,33 a 1,64:1). Sujet separe, a trancher.
- **Libelle figé des reglages** (`index.html:499`) — a corriger dans une mission
  dediee si vous le voulez dynamique.
- **Controle a l'oeil humain** : a 280 px de colonne, verifier que « Moteur ·
  Agent Pi » tient sur une ligne, que le logo ne touche ni le haut ni le filet du
  bas, et l'effet de la marge de -3 px dans votre densite d'ecran.
