# Rapport — un message Telegram est traité comme une demande de l'écran Vocal

> Demande du propriétaire : « le mode vocal est parfait (vraie discussion,
> réponses courtes et essentielles, conversation qui continue). Je veux
> **exactement** le même comportement quand j'écris à mon bot Telegram. »
>
> Nature : correction bornée (construction du prompt + restitution).
> **Aucune** modification du micro, de la détection de parole, de la lecture à
> voix haute, ni de l'écran Vocal. **Aucune** modification de la configuration du
> bot, du jeton ou du webhook. **Aucun** fichier supprimé, **aucune** publication
> de version.

---

## 1. Diagnostic — comment une réponse Telegram était fabriquée

### 1.1 Sens SORTANT (Assistant → Telegram)

À la fin d'un tour, `relayAssistantMessageToTelegram` (appelée depuis `agent_end`
et `appendSystemMessage`) passait le texte par `condenseAssistantMessage`, qui
**jetait tout sauf la première phrase** et bornait à **200 caractères** :

- `src/js/telegram-dialog.js:36` — `TELEGRAM_DIALOG_MAX_CHARS = 200`
- `src/js/telegram-dialog.js:101` — `firstSentence(text)`
- `src/js/telegram-dialog.js:122` — `condenseAssistantMessage(raw)` (`:125` = `firstSentence(cleaned)`)
- `src/js/telegram-dialog.js:507` — `const line = condenseAssistantMessage(text);`
- `src/js/telegram-messages.js:61` — `MAX_ASSISTANT_CHARS = 200` (seconde borne, dans le gabarit)
- `src/js/telegram-messages.js:60` — `MAX_ALERT_CHARS = 150` (une **alerte** — panne, blocage — était coupée à 150 caractères)

### 1.2 Sens ENTRANT (propriétaire → Assistant)

`injectExternalMessageToSuperAgent` remettait le texte **sans aucune consigne**,
et Rust le ré-emballait dans le gabarit des comptes rendus de session :

- `src/js/super-agent.js:9884-9895` (HEAD) — `summary: text`, sans consigne, sans nature
- `src/js/telegram-inbound.js:46-48` — `formatTelegramInboundText` préfixe le message
- `src-tauri/src/super_agent.rs:4577` + `:4579` (HEAD) — `build_injection_message` produisait
  `"[Résumé de session] Projet: …\n{summary}\n\nIntègre ces informations dans ton suivi (tâches, décisions, état d'avancement)."`
- `src-tauri/src/super_agent.rs:4442` (HEAD) — `deliver_one_summary` (rejeu) re-cadrait de la même façon
- `src-tauri/src/super_agent.rs:4303` (HEAD) — `build_capped_injection_message(project_path, summary)`

### 1.3 Liste des ÉCARTS avec le mode vocal

| # | Écart | Preuve (avant) | Effet pour le propriétaire |
|---|---|---|---|
| E1 | **Aucune consigne de brièveté** sur une demande venue de Telegram | `super-agent.js:9884-9895` | l'agent répondait comme dans le chat écrit : listes, titres, noms de fichiers |
| E2 | Le message est **recadré en compte rendu** (« Intègre ces informations dans ton suivi ») | `super_agent.rs:4577-4580` | l'agent range au lieu de **répondre** ; la conversation casse |
| E3 | Aucune **nature** persistée → un rejeu re-cadre en compte rendu | `super_agent.rs:4442` | un message délivré 2 minutes plus tard n'était plus un tour de conversation |
| E4 | La réponse est **coupée à la première phrase** (200 c.) | `telegram-dialog.js:36,122,507` ; `telegram-messages.js:61` | la 2ᵉ phrase courte du mode vocal était **perdue** |
| E5 | Une **alerte** est coupée à 150 caractères | `telegram-messages.js:60` | une panne se disait **amputée** (cause ou décision attendue manquante) |

Le mode vocal, lui, reçoit sa consigne par **un seul point** :
`vocalBrevityInstruction` / `composeVocalPrompt` (`src/js/vocal-brevity.js`),
appelées depuis `send()` de `super-agent.js` — c'est la source à réutiliser.

