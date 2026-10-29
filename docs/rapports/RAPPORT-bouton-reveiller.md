# Rapport — deux retouches du bouton de relance de l'écoute (« Réveiller <Nom> »)

> Suite de `RAPPORT-bouton-ok-nova.md` (décisions **401** et **402**, commit
> `3e1dcee`). Le propriétaire demande **deux retouches seulement** :
>
> **Retouche 1 — la taille.** Le bouton doit occuper **toute la surface
> intérieure** du cercle, moins l'épaisseur de la bordure : il **devient** le
> cercle, il ne flotte plus dedans. Le contour du disque lui sert de bord (aucun
> anneau propre), il ne recouvre ni ne déborde de la bordure quelle que soit la
> taille de fenêtre, et il reste de la même famille que l'objet lumineux
> (discret). Le halo et son enveloppe ne sont pas touchés.
>
> **Retouche 2 — le texte.** Libellé exactement **« Réveiller <Nom de
> l'assistant> »** (ex. « Réveiller Nova »). Le nom vient de la **source
> existante** du personnage actif (aucune seconde source). Sans personnage :
> nom par défaut de Pilot, jamais vide, jamais « undefined », jamais de double
> espace. Un nom jusqu'à **60 caractères** doit rester lisible dans le cercle
> sans déborder : le **nom complet** reste dans l'infobulle et l'étiquette
> d'accessibilité, qui suivent le même texte.
>
> Ne changent pas : visible quand la dictée ne tourne pas, absent pendant
> l'écoute, de retour à la coupure ; un clic relance par la **voie existante**
> (aucune seconde voie) ; aucun nouveau calcul de niveau sonore, aucun drapeau
> local d'état ; réduction de mouvement respectée.

## 1. État avant (deux lignes)

Le bouton était un **rond de 56 px** posé **dans le haut** du disque (`top: 3px`,
`left/right: 0` + `margin: 0 auto`), libellé **« ok » + premier mot du nom**
(10 caractères maxi), infobulle fixe « Lancer l'écoute ». Disque de 168 px, bordure
de 2 px, rayon intérieur 84 px : le bouton occupait donc 56 px des 164 px utiles.

## 2. Ce qui a changé

