# Rapport — la coupure de la lecture en mode Vocal ne peut plus être impossible

> Correctif du défaut décrit dans `vocal.md` (coupure **intermittente** : « parfois
> ça coupe, parfois rien ne coupe, quoi qu'on dise ») et du diagnostic
> `RAPPORT-diagnostic-coupure-vocale-perdue.md` (le refus ne peut venir que de la
> garde du micro).
>
> Un seul fichier de décision modifié : `src/js/vocal-mic.js`. Aucun écran, aucune
> phrase d'interface, aucun réglage, aucune seconde capture micro, aucun second
> lecteur audio, aucun seuil existant touché.

---

## 1. Ce qui change pour vous, en une phrase

**Une voix franche et continue finit désormais toujours par faire taire Pilot** ;
si l'écho de ses propres haut-parleurs est douteux, il faut simplement parler **un
peu plus longtemps** (une seconde d'affilée), et **jamais** Pilot ne se coupe sur
son propre son à cause de ce changement.

## 2. Les deux causes du défaut, et ce qui les ferme

| Cause | Preuve dans le code | Correction |
|---|---|---|
| **1. La preuve d'annulation d'écho était lue UNE seule fois, à l'ouverture du micro.** Une valeur `false` interdisait la coupure pour **toute la session**, sans erreur, sans trace — d'où l'intermittence entre deux lectures. | `echoAnnule` était écrit une seule fois, dans `demander()` ; `bargeInArmed()` renvoie `false` inconditionnellement dès que l'écho n'est pas prouvé | **`setSpeaking()` relit la preuve à chaque début de lecture** (`echoAnnule = echoCancellationOf(flux)`), sur la piste **déjà ouverte**, même appel `getSettings()`. Aucun seuil changé. |
| **2. Garde désarmée = plus rien ne coupait.** Résidu d'écho au-dessus de `BARGE_IN_RESIDUAL_MAX`, ou preuve absente ⇒ seuils habituels interdits, et **aucune** autre voie : une voix forte et longue ne coupait pas davantage. | branche `!arme` de `stepSpeechGate` : `declenche: false` sans condition de voix | **GARANTIE DE SECOURS** dans cette même branche (§3) : un seuil **relevé** et une exigence de **durée beaucoup plus longue**. |

## 3. La garantie de secours : le critère retenu

```
seuil de secours = max(0,05 ; résidu mesuré × 2)      // fallbackThreshold()
durée exigée     = 1000 ms de voix continue au-dessus // BARGE_IN_FALLBACK_MS
```

- **Le résidu est gelé en fin de calibrage** (`refSecours`, rempli pendant les 600
  premières ms de la lecture). C'est le seul moment où le son entendu est celui de
  Pilot : l'utilisateur n'a pas encore pu réagir.
- **Pourquoi ce critère ne déclenche pas sur le son de Pilot** : le niveau de
  référence est *son propre son*. Un son ne franchit pas son propre double. Une
  voix **superposée** ajoute au son de Pilot : c'est une **élévation nette**, et
  c'est elle seule qui est retenue.
- **Pourquoi une seconde** : un claquement, une toux, un bruit de chaise ne
  tiennent pas une seconde au-dessus du double du son de Pilot. Une phrase, oui.
- **Le secours est plus prudent que la voie normale** qui fonctionne déjà : marge
  **2×** au lieu de 1,8× , durée **1000 ms** au lieu de 200 ms.
- **Une seule coupure par lecture**, comme avant (`declenche`), aucune reprise
  automatique ; la coupure de la **réflexion** est inchangée (200 ms, aucun
  calibrage).

### Sur quelle preuve

`src/js/ecran-vocal-lot4a.test.js`, section **5** (7 tests) :

| Test | Ce qu'il prouve |
|---|---|
| écho douteux (preuve déclarée absente) + voix franche continue | la lecture est **coupée**, à `BARGE_IN_FALLBACK_MS` et pas avant ; **une seule fois** |
| contre-épreuve : son de Pilot **seul**, mêmes conditions | **aucune** coupure en **30 s**, ni à 0,06 ni à 0,4 |
| hausse modérée du son de Pilot (< au double) | aucune coupure |
| **limite dite** : saut instantané > au double tenu 1 s | coupe (c'est le prix, §4) |
| `fallbackThreshold` | plancher respecté, jamais sous le double, marge plus large que la voie normale |
| preuve d'écho **relue** à chaque lecture | même voix, même niveau : interdite de couper quand le périphérique déclare ne pas annuler l'écho, **coupée en 200 ms** dès qu'il déclare l'annuler — la seule variable est la relecture |
| aucune seconde capture | un seul `getUserMedia` dans le module, aucun `AudioContext` dans `setSpeaking` |

Le test de l'échec d'origine (« écho douteux + voix continue ») **échouait** avant
le correctif : la voix ne coupait jamais.

## 4. Le risque de fausse coupure, chiffré — et la variante écartée

**Ce qui peut encore couper Pilot sur son propre son** : un passage qui **bondit
d'un coup à plus du double** du niveau du début de la lecture **et s'y tient une
seconde entière sans le moindre creux**. Les deux constantes qui bornent ce risque
sont `BARGE_IN_FALLBACK_FACTOR` (2) et `BARGE_IN_FALLBACK_MS` (1000) : monter
l'une ou l'autre rend le risque plus rare mais rallonge la voix nécessaire.

**Pourquoi ce risque est jugé acceptable** : la voie normale déjà en service
(marge 1,8×, 200 ms) est **plus** susceptible de partir, et elle ne produit pas de
fausse coupure chez vous (le défaut observé est l'inverse : aucun arrêt). Le
secours, plus prudent sur les deux axes, se situe donc **sous** ce risque.

**Variante écartée** (essayée, puis retirée) : apprendre la référence **pendant**
la lecture, en prenant le maximum des moments « calmes ». Mesuré en test : cette
référence **rattrape la voix** pendant son attaque (le niveau monte en trois
images) et **aucune voix ne coupe plus jamais** — exactement le défaut à corriger.
C'est le choix structurant : la référence doit être **gelée** à un moment où seul
le son de Pilot est présent.

**Variante « moins mauvaise » si la fausse coupure apparaissait chez vous** : lever
`BARGE_IN_FALLBACK_FACTOR` à 2,5 ou 3 (une ligne, un test à ajuster). On y perd la
coupure par une voix à peine plus forte que les haut-parleurs — cas déjà hors de
portée (§5, cas 2).

## 5. Ce qui reste impossible (dit franchement)

Pilot n'a **qu'une entrée micro** : il ne peut pas séparer votre voix du son de
Pilot autrement qu'en comparant des niveaux. Deux cas restent donc hors de portée,
et ils sont écrits dans la spec (`spec_modes_ecran_vocal.md`, §7) :

1. **Vous parlez pendant les 600 ms qui suivent le début de la phrase** : votre
   voix entre dans la mesure, devient une partie de la référence, et cette
   lecture-là n'est pas coupée. La lecture suivante repart d'une mesure propre.
   (C'est le cas n° 2 de `vocal.md` — « je parle tout de suite ».)
2. **Vos haut-parleurs sont si forts que votre voix ne dépasse pas le double du
   son qu'ils envoient au micro** : aucun seuil ne peut la distinguer. Remèdes :
   baisser le volume, rapprocher le micro, casque.

Aucun réglage n'a été ajouté : le comportement est celui par défaut.

## 6. Recette manuelle (à faire au vrai micro)

1. Lancez une lecture longue (plusieurs phrases) en mode Vocal.
2. Parlez **immédiatement** au début → doit couper. Si non : c'est le cas 1 du §5,
   parlez après le tout début de la phrase.
3. Parlez **au milieu** → doit couper.
4. Parlez **une seconde d'affilée**, sans vous arrêter → doit couper, même si
   l'écho est douteux (motif `voix-secours` dans la console).
5. **Laissez Pilot finir sans parler** → la lecture va au bout, **sans se couper
   toute seule** (c'est la contre-épreuve, la plus importante).
6. Refaites la séquence **dix fois** → même résultat à chaque fois (c'est
   précisément ce qui échouait : le résultat changeait entre deux lectures).
7. Console (`Ctrl+Shift+I`) : chaque coupure écrit une ligne
   `[vocal] prise de parole : residu=… seuil=… motif=… pendant=lecture`.
   `motif=voix-detectee` = voie normale (200 ms) ; `motif=voix-secours` =
   garantie de secours (1000 ms). `motif=echo-non-annule` ou `residuel-eleve`
   n'apparaît **jamais** dans cette ligne : ce sont les motifs de la garde, pas
   d'une coupure.
8. Aucune coupure alors que vous parlez ? Relevez les chiffres :
   `vocalMic.bargeInReport()` donne `echoCancellation`, `residuel`, `refSecours`,
   `seuil`, `seuilSecours`, `arme`, `motif`.

## 7. Vérifications lancées

```bash
npx vitest run src/js/ecran-vocal src/js/vocal- src/js/read-aloud.test.js src/js/voix-
npm test
npm run build:handbook
```

## 8. Ce que ce rapport ne prouve pas

- **Le niveau d'écho réel de votre pièce** : il décide de la durée nécessaire
  (200 ms en voie normale, 1000 ms en secours) et du cas 2 du §5. Les tests
  utilisent des images audio simulées ; seule la recette du §6 le mesure chez vous.
- **La valeur lue par `getSettings()` sur votre machine** : si elle vaut `false`
  en permanence, tout passe par le secours (une seconde de voix) — c'est le
  comportement voulu, mais il est plus exigeant que la voie normale.
- Le risque de fausse coupure du §4 n'est **pas** mesuré sur du vrai son : il est
  borné par deux constantes et argumenté, pas observé.