---

## 2. Correction (bornée à ces écarts)

### 2.1 Une seule source pour la consigne (E1)

`src/js/vocal-brevity.js` est **étendu**, pas dupliqué :

- `VOCAL_BREVITY_ORIGIN_VOCAL` / `VOCAL_BREVITY_ORIGIN_TELEGRAM` ;
- `EN_TETE_PAR_ORIGINE` : **seul l'en-tête** dépend du canal (« Mode vocal —
  parler court » / « Conversation Telegram — répondre court » + « TOUR DE
  CONVERSATION … suite du MÊME fil ») ; les **règles de longueur**, la **clause
  de développement** (développer seulement si demande explicite) et les
  **exceptions** (panne, refus, erreur, confirmation dites **en entier**) sont
  **mot pour mot identiques** ;
- `vocalBrevityInstruction(niveau, origine = VOCAL)` — origine inconnue ⇒ en-tête
  Vocal (jamais de consigne absente) ;
- `composeWithInstruction(text, niveau, origine)` — helper **partagé** (demande
  intacte en tête, demande vide ⇒ rien) ;
- `composeVocalPrompt` (inchangé dans son contrat) et **`composeTelegramPrompt(text, { niveau })`**.

Côté `super-agent.js`, `injectExternalMessageToSuperAgent` compose désormais par
`composeTelegramPrompt` avec le **même niveau réglé** que le mode vocal, relu au
moment de composer (`readReplyBrevityLevel()` : `get_config` →
`vocal_brevity_level`, **fail-open** sur le niveau par défaut).

### 2.2 La continuité de conversation (E2, E3)

