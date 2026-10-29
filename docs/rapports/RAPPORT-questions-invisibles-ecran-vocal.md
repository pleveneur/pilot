# Rapport — les questions de l'assistant étaient invisibles dans l'écran Vocal

Date : 2026-11-14 · Projet : `G:\IA_PL\pilot` (front-end Tauri + JS, tests Vitest)
Demande du propriétaire : en mode Vocal, quand l'assistant pose une question
(choix, choix multiple, confirmation, saisie libre), **on ne voit rien** et le
travail reste bloqué. La question doit s'afficher **dans** l'écran Vocal,
au-dessus de la ligne de saisie, avec ses boutons cliquables — sans rouvrir la
conversation, sans masquer le portrait ni la barre de saisie, et sans changer la
disposition existante.

---

## 1. Le défaut, prouvé par le disque

### 1.1 Où les questions sont construites

| Fichier:ligne | Ce qu'on y lit |
|---|---|
| `src/js/super-agent.js:2304-2331` | `renderActivePendingQuestion()` : **tout** le rendu d'une question se fait dans `#pendingBar` (`pendingBarEl.innerHTML = ""`, puis `q.render(bar)`). Rien n'est peint dans la conversation, hors un bandeau informatif en lecture seule (`makeChoiceBanner`). |
| `src/js/super-agent.js:2334-2338` | `enqueuePendingQuestion(q)` : la question entre dans la file FIFO `pendingQuestions` puis on re-rend la tête de file. |
| `src/js/super-agent.js:2341-2352` | `finalizePendingQuestion()` : `shift()` puis re-rendu — une seule question affichée à la fois, sans perte. |
| `src/js/super-agent.js:3428-3434` | `createSuperAgent` : `const pendingBar = document.createElement("div"); pendingBar.id = "pendingBar"; pendingBar.className = "agent-pending-bar-container"; wrapper.appendChild(pendingBar);` |
| `src/js/super-agent.js:2498-2503` | `validatePendingQuestion(raw)` : la précision saisie dans la barre principale est remise à la question (`q.submit(note, false)`). |
| `src/js/super-agent.js:2425-2483` | `finishPendingQuestion` : envoi par `q.responder(q.id, value, cancelled)` puis `finalizePendingQuestion()` — **le seul** chemin de réponse. |

### 1.2 Pourquoi elles n'apparaissaient pas en mode Vocal

| Fichier:ligne | Ce qu'on y lit |
|---|---|
| `src/css/style.css:11572-11575` | `.pilot-vocal { position: fixed; inset: 0; z-index: 99990; }` — un calque **plein écran** au-dessus de tout l'onglet. |
| `src/css/style.css:11604` | `.pilot-vocal` a un fond **opaque** (`background: var(--bg-app)`), posé exactement pour rendre l'écran nu. |
| `src/js/super-agent.js:5525-5529` (avant correctif) | `enterVocal()` ne déplaçait que **trois** nœuds dans l'overlay : la barre de saisie (`inputBar`), le logo `#mode-logo` et l'entrée « Travail » `#agent-activity`. **`#pendingBar` n'était pas déplacée.** |
| `src/css/style.css:11637-11639` | `body.pilot-vocal-active .agent-chat-messages { visibility: hidden; }` : même la conversation est invisible en Vocal — il n'existait donc **aucun** chemin de repli par lequel une question pouvait être lue. |

**Conclusion.** La rangée des questions restait enfant du **wrapper de l'onglet**,
c'est-à-dire **derrière** le calque opaque de l'écran Vocal. Une question posée
pendant le mode Vocal n'était peinte **nulle part** : l'utilisateur ne voyait
rien, aucune réponse ne partait, et le travail restait bloqué jusqu'à
l'expiration de l'attente. Le défaut est structurel (place du nœud), pas visuel
(aucune règle CSS ne la cachait explicitement).

---

## 2. La correction

### 2.1 La rangée entre dans l'écran, au-dessus de la ligne de saisie

`src/js/super-agent.js` — `enterVocal()`, juste après le déplacement de
`inputBar` :

