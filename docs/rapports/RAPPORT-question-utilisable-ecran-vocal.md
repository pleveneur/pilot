# Rapport — une question affichée dans l'écran Vocal était là, mais pas utilisable

**Mission** : complément à la mission « la question de l'assistant s'affiche et
se répond dans l'écran Vocal » (commit `87164d1`).
**Date** : 2026-11-16.
**Périmètre** : `src/js/vocal-question-utilisable.js` (nouveau),
`src/js/super-agent.js`, `src/js/vocal-conversation.js`, `src/css/style.css`,
`spec_modes_ecran_vocal.md` §4bis, `help/overview.md` (+ `help/handbook.md`
régénéré).

---

## 1. Ce qui marchait déjà, et ce qui n'allait pas

La mission précédente avait réglé le **défaut de visibilité** : la rangée de
questions (`#pendingBar`) vivait dans l'onglet Assistant, donc **derrière** le
calque opaque de l'écran Vocal (`z-index: 99990`) ; elle n'apparaissait nulle
part. `enterVocal` la **déplace** désormais dans `.vocal-input`, juste au-dessus
de la ligne de saisie, et `exitVocal` la restitue exactement à sa place.

Trois défauts restaient, tous invisibles à la lecture de la seule visibilité.

### 1.1 Le curseur n'entrait jamais dans la zone de saisie

`enterVocal` et `applyVocalState` ne tournent **pas** quand une question arrive :
côté écran, le **seul** point qui apprend un changement de la file est
`pendingQuestionChromeSync`, appelé par `renderActivePendingQuestion()` à chaque
arrivée / réponse / avancement. Or ce rappel ne s'occupait que de la
**visibilité du bas** (règle 5 de `vocal-chrome.js`) : il ne donnait jamais le
curseur au champ.

Conséquence concrète : la question s'affichait, mais **écrire, dicter ou
appuyer sur Entrée ne faisait rien** tant que l'on n'avait pas cliqué dans la
barre de saisie. Sur un écran dont toute la promesse est « on parle, on écrit,
sans rien chercher », c'est exactement le geste qu'on voulait éviter.

### 1.2 Le disque pouvait passer devant la rangée et avaler le clic

La rangée est **dans le flux**, dans `.vocal-input`. Mais le disque
`.vocal-orb` est `position: relative` et **peint au-delà de sa boîte** : sa
couronne (`--vocal-crown`, 88 px à pleine taille) et sa lueur interne
(`.vocal-orb::before`, `inset: calc(var(--vocal-crown) * -1)`) débordent.

La formule de taille (§1.5 de la spec) garantit 289 px de marge **au-dessus du
plancher**… tant que le bas ne prend que sa place de repos. Avec une question de
**140 px** de haut (plafond) **plus** le bouton de dépannage du micro
(`.vocal-mic-fix`) sur une fenêtre basse, le bas réclame plus que ces 289 px, et
le disque — qui, lui, ne descend pas sous 120 px — se retrouve **au-dessus du
haut de la rangée** dans l'ordre de peinture. Un clic sur un bouton de choix
pouvait donc être mangé par le décor. `.vocal-input` n'avait aucun `z-index`.

### 1.3 La dictée ouverte par le geste 🎙️ était refermée dans la milliseconde

La règle 4b de `vocal-conversation.js` ferme la dictée tant qu'une question
attend — c'est **voulu** : une phrase prononcée à côté vaudrait réponse, et une
**confirmation** (valeur par défaut « oui ») serait validée sans geste.

Mais la règle ne distinguait pas **qui** avait ouvert la session. Un clic sur
🎙️ posait `voiceActive = true`, puis `applyVocalState()` recalculait le plan et
**refermait aussitôt** la session (`question === true`). Le bouton semblait ne
rien faire : l'écran promettait une dictée impossible, alors que « dicter sa
réponse » est précisément l'un des cas d'usage de l'écran Vocal.

---

## 2. Ce que la mission n'a pas refait

Par principe, et pour ne pas poser un second mécanisme :