- JS : la remise porte `kind: OWNER_MESSAGE_KIND` (`"owner-message"`, valeur
  **partagée** avec `src-tauri/src/super_agent.rs`) et `displaySummary` (ce que
  l'écran affiche : le message du propriétaire, **sans** la consigne).
- Rust : migration **additive et idempotente** `ensure_column(session_summaries,
  "kind", "TEXT NOT NULL DEFAULT ''")` → une base ancienne s'ouvre sans erreur et
  ses remises en attente gardent leur cadrage historique (`""` = compte rendu).
- `build_injection_message(project, summary, kind)` : si `kind ==
  OWNER_MESSAGE_KIND` ⇒ **le texte tel quel** (aucun gabarit, aucune consigne de
  classement) ; sinon ⇒ gabarit historique **inchangé**.
- `deliver_one_summary` **relit** la nature de la ligne : un rejeu ne dénature
  jamais un message du propriétaire.
- `normalize_summary_kind` : seule la valeur connue est retenue, tout le reste
  retombe sur le compte rendu (aucune nature inventée).

> Le préfixe `[Message Telegram de l'utilisateur]` de `formatTelegramInboundText`
> est **conservé** : il nomme la source du message et ne demande aucun
> classement — ce n'était pas l'écart.

### 2.3 La restitution (E4, E5)

`src/js/telegram-dialog.js` :

- `condenseAssistantMessage` **supprimée** ;
- `splitAssistantSentences` (découpage en phrases, gère « 1.5 ») →
  `cleanAssistantReply` (retire le technique, écarte une annonce vide — « Voici le
  détail : » dont le contenu est parti —, ponctue, **ne borne plus**) →
  `splitForTelegram(text, maxChars)` (**ne coupe jamais** un texte qui tient ;
  sinon fin de phrase, sinon fin de mot) → `prepareAssistantMessages(raw)` ;
- `relayAssistantMessageToTelegram` envoie **chaque morceau** par le **même**
  `buildAssistantMessage` + `publishOwnerText` (aucun second chemin d'envoi).

`src/js/telegram-messages.js` :

- `TELEGRAM_PART_CHARS = 3000` — **sous** `telegram::MAX_TEXT_CHARS = 3500`, donc
  aucun message n'est jamais tronqué par la passerelle ;
- `MAX_ASSISTANT_CHARS = TELEGRAM_PART_CHARS` (plus de 200) ;
- `MAX_ALERT_CHARS` 150 → **300** (cause **et** décision attendue).

### 2.4 Documentation

- `spec_telegram.md` : § 11.1 mise à jour (plus de condensation), **§ 15
  nouveau** (« Un message Telegram est une demande de l'écran Vocal » : tableau
  des écarts, source unique, continuité, exceptions, tests) et bloc
  `<!-- HELP:telegram -->` complété en langage utilisateur ;
- `help/handbook.md` régénéré (`npm run build:handbook`).

---

## 3. Vérification — résultats réels

### 3.1 Tests exigés par la mission

`src/js/telegram-comme-vocal.test.js` (10 tests) — le module `super-agent.js` est
importé **pour de vrai** (`invoke` simulé), donc on vérifie le **comportement** :

| Test | Échoue si… |
|---|---|
| « le message remis porte la MÊME consigne, au MÊME niveau réglé » | **la demande Telegram ne reçoit pas la consigne de brièveté du mode vocal** (comparaison à `composeTelegramPrompt` + niveau réglé ≠ défaut) |
| « les règles de longueur sont IDENTIQUES » | une seconde consigne divergeait du mode vocal (comparaison ligne à ligne des 4 niveaux) |
| « hors mode vocal ET hors Telegram, la demande reste INCHANGÉE » | la consigne fuyait vers les autres écrans |
| « aucun niveau ni aucune consigne n'est recopié ailleurs » | une consigne « Telegram » était dupliquée hors de `vocal-brevity.js` |
| « la remise porte la nature “message du propriétaire” » | **la continuité est perdue** (`kind`, pas de gabarit résumé, `projectPath: null`) |
| « Rust ne recadre PAS un message du propriétaire » | `build_injection_message` ré-emballait le message |
| « la nature est relue dans la boîte durable » | un rejeu dénaturait le message (ou la migration devenait destructive) |
| « le message part par la MÊME porte durable » | un second chemin d'envoi apparaissait |
| « la consigne excepte les cas graves » | une panne/un refus/une erreur/une confirmation pouvaient être raccourcis |
| « une alerte n'est plus coupée à 150 caractères » | les bornes d'envoi ré-amputaient les cas graves |

**Preuve que ces tests échouent sans le correctif** (mutation temporaire, puis
restauration) — `npx vitest run src/js/telegram-comme-vocal.test.js` :

```
× le message remis porte la MÊME consigne, au MÊME niveau réglé
  → expected 'Où en est le projet ?' to be 'Où en est le projet ?\n\n## Conversat…'
× la remise porte la nature « message du propriétaire »
  → expected '' to be 'owner-message'
× le message part par la MÊME porte durable que les comptes rendus
  → expected 'export async function injectExternalM…' to contain 'kind: OWNER_MESSAGE_KIND,'
Tests  3 failed | 7 passed (10)
```

Autre test exigé (restitution) — `src/js/telegram-dialog.test.js` : « une réponse
brève n'est **pas** coupée : elle arrive en entier » et « le découpage en
messages ne se produit **QUE** sur la limite de caractères ».

### 3.2 Suite frontend

```
npm test   →   Tests  6 failed | 4327 passed (4333)
```

Les **6** échecs restants sont **antérieurs à cette tâche** et **hors périmètre** :
ils portent sur des travaux **non committés** de l'écran Vocal (module
`vocal-chrome.js`, `style.css`, `applyVocalState`) que je n'ai pas touchés — le
travail était déjà présent dans l'arbre avant cette intervention :

- `dictee-vocale-se-rearme.test.js` — compte de `.vocal-status` (2 au lieu de 1 : ajout de `vocal-chrome`) ;
- `ecran-vocal-lot2.test.js` (×3) et `vocal-halo-parole.test.js` — position/style de la ligne d'état dans `style.css` ;
- `vocal-parler-declenche-une-demande.test.js` — `vocalSyncChrome(state);` ajouté après `vocalSyncRestartButton(state);` dans `applyVocalState`.

Aucun de ces fichiers n'est lu ni modifié par la correction Telegram ; les
interdits de la mission (ne pas toucher à l'écran Vocal) imposent de les laisser
à leur propriétaire.

Deux tests existants ont été **mis à jour** parce que la règle a changé (et non
pour les faire passer) :

- `telegram-dialog.test.js` : `condenseAssistantMessage` n'existe plus (remplacée
  par `cleanAssistantReply` / `prepareAssistantMessages`) ;
- `telegram-notify-setting.test.js` : son découpage `slice(0, indexOf("#[cfg(test)]"))`
  rendait **vraie par construction** l'assertion « aucune mention de Telegram » ;
  il est remplacé par `promptMaterial`, qui n'extrait que la **matière du prompt**
  (constantes `SUPER_AGENT_*_PROMPT` + leur assemblage) et **vérifie sa taille**
  avant l'assertion négative. L'inventaire de `source-slice.test.js` est **baissé**
  (1 → 0) pour ce fichier, jamais desserré.

### 3.3 Suite Rust

```
cargo test --manifest-path src-tauri/Cargo.toml --lib
→ test result: ok. 810 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out
```

Dont, pour cette tâche (`super_agent`) : **146 passed**, avec trois tests neufs —
`owner_message_keeps_the_prompt_verbatim_and_a_report_keeps_its_framing`,
`owner_message_nature_survives_the_durable_box_and_the_replay`,
`unknown_nature_falls_back_to_a_report`.

---

## 4. Ce qui ne change pas

- le mode vocal, son micro, sa détection de parole, sa lecture à voix haute, son
  écran : **intacts** ;
- la configuration du bot Telegram, le jeton, le webhook : **intacts** (le jeton
  n'est journalisé nulle part) ;
- le chat écrit de l'onglet π et l'onglet 🧭 : leur prompt est **inchangé** ;
- les comptes rendus d'agents : même gabarit historique (`kind` vide), même
  plafond `MAX_INJECTED_MESSAGE_CHARS` ;
- la remise durable sans perte : `delivered=0` **toujours** écrit avant
  l'injection, rejeu borné, accusé obligatoire.

---

## 5. Précision du propriétaire — la brièveté est LEVÉE sur demande explicite

**Règle exacte du propriétaire** (relue et intégrée *a posteriori*, valable **des
deux côtés** — Telegram **et** mode vocal) :

- par défaut, une réponse est **courte** : rien de plus que l'utile, **sans
  listes, sans titres, sans code, sans noms de fichiers** ;
- **si** le propriétaire demande **explicitement** plus de détails
  (« détaille », « explique », « pourquoi », « comment », « donne-moi le
  détail »…), **la brièveté ne s'applique plus** : on développe **autant qu'il
  faut**, en restant compréhensible **à l'oreille** (des phrases, jamais un
  tableau ni du code) ;
- cette levée doit être reconnue **dans les deux canaux** : un message Telegram
  qui demande le détail reçoit une réponse développée, et une demande orale qui
  demande le détail est développée aussi ;
- les **autres exceptions passent toujours avant** : une panne, un refus, une
  erreur, une demande de confirmation se disent **entièrement**.

### 5.1 Ce qui existait déjà (rien n'a été refait)

La clause de développement existait, mais elle était **muette sur la levée
elle-même** : *« Si l'utilisateur demande explicitement de développer
(« détaille », « explique », « pourquoi », « comment »), alors développe : donne
le détail demandé… »*. Un modèle pouvait donc comprendre « développe » **dans la
limite du niveau choisi** (« très courte » = une phrase), et la liste de mots ne
contenait pas « donne-moi le détail ». Point important : cette clause vivait
**déjà** dans le **corps commun** de la consigne (`DEVELOPPEMENT`, dans
`src/js/vocal-brevity.js`), donc **hors de l'en-tête** propre au canal — un canal
ne pouvait pas la perdre seul. Aucune seconde consigne n'a été créée.

### 5.2 Ce qui a été ajouté (un seul endroit)

`src/js/vocal-brevity.js`, constante `DEVELOPPEMENT` (source **unique**, partagée
par `composeVocalPrompt` et `composeTelegramPrompt`) :

> Si l'utilisateur demande explicitement de développer **ou plus de détails**
> (« détaille », « explique », « pourquoi », « comment », **« donne-moi le
> détail »**), alors développe **autant qu'il faut** : **la règle de brièveté NE
> S'APPLIQUE PLUS**, donne le détail demandé **en entier**, en restant
> compréhensible à l'oreille (des phrases suivies, jamais un tableau ni de
> code).

