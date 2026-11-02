# RAPPORT — « je ne peux plus couper Pilot en parlant » (écran Vocal)

> **Mission** : diagnostic seul. Le propriétaire signale que la règle des 2 s
> (`1c92460`, « la demande part 2 s après le dernier mot transcrit ») fonctionne,
> **mais que parler par-dessus Pilot ne l'interrompt plus** alors que c'était
> possible avant.
>
> **Aucun fichier de code n'a été modifié. Aucun commit. Aucun test long, aucun
> build complet lancé.** Seuls des fichiers ont été lus (`read`/`grep`/`sed`).
> Fin de rapport : `DONE:`.

---

## 0. Résumé en six lignes

1. Pendant une lecture, **la dictée est bien FERMÉE** (règle 3 « Pilot parle »
   passe **avant** la règle 5 « déjà ouverte »). La piste n° 1 du brief est donc
   **écartée** au niveau de la décision — preuve au § 2.1.
2. Le seul endroit qui peut encore refuser la coupure est **la garde du micro** :
   `bargeInArmed(echoAnnule, residuel)` (`vocal-mic.js:255-261`).
3. Cette garde repose sur **une valeur lue UNE SEULE FOIS, à l'ouverture du
   micro** (`vocal-mic.js:644`, seule écriture de `echoAnnule`, déclaré l. 458) —
   et depuis `e49ee7d` cette ouverture a lieu **à l'entrée du mode**, avant toute
   lecture, avant la dictée, sans jamais être relue.
4. Si cette valeur unique vaut `false`, `bargeInArmed` renvoie `false`
   **inconditionnellement, pour toute la session** (`l. 257`, avant même de
   regarder la mesure) : Pilot lit jusqu'au bout, quelle que soit la voix, sans
   aucune erreur, sans aucune ligne de console.
5. Cause la plus probable : **cette preuve figée** (variante `false`, ou variante
   « inconnue » dont le plafond de résidu tombe à `0,01`, soit trois fois plus
   strict). Cause n° 2 : résidu d'écho mesuré `> 0,03` au début de chaque lecture.
   Les deux se lisent au **même endroit**, et le seul relevé qui les distingue
   (`bargeInReport()`) **n'est atteignable depuis nulle part** dans l'application.
6. La règle des 2 s **n'allonge pas** la fenêtre où la coupure est impossible
   (§ 2.4) : elle la **raccourcit** ; elle crée en revanche un tout petit terrain
   de jeu pendant `send()` (§ 3.3), sans rapport avec la lecture.

---

## 1. La chaîne réelle, avec preuves

### 1.1 Ce qui ouvre et ce qui ferme la dictée (le moteur de transcription)

| Élément | Où |
|---|---|
| Session de dictée (un seul `new SR()`) | `super-agent.js:3672` `startVoiceInput()`, `:3790` `voiceActive = true` |
| Fermeture | `super-agent.js:3607` `stopVoiceInput()` → `voiceActive = false` (l. 3609) |
| Ouverture automatique (350 ms au repos, 600 ms après une lecture) | `vocal-conversation.js:281-291` (règles 8), appliquées par `super-agent.js:4602` `vocalApplyConversationPlan()` |
| **Point d'application unique** de la décision | `super-agent.js:4620` `vocalSyncConversation()`, appelé en **fin** de `applyVocalState()` (`:4289`) |

`planVocalConversation()` traduit une décision en effets
(`vocal-conversation.js:332-352`) ; `super-agent.js:4604` exécute :

```js
if (plan.desarmer && voiceActive) stopVoiceInput();
```

### 1.2 Ce qui autorise la coupure

| Élément | Où |
|---|---|
| Micro de mesure (niveau + garde, **aucune transcription**) | `vocal-mic.js:413` `createVocalMic()`, ouvert par `super-agent.js:4177` `requestVocalMeasure()` |
| Une seule capture dans tout le fichier | `vocal-mic.js:620` `demanderFlux` (appelé l. 622 et l. 629) |
| « Pilot lit » → la garde s'arme | `super-agent.js:4296` `vocalSyncMicSpeaking()` → `vocal-mic.js:708` `setSpeaking()` |
| Mesure du niveau | `vocal-mic.js:552` `mesurerParole()` → `vocal-mic.js:556` `stepSpeechGate()` |
| **Décision de couper** | `vocal-mic.js:255` `bargeInArmed()` + `:335-372` (calibrage, 200 ms de voix continue) |
| Coupure effective | `super-agent.js:4662` `vocalBargeIn()` → `:4688` `stopReading()` (`read-aloud.js:626`) ou `stopSuperAgentTurn()` |