```js
if (pendingBar && zone) {
  vocalQuestionsHome = { parent: pendingBar.parentNode, next: pendingBar.nextSibling };
  zone.insertBefore(pendingBar, inputBar && inputBar.parentNode === zone ? inputBar : null);
}
```

- **Même nœud** : `insertBefore` **déplace** la rangée, il n'en crée pas une
  seconde. Mêmes boutons, mêmes écouteurs, mêmes réponses, même file FIFO —
  **aucun second affichage, aucun second mécanisme de réponse**.
- **Dans le flux**, pas en `position: absolute` : la question pousse la ligne de
  saisie vers le bas, elle ne recouvre **ni le portrait, ni le disque, ni la
  ligne d'état, ni le champ**.
- La référence d'insertion est `inputBar`, **et seulement s'il est bien dans la
  zone** : la rangée ne peut pas se retrouver après la ligne de saisie.

`exitVocal()` la **restitue** à sa place d'origine (parent **et** voisin), avant
la restitution de `inputBar` et avant `vocalOverlay.remove()` : une question
encore en attente à la sortie du mode reste visible dans l'onglet, et les autres
écrans ne perdent rien.

### 2.2 Elle n'est jamais masquée

Le bas de l'écran Vocal s'efface après 2 500 ms (`vocal-chrome.js`). Une
**cinquième** règle y est ajoutée, après les quatre existantes :

```js
// 5. Une question de l'assistant attend une reponse (§2.3 du document) :
//    le bas porte la rangee de boutons, il ne s'efface donc jamais tant qu'une
//    question est en file. Rien n'expire ici : c'est l'utilisateur qui repond.
if (f.question === true) return true;
```

- Le fait est lu **dans la file** (`question: hasPendingQuestion()`), source
  unique : aucune variable d'état parallèle.
- La décision est **réappliquée à chaque changement de file** :
  `pendingQuestionChromeSync` (posé par `createSuperAgent`) est appelé en fin de
  `renderActivePendingQuestion()`. Sans ce rappel, une question arrivée pendant
  que le bas était effacé ne serait jamais peinte.
- Aucun minuteur, aucune expiration : une question humaine attend un geste.

### 2.3 Apparence : rien de nouveau à l'écran, rien de déplacé

`src/css/style.css`, bloc **strictement borné à `.pilot-vocal`** (titre §2.7) :

- conteneur : `border-top: none`, `background: transparent`,
  `max-height: min(140px, 22vh)`, `margin: 0`, `padding: 0 2px` (défilement
  interne au-delà) ;
- **conteneur vide → aucune place** (`:empty { margin: 0; padding: 0; }`) : au
  repos, sans question, l'écran est **exactement** celui du lot 2 ;
- titre centré, boutons centrés (`justify-content: center`).

**Pourquoi 140 px.** La formule du disque réserve **289 px** au reste de l'écran
(§1.5 de la conception). À 750 px de haut la scène garde 472 px pour une boîte de
halo de 460 px ; à 500 px, 252 px pour 182 px. Un plafond plus haut (200 px)
aurait rogné le halo : c'est pour cela qu'il est borné, et un test le verrouille.

Le bloc **d'origine** de `.agent-pending-bar-container` (filet, fond
`--surface-2`, `max-height: 220px`) est **intact** : l'onglet Assistant ne change
pas.

### 2.4 Une seule question, file FIFO sans perte

La file `pendingQuestions` n'est pas touchée : la rangée montre la **tête**, la
réponse (`q.responder` → `finalizePendingQuestion`) fait avancer la file, la
suivante prend la place. **Aucun minuteur, aucune expiration** : rien ne
disparaît tout seul.

### 2.5 Comment on répond — et ce qui n'est pas fait

- **Clic** sur les boutons de la rangée (choix, choix multiple, confirmation
  Oui/Non, Valider/Annuler) : le chemin existant, inchangé.
- **Saisie libre** : le texte se tape dans la barre juste en dessous ; `send()`
  détourne l'envoi vers la question tant qu'une question attend
  (`hasPendingQuestion()` → `validatePendingQuestion(inputEl.value)`).
