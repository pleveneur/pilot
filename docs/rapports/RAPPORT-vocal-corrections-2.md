# RAPPORT — écran Vocal, deux corrections du propriétaire (portrait en haut à droite, bouton visible)

Date : 2026-10-31 · Projet : `G:\IA_PL\pilot` · Version en cours : 0.6.5 (aucun bump, aucune publication)
Périmètre : **l'écran Vocal uniquement**. Le disque, son halo, le micro, le bas qui s'efface, la
barre de saisie et les trois sorties (logo, `Échap`, fermeture de l'onglet) **ne sont pas touchés**.

---

## 1. Ce qui est ANNULÉ

### La mission « écran Vocal » du 2026-10-30 (commit `afef214`), sur son point de placement

Elle avait mis **le portrait du personnage au centre du cercle**, avec son nom juste dessous,
**à l'intérieur du disque**, et avait en conséquence :

- réduit la zone d'image de **trois cas à deux** (avatar ou rien), puisqu'il n'y avait plus de
  portrait à placer dans la colonne ;
- fait **tomber l'exception du 2026-10-29** de l'état nu (« tout se masque **sauf le portrait** ») :
  un portrait peint par le nœud du disque ne pouvait plus rester allumé seul ;
- supprimé la légende de la colonne (`.vocal-portrait-name`) et créé un nom **dans** le cercle
  (`.vocal-orb-name`) ;
- ajouté `applyVocalOrbName()` / `buildVocalOrbName()` dans `super-agent.js`.

**Tout cela est défait.** Le disque ne porte **plus rien** : aucun `<img>`, aucun nom, aucun nœud
ajouté à `.vocal-orb`. `.vocal-orb-name` n'existe plus ni dans le CSS, ni dans le JS, ni dans le
balisage (§ 4 : un test le vérifie).

### Ce qui n'est pas revenu en arrière

La **ligne d'activité** retirée par la même mission (`.vocal-now`, `vocalNowLine`) **reste
retirée** : elle n'était pas l'objet de cette correction, et la place libérée n'est pas
réoccupée.

---

## 2. Ce qui est APPLIQUÉ

### 2.1 Le personnage est en HAUT À DROITE, les tâches DESSOUS

Règle du 2026-10-30, appliquée telle quelle :

- le portrait du personnage actif est le **premier contenu de la colonne de droite**
  (`.vocal-side-tasks`), **au-dessus** de la liste des tâches, donc **en haut à droite de
  l'écran** ;
- son **nom** est écrit **juste en dessous**, sur une seule ligne (classe `.vocal-portrait-name`,
  créée à l'exécution et insérée **après** l'image par `insertAdjacentElement("afterend", …)`) ;
- **un seul nom** à l'écran, écrit par la **seule** règle existante `superAgentDisplayLabel()`
  (nom du personnage, à défaut celui réglé pour l'assistant), et **jamais** par `innerHTML` ;
- **aucun repli sur le logo** : sans personnage, il n'y a pas d'image du tout.

Le médaillon fait **72 px** de diamètre (rond, `object-fit: cover`, `pointer-events: none`), et le
bloc complet **98 px** de haut : 72 + 6 d'écart + 20 de ligne de nom.

### 2.2 La zone d'image retrouve ses TROIS cas, dans cet ordre

`planVocalImageZone()` (module **pur** `src/js/vocal-sides.js`) tranche, et un seul endroit décide :

| Ordre | Cas | Hauteur réservée (en plus de la liste) |
|---|---|---|
| 1 | **le personnage** (`hasPortrait`) — il **l'emporte toujours** sur l'avatar | **98 px** (72 + 6 + 20) |
| 2 | **l'avatar du visage** (PLface tourne **et** sa taille est connue) | **180 px** (160 × 180) |
| 3 | **rien** | **0 px** — aucune zone, aucun cadre, jamais le logo |

La hauteur fixe de la colonne reste **51 px** (14 + 11 + 14 + 12), donc la liste dispose de
`H − 51` (rien), `H − 51 − 98` (personnage) ou `H − 51 − 180` (avatar). Vérifié fenêtre par
fenêtre : **1440 × 900 → 461 px / 8 lignes** sans personne, **363 px / 7 lignes** avec le
personnage, **281 px / 5 lignes** avec la fenêtre du visage ; **720 × 520 → l'avatar est refusé**
(la liste garderait moins d'une ligne), exactement comme la conception le prescrit.

L'état nu retrouve donc la décision du 2026-10-29 : **tout s'éteint sauf le portrait et son nom**.
Le bloc d'effacement `.vocal-bare` ne nomme ni `.vocal-portrait` ni `.vocal-portrait-name` — on ne
peut pas masquer ce qu'on n'a pas écrit — et le portrait reste seul, à sa place, avec son nom.

### 2.3 Le bouton de masquage est VISIBLE, et il dit ce qu'il fait

C'était le second point : le propriétaire ne trouvait pas le bouton. Il existait pourtant, dans la
barre du haut de 44 px, mais **en icône seule** (28 × 24 px, un œil) — donc introuvable.

Il porte maintenant **une icône et son texte**, dans les deux états :

| État | Icône | Texte affiché |
|---|---|---|
| tout est visible | `eye` | **« Ne garder que le portrait »** |
| tout est masqué | `eye-off` | **« Tout réafficher »** |

- **Il ne bouge pas d'un état à l'autre** : `min-width: 190px`, `height: 28px` (la largeur du plus
  long des deux libellés), donc le point de clic ne se dérobe pas sous le doigt.
- **Il ne recouvre ni le logo (bouton des trois modes) ni le bouton « Travail »** : il vit dans
  `.vocal-top`, centré (`margin-inline: auto`), entre les deux, dans une barre de 44 px qui
  existait déjà.
- **Il est toujours présent**, y compris quand les colonnes sont absentes (fenêtre étroite) :
  jamais `hidden`, jamais `disabled`. Ce qu'il commande existe toujours.
- **Ses deux clics fonctionnent**, dans les deux sens, sans avaler aucun autre clic : il est dans
  `.vocal-top`, qui est **déjà** l'un des six hôtes cliquables de l'écran (issue #381) — aucun
  septième hôte n'est créé, et `.pilot-vocal` reste traversant.
- **Il dit ce qu'il fait de deux façons** : par son texte visible (nouveau) **et** par son
  infobulle / `aria-label` (inchangés), qui disent **l'état d'abord, l'action ensuite**
  (« tout est visible — cliquer pour ne garder que le portrait »), avec `aria-pressed` à jour.
- Le libellé est décidé par une fonction **pure** (`vocalBareText()` dans `src/js/vocal-bare.js`,
  à côté de `vocalBareLabel()` / `vocalBareIcon()`), et **le seul écrivain** reste `vocalSyncBare()`.
- L'icône est posée dans **son propre nœud** (`.vocal-display-toggle-icon`) : `setIcon()` écrit
  `innerHTML`, et l'appliquer au bouton emporterait le texte **et** le point de clic. Même raison
  pour le libellé, isolé dans `.vocal-display-toggle-label`.

> **Mise à jour du 2026-11-02 — le texte visible a été retiré.** Sur demande du
> propriétaire, le bouton du masquage ne porte plus que **son icône** : plus de
> `VOCAL_BARE_TEXT_VISIBLE` / `VOCAL_BARE_TEXT_HIDDEN`, plus de `vocalBareText()`,
> plus de nœud `.vocal-display-toggle-label` ni de règle CSS associée. Ce qui reste
> — inchangé, et c'est ce qui doit suffire — est le **nom accessible** (`title` +
> `aria-label`, alimentés par `vocalBareLabel(état)`) et `aria-pressed`. Taille, forme
> et position sont **inchangées** (`min-width: 190px`, `height: 28px`, rayon pastille
> `999px`, centré dans `.vocal-top`). Verrou : `src/js/bouton-masquage-sans-texte.test.js`.
> Le présent rapport reste le compte rendu daté de ce qu'il s'est passé le 2026-10-31.

---

## 3. Les tests

### 3.1 Résultat exact

```
npx vitest run
PASS (4731) FAIL (0)
```

**4731 tests passent, 0 échoue.** Avant la mission, l'arbre était à **PASS 4727 / FAIL 0** ; les
**4 tests nets** ajoutés viennent de `vocal-sides.test.js` (1), `ecran-vocal-portrait.test.js`
(réécriture du verrou T9), `ecran-vocal-zone-image.test.js` (T20 réécrit en trois cas) et
`ecran-vocal-bouton-affichage.test.js` (1 test neuf : « le TEXTE suit l'état, lui aussi sans
clignoter »).

### 3.2 Les verrous qui décrivaient la mauvaise position, et qui ont été réécrits

Aucun test n'a été **supprimé** ni **affaibli** : ceux qui verrouillaient « le portrait au centre du
cercle » décrivent désormais « le portrait en haut à droite ». La liste exacte :

| Fichier | Ce qui change |
|---|---|
| `src/js/ecran-vocal-portrait.test.js` | **le verrou du placement** : T9 s'appelait « le portrait est au centre du cercle », il s'appelle « le portrait est en HAUT À DROITE, le disque reste vide ». Il vérifie maintenant l'inverse d'avant : l'image est dans la **colonne**, elle n'est **pas** dans le **disque**, aucun nom dans le disque, l'image **avant** `.vocal-side-body`, le médaillon **72 px dans le flux** (aucun `position: absolute`, aucun `translate(`, aucun `--vocal-orb-size`), la légende `margin-block: 6px 0` / `height: 20px` / `nowrap` + ellipse, `insertAdjacentElement("afterend", …)`, et l'**absence totale** de `.vocal-orb-name` dans le CSS et le balisage |
| `src/js/ecran-vocal-zone-image.test.js` | T20 décrit **trois cas** au lieu de deux : le personnage d'abord, l'avatar ensuite, rien enfin ; la table des sept fenêtres gagne la colonne « personnage » (363 px / 7 lignes partout où il est là) ; le test de balisage cherche l'`<img>` **dans la colonne**, pas dans le disque |
| `src/js/vocal-sides.test.js` | nouveau test « le PERSONNAGE, en haut a droite, prend 98 px a la liste (72 + 6 + 20) » ; import de `VOCAL_PORTRAIT_BLOCK_PX` |
| `src/js/vocal-taches-en-haut-portrait-en-bas.test.js` | T18 et T19 réécrits : le haut de la colonne réserve **`H − 51 − 98`** avec le personnage, l'ordre est **titre → portrait + nom → zone d'image → liste**, le disque ne contient rien, et `buildVocalPortraitName` est appelé sur `.vocal-side-tasks .vocal-portrait` |
| `src/js/ecran-vocal-lot2.test.js` | la liste ordonnée des classes statiques replace `"vocal-portrait"` **entre** `vocal-side-tasks` et `vocal-side-body` (12 entrées) |
| `src/js/ecran-vocal-bouton-relance.test.js` | même liste ordonnée corrigée |
| `src/js/vocal-halo-128-et-etat-au-dessus-saisie.test.js` | même liste ordonnée corrigée |
| `src/js/ecran-vocal-bouton-affichage.test.js` | la géométrie verrouillée du bouton passe de **28 × 24 px, icône seule** à **`min-width: 190px` × `height: 28px`**, avec l'icône **et** le texte dans deux nœuds distincts ; un test neuf vérifie que le **texte** suit l'état sans clignoter (écriture seulement s'il change) |

Les trois fichiers de liste ordonnée (`lot2`, `bouton-relance`, `halo-128`) n'ont pas changé de
**longueur** : le portrait a simplement changé de **place** dans l'ordre (il était entre
`vocal-orb` et `vocal-halo`, il est maintenant dans la colonne).

### 3.3 Ce que les tests interdisent désormais

- un `<img>` ou un nom **dans** `.vocal-orb` → échec ;
- `.vocal-orb-name` quelque part → échec ;
- un portrait en `position: absolute` ou centré par `translate` / `--vocal-orb-size` → échec ;
- un portrait placé **sous** la liste → échec (l'index de l'image doit précéder celui de
  `.vocal-side-body`) ;
- un bouton d'affichage **sans texte visible**, ou dont l'icône est écrite sur le bouton
  lui-même → échec ;
- un septième hôte cliquable (`vocal-aucun-calque-ne-capte-les-clics.test.js`) → échec.

---

## 4. Fichiers touchés

**Code**

- `src/js/vocal-sides.js` — les trois cas de la zone d'image, le bloc du personnage (98 px),
  l'avatar (160 × 180), `hasPortrait` / `hasAvatar` dans `planVocalSides()` (module toujours
  **pur** : aucun DOM, aucun import Tauri).
- `src/js/super-agent.js` — le portrait et son nom **dans la colonne** ; `buildVocalPortraitName()`
  remplace `buildVocalOrbName()` (supprimé) ; `applyVocalOrbName()` **supprimée** (elle
  plantait à l'entrée du mode depuis que `enterVocal` ne recevait plus l'overlay) ; le bouton
  d'affichage porte son texte.
- `src/js/vocal-bare.js` — `VOCAL_BARE_TEXT_VISIBLE` / `VOCAL_BARE_TEXT_HIDDEN` / `vocalBareText()`
  (pures ; les libellés d'infobulle existants ne changent pas). **Retirées le 2026-11-02**
  (voir la mise à jour ci-dessus) : le bouton ne porte plus de texte visible.
- `src/css/style.css` — `.vocal-portrait` passe de l'absolu-dans-le-disque au **médaillon dans le
  flux** ; `.vocal-orb-name` **supprimée**, `.vocal-portrait-name` créée ; `.vocal-display-toggle`
  gagne sa largeur stable et ses deux sous-nœuds.

**Tests** : les huit fichiers du tableau § 3.2.

**Documentation**

- `spec_modes_ecran_vocal.md` — § 3ter (état réel, trois cas, le nom sous le portrait, « le
  cercle ne porte ni image ni nom »), § 4ter (l'exception du 2026-10-29 rétablie, le bouton avec
  son texte), en-tête (statut), tableau des modules (l'état nu est **livré**, plus « à livrer »).
- `help/handbook.md` — **régénéré** (`npm run build:handbook`), plus aucune mention d'un portrait
  au centre du cercle.
- `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md` — encadré de tête de
  l'**AVENANT** : points 3 et 4 **annulés**, points 1 et 2 valables ; § 7bis.1 corrigé (« en haut à
  droite » se lit littéralement) ; l'ancrage décrit en **flux** au lieu de l'absolu ; l'état nu
  relu « tout se masque sauf le portrait et son nom ».
- `docs/conceptions/CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md` — en-tête : le
  document reste exact sur la colonne, mais le portrait est **revenu en haut**.
- `docs/rapports/RAPPORT-vocal-presentation.md`, `RAPPORT-bouton-tout-masquer.md`,
  `RAPPORT-vocal-zone-image.md` — bandeau **« périmé sur un point »** en tête (ce sont des
  témoignages datés : on ne réécrit pas l'histoire, on renvoie à ce qui fait foi).

**Aucun** fichier préexistant non suivi n'a été touché, et **aucune** version n'a été bumpée.

---

## 5. Ce qui n'a pas bougé (vérifié)

- le **disque** : ni sa taille, ni son anneau, ni sa couronne, ni son arc, ni son enveloppe de
  parole — il ne porte simplement plus rien ;
- le **halo** et le **micro** (`vocal-mic.js` n'est pas modifié) ;
- le **bas qui s'efface au repos** (`vocal-chrome.js` inchangé, seul `vocalSyncChrome` reçoit
  toujours le terme `!vocalBare`) ;
- la **barre de saisie** et ses boutons ;
- les **trois sorties** : le logo (bouton des trois modes), `Échap`, la fermeture de l'onglet —
  `onVocalKeydown` n'est pas modifié ;
- **six hôtes cliquables**, pas sept (issue #381) ;
- le **module `vocal-sides.js` reste pur**, et `vocalSyncSides()` reste le **seul** écrivain de
  `--vocal-side` / `--vocal-side-tasks` / `vocal-sides-off`.

---

## 6. Reste à faire — la validation visuelle du propriétaire

Rien n'est publié, rien n'est tagué : la version reste **0.6.5**. Les deux corrections sont à
valider **à l'œil** :

1. le personnage est-il **en haut à droite**, assez grand, avec son nom lisible dessous, et la
   liste des tâches bien **en dessous** ?
2. le **cercle** est-il bien **vide** (ni image, ni nom) ?
3. le bouton **« Ne garder que le portrait »** se trouve-t-il sans le chercher, et le clic
   laisse-t-il bien le portrait **et son nom** seuls à l'écran, puis **« Tout réafficher »**
   remet-il tout du même geste ?

Si l'un des trois ne convient pas, la correction est bornée : un chiffre (72, 6, 20, 190, 28) ou
un libellé à changer, sans toucher au disque ni aux sorties.
