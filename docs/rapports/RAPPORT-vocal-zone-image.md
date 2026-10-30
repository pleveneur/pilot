# Rapport — la zone d'image de l'écran Vocal (lot « zone d'image »)

> **⚠️ PÉRIMÉ SUR UN POINT — correction du 2026-10-31.** Ce rapport décrit un état du
> code qui n'est plus le code livré : le portrait n'est **pas au centre du cercle**. Sur
> décision du propriétaire, la mission « écran Vocal » du 2026-10-30 est **annulée** — le
> personnage est **en haut à droite de l'écran**, dans la colonne de droite, **au-dessus**
> de la liste, et le **disque ne porte ni image ni nom**. Fait foi :
> `spec_modes_ecran_vocal.md` § 3ter et § 4ter, et l'encadré de tête de l'**AVENANT** de
> `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md`. Ce qui suit reste un
> **témoignage daté** : à lire pour l'histoire des décisions, pas pour décrire le code.



Date : 2026-10-29 · Projet : `G:\IA_PL\pilot` (Tauri v2 + JS modules ES, tests Vitest)
Source : `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md` § 7bis
(complément « trois cas, dans cet ordre »), moins les trois points que le
propriétaire a tranchés différemment le même jour.

> Le rapport demandé « à la racine » a été rangé dans `docs/rapports/` : c'est la
> règle 7 de `AGENTS.md` (les `RAPPORT-*.md` ne vont jamais à la racine).

---

## 1. Les trois décisions du propriétaire, et ce qu'elles ont changé

### 1.1 La zone d'image passe EN HAUT de la colonne de droite

Le document la mettait **au pied** de la colonne, sous la liste, en exprimant
toute sa règle en **hauteurs** (« le bas ne bouge jamais »). La décision la
remonte **au-dessus** de la liste : titre → **zone d'image** → liste → ligne
d'activité.

Comme la règle du document est écrite en **hauteurs** et non en « en haut » /
« en bas », **aucun chiffre ne change** : seuls l'ancrage du bloc et la lecture
de l'ordre bougent. Les quatre totaux du § 7bis.4 restent exactement ceux du
document :

| Cas | Contenu de la colonne | Hauteur laissée à la liste |
|---|---|---|
| 3 — rien | rien dans la zone | `H − 72` |
| 1 — personnage | médaillon 72 px (+ 6 + 20 de son bloc) | `H − 170` |
| 2 — avatar | place de la fenêtre du visage, 180 px | `H − 252` |
| 1 + 2 | 180 px au-dessus du médaillon | `H − 356` |

Le nombre de lignes suit la place (6 au cas 1, 8 au cas 3) et retombe de
lui-même sur les chiffres du document pour les cas 2 (4) et 1 + 2 (2) :
`floor((260 − 40) / 46) = 4`, `floor((156 − 40) / 46) = 2`. Aucun plafond
supplémentaire n'a été ajouté.

### 1.2 Le nom quitte l'image et se pose SOUS LE CERCLE, en permanence

