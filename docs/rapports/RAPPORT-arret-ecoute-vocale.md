# Rapport — « arrête d'écouter » arrête vraiment l'écoute (écran Vocal)

Date : 16-11-2026
Projet : Pilot, écran Vocal.
Fiche d'origine : `docs/rapports/FICHE-a-ajuster-arret-ecoute-vocale.md` (10-11-2026).

---

## 0. La demande, et ce qui est livré

Constat d'usage du propriétaire : **prononcer une phrase d'arrêt ne coupait rien**.
L'écran continuait de dire « Je vous écoute… » et la dictée restait ouverte comme si
la phrase n'avait rien déclenché.

Cinq décisions du propriétaire (elles priment sur la fiche ; **le point 4 de la fiche
est ABANDONNÉ**) :

| # | Décision | État |
|---|---|---|
| 1 | L'effet de l'arrêt est **exactement** celui de la veille automatique de 20 s (un seul état, jamais deux) | livré |
| 2 | Le micro **n'est pas fermé** : on reste à l'écoute du nom / du personnage / du mot de réveil, et le nom réveille | livré |
| 3 | C'est un **OUTIL** que l'assistant appelle ; la phrase part comme une demande | livré |
| 4 | **Aucune lecture à voix haute** pour cet ordre | livré |
| 5 | **Aucun** réglage, case ni bouton ajouté à l'écran | livré |

---

## 1. Diagnostic — deux causes, et aucune n'était la reconnaissance de la phrase

Le constat de la fiche était un **constat d'usage**, pas un diagnostic. La lecture du
code en donne deux, indépendantes :

### 1.1 L'écran mentait : la ligne d'état court-circuitait la veille

`vocalStatusLine()` (dans `super-agent.js`) testait l'état **animé** avant la branche de
la veille :

```js
if (state !== "idle") return vocalStatusText(state);   // ← « Je vous écoute… »
...
if (vocalVeilleArmee === true) { /* la phrase de la veille */ }
```

Tant que la mesure du micro captait quelque chose, l'état valait `listening` et la
ligne rendait « Je vous écoute… ». **La branche de la veille existait donc mais
n'était jamais atteinte.** C'est exactement le symptôme décrit par le propriétaire, et
il valait déjà pour la veille automatique de 20 s — pas seulement pour l'ordre parlé.

### 1.2 La phrase était avalée : personne ne recevait l'ordre

La formule était bien reconnue (`decideVocalStopListening` → `VOCAL_STOP_ARRETER`), la
veille était bien posée (`vocalEnterVeille("commande")`), puis la phrase tombait dans la
**garde du nom** (`decideVocalNameGate`, `ecouteLibre: false`) qui la **jetait** : rien
n'était écrit, rien n'était envoyé. L'utilisateur n'avait donc aucun retour, et aucun
outil ne recevait l'ordre.