### 1.3 L'état des deux **pendant** que Pilot lit

```
lecture demarre (read-aloud.js: notify("speaking"))
  → window READ_ALOUD_STATE_EVENT            (read-aloud.js:757-766 + :814)
  → onVocalReadAloudState                     (super-agent.js:4918)
      vocalSpeaking = isReadAloudSpeaking(etat)          :4924
      vocalSyncMicSpeaking()  → setSpeaking(true)        :4930 → vocal-mic.js:708
      applyVocalState()                                  :4931
        → vocalSyncConversation()                        :4289 → :4620
            decideVocalDictation(pilotParle:true)
              = DISARM "pilot-parle"                     vocal-conversation.js:226
            plan.desarmer = dicteeOuverte                vocal-conversation.js:337
            → stopVoiceInput()  ⇒ voiceActive = false    super-agent.js:3604/3609
        ⇒ garde du micro : parlant = true, calibrage 600 ms puis surveillance
```

Autrement dit, pendant la lecture : **dictée fermée**, **`parlant === true`**,
**garde en surveillance**. Une seule chose peut encore empêcher la coupure :
`arme === false` dans `stepSpeechGate`.

---

## 2. Réponses précises

### 2.1 La dictée est-elle fermée pendant la lecture ? — **OUI**

`decideVocalDictation` teste **la règle 3 « Pilot lit » AVANT la règle 5 « déjà
ouverte »** (`vocal-conversation.js:226` puis `:236`) : une dictée ouverte au
moment où la lecture démarre produit `DISARM "pilot-parle"`, pas `HOLD
"deja-ouverte"`. `planVocalConversation` en tire `desarmer: ouverte`
(`:337`) et `vocalApplyConversationPlan` appelle `stopVoiceInput()`
(`super-agent.js:4604`), qui remet `voiceActive = false` (`:3609`).

**Conséquence** : la garde `if (voiceActive) return;` de `vocalBargeIn`
(`super-agent.js:4670`, ajoutée par `f81897e`) **ne s'applique pas pendant une
lecture**. C'est un filet pour les instants transitoires (dictée ouverte,
Pilot muet), pas un verrou de lecture. **Piste n° 1 du brief : écartée.**