| Déjà en place | Preuve que la mission s'appuie dessus |
|---|---|
| Les quatre rendus de question répondent au clic (`renderChoicePendingBar`, `renderConfirmPendingBar`, `renderInputPendingBar`, saisie libre) | ils appellent tous `validatePendingQuestion(...)` |
| Écrire dans la saisie répond à la question | `send()` fait `if (hasPendingQuestion()) { validatePendingQuestion(inputEl.value); return; }` **avant** l'envoi normal — donc `Entrée`, le bouton Envoyer **et** la fin de dictée (`applyVoiceEnd` → `send`) passent par là |
| Une seule question à la fois, file FIFO | `pendingQuestions` + `finalizePendingQuestion()` (déjà verrouillés) |
| Aucune expiration d'une question humaine | aucun minuteur dans le rendu ni dans le rappel (verrouillé par un test) |
| La rangée hérite du clic de `.vocal-input` | sixième hôte du §8bis, **aucun** `pointer-events: auto` ajouté |

Le complément ne touche donc **ni** la logique de réponse, **ni** la file, **ni**
la place de la rangée, **ni** le design. Il ne change que l'**activation**.

---

## 3. Les corrections

### 3.1 Un module pur : `src/js/vocal-question-utilisable.js` (nouveau)

Source unique de la décision « le champ prend-il le curseur ? », aucune I/O,
aucun DOM, aucune minuterie :

