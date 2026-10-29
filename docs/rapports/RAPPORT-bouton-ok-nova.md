# Rapport — le bouton de relance de l'écoute (« ok Nova ») sur l'écran Vocal

> Fiche du propriétaire, appliquée telle quelle (décisions **401** et **402** du
> suivi du 2026-10-29) :
>
> 1. un bouton **rond**, de la même forme que le cercle, posé **à l'intérieur du
>    haut** du cercle ;
> 2. **le contour du cercle lui sert de bord** : pas d'anneau propre, pas de
>    débordement, il doit paraître faire partie de l'objet lumineux ;
> 3. **visible quand la dictée ne tourne pas**, **disparaît pendant l'écoute**,
>    **réapparaît dès que le micro est coupé** ;
> 4. un clic **relance l'écoute** et la boucle normale de conversation ;
> 5. discret, **jamais devant le halo**, aucun décalage de mise en page ;
> 6. **pas un doublon** du bouton 🎙️ de la barre de saisie : les deux commandent
>    la même chose, celui du cercle est le **geste principal** en mode Vocal.

Un point de contexte qui a décidé de la forme : le nom affiché est celui du
**personnage actif** (`nom.txt` du projet Présences, sinon le nom réglé, sinon
« Assistant »). « ok Nova » est donc une **étiquette**, pas une constante : elle
suit le personnage, sans qu'aucun nom soit écrit en dur.

---

## 1. Ce qui a été fait, en deux lignes

Un module **pur** décide (`src/js/vocal-restart.js` : se voit-il ? que dit-il ?),
`super-agent.js` applique au seul endroit qui connaît l'état (`applyVocalState`)
et branche le clic sur la fonction **déjà** utilisée par le bouton 🎙️, et le CSS
donne au bouton sa place **dans** le disque (position absolue, 56 px, `top: 3px`).

---

## 2. Fichiers touchés

| Fichier | Ce qui change |
|---|---|
| `src/js/vocal-restart.js` | **Nouveau.** Décisions pures : `vocalRestartVisible`, `vocalRestartLabel`, `VOCAL_RESTART_TITLE`. Aucun DOM, aucun micro, aucune horloge, aucune écriture. |
| `src/js/super-agent.js` | Le bouton entre dans `buildVocalOverlay` (enfant du disque, après le halo, masqué au départ) ; son clic est branché dans `enterVocal` sur `toggleVoiceInput` ; `vocalSyncRestartButton(state)` est appelé à la fin de `applyVocalState` ; `applyAssistantPersonaUi` met l'étiquette à jour quand le personnage change. |
| `src/css/style.css` | Nouveau bloc `.vocal-restart` (+ `:hover`, `:focus-visible`, `.hidden`, mouvement réduit). Aucune règle existante modifiée. |
| `src/js/vocal-restart.test.js` | **Nouveau.** 21 tests purs (décisions, étiquettes, pureté du module). |
| `src/js/ecran-vocal-bouton-relance.test.js` | **Nouveau.** 20 tests de branchement, d'ordre, de géométrie **calculée** et de non-recouvrement. |
| `src/js/ecran-vocal-lot2.test.js` | Deux points : l'ordre imposé des nœuds accueille `vocal-restart` (entre `vocal-halo` et `vocal-mic-fix`), et la garde « le halo est **enfant direct** du disque » ne peut plus exiger qu'il soit la **première** chose après le `<div>` (le disque a désormais deux enfants) — elle lit le bloc du disque et y exige le halo. |
| `src/js/ecran-vocal-nu.test.js` | Une ligne : la liste des nœuds de l'écran nu nomme `vocal-restart`. |
| `src/js/vocal-halo-128-et-etat-au-dessus-saisie.test.js` | Une ligne : même ordre de nœuds, même ajout. |
| `src/js/vocal-parler-declenche-une-demande.test.js` | Une assertion reformulée (voir §7.3) : ce qui peut suivre `vocalSyncConversation()` est désormais **nommé**. |
| `spec_modes_ecran_vocal.md` | Nouvelle section §3bis (le bouton, sa place, son état, ce qu'il ne fait pas). |
| `help/overview.md` | Deux puces dans la section « Trois modes d'écran » (bloc `HELP:modes-ecran`) → handbook régénéré. |

Aucune ligne du réarmement automatique de la dictée (`armVoiceInput`,
`vocalApplyConversationPlan`, `dbf0c35`) ni du module micro (`vocal-mic.js`)
n'est touchée.

---

## 3. Décisions tranchées (et écrites ici parce qu'elles engagent la suite)

### 3.1 Le bouton est **dans** le disque, en absolu — pas à côté

`.vocal-orb` est le disque (168 px, anneau de 2 px). Le bouton est un **enfant**
du disque, en `position: absolute`, `top: 3px`, centré par `left: 0; right: 0;
margin: 0 auto` — **pas de `transform`** (rien à neutraliser en mouvement
réduit, aucune translation à animer un jour).

Géométrie, **vérifiée par un test et non affirmée** (le test lit les chiffres
dans le CSS, il ne les recopie pas) :

- `.vocal-orb` n'a pas de `box-sizing` particulier (aucune remise à zéro globale
  dans `style.css`) : sa boîte de padding fait 168 × 168 px, donc **84 px de
  rayon utile** et un centre à 84 px du haut ;
