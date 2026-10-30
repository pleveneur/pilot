# RAPPORT — Écran Vocal : la colonne de gauche (discussion) restait vide

Date : 2026-11-13 · Projet : Pilot · Portée : écran **Vocal**, colonne de **gauche**
seule. Aucune version bumpée, aucune publication, aucun push, aucun tag.

## 1. Le défaut signalé

> « À gauche, l'aperçu de la discussion est **vide** et ne s'actualise pas pendant
> l'échange. »

Attendu : la colonne montre, **en direct**, la conversation entre le propriétaire et
l'assistant — seulement les tours de parole (la demande transcrite + la réponse),
rien d'autre.

## 2. Cause exacte (preuve, code d'avant)

### 2.1 La colonne de gauche n'a jamais eu de corps

Le balisage statique de l'overlay crée l'`<aside>` de gauche **vide**, alors que
celui de droite porte son `.vocal-side-body` :

- `src/js/super-agent.js:5537` (d'avant) :
  ```html
  <aside class="vocal-side-discussion vocal-side"></aside>
  ```
- `src/js/super-agent.js:5504` (d'avant), colonne de droite, pour comparaison :
  ```html
  <div class="vocal-side-body"></div>
  ```

Or la peinture de la colonne de gauche **cherchait** ce corps au lieu de le créer
(`src/js/super-agent.js:2469-2470`, d'avant) :

```js
  const corps = colonne.querySelector(".vocal-side-body");
  if (!corps) return;
  const html = buildVocalDiscussionHtml(vue);
  ...
```

`querySelector` rendait donc **toujours** `null` : la fonction sortait **avant**
d'écrire quoi que ce soit. Le titre « DISCUSSION » était peint (il est créé juste
au-dessus), le contenu jamais. La décision `vocalDiscussionView()` était bien
calculée, puis **jetée**.

**Conséquence directe sur les deux symptômes** : il n'y avait pas deux défauts mais
un seul. Le tic de 900 ms appelait bien la peinture à chaque passage ; comme le corps
n'existait pas, **aucune** mise à jour ne pouvait paraître. La colonne était vide à
l'ouverture *et* pendant l'échange.

### 2.2 Deuxième défaut, invisible tant que la colonne était vide : la réflexion et les outils étaient lus

La lecture prenait le texte de la **bulle entière** (`src/js/super-agent.js:2410`,
d'avant) :

```js
    const texte = String((bulle || el).textContent || "");
```

Or la bulle d'une réponse de l'assistant contient, dans `.agent-stream-flow` :
`.agent-text-section` (le texte **dit**), `.agent-thinking` (la **réflexion**) et
`.agent-tool-inline` (les **lignes d'outils**) — cf.
`src/js/super-agent.js:3446/3453` et `:3414` (d'avant). La sélection
`.agent-message-user, .agent-message-assistant` écartait bien les messages
`agent-message-system`, mais **pas** ce qui vit *à l'intérieur* d'une bulle de
réponse. Dès que le corps aurait existé, la colonne aurait affiché la réflexion
interne et les appels d'outils.

### 2.3 Hypothèses écartées (vérifiées, non coupables)

- **La source de données était-elle lue ?** Oui : `superMessagesEl` est bien
  renseigné (`createSuperAgent`, `messagesEl.className = "agent-chat-messages"`) et
  les deux familles du chat existent (`appendMessage`, `createSuperAgentBlock`).
- **La zone était-elle sans hauteur ou masquée ?** Non : la règle
  `.vocal-side-discussion > .vocal-side-body` (`src/css/style.css:11833`) donne
  `flex: 0 1 auto`, `display: flex`, `justify-content: flex-end` ; le corps de la
  colonne de droite (même classe) s'affiche, lui, parfaitement. Un test le verrouille
  désormais (`A1`).
- **Le rendu ne tournait-il jamais ?** Il tournait : `vocalSyncSides()` appelle
  `vocalRenderDiscussion(plan)` à l'entrée du mode, à chaque redimensionnement et à
  chaque tic (`VOCAL_SIDES_TICK_MS = 900`).

## 3. Ce qui a été changé

### `src/js/super-agent.js`

1. **Le corps est créé** (`:2516`), une seule fois, **sous le titre** :
   ```js
   const corps = vocalColumnNode(colonne, ".vocal-side-body", "last");
   ```
   `vocalColumnNode` rend le nœud existant s'il est déjà là : la création est
   idempotente, le tic ne fabrique pas de doublon. Le balisage statique de
   `buildVocalOverlay()` ne gagne **aucun** nœud (la liste ordonnée des classes lue
   par les tests ne bouge pas).
2. **Le plus récent reste visible** (`:2526`) : après l'écriture,
   `corps.scrollTop = corps.scrollHeight;` — le corps est déjà collé au bas
   (`justify-content: flex-end`), ce défilement tient le cas d'un contenu plus haut
   que la place disponible. Aucun geste de l'utilisateur n'est requis.
3. **Lecture stricte** (`collectVocalDiscussion`, `:2413`) :
   - propriétaire : le texte de sa **bulle**, **moins** la rangée d'étiquettes de
     projet (« 📁 nom », qui n'est pas une parole) ;
   - assistant : **uniquement** les `.agent-text-section` de sa bulle — liste
     blanche. On ne cite pas ce qu'on refuse : la réflexion et les lignes d'outils ne
     sont jamais lues, même si le réglage « afficher la réflexion » est actif ;
   - puis passage par le **filtre unique** (§ 4).
4. **Import** du module de filtre (`:246`).

### `src/js/vocal-discussion-turns.js` (nouveau, **pur** : aucun DOM, aucune horloge)

Source **unique** de la règle « ceci est une parole / ceci n'en est pas une » :
`normalizeVocalTurnRole`, `isVocalSpeechTurn`, `vocalSpeechTurns`, plus les deux
listes qui rendent la règle testable (`VOCAL_SPEECH_ROLES`, `VOCAL_SILENT_KINDS`,
`VOCAL_SPEECH_KINDS`).

## 4. Ce qui est filtré, exactement

Un message paraît dans la colonne **si et seulement si** :

1. son rôle est celui du **propriétaire** (`user`, alias `owner`/`propriétaire`/
   `utilisateur`) ou celui de l'**assistant** (`assistant`, alias `agent`/`pilot`) ;
2. s'il déclare une **famille** (`kind`), cette famille est une famille de parole
   (`message`, `text`, `speech`, `bubble`, `reply`) — donc une réflexion ou un
   résultat d'outil qui se présenterait avec un rôle de réponse est écarté ;
3. son **texte n'est pas vide** (un message vide ferait un trou dans la colonne).

Ne paraissent **jamais** : réflexion (`thinking`, `reasoning`, `reflexion`,
`reaction`), appels d'outils et leurs résultats (`tool`, `tool-call`, `tool-result`,
`tool_use`, `tool_result`), messages système et accusés (`system`, `receipt`), traces,
journaux, diffs de code (`trace`, `log`, `journal`, `diff`, `patch`, `meta`) — et, par
construction, tout ce qui vit dans la bulle hors des sections de texte.

## 5. Mise à jour en direct, et reprise de l'historique

- **Aucun second mécanisme** : c'est le tic existant (900 ms) qui repeint, via
  `vocalSyncSides()` → `vocalRenderDiscussion(plan)`. Aucune horloge ajoutée, aucun
  écouteur ajouté, aucun appel dans `applyVocalState` (dont la dernière instruction
  est verrouillée par un test).
- **Latence** : un nouveau tour paraît en au plus ~0,9 s, sans changer d'écran ni
  recharger.
- **Historique déjà présent** : la lecture parcourt **toute** la conversation du chat
  (pas un flux d'évènements), donc une session déjà commencée est affichée dès
  l'ouverture du mode ; `enterVocal()` peint les colonnes en dernier, après avoir posé
  l'état.
- **Aucun clignotement** : le corps n'est réécrit que si le texte a changé
  (`data-vocal-discussion`), donc le tic repasse sans repeindre.

## 6. Tests

| | Total | Passés | Échoués |
|---|---|---|---|
| **Avant** (`npx vitest run`) | 4731 | 4731 | 0 |
| **Après** (`npx vitest run`) | **4757** | **4757** | **0** |

Delta : **+26** = 8 tests du module pur (`vocal-discussion-turns.test.js`) + 17 tests
de la colonne (`vocal-colonne-discussion-alimentee.test.js`) + 1 test paramétré qui
vérifie que **tout** module du front se parse (`sources-se-parsent.test.js`, un test
par fichier — le nouveau module en ajoute un).

Les tests du lot 3 existants (`vocal-colonne-discussion.test.js`, 34 tests, T1→T8) et
tous les tests `vocal-*` / `ecran-vocal-*` restent **verts sans modification**.

### Les nouveaux tests échouent-ils vraiment sur le code d'avant ?

Vérifié mécaniquement sur la version `HEAD` de `super-agent.js` :

| Vérification | Avant | Après |
|---|---|---|
| la peinture **cherche** `.vocal-side-body` | vrai | faux |
| la peinture **crée** `.vocal-side-body` | **faux** | vrai |
| la réponse est lue dans `.agent-text-section` | **faux** | vrai |
| la lecture passe par `vocalSpeechTurns()` | **faux** | vrai |

- `vocal-colonne-discussion-alimentee.test.js` → **A1** (« le corps est créé, il n'est
  plus seulement cherché ») échoue sur le code d'avant : c'est le test « l'aperçu
  reste vide ».
- `vocal-discussion-turns.test.js` → **F2** (« un message d'outil ne paraît jamais »,
  familles techniques essayées une par une) et **A2** (liste blanche des sections de
  texte) échouent dès qu'un message d'outil ou de réflexion peut s'afficher.
- **A5** verrouille la mise à jour en direct (tic unique, réécriture seulement sur
  changement) et **A4** le défilement vers le message le plus récent.

### L'écran Vocal s'ouvre-t-il encore sans gel ?

Vérifications faites : aucun chemin de sortie touché (`enterVocal` / `exitVocal`
inchangés), aucune horloge ni écouteur ajouté, création de nœud **idempotente**, et
les deux boucles de la lecture sont bornées par la longueur de la liste
(`for (let i = 0; i < noeuds.length; i++)`) — un test le verrouille (« aucune boucle
non bornée »). **Non vérifié en exécution réelle** (pas d'affichage graphique dans cet
environnement) : voir § 8.

## 7. Ce qui n'a pas été touché

Disque, halo, micro et sa garde, les **trois sorties** (logo, Échap, fermeture de
l'onglet), la **zone d'image** en haut à droite, le **bouton de masquage**, les deux
titres, la grille des colonnes (`--vocal-side`), les six hôtes cliquables.
**Aucun réglage nouveau, aucun `localStorage`, aucune couleur en dur** (les tests A6
et le lot 3 le vérifient).

## 8. Ce qui reste incertain

1. **Pas de vérification à l'écran** : l'application n'a pas été lancée ici (pas
   d'affichage). À contrôler à la main : ouvrir un projet, échanger deux ou trois
   messages avec l'Assistant, passer en mode Vocal → la colonne de gauche doit
   montrer les derniers échanges, et le nouveau tour doit apparaître seul (~1 s).
2. **Cas où la colonne reste légitimement vide** : aucune conversation dans la
   session (ou `superMessagesEl` encore `null`, onglet Assistant jamais monté). Rien
   n'est inventé : pas de repli, pas de message d'attente.
3. **Texte de la réponse pris tel quel** : si l'assistant écrit un extrait de code
   dans sa réponse, cet extrait fait partie du texte dit (tronqué à 8 lignes). Ce
   n'est pas un journal, c'est sa phrase ; le filtre ne touche pas au contenu des
   tours de parole.
4. **Latence de 0,9 s** : assumée, pour ne pas créer une seconde source de peinture.

## 9. Documentation

- `spec_modes_ecran_vocal.md` : le paragraphe « Rien n'est déplacé » décrivait une
  lecture de « la bulle » — il dit maintenant ce qui est lu **exactement** (bulle du
  propriétaire moins l'étiquette de projet ; sections de texte de la réponse ; filtre
  `vocalSpeechTurns`), la **création du corps** (cause de la colonne vide) et le
  défilement vers le plus récent.
- `AGENTS.md` : entrée d'arborescence du nouveau module.
- `help/handbook.md` : régénéré (`npm run build:handbook`) — **aucun changement**
  (aucun bloc `<!-- HELP:* -->` touché).