Le document réservait **20 px** de pastille sous le médaillon. Décision : **aucun
nom sous une image**, et le nom (personnage actif, sinon le nom réglé de
l'assistant) s'affiche **sous le bouton du cercle**, toujours — on voit donc en
permanence à qui l'on parle, même quand la zone d'image est vide.

- Nouveau nœud `.vocal-orb-name`, enfant de `.vocal-orb`, créé à l'exécution par
  `buildVocalOrbName()` **après** `buildVocalDisplayToggle()` : la liste ordonnée
  des classes `vocal-*` verrouillée par `ecran-vocal-bouton-relance.test.js` ne
  bouge pas d'une entrée.
- Il est posé en `position: absolute; top: calc(100% + 6px)` : il **ne déplace
  rien** (ni le disque, ni le halo, ni la ligne d'état), il est en
  `pointer-events: none`, il ne capte aucun clic et ne crée aucun hôte.
- Un seul écrivain, `applyVocalOrbName()`, alimenté par `superAgentDisplayLabel()`
  (personnage → nom réglé → « Assistant »). Le nom n'est jamais masqué ni vidé.
- `.vocal-portrait-name` est **supprimé** partout (règle CSS, balisage, corps de
  `applyVocalPortrait`), plutôt que gardé « au cas où » : un élément mort aurait
  laissé croire qu'un nom peut revenir sous l'image.

### 1.3 La pose de l'avatar : seulement si la taille est CONFIRMÉE, une fois par geste

Le document recommandait l'option A (l'avatar vient se poser dans la zone) sous
une condition : que sa taille soit connue. PLface n'expose **aucune** route de
taille ; Pilot ne peut donc pas la deviner. Trois conséquences, appliquées :

1. `buildFaceRequest("set_position", …)` transmet maintenant, **en plus** de
   `x` et `y`, les `w` et `h` **facultatifs** — absents quand ils sont inconnus,
   de sorte que la requête des appelants existants (l'extension du visage) reste
   **identique au caractère près**. Aucun changement n'est fait côté PLface
   (autre projet).
2. `vocalAvatarFrame()` **rend toujours `null`** aujourd'hui : la taille n'étant
   pas lisible, le cas 2 **ne s'affiche pas** et **aucune pose n'est demandée**.
   C'est le seul refus, et il est **explicite** (`hasAvatar` du plan dit la
   vérité, jamais une intention). Le jour où la taille devient lisible, il n'y a
   qu'une fonction à remplir : rien d'autre dans l'écran ne bouge.
3. Une fois la pose calculée, elle n'est demandée qu'**une seule fois par
   geste** : `vocalAvatarKey` retient la dernière pose **réellement demandée**,
   si bien que le tic de 900 ms repasse sans rien redemander. Les trois moments
   du document (entrée si cas 2, fin de déplacement/redimensionnement, changement
   de cas) sont couverts par ce mécanisme, sans minuterie nouvelle.

## 2. Fichiers touchés

| Fichier | Ce qui a changé |
|---|---|
| `src/js/vocal-sides.js` | `VOCAL_AVATAR_W_PX` (160), `VOCAL_AVATAR_H_PX` (180), `VOCAL_IMAGE_GAP_PX` (6), `VOCAL_PORTRAIT_BLOCK_PX` (98 = 72 + 6 + 20) ; `planVocalImageZone`, `planVocalAvatarPose`, `vocalAvatarPoseKey`, `planVocalAvatarPlacement` (pures) ; `planVocalSides` accepte `hasAvatar` et rend `imageZone` + `hasAvatar` |
| `src/js/super-agent.js` | `vocalImageZoneNode` (zone inerte, sans contenu), `vocalRenderColumn` (hauteur + `hidden`), `vocalAvatarFrame` / `vocalImageZoneRect` / `vocalWindowOrigin` / `vocalPlaceAvatar`, `applyVocalOrbName` / `buildVocalOrbName`, balisage de la colonne réordonné (image en haut), remise à zéro de la clé à l'entrée et à la sortie |
| `src/js/face-gateway.js` | `w`/`h` facultatifs dans la requête `set_position` |
| `src/css/style.css` | `.vocal-image-zone` (aucune forme, `pointer-events: none`), `.vocal-orb-name` (remplace `.vocal-portrait-name`), commentaires de budget mis à jour |
| `spec_modes_ecran_vocal.md` | § 3ter : image **en haut**, liste en dessous, **aucun nom sous l'image**, nom **sous le cercle** ; § 10 : les trois tests et les décisions pures nommées |
| `help/handbook.md` | régénéré (`npm run build:handbook`) — bloc `vocal-colonnes-portrait` |
| `src/js/ecran-vocal-zone-image.test.js` | **nouveau** — T20, T21, T22 (16 tests) |
| 4 fichiers de tests existants | seules les lignes qu'autorisait le § 8.1 : l'ordre des classes `vocal-*` (le nom quitte l'image), et les assertions qui nommaient `.vocal-portrait-name` |

Aucun autre fichier de test n'a été modifié, assoupli, renommé ni supprimé.

## 3. Les trois tests du § 7bis.10

- **T20 — trois cas, dans cet ordre.** Le tableau § 7bis.4 est rejoué **ligne par
  ligne**, sur les **sept** fenêtres et les **quatre** combinaisons (cas 1, cas 2,
  cas 3, cas 1 + 2) : `listHeight` **et** nombre de lignes. Un « — » du document
  (la zone n'existe pas) est vérifié comme « la liste garde exactement la hauteur
  du cas 3 ». Le cas 2 est **absent à `H = 297`** et **présent à `H = 298`** ; un
  avatar refusé ne déplace rien (`hasAvatar` faux).
- **T21 — l'avatar n'est jamais un nœud.** La zone est un `div` nu, créé à
  l'exécution : ni `img`, ni `canvas`, ni `src`, ni `innerHTML`, ni `textContent`,
  jamais le logo. Sa règle CSS ne porte **ni cadre, ni fond, ni ombre, ni rond,
  ni contour**. Le balisage statique ne contient qu'**une** image (le portrait du
  personnage) et aucun `logo_pilot_vector.svg`.
- **T22 — la pose.** La conversion CSS → physique **arrondit** (280,6 → 281,
  320,9 → 321) et centre l'avatar ; **aucune** pose sans taille confirmée ; un
  seul appel par geste (une place identique n'est pas redemandée, une place
  nouvelle l'est) ; la taille part toujours avec la position ; **aucune minuterie**
  dans `vocalPlaceAvatar` ; `w`/`h` absents de la requête quand ils sont inconnus ;
  aucun réglage, aucun rangement (`vocal-sides.js` ne touche ni `localStorage`, ni
  `invoke`, ni `fetch`).

## 4. Résultat des tests

```
npx vitest run
PASS (4726) FAIL (0)
```

Avant ce lot : `PASS (4710) FAIL (0)`. Les **16** tests ajoutés sont exactement
les trois tests du § 7bis.10, découpés en cas lisibles.

## 5. Ce qui reste, et qui n'est pas simulé

- **Le cas 2 est dormant**, et il l'est **honnêtement** : PLface n'expose aucune
  route qui donne la taille de sa fenêtre, donc Pilot ne peut pas savoir où la
  poser sans la deviner. Rien n'est dessiné à la place (une photo d'un avatar
  déjà vivant deux cents pixels plus loin serait un mensonge), rien n'est déplacé.
  Le jour où la taille devient lisible, `vocalAvatarFrame()` rend un objet et le
  cas 2 s'affiche **sans qu'aucun autre fichier de l'écran ne change**.
- **Aucune mesure sur écran réel** : la zone d'image est vérifiée par le calcul
  (le tableau du § 7bis.4 est rejoué) et par la forme du code, pas par capture.
- **Les documents de conception gardent quelques mentions de
  `.vocal-portrait-name`** (`CONCEPTION-ecran-vocal-portrait-et-colonnes.md`,
  ~5 endroits) : ils décrivent l'état **d'avant** la décision du 2026-10-29 et
  n'ont pas été réécrits ici. La spec `spec_modes_ecran_vocal.md`, elle, décrit
  bien le code d'aujourd'hui.
- **Rien d'autre n'a été touché** : le disque, le halo, le micro, le bas qui
  s'efface au repos et les trois sorties (logo, Échap, fermeture de l'onglet) sont
  inchangés, et les colonnes ne captent toujours aucun clic.
- **Pas de bump de version, pas de publication** : la publication reste une
  demande explicite du propriétaire.
