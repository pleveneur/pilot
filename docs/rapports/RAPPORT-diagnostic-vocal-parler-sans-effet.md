# Diagnostic — mode Vocal : « parler ne déclenche rien »

> Mission de **diagnostic seul**. Aucun fichier de code, aucune spec, aucun test
> n'a été modifié. Ce rapport est le **seul** fichier écrit.
> Objet unique traité : *pourquoi une phrase prononcée ne produit aucune demande ?*
> La détection de la voix **n'est pas** mise en cause (elle est mesurée et elle
> fonctionne — voir §0).

---

## 0. Ce qui est déjà établi par l'observation (à ne pas ré-explorer)

| Observation du propriétaire | Conclusion | Preuve code |
|---|---|---|
| La ligne d'état passe de « Je vous écoute. » à « Je vous écoute… » puis revient au repos | le **niveau** du micro est mesuré et l'état suit | `src/js/super-agent.js:3921` (`vocalSetLevel`) → `vocalVoiceStep` (`:557`), seuils `VOCAL_VOICE_ON = 0.06` / `OFF = 0.03` (`:536`) |
| Taper à la main fonctionne (envoi, réflexion, réponse, lecture à voix haute) | le **chemin d'envoi** et la lecture ne sont pas en cause | `send()` `src/js/super-agent.js:4439`; lecture auto `autoReadVocalReply` `:4276` |
| La permission micro est demandée au 1er geste et le micro s'ouvre | `getUserMedia` fonctionne dans le WebView desktop | `src/js/vocal-mic.js:606` (`getUserMedia`), demande `src/js/super-agent.js:3981` (`onVocalFirstGesture`) → `:3990` (`vocalMic.demander()`) |

Autrement dit : **le micro de l'écran Vocal fonctionne, mais il n'est pas câblé à
la transcription.** C'est exactement la question posée.

---

## 1. Causes possibles, de la plus probable à la moins probable

### Cause A — **CERTAINE (structurelle)** : le micro de l'écran Vocal ne transcrit rien, il ne fait que mesurer un niveau et décider d'une coupure

C'est la cause principale, et elle explique à elle seule 100 % du symptôme.

**Preuve 1 — le module du micro de l'écran Vocal dit lui-même qu'il ne reconnaît pas la parole.**
`src/js/vocal-mic.js:12` :

```
//   - aucune reconnaissance de parole (la dictee garde son propre moteur, dans
//     la barre de saisie) ;
```

**Preuve 2 — au repos, la garde de ce module ne signale RIEN.**
`src/js/vocal-mic.js:296-299` (`stepSpeechGate`) :

```js
// Hors lecture ET hors reflexion : la garde dort, et rien de ce qu'elle a
// mesure ne survit.
if (c.parlant !== true && c.reflechi !== true) {
  return { etat: emptySpeechGate(), declenche: false, arme: false, seuil: vocalEchoThreshold(0), motif: "hors-lecture" };
}
```

et `src/js/vocal-mic.js:538-553` (`mesurerParole`) : `if (!pas.declenche) return;`
→ `surParole(...)` **n'est appelé que** si la garde se déclenche.

**Preuve 3 — le seul consommateur de ce signal est la COUPURE, jamais une demande.**
`src/js/super-agent.js:4169-4175` (branchement) :

```js
vocalMic = createVocalMic({
  onLevel: vocalSetLevel,        // → longueur du trait + ligne d'état
  onListening: vocalSetListening, // → état « écoute »
  onFailure: vocalMicFailure,
  onSpeechStart: vocalBargeIn,   // ← et c'est TOUT ce que produit une voix
});
```

`src/js/super-agent.js:4095-4101` (`vocalBargeIn`) :

```js
const cible = vocalInterruptTarget({ speaking: vocalSpeaking, reflecting: reflectingActive });
if (!cible) return;              // ← au repos : rien du tout, sortie immédiate
...
if (cible === "lecture") stopReading();
else void stopSuperAgentTurn();
```

**Conclusion A :** au repos, une phrase prononcée ne produit que deux effets —
la longueur du trait et le libellé de la ligne d'état. Ni texte, ni envoi. Il
faudrait **cliquer** sur le bouton 🎙️ de la barre de saisie pour dicter ; parler
seul ne démarre **aucune** session de dictée.

**Preuve 4 — la promesse affichée est plus large que le mécanisme.**
`src/js/super-agent.js:4206` pose `inputEl.placeholder = "Écrivez, ou parlez."`
alors que « parler » n'a aucun chemin vers l'envoi. La spec le dit d'ailleurs
noir sur blanc, `spec_modes_ecran_vocal.md:240-241` :