- le bouton fait **56 px** et commence à **3 px** : son centre est à 31 px du
  haut, soit **53 px au-dessus du centre** du disque ;
- son point le plus éloigné du centre est à **53 + 28 = 81 px** ⇒ **3 px à
  l'intérieur** du rayon utile.

Conclusion : il tient **entièrement** dans le disque, et cela **ne dépend
d'aucune taille de fenêtre** (le disque est fixe à 168 px, le bouton l'est
aussi). Aucun `overflow` n'est ajouté au disque : il découperait aussi
l'enveloppe de parole de Pilot (256 × 256, `inset: -44px`) — interdit.

### 3.2 La visibilité suit l'état **réel**, à un seul endroit

`applyVocalState` est le point unique où l'écran applique son état. Le module pur
reçoit **trois faits réels** et l'état visuel déjà calculé :

| Fait réel | D'où il vient | Ce qu'il empêche |
|---|---|---|
| `dicteeOuverte` | `voiceActive` | le bouton pendant l'écoute |
| `armementProgramme` | `vocalArmTimer` | un clignotement de 350 ms à chaque silence |
| `transcription` | `voiceSupported` | un bouton mort sur un poste sans dictée |

et l'état visuel doit être **`idle`** (repos) : pendant que Pilot **parle** ou
**travaille**, la dictée est fermée **par construction** (désarmement voulu), un
bouton y promettrait une reprise que l'écran refuserait aussitôt — et il se
poserait sur le halo, qui ne s'allume qu'en écoute.

Table des états, telle que les tests la verrouillent :

| État de l'écran | Dictée | Bouton |
|---|---|---|
| repos, dictee fermée, micro de mesure ouvert | non | **visible** |
| armement programmé (350 ms après une fin de session) | non encore | absent |
| écoute (micro ouvert, voix entendue) | oui | **absent** |
| Pilot parle / Pilot pense | non (désarmé) | absent |
| après une panne (mesure fermée, erreur, sessions vides, arrêt manuel) | non | **visible** |
| poste sans transcription | impossible | absent |

Aucun drapeau local n'existe : rien ne peut diverger de l'état réel.

### 3.3 Le clic emprunte la voie **existante** : `toggleVoiceInput`

C'est la fonction branchée sur le bouton 🎙️ de la barre de saisie. Elle est
appelée **directement**, sans argument et sans intermédiaire. Deux conséquences
voulues :

- le geste du bouton du cercle a **exactement** les effets du geste 🎙️ (levée
  des verrous `arretManuel` / `sessions-vides` / `erreur`, demande du micro de
  mesure, démarrage, puis la boucle normale de conversation) ;
- il n'existe **pas** de seconde voie de démarrage : `startVoiceInput` n'est
  définie qu'une fois dans tout le module, et le bouton ne l'appelle jamais
  lui-même (verrouillé par test).

