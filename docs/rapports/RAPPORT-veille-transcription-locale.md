# Rapport — la mise en veille de 20 s ne s'armait jamais avec la transcription locale

**Défaut signalé par le propriétaire, version installée** : la case « Transcrire
avec le service de voix local » cochée, l'écran Vocal reste **à l'écoute
indéfiniment**. La veille automatique après 20 s de silence ne s'arme **jamais**,
donc l'invitation « Dites « <Nom> » pour me parler. » ne s'affiche jamais. Case
décochée (moteur du navigateur), tout va bien : la veille s'arme après la
réponse, et le nom réveille du premier coup.

**Ce qui n'a pas changé** : le seuil de 20 s (`VOCAL_ECOUTE_LIBRE_MS = 20000`,
une seule occurrence dans le dépôt), la phrase d'invitation, l'aspect de la
veille (classe `vocal-veille`, commit `b34e25e`), le réveil par le nom, et le
comportement de l'écoute **non locale**.

---

## 1. Comment la cause a été établie (deux preuves, pas une supposition)

### 1.1 Le service local ne fabrique pas de paroles dans le silence

Sonde jetable (`.pi/tmp/sonde-silence-asr.mjs`) branchée sur le pont en service,
en écrivant du PCM 16 kHz dans la session de flux :

| Ce qui a été envoyé | Réponse du service |
|---|---|
| 20 s de silence pur | `session.started` puis `final/summary` avec `text: ""` — **aucun partiel** |
| 20 s de bruit (amplitude 300) | idem : **aucun partiel** |

⇒ L'hypothèse « le service transcrit le bruit de fond et rend des textes
fantômes » est **écartée**. Le défaut est **en aval**, dans la relance du compte.

### 1.2 Le journal réel ne montre aucune veille

`%APPDATA%/com.pilot.editor.dev/voix-locale.log` (19,7 Ko, session réelle) :
alternance régulière de `fin-normale-avec-texte` (vrais textes, 5 à 339
caractères, sessions jusqu'à 23 s) et de `session-fermee` (texte vide, 2,4 à
3,7 s). **Aucune entrée d'armement de veille** : la dictée locale fonctionne, ses
textes sont acceptés, et la veille ne se déclenche pas.

### 1.3 Les deux causes (comparaison des deux chemins)

**Cause 1 — un texte qui n'est pas une parole remettait le compte à zéro.**

`vocalNoteWord()` appelait `vocalRestartVeilleTimer()` à **chaque** texte rendu
par le moteur. L'oreille du navigateur ne rend rien dans une pièce silencieuse et
sa session se ferme d'elle-même (`no-speech`), ce qui réapplique l'état ; le
service **local transcrit la pièce en continu**, micro armé et silence compris
(c'est déjà écrit dans le correctif « la barre du bas ne s'efface plus »). Le
compte de 20 s était donc remis à zéro **avant son terme**, toutes les quelques
secondes, indéfiniment.

**Cause 2 — le compte perdu n'était jamais recréé.**

Le compte n'existe que sous la forme d'**un** minuteur, que plusieurs chemins
annulent (suspension pendant la lecture ou le tour, entrée/sortie du mode). Avec
l'oreille du navigateur, chaque fin de session de reconnaissance le recrée de
fait ; avec l'oreille **locale**, la session **ne se ferme jamais d'elle-même**
(le pont n'envoie la fin de flux que si Pilot la demande, et une pièce silencieuse
ne produit aucun événement). Après le dernier signe de vie, plus rien ne
réévaluait la veille : l'écran restait à l'écoute.

---

## 2. La correction (minimale, deux endroits)

### 2.1 `src/js/vocal-nom-garde.js` — une règle pure et une période

```js
export function texteCompteCommeParole(etats = {}) {
  const e = etats || {};
  if (e.microMesure !== true) return true; // fail-open
  return e.voixMesuree === true;
}

export const VOCAL_VEILLE_REEXAMEN_MS = 1000;
```

**Fail-open assumé** : quand aucune mesure n'est ouverte, rien ne permet de
contredire le mot, il compte comme avant. Un vrai locuteur ne perd donc jamais
son mot (sinon la veille s'armerait pendant qu'il parle).

### 2.2 `src/js/super-agent.js` — le branchement

1. **`vocalNoteWord`** : la relance du compte est **conditionnée** à la règle —
   `texteCompteCommeParole({ microMesure: vocalMicListening === true, voixMesuree: vocalMicCapte === true })`.
   Le chemin ne regarde **pas** le moteur : une voix mesurée accompagne toujours
   un vrai mot, donc l'écoute non locale est inchangée.
2. **`vocalVeilleDecision(veilleArmee)`** : la question posée à la décision pure
   (`decideVocalVeille`) est construite **à un seul endroit**, avec le même délai
   et le même repère. Le minuteur et le réexamen ne peuvent plus diverger.