- `decideVocalQuestionFocus({ vocal, questionId, modalOuverte, dejaConcentre })`
  — **cinq règles, dans cet ordre** (l'ordre **est** la spec) :
  1. hors du mode Vocal → **non** (l'écran ne vole jamais le curseur au reste de
     l'application) ;
  2. aucune question en tête de file → **non** ;
  3. une modale est ouverte → **non** (même garde que `applyVocalState`) ;
  4. le curseur est déjà sur **cette** question → **non** (le re-rendu d'un choix
     multiple ne retire pas le curseur au champ sous les doigts de
     l'utilisateur) ;
  5. sinon → **oui**.
- `planVocalQuestionFocus(etats)` → `{ focus, memoire }` : la décision **et** la
  mémoire du curseur, pour un seul appelant.

### 3.2 `src/js/super-agent.js` — un seul point d'application

`pendingQuestionChromeSync` (déjà appelé à **chaque** changement de la file) :
`vocalSyncChrome()` puis `planVocalQuestionFocus(...)` avec la mémoire
`vocalQuestionFocused`, puis `inputEl.focus()` (sous `try/catch`) si la décision
le dit. Aucun second branchement, aucune seconde condition écrite sur place.

Nouveau drapeau `vocalDicteeParGeste`, posé par le **geste** (`toggleVoiceInput`,
juste avant `startVoiceInput()`), retiré par l'**armement automatique**
(`armVoiceInput`) et par la fermeture de session (`stopVoiceInput`). Il est
publié par `vocalConversationState()` sous le nom `ouvertureParGeste`, et
**toujours combiné à `voiceActive === true`** : un drapeau périmé est sans effet.

### 3.3 `src/js/vocal-conversation.js` — la règle 4b distingue le geste

```js
if (e.question === true && e.ouvertureParGeste !== true) {
  return { action: VOCAL_DICTATION_DISARM, raison: "question-en-attente", delai: 0 };
}
```

La dictée **automatique** reste fermée sur une question (comportement d'origine,
verrouillé) ; la dictée ouverte par un **geste** tombe à la règle 5 (« déjà
ouverte ») et **tient**. Un seul moteur de transcription, un seul envoi : rien
de nouveau n'est créé.

### 3.4 `src/css/style.css` — l'ordre de peinture, pas un nouvel hôte

`.vocal-input` reçoit `position: relative; z-index: 1;` : la saisie **et la
rangée qu'elle porte** sont peintes devant la scène, donc le disque ne peut plus
manger un clic. Aucun `top/left/right/bottom` (la mise en page ne bouge pas),
aucun `position: absolute`, et la liste des **six hôtes** du §8bis reste
intacte : `.vocal-input` est à `1`, sous le logo `#mode-logo` (`2`) et sous
« Travail » `#agent-activity` (`3`).

---

## 4. Le verrou : `src/js/ecran-vocal-question-utilisable.test.js` (25 tests)

Le test **échoue** si une question affichée en mode Vocal laisse la zone de
saisie ou les boutons inactifs. Il couvre, par famille :

1. **le curseur à l'arrivée** — une question s'affiche ⇒ focus ; hors Vocal ⇒
   jamais ; sans question ⇒ non ; modale ouverte ⇒ non ; re-rendu ⇒ non ; la
   question **suivante** le reprend (séquence q1 → re-rendu → q2 → file vide) ;
2. **un seul mécanisme** — `pendingQuestionChromeSync` contient bien
   `planVocalQuestionFocus(` et `inputEl.focus();` ; la décision n'est pas
   réécrite sur place ; le rappel est appelé **après** le rendu de la tête de
   file dans `renderActivePendingQuestion` ; **aucun** `setTimeout` /
   `setInterval` ; un seul `pendingQuestions.push(` dans tout le fichier ;
3. **la saisie répond** — `send()` détourne vers `validatePendingQuestion`
   **avant** l'envoi normal, et coupe d'abord `stopReading()` ;
4. **aucun clic avalé** — `.vocal-input {` contient `position: relative` et
   `z-index: 1`, sans décalage ni `absolute` ; le logo (`2`) et « Travail » (`3`)
   restent devant ; la liste des **six** hôtes est intacte et ne nomme pas
   `agent-pending` ; le **seul** `pointer-events: none` qui touche `.vocal-input`
   est celui de l'effacement du bas ; aucune règle ne désactive le clic sur la
   rangée ;
5. **la dictée par geste tient** — sans geste, une question ferme la dictée
   automatique (règle d'origine, conservée) ; avec `ouvertureParGeste`, elle est
   **maintenue** ; le drapeau est posé par le geste (avant `startVoiceInput`),
   retiré par l'armement automatique et par `stopVoiceInput` ; l'automatisme ne
   s'arme **jamais** sur une question.

Les découpages de source passent par `src/js/source-slice.js` (une ancre
disparue **lève** au lieu de rendre un fragment vide).

---

## 5. Anti-régression

**Comptes exacts mesurés** (`npm test`, suite complète) :

| | Fichiers | Tests | Verts | Échecs |
|---|---|---|---|---|
| Avant | 238 | 4391 | 4389 | 2 |
| Après | 239 | 4416 | 4414 | 2 |

`+25` tests, `+1` fichier de test, **les deux mêmes échecs** — vérifiés
**préexistants** en remisant mes modifications (`git stash push` sur les
fichiers touchés puis relance) :
`dictee-vocale-se-rearme.test.js > « une erreur qui n'a pas de phrase… »` et
`vocal-parler-declenche-une-demande.test.js > « UN SEUL point d'application : la
fin de applyVocalState »`. Tous deux comptent une occurrence que le commit
`e1b3005` (#381) a légitimement portée à deux ; ils n'ont **pas** été touchés
(les modifier aurait été un assouplissement de verrou hors mission).

- **Aucun test existant modifié ni assoupli.**
- Les verrous voisins sont relus et inchangés : `ecran-vocal-question-visible.test.js`
  (visibilité, FIFO, aucune expiration), `vocal-aucun-calque-ne-capte-les-clics.test.js`
  (six hôtes, décors traversants, trois sorties), `vocal-chrome-masque.test.js`
  (règle 5 : une question interdit le masquage), et les tests qui comptent les
  appels à `startVoiceInput` / `send` (`vocal-parler-declenche-une-demande`,
  `vocal-repondre-deux-secondes`, `dictee-vocale-se-rearme`,
  `ecran-vocal-bouton-relance`) : le drapeau ajouté ne crée ni appel ni envoi.
- **Documentation** : `spec_modes_ecran_vocal.md` §4bis (règle du curseur, de
  l'ordre de peinture et du geste qui tient), §10 (verrou ajouté) et §11
  (prouvé) ; `help/overview.md` (une question se répond sur place) puis
  `npm run build:handbook` — sans ce rebuild, `help-delai-inactivite.test.js` et
  `libelle-options-ecran.test.js` échouent.

## 6. Commandes

```bash
npx vitest run src/js/ecran-vocal-question-utilisable.test.js
npm test
npm run build:handbook
```
