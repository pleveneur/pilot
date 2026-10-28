# Rapport — fermeture de la fiche du 02/10 (trois tests de verrouillage)

Fiche concernée : `docs/rapports/FICHE-correctif-coupure-vocale-20261002.md`.

## 1. Ce qui est fait

**Aucune valeur du code applicatif ne change.** Le correctif de réarmement était
déjà en place (état relu à chaque événement de lecture) ; ce qui manquait était
la **preuve**. Ce lot n'ajoute que des tests, plus une assertion documentaire.

| Test | Fichier | Ce qu'il interdit désormais |
|---|---|---|
| T1 `une lecture finie puis un arret manuel emettent « ended » puis « stopped »` | `src/js/read-aloud.test.js` | Que `notify("ended")` (`read-aloud.js:903` locale, `:957` système) ou `notify("stopped")` (`:846`) disparaisse : l'écran garderait `vocalSpeaking = true`, `setSpeaking(true)` sortirait sans remise à zéro et la **deuxième lecture serait « déjà coupée », en silence**. |
| T2 `le rearmement n'est pas conditionne par l'etat courant` | `src/js/ecran-vocal-lot4a.test.js` | Que `vocalSyncMicSpeaking()` redevienne conditionné par un **changement** d'état (`if (vocalSpeaking) vocalSyncMicSpeaking();`) : la garde ne serait plus réarmée par une lecture qui repart du même état. |
| T3 `la coupure vocale n'ajoute aucun reglage ni stockage dans l'ecran` | `src/js/vocal-couper-la-reflexion.test.js` | Qu'un `get_config` / `save_config` / `localStorage` apparaisse dans `onVocalReadAloudState` ou `vocalSyncMicSpeaking` : la décision doit rester sans réglage et sans mémoire. |
| T4 (documentaire, R9) `la documentation dit le rearmement a CHAQUE lecture et au DEBUT DU SON` | `src/js/ecran-vocal-lot4a.test.js` | Que `spec_modes_ecran_vocal.md` ou `help/overview.md` perde la phrase « à chaque lecture » ou « début du son » (le correctif repasserait pour un réglage ponctuel). |

Aucun fichier de production modifié : `src/js/read-aloud.js`,
`src/js/super-agent.js`, `src/js/vocal-mic.js` sont **inchangés**
(`git diff` vide sur ces trois fichiers à la fin du lot).

### Détail des branchements de test

- `src/js/read-aloud.test.js` : `makeWin(synth)` accepte un second paramètre
  **optionnel** `events` ; quand il est fourni, la fausse fenêtre expose
  `dispatchEvent` + `CustomEvent` et **journalise les événements émis**. Sans ce
  paramètre, la fenêtre est exactement celle d'avant (aucun `dispatchEvent`) :
  les 8 appels existants `makeWin(synth)` ne changent pas de comportement.
  Helper ajouté : `etatsEmis(events)` (lit `detail.state`).
- `src/js/ecran-vocal-lot4a.test.js` : T2 et T4 posés dans le `describe`
  « 4. l'ecran : couper passe par la SEULE voie existante (stopReading) ».
