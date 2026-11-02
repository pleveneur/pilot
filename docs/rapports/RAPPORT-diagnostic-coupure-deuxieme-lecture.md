# Rapport — la coupure marche sur la 1re lecture, plus sur la 2e

> **Mission (lecture seule)** : trouver quel état / drapeau / abonnement / valeur
> survit à la première lecture et empêche la seconde d'être coupée, trancher entre
> « droit de couper consommé » (a) et « mesure d'écho polluée et conservée » (b),
> expliquer pourquoi le tout premier essai fonctionne, puis proposer la correction
> **minimale au point unique**.
>
> **Aucun fichier de code, de test ni de spec n'a été modifié.** Aucun commit.
> Date du relevé : 28 octobre 2026, HEAD = `c678bf5`.

---

## 0. Verdict en huit lignes

1. **Rien ne survit** de la garde d'une lecture à la suivante : `setSpeaking(false)`
   remet l'état à zéro (`vocal-mic.js:810-813`) et l'écran l'appelle à **chaque**
   fin de lecture (`super-agent.js:4932`). L'hypothèse **(a) est réfutée** par le
   code, pas par une mesure.
2. Ce qui change entre la 1re et la 2e lecture n'est pas un état du code mais
   **l'instant où le son de Pilot commence** : la fenêtre de calibrage de 600 ms
   s'ouvre sur `notify("speaking")` (`read-aloud.js:817`), c'est-à-dire **avant**
   les attentes qui précèdent le premier son (`read-aloud.js:833` puis `:878`,
   `VOICES_WAIT_MS = 1500`).
3. **1re lecture** : le moteur de voix est froid → les 600 ms sont **du silence**
   → résidu ≈ 0,01 → garde **ARMÉE** (`seuil = 0,05`) → la voix coupe en 200 ms.
