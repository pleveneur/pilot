# Registre des comportements validés

> **À quoi sert ce fichier.** Plusieurs comportements ont été validés par le
> propriétaire, puis sont revenus en arrière plus tard, souvent sans que
> personne ne s'en aperçoive. Ce registre nomme **une ligne par comportement
> attendu**, et donne pour chacun **le test de comportement qui le protège
> réellement**. Une ligne sans test n'est pas une ligne : c'est une intention.
>
> Le registre est un **document de référence**, pas un réglage : rien dans
> l'application ne le lit à l'exécution. Il est lu par
> `src/js/registre-comportements-valides.test.js`, qui tourne avec
> `npm test` (donc dans le contrôle de publication) : **on ne peut plus
> déclarer un lot terminé en contournant le registre**.

## Comment lire une ligne

| Colonne | Ce qu'elle contient |
|---|---|
| **N°** | Le numéro de l'entrée. Il ne se réutilise jamais, et la suite reste sans trou (1, 2, 3…). |
| **Comportement attendu** | Une phrase en français simple : ce que l'utilisateur constate quand tout va bien. |
| **Test qui le protège** | Le fichier de test, puis `::`, puis le **titre exact** du test (celui du `it("…")`). |

## Comment ajouter une ligne

1. Vérifier **d'abord** qu'un test de comportement existe déjà et échouerait
   sur le code d'avant le correctif. Un test qu'on ne peut pas mettre en
   échec ne verrouille rien : il ne s'inscrit pas.
2. Écrire la ligne dans le tableau ci-dessous, avec le titre **copié au
   caractère près** depuis le fichier de test.
3. Lancer `npx vitest run src/js/registre-comportements-valides.test.js`.
   Le garde-fou refuse un titre introuvable, un test sauté, un test sans
   assertion, un doublon et un numéro manquant.
4. Un test peut se déclarer lui-même entrée du registre par un en-tête
   `REGISTRE DES COMPORTEMENTS VALIDÉS — ENTRÉE N° n` : le garde-fou exige
   alors que le registre porte **ce numéro, avec ce fichier**. Aucun fichier
   ne peut donc entrer au registre en silence, ni en sortir.

## Le registre

