# Rapport — le bouton « Travail » sur l'écran du mode Vocal

Date : 2026-10-29 · Projet : `G:\IA_PL\pilot` (Tauri v2 + JS, tests Vitest)
Demande du propriétaire : « le bouton Travail qu'on trouve en haut à droite doit
aussi exister sur l'écran du mode vocal, tout en haut, juste à gauche des boutons
système de la fenêtre ».

---

## 1. Ce qui existait déjà (et qui n'a pas été refait)

| Élément | Où | Rôle |
|---|---|---|
| `#agent-activity` | `index.html` (dans `#tab-row`, juste avant `#window-controls`) | conteneur de l'entrée « Travail » **et** de son panneau |
| `#agent-activity-entry` | dedans | le bouton (pastille d'état + mot « Travail » + compteur) |
| `#agent-activity-dropdown` | dedans | le panneau à trois onglets (Agents · Tâches · Événements) |
| `#agent-activity-card` | dedans | la fiche d'un agent (« Afficher l'onglet ») |
| `src/js/agent-activity.js` | — | `initAgentActivity` : UN écouteur de clic, UN store partagé (`subscribeAgentActivity`), aucun calcul nulle part ailleurs |

Déjà en place : le mode **« Assistant seul »** *déplace* ce même nœud dans sa
barre (`immersiveActivityHome`, sauvegarde `parent` + `next`, restitution à la
sortie). C'est le patron repris ici, à l'identique.

## 2. Ce qui a été fait

### 2.1 Le même nœud, déplacé puis restitué (`src/js/super-agent.js`)

- nouvelle variable d'état `vocalActivityHome` (à côté de
  `vocalModeButtonHome` et `vocalInputHome`) ;
- `enterVocal()` : `vocalOverlay.appendChild(activite)` après avoir mémorisé
  `{ parent, next }` ;
- `exitVocal()` : restitution **avant** `vocalOverlay.remove()` (sinon le nœud
  serait détruit avec l'overlay), `insertBefore(parent, next)` avec vérification
  que le voisin est toujours dans le même parent — exactement comme le logo et la
  barre de saisie.

Conséquence : **aucune copie, aucun second identifiant, aucun second écouteur,
aucun second calcul**. Le panneau est donc le même, avec le même contenu, sur les
deux écrans.

### 2.2 La place : une seule règle CSS (`src/css/style.css`)

```css
body.pilot-vocal-active #agent-activity {
  position: absolute;
  top: 7px;
  right: calc(var(--window-controls-width) + 6px);
  margin: 0;
  align-self: flex-start;
  z-index: 3;
}
```

L'arithmétique n'est pas choisie à l'œil, elle est **recomptée depuis le disque**
et vérifiée par le test :

- `top: 7px` = 4 px d'air + (28 px de touches − 22 px de bouton) / 2 → les 22 px
  du bouton sont **centrés dans la ligne des touches**, sans les mordre ;
- `right: 142 px + 6 px` = `--window-controls-width` (les trois boutons :
  `46 × 3 + 4`) + les **6 px d'air** qui séparent déjà l'entrée des boutons
  système dans « Détaillé » (marge de `#agent-activity`) ;
- `z-index: 3` : au-dessus des enfants de l'overlay (le logo est à 2), donc le
  panneau ne passe jamais **sous** la ligne d'état ni sous la barre de saisie —
  mais toujours **sous** `#window-controls` (autre contexte d'empilement,
  `z-index: 100001`) : la fenêtre reste fermable et déplaçable.

### 2.3 Ce qui n'a pas bougé

Disque lumineux, halo, phrase d'état, barre de saisie, bouton de relance /
coupure de la voix, barre de 44 px, logo : **aucune** de leurs règles n'a été
touchée (le test refuse que la nouvelle règle nomme un autre élément de l'écran).
La règle ne nomme que `#agent-activity`.

## 3. Tests

Nouveau fichier `src/js/bouton-travail-ecran-vocal.test.js` (14 assertions,
5 groupes) :

1. **le même bouton** — un seul `id="agent-activity"`, un seul bouton, un seul
   panneau, un seul compteur dans `index.html` ; l'écran Vocal déplace ce nœud
   (`appendChild(activite)`) et n'en dessine aucun dans `buildVocalOverlay` ;
   aucun écouteur ajouté par `super-agent.js` ;
2. **la place** — `position: absolute`, `top` recalculé (7 px) à partir de la
   hauteur de la rangée et de l'air du groupe, `right` recalculé (142 + 6) à
   partir de la largeur des touches et de la marge de l'entrée, `z-index` local
   et inférieur aux boutons système ;
3. **le contenu** — les trois volets sont dans le panneau unique, une seule
   définition du store partagé ;
4. **rien d'autre ne bouge** — la règle ne nomme aucun autre élément, les règles
   de la relance / de l'état / de la saisie sont intactes, et les **trois**
   nœuds déplacés sont restitués **avant** le retrait de l'overlay ;
5. **la règle est écrite** — présente dans `spec_modes_ecran_vocal.md` et dans
   l'aide intégrée.

Test existant **étendu** (pas contourné) : `src/js/ecran-vocal-nu.test.js` §2 —
il s'appelait « les seuls nœuds déplacés sont la barre de saisie et le logo des
modes » et devient « la saisie, le logo et « Travail » » : le troisième nœud est
désormais couvert explicitement, et il est toujours vérifié que **rien de la
conversation** n'entre dans l'écran.

Résultats (rapport JSON **neuf**, contrôlé en fraîcheur) :

```
fichiers 232 · tests 4289 · réussis 4289 · échoués 0
.pii/vitest-report.json daté du 2026-10-29 10:27:12 (exécution terminée 2 s avant le contrôle)
```

`npm run build` (Vite) : **4140 modules transformés, construit en 12,5 s**, aucune
erreur. Aucun fichier Rust touché (rien à recompiler).

## 4. Documentation

- `spec_modes_ecran_vocal.md` : la liste des nœuds déplacés inclut l'entrée
  « Travail », un paragraphe décrit la place, la raison et la garantie de
  non-duplication ; la phrase « ni l'état des agents » est précisée (le suivi est
  **joignable sur demande**, jamais peint en permanence) pour ne pas se
  contredire ;
- `help/overview.md` (bloc `HELP:modes-ecran`) + `help/handbook.md` régénéré
  (`npm run build:handbook`).

## 5. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src/js/super-agent.js` | +57 −4 (enter/exit + état) |
| `src/css/style.css` | +42 (une règle, un commentaire) |
| `src/js/bouton-travail-ecran-vocal.test.js` | nouveau |
| `src/js/ecran-vocal-nu.test.js` | +10 −2 (test étendu) |
| `spec_modes_ecran_vocal.md` | documentation |
| `help/overview.md`, `help/handbook.md` | aide intégrée |

## 6. Ce qui n'a pas été fait (volontairement)

- Aucun changement du comportement vocal (écoute, coupure de la parole, lecture) :
  la seule ligne ajoutée dans `enterVocal` est un `appendChild` du nœud existant.
- Aucun autre écran réorganisé, aucun réglage ajouté, aucune fonctionnalité
  inventée, aucun autre projet touché (`G:\IA_PL\Presences` non modifié).
- Aucune publication, aucun tag, aucune modification de la configuration de
  publication.