3. **`vocalVeilleReexamenPass()`** + `vocalVeilleReexamen` (`setInterval`,
   `VOCAL_VEILLE_REEXAMEN_MS`) : ouverts dans `enterVocal`, annulés dans
   `exitVocal`. Le réexamen **sort dès qu'un minuteur tourne** (`if
   (vocalVeilleTimer) return;`), **n'écrit jamais** `vocalVeilleTimer` ni
   `vocalVeilleDepart` : il ne fait que **recréer un compte perdu**. Aucun
   écran, aucune phrase, aucune classe n'est touché.
4. **`vocalRestartVeilleTimer`** : `vocalVeilleDepart = Date.now()` est posé
   **avant** les sorties anticipées (le repère du dernier signe de vie n'est
   jamais périmé), et `vocalSyncVeilleSuspension` le pose aussi au moment de la
   suspension — le décompte repart de la fin de la lecture ou du tour, pas d'un
   signe de vie ancien.

### 2.3 Ce qui est resté intact, et comment c'est tenu

| Garantie | Où |
|---|---|
| 20 000 ms, une seule occurrence | `VOCAL_ECOUTE_LIBRE_MS`, module pur ; l'écran n'écrit aucun `20000` |
| Un seul minuteur de veille | `vocalVeilleTimer = setTimeout(` : une occurrence |
| Une seule construction de la décision | `decideVocalVeille({` : une occurrence |
| Un seul point d'armement | `vocalVeilleArmee = true;` : une occurrence, avec `vocalSyncVeilleClass()` |
| Deux portes d'armement seulement | `vocalEnterVeille("silence")` : deux occurrences (minuteur, réexamen) |
| Parole mesurée → compte repart | `vocalSetLevel` : `if (pas.capte === true) vocalRestartVeilleTimer();` (inchangé) |
| Réveil par le nom | `vocalExitVeille` inchangé (`vocalVeilleArmee = false`, classe, relance) |

Deux verrous **existants** ont dû être ajustés : ils exigeaient que
`decideVocalVeille({` se trouve dans le corps de `vocalRestartVeilleTimer`. La
décision étant désormais construite une seule fois (`vocalVeilleDecision`), ils
pointent sur cette fonction et vérifient en plus que le minuteur **l'appelle** —
la garantie est la même, et elle est plus forte (un seul site).

---

## 3. Preuves

### 3.1 Le nouveau verrou échoue sur le code d'avant

```
git stash push -- src/js/super-agent.js src/js/vocal-nom-garde.js
npx vitest run src/js/veille-transcription-locale.test.js   → échecs (import + assertions)
git stash pop
```

### 3.2 Le nouveau verrou passe après

`src/js/veille-transcription-locale.test.js` — **17 verrous**, dont :

- **la règle pure** : mesure ouverte + aucune voix ⇒ **ne compte pas** ; voix
  mesurée ⇒ compte ; aucune mesure ⇒ compte (fail-open) ;
- **la simulation du compte** (temps avancé à la main, aucune horloge réelle) :
  un texte rendu toutes les 2 s **arme jamais** (le défaut, tel qu'il se
  produisait) ; les mêmes textes filtrés ⇒ armement à **exactement 20 000 ms** ;
  une voix toutes les 3 s pendant 60 s ⇒ armement à **60 000 + 20 000** ; à
  19 999 ms rien, à 20 000 ms oui ;
- **le branchement** : `vocalNoteWord` consulte la règle, **une seule** relance et
  elle est dans la garde ; `vocalSetLevel` inchangé ; aucune condition sur le
  moteur ;
- **le réexamen** : même décision, même repère, sort si un compte tourne, n'écrit
  ni le minuteur ni le repère, une seule création d'intervalle, ouvert à
  l'entrée et annulé à la sortie du mode ;
- **ce qui ne change pas** : 20 000 ms unique, deux portes d'armement, aspect et
  réveil intacts.

### 3.3 Suite complète

`npm test` : **322 fichiers, 5940 tests, 0 échec** (référence avant ce lot :
5923 tests ; +17 = le nouveau verrou).

---

## 4. Ce que le propriétaire doit constater à l'écran

1. Options → Assistant → « Transcrire avec le service de voix local » **cochée**.
2. Entrer dans l'écran Vocal, parler : la phrase part comme avant, la réponse est
   lue comme avant.
3. Se taire : au bout de **20 secondes** (vraies), la ligne d'état passe à
   « Dites « <Nom> » pour me parler. » et le cercle se met en attente — **il ne
   reste plus à l'écoute indéfiniment**.
4. Prononcer le nom : la veille se lève **du premier coup**, le compte des 20 s
   repart, et l'écran redit qu'il écoute.
5. Décocher la case et refaire la même chose : **rien ne change** par rapport à
   avant.