4. **2e lecture** : le moteur est chaud (`ensureVoices` rend la liste déjà lue,
   `read-aloud.js:594` ; l'état du modèle local est en cache) → le son démarre en
   quelques dizaines de ms → les 600 ms contiennent **le son de Pilot, puis la
   voix de l'utilisateur dès qu'il réagit** → `residuel` = `refSecours` = 0,2–0,4.
5. Or c'est **la même valeur** qui sert deux fois : elle **désarme** la garde
   (`bargeInArmed`, `vocal-mic.js:284-290` : `residuel > 0,03` ⇒ désarmée) **et**
   elle devient la **référence gelée** de la garantie de secours
   (`vocal-mic.js:416`), dont le seuil vaut **le double** (`fallbackThreshold`,
   `vocal-mic.js:310-313`). La voix doit donc dépasser 0,4–0,8 : elle ne le fera
   jamais.
6. Voilà pourquoi « il parle longtemps, fort » ne change rien : **la référence est
   sa propre voix**, et aucune voix ne peut dépasser son double.
7. **Hypothèse (b) retenue**, mais corrigée dans son énoncé : la mesure n'est pas
   « conservée pour la suite » (elle est remesurée à chaque lecture) — c'est **le
   moment où elle est prise** qui est faux, et il est faux *systématiquement à
   partir de la 2e lecture* parce que c'est à partir de là que le son démarre dans
   la fenêtre.
8. **Correction minimale** : la référence d'une lecture se prend sur **l'attaque
   du son** (les `BARGE_IN_MIN_MS` = 200 ms premières millisecondes de la fenêtre,
   constante **existante**), et non sur les 600 ms entières. 4 lignes, un seul
   point (`stepSpeechGate`, branche de calibrage), **aucun seuil touché**, aucune
   seconde capture, aucun réglage. La 2e lecture redevient coupable, comme la 3e,
   la 4e, indéfiniment, et avec la même latence à chaque fois.

---

## 1. Le chemin réel entre deux lectures

Chronologie mesurée dans le code (une lecture = un appel de `speak()` de
`read-aloud.js`), avec, à chaque étape, **qui remet quoi à zéro**.

| # | Étape | Qui | Preuve | Remise à zéro |
|---|---|---|---|---|
| 1 | Pilot réfléchit | `reflectingActive = true` → `vocalMic.setThinking(true)` | `super-agent.js:4307-4310` | non (aucun reset à l'entrée) |
| 2 | La réflexion se termine | `setThinking(false)` → `garde = { ...emptySpeechGate(), declenche: garde.declenche }` | `vocal-mic.js:829-832` | **oui, sauf `declenche`** |
| 3 | La réponse arrive, l'écran clique le bouton « Écouter » | `autoReadVocalReply()` → `speak()` | `super-agent.js:3834`, `:4873` | — |
| 4 | `speak()` : `stopReading()` puis `notify("speaking")` | `read-aloud.js:806`, `:817` | | `stopReading` remet la **lecture** à zéro, pas la garde |
| 5 | L'écran reçoit l'évènement : `vocalSpeaking = true` → `setSpeaking(true)` | `super-agent.js:4920-4934`, `:4296-4298` | `vocal-mic.js:805-814` | **non** : `setSpeaking(true)` ne touche pas `garde` (seul `false` le fait) |
| 6 | **Attentes avant le premier son** : `refreshLocalVoiceStatus` (voix locale) puis `ensureVoices` (`VOICES_WAIT_MS = 1500`) | `read-aloud.js:833`, `:878`, `:587-611` | **c'est ici que se joue la différence 1re/2e lecture** |
| 7 | Calibrage : 600 ms, `residuel = max(residuel, m)` **et** `refSecours = max(refSecours, m)` | `vocal-mic.js:409-417` | | **la fenêtre prend tout ce qui s'y trouve** |
| 8 | Lecture : voix continue 200 ms au-dessus de `max(0,05 ; 1,8 × residuel)` ⇒ coupe | `vocal-mic.js:446-453` | | |
| 9 | Fin de lecture : `notify("ended")` → `vocalSpeaking = false` → `setSpeaking(false)` → `garde = emptySpeechGate()` | `read-aloud.js:849`/`:903`, `super-agent.js:4926-4932`, `vocal-mic.js:810-813` | **tout est remis à zéro** |
| 10 | Retour en écoute : la dictée se réarme 600 ms plus tard, la question suivante part, et on revient à l'étape 1 | `vocal-conversation.js` (`VOCAL_ARM_AFTER_READ_MS`) | | |

**Conclusion de la chronologie** : entre l'étape 9 et l'étape 5 de la lecture
suivante, **aucun** état de la garde ne traverse ; elle repart de
`emptySpeechGate()`. Le seul élément qui traverse est **le monde extérieur** :
le moteur de synthèse est désormais chaud, donc l'étape 6 ne prend plus de temps.

---

## 2. Ce qui n'est pas remis à zéro — inventaire complet (5 objets)

| Objet | Remis à zéro ? | Où | Effet sur la 2e lecture |
|---|---|---|---|
| `garde` (`residuel`, `refSecours`, `calibreMs`, `dessusMs`, `dessusSosMs`, `declenche`) | **oui** | `vocal-mic.js:811` | aucun |
| `declenche` lors de la transition **réflexion → lecture** | **non** | `vocal-mic.js:830` le **conserve** exprès | défaut n° 2 (§7) : une lecture peut hériter d'un verrou |
| `echoAnnule` (preuve d'annulation d'écho) | relu **à chaque** `setSpeaking(true)` | `vocal-mic.js:807` | aucun (déjà corrigé par `c678bf5`) |
| `niveau` (niveau lissé) | non (décroît, 0,12/image) | `vocal-mic.js` `smoothLevel` | négligeable après ≥ 1 s |
| **le retard du premier son** | — (pas un état du code) | `read-aloud.js:833`, `:878` | **la cause : il disparaît à la 2e lecture** |
| `voiceActive` (dictée ouverte) | seulement si la session se ferme | `super-agent.js:4670` | défaut n° 3 (§7), non systématique |

Il n'y a donc **ni drapeau de coupure consommé, ni abonnement posé une fois, ni
écouteur retiré sans réinstallation, ni objet recréé à la première lecture**.
L'hypothèse (a) tombe ici, sur pièces.

---

## 3. Hypothèses, classées, tranchées

### (a) « Le droit de couper est consommé puis jamais rendu » — **RÉFUTÉE**
- `setSpeaking(false)` fait `garde = emptySpeechGate()` (`vocal-mic.js:810-813`),
  ce qui rend `declenche = false`, `residuel = 0`, `refSecours = 0`.
- `setSpeaking` est **edge-triggered** (`if (etat === parlant) return;`,
  `vocal-mic.js:808`) mais l'écran ne l'appelle que sur **changement** et
  **inconditionnellement** dans `onVocalReadAloudState`
  (`vocalSyncMicSpeaking()` ligne `super-agent.js:4932`, hors du `if` de la
  ligne `:4933`) : la transition `true → false` a donc bien lieu à chaque fin de
  lecture, et une seule fois.
- Conséquence : si le droit était consommé, la **3e** lecture serait identique à
  la 2e, et un **nouvel essai** (sortie/entrée du mode) ne changerait rien. Or la
  table de `vocal.md` montre le contraire (cas 5 : « nouvel essai après un échec,
  sans rien changer → OK »). (a) n'explique pas non plus que la 1re lecture soit
  la bonne.

### (b) « La mesure d'écho est polluée, et la pollution est conservée » — **RETENUE, énoncé corrigé**
- La pollution est **réelle et démontrée** : pendant les 600 ms de calibrage, le
  code prend **le maximum de tout ce qu'il entend**, sans aucune condition
  (`vocal-mic.js:411`, `:416`), et le commentaire de la ligne `:412-415` affirme
  une prémisse fausse : *« c'est le seul moment où le son entendu est celui de
  Pilot (l'utilisateur ne peut pas encore avoir parlé) »*. C'est vrai **au
  premier son**, pas dans les 600 ms d'une lecture qui démarre instantanément.
- La conservation, en revanche, est **fausse** : `refSecours` est gelée **pour
  cette lecture seulement** (`emptySpeechGate()` à la fin).
- Ce qui est **conservé**, c'est la **cause de la pollution** : le moteur chaud
  (§4). D'où le caractère systématique à partir de la 2e lecture.

### (c) `if (voiceActive) return;` — **POSSIBLE, NON SYSTÉMATIQUE, INDISSOCIABLE AUJOURD'HUI**
- `super-agent.js:4670` sort de `vocalBargeIn` sans rien dire si une dictée est
  ouverte. La règle 3 de `vocal-conversation.js` ferme bien la dictée pendant la
  parole de Pilot, mais `vocalCloseForSend()` (`super-agent.js:~4570`) ne ferme
  pas la session : elle demande `rec.stop()` et attend `onend`. Si `onend` ne
  vient pas, `voiceActive` reste vrai et **aucune** lecture n'est plus coupable.
- Non systématique (il faudrait que la session traîne), mais **il produit la même
  signature visible que (b)** : aucune ligne `[vocal] …` (la trace est **après**
  ce `return`, `super-agent.js:4670` vs `:4677`). D'où l'instrumentation du §10 :
  sans elle, (b) et (c) sont indistinguables à l'œil.

### (d) Verrou `declenche` hérité de la réflexion — **RÉEL, SECONDAIRE** (défaut n° 2, §7)
- `setThinking(false)` réinstalle l'état **en gardant `declenche`**
  (`vocal-mic.js:830`). Si l'utilisateur a parlé ≥ 200 ms pendant la réflexion
  (ce qui **coupe le tour**, fonctionnalité voulue), la lecture qui suit démarre
  avec `declenche = true` et sort en `deja-coupe` (`vocal-mic.js:406-408`) :
  **elle ne peut plus être coupée du tout**, quelle que soit la référence.
- N'explique pas la différence froid/chaud, mais **s'ajoute** à (b) et doit être
  corrigé aussi.

### Ordre final
**(b) cause principale et systématique** → (d) cause aggravante réelle →
(c) cause possible non écartée.

---

## 4. Pourquoi le tout premier essai fonctionne — les trois faits ensemble

`notify("speaking")` (`read-aloud.js:817`) est émis **avant** deux attentes :

```
read-aloud.js:817   notify("speaking");           ← l'écran arme la garde ICI
read-aloud.js:828   if (isLocalVoiceChoice(choice)) {
read-aloud.js:832     const cached = localVoiceStatusFor(localModel);
read-aloud.js:833     const local = cached || (await refreshLocalVoiceStatus(...));   ← attente
read-aloud.js:878   const voices = await ensureVoices(synth, waitMs);                 ← attente (≤ 1500 ms)
read-aloud.js:903     speakIndex(0) → le PREMIER SON
```

- `ensureVoices` (`read-aloud.js:587-611`) : `if (initial.length) return
  Promise.resolve(initial);` → **instantané dès la 2e lecture**.
- `localVoiceStatusFor` (`local-voice.js:378`) lit un cache par modèle, rempli
  par la 1re lecture ; `playLocalChunks` synthétise le 1er morceau par IPC — le
  processus Piper et son modèle se chargent à la 1re fois, pas ensuite.

| | fenêtre de calibrage (600 ms) contient | `residuel` | `bargeInArmed` | `seuil` | résultat |
|---|---|---|---|---|---|
| **1re lecture** (froid) | du **silence** (le son arrive après ~0,8–1,5 s) | ≈ 0,01 | **armée** (0,01 ≤ 0,03) | 0,05 | coupe en **200 ms** ✔ |
| **2e lecture** (chaud) | le **son de Pilot** puis la **voix** de l'utilisateur (il réagit en 300–400 ms) | 0,2–0,4 | **désarmée** (0,4 > 0,03) | secours = **0,4–0,8** | **jamais** ✘ |

Les **trois faits** du brief, ensemble :

1. **La 1re lecture est coupable** parce que sa fenêtre est muette : la garde est
   armée sur un seuil bas, et le son de Pilot (annulé par l'écho, ≤ 0,03–0,05)
   ne la fait pas se déclencher toute seule. Ce n'est pas « la première », c'est
   « celle dont le son n'avait pas encore commencé ».
2. **La 2e ne l'est plus** parce que sa fenêtre mesure le son (et la voix) : la
   même valeur désarme la garde **et** gèle une référence au-dessus de toute voix
   (`fallbackThreshold` = 2 × référence, `vocal-mic.js:310-313`).
3. **Les sessions où même la 1re était incoupable** (l'intermittence de
   `vocal.md`) : moteur déjà chaud à la 1re lecture (mode quitté et repris sans
   rechargement, liste de voix déjà en cache de la fenêtre, modèle local déjà
   chargé). La table « OK / ÉCHEC sans changement de configuration » de
   `vocal.md` est exactement la carte froid/chaud. Le cas 4 documenté (« parle
   longtemps, fort : aucune coupure ») est la signature du seuil de secours posé
   à 2 × la voix.

---

## 5. La correction minimale — un point, 4 lignes, aucun seuil

**Point unique** : `src/js/vocal-mic.js`, branche de calibrage de
`stepSpeechGate` (lignes **409-418**). C'est le **seul** endroit où la référence
d'une lecture est décidée.

```js
  if (suivant.calibreMs < BARGE_IN_CALIBRATION_MS) {
    suivant.calibreMs += dt;
    // La référence se prend sur l'ATTAQUE du son : les `BARGE_IN_MIN_MS`
    // premières millisecondes de la fenêtre. C'est la seule portion où le son
    // entendu ne peut pas encore être une réaction de l'utilisateur (il vient
    // d'entendre Pilot commencer). Le reste de la fenêtre continue de
    // neutraliser la coupure, mais ne peut plus FAIRE MONTER la référence :
    // sinon la voix qui doit couper devient la référence qui l'en empêche.
    if (suivant.calibreMs - dt < BARGE_IN_MIN_MS) {
      suivant.residuel = Math.max(suivant.residuel, m);
      suivant.refSecours = Math.max(suivant.refSecours, m);
    }
    return { etat: suivant, declenche: false, arme, seuil: vocalEchoThreshold(suivant.residuel), motif: "calibrage" };
  }
```

Pourquoi c'est **la** correction :

- **aucune constante changée** : `BARGE_IN_MIN_MS` = 200 ms **existait déjà** et
  signifie exactement la bonne chose — « la durée qui distingue un claquement
  d'une voix » (`vocal-mic.js:202-203`) ; `BARGE_IN_CALIBRATION_MS` reste 600 ms ;
- **aucun nouveau réglage**, **aucune seconde capture**, **aucune API audio** ;
- la **protection anti-écho est intacte** : un écho franc présent **dès la
  première image** est toujours mesuré (il est dans l'attaque) et interdit
  toujours la coupure (test existant `echoAnnule:false` + 0,4 constant → 0
  déclenchement : vert) ;
- **le droit de couper est rendu à chaque lecture** : la référence ne dépend plus
  du tout de la température du moteur, donc la 2e, la 3e, la 10e lecture ont le
  régime de la 1re.

Effet chiffré sur les deux scénarios du §4 (fenêtres de 16 ms, écho 0,04, voix
0,35) :

| | aujourd'hui | après la correction |
|---|---|---|
| 1re lecture (silence puis son) | 1 déclenchement à +200 ms | **identique** (aucune régression) |
| 2e lecture (son dès l'image 0, voix à 350 ms) | **0 déclenchement** (`residuel` = 0,35, `refSecours` = 0,35, seuil de secours = 0,7) | **1 déclenchement** : `refSecours` = 0,04 → seuil 0,08 → **+1000 ms**, ou **+200 ms** si l'écho mesuré est ≤ 0,03 (garde armée) |

**Limites, dites franchement** :

1. Si l'écho réel mesuré sur l'attaque tombe dans `]0,03 ; 0,15]`, la garde reste
   désarmée (`bargeInArmed` exige ≤ 0,03) et la coupure passe par le secours en
   **1 s** au lieu de 200 ms. La correction rend donc la coupure **possible et
   reproductible**, pas forcément instantanée. Rendre la voie normale disponible
   quand la preuve d'écho est **avérée** (`echoAnnule === true`) demanderait de
   porter la tolérance de 0,03 à 0,05 (`BARGE_IN_MIN_LEVEL`) : **c'est une
   décision sur un seuil, hors de cette correction**, à trancher par le
   propriétaire.
2. Une voix qui démarrerait **dans les 200 premières ms du son de Pilot** serait
   encore prise pour la référence. La fenêtre de pollution passe de 600 ms à
   200 ms, et le cas devient identique à chaque lecture (au lieu d'empirer) ; le
   complément du §6 le ferme.

---

## 6. Complément recommandé (facultatif, autre point, 2 lignes)

Ancrer la fenêtre sur le **vrai** début du son plutôt que sur `notify("speaking")` :
émettre `speaking` à `utterance.onstart` (voix système) et après la synthèse du
premier morceau (voix locale), au lieu de `read-aloud.js:817`.

- **Non nécessaire** au cas rapporté (§5 suffit : la fenêtre d'attaque est muette
  à la 1re lecture et commence sur le son à la 2e, les deux tombent dans le
  régime qui marche).
- Utile pour que les 200 ms de référence coïncident **exactement** avec l'attaque
  du son, quel que soit le moteur, et pour que l'écran n'affiche « Pilot parle »
  qu'au moment où il parle.
- Effet de bord à vérifier : entre `speak()` et `onstart` (jusqu'à 1,5 s à
  froid), l'écran ne sait plus que Pilot parle — la dictée pourrait s'armer dans
  ce silence. Sans son, c'est inoffensif, mais **c'est à tester** ; si c'est
  gênant, garder `notify("speaking")` là où il est et ne changer que `onstart`
  pour **recaler** le calibrage. Ne pas faire les deux corrections à l'aveugle :
  §5 d'abord, §6 ensuite et seulement si la mesure du §10 le réclame.

---

## 7. Deux autres défauts trouvés en chemin (à corriger, 1 ligne chacun)

**Défaut n° 2 — un verrou de la réflexion peut avaler la lecture suivante.**
`setThinking(false)` conserve `declenche` (`vocal-mic.js:830`). Correction
minimale, **même point** : remettre la garde à zéro à **chaque** changement de
`parlant` (déplacer le `garde = emptySpeechGate()` hors du `if (!etat)`, lignes
`810-813`) — le verrou de la réflexion n'a aucune raison de survivre à une
lecture, qui est une autre prise de parole.

**Défaut n° 3 — `voiceActive` peut rendre toute coupure muette.**
`super-agent.js:4670` sort avant la décision. Correction minimale : ne sortir que
si la dictée est **réellement** ouverte (`vocalMicListening` **et** session
active), et **tracer** le cas (une ligne `console.info("[vocal] coupure ignoree :
dictee ouverte")`) pour ne plus jamais avoir deux causes indistinguables. À
instruire seulement si le §10 montre `voiceActive === true` sur la 2e lecture.

---

## 8. Ce que devient la correction déjà lancée (`c678bf5`)

Rapport lié : `RAPPORT-diagnostic-coupure-vocale-perdue.md`, correction
`c678bf5` (« la coupure de la lecture ne peut plus etre impossible ») :
relecture de `echoAnnulation` à chaque début de lecture (`vocal-mic.js:807`) +
garantie de secours (`BARGE_IN_FALLBACK_*`, `vocal-mic.js:219-221`, `:419-445`).

**Statut : à garder, à fusionner, NI inutile NI suffisante.**

- **Nécessaire** : elle ferme le cas « preuve d'écho figée à `false` » (une
  annulation d'écho lue une seule fois à l'ouverture du micro rendait la coupure
  impossible pour toute la session), et elle est **déjà correcte** sur ce point.
- **Insuffisante pour ce défaut-ci** : sa garantie de secours repose sur
  `refSecours`, c'est-à-dire **exactement la valeur polluée** par la fenêtre
  (`vocal-mic.js:412-416`). Dans le cas rapporté, le secours exige 2 × **la voix
  de l'utilisateur** : il ne peut donc jamais se déclencher. La correction du
  §5 rend cette référence honnête (l'attaque), et c'est **alors** que la
  garantie de secours de `c678bf5` devient réellement efficace. Les deux se
  complètent ; aucune des deux ne remplace l'autre.
- **Ne rien relancer** : le travail du premier diagnostic est clos et son apport
  est conservé tel quel.

---

## 9. Le test qui prouve la correction (à écrire avec la correction)

Fichier : `src/js/vocal-mic.garde-reference.test.js` (pur, sans micro, sans
fenêtre, sur `stepSpeechGate` / `emptySpeechGate`, comme
`ecran-vocal-lot4a.test.js`). Pas de 16 ms, `echoAnnule: true` sauf mention.

1. **« Deux lectures d'affilée : la seconde doit être coupable »** (le cas exigé).
   - Lecture 1 (froide) : 600 ms à 0,01 puis écho 0,04 jusqu'à 1500 ms, puis voix
     0,35 → **attendu : 1 déclenchement**, ≤ `BARGE_IN_MIN_MS + 40` ms après la voix.
   - Lecture 2 (chaude) : écho 0,04 **dès la 1re image**, voix 0,35 à partir de
     350 ms (**dans** la fenêtre de calibrage) → **attendu : 1 déclenchement** —
     *aujourd'hui : 0*, c'est la reproduction du défaut.
   - **Lecture 3** (identique à la 2) → même résultat que la 2 : le droit de
     couper ne se consomme pas.
   - Contrôle : `etat.refSecours < 0,1` après la 2e (la référence n'est pas la
     voix) et `fallbackThreshold(refSecours) < 0,1`.
2. **Invariance froid/chaud** : le même audio simulé produit le même résultat
   qu'il soit joué avant ou après une lecture complète (la garde ne dépend pas de
   ce qui s'est passé avant).
3. **Anti-régression anti-écho (doit rester vert tel quel)** : écho 0,4 constant,
   `echoAnnule: false`, 30 s → **0 déclenchement** ; puis 0,95 tenu 1000 ms →
   **1 déclenchement** (`motif: "voix-secours"`).
4. **Défaut n° 2** : état `{ ...emptySpeechGate(), declenche: true }`, `parlant:
   true`, voix 0,5 tenue 2 s → **attendu : 1 déclenchement** (aujourd'hui :
   `motif: "deja-coupe"`, 0 déclenchement). Et `setThinking(false)` →
   `garde.declenche === false`.
5. **Preuve de provenance (idiome du dépôt)** : `corpsFonction(MIC, "function
   stepSpeechGate(")` contient `calibreMs - dt < BARGE_IN_MIN_MS` et l'appel
   `Math.max(suivant.refSecours, m)` n'existe **qu'une fois**, sous cette
   condition (verrouille le point unique et empêche sa réapparition ailleurs).
6. **Neutralisation de contrôle** : retirer la condition ajoutée doit faire
   échouer 1 et 5 ; remettre `declenche: garde.declenche` doit faire échouer 4.

---

## 10. Recette de vérification à la main (au vrai micro, haut-parleurs internes)

**Instrumentation, 1 ligne, temporaire, à retirer après** — sans elle, les trois
causes sont indistinguables (aucune trace n'est écrite quand rien ne se
déclenche : `console.info` de `super-agent.js:4677` est après le `return` du
`voiceActive` et n'est atteint que sur une coupure). Dans `onVocalReadAloudState`
(`super-agent.js:4920`), **avant** `vocalSyncMicSpeaking()` (qui remet la garde à
zéro) :

```js
if (parlant && !vocalSpeaking && vocalMic) console.info("[vocal] fin de lecture", vocalMic.bargeInReport(), "dictee=" + voiceActive);
```

1. Entrer en mode Vocal, poser une question à la voix, **attendre** la réponse,
   la laisser parler, puis parler par-dessus → doit couper ; lire le relevé.
   **Attendu :** `residuel ≈ 0,0x`, `arme: true`, `seuil: 0.05`, `dictee=false`.
2. Reposer une question, **parler par-dessus la 2e lecture dès la 1re syllabe**
   → aujourd'hui, aucune coupure et **aucune** ligne `[vocal] prise de parole`.
   **Relevé attendu avant correction :** `arme: false`, `residuel` 0,2–0,4,
   `refSecours` ≈ `residuel`, `seuil` (= `seuilSecours`) 0,4–0,8 →
   **c'est la signature de (b)**. Si à la place `dictee=true`, c'est (c) ;
   si `declenche` était vrai dès le début, c'est (d).
3. Appliquer la correction du §5, rejouer **exactement** les deux lectures :
   relevé attendu `residuel ≈ 0,0x`, `refSecours ≈ residuel`, `arme: true` (ou
   `seuilSecours ≤ 0,1`), et une ligne
   `[vocal] prise de parole : residu=0.0x seuil=0.05 motif=voix-detectee pendant=lecture`
   **sur la 2e comme sur la 1re**.
4. Enchaîner 5 questions de suite en interrompant chaque lecture : les 5 doivent
   couper, avec la même latence (indéfiniment, c'est la propriété à tenir).
5. Retirer l'instrumentation.

---

## 11. Ce que ce rapport ne prouve pas

- **Les niveaux réels** (RMS de l'écho de Pilot et de la voix de l'utilisateur sur
  ce poste) : ils ne sont pas observables aujourd'hui. Le §10 étape 2 les donne.
  Selon leur valeur, la correction rend la coupure immédiate (200 ms, écho
  ≤ 0,03) ou différée d'une seconde (secours).
- **Le temps de démarrage réel** de `refreshLocalVoiceStatus` et de
  `playLocalChunks` à froid : le raisonnement repose sur le fait, certain, que
  `ensureVoices` (`read-aloud.js:594`) et le cache d'état local
  (`local-voice.js:378`) sont instantanés dès la 2e lecture, et sur une latence
  à froid **supérieure à 600 ms** — à confirmer d'un coup d'œil au chronomètre si
  le doute subsiste (le relevé du §10 le dit aussi).
- **Le cas (c)** n'est pas écarté : il faudrait le relevé `dictee=` pour trancher
  définitivement.
- Aucun test n'a été exécuté, aucun build : les invariants cités sont **lus** dans
  le source (et deux d'entre eux sont déjà verrouillés par
  `ecran-vocal-lot4a.test.js`), pas ré-exécutés ici.

---

## 12. Fichiers touchés

**Aucun fichier de code, de test ou de spec n'a été modifié.** Ce rapport est le
seul fichier écrit. Aucun commit.

---

VERDICT : rien ne survit de la garde entre deux lectures — l'hypothèse (a) est
**réfutée** (`setSpeaking(false)` remet tout à zéro, `vocal-mic.js:810-813`,
appelé à chaque fin de lecture, `super-agent.js:4932`). La cause est **(b)** avec
un énoncé corrigé : la **fenêtre de calibrage de 600 ms s'ouvre sur
`notify("speaking")`** (`read-aloud.js:817`), c'est-à-dire **avant** les attentes
qui précèdent le premier son (`:833`, `:878`) ; **muette à la 1re lecture**
(moteur froid, `ensureVoices` attend jusqu'à 1500 ms), **pleine du son et de la
voix à la 2e** (moteur chaud, tout est instantané). Le maximum de cette fenêtre
sert alors **deux fois** : il **désarme** la garde (`vocal-mic.js:284-290`,
`residuel > 0,03`) et il devient la **référence gelée** du secours
(`vocal-mic.js:416`), dont le seuil vaut **le double** (`:310-313`) — la voix de
l'utilisateur est donc sa propre barrière, d'où « parle longtemps, fort » sans
effet. Correction minimale : **la référence se prend sur l'attaque du son** (les
`BARGE_IN_MIN_MS` = 200 ms **existantes**) et non sur les 600 ms — 4 lignes, un
seul point (`stepSpeechGate`, `vocal-mic.js:409-418`), aucun seuil touché, aucune
seconde capture, aucun réglage, protection anti-écho intacte, droit de couper
rendu à **chaque** lecture. Le verrou `declenche` conservé par
`setThinking(false)` (`vocal-mic.js:830`) et le `return` sur `voiceActive`
(`super-agent.js:4670`) sont deux défauts réels distincts, à corriger séparément
(1 ligne chacun) et à distinguer par un relevé de `bargeInReport()`. La
correction `c678bf5` est **à garder** (nécessaire contre la preuve d'écho figée)
et **insuffisante ici** (son secours s'appuie sur la référence polluée) : les deux
se complètent, rien n'est à relancer.
