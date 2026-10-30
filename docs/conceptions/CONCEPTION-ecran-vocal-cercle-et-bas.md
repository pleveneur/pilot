# CONCEPTION — Écran Vocal : le cercle deux fois plus grand, et le bas qui s'efface

> **Nature** : conception UI/UX, applicable telle quelle (valeurs exactes, aucun
> code). **Périmètre** : l'écran Vocal existant (`.pilot-vocal`, lot 2 → lot 4b).
> **Aucun écran redessiné, aucun réglage utilisateur, aucun nouveau nœud
> structurel.** Les décisions déjà tranchées ne sont pas rouvertes : structure de
> l'écran, quatre états, bouton des modes = logo, place du logo, place de la
> ligne d'état, seuils du micro.
> **Référence** : `spec_modes_ecran_vocal.md`, `vocal.md` (coupure de parole).

---

## 0. Les deux décisions, en une ligne chacune

| Demande du propriétaire | Décision retenue | Effet visible |
|---|---|---|
| « Le cercle deux fois plus grand » | Le disque passe de **168 px à 336 px** ; halos compris, l'objet occupe **512 × 512 px** | L'objet lumineux devient la pièce maîtresse de l'écran |
| « Le halo, c'est le cercle, plus les halos » | La couronne lumineuse est **allumée dans les QUATRE états**, repos compris | Il n'y a plus d'état « cercle nu » : l'objet a toujours son halo |
| « Le bas se masque au repos, revient à la souris » | Texte + ligne d'état + micro + boutons du bas s'effacent après **2,5 s** de calme ; reviennent au **premier geste** (souris ≥ 4 px, clic, molette, clavier) | Un écran vraiment nu, qui ne cache jamais ce qui est en train de se passer |

---

## 1. Le cercle et ses halos — 336 px

### 1.1 Les dimensions (les seuls chiffres qui changent)

