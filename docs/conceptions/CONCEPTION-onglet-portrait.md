# Conception — l'onglet « Portrait » (le personnage de Présences dans Pilot)

Statut : **conception écrite, aucun code écrit**. Rien d'autre que ce fichier
n'a été modifié.

Demande du propriétaire, mot pour mot : « juste un onglet avec la photo du
personnage choisi », **dans la liste des onglets d'agents, en haut à droite**.

Le personnage vit **dehors** : c'est le projet « Présences » qui tient la fiche
et le carnet de mémoire, et qui fait générer le portrait par une IA d'image à
partir d'une description écrite. Pilot ne connaît aujourd'hui **rien** de
Présences : aucune occurrence de `portrait`, `Présences`, `Presences` dans
`src/`, `src-tauri/src/`, `index.html`, `web/`. Tout est donc à créer, et ne
doit dépendre d'aucun mécanisme supposé.

---

## 1. L'état actuel, prouvé

### 1.1 La rangée du haut, et ce qu'elle contient

| Élément | Preuve | Rôle |
|---|---|---|
| `#tab-row` | `index.html:280` | la rangée de 36 px en haut de la fenêtre |
| `#tab-bar` | `index.html:281` | **les onglets** (fichiers, agents π, 🧭, 📊) |
| `#agent-activity` + bouton `#agent-activity-entry` « Travail » | `index.html:307` à `309` | l'entrée du suivi du travail |
| les **trois** onglets du panneau : « Agents », « Tâches », « Événements » | `index.html:315` à `318` | **déjà tranchés, on n'y touche pas** |
| `#window-controls` | `index.html:362` à `372` | Réduire / Agrandir / Fermer |

Géométrie, prouvée dans la feuille de styles :

- rangée : `display:flex`, `min-height: 36px` → `src/css/style.css:2016` à `2022` ;
- barre d'onglets : `flex: 1 1 auto`, **`min-width: 0`**, `overflow-x: auto` →
  `src/css/style.css:2030` à `2038` (c'est **elle** qui cède quand la place
  manque, jamais le reste) ;
- ligne normative de la rangée = **28 px** (36 − 2 × 4 px de remplissage) : c'est
  écrit noir sur blanc pour les boutons de fenêtre → `src/css/style.css:111` à
  `116` ;
- bouton « Travail » : 22 px de haut, `gap: 6px`, `padding: 0 8px`, rayon
  `--radius-sm`, texte `--font-xs` (11 px) `600` →
  `src/css/style.css:2165` à `2193` ;
- marge de « Travail » dans la rangée : `margin: 0 6px 0 4px` →
  `src/css/style.css:2138` ;
- **colonne de gauche figée à 280 px**, hors sujet ici mais à ne pas bouger :
  `src/css/style.css:782` à `784` (`width`/`min-width`).

Trois verrous de test encadrent cette zone :

- `src/js/barre-fenetre-etats.test.js:203` à `219` : l'ordre du DOM est contrôlé
  **par paires croissantes** — `barre < Travail < boutons`, puis
  `contenu > boutons`. Insérer un élément **entre la barre et « Travail »**
  laisse ces quatre assertions vraies ;
- `src/js/panneau-suivi-trois-onglets.test.js:1` à `20` : les trois onglets du
  panneau sont verrouillés (nom, ordre, volets). On n'y touche pas ;
- `npm test` doit rester vert (protocole qualité).

### 1.2 Ce que « la liste des onglets d'agents » désigne réellement

Le propriétaire dit « la liste des onglets d'agents ». Dans Pilot, cette liste
existe à **un** endroit et un seul : ce sont les onglets de `#tab-bar`
(`index.html:281`), ceux qu'ouvre le bouton « ＋ » (`src/js/tabs.js:234` à
`244`, titre « Nouvel onglet agent indépendant »), dont les onglets π, 🧭 et 📊.
Le panneau de droite, lui, s'appelle « Travail » et ses trois onglets sont
« Agents / Tâches / Événements » — c'est une **liste d'agents qui travaillent**,
pas une liste d'onglets.

