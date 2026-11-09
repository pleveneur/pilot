# Rapport — la veille du mode Vocal ne doit pas s'armer pendant le tour de l'assistant

> **Correctif livré le 2026-11-16.** Cause établie par le propriétaire : *ne pas
> ré-analyser*, ce rapport ne fait que la corriger et la prouver.
> Spec mise à jour : `spec_modes_ecran_vocal.md` § 6quater.2.

## 1. Le défaut, en une phrase

Le compte de silence de 20 s (`VOCAL_ECOUTE_LIBRE_MS`) ne mesurait que le
**silence du propriétaire** : il n'était ni suspendu par le **travail** de
l'assistant, ni par sa **lecture à voix haute**. Après un réveil par le nom, le
compte repartait à l'instant du nom et **s'armait en pleine conversation** : la
veille s'activait, l'écran ne l'affichait pas (la phrase de veille ne paraît
qu'au repos), et la phrase suivante du propriétaire était **jetée sans aucun
message** par la garde du nom.

Les deux durées en jeu rendent le défaut certain et non théorique : un tour de
l'assistant peut durer **120 s** (`agents-bus`/assistant), une lecture à voix
haute n'est **pas bornée** — les deux dépassent largement 20 s.

## 2. L'état d'avant, avec ses preuves

Le compte n'était (re)lancé que par **cinq** événements ponctuels :

| Point d'appel | Ce qu'il couvrait |
|---|---|
| `enterVocal()` | l'entrée dans le mode |
| `vocalSetLevel()` — `if (pas.capte === true)` | front **montant** du niveau du micro |
| `vocalNoteWord()` | un texte reçu/accepted |
| `vocalExitVeille()` | le nom (ou un mot de réveil) entendu |
| la fin du minuteur quand `raison === "reveil"` | le réveil d'une phrase en attente |

Preuves dans le code d'avant :

1. `decideVocalVeille(etats)` ne connaissait que `modeOuvert`, `reveil`,
   `veilleArmee`, `ecouleMs`, `delaiMs` — **ni la parole de Pilot, ni son
   travail** (`src/js/vocal-nom-garde.js`, avant correctif).
2. Aucun appelant ne relançait le compte sur `agent_end` : la fin de tour ne
   figurait dans aucune des cinq lignes du tableau ci-dessus.
3. `onVocalReadAloudState` ne traitait la fin de lecture que par
   `vocalApresLecture = true` (réouverture de l'oreille) : le compte de veille
   n'y était pas touché.
4. Le fait que l'écran **connaissait déjà** ces deux informations est prouvé par
   `vocalConversationState()` : elle rend `pilotParle: vocalSpeaking === true` et
   `reflechit: reflectingActive === true`, et elle est utilisée par la dictée
   (`vocal-conversation.js`). La veille ne les recevait simplement pas.

Conséquence mesurable : `applyVocalState()` était appelé à chaque changement de
parole/réflexion, mais aucun de ses effets ne concernait le compte de veille ⇒
la veille pouvait s'armer **pendant** `speaking`/`reflecting`, et rien ne
l'affichait (la ligne d'état, elle, affiche « Parle… »/« Réfléchit… »).

## 3. La correction, point par point

Split inchangé : **décision pure** dans `src/js/vocal-nom-garde.js`, **application**
dans `src/js/super-agent.js`. Aucun second mécanisme, aucun nouveau drapeau,
aucun nouveau réglage, **aucun seuil touché**.

### 3.1 Décision pure (`vocal-nom-garde.js`)

1. `decideVocalVeille` accepte deux faits de plus et refuse d'armer la veille
   pendant ces deux périodes. L'ordre des règles devient :
   `hors-mode` → `deja-en-veille` → `reveil` → **`pilot-parle`** →
   **`assistant-travaille`** → `silence-court` → `silence-atteint`.
   Les deux nouvelles règles sont placées **après** les trois règles de
   protection existantes (état stable, réveil d'une phrase) : elles ne peuvent
   donc pas changer le comportement d'un état déjà protégé.
2. Nouvelle fonction pure `vocalVeilleSuspendue({ pilotParle, travaille })` :
   elle nomme **la même** décision sous la forme dont l'application a besoin
   (« faut-il annuler / relancer le compte ? »), pour que l'écran n'ait aucune
   règle à réécrire. Elle ne regarde **que** ces deux faits.
3. Les champs sont **absents par défaut** (`=== true` exigé) : un appelant qui ne
   les passe pas garde **exactement** la décision d'avant — c'est ce qui rend le
   correctif sans risque pour tout autre appelant.

### 3.2 Application (`super-agent.js`)

4. `vocalVeilleEtat()` : les deux faits, lus dans l'état de conversation
   **existant** (`vocalConversationState` → `pilotParle`, `reflechit`). Aucune
   seconde source de vérité, aucun drapeau neuf.
5. `vocalRestartVeilleTimer()` : (a) ne **pose** plus le compte quand la veille
   est suspendue ; (b) passe les deux faits à `decideVocalVeille` (par
   `...vocalVeilleEtat()`), donc la décision à l'échéance est la même ; (c) si le
   minuteur s'épuise pendant une des deux périodes, il ne pose rien et laisse la
   fin de période relancer (raisons `pilot-parle` / `assistant-travaille`).
6. `vocalSyncVeilleSuspension()` : **seul point d'application**. Trois règles, et
   rien d'autre :
   - hors de l'écran Vocal → rien ;
   - suspendue → **annule** le compte ;
   - veille armée → rien (état stable, que seul le nom lève) ;
   - un compte tourne déjà → **on n'y touche pas** (aucune remise à zéro
     surprise) ;
   - sinon → `vocalRestartVeilleTimer()` : le compte **repart de zéro**.
   L'idempotence est ce qui rend le point sûr : appelé à chaque changement
   d'état, il n'agit qu'à la frontière.