| Élément | Aujourd'hui | Après | Où c'est |
|---|---|---|---|
| Disque (`.vocal-orb`) | 168 × 168 px, anneau 2 px | **336 × 336 px**, anneau **2 px** | `style.css` `.vocal-orb` |
| Rayon utile (bord intérieur de l'anneau) | 82 px | **166 px** | idem (boîte de padding) |
| Couronne lumineuse (`::before`, `inset`) | −44 px, boîte 256 px | **−88 px, boîte 512 px** | `style.css` `.vocal-orb::before` |
| Rayon total (centre → bord du halo) | 128 px | **256 px** | idem (`closest-side`) |
| Arc de réflexion (`::after`, `inset`) | −6 px | **−12 px** | `style.css` `.vocal-orb::after` |
| Halo d'écoute (`.vocal-halo`, `inset: 0`) | rayon 82 px | **rayon 166 px** | `style.css` `.vocal-halo` |
| Arc de réflexion, masque | 82 % → 84 % | **inchangé 82 % → 84 %** | idem (pourcentages de la boîte, qui double aussi) |
| Respiration du repos (`vocal-breathe`) | 1 → 1,03, 4 s | **inchangé** | `@keyframes vocal-breathe` |

**Tout est × 2, aucun arrêt de dégradé ne bouge.** Les arrêts de la couronne
(0 % / 66 % / 81 % / 90 % / 100 %) sont des **pourcentages de la boîte** : la
boîte doublant, le bord de l'anneau tombe toujours à **66 %** du rayon
(168/256 = 65,6 %). L'écran est deux fois plus grand, **pas deux fois plus
lumineux** : aucune valeur d'alpha ne change, donc les contrastes mesurés et
retenus restent valables (alpha 34 % au bord ⇒ **2,28:1** en thème sombre,
**1,60:1** en thème clair — `RAPPORT-halo-parole.md`).

Le bouton de relance (« Réveiller <Nom> ») suit tout seul : il est en `inset: 0`
dans la boîte du disque, donc son rayon passe de 84 à **166 px** sans une seule
valeur à changer. Seul son rembourrage horizontal passe de **14 px à 24 px**
(le texte respire dans un cercle deux fois plus large ; taille de police
inchangée à 13 px).

### 1.2 Trois jetons, une seule taille

La taille du disque est écrite **une fois**, sur l'overlay, et tout le reste en
découle. Trois jetons nouveaux, aucun autre chiffre dans les règles :

| Jeton (sur `.pilot-vocal`) | Valeur | Ce qu'il donne |
|---|---|---|
| `--vocal-orb-size` | `336px` (voir § 1.5 pour la fenêtre courte) | le disque |
| `--vocal-crown` | `0.2619 × --vocal-orb-size` (88 px à 336) | l'épaisseur de la couronne |
| `--vocal-arc` | `0.1364 × --vocal-crown` (12 px à 336) | le débord de l'arc |

Conséquences à écrire dans les règles (aucune autre valeur modifiée) :
`.vocal-orb { width/height: var(--vocal-orb-size) }`,
`::before { inset: calc(var(--vocal-crown) * -1) }`,
`::after { inset: calc(var(--vocal-arc) * -1) }`.
La constante **82 px** de `vocal-mic.js` (commentaire de `levelToHalo` : « rayon
= halo × 82 px ») devient **166 px** ; les constantes d'enveloppe
(`ENVELOPE_RING_PX` 84 → **168**, `ENVELOPE_MIN_PX` 18 → **36**,
`ENVELOPE_MAX_PX` 44 → **88**, dénominateur 128 → **256**) suivent dans
`vocal-enveloppe-aigu.js` — **la valeur produite (`scale` de 0,7969 à 1) ne
change pas**, c'est un simple changement d'échelle.

### 1.3 Ce qui est toujours allumé, dans les quatre états

C'est le cœur de la consigne « le halo, c'est le cercle, plus les halos ».

| Couche | Repos | Écoute | Réflexion | Parole |
|---|---|---|---|---|
| Anneau 2 px (couleur d'état) | ✅ | ✅ | ✅ | ✅ |
| Remplissage radial 18 % au centre | ✅ | ✅ | ✅ | ✅ |
| **Couronne extérieure (cercle + halo = l'objet)** | ✅ **36 px** | ✅ **36 px** | ✅ **36 px** | ✅ **36 → 88 px** |
| Halo intérieur **vert** (votre voix) | — | ✅ (voir § 1.4) | — | — |
| Arc 60° qui tourne (réflexion) | — | — | ✅ | — |
| Bouton « Réveiller <Nom> » | ✅ | — | ✅ | — |

Règles d'écriture (elles remplacent deux réglages d'aujourd'hui) :

1. **La couronne n'est plus éteinte hors de la parole.** La règle de base
   `.vocal-orb::before` passe de `opacity: 0` à `opacity: 1`, et sa géométrie de
   repos est `transform: scale(0.7969)` — exactement la valeur que le module
   d'enveloppe produit dans le silence (couronne de 36 px au-delà de l'anneau).
   Conséquence : le repos et un silence pendant la parole se ressemblent, ce qui
   est voulu — c'est **le même objet**, seule la couleur dit qui parle.
2. **L'intensité ne sert plus à distinguer les états.** Baisser l'opacité d'un
   état ferait passer la couronne sous le seuil de contraste retenu (34 %). Les
   états se distinguent donc par **la couleur, la géométrie et les peintres
   supplémentaires** (halo vert, arc), jamais par un halo éteint.
3. **Exception unique, conservée telle quelle** : quand le peintre spectral pose
   `.vocal-spectrum-live` (voix locale mesurée, `vocal-enveloppe-aigu.js`), la
   couronne s'éteint — ce peintre **est** le halo de la voix, et la règle « jamais
   deux afficheurs pour la même voix » reste la plus forte. L'objet garde son
   anneau et son remplissage ; il n'est jamais nu.

### 1.4 Les quatre états, tels qu'ils se voient

| État | Couleur de l'anneau | Couronne | Ce qui bouge | Phrase d'état |
|---|---|---|---|---|
| **Repos** | `--vocal-rest` (accent) | 36 px, pleine intensité | respiration lente 4 s de l'objet entier (cercle + halo) | « Je vous écoute. » |
| **Écoute** | `--vocal-listen` (#1f7a4d) | 36 px | **le halo vert intérieur**, au rythme de la voix ; rien d'autre | « Je vous écoute… » |
| **Réflexion** | `--vocal-think` (#6d28d9) | 36 px | l'arc de 60° qui tourne en 3 s | « Je réfléchis… » |
| **Parole** | `--vocal-speak` (#b45309) | **36 → 88 px, pilotée par la voix** | extension + intensité (0,8 → 1) suivant la source disponible | « Pilot parle… » |

Deux précisions d'application :

- **Halo vert, plancher de visibilité** : en écoute, `--vocal-halo` vaut
  `max(0.30, --vocal-heard)` (au lieu de `--vocal-heard` seul) ⇒ rayon plancher
  **0,30 × 166 = 50 px**. Le halo est donc **toujours peint en écoute**, même
  dans le silence entre deux mots. Ce n'est **pas** un seuil de détection : la
  décision « écoute / repos » reste celle de `vocalVoiceStep` (0,06 / 0,03), qui
  n'est pas touchée — on ne change que ce qui est dessiné.
- **Parole, repli sans source** : l'animation `vocal-speak-glow` respire
  désormais **autour de la largeur de repos**, sinon la couronne sauterait de
  36 à 75 px au premier mot. Nouvelles valeurs : `0 %/100 %` → `scale(0.78)`,
  `opacity: 0.8` (inchangé) ; `50 %` → `scale(0.86)`, `opacity: 1` (couronne 32 →
  41 px). Seules les deux valeurs d'échelle changent.
  Avec une source réelle (son ou rythme), rien ne change : `scale` et `alpha`
  viennent de `envelopeFromEnergy` et vont de 0,7969 à 1.

### 1.5 Fenêtre courte : le disque rétrécit, jamais le halo rogné

La boîte de la couronne (512 px) **ne tient pas** dans la hauteur minimale de la
fenêtre (500 px, `tauri.conf.json`) : il faut donc une règle, pas une
constatation. La voici, avec son arithmétique.

Budget vertical non occupé par le disque, **dans le pire cas** :
`36 (marge des boutons) + 44 (barre du haut) + 41 (ligne d'état : 21 + 8 + 12) +
136 (saisie à sa hauteur maximale : 120 + 16) + 32 (rembourrage du bloc) =
**289 px**`.

D'où **un seul jeton**, qui remplace les 336 px fixes :

```
--vocal-orb-size : borné entre 120 px et 336 px, égal à (hauteur de fenêtre − 289) × 21/32
```

(21/32 = 0,65625 : c'est l'inverse de 1,5238, le rapport boîte/disque.)

| Hauteur de fenêtre | Disque | Boîte du halo | Total |
|---|---|---|---|
| 860 px (défaut) | **336 px** | 512 px | 801 ≤ 860 ✅ |
| 801 px et plus | **336 px** | 512 px | ✅ |
| 750 px | 303 px | 462 px | 751 ✅ |
| 620 px | 217 px | 331 px | 620 ✅ |
| 500 px (minimum) | **138 px** | 211 px | 500 ✅ (marge 289 ≥ 120) |

Le disque ne descend **jamais** sous **168 px** tant que la fenêtre fait **545 px de
haut ou plus** (le minimum autorisé est 500) : il n'est plus petit que l'actuel
que dans les 45 derniers pixels de hauteur possible. Le plancher de 120 px n'est
jamais atteint (il faudrait une fenêtre de 472 px de haut, que `minHeight`
interdit) : il n'existe que pour rendre la formule inoffensive.

Le **critère du test existant** (`vocal-halo-128-…` : la boîte du halo tient dans
la hauteur minimale, avec au moins 120 px de marge) **reste vrai**, mais il doit
s'écrire sur la formule évaluée à 500 px (211 ≤ 500, marge 289) et non plus sur
la constante 256.

### 1.6 Réduction de mouvement

Même drapeau qu'aujourd'hui (`vocalReducedMotion` : `prefers-reduced-motion`
**et** `window._pilotModalAnimations`), même classe `vocal-reduced`, **aucun
réglage nouveau**. Ce qui change est la conséquence du halo permanent :

| Élément | Mouvement réduit |
|---|---|
| Couronne au repos / écoute / réflexion | **36 px, fixe, pleine intensité** (aucune animation) |
| Couronne en parole | **88 px, fixe** ⇒ `transform: scale(1)` explicite (à ajouter à la règle `vocal-reduced.vocal-state-speaking`) : sans animation, la **taille** est le seul signe qui reste entre le repos et la parole |
| Arc de réflexion | reste éteint (inchangé) |
| Halo vert en écoute | reste à 0,55 × 166 = **91 px** (inchangé en proportion) |
| Respiration du repos | éteinte (inchangé) |
| Bas de l'écran (§ 2) | apparaît et disparaît **d'un coup** (aucun fondu) |

---

## 2. Le bas de l'écran s'efface au repos

### 2.1 Ce qui s'efface, ce qui reste

**S'efface** (les trois seuls nœuds masqués) :

| Nœud | Contenu |
|---|---|
| `.vocal-status` | l'unique ligne d'état |
| `.vocal-input` | la barre de saisie déplacée : champ, 🎙️, envoyer — **et, au-dessus d'elle, la rangée des questions en attente** (§ 2.7) |
| `.vocal-mic-fix` | le bouton « Autoriser le micro » (déjà masqué sauf panne) |

**Reste toujours** : le disque, la couronne, le halo vert, l'arc, le bouton
« Réveiller <Nom> », la **barre du haut de 44 px**, le **logo `#mode-logo`**
(bouton des trois modes, toujours atteignable), le **bouton « Travail »**
(`#agent-activity`), les boutons système de la fenêtre.

Deux règles fermes :

1. **Le cercle ne bouge pas d'un pixel quand le bas s'efface.** Le masquage est
   une opacité + une translation, **jamais** un `display: none` : la ligne
   d'état et la saisie **gardent leur place** dans la colonne, donc le centrage
   du disque est identique dans les deux situations.
2. **Le périmètre est le bas seulement.** Le propriétaire a demandé que le
   bouton des modes reste atteignable : la barre du haut, le logo et le bouton
   « Travail » ne sont **jamais** concernés.

### 2.2 Le déclencheur exact du retour

Un seul module décide (voir § 2.6), quatre gestes le réveillent :

| Geste | Condition | Effet |
|---|---|---|
| Mouvement de pointeur | déplacement cumulé **≥ 4 px** depuis la dernière position connue | réveille et relance le décompte |
| Appui de pointeur (n'importe où) | — | réveille et relance |
| Molette | — | réveille et relance |
| Touche du clavier | **sauf `Échap`** (qui sort du mode, inchangé) | réveille et relance |

Pourquoi un seuil de 4 px : une main posée sur la souris tremble ; sans seuil,
le bas ne resterait jamais effacé. 4 px est la tolérance d'un geste
**volontaire** (le tremblement d'une main posée reste sous 2 px).

Le **premier clic ne déclenche rien** d'autre que le réveil : quand le bas est
effacé, il ne reçoit aucun clic (aucun contrôle invisible n'est activable). En
pratique, on ne clique jamais sur un bas effacé sans bouger la souris d'abord :
le réveil a donc déjà eu lieu quand le pointeur arrive.

### 2.3 Le remasquage

- **Délai : 2 500 ms** sans aucun des gestes ci-dessus.
- **Le délai repart de zéro** à chaque geste (un seul minuteur, jamais deux).
- **Pendant ces 2,5 s, le bas est visible** — y compris si l'on ne fait rien.
- **Cinq situations interdisent le masquage**, même après 2,5 s (l'ordre de la
  décision est la spec) :

| # | Situation | Pourquoi |
|---|---|---|
| 1 | Un **message du micro fermé** est affiché (`vocalMicFerme` non vide) | une panne doit rester lisible, et son bouton « Autoriser le micro » cliquable |
| 2 | **Le champ contient du texte** (dictée en cours de transcription, brouillon, ou **focus dans le champ**) | on ne cache jamais ce que l'on est en train d'écrire, ni le champ où l'on tape |
| 3 | L'état est **parole**, ou **écoute** *avec un mot réellement transcrit* | consigne du propriétaire : « quand l'écran reprend parole/écoute ». Correctif du 2026-11-03 : ce fait est un fait d'**usage**, pas la mesure du niveau — la mesure est ouverte à l'entrée du mode et jamais refermée, son seuil de sortie (0,03) est sous le plancher de voix du projet (0,05) et le micro demande `autoGainControl` : une pièce silencieuse remplissait la règle 3 en permanence et le bas ne s'effaçait plus **jamais**. La décision pure `vocalEtatQuiRetientLeBas({ etat, dicteeOuverte, motRecu })` (dans `vocal-chrome.js`) rend `parole` toujours, `écoute` seulement si `dicteeOuverte && motRecu`, et `repos` sinon |
| 4 | Le **pointeur est sur la zone du bas** (ligne d'état, saisie ou bouton de dépannage) | on ne fait pas disparaître sous le curseur ce qu'il désigne |
| 5 | **Une question de l'assistant attend une réponse** (§ 2.7) | la rangée de boutons qui la porte vit dans le bas : l'effacer rendrait la question invisible et bloquerait le travail sans un mot |

- **Cas particulier, voulu** : au repos avec la dictée **armée mais silencieuse**
  (le cas normal : on parle sans rien toucher), le champ est **vide** et l'état
  est **repos** ⇒ le bas s'efface. C'est exactement ce que demande le
  propriétaire : la dictée armée n'est pas une dictée *en cours*, et le premier
  mot entendu fait passer l'état en **écoute**, ce qui fait revenir le bas.

### 2.4 Le fondu

| Propriété | Valeur |
|---|---|
| Durée | **180 ms** (`var(--transition)`, ressort du projet) |
| Opacité | 1 → 0 (retour : 0 → 1) |
| Translation | `translateY(0)` → `translateY(8px)` (le bas s'enfonce vers le bas) |
| Visibilité | `visibility: hidden` **à la fin** du fondu (180 ms de retard) ; `visible` **immédiatement** au retour |
| Pointeur | `pointer-events: none` quand c'est effacé |
| Mouvement réduit | aucun fondu, aucune translation : `transition: none`, bascule instantanée |

La translation de 8 px est **une impression de sortie**, pas un déplacement du
cercle : elle ne concerne que les deux blocs du bas.

### 2.5 Clavier, dictée, micro, lecture à voix haute

- **Clavier** : n'importe quelle touche réveille (sauf `Échap`). La frappe dans le
  champ garde le bas visible de deux façons : le geste a réveillé, et le champ a
  le focus. Un utilisateur au clavier ne se retrouve donc jamais devant un écran
  sans zone de saisie : il tape, elle revient.
- **Dictée** : jamais masquée pendant qu'elle produit du texte (règle 2 de
  § 2.3), ni pendant qu'un mot transcrit est arrivé (règle 3). Le texte dicté arrive dans le champ et
  **réveille** le bas au même instant (appel unique depuis le point d'écriture).
- **Micro en panne** : la phrase et le bouton restent affichés en permanence
  (règle 1). C'est le seul cas où le bas ne s'efface **jamais** : l'écran doit
  dire quoi faire.
- **Lecture à voix haute** : le bas est **visible pendant toute la lecture**
  (état « parole »), et se ré-efface **2,5 s après la dernière phrase**. Aucun
  contrôle n'existe dans ce bas (on arrête la lecture en parlant, lot 4a) : le
  masquage ne retire donc **aucune commande** pendant la lecture.
- **Sortie du mode** : les écouteurs et le minuteur sont retirés avec l'overlay ;
  rien ne survit à l'écran.

### 2.6 La décision pure, et son seul point d'application

- **Nouveau module pur** `src/js/vocal-chrome.js` (aucun DOM, aucune minuterie) :
  - `VOCAL_CHROME_IDLE_MS = 2500` — délai de remasquage ;
  - `VOCAL_CHROME_MOVE_PX = 4` — seuil du mouvement de pointeur ;
  - `vocalChromeVisible({ etat, saisie, micFerme, pointeurActif, question })`
    → `true/false`, en appliquant **dans cet ordre** les règles 1 → 5 de § 2.3
    puis le masquage ;
  - `vocalChromeClass(visible)` → `"vocal-chrome-hidden"` ou `""`.
- **Un seul point d'écriture** dans `super-agent.js` : `vocalSyncChrome(state)`,
  appelé **à la fin de `applyVocalState`** (après `vocalSyncRestartButton`) — il
  lit le DOM (texte du champ, `document.activeElement`, `vocalMicFerme`), appelle
  la décision pure et pose ou retire la classe sur `vocalOverlay`. Aucun autre
  endroit n'écrit cette classe.
- **Quatre appels supplémentaires seulement**, tous sans logique :
  1. les écouteurs `pointermove` / `pointerdown` / `wheel` / `keydown`, posés à la
     fin de `enterVocal` et retirés au début de `exitVocal` (ils relancent le
     minuteur puis appellent `vocalSyncChrome`) ;
  2. le point d'écriture du texte dicté (`super-agent.js`, `rec.onresult` →
     `inputEl.value = …` juste avant `resizeInput()`), pour que la transcription
     fasse revenir le bas ;
  3. l'écouteur `input` existant de la zone de saisie (frappe de l'utilisateur) ;
  4. le rappel `pendingQuestionChromeSync` (posé par `createSuperAgent`, appelé
     **à la fin de `renderActivePendingQuestion`**) : la file des questions vient
     de changer, l'écran réapplique sa décision — sans ce rappel, une question
     arrivée pendant que le bas est effacé ne serait jamais peinte. Il ne décide
     rien et ne pose aucun minuteur : il relit les faits.

### 2.7 La question de l'assistant s'affiche ici

**Le défaut corrigé.** Les questions de l'assistant (choix, choix multiple,
confirmation, saisie libre) sont rendues dans la rangée `#pendingBar` de
l'onglet Assistant (file FIFO `pendingQuestions`, `renderActivePendingQuestion`).
Cette rangée était un enfant du **wrapper de l'onglet**, posée juste après la
barre de saisie — donc **derrière** le calque plein écran de l'écran Vocal
(`.pilot-vocal`, `z-index: 99990`, fond opaque). `enterVocal` ne déplaçait que
trois nœuds. En mode Vocal, une question n'était donc peinte **nulle part** :
l'utilisateur ne voyait rien, et le travail restait bloqué jusqu'à l'expiration
de l'attente.

**La correction, en quatre points.**

1. **La rangée est DÉPLACÉE dans `.vocal-input`, juste AU-DESSUS de la ligne de
   saisie.** Même nœud (aucune copie), mêmes boutons, mêmes réponses, même file :
   il n'existe **aucun second affichage** ni second mécanisme de réponse. Le
   placement est **dans le flux** (aucun `position: absolute`) : ni le disque, ni
   la ligne d'état, ni le champ ne sont recouverts. `exitVocal` la restitue à sa
   place d'origine (parent **et** voisin) **avant** le retrait du calque — une
   question encore en attente à la sortie reste donc visible dans l'onglet.
2. **Elle ne s'efface jamais** : règle 5 de § 2.3. Une question humaine n'est pas
   un décor : elle attend un geste.
3. **Une seule question à la fois, sans perte** : la file FIFO existante n'est
   pas touchée — la rangée montre la **tête** de file, la réponse fait avancer la
   file, la suivante prend la place. Aucun minuteur, aucune expiration : rien ne
   s'efface tout seul.
4. **La dictée ne répond pas à ma place** : tant qu'une question attend, la
   dictée automatique de l'écran Vocal est **fermée** (règle 4b de
   `vocal-conversation.js`, et une dictée déjà ouverte est fermée). Sans cette
   garde, une phrase prononcée à côté serait partie comme réponse — et une
   **confirmation**, dont la valeur par défaut est « oui », aurait été validée
   sans un geste. Le geste 🎙️, lui, rouvre la dictée : dicter sa réponse est un
   acte explicite.

**Comment on répond.** Par **clic** sur les boutons de la rangée (choix,
confirmation, valider/annuler). Pour une **saisie libre**, le texte se tape dans
la barre de saisie juste en dessous — le chemin existant de `send()` détourne
l'envoi vers la question tant qu'une question attend. **Il n'y a pas de réponse
vocale directe aux choix** (« oui », « la deux ») : le mécanisme existant ne
l'a jamais prévu, et le deviner reviendrait à répondre à la place de
l'utilisateur. La dictée peut en revanche servir à **dicter** le texte d'une
saisie libre, après un geste.

**Place et taille.** Au repos, sans question, la rangée est vide et ne prend
**aucune place** (aucune marge résiduelle : l'écran est exactement celui du
lot 2). Quand une question s'affiche, sa hauteur est bornée à **140 px** (et
22 vh sur les fenêtres basses) avec défilement interne : les 289 px réservés au
reste de l'écran (§ 1.5) restent tenus, donc la boîte du halo n'est jamais
rognée. Elle ne réclame **aucun hôte cliquable supplémentaire** : elle hérite du
`pointer-events: auto` de `.vocal-input`, déjà l'un des six hôtes du correctif
« aucun calque ne capte les clics ».

**Hors du mode Vocal, rien ne change** : tous les styles ajoutés sont bornés à
`.pilot-vocal`, et le bloc d'origine de la rangée (filet, fond, plafond de
220 px) est intact.

---

## 3. Où ça vit dans le code (fichier + fonction, sans écrire le code)

| Fichier | Fonction / bloc | Ce qui y change |
|---|---|---|
| `src/css/style.css` | `.pilot-vocal` (les trois jetons), `.vocal-orb`, `.vocal-orb::before`, `.vocal-orb::after`, `.vocal-halo`, `.vocal-restart`, `.vocal-status`, `.vocal-input`, `.vocal-mic-fix` | taille 336, couronne toujours allumée, plancher du halo vert, rembourrage du bouton, nouvelle classe `.vocal-chrome-hidden` |
| `src/css/style.css` | `@keyframes vocal-speak-glow`, bloc `.pilot-vocal.vocal-reduced` | repli de parole autour de la taille de repos ; `scale(1)` en parole réduite ; transition coupée pour le bas |
| `src/js/vocal-enveloppe-aigu.js` | `ENVELOPE_RING_PX`, `ENVELOPE_MIN_PX`, `ENVELOPE_MAX_PX`, `envelopeFromEnergy` | 168 / 36 / 88, dénominateur 256 (la valeur produite ne change pas) |
| `src/js/vocal-mic.js` | `levelToHalo` (commentaire et constante d'échelle) | 82 px → **166 px** ; aucune décision de détection touchée |
| `src/js/vocal-restart.js` | — | **aucun changement** (le bouton suit `inset: 0`) |
| `src/js/vocal-chrome.js` | **nouveau** | la décision pure du § 2.6 |
| `src/js/super-agent.js` | `applyVocalState` | + `vocalSyncChrome(state)` en dernière ligne |
| `src/js/super-agent.js` | `enterVocal` / `exitVocal` | pose / retrait des quatre écouteurs et du minuteur |
| `src/js/super-agent.js` | `rec.onresult` (écriture du texte dicté) et l'écouteur `input` de la saisie | + un appel à `vocalSyncChrome()` |
| `help/overview.md` (bloc `HELP:modes-ecran`) | — | les nombres « 44 px / 128 px de rayon » deviennent « 88 px / 256 px » ; deux phrases ajoutées : le halo reste allumé au repos, le bas s'efface au repos et revient au geste. Puis `npm run build:handbook` |
| `spec_modes_ecran_vocal.md` | § 3 (l'écran), § 3bis (bouton de relance : rayon 166), § 4 (états), § 10 (où c'est dans le code) | mise à jour des chiffres et de la règle « halo toujours allumé » + § 2.4 « toujours visible » devient « visible pendant l'action » |

---

## 4. Ce qu'il faut vérifier avant de livrer

### 4.1 Tests existants — ils échoueront si les valeurs changent, et c'est normal

À **mettre à jour** (ils verrouillent les anciens chiffres, le geste est
mécanique : 168 → 336, 44 → 88, 256 → 512, 82 → 166, 128 → 256) :

| Fichier de test | Ce qu'il verrouille aujourd'hui |
|---|---|
| `src/js/ecran-vocal-lot2.test.js` | disque 168 px, structure de l'écran |
| `src/js/ecran-vocal-nu.test.js` | orb 168 px, présence de `.vocal-input`, des trois sorties, de `vocalReducedMotion` |
| `src/js/ecran-vocal-bouton-relance.test.js` | orb 168 px, rayon du bouton = rayon intérieur |
| `src/js/vocal-halo-128-et-etat-au-dessus-saisie.test.js` | `DISQUE_PX = 168`, boîte 256, `inset: -44px`, **et l'invariant « la boîte tient dans `minHeight` avec 120 px de marge »** → à réécrire sur la formule de § 1.5 évaluée à 500 px |
| `src/js/vocal-halo-parole.test.js` | alpha du bord 0,34, arrêt à 66 %, `opacity: 0` de base, absence de `box-shadow` |
| `src/js/vocal-enveloppe-aigu.test.js` | `ENVELOPE_*` = 84 / 18 / 44 **et** les images de `vocal-speak-glow` (`scale` 0,94 / 1,06 → 0,78 / 0,86 ; les deux `opacity` 0,8 et 1 sont conservées) |
| `src/js/vocal-enveloppe-rythme.test.js` | les mêmes valeurs, lues par le mètre de rythme |
| `spec_modes_ecran_vocal.md` + `help/overview.md` (lecture du texte) | les nombres en clair (44 px, 128 px) |

À **ne pas toucher** (aucune raison de les modifier, ils doivent passer tels
quels) : `src/js/ecran-vocal-lot3.test.js`, `ecran-vocal-lot4a.test.js`,
`vocal-couper-la-reflexion.test.js`, `vocal-parler-declenche-une-demande.test.js`,
`vocal-reprise-ecoute-auto.test.js`, `vocal-restart.test.js`,
`bouton-travail-ecran-vocal.test.js`, `trois-modes-ecran.test.js`,
`vocal-reponses-courtes.test.js` — **le micro, les seuils, la conversation
parlée et les modes ne sont pas concernés**.

### 4.2 Tests à créer

- `src/js/vocal-chrome-masque.test.js` — décision pure : les quatre règles dans
  l'ordre, le masquage autorisé au repos **avec la dictée armée mais silencieuse**,
  jamais de masquage en écoute / parole / micro fermé / champ rempli ; un seul
  minuteur ; seuil de 4 px ; `Échap` n'est pas un réveil ; 2 500 ms.
- Étendre `ecran-vocal-nu.test.js` : la classe `.vocal-chrome-hidden` ne
  s'applique **qu'aux trois nœuds du bas** (jamais au disque, au bouton de
  relance, au logo, au bouton « Travail »), et le masquage **ne change pas la
  mise en page** (aucun `display: none` sur `.vocal-status` / `.vocal-input`).

### 4.3 Cas limites d'affichage à regarder à l'œil

| Cas | Attendu |
|---|---|
| Fenêtre 860 × 1280 (défaut) | disque 336, couronne 512 centrée, aucun contact avec la ligne d'état ni la saisie |
| Fenêtre 800 × 500 (minimum) | disque 138, couronne 211, tout tient, rien n'est rogné |
| Fenêtre 1600 × 500 (très large et basse) | même chose : seule la hauteur compte |
| Saisie à sa hauteur maximale (120 px) **et** micro en panne | le rembourrage du bas grandit de 64 px : la couronne peut approcher la ligne d'état de ~16 px en haut et le bouton de ~16 px en bas — **jamais les recouvrir** (la ligne d'état n'a aucun fond, le bouton est sous la couronne) ; le cercle n'est jamais rogné |
| Thème clair | couronne à 34 % : 1,60:1 au bord, comme aujourd'hui (aucun alpha modifié) |
| `prefers-reduced-motion` | tout est fixe : couronne 36 px (88 px en parole), pas de fondu du bas, arc éteint |
| Dictée armée, silence, souris immobile | le bas s'efface après 2,5 s ; le premier mot le fait revenir (état écoute) |
| Transcription en cours, souris immobile | le bas **reste** (champ non vide) |
| Lecture à voix haute, souris immobile | le bas **reste** pendant toute la lecture |
| Micro refusé | le bas **reste** en permanence (phrase + bouton) |
| Redimensionnement pendant que le bas est effacé | le disque suit la hauteur, le bas reste effacé (aucun réveil intempestif) |
| Souris débranchée / absente | le bas s'efface ; le clavier le réveille |
| Sortie du mode (logo, `Échap`, fermeture de l'onglet) | aucun écouteur ni minuteur ne survit ; la saisie retrouve sa place et sa visibilité |

### 4.4 Commandes

```
npm test                 # Vitest — front
cargo test --workspace   # Rust (aucun fichier Rust touché, à titre de garde)
npm run build:handbook   # après la mise à jour du bloc HELP:modes-ecran
```

---

## 5. Le seul point que je n'ai pas tranché seul (une question fermée)

**Au repos, faut-il aussi allumer le halo vert à l'intérieur du cercle ?**

L'application décrite ci-dessus allume **la couronne extérieure** dans les quatre
états (c'est elle, « le halo du cercle »), et réserve le **vert intérieur** à
l'écoute — parce que « une lueur, une voix » (décision 5) et parce qu'un vert
allumé au repos ferait croire que Pilot écoute alors qu'il ne capte rien.

Si le propriétaire répond **oui**, la variante est d'une seule ligne : dans la
règle du repos, `--vocal-halo` passe de 0 à **0,20** (rayon 33 px), teinte
`--vocal-state` et non `--vocal-listen`, afin que la couleur dise toujours
l'état. **Aucune autre valeur ne change.** Tant que la réponse n'est pas
donnée, l'agent d'interface applique la version par défaut (vert réservé à
l'écoute).

---

## VERDICT

**Faisable tel quel, sans nouvelle décision** — les deux ajustements demandés
tiennent dans l'écran Vocal existant, sans nœud nouveau, sans réglage nouveau, et
sans toucher au micro, aux seuils, aux quatre états ni au bouton des modes.

Ce qui a été tranché et qui n'était pas donné :

1. **La tension réelle du « deux fois plus grand »** : une couronne de 88 px
   autour d'un disque de 336 px fait 512 px, soit **plus que la hauteur minimale
   de la fenêtre (500 px)**. Résolu par **une seule formule** sur la hauteur de
   fenêtre (§ 1.5) : 336 px dès 801 px de haut (le défaut en fait 860), et un
   disque qui rétrécit proportionnellement en dessous, jusqu'à 138 px à 500 px —
   **le halo n'est jamais rogné, et le critère du test existant reste vrai**.
2. **Le halo devient un état, pas un effet** : la couronne est allumée dans les
   quatre états, à intensité constante (les contrastes mesurés restent valables),
   et les états se distinguent par la couleur, la géométrie et les peintres
   supplémentaires. Le repli de parole respire désormais autour de la largeur de
   repos, sinon la couronne sauterait au premier mot.
3. **Le masquage du bas est décidé par quatre règles ordonnées**, dont une seule
   surprend : la **dictée armée mais silencieuse ne retient pas le bas** — c'est
   le cas normal de cet écran, et le premier mot le fait revenir. Une panne de
   micro, une transcription en cours et une lecture à voix haute, elles, ne
   laissent jamais le bas s'effacer.
4. **Le cercle ne bouge pas** quand le bas s'efface (opacité + translation, place
   conservée) : la promesse « le cercle est le centre de l'écran » ne dépend pas
   de la présence du texte.

**Deux réserves honnêtes** : les huit tests qui verrouillent les anciens chiffres
doivent être mis à jour dans le même lot (sinon la CI casse, et c'est le signal
attendu) ; et le halo vert au repos reste une question fermée (§ 5) dont la
réponse ne coûte qu'une valeur.
