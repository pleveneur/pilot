# Rapport — reprise automatique de l'écoute après chaque réponse (mode Vocal)

Date : 2026-10-29 · Projet : `G:\IA_PL\pilot` · Périmètre : écran **Vocal**
uniquement (aucun autre écran, aucune apparence modifiée, aucune version bump).

Demande du propriétaire : **après CHAQUE réponse de l'assistant en mode Vocal,
l'écoute doit repartir toute seule** (conversation qui continue sans clic). Le
rond « Réveiller <Nom> » reste un **secours**, jamais le chemin normal.

---

## 1. Ce qui existe déjà (état constaté, avant toute modification)

La conversation parlée existe et fonctionne par morceaux :

| Élément | Où | Ce qu'il fait |
|---|---|---|
| décision pure de l'écoute | `src/js/vocal-conversation.js` (`decideVocalDictation`, règle 8) | armer au repos (350 ms), réarmer **après la lecture** (600 ms), désarmer pendant la parole / le travail |
| drapeau « la lecture vient de finir » | `src/js/super-agent.js:5505` (`onVocalReadAloudState`) | `if (parlait && !vocalSpeaking) vocalApresLecture = true;` |
| application du plan + **unique minuterie d'armement** | `src/js/super-agent.js:5137-5149` (`vocalApplyConversationPlan`) | programme l'ouverture de la dictée, décision **réévaluée à l'échéance** |
| ouverture de la dictée | `src/js/super-agent.js:5118` (`armVoiceInput`) → `startVoiceInput` | seule voie de démarrage de la session de reconnaissance |
| fin de tour | `src/js/super-agent.js:4093-4114` (`onEnd`) | `setReflecting(false)` → réarme (350 ms), puis `autoReadVocalReply()` lance la lecture |

Autrement dit : **le mécanisme « se réarmer après la lecture » existe** depuis
`dbf0c35` / le lot « parler déclenche une demande ». Il n'a pas été supprimé.

## 2. La cause exacte du symptôme (« puis plus rien n'écoute »)

L'armement automatique est un **coup unique sans seconde chance** :

```
src/js/super-agent.js:5142   if (!plan.delai || vocalArmTimer) return;
src/js/super-agent.js:5143   vocalArmTimer = setTimeout(() => {
src/js/super-agent.js:5146     if (decideVocalDictation(vocalConversationState()).action !== VOCAL_DICTATION_ARM) return;   // ← abandon SILENCIEUX
src/js/super-agent.js:5147     armVoiceInput();
```

La minuterie de reprise (600 ms après le dernier mot lu) est programmée **une
seule fois**. À l'échéance, si l'état de l'écran n'est pas exactement « au
repos », la ligne 5146 **rend la main sans rien reprogrammer** :

- la minuterie est déjà consommée (`vocalArmTimer = 0` ligne 5144) ;
- `vocalApresLecture` a pu être remis à `false` entre-temps
  (`super-agent.js:5141`, dès qu'un plan demande `couper`/`desarmer`) ;
- **aucun nouvel appel** à `applyVocalState()` n'est garanti ensuite (les
  évènements de niveau, la fin de lecture, la mesure du micro ne rejouent pas
  tous la décision).

Résultat : la dictée reste **fermée**, plus aucune minuterie n'est en vol, le
bouton « Réveiller <Nom> » s'affiche — et seul un geste le rouvre. C'est
exactement le symptôme rapporté.

Les refus qui tombent dans cette fenêtre sont tous **passagers** par nature :

| Raison rendue par `decideVocalDictation` | Pourquoi elle tombe juste après une réponse |
|---|---|
| `pilot-parle` | la voix de Pilot sort encore (queue audio) ou un morceau suivant est annoncé |
| `tour-en-cours` | `isStreaming` / `backendBusy` ne sont pas encore retombés, ou l'outil suivant démarre |
| `mesure-fermee` | le flux de mesure se réouvre (le micro rend la main après la dictée précédente) |
| `sensibilite-inconnue` | la réponse IPC `is_project_sensitive` est encore en vol |

Aucune de ces quatre raisons ne justifie d'**abandonner définitivement**
l'écoute : elles disent « pas maintenant », pas « jamais ». Le code les
traitait pourtant comme un abandon, alors que les refus réellement définitifs
(projet sensible, arrêt manuel, plafond des sessions vides, erreur, dictée
indisponible) sont déjà distingués ailleurs.

## 3. Correctif prévu

1. **Une seule règle pure de plus** (`src/js/vocal-conversation.js`) :
   `vocalResumeRetry(raison, tentatives)` dit si un refus mérite une **reprise**
   et dans quel délai. Refus **passagers** → reprise (400 ms, **nombre borné**) ;
   refus **définitifs** → arrêt immédiat (aucune relance).
2. **Un seul point modifié** (`vocalApplyConversationPlan`) : à l'échéance,
   au lieu d'abandonner, on **reprogramme la même minuterie** (jamais deux en
   vol) tant que le refus est passager et que le plafond de reprises n'est pas
   atteint. La décision reste prise par le module pur ; l'écran n'en décide pas.
3. **Garde-fous conservés tels quels** : jamais d'ouverture pendant que Pilot
   parle (la raison `pilot-parle` interdit l'armement, la reprise ne fait que
   réessayer plus tard), jamais après un arrêt volontaire (`arret-manuel` n'est
   pas passager), jamais sur projet sensible, jamais quand le plafond des
   sessions vides est atteint, et **aucune boucle infinie** (plafond de
   reprises).