| Fichier | Changement |
|---|---|
| `src/js/vocal-restart.js` | `VOCAL_RESTART_WORD` / `VOCAL_RESTART_TITLE` / `VOCAL_RESTART_NAME_MAX` remplacés par `VOCAL_RESTART_VERB = "Réveiller"` et `VOCAL_RESTART_LABEL_MAX = 24` ; ajout de `vocalRestartName` (repli sur `DEFAULT_ASSISTANT_NAME` **importé** de `assistant-persona.js`) et de `vocalRestartText` (texte affiché, troncature sur fin de mot, comptage en points de code) ; `vocalRestartLabel` porte désormais le libellé **complet** |
| `src/js/super-agent.js` | un **seul** point d'écriture de l'étiquette, `applyVocalRestartLabel` (`textContent` + `title` + `aria-label`) ; `vocalSyncRestartButton` et `applyAssistantPersonaUi` l'appellent — `innerHTML` n'est jamais utilisé pour le nom (il vient d'un fichier lu par Rust) ; balisage de départ construit avec des **constantes** (`relance`) |
| `src/css/style.css` | `.vocal-restart` passe en `position: absolute; inset: 0` (plus de `width`/`height`/`top`/`left`/`right`/`margin` propres) ; `border-radius: 50%`, `border: none`, `overflow: hidden`, `padding: 0 14px`, `font-size: 13px`, `line-height: 1.2` |
| `src/js/vocal-restart.test.js` | section 2 réécrite : libellé « Réveiller <Nom> », repli sur le nom par défaut (via la constante), nom de 60 caractères, coupe sur fin de mot, limite exacte, emoji, pureté conservée |
| `src/js/ecran-vocal-bouton-relance.test.js` | tests de géométrie réécrits (calcul depuis le CSS : rayon du bouton = rayon intérieur, seule épaisseur restante = l'anneau, aucune unité de fenêtre, texte découpé au cercle) ; test d'un seul point d'écriture de l'étiquette ; un seul texte pour le bouton, l'infobulle et `aria-label` |

### Retouche 1 — la géométrie, en une phrase

`.vocal-orb` n'a pas de `box-sizing` particulier (aucune remise à zéro globale
dans ce fichier) : sa boîte de padding fait **168 × 168 px**, donc l'enfant en
`inset: 0` mesure **168 × 168 px** et son `border-radius: 50%` décrit le cercle
de rayon **84 px** — c'est **exactement** le bord intérieur de l'anneau de 2 px.
Le bouton touche la bordure sans la recouvrir (il s'arrête à son bord intérieur)
et ne peut pas déborder (tout ce qui est dehors est l'anneau lui-même). Le disque
est en pixels fixes et le bouton est absolu : **aucune** unité `vw`/`vh`, aucun
pourcentage de dimension, donc **le rapport est identique à toute taille de
fenêtre**. Le halo (`inset: 0`, `pointer-events: none`) et l'enveloppe de parole
(`::before`) gardent leur structure : le bouton ne s'affiche qu'au repos, état où
le halo est éteint, donc il ne le recouvre jamais.

### Retouche 2 — le texte, en une phrase

Un seul nom, celui de `superAgentDisplayLabel()` (personnage actif → nom réglé →
nom habituel) ; le module pur ne fait que **construire** le libellé (repli sur
`DEFAULT_ASSISTANT_NAME` importé, normalisation des espaces) et **borner**
l'affichage à 24 caractères sur une fin de mot avec « … », le **nom entier**
restant dans `title` et `aria-label`, écrits au même endroit.

## 3. Ce qui n'a PAS bougé

Réarmement automatique de la dictée, `vocal-mic.js`, halo et enveloppe de parole,
phrase d'état au-dessus de la barre de saisie, les trois modes d'écran, les trois
sorties de l'overlay, la voie de démarrage du clic (`toggleVoiceInput`, une seule
définition de `startVoiceInput`), les quatre conditions de `vocalRestartVisible`,
et l'absence d'animation (le mouvement réduit coupe le seul effet, le changement
de fond au survol).

## 4. Vérifications

- Tests purs : `npx vitest run src/js/vocal-restart.test.js` →
  **18 tests, 0 échec**.
- Branchement + géométrie : `npx vitest run src/js/ecran-vocal-bouton-relance.test.js`
  → **27 tests, 0 échec**.
- Voisinage de l'écran (`ecran-vocal-lot2`, `ecran-vocal-nu`,
  `vocal-halo-128-et-etat-au-dessus-saisie`, `relances-relecture`,
  `trois-modes-ecran`) → **136 tests, 0 échec**.
- Suite complète (rapport JSON neuf :
  `docs/rapports/sorties/vitest-bouton-reveiller-20261029-0854.json`) →
  **229 fichiers, 4 249 tests, 0 échec**.
- `npm run build` → construction Vite réussie (aucune erreur, seuls les
  avertissements de découpage de chunks déjà présents).
- `npm run build:handbook` → 46 blocs régénérés (`help/handbook.md` n'est jamais
  édité à la main).

### Géométrie, vérifiée par calcul (chiffres lus dans le CSS, jamais recopiés)

`node docs/rapports/sorties/geo-bouton-reveiller.mjs` :

```
disque 168 anneau 2
rayon interieur 84 | rayon exterieur 86
rayon du bouton 84 | jeu avec l'anneau 0 | depassement 0
marge jusqu'a l'exterieur 2 (= epaisseur de l'anneau)
zone de texte 140 x 46.8 | diagonale 147.6 <= 168
```

Lecture : le cercle du bouton **coïncide** avec le bord intérieur de l'anneau
(jeu **0**, débordement **0**), la **seule** épaisseur qui reste entre lui et
l'extérieur du disque est l'anneau de 2 px, et le texte — même sur trois lignes,
le pire cas du libellé borné — tient dans le disque (147,6 px de diagonale pour
168 px). Le disque étant en pixels fixes et le bouton absolu, ces valeurs sont
les mêmes dans une petite et une grande fenêtre.

### Le libellé, vérifié sur trois noms

```
Nova                      -> |Réveiller Nova|            (14 car.)    infobulle |Réveiller Nova|
(aucun personnage)        -> |Réveiller Assistant|       (19 car.)    infobulle |Réveiller Assistant|
60 caracteres             -> |Réveiller Bartholomew-C…|  (24 car.)    infobulle |Réveiller Bartholomew-Casimir de la Tour d'Auvergne Quinzieme du Nom|
```

Aucun nom n'est jamais vide, aucun « undefined », aucun double espace ; un nom
très long est abrégé **à l'écran** sans jamais l'être dans l'infobulle ni dans le
nom accessible.
