# Mode Vocal — la coupure de la parole (barge-in) est intermittente

Document de travail à remettre à l'agent de développement de Pilot.
Rédigé par Magnus (assistant de suivi, lecture seule) le 01-10, à partir de cas réels observés en usage.

---

## 1. Le problème, en une phrase

En mode Vocal, quand Pilot lit une réponse à voix haute, parler par-dessus devrait couper la lecture.
**Parfois ça coupe très bien. Parfois rien ne coupe, quoi qu'on dise.** Le seul secours est alors de cliquer le bouton d'envoi avec une zone de saisie vide.

## 2. Ce qui a été observé (matériel et réglages identiques)

Machine : ordinateur portable, **haut-parleurs internes**, pas de casque. Aucun réglage modifié entre les essais. Même session, même voix, même micro.

| # | Situation | Résultat |
|---|---|---|
| 1 | Test délibéré, voix par-dessus la lecture | OK : coupure nette, Pilot se remet à écouter |
| 2 | Quelques minutes plus tard, même config | ECHEC : aucune coupure, lecture menée jusqu'au bout |
| 3 | Nouvel essai, même config | ECHEC : aucune coupure |
| 4 | Utilisateur parle **longtemps, plusieurs mots, fort** | ECHEC : toujours aucune coupure |
| 5 | Nouvel essai après un échec, sans rien changer | OK : coupure |

Conclusion factuelle : **ce n'est ni le matériel, ni un réglage, ni la durée ou le volume de la voix.** La différence se joue entre deux lectures, pas entre deux utilisations.

## 3. Mécanisme actuel (tel qu'il est écrit aujourd'hui)

Dans le moteur micro du mode Vocal :

- la décision de couper est prise **une fois par lecture**, au tout début : pendant les **600 premières millisecondes** de la lecture, on mesure le **résidu d'écho** (la voix de Pilot qui revient par le micro) ;
- pendant cette mesure, la détection de parole est neutralisée ;
- au bout de la mesure, la garde est **ARMÉE** ou **DÉSARMÉE** pour toute la lecture :
  - écho jugé maîtrisé et le navigateur **prouve** l'annulation d'écho → armée, seuil `max(0,05 ; résidu × 1,8)` ;
  - résidu supérieur à `0,03` avec annulation prouvée, ou supérieur à `0,01` quand le navigateur ne prouve rien → **désarmée** ;
  - navigateur qui ne prouve pas l'annulation d'écho → traité comme douteux ;
- une fois désarmée, **plus rien ne coupe** : ni un mot, ni une phrase longue, ni un volume élevé ;
- quand elle est armée, il faut encore **200 ms de voix continue** pour déclencher, et une seule coupure est accordée par lecture (pas de reprise automatique).

## 4. Hypothèse retenue (à vérifier dans le code, pas à croire sur parole)

La lecture est courte et Pilot parle fort dans ses propres haut-parleurs. Le résidu mesuré pendant les 600 ms est donc **à la limite du seuil**. Selon l'instant (niveau du son, réverbération de la pièce, syllabe en cours, état de la voix), la mesure passe juste au-dessus ou juste en dessous :

- mesure sous le seuil → garde armée → **tout marche** ;
- mesure au-dessus → garde désarmée → **rien ne marche pendant toute la lecture**.

Et si l'utilisateur parle **pendant** ces 600 ms, sa propre voix est comptée comme de l'écho : la mesure est polluée, la garde se désarme, et là encore toute la lecture est perdue.

C'est ce qui explique le motif « ça marche quand je teste juste après, ça ne marche pas quand je parle tout de suite ».

**Corollaire important** : la durée et le volume de la voix de l'utilisateur ne doivent **jamais** être utilisés comme critère principal. Le cas 4 le prouve : parler longtemps ne sauve rien.

## 5. Ce qu'il faut corriger (objectif, pas prescription)

Objectif : **une voix franche et continue doit toujours pouvoir couper la lecture**, même quand l'écho est douteux.

Pistes, du plus simple au plus lourd :

1. **Ne jamais désarmer complètement.** Quand l'écho est douteux, garder une garde de secours avec un seuil élevé et une exigence de durée plus longue (voix forte et continue). Le faux positif (Pilot se coupe sur son propre son) doit rester rare ; le faux négatif (impossible de couper) doit devenir impossible.
2. **Séparer la mesure de la décision.** Aujourd'hui une seule mesure, au mauvais moment (juste après le début de la lecture, quand le son démarre), décide de tout. Une mesure prise **avant** la lecture, ou une décision **révisable en cours de lecture** (ré-évaluation si la voix persiste), serait plus juste.
3. **Ne pas mesurer l'écho sur les 600 ms qui suivent immédiatement le début** : c'est le moment où le haut-parleur attaque et où l'utilisateur réagit. Décaler la fenêtre de mesure après l'attaque du son.
4. **Garantie de secours, indépendante de l'écho** : une voix continue au-delà d'une durée franche (par exemple plusieurs secondes) coupe, quel que soit l'état de la garde. C'est le filet qui rend le cas « impossible à couper » définitivement impossible.

Contrainte de conception : **aucun nouveau réglage utilisateur**. Le comportement doit être juste par défaut.

## 6. Ce qu'il ne faut pas faire

- Ne pas ajouter d'option ni de curseur dans les Paramètres.
- Ne pas toucher au lecteur audio ni au module micro pour « contourner » : la décision doit rester dans la même logique, testable.
- Ne pas supprimer la protection anti-écho : elle protège d'un vrai défaut (Pilot se coupe sur sa propre voix).
- Ne pas se contenter d'abaisser un seuil sans test : le risque est de casser le cas qui marche aujourd'hui.
- Ne pas modifier le comportement de la coupure pendant la **réflexion** (quand Pilot travaille) : elle fonctionne, elle emprunte un autre chemin.

## 7. Livrable attendu de l'agent de développement

1. La correction du mécanisme, avec la garantie du point 5.4 (une voix continue finit toujours par couper).
2. Les tests existants du mode Vocal **restent verts**, et un **nouveau test** couvre le cas « écho douteux / garde désarmée → la voix coupe quand même ».
3. La mise à jour de la spécification du mode Vocal : la règle « quand l'écho n'est pas maîtrisé, la lecture va jusqu'au bout » doit être remplacée par la nouvelle règle.
4. Le compte-rendu doit dire clairement, en langage simple : ce qui a changé pour l'utilisateur, et ce qui reste impossible (s'il reste un cas).

## 8. Comment vérifier sur la machine, après correction

1. Lancer une lecture à voix haute assez longue (plusieurs phrases).
2. Parler par-dessus **immédiatement** au début → doit couper.
3. Refaire l'essai en parlant **au milieu** → doit couper.
4. Refaire l'essai en laissant Pilot finir sans parler → la lecture doit aller au bout **sans se couper toute seule** (pas de faux positif).
5. Refaire la séquence 10 fois de suite : le résultat doit être **le même à chaque fois**.