Une réserve, vérifiée et écartée : si `voiceActive` restait bloqué à `true`
(`rec.onend` non délivré après le `rec.stop()` de l'envoi, § 3.3), **le premier
démarrage de lecture suivante le nettoie** (règle 3 → `desarmer` →
`stopVoiceInput`) : un `voiceActive` bloqué ne peut donc pas bloquer **une
lecture**. Le blocage ne durerait que jusqu'à la lecture suivante — or c'est
précisément pendant les lectures que le symptôme est observé.

### 2.2 La détection de coupure est-elle armée pendant la lecture ? — **PAS NÉCESSAIREMENT, et c'est là que tout se joue**

`stepSpeechGate` (`vocal-mic.js:288-373`), pendant une lecture :

1. **600 ms de calibrage** pendant lesquels **on ne coupe jamais**
   (`l. 341-347`) : le résidu est le **maximum** de niveau vu sur cette fenêtre.
2. Ensuite `arme = bargeInArmed(echoAnnule, residuel)` (`l. 333`), où :

```js
export function bargeInArmed(echoAnnule, residuel) {
  if (echoAnnule === false) return false;          // l. 257  ← AVANT toute mesure
  if (r > BARGE_IN_RESIDUAL_MAX) return false;     // l. 258  0,03
  if (echoAnnule === true) return true;            // l. 259
  return r <= BARGE_IN_RESIDUAL_UNPROVEN_MAX;      // l. 260  0,01
}
```

3. Si `!arme` → `motif: "echo-non-annule"` ou `"residuel-eleve"`
   (`l. 344-355`) et **plus aucune coupure jusqu'à la fin de la lecture**.

**Donc** : la détection n'est armée que si (a) le navigateur **prouve**
l'annulation d'écho **et** (b) le résidu mesuré reste `≤ 0,03` — ou, sans preuve,
`≤ 0,01`. Rien de tout cela n'est visible : `bargeInReport()`
(`vocal-mic.js:744`) **n'a aucun appelant dans l'application** (seuls des tests
l'appellent), et la ligne de console n'est écrite **qu'au moment où une coupure
part** (`super-agent.js:4678-4687`) — c'est-à-dire **jamais** dans le cas qui nous
occupe.

### 2.3 Les replis de voix et la voix locale changent-ils quelque chose ? — **NON pour l'autorisation, OUI pour le calibrage**

- `READ_ALOUD_SPEAKING_STATES` contient les **trois** états sonores
  (`read-aloud.js:142`) et `isReadAloudSpeaking` (`:154`) est la seule décision
  utilisée à l'écran (`super-agent.js:4924`) : `local-fallback` et
  `system-fallback` comptent comme « Pilot parle ». Le défaut d'avant `e49ee7d`
  (comparaison `=== "speaking"`, où un repli passait pour du silence) est corrigé.
  **Aucun repli n'ouvre donc la dictée pendant une lecture.**
- Ce que la voix locale change : `speak()` émet `notify("speaking")`
  **avant** la première syllabe (`read-aloud.js:814`, la synthèse est attendue
  plus loin). Le calibrage de 600 ms peut donc se dérouler **en silence** :
  `residuel ≈ 0` → `arme = true` avec le seul plancher `0,05`. Si la voix de
  Pilot revient ensuite au micro **au-dessus de 0,05**, la garde déclenche
  **sur Pilot lui-même** (il se coupe au début de sa lecture). L'effet est
  inverse du symptôme rapporté : **il ne l'explique pas**, mais il montre que la
  même fenêtre de calibrage est fragile dans les deux sens.
- Ce que la voix locale ne change pas : ni les seuils, ni la preuve d'écho, ni
  la garde `voiceActive`.

### 2.4 La règle des 2 s allonge-t-elle la fenêtre où la coupure est impossible ? — **NON, elle la RACCOURCIT**

La fenêtre où la coupure est impossible parce que **la dictée est ouverte**
(`super-agent.js:4670`) vaut « du dernier mot jusqu'à la fermeture de la
session » :

| | Fermeture de la session | Fenêtre |
|---|---|---|
| Avant `1c92460` | à la fin décidée par le moteur — le commit dit lui-même « plusieurs secondes après le dernier mot » | **2 à 8 s** |
| Après `1c92460` | `rec.stop()` à **exactement 2 s** (`vocal-conversation.js:135`, `super-agent.js:4429` `vocalCloseForSend()`) puis `onend` | **≈ 2 s + latence d'arrêt** |

**Conclusion** : la règle des 2 s **réduit** cette fenêtre. Elle ne peut pas être
la cause du symptôme observé pendant les lectures. En revanche elle **crée un
risque nouveau**, décrit au § 3.3, qui n'a rien à voir avec la lecture.

**La fenêtre qui reste réellement fermée pendant une lecture, elle, n'a pas
bougé** : 600 ms de calibrage obligatoires au début de **chaque** lecture
(`BARGE_IN_CALIBRATION_MS`, `vocal-mic.js:180`) — et, si la garde juge l'écho
non maîtrisé, **la lecture entière**.

---

## 3. Causes classées

### 3.1 C1 — **la preuve d'annulation d'écho est figée à l'ouverture du micro** (la plus probable)

**Le fait, prouvé** : `echoAnnule` est déclaré `vocal-mic.js:458`, **écrit une
seule fois** `l. 644` (dans `demander()`), lu `l. 333` et `l. 746`. Aucun autre
producteur, aucun rafraîchissement.

**Ce qui a changé** : `e49ee7d` (« la mesure d'abord, la dictée ensuite ») a
déplacé **le seul instant où cette preuve est prise** : avant, le micro
s'ouvrait au **premier geste** (`onVocalFirstGesture`, supprimé) ; depuis, il
s'ouvre **à l'entrée du mode** (`super-agent.js:4177` `requestVocalMeasure("entree")`,
règle 7d `mesure-fermee`). La preuve est donc désormais lue **avant toute
lecture, avant toute dictée, sans qu'aucun son n'ait jamais été joué** — et elle
vaut pour toute la session, alors que c'est précisément **pendant les lectures**
qu'elle décide.

**Pourquoi elle explique le symptôme exactement** :
- `echoAnnule === false` → `bargeInArmed` renvoie `false` **avant** de regarder
  quoi que ce soit (`l. 257`). Aucun niveau, aucune voix, aucun cri ne peut
  couper : Pilot lit jusqu'au bout.
- Aucune erreur, aucune ligne d'état, aucune trace console (la trace n'existe
  qu'en cas de coupure, `super-agent.js:4680`), et `bargeInReport()` est
  **inatteignable** : le propriétaire n'a aucun moyen de voir qu'il est dans ce
  cas. C'est exactement la forme du symptôme (« plus rien ne se passe »).
- Le seul remède actuel est de **sortir du mode et d'y rentrer** (nouvelle
  ouverture de micro = nouvelle lecture de la preuve) : c'est un comportement
  erratique typique d'une valeur figée.

**Comment cette valeur peut être `false`** : le repli de contraintes
(`vocal-mic.js:616-628`) redemande `{ audio: true }` après un
`OverconstrainedError`/`TypeError` ; `getSettings()` rapporte alors **ce que le
navigateur a décidé**, et le commentaire du fichier l'assume (« l'annulation
d'écho repasse alors à l'appréciation du navigateur »). Une seule lecture
malheureuse, à un instant qui n'est plus celui d'avant, suffit pour la session
entière.

### 3.2 C2 — **le résidu d'écho mesuré dépasse `0,03`** (deuxième)

`residuel` = maximum de niveau sur les 600 premières ms **de chaque** lecture
(`vocal-mic.js:341-347`), c'est-à-dire la voix de Pilot sortant des haut-parleurs
et revenant par le micro. `> 0,03` → `arme = false`, motif `"residuel-eleve"`.
Sans preuve d'annulation (`echoAnnule === null`), le plafond tombe même à `0,01`.

C'est **la garde anti-Larsen qui fonctionne comme prévu** : sur un poste où
l'écho n'est pas maîtrisé, la coupure est **volontairement** désactivée (c'est
écrit dans `spec_read_aloud.md` § 6 et `spec_modes_ecran_vocal.md`). Si c'est ce
cas, le code n'est pas en faute : il manque un casque, ou un volume de sortie
plus bas.

### 3.3 C3 — la dictée serait ouverte pendant la lecture — **écartée pour la lecture**, mais un vrai défaut existe ailleurs

Écartée comme cause du symptôme : § 2.1. En revanche, en instruisant cette piste
j'ai trouvé un **défaut réel, sans rapport avec la lecture** :

`send()` appelle `stopVoiceInput()` (`super-agent.js:5094`) **puis attend**
`await collectBubbleBadgeProjects(text)` (`:5113`) **avant** de poser
`isStreaming = true` (`:5133`). Pendant cette attente, `vocalConversationState()`
(`:4560`) rapporte `occupe: false`, `reflechit: false`, `pilotParle: false`,
`dicteeOuverte: false` — soit l'état exact du **repos**. Si un
`applyVocalState()` survient dans cette fenêtre (fin d'écoute, changement d'état
de lecture), `decideVocalDictation` rend **ARM** et programme un armement à
350 ms. Le plus souvent l'armement est annulé par `setReflecting(true)`
quelques millisecondes plus tard ; si la collecte des badges dépasse 350 ms, la
dictée **s'ouvre pour de bon**, puis `stopVoiceInput()` la referme aussitôt —
sur une session qui vient de démarrer, où `rec.stop()` peut lever
`InvalidStateError` (avalé, `super-agent.js:4439-4442`), en laissant le moteur
ouvert en arrière-plan (il ne réécrit rien : `onresult` sort immédiatement si
`!voiceActive`, `:3696`, donc **aucun envoi fantôme**).

Effet possible : une capture supplémentaire reste vivante **pendant** le tour
suivant. Ce n'est pas la cause du symptôme, mais c'est un voisin direct de C2
(deux clients sur le même périphérique) et cela mérite son propre lot.

### 3.4 Écartées formellement

| Hypothèse | Pourquoi elle est écartée |
|---|---|
| `AudioContext` suspendu (pas d'autoplay) → la mesure ne tourne pas | wry force `--autoplay-policy=no-user-gesture-required` (`src-tauri/vendor/wry/src/webview2/mod.rs:300-301`, `autoplay: true` par défaut), et `brancher()` appelle `contexte.resume()` si `state === "suspended"` (`vocal-mic.js:566`) |
| Les replis de voix ne comptent pas comme « Pilot parle » | Corrigé par `e49ee7d` : `isReadAloudSpeaking` couvre les trois états (`read-aloud.js:142-159`) |
| L'écran compare des chaînes ailleurs | Une seule décision, `super-agent.js:4924` |
| `stopReading()` n'arrête pas vraiment le son | `read-aloud.js:626` → `currentPlayback.stop()` → `synth.cancel()` + `extraStops` + `notify("stopped")` |
| La règle des 2 s allonge la fenêtre (§ 2.4) | Non : elle la raccourcit |

### 3.5 Ce qui distingue C1 de C2 — dans les fichiers, et sur la machine

Dans les fichiers : **le même point** (`bargeInArmed`, `vocal-mic.js:255`), mais
deux branches différentes — `l. 257` (preuve `false`, **aucune mesure
considérée**) contre `l. 258` (mesure `> 0,03`). Le motif rendu le dit
explicitement : `"echo-non-annule"` vs `"residuel-eleve"`
(`l. 344-355`, recopié à l'identique dans `bargeInReport`, `l. 748-751`).

Sur la machine : **`bargeInReport()` n'est appelable depuis nulle part** (zéro
appelant hors tests, `vocal-mic.js:744`). C'est une lacune à combler, sinon
« ce qui est documenté n'est pas vérifiable ».

---

## 4. Correction minimale proposée

### 4.1 Le geste

**Un seul fichier : `src/js/vocal-mic.js`. Quatre lignes, aucune valeur de seuil
touchée, aucune seconde capture.**

```js
  function setSpeaking(actif) {
    const etat = actif === true;
    if (etat === parlant) return;
    parlant = etat;
    if (etat) {
      // La preuve d'annulation d'echo est RELUE a chaque debut de lecture, sur la
      // piste DEJA ouverte (aucune seconde capture, aucun nouvel appel) : le
      // navigateur peut changer d'avis entre l'ouverture du micro et la lecture.
      // Une preuve figee a l'entree du mode interdisait la coupure pour toute la
      // session, sans trace.
      if (flux) echoAnnule = echoCancellationOf(flux);
    } else {
      garde = emptySpeechGate();
      dernierTemps = 0;
    }
  }
```

### 4.2 Pourquoi cet endroit

- C'est **le seul endroit** où l'on sait, avec certitude, qu'une lecture commence
  (`super-agent.js:4930` y appelle `setSpeaking(vocalSpeaking)`, seule voie).
- `flux` (`vocal-mic.js:441/655`) est **déjà ouvert** : `getSettings()` est
  synchrone et gratuit → **zéro nouvelle capture**, l'invariant « un seul
  `getUserMedia` » (verrouillé par test) est préservé.
- Cela ne change **pas** la politique : si le navigateur dit `false`, on ne coupe
  toujours pas. On remplace une valeur **périmée** par la valeur **du moment**.
- Le calcul de `arme` et des seuils n'est pas modifié d'une ligne.

### 4.3 Effet attendu, et sa limite (dite franchement)

- Si la preuve était `false` **par péremption** (repli de contraintes à l'entrée,
  périphérique changé, état transitoire) : la coupure **revient** dès la lecture
  suivante, sans quitter le mode.
- Si le navigateur dit `false` **parce que c'est vrai** (aucune annulation
  d'écho appliquée), la correction **ne rend pas** la coupure : la garde a
  raison, et les seules issues sont matérielles (casque) ou une décision du
  propriétaire sur les seuils — **hors de cette mission**.
- Dans ce dernier cas, la correction a quand même un effet décisif : la valeur
  devient **vraie au bon moment**, donc un relevé (`bargeInReport`) cesse de
  mentir rétroactivement.

### 4.4 Option (même fichier, 4 lignes de plus) — rendre la mesure lisible

Aujourd'hui `bargeInReport()` n'est lu par personne, et la console ne parle qu'en
cas de coupure. Sans relevé, **ni le propriétaire ni un test ne peuvent savoir
laquelle des deux branches de `bargeInArmed` s'applique**. Proposition, dans
`setSpeaking(false)` (fin de lecture, donc une ligne par lecture, pas une par
image) :

```js
      const r = bargeInReport();
      try { console.info("[vocal] garde : echo=" + r.echoCancellation +
        " residu=" + r.residuel + " seuil=" + r.seuil + " arme=" + r.arme +
        " motif=" + r.motif); } catch (_) {}
```

Ce n'est **pas** un affichage dans l'interface, ni un réglage, ni un bouton :
c'est la trace chiffrée que `spec_read_aloud.md` § 6 promet déjà (« lire
`bargeInReport()` / la ligne de console ») et qui n'existe pas. À trancher par le
propriétaire : elle est indispensable pour clore le diagnostic, mais elle ajoute
du bruit console.

### 4.5 Ce qui ne doit pas casser (vérifié ligne à ligne)

| Garde-fou | Pourquoi il est préservé |
|---|---|
| **Anti-Larsen** | `l. 257` (preuve `false` ⇒ jamais de coupure) et `l. 258` (résidu `> 0,03` ⇒ jamais de coupure) sont **inchangés** ; `vocalEchoThreshold` (`l. 240`) et `1,8` non touchés ; le verrou « une seule coupure par lecture » (`declenche`) non touché. Le test « 30 s de lecture avec résidu d'écho, aucune coupure » (`ecran-vocal-lot4a.test.js`) doit rester vert. |
| **Auto-dictée** | Aucun contact avec `vocal-conversation.js` : `decideVocalDictation` et `planVocalConversation` intacts, le point d'application unique (`super-agent.js:4620`) intact. |
| **Envoi à 2 s** | Aucun contact avec `decideVocalSilenceSend` (`vocal-conversation.js:377`) ni `vocalCloseForSend` (`super-agent.js:4429`). |
| **Les trois sorties du mode** | `fermer()` (`vocal-mic.js:495`) et `exitVocal` (`super-agent.js:4797`) intacts ; la relecture ne se fait que si `flux` existe, donc jamais après libération. |
| **Capture unique** | Aucun appel ajouté à `demanderFlux` / `getUserMedia` : on relit `getSettings()` sur la piste existante. L'invariant verrouillé par test (`vocal-mic.js:620`) tient. |

---

## 5. Vérification après correction

### 5.1 Ce qu'un test doit prouver (et rien de plus)

1. **Relecture par lecture** : `setSpeaking(true)` appelle `echoCancellationOf`
   sur le flux existant — deux lectures successives ⇒ deux lectures de preuve
   (compteur sur une fausse piste).
2. **Le renversement** : piste qui déclare `false` à l'ouverture puis `true` à la
   deuxième lecture ⇒ `bargeInReport().echoCancellation === true` et `arme`
   passe à `true` **à la lecture suivante**, sans sortir du mode.
3. **Aucune seconde capture** : `getUserMedia` appelé **une seule fois** dans tout
   le scénario ; `demander()` non rappelé.
4. **Les négatifs de l'anti-Larsen restent verts** : résidu `0,06` + preuve
   `false` ⇒ `arme === false` et aucune coupure sur 30 s ; preuve `null` +
   résidu `0,02` ⇒ `arme === false` (plafond `0,01`).
5. **Fin de lecture** : `setSpeaking(false)` remet la garde à zéro
   (`emptySpeechGate`), donc le résidu d'une lecture ne vaut pas pour la
   suivante.
6. **Non-régression du mode** : la dictée reste fermée pendant une lecture
   (`desarmer` → `stopVoiceInput`), l'armement après lecture se fait toujours à
   `VOCAL_ARM_AFTER_READ_MS`, et les trois sorties nettoient les deux minuteurs.

Recommandation : ces assertions dans le fichier de tests existant
`src/js/ecran-vocal-lot4a.test.js` (section « l'annulation d'écho est demandée
puis relue ») plutôt qu'un nouveau fichier — c'est le même sujet.

### 5.2 Ce que le propriétaire doit pouvoir faire, au vrai micro

Sans code, **trois gestes**, dans cet ordre :

1. **Le test discriminant (à faire AVANT toute correction, 20 secondes)** :
   entrer dans le mode Vocal, poser **une seule question au clavier** (ne jamais
   toucher 🎙️, ne rien dicter), et **parler par-dessus Pilot** pendant qu'il lit.
   - **Il ne se tait pas** ⇒ la garde est désarmée ⇒ **C1/C2** (écho). Le
     diagnostic est clos côté « écho », la dictée est innocentée.
   - **Il se tait** ⇒ la garde est armée et le problème vient du côté dictée
     (`voiceActive`), c'est-à-dire de la règle des 2 s ⇒ instruire C3.
2. **La répétition après une dictée** : même question, mais **dictée à la voix**
   cette fois, puis parler par-dessus la lecture de la réponse.
   - Comportement **différent** du test 1 ⇒ c'est bien le chemin de la dictée.
   - Comportement **identique** ⇒ c'est bien l'écho.
3. **Après correction** : demander une réponse, laisser Pilot lire, dire une
   phrase courte par-dessus ⇒ Pilot se tait **entre deux phrases** ; répéter
   trois fois de suite (aucune reprise automatique de la lecture, une seule
   coupure par lecture) ; refaire l'essai avec la voix locale (`Paramètres →
   Assistant → Lecture des réponses`) **et** avec un repli de voix, puis vérifier
   avec la ligne de console (§ 4.4) que `arme=true` et `motif="a-l-écoute"`
   **pendant** la lecture.

---

## 6. Ce que ce rapport ne prouve pas

- **La valeur réelle de `echoAnnule` et du résidu sur la machine du
  propriétaire** : elle n'est pas observable aujourd'hui (`bargeInReport()`
  inatteignable, aucune trace hors coupure). Le § 5.2 est le seul moyen de la
  lire. Tant qu'elle n'est pas relevée, **C1 et C2 ne peuvent pas être
  départagées autrement que par probabilité**.
- **L'hypothèse physique** (volume de sortie, position du micro, périphérique
  Bluetooth sans AEC) : elle décide du résultat et n'est pas dans les fichiers.
- Aucun test n'a été lancé, aucun build : les invariants cités (un seul
  `getUserMedia`, un seul `point d'application`) sont **lus** dans le source et
  verrouillés par des tests existants, pas ré-exécutés ici.

---

VERDICT : la dictée est **fermée** pendant la lecture et la règle des 2 s
**raccourcit** la fenêtre où la coupure est impossible — la piste n° 1 du brief
est écartée avec preuves (`vocal-conversation.js:226` avant `:236`,
`planVocalConversation:337`, `super-agent.js:4604/3609`). Le refus ne peut venir
que d'un seul endroit, `bargeInArmed` (`vocal-mic.js:255-261`), dont la première
condition repose sur une preuve d'annulation d'écho **lue une seule fois à
l'ouverture du micro** (`:644`, seule écriture) et **jamais relue** — depuis
`e49ee7d` cette ouverture a lieu à l'entrée du mode, avant toute lecture. Cause la
plus probable : **cette preuve figée** (`false` ⇒ coupure interdite pour toute la
session, sans aucune trace) ; deuxième : **résidu d'écho `> 0,03`** mesuré au
début de chaque lecture. Correction minimale : **relire la preuve à chaque début
de lecture, sur la piste déjà ouverte** (4 lignes dans `vocal-mic.js`, aucun
seuil touché, aucune seconde capture, anti-Larsen intact) ; à compléter par un
relevé chiffré, faute de quoi le cas restera invérifiable. Aucun fichier de code
modifié, aucun commit.

DONE: diagnostic de la coupure vocale perdue — dictée fermée pendant la lecture (piste 1 écartée, preuves file:line), refus situé à `bargeInArmed` (`vocal-mic.js:255`) dont la preuve d'écho est figée à l'ouverture du micro (`:644`, seule écriture, déplacée à l'entrée du mode par `e49ee7d`) ; cause la plus probable = preuve figée, seconde = résidu > 0,03 ; la règle des 2 s raccourcit la fenêtre et n'est pas coupable ; correction minimale proposée = relire la preuve à chaque début de lecture (4 lignes, un fichier, seuils intacts) ; rapport écrit dans `RAPPORT-diagnostic-coupure-vocale-perdue.md`, aucun code modifié, aucun commit.