> **Votre parole n'est pas perdue** : le curseur revient dans la zone de saisie,
> prêt à recevoir la dictée ou votre correction. Pilot **ne relance pas** l'agent
> avec ce qui vient d'être dit (**ce n'est pas fait**, §9).

Le mode Vocal est donc, en l'état, **une interface qui écoute et anime, mais qui
ne sait pas encore transmettre la parole**. C'est le cas annoncé comme « le plus
probable » dans la mission, et c'est celui qui est vrai.

---

### Cause B — **PROBABLE (et aggravante)** : quand quelque chose échoue, l'écran ne peut rien vous dire — les messages d'erreur sont écrits dans une zone rendue invisible

Ce n'est pas la cause du « rien ne se passe », mais c'est la raison pour laquelle
**rien ne s'explique** : si l'utilisateur clique 🎙️ en mode Vocal et que la
dictée échoue (permission, service), le message est ajouté à la conversation…

`src/js/super-agent.js:3585-3590` :

```js
if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
  appendSystemMessage(messagesEl, "🎙️ Micro indisponible (" + ev.error + ")…");
} else if (ev.error !== "no-speech" && ev.error !== "aborted") {
  appendSystemMessage(messagesEl, "🎙️ Erreur de dictée : " + ev.error);
}
```

…or `messagesEl` est **invisible** tant que l'écran Vocal est actif.
`src/css/style.css:11560-11562` :

```css
body.pilot-vocal-active .agent-chat-messages {
  visibility: hidden;
}
```

**Effet :** en mode Vocal, **toute** dictée qui échoue échoue **en silence**
(erreur, refus, `no-speech`…), et l'utilisateur n'a aucun retour. C'est un défaut
de diagnostic à corriger en même temps que la cause A, sinon la prochaine panne
sera de nouveau muette.

---

### Cause C — **POSSIBLE (à vérifier sur le poste)** : deux captures du micro en même temps

Le mode Vocal tient **déjà** un flux `getUserMedia` (`src/js/vocal-mic.js:606`,
ouvert au premier geste, `src/js/super-agent.js:3990`). Lancer la dictée
ouvre **un second** accès micro, par un autre moteur :
`src/js/super-agent.js:3541` → `const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const rec = new SR();`.

Sur certains pilotes (micro exclusif, « autoriser une seule application »), cette
seconde capture peut échouer en `audio-capture` / `NotReadableError`. Le module
de mesure traite d'ailleurs explicitement ce cas comme une panne
(`src/js/vocal-mic.js:55` `MIC_OCCUPE = "Le micro est occupé par une autre application."`).
À noter : **l'inverse** est le cas le plus fréquent (c'est le micro de mesure qui
se plaindrait si la dictée tenait le périphérique).

C'est vérifiable en 5 secondes : cliquer 🎙️ en mode Vocal. Si le bouton devient
rouge (`.agent-mic-btn.rec`, `src/css/style.css:5438`) et que du texte arrive dans
la zone → la dictée fonctionne, la cause A est confirmée. Si le bouton devient
rouge puis repasse au repos sans texte → cause C (ou B).

---

### Cause D — **ÉCARTÉE** : « l'écran Vocal a été oublié dans la liste de l'envoi automatique de fin de dictée »

La décision unique d'envoi automatique existe bien (`src/js/voice-auto-send.js:74`,
`applyVoiceEnd`), branchée dans l'onglet agent π (`src/js/agent-pi.js:1016`),
l'Assistant (`src/js/super-agent.js:3600`) et le web distant
(`web/js/app.js:18`, servi par `src-tauri/src/web_server.rs:57`).

**Mais il n'y a rien à oublier :** l'écran Vocal **n'est pas un quatrième
moteur**, c'est **la même barre de saisie**, déplacée.

- déplacement : `src/js/super-agent.js:4143-4146` (`zone.appendChild(inputBar)` — même nœud) ;
- le bouton micro part avec elle : `src/js/super-agent.js:3074` (`.agent-mic-btn` dans `inputBar`), verrouillé par `src/js/ecran-vocal-lot2.test.js:340-346` (« la barre de saisie emportée garde son micro de dictée et son envoi ») ;
- son écouteur de clic reste attaché, puisqu'aucun nœud n'est recréé : `src/js/super-agent.js:4558` (`inputBar.querySelector('[data-action="voice"]').addEventListener("click", toggleVoiceInput)`), plus la voie déléguée `:4431` ;
- la fin de dictée passe donc par `applyVoiceEnd` **déjà existant** (`:3600`) → `send` (`:3607`).

