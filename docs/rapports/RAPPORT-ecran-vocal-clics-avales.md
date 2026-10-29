# Rapport — écran Vocal : plus aucun clic ne répondait (issue #381)

Date : 2026-11-14 · Projet : `G:\IA_PL\pilot` (front Tauri + JS, tests Vitest)
Symptôme rapporté par le propriétaire : **dans la version publiée (v0.6.4),
l'entrée dans l'écran Vocal rendait l'application inutilisable** — le logo
(bouton des trois modes), la touche `Échap` et la croix de l'onglet ne
répondaient plus ; il fallait tuer Pilot par le gestionnaire des tâches.

---

## 1. La cause, prouvée fichier:ligne

Le calque de l'écran Vocal est un plein écran :

```css
/* src/css/style.css — v0.6.4, ligne 11572 */
.pilot-vocal {
  position: fixed;
  inset: 0;
  z-index: 99990;
  ...
}
```

Il **n'avait aucun `pointer-events`** (vérifié sur le fichier publié :
`git show v0.6.4:src/css/style.css`, bloc ouvert ligne **11572**, aucune
déclaration `pointer-events` dans le bloc). Un élément `position: fixed;
inset: 0;` **capte par défaut** tous les clics du viewport ; comme il n'a
lui-même aucun gestionnaire de clic, le clic est consommé et **ne va nulle
part**. Tout ce qui se trouve derrière lui — la rangée d'onglets et sa croix,
la bande du haut où le logo est posé — devenait donc définitivement
inatteignable, à la souris comme au doigt.

C'est ce qui explique les trois symptômes d'un seul coup : les trois voies de
sortie de l'écran Vocal (`spec_modes_ecran_vocal.md` §8) sont **toutes** des
cibles extérieures au calque (logo, croix d'onglet) ou clavier (`Échap`,
`onVocalKeydown` en `document`) — et le clic ne les atteignait plus.

Pourquoi `Échap` aussi : voir le second défaut, §2.

Hiérarchie des plans (vérifiée, pour savoir ce qui passe au-dessus) :

| Élément | z-index | Conséquence |
|---|---|---|
| `#window-controls` (boutons de fenêtre) | 100001 | toujours au-dessus du calque : la fenêtre restait fermable par le système |
| modales | 100000 | au-dessus du calque |
| `.pilot-vocal` | **99990** | le calque, sous les modales |
| `#tab-bar` / `#tab-row` | 2030 / 2016 | **sous** le calque : la croix de l'onglet était recouverte |
| `body.pilot-vocal-active #mode-logo` | 2112 | **sous** le calque : le logo était recouvert |

## 2. Le second défaut : une sortie qui pouvait s'interrompre

`exitVocal()` retirait l'overlay **à la fin** de son démontage. Une exception
levée au milieu (arrêt de la lecture, du micro, des minuteries, de la dictée)
laissait donc l'écran en place, `vocalOverlay` non nul, et **aucune** des trois
voies de sortie ne fonctionnait plus — les trois rappellent la même fonction et
échouaient au même endroit. Seule la saisie clavier répondait encore.

## 3. Le correctif (une seule mutation)