- **Pas de réponse vocale directe aux choix.** Le mécanisme existant ne l'a
  jamais prévu : il n'y a aucune reconnaissance de « oui », « non », « la
  deuxième ». Le deviner reviendrait à **répondre à la place de l'utilisateur**.
  La dictée peut en revanche servir à **dicter** le texte d'une saisie libre.
- **Garde ajoutée (règle 4b de `vocal-conversation.js`)** : tant qu'une question
  attend, la **dictée automatique est fermée** (une dictée déjà ouverte est
  fermée). Sans elle, l'écran s'armait tout seul pendant l'attente : une phrase
  prononcée à côté partait comme réponse, et pour une **confirmation** — dont la
  valeur par défaut est « oui » — elle validait sans un geste. Le geste 🎙️
  rouvre la dictée : dicter sa réponse est un acte explicite. Ce refus n'affiche
  **aucune phrase d'échec** (`vocalDictationMessage("question-en-attente") === ""`)
  et n'est **pas** repris en boucle.

### 2.6 Aucun calque décoratif ne capte les clics

La rangée ne réclame **aucun hôte cliquable supplémentaire** : elle vit dans
`.vocal-input`, déjà l'un des **six** hôtes `pointer-events: auto` du correctif
« aucun calque ne capte les clics » (issue #381). Le test
`src/js/vocal-aucun-calque-ne-capte-les-clics.test.js` reste vert sans être
touché.

### 2.7 Hors du mode Vocal

Tous les styles ajoutés sont bornés à `.pilot-vocal`, et le déplacement n'a lieu
que dans `enterVocal` : dans les modes « Détaillé » et « Assistant seul », la
rangée est là où elle était, avec sa présentation d'origine.

---

## 3. Le test qui interdit la récidive

Nouveau fichier : **`src/js/ecran-vocal-question-visible.test.js`** (23 tests).

| # | Ce qu'il verrouille |
|---|---|
| 1 | Le défaut d'origine est décrit par le disque : rendu dans `#pendingBar`, calque opaque, `visibility: hidden` sur la conversation. |
| 2 | `enterVocal` **déplace** la rangée dans `.vocal-input`, **avant** la barre de saisie ; `exitVocal` la **restitue** avant le retrait du calque ; la rangée hérite du pointeur de son hôte. Plafond de hauteur ≤ 140 px ; conteneur vide = aucune place. |
| 3 | Elle ne peut **jamais** être masquée : règle 5 présente dans `vocalChromeVisible` et respectée dans l'ordre, `vocalSyncChrome` lit `question: hasPendingQuestion()`, appel par changement de file, aucun `display: none` / `visibility: hidden` / `position: absolute` dans le bloc, et rien dans l'écran Vocal ne la cache. |
| 4 | Une seule question, FIFO, aucun minuteur, pas d'expiration. |
| 5 | La réponse reste la voie existante (`q.responder`, `finalizePendingQuestion`, `send()` → `validatePendingQuestion`) ; `exitVocal` ne touche pas à la file. |
| 6 | Hors mode Vocal : styles bornés, bloc d'origine intact. |
| 7 | La dictée ne répond pas à ma place (règle 4b) : au repos sans question elle s'arme ; avec une question elle est fermée (`question-en-attente`, aucune phrase, aucune reprise) ; une dictée déjà ouverte est **fermée**. |

**Le test échoue si le défaut revient** — vérifié par mutation :

| Mutation appliquée | Résultat |
|---|---|
| retrait du `insertBefore` dans `enterVocal` et de la restitution dans `exitVocal` | **3 échecs** (« la rangée entre dans l'écran », « au-dessus de la ligne de saisie », « restitution à la sortie ») |
| retrait du fait `question: hasPendingQuestion()` et de la règle 5 | **5 échecs** (dont `vocal-chrome-masque.test.js`) |
| retrait de la règle 4b de `decideVocalDictation` | **2 échecs** (question en attente, dictée déjà ouverte) |

---

## 4. Résultat des tests

Tests ciblés lancés avant le rapport :

```
npx vitest run src/js/ecran-vocal-question-visible.test.js        -> PASS (23) FAIL (0)
npx vitest run src/js/ecran-vocal-nu.test.js                       -> PASS (17) FAIL (0)
npx vitest run src/js/vocal-chrome-masque.test.js                 -> PASS (23) FAIL (0)
npx vitest run src/js/vocal-aucun-calque-ne-capte-les-clics.js…   -> PASS (14) FAIL (0)
```

**Un test existant a dû être RÉVISÉ, et c'est dit ici.** `src/js/ecran-vocal-nu.test.js`
(« la conversation, la barre d'outils et les bandeaux restent dans l'onglet »)
interdisait littéralement la présence du mot `pendingBar` dans `enterVocal`.
L'intention de ce verrou — l'écran nu ne **ramène pas la conversation** — est
conservée ; `pendingBar` sort de la liste noire et devient une **exception
écrite**, du même type que celles déjà présentes dans ce fichier (le logo
`#mode-logo` et le bouton « Travail » sont, eux aussi, déplacés). Une assertion
**positive** est ajoutée à la place (`expect(enter).toContain("pendingBar")`), et
le nouveau fichier verrouille le comportement de l'autre côté (déplacée
au-dessus de la saisie, jamais masquée, aucun rendu de conversation avec elle).
Aucun autre test n'a été retiré, assoupli, marqué `skip` ou `only`.

Suite complète : voir § 5.

---

## 5. Suite complète — compte exact

| Mesure | Total | Réussis | Échecs |
|---|---|---|---|
| **Avant** (`git stash push -u -- src`, donc `HEAD`) | **4367** | **4365** | **2** |
| **Après** (avec le correctif) | **4391** | **4389** | **2** |

- **+24 tests**, tous verts (23 dans le nouveau fichier, 1 net dans
  `vocal-chrome-masque.test.js` : la règle 5 s'ajoute et le test d'ordre passe de
  quatre à cinq ; les autres assertions de ce fichier sont étendues, pas
  remplacées).
- **Les 2 échecs sont les mêmes avant et après**, mot pour mot :
  `src/js/dictee-vocale-se-rearme.test.js:230` (« un silence ne s'annonce jamais
  comme un échec ») et `src/js/vocal-parler-declenche-une-demande.test.js:262`
  (« UN SEUL point d'application : la fin de applyVocalState », qui compare une
  liste d'appels écrite avant l'ajout du bouton de relance). Aucun échec
  nouveau, aucun échec déplacé.

---

## 6. Fichiers touchés

| Fichier | Modification |
|---|---|
| `src/js/super-agent.js` | 4ᵉ nœud déplacé (la rangée des questions) + restitution ; fait `question` dans `vocalConversationState` ; fait `question` dans `vocalSyncChrome` ; rappel `pendingQuestionChromeSync`. |
| `src/js/vocal-chrome.js` | Règle 5 de `vocalChromeVisible` (une question retient le bas), docstring à cinq règles. |
| `src/js/vocal-conversation.js` | Règle 4b : une question en attente ferme la dictée automatique ; message vide pour cette raison ; docstring (vocabulaire + ordre des règles). |
| `src/css/style.css` | Bloc §2.7 borné à `.pilot-vocal` (rangée au-dessus de la saisie, sans cadre, hauteur bornée, vide = aucune place). |
| `src/js/vocal-chrome-masque.test.js` | Cinq circonstances, ordre 1 → 5, `vocalSyncChrome` à cinq faits. |
| `src/js/ecran-vocal-nu.test.js` | `pendingBar` : exception écrite (l'écran nu ne ramène pas la conversation) + assertion positive. |
| `src/js/ecran-vocal-question-visible.test.js` | **Nouveau** — 23 tests. |
| `spec_modes_ecran_vocal.md` | §4bis : cinq situations, « Une question de l'assistant est visible et répondable dans cet écran ». |
| `docs/conceptions/CONCEPTION-ecran-vocal-cercle-et-bas.md` | §2.1, §2.3 (règle 5), §2.6 (cinq faits, quatrième appel), **§2.7** (nouveau). |

---

## 7. Commandes

```bash
npx vitest run src/js/ecran-vocal-question-visible.test.js
npx vitest run src/js/vocal-chrome-masque.test.js src/js/vocal-aucun-calque-ne-capte-les-clics.test.js
npx vitest run            # suite complète
npm run build:handbook   # si un bloc <!-- HELP:* --> a changé
```
