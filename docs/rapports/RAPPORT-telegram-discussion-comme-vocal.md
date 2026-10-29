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