**Ce qui n'était pas en cause** : la reconnaissance (la formule était reconnue), le
micro (jamais fermé, c'est voulu), le minuteur de 20 s.

---

## 2. Ce qui a changé

### 2.1 `src/js/vocal-nom-garde.js` — les décisions pures

- **`vocalEtatAffiche(etats)`** (nouvelle, pure) : `listening` devient `idle` quand la
  veille est armée ; `speaking` et `thinking` sont rendus **intacts** ; hors veille,
  l'état est rendu **à l'identique**. C'est **le seul endroit** qui décide que l'écran ne
  dit plus « Je vous écoute ». Comme la veille a **une seule** affectation
  (`vocalVeilleArmee = true`), les deux entrées — 20 s de silence et ordre parlé — ont
  le même affichage **par construction**.
- **`VOCAL_STOP_FORMULAS`** élargie de 12 à **20** entrées (une **seule** déclaration) :
  `arrête d'écouter`, `arrête l'écoute`, `arrêtez d'écouter`, `arrêtez l'écoute`,
  `arrêter d'écouter`, `arrête d'écouter s'il te plaît`, `arrête d'écouter s'il vous
  plaît`, `stoppe l'écoute`, `stop l'écoute`, `cesse d'écouter`, `n'écoute plus`,
  `ne m'écoute plus`, `ne m'écoutez plus`, `tais-toi`, `taisez-vous`, `silence`,
  `au repos`, `tu peux te reposer`, `mets-toi en veille`, `mode veille`.
- **`stopFormulaKey(texte)`** (nouvelle, pure) + `sansPolitesseFinale` : la comparaison
  absorbait déjà casse, accents, ponctuation et espaces ; elle absorbe maintenant
  **trois** écarts de transcription — et **rien de plus** :
  1. les **frontières de mots** (« arrête découter », « arrêtedécouter ») ;
  2. la **finale du verbe** `-er` / `-ez` / `-es` ramenée à `-e` (« arrêtez d'écouter »,
     « ne m'écouter plus ») ;
  3. une **politesse finale** retirée (« s'il te plaît », « s'il vous plaît », « stp »,
     « svp », « merci », « merci beaucoup »), une ou plusieurs fois, sans jamais retirer
     le dernier mot utile (« merci » seul n'est pas une formule).
- **Inchangé** : aucun mot supplémentaire n'est toléré. « arrête d'écouter la radio »,
  « arrête d'écouter la radio s'il te plaît », « silence, le dossier est vide »,
  « écoute, j'ai une idée » ne coupent **rien**. La garde du nom, la phrase de la
  veille et `VOCAL_ECOUTE_LIBRE_MS = 20000` n'ont pas bougé.

### 2.2 `src/js/super-agent.js` — l'écran

- **`vocalStatusLine`** applique `vocalEtatAffiche` **après** le test de la file de
  demandes (l'accusé reste prioritaire) et **avant** `if (state !== "idle")` : la branche
  de la veille est enfin atteinte, la ligne rend « Je me mets en veille — dites « <Nom> »
  pour me parler. ».
- **`applyVocalState`** : la **classe CSS** suit la **même** décision (`affiche`) — le
  rond ne se croit plus à l'écoute en veille. Un seul état, texte **et** apparence.
- **`oreilleArmee`** : en veille, la raison `deja-ouverte` n'est plus comptée comme
  oreille armée — « J'écoute avec le service local » est une phrase d'écoute et ne peut
  pas survivre à la veille (sinon deux phrases contradictoires).
- **`vocalRendreOrdreArret(phrase)`** (nouvelle) : la phrase part par le chemin d'envoi
  **unique** (`send` → file d'attente, refus du moteur, vidage de la zone : identiques),
  avec **deux** gardes seulement (une question en attente, un moteur qui ne peut pas
  démarrer). Appelée par les **deux** branches qui reconnaissent l'ordre (résultats du
  moteur et fin d'écoute) ; une seule voie, jamais de double envoi (la seconde
  reconnaissance répond `deja-en-veille`).
- **`vocalCoupeSilencieuse`** : posé **avant** l'envoi, **consommé** par
  `autoReadVocalReply` (le seul lecteur automatique de l'écran). L'ordre n'est jamais lu ;
  la réponse reste écrite, avec son bouton « Écouter ».
- **`vocalStopListeningFromAssistant(origine)`** (nouvelle) : **point d'application
  unique** de l'outil. `vocalEnterVeille(origine)` + `vocalCoupeSilencieuse = true` +
  `applyVocalState()`, et la phrase rendue est **relue** à `vocalStatusLine` (jamais
  recomposée). Hors de l'écran Vocal : `{ ok: false }`, rien n'est inventé.
- **Pont window** : `window._pilotVocalStopListening`, posé à l'ouverture de l'onglet,
  remis à `null` à la fermeture (même modèle que `window._pilotTabs`).
- **`handleSuperAgentAction`** : nouvelle branche `stop_listening` — appelle le pont,
  écrit une ligne dans la conversation, répond `extension_ui_response` (`confirmed`).

### 2.3 `src-tauri/extensions/pilot-assistant-actions.ts` — l'outil

Outil `stop_listening` (`label`, `description`, `promptSnippet`, cinq
`promptGuidelines`, `parameters` optionnel `reason`, `executionMode: "sequential"`),
branché sur la **même** sentinelle que les autres actions
(`PILOT_ASSISTANT_ACTION::` + JSON), par `ctx.ui.confirm`. L'outil **ne décide rien** : il
demande. Il n'ouvre aucun réglage, ne ferme rien, n'écrit aucun fichier. Aucune
contrepartie Rust n'est nécessaire (`agent_service.rs` embarque le `.ts` par
`include_str!`, comme pour `remove_queued_mission`).

### 2.4 Documentation

- `docs/rapports/FICHE-a-ajuster-arret-ecoute-vocale.md` : **encart d'ajustements du
  16-11-2026** en tête (le corps d'origine est conservé, avec les quatre points
  contredits barrés et motivés) — **point 4 ABANDONNÉ**, « micro fermé » **corrigé**,
  « ne pas laisser le micro ouvert » **inversé**, § 5 réécrite, § 8 (points non établis)
  désormais tous tranchés.
- `spec_modes_ecran_vocal.md` § 6quater.2 : troisième défaut corrigé (les deux causes),
  liste des 20 formules, `vocalEtatAffiche`, outil, coupe silencieuse, verrous ;
  bloc `<!-- HELP:vocal-veille -->` mis à jour puis `npm run build:handbook`.
- `spec_super_agent.md` : section technique « arrêter l'écoute du mode Vocal (outil
  `stop_listening`) ».

---

## 3. Preuves — ce qui est prouvé par test

`src/js/arret-ecoute-vocale.test.js`, **22 cas**, tous verts.

| Exigence de la mission | Test | Ce qu'il mesure |
|---|---|---|
| la dictée n'est plus armée | § 2 (b) `la dictée est DÉSARMÉE au sens où rien ne peut plus partir` | la garde **jette** une phrase ordinaire après l'ordre (`nom-absent`) et la **laissait passer** avant (même phrase, `ecouteLibre: true`) |
| idem, sur le module réel | § 2 (b bis) | `decideVocalDictation` réarme une session fermée ⇒ l'oreille reste ouverte (sinon le nom serait perdu) |
| le micro n'est pas fermé | § 2 (b ter) | `vocalEnterVeille`, `vocalStopListeningFromAssistant`, `vocalRendreOrdreArret`, `vocalExitVeille` ne contiennent **aucun** `.fermer(`, `stopVoiceInput(`, `vocalMic.demander(` |
| l'affichage n'est plus « je vous écoute » | § 1 (a), (a bis), (a quater) | `vocalEtatAffiche` rend `idle` en veille, `listening` hors veille, `speaking`/`thinking` intacts ; la phrase rendue est celle de la veille, jamais `ECOUTE` |
| un seul état pour les deux entrées | § 1 (a) + § 2 (b quater) | une **seule** affectation `vocalVeilleArmee = true` ; le minuteur passe par `vocalEnterVeille("silence")`, l'outil par `vocalEnterVeille(` |
| l'outil existe, est exposé, produit l'état | § 3 (c), (c bis) | outil déclaré **une** fois (sentinelle, `sequential`, action `stop_listening`), pont window posé **et** retiré, branche `stop_listening` avec réponse `confirmed`/`cancelled`, aucun `save_config`/`localStorage` |
| la phrase part comme une demande | § 3 (c ter) | `vocalRendreOrdreArret` appelle `send()`, deux gardes seulement, **3** occurrences (1 déclaration + 2 appels) |
| aucune lecture à voix haute | § 3 (c quater) | `vocalCoupeSilencieuse = true` **avant** `send()`, consommé dans `autoReadVocalReply`, un seul `autoReadVocalReply` |
| réveil par le nom fonctionne encore | § 4 (d), (d bis), (d ter) | la garde armée **laisse passer** « Aurelia, … » et un mot de réveil ; `vocalExitVeille` remet les drapeaux à `false` et relance le compte ; le bouton de secours vaut toujours une phrase |
| « écoute » dans un autre sens ne coupe rien | § 5 (e), (e bis) | 8 phrases ordinaires + 6 formules **noyées** → `isVocalStopFormula` faux, action `VOCAL_STOP_RIEN`, raison `pas-formule` |
| aucune formule recopiée dans l'écran | § 5 (e ter) | `super-agent.js` ne contient **aucun** littéral de formule ; la condition est l'action du module |
| formules élargies | § 6 (f) | les 13 formulations demandées sont dans la liste **unique** et coupent |
| tolérance de transcription bornée | § 6 (g) | 12 variantes passent ; « merci » seul et « arrête d'écouter la radio » **ne passent pas** |
| répéter la formule en veille ne dit rien | § 6 (h) | `deja-en-veille` + la garde jette |

### 3.1 Preuve par mutation (le test échoue sans la correction)

Trois mutations, appliquées puis **retirées** (fichiers restaurés à l'identique,
vérifié par `diff -q`) :

| Mutation | Résultat |
|---|---|
| `vocalEtatAffiche` rend l'état inchangé (le défaut d'origine) | `arret-ecoute-vocale.test.js` **échoue** |
| un des deux appels à `vocalRendreOrdreArret(finalText)` retiré (la phrase redevient avalée) | **échoue** |
| `vocalCoupeSilencieuse = false;` retiré de `autoReadVocalReply` (l'ordre serait lu) | **échoue** |

### 3.2 Vérification de la comparaison, hors test unitaire

`isVocalStopFormula` contrôlée en node sur **27 formulations positives** et
**14 phrases-pièges** : 0 raté, 0 faux positif (deux passes, avant et après les
dernières éditions).

---

## 4. Chiffres (rapport JSON neuf, recompté)

Rapport : `docs/rapports/vitest-arret-ecoute-vocale.json` (fichier ignoré par Git, comme
les précédents — `.gitignore` l. 69) ; `startTime` 2026-11-10T06:08:43Z.

| Mesure | Valeur |
|---|---|
| fichiers de test | **315** |
| suites | 1775 |
| tests | **5844** |
| réussis | **5844** |
| échoués | **0** |
| ignorés / `todo` | 0 / 0 |
| `success` | `true` |

Fichiers directement concernés : `arret-ecoute-vocale.test.js` **22**, `vocal-nom-garde.test.js` **34**,
`veille-mot-de-reveil.test.js` **24**, `vocal-correctifs-revue.test.js` **20**,
`micro-reste-ouvert-mode-vocal.test.js` **19** — tous verts.
Extensions : `scripts/extensions-syntax.test.js` **25 / 0**.

---

## 5. Ce qui n'est PAS prouvé par test — vérifiable seulement en exécutant l'application

Ces points ne peuvent pas être établis par un test unitaire ; ils demandent un essai
réel avec micro, dans l'application lancée :

1. **Que le micro entende réellement la phrase** que le propriétaire prononce (le moteur
   de reconnaissance est celui du système / du service local ; un test ne fait que
   simuler ses résultats).
2. **Que l'assistant choisisse bien l'outil `stop_listening`** sur une formulation
   inattendue (c'est un jugement du modèle ; la liste des 20 formules couvre les cas
   courants, le reste dépend de lui).
3. **Que l'absence de lecture soit perçue comme telle** à l'oreille (le drapeau est
   prouvé, le silence réel ne l'est pas).
4. **Que le réveil par le nom fonctionne en conditions réelles** après un arrêt (le
   chemin est prouvé ; le niveau du micro et la prononciation ne le sont pas).
5. Le **délai perçu** entre la phrase et le retour de l'assistant (il dépend du modèle et
   de la file ; l'état, lui, est posé immédiatement).

---

## 6. Ce qui n'a pas été touché (anti-régression)

- **Veille automatique de 20 s** : `VOCAL_ECOUTE_LIBRE_MS = 20000` toujours **seule
  valeur du dépôt**, suspension pendant le tour et la lecture inchangée
  (`vocal-veille-pendant-le-tour.test.js` vert).
- **Envoi automatique de fin de dictée** : `voice-auto-send.js` **non modifié**.
- **Garde du nom et mots de réveil** : aucune règle ajoutée ni retirée ; seuls deux
  **commentaires** de documentation, et l'ajout d'une fonction pure.
- **Micro ouvert en mode Vocal** : `micro-reste-ouvert-mode-vocal.test.js` vert (un seul
  appel à `fermer()`), et le nouvel outil n'en ajoute aucun.
- **Halo et barre de saisie** : aucune règle CSS ajoutée ; la classe suit simplement la
  même décision d'état.
- **Aucun nouveau réglage, aucune case, aucun bouton** : vérifié par test (aucun
  `save_config`, aucun `localStorage` dans le chemin de l'outil).

---

## 7. Fichiers

| Fichier | Nature |
|---|---|
| `src/js/arret-ecoute-vocale.test.js` | **nouveau** — 22 cas |
| `src/js/vocal-nom-garde.js` | `vocalEtatAffiche`, `stopFormulaKey`, `sansPolitesseFinale`, liste à 20 |
| `src/js/super-agent.js` | `vocalEtatAffiche` dans la ligne d'état et dans la classe, `oreilleArmee`, `vocalRendreOrdreArret`, `vocalStopListeningFromAssistant`, `vocalCoupeSilencieuse`, pont window, branche `stop_listening` |
| `src-tauri/extensions/pilot-assistant-actions.ts` | outil `stop_listening` |
| `src/js/vocal-conversation.js` | commentaire de la règle 8 (aucune logique) |
| `spec_modes_ecran_vocal.md`, `spec_super_agent.md`, `help/handbook.md` | documentation + aide intégrée |
| `docs/rapports/FICHE-a-ajuster-arret-ecoute-vocale.md` | encart d'ajustements (point 4 abandonné) |
| `docs/rapports/RAPPORT-arret-ecoute-vocale.md` | ce rapport |

Commandes vérifiées : `npx vitest run` (**5844 / 0**) et
`npx vitest run scripts/extensions-syntax.test.js` (**25 / 0**).
