# Rapport — « la barre du bas ne s'efface plus » : un résultat de dictée VIDE réveillait le bas

> Statut : **CORRIGÉ ET VERROUILLÉ**. Correctif daté du **2026-11-15** dans le
> source (`src/js/super-agent.js`), resté **non commité** dans l'arbre de travail :
> il est ici **repris tel quel** (aucune réécriture), testé et documenté.
> Rédigé par : agent codeur.

---

## 1. Le défaut, dit simplement

En mode Vocal, le bas de l'écran (ligne d'état, zone de saisie, bouton du micro)
doit **s'effacer après 10 000 ms de repos** (`VOCAL_CHROME_IDLE_MS`, §4bis de
`spec_modes_ecran_vocal.md`). Il ne s'effaçait plus.

Le propriétaire avait déjà signalé deux causes, corrigées en 2026-11-13 (l'état
« écoute / Pilot parle » retenait le bas, et le **focus** passait pour du texte).
Celle-ci est **différente** : elle n'est **pas** dans la décision pure
(`src/js/vocal-chrome.js`), elle est dans le **branchement**.

## 2. La cause exacte

Dans le gestionnaire de résultat de la reconnaissance, `startVoiceInput` /
`rec.onresult` (`src/js/super-agent.js`), le réveil du bas était appelé à
**chaque** résultat, sans regarder son contenu :

```js
inputEl.value = preText + sep + transcript;
resizeInput();
vocalWakeChrome();      // ← défaut : appelé même sur un résultat VIDE
```

Or `vocalWakeChrome()` est le **seul** chemin qui repose le minuteur
(`vocalRestartChromeTimer()`), c'est-à-dire qui **remet le décompte à zéro**.

Le moteur de reconnaissance émet des résultats **vides** (`transcript === ""`)
en continu tant que la session écoute — micro armé, pièce silencieuse. Et c'est
précisément le cas nominal de cet écran : la **conversation parlée arme la
dictée au repos** (`vocal-conversation.js`, règle « armer au repos »). Pendant
tout le repos, chaque résultat vide relançait donc les 10 s : le compte à
rebours n'atteignait jamais son terme et **le bas ne s'effaçait jamais** — alors
même que la décision pure, elle, répondait correctement « masquage permis ».

## 3. Le correctif (conservé tel qu'il était écrit sur disque)

```js
if (transcript.trim()) vocalWakeChrome();
else vocalSyncChrome();
```

- **Un résultat contenant un mot** (`transcript.trim()` non vide) réveille le
  bas : c'est le texte réellement dicté, le champ vient de se remplir, le
  décompte doit repartir — comportement d'origine préservé.
- **Un résultat vide** ne réveille rien : il ne fait que **rejouer la décision**
  (`vocalSyncChrome()`), car le champ a pu changer entre-temps. Aucun minuteur
  n'est touché, donc le décompte en cours **continue sa route**.

## 4. Cohérence vérifiée avec les voisins

