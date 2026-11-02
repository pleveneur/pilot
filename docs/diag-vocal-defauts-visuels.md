# Mode Vocal — deux défauts visuels constatés à l'oral

Note de constat rédigée le **28 octobre 2026**.
Ce document décrit ce qui a été **observé à l'écran**, pas ce qui en est la cause.
Il ne demande aucun correctif pour l'instant : il sert à garder une trace fidèle
des deux défauts, pour pouvoir les traiter plus tard.

## Comment ce constat a été fait

Test réel à l'oral, sur un ordinateur portable, avec les **haut-parleurs
internes** et **sans casque**. Instance de développement de Pilot. Aucun
réglage changé pendant le test.

Une chose a été vérifiée comme **fonctionnelle** pendant ce même test : quand
l'utilisateur parle par-dessus l'assistant, la lecture s'arrête bien. Ce point
n'est donc **pas** le sujet de ce document (il est traité à part).

Les deux points ci-dessous sont des **constats d'observation visuelle**. Ils ne
sont pas encore des diagnostics.

---

## Défaut 1 — En état « parole », le halo autour du cercle n'est pas visible

**Ce que l'utilisateur observe**
Quand Pilot parle (il lit une réponse à voix haute), le cercle central ne
montre aucune enveloppe lumineuse autour de lui. À l'œil, rien ne distingue
franchement l'état « parole » d'un état de veille : on voit le cercle, sa
couleur, et c'est tout. L'impression qui reste est « je ne vois pas que tu es
en train de parler ».

**Ce qu'il attendait**
Pendant que Pilot parle, une lumière douce autour du cercle, qui respire au
rythme de la voix — une indication visuelle claire de « je suis en train de
parler », visible sans avoir à lire la ligne de texte.

**Où en sont les quatre états de l'écran Vocal**
- **Repos** : le cercle est posé, il respire lentement. Cet état se voit.
- **Écoute** : la couleur change, et la petite barre sous le cercle suit la voix
  (voir défaut 2 pour ce qui ne convient pas).
- **Réflexion** : un arc tourne autour du cercle. Cet état se voit nettement.
- **Parole** : la couleur change, la barre sous le cercle ondule, mais **le halo
  attendu autour du cercle ne se voit pas**. C'est le défaut.

Autrement dit : trois des quatre états ont un signe visuel net, et l'état
« parole » — celui qui devrait être le plus vivant — est celui qui en manque.

---

## Défaut 2 — En état « écoute », l'animation intérieure du cercle n'est ni jolie ni parlante

**Ce que l'utilisateur observe**
Quand l'utilisateur parle, il ne perçoit qu'un **changement de couleur** du
cercle. Il n'y a pas, à l'intérieur du cercle, de mouvement qui rende compte de
sa voix : rien qui s'ouvre quand il parle fort, rien qui retombe quand il se
tait. Le rendu ne donne pas la sensation d'être écouté « en direct ». La seule
chose qui bouge un peu est la petite barre située **sous** le cercle, et elle
n'est pas jugée convaincante non plus.

Le jugement de l'utilisateur est esthétique autant que fonctionnel : ce n'est
pas joli, et surtout ce n'est pas parlant.

**Ce qu'il attendait**
Un mouvement à l'intérieur du cercle qui suive réellement la voix de
l'utilisateur — quelque chose qui réagisse à ce qu'il dit, assez vivant et assez
lisible pour qu'on comprenne d'un coup d'œil « il m'entend, et voilà ce qu'il
entend ».

**Où en sont les quatre états de l'écran Vocal**
- **Repos** : cercle immobile qui respire lentement.
- **Écoute** : la couleur d'état s'applique bien, mais **l'intérieur du cercle
  ne s'anime pas avec la voix**. C'est le défaut.
- **Réflexion** : un arc tourne autour du cercle (mouvement, mais qui ne dit rien
  de la voix — c'est normal, ce n'est pas l'état d'écoute).
- **Parole** : la couleur change et la barre sous le cercle ondule.

Autrement dit : le seul retour visuel vraiment « habitée » manque là où il
compte le plus, pendant que l'utilisateur parle.

---

## Pistes à vérifier (questions ouvertes, aucune cause affirmée)

Ces questions sont posées pour la personne qui fera le diagnostic. Aucune
réponse n'est apportée ici.

1. Le halo prévu pour l'état « parole » existe-t-il bien dans le style de
   l'écran, mais reste-t-il **invisible en pratique** ?
2. S'il existe, est-il trop discret (transparence, teinte trop proche du fond,
   taille trop juste autour du cercle) pour être perçu sur un écran de portable ?
3. Le halo serait-il désactivé par un réglage existant (par exemple la
   réduction des animations), sans que l'utilisateur s'en rende compte ?
4. L'état « parole » est-il réellement atteint à l'écran pendant la lecture,
   c'est-à-dire la couleur du cercle change-t-elle bien au moment où Pilot
   commence à parler ?
5. L'animation intérieure du cercle suit-elle **le niveau réel du micro**, ou
   seulement l'état « écoute » (autrement dit : réagit-elle vraiment à la voix,
   où fait-elle toujours la même chose) ?
6. Le niveau mesuré est-il bien utilisé à l'intérieur du cercle, ou seulement
   pour la petite barre située en dessous ?
7. Le niveau mesuré varie-t-il assez (amplitude) pour que le mouvement soit
   lisible, ou reste-t-il dans une plage si étroite que l'écart ne se voit pas ?
8. Le rendu actuel a-t-il été pensé pour un casque plutôt que pour des
   haut-parleurs internes (réverbération, son de Pilot qui revient) ?

---

## Ce qui n'est pas demandé ici

**Aucun correctif n'est à appliquer pour l'instant.** Ce document est une note
de constat : il fixe noir sur blanc deux défauts visuels, pour qu'ils puissent
être traités proprement plus tard, avec un diagnostic et des tests.

Restent donc explicitement **hors** de cette demande :

- modifier l'apparence ou le comportement de l'écran Vocal ;
- changer des couleurs, des durées d'animation ou des seuils ;
- toucher au micro ou à la lecture à voix haute ;
- ajouter un réglage utilisateur ;
- revoir la coupure de la parole (vérifiée comme fonctionnelle, traitée
  séparément).
