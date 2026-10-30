# Remarques d'interface — écran Vocal (Pilot)

Remarques relevées le 03-10-2026 pendant un test en direct de l'écran Vocal, à transformer en ajustements.

Ce document est une liste de remarques d'interface à transmettre à l'agent de développement : il ne contient que des constats et des attentes, aucun correctif n'est appliqué ici.

## 1. Colonne des messages de discussion (à gauche)

La colonne des messages de discussion, à gauche, est trop proche du cercle central.

Attendu : décaler cette colonne plus vers la gauche, et décaler aussi la liste des tâches vers la droite, pour dégager plus d'espace autour du cercle.

## 2. Colonne de discussion — distinction des deux voix

Dans la colonne de discussion, le texte prononcé par Patrick doit être aligné à droite ; et surtout, les deux voix (Patrick et Nova) ne se distinguent pas assez à la lecture.

Attendu : un moyen agréable et lisible de les différencier (alignement, côté, teinte, style de bulle, petit repère visuel) sans alourdir l'écran.

## 3. Barre de saisie (en bas de l'écran Vocal)

La barre de saisie doit être invisible par défaut, apparaître quand la souris bouge, rester utilisable tant qu'on s'en sert, puis disparaître de nouveau après un temps d'inactivité de la souris.

À noter pour la suite : un mécanisme de masquage de ce type existe déjà dans le code (masquage au repos après environ 2,5 s, réveil au mouvement). Le comportement observé ne correspond donc pas à l'attendu : la remarque porte sur le déclenchement à revoir, pas sur la création d'un mécanisme.

## 4. Portrait et prénom (en haut à droite)

Le portrait est trop petit et donne l'impression d'appartenir à la liste des tâches.

Attendu : un portrait plus grand et nettement détaché, visiblement au-dessus de la liste des tâches.

## 5. La barre du bas ne s'efface plus (régression constatée en version de développement)

Depuis les modifications récentes, en version de développement, la barre de saisie du bas ne s'efface plus du tout : elle reste visible en permanence, même quand la souris ne bouge pas et qu'on ne s'en sert pas.

Attendu : retrouver le comportement décrit au point 3 (invisible au repos, apparaît au mouvement, se remasque seule après un temps d'inactivité). Comme c'est une régression, il faut d'abord comprendre ce qui a cessé de fonctionner, puis corriger — et non rajouter un second mécanisme.

## 6. Le portrait paraît décentré quand tout le reste est masqué

Quand tout le reste de l'écran est masqué, le portrait du personnage paraît décentré : sa place ne donne pas une impression d'équilibre, on ne sait pas s'il est trop haut, trop bas ou mal aligné par rapport au reste.

Attendu : une place satisfaisante pour le portrait dans cette situation où il est presque seul à l'écran.

## 7. Décision de mise en page : le cercle remonte, la photo passe en dessous

Décision retenue pour la mise en page : remonter le cercle (l'objet lumineux au centre) et placer la photo du personnage en dessous.

À noter : cette décision répond aux points 4 et 6, qui n'ont donc pas à être traités séparément.

## 8. Le panneau de la liste des tâches manque de transparence

Le panneau de la liste des tâches paraît peu transparent : on a l'impression qu'il manque quelque chose, il ne se fond pas dans l'écran.

Attendu : baisser son opacité, et reprendre pour ses cadres et son texte la couleur bleue qui entoure la zone de saisie du bas, en version transparente.

## Ordre de traitement suggéré

Traiter d'abord le point 5 (la régression du masquage de la barre du bas : c'est un défaut, pas une amélioration, et il rend le point 3 inopérant), puis la mise en page décidée au point 7 (cercle remonté, photo en dessous, ce qui règle aussi les points 4 et 6), puis les finitions visuelles : points 1, 2 et 8.
