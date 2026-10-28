# Rapport de diagnostic — l'écran Vocal ne change pas d'état visible

> Agent de DIAGNOSTIC, lecture seule. Aucun fichier de code modifié, aucun
> commit, aucune publication. Le seul fichier écrit est ce rapport.
> Date : 2026-10-28 (session de test en direct du propriétaire).

---

## 1. Symptôme observé par le propriétaire

En mode **Vocal**, micro ouvert (le témoin système s'allume, le **trait de niveau
s'allonge réellement quand il parle**) :

- la **ligne d'état** affiche **« Je vous écoute… »** (points de suspension) en
  permanence — qu'il parle ou qu'il se taise ;
- la **teinte de l'objet** ne montre jamais le vert de l'état « écoute » puis le
  retour à l'accent du thème « repos » : elle reste sur une seule valeur.

Attendu (§ 4 de `spec_modes_ecran_vocal.md`) : deux états distincts à l'œil,
**repos** (`--vocal-rest`, « Je vous écoute.**»**) et **écoute**
(`--vocal-listen`, « Je vous écoute**…** »), l'écoute n'étant vraie que quand
« le micro **capte vraiment** ».

---

## 2. Comment l'état est calculé et appliqué aujourd'hui (preuves)

### 2.1 Les fonctions pures (correctes)

| Élément | Preuve |
|---|---|
| Calcul de l'état, priorité parole > réflexion > écoute > repos | `src/js/super-agent.js:474-481` |
| Classe unique posée sur le calque | `src/js/super-agent.js:483-485` |
| Phrase unique par état (`listening` → « Je vous écoute… », `idle` → « Je vous écoute. ») | `src/js/super-agent.js:494-505` |
| Teinte par état (`--vocal-state`) | `src/css/style.css:11593-11596` |

Ces trois fonctions sont **justes** : le défaut n'est pas là (voir § 5).

### 2.2 L'application à l'écran

- `applyVocalState()` construit les trois drapeaux et écrit **une seule** classe
  + la phrase : `src/js/super-agent.js:3946-3967` (drapeaux `3950-3953`, classe
  `3955-3962`, texte `3965`).
- Le drapeau « écoute » est **littéralement** `vocalMicListening` :
  `src/js/super-agent.js:3951`.

### 2.3 D'où vient `vocalMicListening` — LE point du défaut

- Déclaré : `src/js/super-agent.js:3248`.
- Écrit **uniquement** par `vocalSetListening(actif)` :
  `src/js/super-agent.js:3878-3884` (`vocalMicListening = actif === true`,
  ligne `3880`), mis à `false` au repos d'entrée `4059`, à la panne `3891` et à
  la sortie `4120`.
- `vocalSetListening` est branché **exclusivement** sur `onListening` du moteur
  micro : `src/js/super-agent.js:4063` (`onListening: vocalSetListening`).

Or `onListening` (contrat décrit « vrai SEULEMENT quand le micro capte
réellement », `src/js/vocal-mic.js:342`) n'est émis qu'à **deux endroits**, tous
deux liés à l'**ouverture/fermeture du flux**, jamais au niveau :

- `surEcoute(true)` — **une seule fois**, à la fin de `demander()`, après
  l'ouverture du périphérique : `src/js/vocal-mic.js:625` ;
- `surEcoute(false)` — **une seule fois**, dans `liberer()` (arrêt réel, panne) :
  `src/js/vocal-mic.js:464`.

Le niveau mesuré, lui, part par un **autre** retour, qui ne touche jamais
l'état :

- `niveau = smoothLevel(niveau, rmsOf(tampon))` puis `surNiveau(niveau)`
  (`onLevel`) : `src/js/vocal-mic.js:477-482` ;
- côté écran, `onLevel: vocalSetLevel` (`src/js/super-agent.js:4062`) et
  `vocalSetLevel` (`src/js/super-agent.js:3861-3866`) n'écrit **que** la
  variable CSS `--vocal-level` ; il n'appelle **jamais** `applyVocalState()` et
  ne touche **jamais** `vocalMicListening`.

**Conclusion de lecture** : il n'existe, dans tout le code, **aucun seuil** sur
le niveau pour décider de l'état « écoute ». Le seul seuil du projet
(`BARGE_IN_MIN_LEVEL`, `src/js/vocal-mic.js:165`) appartient à la garde
anti-auto-coupure et n'est utilisé **que** quand Pilot lit à voix haute
(`stepSpeechGate`, `src/js/vocal-mic.js:281` : `if (c.parlant !== true)`
⇒ `hors-lecture`). Rien ne relie la mesure du micro à l'état affiché.

---

## 3. Preuve expérimentale (test court, exécuté AVANT ce rapport par la même session)

Sonde jetable dans `/tmp/diag-vocal/probe.mjs` (hors du dépôt), important
directement `src/js/vocal-mic.js` avec un faux micro et 6 images de niveau :
`0 · 0,001 · 0,4 · 0,6 · 0,5 · 0,0005` (silence → voix → silence).

```
onListening      = [true]                 <- UN seul évènement, jamais false
niveaux mesurés  = 0.000, 0.001, 0.200, 0.400, 0.450, 0.396
longueurs trait  =   8%, 10.1%, 49.2%, 66.2%, 69.7%, 65.9%
```

Le trait **suit bien la voix** (il a été écrit 8 % → 69,7 %), mais
`onListening` n'est passé qu'une fois à `true` et **n'est jamais revenu à
`false` au silence**. Ce qui est exactement le symptôme du propriétaire : la
longueur du trait bouge, la phrase et la couleur non.

---

## 4. Les deux hypothèses, explicitement départagées

| | Hypothèse | Verdict |
|---|---|---|
| **A** | L'état **ne change jamais** et la phrase + la couleur restent figées sur **une seule valeur**, alors que le trait suit la voix. | **Partiellement vraie dans les mots, fausse sur la valeur figée** : l'état est bien figé, mais figé sur **« écoute »**, pas sur un état arbitraire — voir B. Elle décrit correctement le symptôme (« rien ne bouge ») mais se trompe sur l'état atteint. |
| **B** | L'écran est bloqué **en état « écoute » en permanence** (entrée dans l'état sans condition de sortie) : la phrase ne quitte jamais ses points de suspension, le repos n'est jamais montré. | **CAUSE RÉELLE. Prouvée.** `vocalMicListening` passe à `true` à l'ouverture du micro (`vocal-mic.js:625`) et n'a **aucune condition de retour** liée au niveau : les seuls retours à `false` sont la panne (`super-agent.js:3891`) et la sortie du mode (`4120`). Il n'y a donc **pas** de « seuil trop bas » (aucun seuil n'existe) mais **aucune condition de sortie** — c'est la variante haute de l'hypothèse B. |

**Hypothèse A est réfutée comme cause** : le niveau mesuré est bien pris en
compte, mais uniquement pour la **longueur** du trait (`--vocal-level`,
`super-agent.js:3861-3866`) ; la phrase et la classe d'état ne lisent jamais ce
niveau.

**Nuance utile pour la correction** : avant le premier geste, l'écran est bien
en « repos » (`vocalMicListening = false` à l'entrée, `super-agent.js:4059`,
puis `applyVocalState()` en fin d'entrée `4102`). Le blocage commence au
**premier geste** (clic/touche → `onVocalFirstGesture`, `super-agent.js:3902-3916`
→ `vocalMic.demander()`, `3907-3910`), c'est-à-dire dès que la permission est accordée. Tout
le reste de la session est « écoute », y compris à volume nul.

---

## 5. Ce que les tests vérifient réellement — et l'angle mort

### 5.1 Ce qui est vérifié (et qui passe malgré le défaut)

| Test | Fichier:ligne | Ce qu'il prouve | Pourquoi il ne voit rien |
|---|---|---|---|
| Les quatre états et leur priorité | `src/js/ecran-vocal-lot2.test.js:139-171` | `vocalScreenState({listening:true}) === "listening"`, etc. | Teste une **fonction pure** en **injectant le booléen à la main**. Il ne dit rien de la façon dont ce booléen est produit au vrai micro. |
| Une seule classe à la fois | `src/js/ecran-vocal-lot2.test.js:158-163` | `vocalStateClass(...)` | Idem : entrée fabriquée. |
| Les quatre teintes CSS | `src/js/ecran-vocal-lot2.test.js:166-179` | les 4 classes posent `--vocal-state` | Le CSS est juste ; il n'est simplement jamais atteint en `idle`. |
| L'écran ne fabrique pas l'état à partir du micro | `src/js/ecran-vocal-lot2.test.js:446-455` | `listening: vocalMicListening` **par expression régulière sur le source** | Vérifie la **lettre** du câblage, pas son **comportement** : que `vocalMicListening` ne suive que l'ouverture du flux ne se voit pas dans un regex. |
| « l'état "écoute" n'est vrai que si le micro capte » | `src/js/ecran-vocal-lot3.test.js:325-331` | `vocalMicListening = actif === true` **par regex** dans `vocalSetListening` | **C'est le test qui aurait dû attraper le défaut.** Son titre est exactement le comportement attendu, mais son corps ne lit que deux motifs de source : il ne simule **jamais** une voix, il ne regarde **jamais** `onListening`, et il n'exige **jamais** un retour à `false`. |
| « un périphérique retiré en pleine écoute repasse au silence » | `src/js/ecran-vocal-lot3.test.js:292-308` (assertion `:303`) | `expect(vus.ecoutes).toEqual([true])` après avoir **joué une image de niveau 0.3** | Ce test **inscrit le défaut comme comportement attendu** : il constate qu'avec une voix à 0,3, `onListening` n'émet **rien** de plus que le `true` d'ouverture. Il aurait dû exiger des bascules pilotées par le niveau. |
| Sortie du mode / panne | `src/js/ecran-vocal-lot3.test.js:413` | `vocalMicListening = false` dans `exitVocal` | Cohérent, mais ne couvre pas le repos **pendant** la session. |

### 5.2 L'angle mort, en une phrase

Aucun test du projet n'exécute la **chaîne complète** « niveau du micro →
`onLevel` → état de l'écran → phrase + classe », et aucun n'exige que l'écran
**quitte** l'état « écoute » quand le niveau retombe. Les tests d'état sont purs
(booléen en entrée) ; les tests du micro vont jusqu'à `onListening` mais
**affirment** qu'il n'est émis qu'à l'ouverture. Le défaut tombe exactement dans
la couture entre les deux.

**Test qui aurait dû l'attraper** : `src/js/ecran-vocal-lot3.test.js:325`
(« l'etat « ecoute » n'est vrai que si le micro capte ») — son intitulé est la
garantie violée par le code livré.

---

## 6. Correction minimale proposée (à ne pas appliquer dans cette mission)

Objectif : le plus petit changement qui rend « repos » et « écoute »
**réellement distincts à l'œil**, sans toucher au lecteur à voix haute, à la
garde anti-auto-coupure du lot 4a, ni au mode « Assistant seul ». **Aucun
changement dans `vocal-mic.js`** (donc aucune régression possible sur
`stepSpeechGate`, `bargeInArmed`, ni sur les assertions `vus.ecoutes` des tests
existants).

### 6.1 Ajouter une décision PURE, avec hystérésis (near `super-agent.js:474`)

```js
/** Le micro CAPTE-t-il vraiment ? Deux seuils (hystérésis) : entrer en
 *  « écoute » exige une vraie voix, en sortir tolère la retombée lissée. */
export const VOCAL_VOICE_ON = 0.06;
export const VOCAL_VOICE_OFF = 0.03;
export function vocalCapte(niveau, etait) {
  const n = Number.isFinite(niveau) ? Math.max(0, Math.min(1, niveau)) : 0;
  return etait === true ? n >= VOCAL_VOICE_OFF : n >= VOCAL_VOICE_ON;
}
```

(0,06 / 0,03 RMS : du même ordre que le plancher déjà retenu par le projet,
`BARGE_IN_MIN_LEVEL = 0.05`, `vocal-mic.js:165` ; l'hystérésis évite le
clignotement, la retombée du lissage étant lente — `smoothLevel`, descente
0,12, `vocal-mic.js:97`.)

### 6.2 Un seul drapeau de plus, et deux lignes

1. `super-agent.js:3248` — à côté de `vocalMicListening`, ajouter
   `let vocalMicCapte = false;` (le micro *capte*, distinct du micro *ouvert*).
2. `super-agent.js:3951` — remplacer
   `listening: vocalMicListening,` par
   `listening: vocalMicListening && vocalMicCapte,`.
3. `super-agent.js:3861-3866` — dans `vocalSetLevel(niveau)`, **avant** d'écrire
   `--vocal-level` :

   ```js
   const capte = vocalCapte(niveau, vocalMicCapte);
   if (capte !== vocalMicCapte) { vocalMicCapte = capte; applyVocalState(); }
   ```

4. Remettre `vocalMicCapte = false` aux trois endroits qui remettent déjà
   `vocalMicListening = false` : `enterVocal` (`4059`), `vocalMicFailure`
   (`3891`), `exitVocal` (`4120`).

Pourquoi c'est le minimum : une seule variable, une fonction pure, une
condition dans `applyVocalState`, deux lignes dans `vocalSetLevel`. Aucun
nouveau réglage, aucun nouveau fichier, aucun changement de CSS, aucune
modification de `vocal-mic.js`.

Effets attendus :
- micro ouvert mais silencieux → **repos** (accent du thème, « Je vous
  écoute. », respiration 4 s) ;
- voix réelle → **écoute** (vert, « Je vous écoute… ») et le trait continue de
  suivre le niveau, comme aujourd'hui ;
- mouvement réduit : le trait figé passe enfin de 8 % à 45 %
  (`style.css:11790-11791`), ce qui rend les deux états distincts **aussi** pour
  ces utilisateurs ;
- Pilot lit → « parole », puis retour **soit** « écoute » (si la voix continue),
  **soit** « repos » — ce qui rétablit le § 4 de la spec.

Option (documentation) : mettre à jour `spec_modes_ecran_vocal.md` § 4/§ 5 pour
dire que l'état « écoute » a **deux seuils** (0,06 / 0,03 RMS sur le niveau
lissé) — aujourd'hui la spec dit seulement « le micro capte vraiment », sans
chiffre, ce qui a permis au code de ne mettre aucun seuil.

### 6.3 Test à ajouter (pour que le défaut ne revienne pas)

Dans `src/js/ecran-vocal-lot3.test.js` (à côté du test `:325` qu'il complète,
sans le supprimer) :

1. **Test de comportement du moteur** (faux micro déjà présent dans le fichier,
   `fauxMicro`) : jouer 3 images à `0`, puis 3 images à `0,4`, puis 3 images à
   `0` et exiger `vus.ecoutes` **différent** de `[true]` — c'est-à-dire la
   présence d'au moins un retour à `false`… **sauf** si la décision est prise côté
   écran (§ 6.1) : dans ce cas, test **pur** sur `vocalCapte` :

   ```js
   expect(vocalCapte(0.001, false)).toBe(false);
   expect(vocalCapte(0.4, false)).toBe(true);
   expect(vocalCapte(0.04, true)).toBe(true);   // hystérésis : on ne retombe pas
   expect(vocalCapte(0.001, true)).toBe(false); // le repos revient
   ```

2. **Test de câblage, non contournable par un regex** : exiger que l'état
   dépende du niveau —
   ```js
   const corps = corpsFonction(SUPER, "function applyVocalState");
   expect(corps).toMatch(/listening:\s*vocalMicListening\s*&&\s*vocalMicCapte/);
   const niveau = corpsFonction(SUPER, "function vocalSetLevel");
   expect(niveau).toMatch(/applyVocalState\(\)/);
   ```
3. **Test « les deux états sont atteignables » (le vrai garde-fou)** : vérifier
   que `vocalStatusText("idle")` **et** `vocalStatusText("listening")` sont
   différentes **et** que `vocalStateClass` produit bien les deux classes — déjà
   couvert — **plus** le point manquant : que `applyVocalState` **peut** produire
   `idle` alors que le micro est ouvert (`vocalMicListening = true` et
   `vocalMicCapte = false` ⇒ `vocalScreenState` doit rendre `"idle"`).

---

## 7. Ce que cette mission n'a pas fait

- Aucun fichier de code modifié (le seul écrit est ce rapport).
- Aucun commit, aucun envoi distant, aucun changement de version.
- Aucune correction appliquée : le § 6 est une **proposition**.
- Tests longs non lancés ; seul le test court de la sonde du § 3 a été exécuté,
  avant la rédaction de ce rapport.

---

VERDICT : L'écran Vocal est bloqué en état « écoute » en permanence (hypothèse B, variante « aucune condition de sortie ») parce que le drapeau `vocalMicListening` n'est alimenté que par `onListening`, que `vocal-mic.js` n'émet qu'à l'ouverture (`vocal-mic.js:625`) et à l'arrêt (`464`) du flux, jamais au niveau — alors que le niveau ne pilote que la longueur du trait (`super-agent.js:3861-3866`) ; la phrase « Je vous écoute… » et la teinte verte sont donc figées dès le premier geste, et le repos n'est jamais réaffiché. Correction minimale : une fonction pure `vocalCapte(niveau, etait)` à deux seuils (0,06 / 0,03 RMS) + un drapeau `vocalMicCapte` alimenté dans `vocalSetLevel` (qui appelle alors `applyVocalState`) + `listening: vocalMicListening && vocalMicCapte` dans `applyVocalState` — aucun changement dans `vocal-mic.js`, au lecteur à voix haute, à la coupure de parole ni au mode « Assistant seul ». Le test qui aurait dû attraper le défaut est `ecran-vocal-lot3.test.js:325` (« l'etat « ecoute » n'est vrai que si le micro capte »), qui ne vérifie qu'un motif de source au lieu du comportement ; le test à ajouter porte sur `vocalCapte` (hystérésis), sur le câblage `vocalMicListening && vocalMicCapte`, et sur le fait que `idle` est atteignable micro ouvert.