Donc : dès que la dictée **est démarrée**, l'écriture dans la zone et l'envoi
automatique fonctionnent déjà en mode Vocal. Le trou est **en amont** : personne
ne **démarre** la dictée quand on parle.

---

## 2. Cause principale tranchée

> **Cause A.** Le mode Vocal n'a **aucun chemin** de la parole vers une demande :
> son micro (lot 3/4) mesure un niveau et décide d'une coupure, jamais d'une
> transcription. La dictée n'existe dans cet écran que par le **bouton 🎙️ hérité**
> de la barre de saisie déplacée, et il faut **cliquer** dessus ; parler n'ouvre
> aucune session de reconnaissance.

Aggravée par la **cause B** : tout échec de cette dictée est écrit dans une zone
invisible (`visibility: hidden`), donc l'écran ne peut ni réussir seul… ni se
plaindre.

---

## 3. Correction minimale proposée (à ne pas exécuter dans cette mission)

### 3.1 Ce qu'il faut brancher

Un seul branchement, dans `src/js/super-agent.js`, en réutilisant l'existant :

1. **Démarrer la dictée existante depuis la détection de voix déjà en place.**
   Dans `vocalSetLevel` (`:3921`), au moment où l'hystérésis existante bascule
   `capte` de `false` à `true` (`vocalVoiceStep`, `:557` — rien de nouveau à
   inventer), et **seulement** si l'écran est au repos
   (`!vocalSpeaking && !reflectingActive`), et **seulement** si aucune session de
   dictée n'est active : appeler **`toggleVoiceInput()`** (`:3537`), le chemin qui
   existe déjà. C'est lui qui ouvre `SpeechRecognition`, remplit la zone, et
   laisse `applyVoiceEnd` (`:3600`) envoyer une seule fois par `send()` (`:3607`).

2. **Rendre les erreurs visibles en mode Vocal.** Les messages `🎙️ …` de
   `:3585-3590` doivent atteindre l'utilisateur : soit la **ligne d'état unique**
   (`.vocal-status`, via le canal `vocalMicFerme`/`applyVocalState` déjà utilisé
   pour « Le micro est fermé. », `:4025` et `:4046-4049`), soit un `toast`. **Ne pas** lever
   `visibility: hidden` : cette règle est un principe du mode (« écran nu ») et
   un test le verrouille.