`armVoiceInput` — qui est la voie du **réarmement automatique** — n'est
volontairement **pas** utilisée : elle refuse d'agir quand une erreur est en
cours, ce qui rendrait le bouton inopérant précisément dans le cas où
l'utilisateur en a besoin (après une panne).

### 3.4 L'étiquette suit le personnage, et reste dans le rond

`vocalRestartLabel(nom)` reçoit le nom de `superAgentDisplayLabel()` (personnage
actif → nom réglé → « Assistant ») et rend **« ok » + le premier mot**, borné à
10 caractères avec « … » au-delà. Le module **n'invente ni ne retient aucun
nom** ; l'étiquette est réécrite à chaque application d'état et à chaque mise à
jour du personnage (`applyAssistantPersonaUi`), donc changer de personnage ne
demande aucun redémarrage.

### 3.5 Le disque n'est plus `aria-hidden`

Il l'était quand il ne contenait qu'un décor. Il contient maintenant un **vrai
bouton** : un sous-arbre `aria-hidden` contenant un contrôle focusable est un
piège classique (atteignable au clavier, muet pour un lecteur d'écran).
`aria-hidden` est donc retiré du disque ; le bouton, lui, est nommé
(`aria-label` + `title` = « Lancer l'écoute ») et prend le focus visible du
projet (`--accent` + `--ring`, motif de `#tree-filter:focus`).

---

## 4. Ce qui a été écarté, et pourquoi

| Écarté | Raison |
|---|---|
| Poser le bouton dans `.vocal-top` (la barre de 44 px) | Il ne ferait pas « partie de l'objet lumineux » (règle 2) et il serait loin du cercle. |
| Le poser **hors** du disque, juste au-dessus | Débordement explicite : la fiche dit « à l'intérieur du haut du cercle ». |
| Lui donner sa propre bordure / son anneau | Règle 2 : **le contour du cercle lui sert de bord**. |
| `overflow: hidden` sur `.vocal-orb` pour « garantir » le rond | Découperait l'enveloppe de parole (256 × 256, `inset: -44px`) et l'arc de réflexion. Interdit par la conception existante. |
| Une animation de pulsation / un halo qui respire | Mouvement inutile sur un écran nu, et un réglage de plus. Aucune animation n'est ajoutée. |
| `transform: translateX(-50%)` pour centrer | Introduit un `transform` à neutraliser en mouvement réduit. `left/right: 0` + `margin: 0 auto` donne le même résultat sans rien à couper. |
| Masquer le bouton par une **classe d'état CSS** (`.vocal-state-idle .vocal-restart`) | Ce serait une **seconde** règle de visibilité à côté de `vocalRestartVisible` : deux sources de vérité qui finissent par diverger. La visibilité est posée par le code, une seule fois. |
| Réutiliser le bouton « Autoriser le micro » (`.vocal-mic-fix`) | Il traite la **panne du micro de mesure**, pas la reprise de la dictée ; les fusionner rendrait les deux messages faux. Il reste, sous le cercle, indépendant. |
| Afficher le bouton pendant la parole / la réflexion | La dictée y est fermée par construction : le bouton mentirait, et il se poserait sur le halo (règle 5). |
| Recalculer un niveau sonore pour placer le bouton | Aucun calcul de niveau n'est fait ici : les valeurs viennent de `vocal-mic.js`, et le bouton ne les utilise pas. |
| Une seconde voie de démarrage dédiée au geste | Interdit explicite du propriétaire (règle 4). |
| Le mot « Nova » écrit en dur | Le nom vient du personnage actif ; « ok Nova » n'est que l'étiquette par défaut quand le personnage s'appelle Nova. |

---

## 5. Preuve que le bouton suit l'état réel (et non une intention)

1. **Source unique** : la visibilité n'est calculée que dans
   `vocalSyncRestartButton`, appelée une seule fois, à la fin de
   `applyVocalState`. Aucune autre fonction ne pose ou ne retire `.hidden`.
2. **Aucun état gardé** : le module `vocal-restart.js` n'a ni variable, ni
   horloge, ni DOM (verrouillé par des tests qui lisent son **code**,
   commentaires retirés). Deux appels identiques rendent la même réponse.
3. **L'ordre est protégé** : l'appel est placé **après** `vocalSyncConversation`,
   donc l'armement vient d'être programmé quand le bouton décide — c'est ce qui
   supprime le clignotement de 350 ms. Un test lit les chiffres du CSS : si
   quelqu'un déplace le bouton ou change la taille du disque sans l'autre, il
   tombe avec le calcul en clair.

---

## 6. Contrôles exécutés

- `npx vitest run src/js/vocal-restart.test.js src/js/ecran-vocal-bouton-relance.test.js`
  → **41 tests, 0 échec**.
- Suite **complète** : **4245 tests, 4245 réussis, 0 échec, 0 fichier en échec**
  (`npm test`) — rapport JSON du lancement :
  `docs/rapports/vitest-bouton-ok-nova.json` (fichier neuf).
- `npm run build` (Vite) : **construction réussie**, aucune erreur — c'est le
  contrôle qui prouve que `super-agent.js` est réellement **analysable**, pas
  seulement lisible.
- Aucun test Rust n'est concerné : aucun fichier Rust n'a changé.

---

## 7. Points de méthode

### 7.1 Le protocole quality-gate a été suivi

Phase 1 (lecture complète de `super-agent.js` pour la partie vocale, de
`style.css` pour le bloc Vocal, des tests vocaux existants) **avant** toute
retouche, avec la liste de l'existant à préserver : ordre des nœuds de
`buildVocalOverlay`, `.vocal-orb` 168 px sans `overflow`, `.vocal-halo` (une
seule teinte, `--vocal-listen`), `.vocal-status` hors du bloc du disque,
`.vocal-mic-fix.hidden`, règles `vocal-reduced`, réarmement automatique
`dbf0c35`, module micro `vocal-mic.js`. Phase 2 : retouches ciblées, aucun
identifiant ni aucune classe existants renommés.

### 7.2 Compatibilité des trois plateformes

Aucune API nouvelle : un `<button>`, du CSS (`color-mix` est déjà utilisé 137
fois dans ce fichier) et deux fonctions pures. Rien de spécifique à un système.

### 7.3 Un test existant a été reformulé (et il faut le dire)

`vocal-parler-declenche-une-demande.test.js` exigeait que
`vocalSyncConversation();` soit la **dernière instruction** de
`applyVocalState`. Le bouton doit décider **après** l'armement pour ne pas
clignoter ; l'assertion est donc devenue « après `vocalSyncConversation();`, il
n'y a **que** `vocalSyncRestartButton(state);` » — formulation plus précise (elle
**nomme** ce qui a le droit de suivre) et aussi stricte (tout autre ajout fait
tomber le test). Le commentaire du test dit pourquoi.

### 7.4 Deux défauts trouvés en recomptant la suite (et corrigés)

1. **Le balisage ne se compilait pas.** Un commentaire HTML ajouté dans
   `buildVocalOverlay` citait `applyVocalState` et `aria-hidden` **entre
   accents graves**, à l'intérieur d'un **gabarit de chaîne** : le fichier
   devenait invalide (`Expected ';', '}' or <eof>`), et 37 fichiers de tests qui
   importent ce module ne se chargeaient plus. Les citations sont passées entre
   apostrophes. C'est `node --check` puis `npm run build` qui l'ont montré — pas
   les tests qui lisent le source **comme du texte**, lesquels étaient verts.
   Leçon retenue : **un test qui lit le source ne prouve pas qu'il compile.**
2. **Un découpage de source non protégé** avait été introduit (une assertion de
   `vocal-parler-declenche-une-demande.test.js`) : l'inventaire de
   `source-slice.test.js` — qui gèle le nombre de `.slice(indexOf(...))` par
   fichier — l'a refusé, à juste titre. Réécrit avec `split`.

### 7.5 Ce que ce rapport ne prouve pas

- **Le rendu réel à l'écran** (position exacte à l'œil, lisibilité du « ok Nova »
  à 10 px sur le disque) : c'est une mesure visuelle, elle se fait en lançant
  Pilot. La géométrie, elle, est calculée et testée.
- **La dictée elle-même** (qualité de la transcription) : rien n'y change.