Conséquence : le portrait ne peut pas être un **quatrième onglet du panneau**
(ce serait rouvrir une chose tranchée, et le panneau se referme : la photo
disparaîtrait), et il ne peut pas non plus être un onglet **dans** `#tab-bar` :
`src/js/tabs.js:3028` à `3095` fabrique les enfants de la barre en supposant
qu'ils sont « les onglets + le bouton ＋ », et surtout une barre pleine **fait
défiler** ses onglets (`src/css/style.css:2034`) : avec vingt onglets ouverts, le
portrait sortirait de l'écran. Or le propriétaire veut **voir** le personnage.

**La place juste** est donc celle qui est déjà utilisée pour un élément qui n'est
pas un onglet mais qui doit rester visible : son **propre conteneur dans la
rangée**, à côté de « Travail » — exactement le motif de l'entrée « Travail »
(`index.html:307`, commentaire de `index.html:270` à `279` : chaque bloc a son
conteneur, rien n'entre dans la barre).

---

## 2. La cible — où

### 2.1 Place exacte et ordre

Un nouveau conteneur `#portrait-entry-zone`, **entre `#tab-bar` et
`#agent-activity`** :

```
aujourd'hui   [ onglets ……………… (défile) ][ ● Travail 2/5 ][ − ▢ ✕ ]
après         [ onglets ……………… (défile) ][ ▣ Camille ][ ● Travail 2/5 ][ − ▢ ✕ ]
                                             ↑ nouveau : c'est un ONGLET (28 px)
```

Pourquoi **à gauche** de « Travail » et pas à droite :

1. « Travail » ne bouge pas : il garde exactement sa distance actuelle aux
   boutons de fenêtre, donc les **4 px d'air** autour d'eux et la décision « la
   croix ne touche plus le bord » restent intacts (décisions du coin haut droit,
   `docs/rapports/RAPPORT-coin-haut-droit.md`) ;
2. l'entrée ne se colle pas à « Réduire » — un clic à côté d'un bouton de fenêtre
   est une erreur qu'on ne veut pas provoquer ;
3. l'ordre du DOM reste **croissant** pour le verrou existant
   (`barre-fenetre-etats.test.js:203`) : `barre < portrait < Travail < boutons`.

Ce n'est **pas** un bouton de plus avec un mot : c'est un **onglet** de 28 px
(même hauteur que les onglets, `src/css/style.css:111` à `116`), qui porte la
photo et le nom.

### 2.2 Ce qui se passe si la zone est déjà pleine

| Situation | Ce qui arrive | Preuve / règle |
|---|---|---|
| 20 onglets ouverts dans la barre | rien : l'entrée n'est **pas** dans la barre, elle ne défile pas et reste visible | `src/css/style.css:2030` à `2038` |
| fenêtre à sa largeur minimale (800 px) | c'est la **barre** qui cède (`min-width: 0`) ; l'entrée garde sa vignette entière | `src-tauri/tauri.conf.json:47` ; `src/css/style.css:2033` |
| nom de personnage très long | le libellé est coupé par des points de suspension à **96 px** ; le nom entier reste dans l'infobulle | motif déjà en place : `.tab .tab-name` à 160 px, `src/css/style.css:2657` |
| la rangée ne peut plus rien absorber | **jamais deux lignes** : la rangée reste à 36 px | `src/css/style.css:2020` |

### 2.3 L'écran « Portrait » (le vrai onglet, dans la barre)

Un clic sur l'entrée ouvre un onglet **réel** dans la barre, comme le Tableau de
bord ou le Coffre. Un seul à la fois : on réutilise le motif « un seul onglet de
ce type » déjà écrit pour 📊 (`src/js/tabs.js:1038` à `1043` : on cherche
`mode === "dashboard"` avant d'en créer un).

- `mode: "portrait"`, libellé d'onglet **fixe : « Portrait »**, jamais
  renommable (les onglets d'agent se renomment par double-clic,
  `src/js/tabs.js` ; celui-ci non). C'est l'esprit de la décision **D3** déjà
  fermée (« nom d'onglet fixe, le moteur en sous-titre ») : le nom de l'onglet
  dit **la chose**, le contenu dit **qui** ;
- fermeture par la croix : l'entrée, elle, reste (voir §2.4) ;
- l'onglet **n'est pas** enregistré dans la session d'onglets : au démarrage,
  rien ne dépend du dossier (voir §8) ;
- les deux surfaces parlent du même état : l'entrée porte
  `aria-expanded="true"` quand l'onglet « Portrait » est l'onglet actif (la
  bascule passe par le chemin existant `switchTab`, `src/js/tabs.js:2229`),
  sans second mécanisme ;
- **aucun projet n'est nécessaire** : comme l'entrée « Travail »
  (`index.html:307`, pas de classe `project-only`), l'entrée existe même sans
  projet ouvert — le personnage appartient à l'utilisateur, pas au dossier.

### 2.4 L'entrée reste après la fermeture de l'onglet

C'est le point qui rend le portrait **trouvable sans réglage** : il n'y a pas de
menu à ajouter, pas de raccourci à retenir, pas d'onglet à rouvrir « quelque
part ». L'entrée est là, elle ouvre, elle referme. Si l'entrée disparaissait avec
l'onglet, il n'y aurait **aucun** moyen de rouvrir le portrait — donc elle reste.

### 2.5 Les deux pleins écrans

L'entrée vit dans la rangée, qui n'existe pas en « Assistant seul » ni en
« Vocal » (seul le **logo** est déplacé dans l'overlay, décision déjà fermée :
`src/js/screen-mode.js:1` à `21`, `CONCEPTION-logo-bouton-des-trois-modes.md`).
Elle est donc simplement absente de ces deux écrans, et le mode « Détaillé » est
défini comme « rangée d'onglets + colonne de 280 px, inchangée »
(`src/js/screen-mode.js:4` à `5`). Aucun portage, aucune duplication.

---

## 3. La cible — l'apparence

Tout est pris dans les jetons existants. **Aucune couleur écrite en dur.**

### 3.1 L'entrée (hauteur 28 px, comme un onglet)

| Propriété | Valeur | Pourquoi |
|---|---|---|
| hauteur | **28 px** | la ligne des onglets (`src/css/style.css:111` à `116`) |
| remplissage | `0 8px` | même famille que « Travail » (`src/css/style.css:2175`) |
| écart interne | `6px` | idem (`src/css/style.css:2173`) |
| rayon | `--radius-sm` = 6 px | `src/css/style.css:305` |
| libellé | `--font-sm` = 12 px, `400` | échelle de texte figée : 11 / 12 / 13 / 15 px, « aucune autre taille » (`src/css/style.css:297` à `301`) |
| largeur du libellé | `max-width: 96px` + `…` | `src/css/style.css:2657` |
| marge | `0 6px 0 2px` | 10 px entre le portrait et « Travail » |
| vignette | **20 × 20 px**, `--radius-xs` = 4 px, bordure 1 px `--border-subtle`, `object-fit: cover`, `object-position: 50% 25%` (le visage, jamais le haut du crâne) | lisibilité dans 28 px |
| icône de remplacement | `user` 12 px, `--text-secondary`, sur un carré 20 × 20 `--surface-2` | voir §3.4 |

**États — on n'invente aucune recette** : c'est la règle d'états unique du
lot 1 de la présentation (`src/css/style.css:11493` à `11512`), celle que
« Travail » applique déjà dans cette rangée (`src/css/style.css:2186` à `2194`) :

| État | Fond | Bordure | Texte |
|---|---|---|---|
| repos | transparent | transparente | `--text-secondary` |
| survol | **`--surface-3`** — et non `--surface-2` | `--border-subtle` | `--text-primary` |
| ouvert (l'onglet « Portrait » est l'onglet actif, `aria-expanded="true"`) | accent 14 % (`color-mix`) | accent 40 % | `--text-primary` |
| appui | `transform: scale(0.97)` | — | — |
| **désactivé** | **n'existe pas** : aucun code ne pose `disabled`, même constat déjà écrit pour « Travail » (`src/css/style.css:2103`) | | |
| clavier | `outline: 2px solid var(--accent)`, `outline-offset: 1px` | | |

Pourquoi `--surface-3` et pas `--surface-2` au survol : la rangée est peinte avec
`--bg-sidebar`, qui **vaut** `--bg-app` (`src/css/style.css:405` et `508`), et le
projet a déjà constaté qu'« un élément posé sur le fond de l'application garde
`--surface-3` en survol (`--surface-2` y serait invisible) »
(`src/css/style.css:11510` à `11511`).

L'état « ouvert » est publié par **`aria-expanded`**, exactement comme pour
« Travail » (`src/css/style.css:2190` à `2194`) : aucun état n'est tenu en double
dans le JS.

### 3.2 L'écran (le contenu de l'onglet)

Une seule colonne centrée horizontalement, à **48 px du haut** — donc le même
cadre dans les quatre états : **rien ne saute** quand l'état change.

| Élément | Valeur |
|---|---|
| cadre | **240 × 320 px** (ratio portrait 3:4), `--radius-md` = 8 px, bordure 1 px `--border-subtle`, fond `--surface-2` |
| image | `object-fit: contain` — **jamais de recadrage du visage**, des bandes `--surface-2` si l'image n'est pas au ratio |
| nom | `--font-base` = 13 px, `600`, `--text-primary`, centré, 12 px sous le cadre, 1 ligne, `max-width: 320px` |
| légende d'état | `--font-xs` = 11 px, `400`, `--text-secondary`, 6 px sous le nom |
| silhouette | `user` 48 px, `--text-secondary`, centrée dans le cadre |

Rien d'autre : **pas de nom de palier de relation**, pas de barre d'outils, pas de
zoom, pas de bouton « changer ». Le palier de relation est une donnée de
Présences qui bouge, et il mettrait sous le portrait un second texte qui ne parle
pas du travail dans Pilot. Le contenu recommandé est **l'image + le nom**, et
c'est tout.

### 3.3 Les quatre états (mots exacts affichés)

| # | Condition | Entrée (rangée) | Titre de l'écran | Légende |
|---|---|---|---|---|
| 1 | ni nom, ni image | vignette de remplacement + libellé « **Portrait** », infobulle « Portrait — aucun personnage » | « **Aucun personnage** » | « Aucun personnage choisi dans Présences. » |
| 2 | un nom, pas d'image | idem, libellé = le nom | le nom | « **Portrait à venir.** » |
| 3 | image lisible | vignette = l'image, libellé = le nom | le nom | *(aucune)* |
| 4 | image présente mais illisible, ou > 8 Mo | vignette de remplacement + le nom | le nom | « **Portrait illisible.** » |

Ce qui n'arrive **jamais** : un cadre vide, une fenêtre d'erreur, un texte rouge,
une icône « image cassée » seule, un écran blanc, une exception dans la console
visible par l'utilisateur.

### 3.4 Pourquoi `user` et pas `user-round`

`user-round` est **déjà pris** : c'est l'icône de l'onglet de réglages
« Avatar (PLface) » (`index.html:551` et `654`). Une silhouette différente évite
de faire croire que le portrait du personnage est l'avatar de Pilot.

### 3.5 Contrastes, calculés (pas supposés)

| Texte | Sur | Sombre | Clair |
|---|---|---|---|
| nom (état 3, 2, 4) `--text-primary` | `--bg-app` | **15,4 : 1** | **15,5 : 1** |
| légende `--text-secondary` | `--bg-app` | **7,75 : 1** | **5,70 : 1** |
| libellé de l'entrée au repos `--text-secondary` | `--bg-sidebar` (= `--bg-app`, `src/css/style.css:405` et `508`) | 7,75 : 1 | 5,70 : 1 |
| libellé au survol `--text-primary` | `--surface-3` | **11,7 : 1** | **13,8 : 1** |
| libellé ouvert `--text-primary` | accent 14 % sur le fond de la rangée | **12,9 : 1** | **13,1 : 1** |

Tout dépasse **AA (4,5 : 1)** dans les deux thèmes. C'est aussi la raison pour
laquelle `--text-muted` n'est utilisé **nulle part** ici : il tombe sous 3 : 1
dans certains contextes (constat déjà écrit dans `src/css/style.css:5618` à
`5621`).

---

## 4. La source de l'image

### 4.1 Le dossier (hors dépôt, hors projet)

```
Windows : C:\Users\<vous>\.pilot\portrait\
macOS   : /Users/<vous>/.pilot/portrait/
Linux   : /home/<vous>/.pilot/portrait/
```

`~/.pilot/` est **déjà** le dossier personnel de Pilot, prouvé à trois endroits :
le coffre `~/.pilot/vault.json` (`src-tauri/src/vault.rs:85` à `91`), l'espace
d'écriture de l'assistant `~/.pilot/assistant/` (`src-tauri/src/lib.rs:2061`),
la base de suivi `~/.pilot/super-agent.db` (`src-tauri/src/super_agent.rs:4`).
On ne crée **rien** de nouveau à la racine de l'utilisateur.

### 4.2 La règle de nommage

| Fichier | Rôle | Obligatoire |
|---|---|---|
| `portrait.png` | l'image | oui, **ou** `portrait.jpg`, **ou** `portrait.jpeg`, **ou** `portrait.webp` |
| `nom.txt` | 1ʳᵉ ligne = le nom du personnage (espaces de début/fin retirés, 40 caractères maximum) | non |

- **priorité fixe** si plusieurs images cohabitent : `png` > `jpg` > `jpeg` >
  `webp`. Jamais « la plus récente » : une règle invisible se paierait un jour ;
- **on ne liste jamais le dossier** : on teste `nom.txt` et les quatre noms, dans
  cet ordre. Cinq lectures de métadonnées au plus, aucun parcours, aucune
  surprise si le dossier contient autre chose ;
- formats acceptés : **PNG, JPEG, WebP**. Refusés : GIF (il clignote — contraire
  à « aucun clignotement »), SVG (un vecteur peut porter du script), BMP, TIFF.
  Un fichier refusé donne l'état 4, jamais une erreur ;
- **Pilot n'écrit jamais dans ce dossier** : il ne crée, ne renomme, ne supprime,
  ne déplace rien. Le dossier appartient à Présences et au propriétaire.

### 4.3 Taille et lecture

| Point | Valeur | Preuve du moyen employé |
|---|---|---|
| garde-fou de taille | **8 Mo** au-delà → état 4, l'image n'est pas lue | `get_file_size` (`src-tauri/src/files.rs:177` à `182`) |
| lecture | une seule fois, en octets, puis un `data:` URI **partagé** par la vignette et l'écran | `read_file_binary` (`src-tauri/src/files.rs:19` à `21`, enregistré `src-tauri/src/lib.rs:3699`) ; conversion existante `imageToBase64` (`src/js/preview.js:297` à `311`) |
| type MIME | table existante `MIME_MAP` (`src/js/preview.js:278` à `290`) | aucune table en double |
| protocole d'assets | **aucun** : `tauri.conf.json` n'expose ni `assetProtocol` ni `scope`, donc le base64 est la seule voie, et c'est celle du code existant | — |

### 4.4 Où le nom apparaît

- dans l'entrée de la rangée (libellé, 96 px, infobulle complète) ;
- dans l'écran (13 px, sous le cadre) ;
- dans l'attribut `alt` de l'image, ce qui **interdit** que l'image soit le seul
  repère pour un lecteur d'écran.

---

## 5. Le rafraîchissement (le fichier change)

Ce qui existe déjà : **le seul observateur de fichiers du projet ne regarde que
le dossier du projet** (poller maison, `read_dir` filtré, 2 s,
`src-tauri/src/lib.rs:1538` et suivantes). Il n'observe pas `~/.pilot/` et ne
doit pas s'y étendre. **Aucun nouvel observateur n'est créé.**

Ce qui manque et qui existe déjà comme brique : `file_mtime`
(`src-tauri/src/files.rs:187` à `197`, horodatage en ms).

Règle de rafraîchissement, en trois déclencheurs :

1. **à l'ouverture** de l'écran : on relit (une fois) ;
2. **quand l'onglet redevient actif** : le motif est déjà écrit pour 📊, pour le
   Kanban et pour GDS — `src/js/tabs.js:2295` à `2313` (`si l'onglet redevient
   actif, on recharge`) ;
3. **quand la fenêtre reprend le focus** : un seul test de date, et une relecture
   seulement si la date a changé.

Plus, **une lecture de date toutes les 5 secondes, et seulement quand la fenêtre
a le focus**. C'est moins cher que ce qui tourne déjà (le poller du projet
parcourt l'arborescence toutes les 2 s) : ici c'est **une** lecture de
métadonnées, et **zéro octet** d'image relu tant que la date ne change pas.

S'il n'y a **pas** de focus (fenêtre derrière une autre), **rien** ne tourne.

**Aucun clignotement** : quand la date change, la nouvelle image est décodée
**avant** d'être posée ; l'ancienne reste affichée pendant ce temps. Jamais de
cadre vide entre les deux, jamais de retour à la silhouette.

Un changement est vu en **5 secondes au plus** (ou immédiatement au retour sur
Pilot).

---

## 6. Accessibilité et sobriété

| Exigence | Mise en œuvre |
|---|---|
| taille minimale lisible | plancher du projet : **11 px** ; aucun texte en dessous (`src/css/style.css:297` à `301`). Le nom est à 13 px, la légende à 11 px, le libellé de l'entrée à 12 px |
| alternative textuelle | l'entrée est un `<button>` avec `title` **et** `aria-label` identiques (motif verrouillé pour les boutons de fenêtre, `src/js/barre-fenetre-etats.test.js:230` à `241`) : « Portrait de Camille » / « Portrait — aucun personnage ». L'image porte `alt` = le nom. Dans les états 1, 2 et 4, la silhouette est `aria-hidden="true"` : c'est le **texte** qui porte le sens |
| clavier | l'entrée est atteignable au `Tab`, anneau `outline: 2px solid var(--accent)` (règle globale `src/css/style.css:11541`) |
| mouvement réduit | **rien ne bouge** dans cette fonction : aucune animation, aucun fondu, aucun pulsation. Seules les transitions de survol de 0,1 s de la rangée s'appliquent (`--transition-fast`, `src/css/style.css:310`), comme pour « Travail ». `prefers-reduced-motion` n'a donc rien à désactiver |
| image jamais seul repère | le nom est écrit **à côté** de la vignette et **sous** le cadre ; les états 1, 2 et 4 n'ont aucune image |
| sobriété | une vignette de 20 px, un cadre de 240 px, deux lignes de texte. Aucun badge, aucune pastille, aucun compteur, aucune infobulle clignotante |

---

## 7. Les trois décisions déjà fermées qu'on ne rouvre pas

| Décision | Preuve | Cette conception |
|---|---|---|
| **D1** — trois boutons de fenêtre nommés + menu | `docs/proposition-navigation.md:607` et suivantes ; `docs/proposition-presentation-ui.md:13` à `16` | inchangés |
| **D2** — le Coffre descend dans les Réglages | idem | inchangé |
| **D3** — nom d'onglet fixe, le moteur en sous-titre | idem | appliqué : l'onglet s'appelle « Portrait », le nom du personnage est dans l'écran |
| **D4** — le panneau « Travail » s'ouvre au clic, pas au survol | idem | on ne touche pas au panneau, donc acquis |
| **D5** — fusion des Paramètres après les étapes 1 à 7 | idem | inchangée |
| trois réponses du **25/10** : « Lancer l'agent » en première ligne, « Dossier du projet » remonte, plafond du bloc 40 % → 50 % | `docs/proposition-presentation-ui.md:172` à `179` | on ne touche pas au bloc du bas |
| le coin haut droit : 4 px d'air autour des boutons, « Fermer » ne touche plus le bord | `docs/rapports/RAPPORT-coin-haut-droit.md` | l'entrée est **à gauche** de « Travail » : les boutons ne bougent pas d'un pixel |
| colonne de gauche 280 px | `src/css/style.css:782` à `784` | intouchée |
| tableau de bord dans les outils du bas | `index.html:225` (`#btn-dashboard` dans « Autres écrans ») | intouché |
| les trois onglets du panneau | `index.html:315` à `318` | intouchés |

---

## 8. Ce qui doit rester vrai (anti-régression)

| Garantie | Comment elle tient |
|---|---|
| **aucun nouveau réglage** dans les Paramètres | il n'y a rien à régler : le dossier est le commutateur, documenté. Le dossier absent = l'entrée n'existe pas (voir ligne suivante) |
| **le démarrage n'est jamais cassé si le dossier est absent** | **une** interrogation du dossier au démarrage ; s'il est absent, l'entrée n'est pas dessinée, aucun minuteur n'est armé, aucune exception n'est possible. Le reste de Pilot ne connaît pas cette fonctionnalité |
| **aucun impact sur les performances** | dossier absent : 1 test. Dossier présent : 1 lecture d'image bornée à 8 Mo, une seule fois, partagée entre vignette et écran. Ensuite : 1 lecture de date / 5 s, et seulement fenêtre au premier plan, et **zéro** octet relu sans changement |
| **l'onglet ne casse rien** | il n'est pas enregistré dans la session d'onglets ; il n'entre pas dans `#tab-bar` ; il ne touche ni l'ordre des onglets (`src/js/tabs.js:3070` à `3095`) ni le panneau |
| **le verrou d'ordre du DOM reste vert** | `src/js/barre-fenetre-etats.test.js:203` à `219` vérifie `barre < Travail < boutons` : insérer entre la barre et « Travail » ne change aucune de ces inégalités |
| **le personnage « normal » a un état dit** | état 1 : « Aucun personnage » + « Aucun personnage choisi dans Présences. » (voir §3.3) |
| **thème clair et sombre** | uniquement des jetons (`--surface-2`, `--surface-3`, `--text-primary`, `--text-secondary`, `--border-subtle`, `--accent`) ; contrastes calculés au §3.5 ; la bande du cadre reste visible dans les deux thèmes grâce à la bordure `--border-subtle` |
| **aucun appel réseau** | tout est local |
| **Pilot reste lecture seule sur les données de Présences** | il lit, il n'écrit jamais |

---

## 9. Les lots (3, chacun essayable seul par le propriétaire)

### Lot 1 — « le cadre » (l'image posée à la main)

Ce qui est livré : le dossier, la règle de nommage, l'entrée dans la rangée, le
lien vers l'écran, l'affichage de l'état 3 (image + nom). Si l'image manque ou
est illisible : **rien ne s'affiche**, l'entrée n'apparaît pas — aucune erreur,
aucun cadre vide.

Ce qu'il fait : il crée `~/.pilot/portrait/`, il y copie l'image sous le nom
`portrait.png`, il écrit le nom dans `nom.txt`, il relance Pilot.

Ce qu'il voit : une vignette et son nom juste à gauche de « Travail » ; un clic
ouvre un onglet « Portrait » avec l'image 240 × 320 et le nom dessous.

Ce qui ne doit jamais arriver : une erreur, un cadre vide, un déplacement des
boutons de fenêtre, un changement dans la barre d'onglets.

### Lot 2 — « la mise à jour »

Ce qui est livré : les trois déclencheurs et la lecture de date (§5).

Ce qu'il fait : il remplace `portrait.png` par une autre image, sans relancer.

Ce qu'il voit : la vignette et l'écran (s'il est ouvert) passent à la nouvelle
image en **5 secondes au plus**, sans clignotement, sans repasser par la
silhouette.

### Lot 3 — « les états sans portrait »

Ce qui est livré : les états 1, 2 et 4 avec leurs mots exacts (§3.3).

Ce qu'il fait : il renomme `portrait.png` en `autre.png` (état 2), puis il
supprime `nom.txt` (état 1), puis il écrit un fichier `.png` qui n'est pas une
image (état 4).

Ce qu'il voit : à chaque fois une silhouette, un texte qui dit ce qui se passe, et
jamais un cadre vide ni une fenêtre d'erreur.

---

## 10. Trois questions fermées (avec ma recommandation)

**Q1 — De quel côté de « Travail » l'entrée se place-t-elle ?**
(a) **à gauche**, entre la barre d'onglets et « Travail » → *recommandé* : les
boutons de fenêtre ne bougent pas, l'entrée ne les touche pas, et le verrou
d'ordre du DOM reste vert ;
(b) à droite, collée aux boutons de fenêtre → à écarter : un clic à côté de
« Réduire », et les 4 px d'air du coin haut droit deviennent fragiles.

**Q2 — D'où vient le nom du personnage ?**
(a) d'une ligne écrite dans `nom.txt`, dans le même dossier → *recommandé* : le
nom peut avoir des accents et des espaces sans qu'on renomme l'image, et
l'image garde un nom fixe et prévisible ;
(b) du nom du fichier image (« Camille.png ») → un seul fichier à déposer, mais
il faut renommer l'image à chaque changement de personnage, et deux images
présentes rendraient le choix ambigu.

**Q3 — Que voit-on quand il n'y a aucun portrait ?**
(a) l'entrée est **présente** et affiche l'état 1 (« Portrait », silhouette,
« Aucun personnage ») → *recommandé* : le propriétaire comprend qu'il manque
quelque chose, et l'emplacement est stable dans le temps ;
(b) l'entrée n'apparaît qu'à partir du moment où une image existe → plus sobre,
mais l'entrée apparaît et disparaît, et personne ne sait pourquoi.

---

## 11. Ce que je n'ai pas pu vérifier

- **La taille réelle des portraits de Présences.** Le cadre 240 × 320 et le
  `contain` sont sûrs quel que soit le ratio, mais la place exacte du visage dans
  l'image (pour la vignette `object-position: 50% 25%`) devra être vérifiée sur
  une vraie image au lot 1.
- **Le comportement du WebView2 sur un JPEG progressif de 8 Mo** : le plafond de
  8 Mo est une garde de prudence, pas une mesure. À ajuster au lot 1 si un
  portrait légitime dépasse.
- **Le coût réel d'une lecture de date toutes les 5 s** sur les trois systèmes :
  la comparaison avec le poller existant (`2 s`, arborescence entière) rend la
  chose négligeable, mais ce n'est pas mesuré.

---

## VERDICT

La demande est réalisable **sans nouveau réglage, sans nouvelle fenêtre, sans
toucher à une décision déjà fermée**, parce que Pilot possède déjà tout ce qu'il
faut : un conteneur libre dans la rangée du haut (`index.html:280` à `307`), la
règle d'états unique des boutons (`src/css/style.css:11493` à `11512`), une
lecture d'image en base64 (`src/js/preview.js:297`), une lecture de date
(`src-tauri/src/files.rs:187`), un motif « recharger quand l'onglet redevient
actif » (`src/js/tabs.js:2295` à `2313`) et un dossier personnel `~/.pilot/`
déjà en service (`src-tauri/src/vault.rs:85`).

Le point à trancher par le propriétaire est **Q1** (le côté de « Travail ») :
c'est le seul choix qui touche quelque chose d'existant — et ma recommandation
(a) le laisse intact.

DONE: conception écrite dans docs/conceptions/CONCEPTION-onglet-portrait.md, 0 ligne de code modifiée, 3 lots essayables seuls, 3 questions fermées avec recommandation.