3. **Ne pas armer la coupure pendant une dictée.** Pour éviter qu'une phrase
   encore en cours de dictée ne coupe l'agent qui vient de démarrer après l'envoi
   automatique : neutraliser le déclenchement de `vocalBargeIn` tant que
   `voiceActive === true` (une garde d'une ligne dans `vocalBargeIn`, `:4095`).

### 3.2 Ce qu'il ne faut surtout PAS créer

| Interdit | Pourquoi |
|---|---|
| un second moteur de dictée (`SpeechRecognition` ailleurs que dans `toggleVoiceInput`) | il n'en existe qu'un, dans la barre de saisie ; la barre de l'écran Vocal **est** cette barre (`:4143-4146`) |
| un second envoi / un second `applyVoiceEnd` | la décision unique est `voice-auto-send.js:74`, appelée à `:3600` ; un doublon produirait deux messages par dictée |
| une API micro dans `super-agent.js` (`getUserMedia`, `AudioContext`, `AnalyserNode`, `mediaDevices`) | **verrouillé** par `src/js/ecran-vocal-lot2.test.js:344`. La capture reste dans `vocal-mic.js`, la décision de couper aussi (`:296-330`) |
| une modification de `vocal-mic.js` pour signaler la voix au repos | ce serait changer la garde 4a/4b et les seuils, couverts par `ecran-vocal-lot3.test.js` / `lot4a.test.js` ; la bascule `capte` de `vocalSetLevel` **existe déjà** et suffit |
| un second bouton, un réglage, un nouvel écran | la mission est étroite : un branchement, pas une refonte |

### 3.3 Estimation du travail

**Une mission courte** (1 modification de fichier + 2 petites gardes), pas
plusieurs étapes — à une réserve près :

- **court** pour les points 3.1.1 (démarrer la dictée sur la bascule `capte`) et
  3.1.3 (une garde dans `vocalBargeIn`) : quelques lignes, aucun nouveau module,
  aucun test existant ne bouge ;
- **un cran plus long** pour le point 3.1.2 (erreurs visibles) : il faut choisir
  le canal (ligne d'état de l'écran = cohérent avec `vocalMicFerme`, mais
  l'écran doit alors oublier le message à la dictée suivante) ;
- **une étape de vérification au vrai micro** est indispensable (cause C) : si le
  second accès micro échoue sur le poste, il faudra **décider** entre garder deux
  captures (dictée + mesure) ou suspendre la mesure du niveau pendant la dictée
  (l'état « écoute » resterait allumé, la longueur du trait serait figée). Cette
  décision ne peut pas être prise sans le poste.

---

## 4. Risques de régression à surveiller

| Risque | Où | Pourquoi / parade |
|---|---|---|
| **Double envoi** d'une même phrase | `voice-auto-send.js:74` + `send()` `:4439` | `applyVoiceEnd` garantit un seul envoi **par session** ; la nouvelle voie ne doit jamais démarrer une **seconde** session par-dessus une active → garde `if (voiceActive) return` (déjà en tête de `toggleVoiceInput`, `:3541`) |
| **Pilot se dicte lui-même** | lecture à voix haute + micro ouvert | ne démarrer la dictée **que** hors `vocalSpeaking` et hors `reflectingActive` ; sinon la voix de synthèse (haut-parleurs) devient une demande |
| **La parole coupe l'agent** qui vient d'être lancé | `vocalBargeIn` `:4095`, garde 4b `vocal-mic.js:302-325` | point 3.1.3 : pas de coupure tant que la dictée est en cours, et une seule coupure par prise de parole (`declenche` déjà posé) |
| **Ligne d'état qui clignote** | `vocalSetLevel` `:3921` → `applyVocalState` `:4025` | l'état n'est réappliqué que quand la **décision change** (`if (pas.capte !== vocalMicCapte)`) : le branchement doit se faire sur cette bascule, pas à chaque image |
| **L'utilisateur reprend la main** (il tape pendant la dictée) | `voiceUserTookOver` `:3509`-`:3512`, `:3592` | règle déjà tenue : sa saisie prime, rien ne part ; ne pas la contourner depuis la nouvelle voie |
| **Message d'erreur fantôme** après la sortie du mode Vocal | `applyVocalState` `:4046` | si l'on confie les erreurs à la ligne d'état, elle doit être **effacée** à la sortie (`exitVocal`, `:4216`) et à chaque nouvelle dictée |
| **Verrou « écran nu »** | `src/js/ecran-vocal-nu.test.js`, `ecran-vocal-lot2.test.js:344` | toute la correction doit rester dans `super-agent.js` + au plus une ligne de garde, sans API micro ni affichage de conversation |

---

## 5. Vérification en 30 secondes, sans rien modifier

1. Ouvrir l'écran Vocal, parler : la ligne passe en « Je vous écoute… » →
   **confirme que le micro de mesure fonctionne** (cause A hors de cause pour la
   détection).
2. Cliquer le **bouton 🎙️** de la barre de saisie (il est là, à côté de ➤, hérité
   de la barre déplacée).
   - il devient **rouge** et le texte apparaît → la dictée **et** l'envoi
     automatique fonctionnent déjà ici ⇒ **cause A confirmée**, la correction est
     bien « démarrer la dictée quand on parle » ;
   - il devient rouge puis retombe **sans texte**, ou il **n'existe pas**
     (`micBtn.style.display = "none"` si `SpeechRecognition` est absent,
     `src/js/super-agent.js:3497`) ⇒ ajouter la **cause B/C** au diagnostic
     (erreur invisible / second accès micro indisponible).
3. En cas de doute sur la coupure : `vocalMic.bargeInReport()` rend
   `motif`, `arme`, `residuel`, `seuil` (lecture des chiffres réels,
   `src/js/vocal-mic.js:735-763`) — utile si l'on veut prouver qu'aucune coupure
   ne part toute seule.

---

## 6. Résumé en une phrase

Le son est bien capté, l'écran est bien animé, mais **la parole n'est reliée à
rien** : le micro du mode Vocal ne sait que mesurer et couper (`vocal-mic.js:12`,
`:296-299`), et l'unique chemin qui transforme la voix en demande — la dictée de
la barre de saisie — n'est ouvert que par un **clic** sur 🎙️
(`super-agent.js:4558`). La correction minimale est un **branchement** sur la
bascule de détection déjà existante (`vocalSetLevel`), avec les erreurs rendues
visibles, et **zéro** moteur, envoi ou seuil nouveau.