- `src/js/vocal-couper-la-reflexion.test.js` : T3 posé dans le `describe`
  « 6. ce qui ne devait pas changer », à côté du test de non-stockage existant
  (qui porte sur le moteur micro ; le nouveau porte sur **l'écran**).

## 2. Preuves de neutralisation (le test mord)

Méthode identique pour chaque test : **neutraliser volontairement** le
comportement protégé, lancer le fichier (doit être ROUGE), **restaurer à
l'identique** (`git diff` vide), relancer (doit être VERT).

### T1-a — retirer `notify("ended")` (les deux occurrences : `:903` et `:957`)

```
$ npx vitest run src/js/read-aloud.test.js
PASS (33) FAIL (1)

1. createSpeaker — une lecture, des morceaux, un arret net une lecture finie puis un arret manuel emettent « ended » puis « stopped »
   AssertionError: expected [ 'speaking' ] to include 'ended'
       at Proxy.<anonymous> (file:///G:/IA_PL/pilot/node_modules/@vitest/expect/dist/index.js:1196:17)
       at Proxy.<anonymous> (file:///G:/IA_PL/pilot/node_modules/@vitest/expect/dist/index.js:972:5)
       at Proxy.methodWrapper (file:///G:/IA_PL/pilot/node_modules/chai/index.js:1686:25)
       at G:\IA_PL\pilot\src\js\read-aloud.test.js:495:19
       at processTicksAndRejections (node:internal/process/task_queues:103:5)
       at file:///G:/IA_PL/pilot/node_modules/@vitest/runner/dist/index.js:533:5
       at runTest (file:///G:/IA_PL/pilot/node_modules/@vitest/runner/dist/index.js:1056:11)
       at runSuite (file:///G:/IA_PL/pilot/node_modules/@vitest/runner/dist/index.js:1205:9)
       at runSuite (file:///G:/IA_PL/pilot/node_modules/@vitest/runner/dist/index.js:1205:9)
       at runFiles (file:///G:/IA_PL/pilot/node_modules/@vitest/runner/dist/index.js:1262:5)
[full output: ~/AppData\Local\rtk\tee\1793190215_vitest_run.log]
```

Restauré (`git diff --stat src/js/read-aloud.js` : aucune ligne) :

```
$ npx vitest run src/js/read-aloud.test.js
PASS (34) FAIL (0)
```

### T1-b — retirer `notify("stopped")` (`:846`)

```
$ npx vitest run src/js/read-aloud.test.js
PASS (32) FAIL (2)

1. createSpeaker — une lecture, des morceaux, un arret net une lecture finie puis un arret manuel emettent « ended » puis « stopped »
   AssertionError: expected [ 'speaking' ] to include 'stopped'
       at G:\IA_PL\pilot\src\js\read-aloud.test.js:506:36
       ... (pile identique au cas precedent)
2. bouton de lecture affiche l'etat en TEXTE et par un changement visuel (sans couleur)
   AssertionError: expected 'Arrêter' to be 'Écouter' // Object.is equality
       at G:\IA_PL\pilot\src\js\read-aloud.test.js:568:67
```

Second échec **attendu et non subi** : il confirme que `stopped` est la même
source d'état pour le bouton *et* pour l'écran Vocal — la fiche décrit bien un
seul chemin.

Restauré (`git diff --stat src/js/read-aloud.js` : aucune ligne) :

```
$ npx vitest run src/js/read-aloud.test.js
PASS (34) FAIL (0)
```

### T2 — remettre la forme conditionnelle

Neutralisation appliquée dans `src/js/super-agent.js` (`onVocalReadAloudState`) :

```js
    if (vocalSpeaking) vocalSyncMicSpeaking();
    if (parlait !== vocalSpeaking) applyVocalState();
```

```
$ npx vitest run src/js/ecran-vocal-lot4a.test.js

  ❯ src/js/ecran-vocal-lot4a.test.js (46 tests | 1 failed) 60ms
  × 4. l'ecran : couper passe par la SEULE voie existante (stopReading) > le rearmement n'est pas conditionne par l'etat courant 9ms
    → expected 'const onVocalReadAloudState = (e) => …' not to match /if \([^)]*vocalSpeaking[^)]*\)\s*voca…/

  FAIL  src/js/ecran-vocal-lot4a.test.js > 4. l'ecran : couper passe par la SEULE voie existante (stopReading) > le rearmement n'est pas conditionne par l'etat courant
  AssertionError: expected 'const onVocalReadAloudState = (e) => …' not to match /if \([^)]*vocalSpeaking[^)]*\)\s*vocalSyncMicSpeaking/
```

Restauré (`git diff --stat src/js/super-agent.js` : aucune ligne) :

```
$ npx vitest run src/js/ecran-vocal-lot4a.test.js
PASS (46) FAIL (0)
```

### T3 — ajouter un stockage factice dans l'écran

Neutralisation appliquée dans `src/js/super-agent.js`, juste après l'assignation
de `vocalSpeaking` (ligne 5031 dans l'état neutralisé) :

```js
    void localStorage.getItem("vocal-speaking");
```

```
$ npx vitest run src/js/vocal-couper-la-reflexion.test.js

  ❯ src/js/vocal-couper-la-reflexion.test.js (22 tests | 1 failed) 27ms
  × 6. ce qui ne devait pas changer > la coupure vocale n'ajoute aucun reglage ni stockage dans l'ecran 7ms
    → onVocalReadAloudState : aucun reglage, aucun stockage: expected 'const onVocalReadAloudState = (e) => …' not to match /get_config|save_config|localStorage/

  FAIL  src/js/vocal-couper-la-reflexion.test.js > 6. ce qui ne devait pas changer > la coupure vocale n'ajoute aucun reglage ni stockage dans l'ecran
  AssertionError: onVocalReadAloudState : aucun reglage, aucun stockage: expected 'const onVocalReadAloudState = (e) => …' not to match /get_config|save_config|localStorage/
```

Restauré (`git diff --stat src/js/super-agent.js` : aucune ligne) :

```
$ npx vitest run src/js/vocal-couper-la-reflexion.test.js
PASS (22) FAIL (0)
```

### T4 — retirer la phrase de la spec

Neutralisation appliquée dans `spec_modes_ecran_vocal.md` :
« coupe à CHAQUE lecture » → « coupe à la premiere lecture ».

```
$ npx vitest run src/js/ecran-vocal-lot4a.test.js -t "documentation dit le rearmement"

  ❯ src/js/ecran-vocal-lot4a.test.js (46 tests | 1 failed | 45 skipped) 11ms
  × 4. l'ecran : ... > la documentation dit le rearmement a CHAQUE lecture et au DEBUT DU SON 10ms
    → spec_modes_ecran_vocal.md : « a chaque lecture »: expected '# Pilot — Les trois modes d\'écran et…' to match /à chaque lecture/i
```

Restauré (`git diff --stat spec_modes_ecran_vocal.md` : aucune ligne) ; la
version verte est celle de la suite complète (§3).

## 3. Suite complète (chiffres recomptés)

```
$ npx vitest run
PASS (4004) FAIL (0)
```

**216 fichiers de test** exécutés (`src/js/**/*.test.js` + `scripts/**/*.test.js`),
**4004 tests au vert, 0 échec**, avant le commit. Les quatre fichiers touchés
passent seuls : `read-aloud.test.js` (34), `ecran-vocal-lot4a.test.js` (46),
`vocal-couper-la-reflexion.test.js` (22).

## 4. Ce qui n'a pas été touché

- **Aucun seuil** : 600 / 200 / 0,05 / 0,03 / 0,01 / 1000, marges 1,8 et 2,
  `stepSpeechGate`, `setSpeaking`, `setSoundStarted`, `setThinking` — intacts
  (aucune modification dans `src/js/vocal-mic.js`).
- Le halo de la parole, le lot B du cercle (`279c33c`) et le correctif de
  lecture (`44c7f65`) : non touchés.
- `help/handbook.md` : non édité à la main (aucune modification d'un bloc
  `<!-- HELP:* -->` n'a été nécessaire).

VERDICT : les trois trous de verrouillage de la fiche du 02/10 sont fermés par
des tests qui **mordent** (preuves ci-dessus, chacune rouge puis verte après
restauration à l'identique), sans qu'aucune valeur du code n'ait changé.