1. **Le calque est traversant** — `src/css/style.css`, bloc `.pilot-vocal` :
   `pointer-events: none` (commentaire « LE CALQUE NE CAPTE PAS TOUS LES CLICS
   (issue #381) »).
2. **Le clic est rendu à six hôtes, et à eux seuls** — une seule règle
   `pointer-events: auto`, en **fin** de la section Vocal (après tous les blocs
   qu'elle nomme) : `.vocal-top`, `.vocal-stage`, `.vocal-status`,
   `.vocal-input`, `#mode-logo`, `#agent-activity` (les quatre zones de l'écran
   plus les deux nœuds **déplacés** dans l'overlay). `pointer-events` s'hérite :
   réactiver ces six nœuds rend le clic à tout leur contenu (barre de saisie et
   ses boutons, disque et ses deux boutons, panneau « Travail »).
3. **Aucun décor ne capte** — vérifié, rien à changer : `.vocal-halo`
   (style.css:11878-11882), `.vocal-orb::before` (11788-11810) et
   `.vocal-orb::after` (11840-11856) portent déjà `pointer-events: none`. C'est
   **nécessaire** : les pseudo-éléments du disque débordent de sa boîte (la
   couronne), et sans cela ils voleraient les clics de la zone qui l'entoure.
4. **La sortie ne dépend plus du démontage** — `src/js/super-agent.js`,
   `exitVocal()` : tout le nettoyage est dans un `try` dont le `catch` **trace
   et n'empêche rien** ; la restitution des trois nœuds (logo, « Travail »,
   barre de saisie) et `vocalOverlay.remove()` sont écrits **après** le `catch`,
   donc toujours atteints.
5. **Les trois portes de sortie** (inchangées, revérifiées) : logo →
   `onScreenModeApply` (mode ≠ vocal ⇒ `exitVocal`) ; `Échap` →
   `onVocalKeydown`, garde de modale conservée
   (`if (document.querySelector(".modal:not(.hidden)")) return;` **avant**
   `exitVocal`) ; croix de l'onglet 🧭 → `stopReading(); exitVocal();`.

Aucune autre modification : ni disposition, ni couleur, ni contenu, ni nouveau
réglage. `#window-controls` reste à 100001 (fenêtre fermable et déplaçable dans
tous les modes) et `agent-activity.js` n'est pas touché — l'overlay ne fait que
rendre son **hôte** cliquable.

## 4. Le piège de la feuille de style (trouvé par les tests)

La règle des six hôtes avait d'abord été posée **juste après** `.pilot-vocal`.
Cinq tests existants (qui découpent la feuille à partir du **nom** d'un
sélecteur : `bloc(CSS, ".vocal-stage")`, `bloc(CSS, ".vocal-status")`) lisaient
alors **le mauvais fragment** (celui de la règle des hôtes, qui cite ces noms
avant leurs blocs) et échouaient sur `gap: 32px`, `color: var(--text-primary)`,
`font-size: var(--font-zone)`. La règle est donc la **dernière** de la section,
et ce point est écrit dans la spec (§8bis) : un nom de sélecteur ne doit pas
apparaître avant le bloc qu'il désigne.

## 5. Le verrou

`src/js/vocal-aucun-calque-ne-capte-les-clics.test.js` — 14 tests :

| Groupe | Ce qui est verrouillé |
|---|---|
| 1 | `.pilot-vocal` couvre le viewport **et** est traversant (`pointer-events: none`) |
| 2 | **une seule** règle de réactivation dans la section, nommant **exactement** les six hôtes ; `#mode-logo` est bien `SCREEN_MODE_BUTTON_ID` de `screen-mode.js` |
| 3 | `.vocal-halo`, `.vocal-orb::before`, `.vocal-orb::after` laissent passer le clic ; aucun décor (`halo|orb|envelope|spectrum|crown|arc`) dans la règle de réactivation |
| 4 | les **trois** voies de sortie appellent `exitVocal`, garde de modale d'`Échap` **avant** la sortie |
| 5 | `exitVocal` : nettoyage dans le `try`, `vocalOverlay.remove()` et restitution des trois nœuds **après** le `catch` |

**Preuve que le verrou échoue sans le correctif** (mutations appliquées puis
retirées, fichier restauré à l'identique) :

| Mutation | Résultat |
|---|---|
| retirer `pointer-events: none` de `.pilot-vocal` | ❌ groupe 1 : `expected '.pilot-vocal {\n  position: fixed;\n …' to match /pointer-events:\s*none/` |
| ajouter `.pilot-vocal .vocal-halo` à la règle des hôtes | ❌ groupe 2 (`[Array(7)]` ≠ `[Array(6)]`) **et** groupe 3 (un décor capte) |
| `vocalOverlay.remove()` déplacé **dans** le `try` | ❌ groupe 5 : `expected 60 to be greater than 3609` |

## 6. Documentation

- `spec_modes_ecran_vocal.md` : nouveau **§8bis « Aucun calque ne capte les
  clics (issue #381) »** — la règle, la cause historique, la liste exhaustive
  des six hôtes, l'interdiction pour tout décor, l'indépendance de la sortie
  vis-à-vis du démontage, la place de la règle dans la feuille, et le verrou.
  §10 (liste des verrous) et §11 (ce qui est prouvé) complétés.

## 7. Tests

- Avant (arbre tel que trouvé) : **4347 passés / 6 échoués**.
- Les **5** échecs de découpage CSS (groupe §4 ci-dessus) sont **réparés** par
  le déplacement de la règle ; le 6ᵉ (`dictee-vocale-se-rearme.test.js:230`,
  « un seul écrivain de la ligne d'état ») est **antérieur et étranger** à cette
  correction : il compte les occurrences de `.vocal-status` dans
  `super-agent.js` et en trouve deux depuis le chantier « le bas s'efface au
  repos » (le test de géométrie du bas lit le même nœud). Il n'est **ni
  assoupli ni modifié** ici : il appartient au chantier concerné.
- Après : compte relevé en fin de mission (voir la réponse de l'agent).

## 8. À vérifier chez vous (non prouvable par un test)

Le comportement réel du WebView : un clic dans le vide, un clic sur le logo
(il **doit** sortir du mode), `Échap`, la croix de l'onglet, la barre de saisie
et son bouton d'envoi, la dictée, et l'entrée « Travail » du panneau.