Trois ajouts seulement : les **mots déclencheurs** complets (dont « donne-moi le
détail »), la **levée nommée** (« la règle de brièveté ne s'applique plus »), et
la **portée** (« autant qu'il faut », « en entier »). Le reste de la consigne
(niveaux de longueur, exceptions graves, absence de troncature) est **inchangé**.

### 5.3 Le test qui tient la règle

Nouveau bloc dans `src/js/telegram-comme-vocal.test.js` —
« la brièveté ne vaut plus quand le propriétaire demande le détail » (5 tests) :

| Test | Échoue si… |
|---|---|
| « les deux canaux la portent, pour les quatre niveaux » | la clause commune perd la levée, un mot déclencheur, « NE S'APPLIQUE PLUS » ou « autant qu'il faut », sur **un seul** des deux canaux et **un seul** des quatre niveaux |
| « c'est la MÊME levée, mot pour mot, des deux côtés » | une consigne « Telegram » divergeait de celle du mode vocal |
| « elle n'est JAMAIS dans l'en-tête » | la levée migrait dans l'en-tête d'un canal (un canal pourrait alors la perdre seul) |
| « une demande qui demande le détail part AVEC la levée » | le message **envoyé** (`composeVocalPrompt` **et** `composeTelegramPrompt`) ne portait plus la levée, ou la demande n'était plus intacte en tête |
| « la levée n'existe qu'UNE fois dans le source » | une seconde formulation apparaissait dans `vocal-brevity.js`, `super-agent.js`, `telegram-inbound.js` ou `telegram-dialog.js` |

Le fixture **verbatim** de `src/js/vocal-longueur-reglable.test.js`
(`CONSIGNE_DEFAUT`, la consigne du niveau par défaut recopiée mot pour mot) a été
mis à jour parce que **la règle a changé** — jamais pour faire passer un test.

### 5.4 Résultats RÉELS des tests

Preuve que le nouveau test échoue **sans** la levée (mutation temporaire : la
clause remplacée par « Reste toujours bref, quel que soit le niveau choisi. »,
puis fichier restauré) :

```
npx vitest run src/js/telegram-comme-vocal.test.js
→ × les deux canaux la portent, pour les quatre niveaux
  × une demande qui demande le détail part AVEC la levée
  × la levée n'existe qu'UNE fois dans le source
  Tests  3 failed | 12 passed (15)
```

Après restauration :

```
npx vitest run src/js/telegram-comme-vocal.test.js \
                src/js/vocal-longueur-reglable.test.js \
                src/js/vocal-reponses-courtes.test.js
→ 3 fichiers, 81 tests : 81 passed  (dont les 5 neufs)
```

Suite frontend complète :

```
npm test  →  Tests  6 failed | 4332 passed (4338)
```

Les **6** échecs sont **exactement ceux déjà présents avant cette précision**
(chantier de l'écran Vocal en cours, hors périmètre et non touché ici) :
`dictee-vocale-se-rearme.test.js` (1), `ecran-vocal-lot2.test.js` (3),
`vocal-halo-parole.test.js` (1), `vocal-parler-declenche-une-demande.test.js` (1)
— tous portent sur `.vocal-status` / `style.css` / `vocalSyncChrome`, jamais sur
la consigne de brièveté. Le nombre de tests est passé de **4333** à **4338** :
les 5 tests neufs, tous verts.

Suite Rust (aucun fichier Rust modifié ; lancée pour l'anti-régression) :

```
cargo test --manifest-path src-tauri/Cargo.toml --lib
→ test result: ok. 810 passed; 0 failed; 1 ignored
```

### 5.5 Documentation

- `spec_telegram.md` § 15.2 : nouvelle sous-section « La brièveté est LEVÉE sur
  demande explicite (les deux côtés) » (citation de la clause, conséquences
  tenues par les tests) ; § 15.5 : le nouveau test est décrit avec sa preuve de
  mutation ; bloc `<!-- HELP:telegram -->` complété en langage utilisateur ;
- `spec_modes_ecran_vocal.md` : § 6bis.2 (« Ce que la consigne demande ») et
  § 6bis.3 invariant (a) disent désormais que la demande explicite de détails
  **lève** la brièveté, dans les **deux** canaux ;
- `help/handbook.md` régénéré (`npm run build:handbook`).

### 5.6 Ce qui n'a **pas** été touché (périmètre)

- les **seuils du micro**, la détection de parole, la lecture à voix haute,
  l'écran Vocal : **intacts** ;
- la **configuration du bot Telegram** (jeton, webhook) : **intacte** ;
- les **niveaux de longueur** eux-mêmes (une phrase / deux phrases / quatre à six
  / développée) et le réglage `vocal_brevity_level` : **inchangés** — la précision
  porte sur la **levée** de la règle, pas sur son barème ;
- **aucun** fichier supprimé, **aucune** publication, **aucun** geste vers le
  dépôt distant.

---

## 6. Précision du propriétaire (2026-11) — le canal ne porte QUE la conversation

### 6.1 La demande, en toutes lettres

> « Sur Telegram, je veux **UNIQUEMENT** la conversation question/réponse entre
> moi et l'assistant, **exactement comme en mode Vocal**. **Tout message qui
> annonce un ÉVÉNEMENT doit cesser.** »

### 6.2 Recensement : ce qui n'est pas une réponse à une demande

Tous les points d'envoi de la passerelle ont été relus ; ceux qui ne portent pas
une **réponse à une demande** sont :

| Message d'ÉVÉNEMENT | Point d'envoi | Type |
|---|---|---|
| début de mission | `notifyTaskStarted` → `forwardToTelegram` | `START` |
| fin de mission (agent local, distant, délégation) | `notifyAgentDone`, `notifyAgentDoneFromRemote` | `END` |
| fin de mission de l'Assistant / changement d'état | `notifySuperAgentDone` | `END` |
| démarrage d'agent, étape de travail | `forwardToTelegram` (avis internes) | `START` |
| rapport automatique, résumé de tâche, compte rendu | `notifyAgentDone`, `notifySuperAgentDone` | `END` |
| alerte technique (anomalie, arrêt automatique, verrou libéré) | `notifyAnomaly` | `ALERT` |
| message de service (reprise, relance, file d'attente) | `forwardToTelegram` | `START`/`END` |
| rappel « rien de décidé » d'une alerte | `notifyAnomaly` | `ALERT` |

Tous passent par **un seul** point de passage : `deliverRawTelegramAvis`
(`src/js/telegram-dialog.js`), appelé par `forwardToTelegram`
(`src/js/desktop-notify.js`).

Restent la conversation — et ils n'ont **pas** été touchés : `telegram-inbound.js`
(écoute, remise d'une demande), `telegram-questions.js` (questions, boutons,
« première réponse gagne »), `relayAssistantMessageToTelegram` (la réponse).

### 6.3 La neutralisation (conditionnelle, rien de détruit)

```js
// src/js/telegram-dialog.js
export const TELEGRAM_CHANNEL_CONVERSATION_ONLY = true;
export function isTelegramEventMessageAllowed() {
  return TELEGRAM_CHANNEL_CONVERSATION_ONLY !== true;
}
```

- le couperet est **au point de passage unique** : `deliverRawTelegramAvis`
  retourne **immédiatement** — aucun envoi, **aucun minuteur armé**, rien mis de
  côté (un avis coupé ne peut donc pas repartir « plus tard ») ;
- second verrou dans `sendRawAvis`, troisième dans `flushRawTelegramAvis` (les
  minuteurs en cours sont annulés) : aucun chemin détourné ;
- **aucun code supprimé** : `notifyTaskStarted`, `notifyAgentDone`,
  `notifyAgentDoneFromRemote`, `notifySuperAgentDone`, `notifyAnomaly`,
  `forwardToTelegram`, la machinerie anti-doublon et l'anti-rafale restent
  branchés. Rebasculer la décision = changer **une constante** ;
- les **notifications natives** (bureau) ne sont pas concernées.

### 6.4 La garde (test qui échoue si un événement repart)

`src/js/telegram-conversation-seule.test.js` (fichier **neuf**, **15 tests**) —
modules réels, transport Tauri simulé :

- politique lisible : constante `true`, couperet `false` ;
- le couperet est au **seul** point de passage, et `desktop-notify.js` ne parle au
  moteur **que** par lui (une seule occurrence de `telegram_notify`) ;
- les **six** points d'avis essayés un par un → `telegram_notify` **jamais**
  appelé ; idem **dialogue actif**, **heures calmes**, **config en échec** ;
- **rien en attente** (`timers.count() === 0`), puis + 60 s et
  `flushRawTelegramAvis()` → toujours rien ;
- **alerte critique** coupée comme les autres ;
- **la conversation reste entière** : une demande reçue est déposée, une question
  part, la réponse du propriétaire est consommée, la réponse de l'Assistant part.

Tests existants réécrits pour dire la vérité nouvelle (et non supprimés) :
`src/js/telegram-notify.test.js` et `src/js/telegram-dialog.test.js` prouvent
désormais que les avis **restent branchés** et **n'envoient rien**.

### 6.5 Compte-rendu des tests (exécutés réellement)

```
npx vitest run src/js/telegram-conversation-seule.test.js
→ PASS (15) FAIL (0)

npx vitest run src/js/telegram-dialog.test.js src/js/telegram-notify.test.js \
                 src/js/telegram-messages.test.js src/js/telegram-comme-vocal.test.js
→ PASS (111) FAIL (0)

npm test (suite entière)
→ Test Files 4 failed | 232 passed (236)
  Tests      6 failed | 4347 passed (4353)
```

Les **6 échecs** de la suite entière sont **antérieurs et étrangers** à cette
tâche : ils portent sur les chantiers **vocal/UI en cours** dans l'arbre de
travail (`ecran-vocal-lot2.test.js` ×3, `vocal-halo-parole.test.js`,
`dictee-vocale-se-rearme.test.js`, `vocal-parler-declenche-une-demande.test.js`
— CSS `.vocal-status` et `vocalSyncChrome`), fichiers que cette tâche n'a **pas**
modifiés.

**Preuve par neutralisation** (la garde tient vraiment) : constante repassée à
`false` → **12 échecs** dans `telegram-conversation-seule.test.js` ; restaurée →
**15 verts**.

Aucune modification **Rust** : `cargo test` n'était pas requis (le moteur
`telegram.rs` est inchangé).

### 6.6 Documentation

- `spec_telegram.md` : en-tête (décision), § 1, § 2 (périmètre de la décision),
  § 5 (les avis existent mais sont coupés), § 6 (tests), § 13, § 14 (l'interrupteur
  ne commande plus que la conversation), et **nouvelle § 16** « Le canal ne porte
  QUE la conversation » (table avant/après, couperet, garde, compte-rendu) ;
- bloc d'aide intégrée `<!-- HELP:telegram -->` **réécrit** :
  « Telegram : la conversation, rien d'autre » — l'utilisateur y lit ce qui ne
  lui sera **plus** envoyé ;
- `spec_anomaly.md` (aide) : « Alerte sur Telegram » → **plus envoyée**, les
  alertes restent dans Pilot et dans les notifications natives ;
- `spec_super_agent.md` (Paramètres → Assistant) : le canal ne porte que la
  conversation ;
- `help/handbook.md` régénéré (`npm run build:handbook`).

### 6.7 Ce qui n'a **pas** été touché

- `telegram-inbound.js` (écoute), `telegram-questions.js` (questions), le
  dialogue : **intacts** ;
- la **configuration du bot** (jeton, identifiant, webhook) : **intacte** ;
- les **seuils du micro**, la **lecture à voix haute**, l'**écran Vocal** :
  **intacts** ;
- **aucun** fichier supprimé, **aucune** publication, **aucun** geste vers le
  dépôt distant.
