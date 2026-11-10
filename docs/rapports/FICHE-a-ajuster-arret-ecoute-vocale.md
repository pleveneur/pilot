# Fiche à ajuster — arrêter l'écoute du mode Vocal sur demande parlée

Date : 10-11-2026
Projet concerné : Pilot, écran Vocal.
Destinataire : agent développeur du projet Pilot (fiche transmise telle quelle, hors du projet).
Aucune modification n'a été faite dans le projet : ce document ne contient que des constats et des attentes.

> ## AJUSTEMENTS DU 16-11-2026 — DÉCISIONS DU PROPRIÉTAIRE (elles priment sur le corps de la fiche)
>
> Le corps ci-dessous est conservé tel qu'il a été reçu (trace du constat initial).
> Quatre de ses demandes ont été **tranchées autrement** après diagnostic :
>
> 1. **Point 2 de la § 3 — CORRIGÉ.** « Micro fermé et dictée désarmée » était une
>    hypothèse fausse sur la veille existante : la veille **ne ferme pas le micro**.
>    Le micro reste ouvert et armé sur le nom ; c'est la **garde du nom** qui jette
>    toute phrase (`decideVocalNameGate`, `ecouteLibre: false`), et l'**écran** qui
>    cesse de se présenter comme à l'écoute. Désarmer la dictée rendrait le réveil par
>    le nom impossible — donc le point 6 de la même § 3 serait violé.
> 2. **Point 4 de la § 3 — ABANDONNÉ.** La phrase **est** transmise comme une demande :
>    c'est l'**outil `stop_listening`** de l'assistant qui produit l'état d'arrêt
>    (demande du propriétaire : « ce doit être un outil que l'assistant peut appeler »).
>    Les points 1 et 2 de la § 5 (« aucune demande envoyée ») tombent donc avec lui.
> 3. **Point 4 de la § 4 — INVERSÉ.** « Ne pas laisser le micro ouvert après coup » est
>    remplacé par : **le micro reste ouvert**, sans quoi le nom ne réveillerait plus rien.
> 4. **Point 1 de la § 3 — PRÉCISÉ.** L'effet doit être **exactement** celui de la veille
>    de 20 s : **un seul état**, une seule fonction (`vocalEnterVeille`), jamais un second
>    comportement pour l'ordre parlé.
>
> Les points 1, 3, 5, 6, 7 et 8 de la § 3 restent valables et sont tenus par
> `src/js/arret-ecoute-vocale.test.js` (25 cas). Les points 1 à 3 de la § 5 sont
> remplacés par les preuves du rapport (`docs/rapports/RAPPORT-arret-ecoute-vocale.md`) :
> écoute coupée, affichage qui n'est plus « je vous écoute », outil exposé, réveil par le
> nom préservé, et phrase avec « écoute » dans un autre sens qui ne coupe rien.

## 1. Ce que le propriétaire demande

Le propriétaire veut pouvoir **arrêter l'écoute à la voix**, en parlant à l'assistant.
Il désigne comme référence la mise en veille automatique qui coupe déjà l'écoute après une vingtaine de secondes de silence : il veut le même résultat, mais déclenché par une phrase.

Point important, dit en ses mots : « ce n'est pas un bouton ». Ce n'est pas une commande à l'écran, c'est une **phrase prononcée** que l'assistant doit reconnaître et traiter lui-même.

## 2. Comportement observé aujourd'hui

- Prononcer « arrête d'écouter » ne coupe rien.
- L'écoute continue : la dictée se rouvre et l'écran reste actif, comme si la phrase n'avait rien déclenché.
- Constat fait en test réel, sur la version de développement, à l'oral par le propriétaire.
- **Ce constat est un constat d'usage, pas un diagnostic.** Il doit être confirmé par la lecture du code avant toute correction : la cause exacte n'est pas établie (phrase non reconnue, reconnue mais non traitée, ou traitée sans effet).

## 3. Comportement attendu (règles testables)

1. Une phrase d'arrêt prononcée coupe l'écoute du mode Vocal. Exemples de formulations visées : « arrête d'écouter », « ne m'écoute plus », « tais-toi ».
2. L'effet obtenu est celui de la veille déjà existante ~~: micro fermé et dictée désarmée~~ → **corrigé le 16-11-2026 : micro TOUJOURS OUVERT, armé sur le nom ; « désarmée » = plus aucune phrase ordinaire n'écrit ni n'envoie rien (garde du nom) et l'écran ne dit plus qu'il écoute**. L'état final doit être le même que celui atteint par l'arrêt après silence.
3. Aucune lecture à voix haute ne doit être déclenchée par cette phrase.
4. ~~Cette phrase ne doit pas être envoyée comme demande à l'assistant.~~ → **ABANDONNÉ le 16-11-2026 : la phrase EST transmise comme une demande, et c'est l'outil `stop_listening` de l'assistant qui produit l'état d'arrêt.**
5. La reconnaissance doit tolérer les variantes d'oreille (transcription approximative). Une formulation unique, exigée au mot près, n'est pas acceptable. → **appliqué : trois écarts absorbés (frontières de mots, finale du verbe `-er/-ez/-es`, politesse finale « s'il te plaît » / « s'il vous plaît » / « stp » / « svp » / « merci »). Aucun mot supplémentaire n'est toléré au-delà.**
6. Le réveil par le nom (ou par le mot de réveil réglé) doit rester possible ensuite, comme après une veille ordinaire.
7. Aucun nouveau réglage, aucune nouvelle case à cocher.
8. La saisie au clavier n'est pas filtrée : ces règles ne concernent que l'écoute micro.

## 4. Risques à ne pas créer

- Ne pas casser la veille automatique existante (arrêt après silence).
- Ne pas casser l'envoi automatique en fin de dictée.
- Ne pas couper l'écoute sur une phrase qui contient seulement le mot « écoute » dans un autre sens (par exemple « écoute, j'ai une idée »).
- Ne pas laisser le micro ouvert après coup. → **inversé le 16-11-2026 : le micro RESTE OUVERT (c'est la condition du réveil par le nom) ; ce qui est interdit, c'est de laisser l'écran se présenter comme à l'écoute.**

## 5. Vérifications exigées avant de conclure

- Les tests du mode Vocal déjà existants doivent passer.
- Il faut un test qui prouve qu'une phrase d'arrêt **ferme bien l'écoute**. → **remplacé le 16-11-2026 par : la phrase d'arrêt ne laisse plus rien produire à la dictée, et l'affichage n'est plus « je vous écoute »** (le micro, lui, reste ouvert — c'est voulu).
- Il faut un test qui prouve qu'**aucune demande n'est envoyée** à l'assistant quand cette phrase est prononcée. → **remplacé le 16-11-2026 (point 4 abandonné) par : l'outil `stop_listening` existe, il est exposé à l'interception de l'assistant, et il produit l'état d'arrêt ; la réponse à cet ordre n'est jamais lue à voix haute.**
- Sans ces deux preuves, la correction n'est pas considérée comme livrée.

## 6. Ce qu'il ne faut pas faire

- Pas de refonte de l'écran Vocal.
- Pas de nouveau réglage utilisateur.
- Pas de modification de la garde du nom (mot de réveil) au-delà de ce qui est strictement nécessaire.
- Ne pas livrer sans les tests ci-dessus.

## 7. Périmètre de cette fiche

Cette fiche ne couvre que l'arrêt de l'écoute à la demande. La barre de saisie qui doit s'effacer au repos est un autre chantier, déjà en cours.

## 8. Points restés non établis

- La cause technique du comportement observé : non établie à ce stade (à confirmer par lecture du code). → **établie le 16-11-2026 : deux causes, l'affichage (la ligne d'état rendait toujours la phrase de l'écoute, l'état de veille était court-circuité) et la parole (la phrase d'arrêt mettait la veille puis était jetée par la garde du nom, sans qu'aucun outil ne reçoive l'ordre).**
- La liste exacte des formulations à reconnaître : non arrêtée (les exemples de la règle 1 sont des cas d'usage, pas une liste fermée). → **arrêtée : 20 formulations dans `VOCAL_STOP_FORMULAS` (une seule déclaration), dont « ne m'écoute plus », « arrêtez d'écouter », « n'écoute plus », « cesse d'écouter », « taisez-vous », « mets-toi en veille ». Une phrase qui n'y figure pas reste possible : elle part comme demande et l'assistant appelle l'outil.**
- Le délai maximal acceptable entre la phrase prononcée et la coupure effective : non établi. → **il n'y a plus de délai pour l'état (la veille est posée dès la reconnaissance de la formule) ; la réponse de l'assistant arrive au tour normal.**
- Le comportement attendu quand la phrase est prononcée pendant que l'assistant parle : non établi. → **tranché : la phrase est reçue comme n'importe quelle parole (elle interrompt la lecture, § 6quater de `spec_modes_ecran_vocal.md`), puis l'outil pose la veille ; l'ordre n'est jamais lu à voix haute.**