4. **Aucune apparence touchée** : halo, objet, phrase d'état, bouton de relance
   inchangés.

## 4. Modifications réalisées

Cinq fichiers, **aucun mécanisme nouveau** : la reprise réutilise la minuterie,
le drapeau et la décision qui existaient déjà.

### 4.1 `src/js/vocal-conversation.js` — quatre ajouts PURS (+68 lignes)

Après `VOCAL_ARM_AFTER_READ_MS` :

| Nom | Valeur / rôle |
|---|---|
| `VOCAL_RESUME_RETRY_MS` | `400` — délai de reprise d'un armement refusé |
| `VOCAL_RESUME_MAX_RETRIES` | `8` — plafond de reprises (≈ 3,2 s au total) |
| `VOCAL_RESUME_TRANSIENT_REASONS` | `["pilot-parle", "tour-en-cours", "mesure-fermee", "sensibilite-inconnue"]` (gelé) |
| `vocalResumeRetry(raison, tentatives)` | `0` si la raison n'est pas passagère **ou** si le plafond est atteint ; sinon `400` |

Aucune décision n'est déplacée : `decideVocalDictation` reste **la** décision
(qui a le droit d'ouvrir), `vocalResumeRetry` ne dit que « quand réessayer ».

### 4.2 `src/js/super-agent.js` — un import, un corps de minuterie (+26/−1)

- Import : `vocalResumeRetry` ajouté à la liste venue de `./vocal-conversation.js`.
- Dans `vocalApplyConversationPlan`, le corps du `setTimeout` devient :
  1. lire `plan.tentatives` (0 par défaut) ;
  2. réévaluer **la même** décision `decideVocalDictation(vocalConversationState())` ;
  3. si elle n'est pas `ARM` → `vocalResumeRetry(decision.raison, tentatives)` ;
     si la règle rend un délai, **rappeler la même fonction**
     (`vocalApplyConversationPlan({ raison, desarmer:false, couper:false,
     delai, tentatives + 1 })`) ; sinon, laisser la dictée fermée ;
  4. si elle est `ARM` → `armVoiceInput()` (inchangé).

Propriétés tenues par construction : **une seule affectation**
`vocalArmTimer = setTimeout(` subsiste dans tout `super-agent.js` (donc jamais
deux minuteries en vol), le nombre de reprises est **décidé par le module pur**,
et la branche de refus ne contient **aucun** `armVoiceInput()`.

### 4.3 Tests

| Fichier | Changement |
|---|---|
| `src/js/vocal-reprise-ecoute-auto.test.js` | **créé** (17 tests, 5 sections) : règle pure (passagers / définitifs / plafond), reprise après réponse avec et sans lecture, jamais pendant la lecture, arrêt 🎙️ et refus définitifs sans minuterie, branchement réel sur le source (une seule minuterie, `new SR()` unique, drapeau posé par `onVocalReadAloudState`, aucune API audio ajoutée, halo intact) |
| `src/js/vocal-parler-declenche-une-demande.test.js` | ancre mise à jour : le test vérifiait l'**ancienne** ligne d'abandon (il figeait le bug). La propriété voulue — « la décision est réévaluée à l'échéance » — est conservée avec les nouvelles ancres |
| `src/js/vocal-mesure-en-premier.test.js` | ancre mise à jour pour la même raison ; le test vérifie désormais en plus que la branche de refus ne contient **aucun** `armVoiceInput()` |

### 4.4 Documentation

- `spec_modes_ecran_vocal.md` §6bis : nouvelle règle (reprise bornée des refus
  passagers, refus définitifs jamais repris, rond = secours) ; §10 : rôle de
  `vocalResumeRetry` dans le tableau des fichiers + nouveau verrou listé.
- `spec_voice_input.md` (bloc `<!-- HELP:dictee-vocale -->`) : une phrase
  utilisateur (« L'écoute repart d'elle-même après chaque réponse ») ;
  `help/handbook.md` **régénéré** (`npm run build:handbook`, 46 blocs).
- Halo, objet lumineux, trait, phrases d'état, bouton de relance : **aucune
  ligne touchée** (vérifié par `git diff`, et par la section 5 du nouveau test).

## 5. Résultat des tests

Suite **complète** du front (`npx vitest run`, après `npm run build:handbook`) :

```
PASS (4296) FAIL (0)
```

(Chiffre vérifié lors de la reprise après redémarrage du 2026-10-29, sur
l'arbre tel qu'il est committé — voir
`docs/rapports/RAPPORT-reprise-apres-redemarrage.md`.)

Fichiers verrous de la conversation parlée, relancés isolément :

| Fichier | Résultat |
|---|---|
| `vocal-reprise-ecoute-auto.test.js` (nouveau) | PASS (17) FAIL (0) |
| `vocal-parler-declenche-une-demande.test.js` | PASS |
| `dictee-vocale-se-rearme.test.js` | PASS |
| `ecran-vocal-bouton-relance.test.js` | PASS |
| `vocal-mesure-en-premier.test.js` | PASS (18) FAIL (0) |

Côté Rust, seul le corpus embarqué change (chaîne `include_str!`) :
`cargo test --manifest-path src-tauri/Cargo.toml --lib help::` →
**4 passed, 0 failed, 1 ignored** (compilation OK avec le handbook régénéré).

Aucun test n'a été supprimé ; les deux ancres réécrites verrouillaient la ligne
du bug, elles vérifient maintenant la **propriété** (« la décision est
réévaluée », « le refus n'ouvre jamais ») et non plus une formulation.