7. `applyVocalState()` l'appelle (avant `vocalSyncConversation()`, donc **avant**
   la dictée : le compte ne lit que la parole et le travail, et il ne touche
   jamais à la dictée) — c'est ce qui couvre **tous** les changements de parole et
   de réflexion, sans nouvel écouteur.
8. `agent_end` (le `onEnd` de la session) : `vocalRestartVeilleTimer()` à la fin
   du tour — **le compte repart de zéro à la fin du travail**. Placé après
   `autoReadVocalReply()` : si la lecture automatique démarre, sa première
   annonce annule aussitôt ce compte (jamais deux périodes à la fois).
9. `onVocalReadAloudState` : sur la transition `parlait && !vocalSpeaking`
   (`→ fin de lecture`), `vocalSyncVeilleSuspension()` — **le compte repart de
   zéro à la fin de la lecture**. Le fait est celui que l'écran connaît déjà, il
   n'y a aucun nouveau signal.

## 4. Tests ajoutés et preuve de mutation

Fichier **nouveau** : `src/js/vocal-veille-pendant-le-tour.test.js` (10 tests).

| Groupe | Ce qui est verrouillé |
|---|---|
| 1(a) | travail en cours + compte échu ⇒ **pas** de veille (`assistant-travaille`), même à 120 000 ms |
| 1(b) | lecture en cours + compte échu ⇒ **pas** de veille (`pilot-parle`), même à 600 000 ms |
| 1(c) | **existant intact** : 19 999 ms ⇒ `silence-court`, 20 000 ms ⇒ `silence-atteint`, faits absents ou `false` ⇒ décision d'avant |
| 1(d) | l'ordre des règles : `hors-mode` / `deja-en-veille` / `reveil` gardent la priorité |
| 1(e) | `vocalVeilleSuspendue` ne regarde que ces deux faits (dictée, question, moteur occupé ⇒ non) |
| 1(f) | **aucun seuil touché** : `VOCAL_ECOUTE_LIBRE_MS === 20000`, une seule occurrence, aucun `20_000` en dur, aucune lecture de configuration dans la décision |
| 2 | branchement : les deux faits lus dans `vocalConversationState`, passés à la décision, refus de poser le compte **avant** `setTimeout`, `vocalSyncVeilleSuspension` = annuler/relancer/ne rien toucher, un seul point par état (`applyVocalState`, `agent_end`, fin de lecture), **un seul** minuteur, **un seul** appel à `decideVocalVeille`, aucune clé de configuration |

Preuve de mutation (chacune a été appliquée puis le fichier restauré tel quel) :

1. Retirer les deux nouvelles règles de `decideVocalVeille` ⇒ **2 échecs**
   (`expected true to be false`) : 1(a) et 1(b) tombent.
2. Retirer l'appel `vocalSyncVeilleSuspension();` d'`applyVocalState` ⇒ **échec**
   (`expected … to contain 'vocalSyncVeilleSuspension();'`).
3. Retirer le `vocalRestartVeilleTimer();` de `agent_end` ⇒ **échec**
   (`expected … to contain 'vocalRestartVeilleTimer();'`).

`npx vitest run` complet : **5817 tests, 0 échec** (5807 avant, + les 10 tests
nouveaux). Aucun test existant modifié, aucun affaibli, aucun supprimé.

Points de conformité vérifiés en passant : `vocal-parler-declenche-une-demande`
exige que `vocalSyncConversation()` soit le **dernier** appel « dictee » de
`applyVocalState` — l'appel de veille a donc été placé **avant** lui, et ce
verrou n'a pas été touché ; `vocal-chrome-masque` exige `vocalSyncChrome(state)`
en dernier — inchangé.

## 5. Ce qui n'a PAS été touché

- `VOCAL_ECOUTE_LIBRE_MS = 20000` : **inchangé** (verrouillé par test).
- Seuils du micro (`VOCAL_VOICE_ON` / `VOCAL_VOICE_OFF`), `VOCAL_ARM_DELAY_MS`,
  `VOCAL_ARM_AFTER_READ_MS`, `VOCAL_CHROME_IDLE_MS`, `BARGE_IN_*` : inchangés.
- Aucun **réglage** nouveau, aucune **clé de configuration** nouvelle, aucun
  élément d'interface nouveau : la ligne d'état et les phrases existantes
  suffisent.
- **Les deux causes secondaires du diagnostic ne sont PAS traitées** (elles
  attendent un essai réel du propriétaire) : la dictée en échec qui verrouille
  l'écoute, et le nom attendu différent du nom prononcé. Rien de cela n'apparaît
  dans le code.
- Aucun autre écran : l'onglet agent π, l'accès web distant, le mode « Assistant
  seul » et la dictée ordinaire ne connaissent pas ce compte.
- `src-tauri/` (dont `laya/` et `assets/`), GDS, publication : non touchés.
  Aucune release, aucun tag, aucune poussée de tag.

## 6. Commandes de re-vérification

```bash
npx vitest run src/js/vocal-veille-pendant-le-tour.test.js   # 10 tests, 0 échec
npx vitest run                                              # 5817 tests, 0 échec
npm run build:handbook                                       # puis relancer : aucun changement
```