| N° | Comportement attendu | Test qui le protège |
|---:|---|---|
| 1 | Pendant que l'Assistant travaille, la barre de saisie respire toujours : ralentie quand Windows demande moins d'animations, jamais arrêtée. | `src/js/barre-de-saisie-respire-toujours.test.js` :: en mouvement réduit, aucune règle `animation: none` ne s'applique plus à la barre : une respiration ralentie l'emporte |
| 2 | Les huit autres indicateurs d'activité restent, eux, figés quand Windows demande moins d'animations. | `src/js/barre-de-saisie-respire-toujours.test.js` :: les huit autres indicateurs d'activité gardent, eux, `animation: none` (réglage respecté) |
| 3 | L'ordre d'arrêt d'écoute met l'écran exactement dans l'état de la veille de 20 s : un seul état, jamais un second comportement. | `src/js/arret-ecoute-vocale.test.js` :: (a) l'état affiché de la veille n'est plus l'écoute — et c'est le MÊME pour les deux entrées |
| 4 | L'arrêt d'écoute est un outil que l'assistant peut appeler, déclaré une seule fois, sans état inventé. | `src/js/arret-ecoute-vocale.test.js` :: (c) l'extension déclare l'outil, une seule fois, et n'invente aucun état |
| 5 | L'arrêt d'écoute ne ferme pas le micro : l'oreille reste armée pour entendre le nom. | `src/js/arret-ecoute-vocale.test.js` :: (b bis) le micro n'est PAS fermé : l'oreille reste armée pour entendre le nom |
| 6 | L'ordre d'arrêt n'est jamais lu à voix haute, et il n'existe pas de second lecteur. | `src/js/arret-ecoute-vocale.test.js` :: (c quater) l'ordre n'est JAMAIS lu à voix haute, et il n'y a pas de second lecteur |
| 7 | Après l'arrêt d'écoute, prononcer le nom (ou un mot de réveil) réveille encore. | `src/js/arret-ecoute-vocale.test.js` :: (d) le nom (ou un mot de réveil) traverse la garde armée |
| 8 | Au bout de 20 s de silence, la veille s'arme et une phrase sans le nom est jetée. | `src/js/veille-mot-de-reveil.test.js` :: (b) au bout de 20 s de silence, la garde s'arme |
| 9 | Les 20 s de veille sont une seule constante, recopiée nulle part. | `src/js/veille-mot-de-reveil.test.js` :: les 20 s sont UNE constante, et ils ne sont recopiés nulle part |
| 10 | Pendant que l'assistant travaille, le compte de veille est suspendu : 20 s écoulées n'arment pas la veille. | `src/js/vocal-veille-pendant-le-tour.test.js` :: (a) pendant que l'assistant TRAVAILLE, 20 s ecoulees n'arment PAS la veille |
| 11 | Pendant que Pilot lit sa réponse, le compte de veille est suspendu de la même façon. | `src/js/vocal-veille-pendant-le-tour.test.js` :: (b) pendant que l'assistant LIT sa reponse, idem |
| 12 | Le micro du mode Vocal reste ouvert tant que l'écran le tient, et se rouvre seul après une perte passagère. | `src/js/micro-reste-ouvert-mode-vocal.test.js` :: piste terminee par le SYSTEME -> reouverture automatique, sans geste |
| 13 | Un refus du micro n'est jamais redemandé : aucune boucle de permission. | `src/js/micro-reste-ouvert-mode-vocal.test.js` :: un REFUS n'est JAMAIS redemande (aucune boucle de permission) |
| 14 | Le micro n'est arrêté qu'à la sortie du mode : un seul site d'arrêt dans tout l'écran. | `src/js/micro-reste-ouvert-mode-vocal.test.js` :: `vocalMic.fermer()` n'apparait QU'UNE fois dans tout l'ecran |
| 15 | L'exemple des mots de réveil affiché dans les Paramètres est exact : chaque entrée est un seul mot, et chacune ouvre vraiment la phrase. | `src/js/mots-de-reveil.test.js` :: le champ texte est dans la section « Mode Vocal », avec son aide |
| 16 | L'écran Vocal a trois sorties, et la première est le logo, posé à la même place que dans l'autre plein écran. | `src/js/ecran-vocal-lot2.test.js` :: 1. le meme bouton de mode : le logo se pose a la meme place que dans l'autre plein ecran |
| 17 | La deuxième sortie est Échap, qui cède la touche à une modale ouverte. | `src/js/ecran-vocal-lot2.test.js` :: 2. Echap : un ecouteur dedie, qui cede la touche a une modale ouverte |
| 18 | La troisième sortie est la fermeture de l'onglet, qui arrête la lecture et sort du mode. | `src/js/ecran-vocal-lot2.test.js` :: 3. la fermeture de l'onglet arrete la lecture et sort du Vocal |
| 19 | L'écran Vocal n'a qu'un seul bouton de masquage, posé par un seul appel. | `src/js/ecran-vocal-bouton-affichage.test.js` :: il est pose dans la barre, par le seul appel de `buildVocalOverlay` |
| 20 | Ce bouton de masquage n'existe pas dans « Assistant seul » ni ailleurs : aucun second bouton. | `src/js/ecran-vocal-bouton-affichage.test.js` :: il n'existe pas dans « Assistant seul » ni ailleurs |
| 21 | Une fin d'écoute venue d'une session de dictée REMPLACÉE ne remet plus l'écran au repos : elle ne peut donc plus en ouvrir une troisième. | `src/js/fin-de-session-perimee-ne-rearme-pas.test.js` :: la garde d'identité refuse tout jeton qui n'est pas celui de la session courante |
| 22 | Un réarmement ne rouvre aucune oreille tant qu'une dictée est ouverte : une seule oreille à la fois. | `src/js/fin-de-session-perimee-ne-rearme-pas.test.js` :: le réarmement ne rouvre RIEN tant qu'une dictée est ouverte |
| 23 | La session précédente est fermée par son propre arrêt AVANT l'ouverture de la suivante, et le texte déjà reconnu n'est pas jeté. | `src/js/fin-de-session-perimee-ne-rearme-pas.test.js` :: le texte déjà reconnu de la session close proprement n'est pas jeté |
| 24 | La cascade du diagnostic (fin étrangère, réarmement, session refermée par le pont, texte perdu) ne peut plus partir. | `src/js/fin-de-session-perimee-ne-rearme-pas.test.js` :: la cascade du diagnostic ne peut plus partir : ni réarmement, ni texte jeté |
| 25 | Pendant que vous parlez, l'écoute ne se referme plus : le son de la voix repousse l'échéance, même quand la transcription n'a rien rendu depuis un moment. | `src/js/fin-ecoute-repoussee-par-la-voix.test.js` :: une voix continue repousse l'echeance : l'ecoute ne se referme pas pendant la parole |
| 26 | Un bruit de fond permanent ne tient pas l'écoute ouverte : au plafond de 15 s après le dernier mot transcrit, la demande part quand même. | `src/js/fin-ecoute-repoussee-par-la-voix.test.js` :: le son ne repousse pas indefiniment : le plafond referme, mesure depuis le dernier mot |
| 27 | Sans voix captée, rien ne change : l'échéance tombe au délai réglé (deux secondes par défaut) et la demande part. | `src/js/fin-ecoute-repoussee-par-la-voix.test.js` :: sans voix, l'echeance tombe au delai regle — le comportement d'avant est intact |
| 28 | Le message Telegram de l'assistant nomme le projet dont il est QUESTION, jamais celui qui est simplement ouvert à l'écran (le projet ouvert ne sert que par défaut, « Assistant » si rien n'est identifiable). | `src/js/etiquette-telegram-projet-reel.test.js` :: VERROU : MakeFilm ouvert, travail réel sur Pilot → « pilot », jamais « MakeFilm » |
| 29 | Pendant la veille, l'écran le dit : la ligne qui demande le nom reste visible et le cercle prend l'aspect de l'attente. | `src/js/ecran-vocal-veille-affichee.test.js` :: l'exception ne rend visible que la ligne d'etat, et le dit en clair |

## Ce que le garde-fou vérifie

`src/js/registre-comportements-valides.test.js` échoue si :

- une ligne du tableau n'a pas de test associé, ou cite un fichier absent ;
- le titre cité n'existe plus dans le fichier (test renommé, déplacé, supprimé) ;
- le test cité est sauté (`it.skip`), sans assertion, ou n'est pas un test ;
- deux lignes portent le même numéro ou le même couple fichier + titre ;
- une entrée numérotée présente dans un fichier de test n'est pas dans le registre
  (le registre ne peut pas être contourné) ;
- le registre tombe sous 6 entrées, ou une ligne est vide ou annoncée « à faire » ;
- `AGENTS.md` ne cite plus ce fichier (le registre ne peut pas disparaître en silence).

## Ce que ce registre ne fait pas

Il ne remplace pas la suite complète : il **nomme** ce qui est déjà protégé
ailleurs. Il ne prouve pas qu'un test est bon — il prouve qu'il existe, qu'il
tourne et qu'il porte bien le comportement annoncé. Les comportements validés
qui n'ont encore **aucun** test sont listés dans
`docs/rapports/RAPPORT-registre-comportements-valides.md`, avec la proposition
de verrou correspondante : on ne les inscrit ici qu'une fois le test écrit.
