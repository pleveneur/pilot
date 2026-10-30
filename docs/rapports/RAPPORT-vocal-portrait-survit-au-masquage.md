# Rapport — le portrait survit au masquage (état nu de l'écran Vocal)

- **Mission** : micro-tâche codeur, `G:\IA_PL\pilot`, 2026-11-01.
- **Objet** : rendre vraie l'exception du propriétaire sur l'écran Vocal — **le
  portrait du personnage et son nom ne sont jamais masqués**, même quand le
  bouton unique de masquage (« état nu ») éteint tout le reste.
- **Base** : `815038f` (plus le travail non commité de la tentative précédente,
  réévalué ligne par ligne ci-dessous).
- **Livré dans un seul commit** (message en français), puis suite complète
  relancée.

---

## 1. Ce que la mission demandait

1. Démembrer le bloc d'effacement : nommer chaque pièce du disque (anneau,
   couronne, enveloppe, arc, relance, fond, filet) au lieu d'un `opacity` global,
   portrait et nœud du nom explicitement exclus.
2. Effacer par les bonnes propriétés (`background` / `border-color` pour ce qui
   s'éteint ainsi) pour que le portrait n'hérite d'aucune opacité de conteneur.
3. Une classe d'état sur le conteneur, mais des sélecteurs qui nomment les pièces
   une par une — **jamais** d'`opacity: 0` sur le parent.
4. Rapport **d'abord**, `docs/rapports/` seulement.
5. Un seul commit, en français.
6. `npx vitest run` complet, compte exact, recompté sur le disque.
7. Au moins trois tests qui échouent vraiment si la règle casse.
8. `spec_modes_ecran_vocal.md` (§ 4ter) et `help/handbook.md` en accord.

## 2. Ce que le code disait au départ — et pourquoi la prémisse ne tient plus

La mission cite `afef214`, qui a transporté le portrait **au centre du disque**
(`.vocal-orb`). Depuis, `815038f` (« l'état nu ne peut plus emporter le portrait
du personnage ») l'a **ramené dans la colonne de droite**, au-dessus de la liste
des tâches, avec son nom dessous. Le balisage le dit sans ambiguïté
(`src/js/super-agent.js`) :

```html
<div class="vocal-stage">
  <div class="vocal-orb"> … </div>              <!-- aucun portrait ici -->
  <aside class="vocal-side-tasks vocal-side">
    <img class="vocal-portrait" alt="" hidden /> <!-- le portrait est ICI -->
    <div class="vocal-side-body"></div>
  </aside>
</div>
```

et le nom est créé après coup, **frère du portrait** dans la même colonne :
`buildVocalPortraitName(ov.querySelector(".vocal-side-tasks .vocal-portrait"))`.

Conséquence : **le défaut décrié par la mission n'existe plus dans le code
livré**. Le portrait n'est pas dans le disque, donc `opacity: 0` sur le disque ne
peut plus l'atteindre — un descendant ne peut rien annuler, mais il n'y a plus de
descendant. Le travail restant était donc **de le prouver, de le verrouiller, et
de refuser les régressions** (une seule ligne suffirait à ramener le défaut).

## 3. Décisions

### 3.1 L'exception est un PÉRIMÈTRE, pas une intention

Le bloc de l'état nu énumère **ce qu'il éteint** ; tout ce qu'il ne nomme pas
reste allumé. C'est la seule mécanique qui tienne : on ne peut pas masquer ce
qu'on n'a pas écrit. Le périmètre retenu, après réévaluation :

| Nœud | Éteint en état nu ? | Pourquoi |
|---|---|---|
| `.vocal-orb` (disque : anneau, couronne, enveloppe de parole, arc, « Réveiller ») | **oui** | c'est la mise en scène |
| `.vocal-halo` | oui (enfant du disque) | idem |
| `.vocal-status` (ligne d'état) | **oui** | idem |
| `.vocal-mic-fix` (« Autoriser le micro ») | **oui** | idem |
| `.vocal-side-discussion` (colonne de gauche) | **oui** | idem |
| `.vocal-side-tasks > .vocal-tasks-title` | **oui** | le titre de la colonne |
| `.vocal-side-tasks > .vocal-side-body` | **oui** | la liste (réécrite toutes les 900 ms) |
| `.vocal-top` | fond et filet seulement | la barre redevient une bande |
| `.vocal-top .vocal-display-toggle` | **non** — rallumé explicitement | seul moyen de revenir |
| `.vocal-portrait` | **NON, jamais** | décision du 2026-10-29 |
| `.vocal-portrait-name` | **NON, jamais** | idem |
| `.vocal-image-zone` | **NON** (hauteur réservée) | l'absence de règle est la règle |
| `.vocal-input` + ses enfants | **NON, jamais** | décision du 2026-11-01 (§ 6) |

### 3.2 Ce que je n'ai PAS fait : démembrer le disque — et pourquoi

La demande n° 1 (nommer anneau, couronne, enveloppe, arc, relance, fond, filet)
**supposait le portrait dans le disque**. Elle avait un objet : arracher le
portrait à l'opacité du parent. Depuis `815038f` cet objet n'existe plus, et le
démembrement deviendrait un **faux filet de sécurité** :

- il faudrait nommer des **pseudo-éléments** (`.vocal-orb::before` porte
  l'enveloppe de parole) et des pièces qui n'existent qu'en CSS (l'anneau est le
  `border` du bouton de relance, la couronne est un `::after`) : sept règles à la
  place d'une, pour un même effacement ;
- toute pièce oubliée laisserait un **morceau de disque allumé** — exactement
  l'« état nu à deux vitesses » que le § 4ter interdit ;
- le disque est **un objet**, pas un assemblage : il s'éteint d'un bloc, et c'est
  ce que l'œil doit lire.

Le disque est donc **une seule pièce nommée**, et la sûreté du portrait ne vient
plus de là : elle vient de sa **place dans l'arbre**, prouvée par un test qui
reconstruit la chaîne des ancêtres (§ 5). La demande n° 2, elle, est appliquée
telle quelle : `.vocal-top` perd `background` et `border-color`, pas son
opacité.

### 3.3 Aucune opacité sur le parent

Le seul `opacity: 0` est celui du bloc nommé, sur des nœuds **feuilles du
masquage** : aucun n'a le portrait ni la zone de saisie pour descendant. Une
règle qui remettrait un `opacity: 0` sur `.pilot-vocal` ou sur `.vocal-stage`
ferait échouer trois tests d'un coup (§ 5).

## 4. La forme du masquage (inchangée)

Une seule classe d'état, `vocal-bare`, sur l'overlay ; `opacity: 0`, puis
`visibility: hidden` **retardée** de 180 ms, puis `pointer-events: none` ; jamais
`display: none`, aucune règle de dimension ni de position — l'espace reste
réservé, le retour ne fait rien sauter. En mouvement réduit, `transition: none`.

## 5. Les trois exceptions, et le verrou qui tient chacune

Nouveau fichier `src/js/ecran-vocal-la-saisie-nest-jamais-masquee.test.js` —
**second vérificateur, indépendant** du verrou de `815038f`
(`ecran-vocal-masquage-garde-le-portrait.test.js`) : il ne découpe rien dans le
CSS, il lit les **règles** (sélecteur + corps, commentaires neutralisés) et les
**confronte à l'arbre réel** de l'écran, reconstruit depuis le gabarit de
`buildVocalOverlay()` (extrait par `sliceSource`, ancres vérifiées).

| Exception | Test | Ce qui le fait échouer |
|---|---|---|
| le portrait | `aucun selecteur du masque n'atteint le portrait (ancetres compris)` | tout sélecteur qui atteint le portrait **ou un de ses ancêtres** avec `opacity: 0`, `visibility: hidden`, `display: none` ou `pointer-events: none` |
| son nom | `aucun selecteur du masque n'atteint le NOM du portrait` | idem, sur `.vocal-portrait-name` |
| le bouton | `il est explicitement RALLUME, et rien ne l'eteint` | sa disparition, ou la perte du retour explicite `opacity: 1 / visibility: visible` |
| la zone de saisie | `aucun selecteur du masque n'atteint la zone, le champ, ni le bouton de dictee` | tout sélecteur atteignant `.vocal-input`, `.agent-chat-input-bar`, `textarea.agent-input` ou `button.agent-mic-btn` ; **et** toute règle de l'état nu qui les **nomme**, même sans les masquer |
| le bas qui resterait éteint | `le bas ne s'efface pas non plus tout seul pendant l'etat nu` | `const visible = !vocalBare …` dans `vocalSyncChrome` |

Deux contrôles anti-complaisance : le fichier vérifie d'abord que le portrait est
bien un **enfant direct de la colonne de droite** (chaîne exacte des classes), et
il **rejoue le défaut du 2026-10-31** (portrait transporté dans le disque) pour
exiger que le moteur désigne alors `.pilot-vocal.vocal-bare .vocal-orb`. Sans
cela, un vérificateur cassé passerait pour un verrou.

## 6. La zone de saisie (décision du 2026-11-01)

Précision du propriétaire : le bouton-œil masque « la mise en scène autour du
visage », **jamais la zone de saisie**. Trois changements, un seul point
d'écriture chacun :

1. **Suppression** de `.pilot-vocal.vocal-bare .vocal-input { opacity: 0 … }` :
   une règle de moins, pas une exception de plus (l'absence de règle est la plus
   sûre). Le commentaire du bloc dit désormais, en clair, que cette zone n'y
   entre jamais.
2. **`vocalSyncChrome` retient le bas allumé** : `const visible = vocalBare || …`
   (au lieu de `!vocalBare && …`). Sans cela la zone tombait 2,5 s après le clic
   par `.vocal-chrome-hidden` (§ 4bis) : le bouton aurait eu l'air de vider la
   saisie aussi. Le minuteur continue de tourner sans effet — on ne le relance
   pas à la main, sinon l'écran se rallumerait sans geste.
3. **Le portrait « doit être LÀ »** : la garde d'entrée de `815038f`
   (`refreshAssistantPersonaAndApply()` dans `enterVocal()` quand la mémoire est
   vide) reste en place, inchangée — sans elle, un démarrage direct en mode Vocal
   laissait l'état nu sans rien du tout.

## 7. Les tests réécrits, et leur raison

Aucun test supprimé. Trois fichiers existants sont corrigés — chacun portait un
défaut qui le rendait **faux**, pas seulement rouge :

| Fichier | Ce qui change | Pourquoi (écrit dans le fichier) |
|---|---|---|
| `ecran-vocal-masquage-garde-le-portrait.test.js` | l'ancre de fin du bloc passe de `.… .vocal-input {` (règle supprimée) à `.… .vocal-top {` (elle ne peut pas disparaître, la barre porte le bouton) ; commentaires neutralisés avant les contrôles de contenu ; `.vocal-input` sort de la liste des nœuds **qui doivent** s'éteindre et devient un contrôle **négatif** | l'ancre disparue levait `SourceSliceError` en cascade (6 échecs) ; le commentaire du bloc cite `display: none` et « portrait » **pour dire qu'il ne les emploie pas** — sans neutralisation, le contrôle négatif devenait vrai par construction |
| `ecran-vocal-bouton-affichage.test.js` | `blocSaisie()` (référence morte) retiré ; comptage des `pointer-events` fait sur la source **neutralisée** ; le seul `pointer-events: none` de la section nue doit être celui du bloc nommé, et sa liste ne doit contenir ni la saisie ni la barre | le motif `[^{}]+` qui précède l'accolade **avalait le commentaire voisin** : le commentaire expliquant que la saisie n'est pas nommée la nommait, et comptait pour une seconde règle |
| `ecran-vocal-question-utilisable.test.js` | même neutralisation avant comptage | le commentaire du fichier affirmait qu'« un commentaire voisin ne peut pas fausser le compte » — c'était faux, mesuré |

## 8. La mutation vérifiée (les tests échouent vraiment)

Quatre mutations appliquées une à une au code réel, puis annulées, en relançant
`ecran-vocal-la-saisie-nest-jamais-masquee.test.js` :

| Mutation | Résultat |
|---|---|
| `.vocal-portrait` ajouté à la liste du bloc | **échec** — « aucun selecteur du masque n'atteint le portrait » |
| retour du bouton renommé (`.vocal-display-toggle-x`) | **échec** — « il est explicitement RALLUME » |
| `.vocal-input` ajouté à la liste du bloc | **échec** — « aucun selecteur … ni le bouton de dictee » |
| `const visible = !vocalBare \|\| …` dans `vocalSyncChrome` | **échec** — « le bas ne s'efface pas non plus tout seul » |

## 9. Documentation

- `spec_modes_ecran_vocal.md` § 4ter : la barre de saisie **sort** de la liste de
  ce qui se masque ; le paragraphe « Le bas qui s'efface et l'état nu » dit
  désormais l'inverse (le bas est **retenu allumé**), avec sa raison ; les deux
  verrous sont nommés.
- `help/overview.md` (bloc utilisateur du bouton-œil) : « tout sauf **le portrait
  et son nom, le bouton, et la zone de saisie** » ; `help/handbook.md` régénéré
  par `npm run build:handbook` (jamais édité à la main).
- Ce rapport.

## 10. Tests et comptes

| Mesure | Valeur |
|---|---|
| Total sur le disque **avant** cette tâche | 4 773 tests |
| Tests **ajoutés** (`ecran-vocal-la-saisie-nest-jamais-masquee.test.js`) | 9 |
| `npx vitest run` complet après correctifs | **4 782 PASS / 0 FAIL** (252 fichiers de test) |
| Tests ciblés des cinq fichiers vocaux concernés | 113 PASS / 0 FAIL |

Aucun test n'a été supprimé ; le total ne peut donc que monter.

## 11. Limites, et ce qui reste à l'œil

- **Rien n'a été vérifié à l'écran** : cette mission est une micro-tâche code,
  sans lancement de `npm run tauri dev`. Les tests prouvent la **règle**, pas le
  rendu (un `filter` ou une `backdrop` ajoutés un jour sur un ancêtre
  échapperaient au détecteur, qui ne connaît que `opacity`, `visibility`,
  `display` et `pointer-events`).
- Le bloc `vocal-reduced` ne coupe la transition que sur trois des six nœuds
  nommés ; c'est antérieur à cette mission et sans effet visible (les trois
  autres n'ont pas de fondu propre), laissé tel quel pour ne pas élargir le
  périmètre.
- La zone d'image (`.vocal-image-zone`) reste allumée en état nu par **absence de
  règle** : c'est voulu (§ 3.1), mais ce n'est écrit nulle part dans l'interface —
  à trancher par le propriétaire si l'état nu doit aussi l'éteindre (sa hauteur
  réservée ne doit alors pas bouger).