| Point | Constat |
|---|---|
| `src/js/vocal-chrome.js` (règle de masquage) | inchangé, et cohérent : un champ **vide** ne retient rien (règle 2), la **dictée armée mais silencieuse** est le cas particulier **voulu** du §4bis (« l'écran reste nu ») |
| `vocalWakeChrome` → `vocalRestartChromeTimer` | un seul point de pose du minuteur, toujours vrai (le correctif ne crée aucun nouvel appel au réveil) |
| `vocalSyncChrome` | ne pose **jamais** de minuteur (`clearVocalChromeTimer` seulement quand l'overlay est absent) : appeler `vocalSyncChrome` sur un résultat vide ne peut donc pas relancer les 10 s |
| Ordre peinture → réveil | `inputEl.value` puis `resizeInput()` puis le réveil : le bas ne revient jamais sur un champ vide |
| Reste de la session de dictée | **un seul** appel au réveil dans tout `startVoiceInput` (vérifié par test) : aucun `onstart` / `onend` / reprise ne réveille le bas |
| Hors du mode Vocal | sans overlay, les deux fonctions sont neutres : l'onglet π n'est pas concerné |

## 5. La preuve — test verrou

Fichier neuf : **`src/js/vocal-resultat-vide-ne-reveille-pas-le-bas.test.js`**
(9 tests). Il ne teste pas une réimplémentation : il lit le source **avec
`sliceSource`** (découpage vérifié — une ancre disparue **lève**, elle ne rend
jamais un fragment vide) et verrouille trois étages :

1. **Branchement** — dans `rec.onresult`, **un seul** appel au réveil, et il est
   `if (transcript.trim()) vocalWakeChrome();` ; aucun `vocalWakeChrome();` nu ;
   le chemin vide est `else vocalSyncChrome();` ; l'ordre écriture →
   redimensionnement → réveil ; aucun autre chemin de la session de dictée.
2. **Conséquence** — `vocalWakeChrome` repose le décompte, `vocalSyncChrome` n'en
   pose **aucun** (ni `vocalRestartChromeTimer`, ni `setTimeout`) ; le délai reste
   10 000 ms dans **une** constante.
3. **Sortie** — champ **vide**, micro ouvert, pas de question, pointeur ailleurs :
   `vocalChromeVisible` rend `false`, donc le bas **s'efface** ; champ **rempli** :
   il revient.

**Preuve que le test échoue SANS le correctif** (défaut réintroduit
temporairement — `vocalWakeChrome();` nu à la place des deux lignes — puis
correctif restauré à l'identique) : **4 tests rouges sur 9** :

```
1. un resultat VIDE ne peut pas appeler `vocalWakeChrome` (aucun appel nu)
   AssertionError: expected 'vocalWakeChrome();' to be 'if (transcript.trim()) vocalWakeChrom…'
2. le chemin VIDE rejoue la decision sans toucher au decompte
   AssertionError: expected 'rec.onresult = (e) => {\n      if (!v…' to match /else\s+vocalSyncChrome\(\);/
3. le reveil vient APRES l'ecriture du texte et le redimensionnement
   AssertionError: expected -1 to be greater than 1140
4. aucun AUTRE chemin de la dictee ne reveille le bas
   AssertionError: expected [ 'vocalWakeChrome();' ] to deeply equal [ Array(1) ]
```

Les cinq autres tests (contrat des deux fonctions de réveil, délai de 10 000 ms,
décision pure) restent verts dans les deux états : ils décrivent le voisinage,
le test qui **tient** le correctif est bien celui du branchement.

Avec le correctif en place : **9 / 9 verts**.

## 6. Compte de tests (recompté, non figé)

`npm test` (Vitest, suite frontend complète), exécuté après le correctif, le test
neuf et la mise à jour de la spec :

```
Test Files  278 passed (278)
     Tests  5145 passed (5145)
  Duration  16.65s
```

Aucun test existant n'a été assoupli, désactivé ni supprimé. Le test du masque
(`src/js/vocal-chrome-masque.test.js`) passe sans retouche : son découpage
`sliceSource(SUPER, "rec.onresult", "vocalWakeChrome();", 60)` trouve toujours son
ancre, l'appel étant désormais conditionnel mais toujours écrit.

**Observation honnête sur un run instable.** Un des lancements de la suite a
rapporté **1 échec** sur 5 145 (« 1 failed | 5144 passed »), sans que le nom du
test soit lisible dans la sortie filtrée par l'outil de capture du poste. Il n'a
**pas été reproduit** : **7 lancements consécutifs** de la suite complète, après
ce run, sont tous verts à **278 fichiers / 5 145 tests**. Le défaut n'est ni
reproductible ni attribué au correctif (qui ne touche qu'un branchement de la
dictée et dont les 9 tests sont verts dans ces runs) ; il est signalé plutôt que
tu, et mérite d'être surveillé si un test de délai se révèle instable.

## 7. Documentation mise à jour

`spec_modes_ecran_vocal.md` **uniquement** (aucun autre document n'est concerné —
le comportement utilisateur ne change pas, c'est un correctif) :

- **§4bis** — nouveau paragraphe « Correctif du 2026-11-15 — un résultat de dictée
  VIDE ne réveille plus le bas » : la troisième cause, sa différence avec celles
  du 2026-11-13 (branchement, pas décision), la ligne de code exacte, et le verrou ;
- **§4bis, « Où la décision vit »** — le point d'écriture du texte dicté précise
  désormais « réveil sur un **texte réel** seulement » ;
- **liste des verrous** — `vocal-resultat-vide-ne-reveille-pas-le-bas.test.js`
  ajouté avec ce qu'il tient.

Aucun bloc `<!-- HELP:* -->` n'est concerné (le §4bis n'en porte pas) : `help/handbook.md`
n'est donc **pas** régénéré et ne change pas.

## 8. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src/js/super-agent.js` | le correctif (déjà sur disque, **repris tel quel** : +11 / −1) |
| `src/js/vocal-resultat-vide-ne-reveille-pas-le-bas.test.js` | **neuf** — test verrou (9 tests) |
| `spec_modes_ecran_vocal.md` | §4bis + liste des verrous |
| `docs/rapports/RAPPORT-barre-du-bas-effacement.md` | ce rapport |

Rien d'autre n'a été modifié : ni `src-tauri`, ni la version (aucun bump), ni
`help/`, ni publication. Les autres modifications présentes dans l'arbre de
travail au moment de la mission n'ont pas été touchées (voir le commit : seuls
les quatre chemins ci-dessus y entrent).

## 9. Doutes restants (dits sans détour)

- Le test verrouille le **branchement** du source, pas l'exécution réelle du
  moteur : Web Speech n'est pas simulable de façon fiable en test headless, et
  c'est précisément le contrat (« un résultat vide n'appelle pas le réveil ») qui
  portait le défaut. Un essai manuel — entrer en mode Vocal, se taire 15 s,
  vérifier que le bas s'efface alors que la dictée est armée — reste la
  confirmation de bout en bout.
- Le comportement dépend du **moteur** : si un moteur émettait un résultat
  contenant uniquement une espace insécable, `trim()` le neutralise aussi — c'est
  voulu, et aucun test ne prétend le contraire.
