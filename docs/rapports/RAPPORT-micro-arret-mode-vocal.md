# Rapport — le micro s'arrête en pleine conversation (mode Vocal)

**Symptôme rapporté** : dans l'écran **Vocal**, le micro se retrouve **arrêté en
cours d'utilisation**. La parole du propriétaire n'est alors plus transcrite **du
tout** — ce n'est pas une baisse de sensibilité progressive, c'est un **arrêt
franc** — et il faut parfois **rouvrir le micro à la main** pour que l'écran
réentende.

**Verdict** : le défaut n'est ni un seuil, ni la coupure de parole (barge-in), ni
la garde du nom. C'est **une capture ouverte une seule fois, jamais rouverte**.

---

## 1. La cause, nommée dans le code

### 1.1 Le module micro ne rouvre jamais rien (`src/js/vocal-mic.js`)

La capture est ouverte par `demander()` (`getUserMedia`), et **il n'existe qu'un
seul chemin de demande dans tout le fichier** (verrouillé par test,
`ecran-vocal-lot3.test.js`). Trois endroits ferment la capture :

| Ligne | Circonstance | Ce qui se passe ensuite |
|---|---|---|
| `fermer()` | sortie du mode — **légitime**, c'est l'utilisateur qui sort | rien, et c'est voulu |
| `mesurer()` → `catch` | l'analyseur ne rend plus de mesure | `liberer()` + `surPanne(...)` |
| piste → `ended` | **le système termine la piste** : casque débranché, périphérique changé dans Windows, autre application qui prend le micro, session audio interrompue | `liberer()` + `surPanne(...)` |

Dans les deux derniers cas, `liberer()` **rend le périphérique** (pistes
`stop()`, contexte audio `close()`, boucle de mesure annulée) et l'écran reçoit
un message clair. Puis **plus rien** : aucune minuterie, aucune reprise, aucun
appel à `demander()` n'existe dans le module. La capture reste fermée jusqu'à la
prochaine **entrée** dans le mode.

### 1.2 L'écran ne peut pas la rouvrir non plus (`src/js/super-agent.js`)

L'unique voie de demande de l'écran est `requestVocalMeasure(origine)`
(~ligne 6079). Elle est gardée par `shouldAskVocalMic({ dejaDemande, microActif })`
et par le drapeau `vocalMicDemande`, posé à `true` **au premier appel** et remis
à `false` à **deux** endroits seulement : l'entrée dans le mode et le clic sur le
bouton de dépannage (« Autoriser le micro »).

Conséquence mécanique : après une perte spontanée de la capture, `microActif`
est faux mais `dejaDemande` reste vrai → `shouldAskVocalMic` rend `false` →
**l'écran se refuse lui-même la seule demande qui réparerait la panne**. Le
bouton de dépannage est donc le seul retour possible. C'est exactement le
« il faut parfois rouvrir le micro à la main ».

### 1.3 Ce que la capture fermée entraîne derrière elle

1. **La dictée locale tombe avec elle.** `oreille-locale-moteur.js` ne capte
   rien : il consomme le robinet `setAudioTap()` de **cette** capture. Capture
   fermée → `setAudioTap()` rend `false` → panne dite (« le son du micro n'a pas
   pu être dirigé vers la dictée locale ») → `reportVoiceFailure` pose
   `vocalDictationErreur`.
2. **La dictée ne se réarme plus.** `decideVocalDictation` (`vocal-conversation.js`,
   règle 6) refuse tout armement tant qu'une erreur est en cours ; la règle 7d
   refuse aussi tant que la mesure n'est pas ouverte (`mesureOuverte` =
   `vocalMicListening`). Une fois la capture perdue, **les deux gardes sont
   vraies** : l'écran reste sourd même si le périphérique revient.
3. **La ligne d'état dit la vérité, mais rien ne se répare.** Le message
   « Le micro est occupé par une autre application. » s'affiche (et la règle 1 de
   `vocalChromeVisible` retient le bas à l'écran, donc le bouton reste
   atteignable). Ce n'est donc pas un défaut d'affichage : c'est un défaut de
   **reprise**.

### 1.4 Ce qui n'est PAS la cause (vérifié, pour ne pas y toucher)

- **Aucun seuil audio n'est en jeu** : `VOCAL_VOICE_ON` / `VOCAL_VOICE_OFF`, la
  garde anti-écho (`BARGE_IN_*`), `smoothLevel`, `levelToWidth` sont hors
  circuit — le symptôme est un arrêt, pas une dérive.
- **La coupure de parole (lot 4a/4b)** arrête la **lecture**, jamais la capture.
- **La sortie du mode** (`exitVocal` → `vocalMic.fermer()`) est légitime et
  reste le seul arrêt volontaire.

---

## 2. Le correctif

Principe : **la capture se répare elle-même, dans le seul module autorisé à
ouvrir et fermer le micro.** Aucune seconde voie de demande n'est créée dans
`super-agent.js`, aucun seuil n'est touché.

### 2.1 `src/js/vocal-mic.js` — la capture se rouvre tant que l'écran la tient

- Nouvelle intention explicite `setKeepOpen(actif)` : « cet écran tient le
  micro ». Posée à l'entrée du mode, retirée à la sortie.
- Décisions **pures** et testables :
  - `micFailureIsRecoverable(nom)` — une cause **passagère** (occupé, piste
    terminée, panne) se réessaie ; une cause **définitive** (refus de
    l'utilisateur, aucun périphérique, API absente) jamais : réclamer une
    permission en boucle serait pire que la panne.
  - `micReopenDelay(essai)` — 400 ms, 800, 1 600, 3 200, puis **plafond à 5 s**.
  - `shouldReopenVocalMic({ gardeOuvert, ferme, actif, cause })` — l'unique
    règle « faut-il rouvrir ? ».
- Une seule fonction de panne de capture (`panneCapture`) remplace les trois
  `liberer(); surPanne(...)` : elle dit la panne **et** programme la reprise.
- `fermer()` annule toute reprise en attente (sortie du mode = décision de
  l'utilisateur, jamais défaite par une minuterie) et une seule demande peut
  être en vol à la fois (les reprises ne se doublent pas).
- À la réouverture, l'ancien message disparaît **du côté de l'écran** (§ 2.2) et
  le robinet de l'oreille locale se rebranche tout seul (le même `flux`).

### 2.2 `src/js/super-agent.js` — trois lignes, aucun nouvel affichage

- `enterVocal` : `vocalMic.setKeepOpen(true)` juste après `createVocalMic`.
- `exitVocal` : `vocalMic.setKeepOpen(false)` juste avant `vocalMic.fermer()`
  (les deux intentions sont écrites côte à côte ; `fermer()` reste le **seul**
  arrêt volontaire).
- `vocalSetListening(true)` : la phrase « le micro est fermé » est retirée
  (`vocalMicFerme = vocalDictationErreur`) — elle n'est plus vraie. Une erreur de
  **dictée**, elle, reste affichée : c'est un autre fait, et elle garde son
  bouton.

Effet de bord voulu et vérifié : la mesure redevenue ouverte rend
`mesureOuverte: true` à `decideVocalDictation`, donc **la dictée se réarme
d'elle-même** (chemin existant `applyVocalState` → `vocalSyncConversation`),
sans geste et sans nouvelle minuterie.

### 2.3 Ce qui reste fermé volontairement (et le dit)

| Fermeture | Visible ? | Comment rouvrir |
|---|---|---|
| Sortie du mode | l'écran a disparu, c'est le geste | rentrer dans le mode |
| Refus de permission, aucun périphérique | message + bouton (règle 1 de `vocalChromeVisible` retient le bas) | bouton « Autoriser le micro » |
| Erreur de dictée / plafond de sessions vides | ligne d'état + bouton | bouton, ou 🎙️ |
| État nu (`vocal-bare`) | ⚠️ la ligne et le bouton sont masqués **par choix** de l'utilisateur | « Tout réafficher » |

---

## 3. Ce que l'utilisateur verra

- Il parle, Pilot répond, la lecture se termine : **l'écoute repart seule**
  (règle 8, `apres-lecture`, 600 ms) et le micro **reste ouvert**.
- Si le périphérique disparaît une seconde (casque, changement de micro,
  application qui prend le micro), la phrase « Le micro est occupé par une autre
  application. » apparaît **puis disparaît d'elle-même** dès que la capture est
  revenue (400 ms à 5 s), et la dictée se réarme. Plus besoin de cliquer.
- Si la cause est définitive (micro refusé, aucun micro branché), la phrase reste
  et le bouton de dépannage reste à l'écran : c'est un acte de l'utilisateur.
- Rien ne change en dehors du mode Vocal, ni sur le clavier, ni sur les seuils.

---

## 4. Verrous

`src/js/micro-reste-ouvert-mode-vocal.test.js` (échoue sur le code d'avant) :

1. une piste qui se termine **rouvre la capture toute seule**, sans nouveau geste ;
2. **sans** la garde de l'écran (`setKeepOpen`), rien ne se rouvre : le
   comportement d'avant est intact, c'est la garde qui change ;
3. après `fermer()` (sortie du mode), **aucune** réouverture, même en avançant
   toutes les minuteries ;
4. un **refus** n'est jamais redemandé (aucune boucle de permission) ;
5. les délais **s'allongent puis plafonnent** ;
6. `super-agent.js` pose la garde à l'entrée, la retire à la sortie, et
   `vocalMic.fermer()` n'apparaît **qu'une fois** (sortie du mode) ;
7. la ligne « micro fermé » **disparaît** quand la capture revient, et une
   erreur de dictée, elle, reste ;
8. après la lecture, la dictée se réarme seule (`apres-lecture`, 600 ms).

## 5. Mesures

Exécuté le 2026-11-15 sur l'arbre modifié :

| Commande | Résultat |
|---|---|
| `npx vitest run` (suite front complète) | **5 579 tests passés, 0 échec** |
| `npx vitest run src/js/micro-reste-ouvert-mode-vocal.test.js` | **19 tests passés, 0 échec** |
| Preuve d'échec : reprise neutralisée (`planifierReouverture` rend la main) | **3 tests du nouveau verrou échouent** (`expected [] to have a length of 1 but got +0`) → le verrou échoue bien sur le code d'avant |
| `cargo test` (Rust) | non lancé : **aucun fichier Rust n'est touché** par ce correctif |

Aucun test existant n'a été modifié ni relâché (les deux verrous d'ancrage —
`ecran-vocal-lot3.test.js` et `vocal-mesure-en-premier.test.js` — passent sans
retouche : la voie de demande garde son nom et son corps).
