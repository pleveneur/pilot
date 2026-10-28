# RAPPORT — Envoi automatique à la fin d'une dictée vocale

> Décision du propriétaire du **2026-10-26**, validée explicitement : à la fin d'une
> dictée, le message part tout seul — plus besoin d'appuyer sur Entrée.
> Portée volontairement bornée : **onglet agent π (desktop)**.
> Rapport écrit **avant** les tests longs (comme demandé) ; les résultats des tests
> figurent au §6 et sont mis à jour à la fin de la tâche.

---

## 1bis. Deuxième passe (même tâche, complément) — reprise en main par l'utilisateur

La première passe (commit `108038e`) tenait les cas 1, 2, 3, 5 et 6 de la mission.
Le **cas 4 n'était pas tenu**, et il n'y avait aucun test pour le dire : la zone de
saisie pouvait être réécrite sous les doigts de l'utilisateur. Constat lu dans le
code, avant modification :

```
agent-pi.js:972   inputEl.value = preText + sep + transcript;     // onresult, écrit sans condition
agent-pi.js:1005  write: (value) => { inputEl.value = value; … }  // onend, écrase la zone dans tous les cas
```

Autrement dit : si l'utilisateur tapait ou vidait la zone pendant la dictée, le
moteur de reconnaissance réécrivait par-dessus à chaque résultat, et la fin
normale réécrivait encore `preText + texte dicté`, puis envoyait — sa saisie était
perdue et un message partait sans lui.

### Geste fait (minimal)

| Endroit | Ce qui change |
|---|---|
| `agent-pi.js` (état de dictée) | `voiceUserTookOver` : `true` quand un évènement `input` arrive **pendant** l'écoute. Fondement : les écritures du moteur sont programmatiques (`inputEl.value = …`) et n'émettent **aucun** `input` — tout `input` reçu pendant l'écoute vient donc de l'utilisateur. Remis à `false` au début de chaque dictée. |
| `agent-pi.js` (`rec.onresult`) | garde `if (voiceUserTookOver) return;` placée **avant** l'écriture de la zone : le moteur cesse d'écrire, la saisie de l'utilisateur reste. |
| `agent-pi.js` (`rec.onend`) | transmet `userEdited: voiceUserTookOver` à `applyVoiceEnd`. |
| `voice-auto-send.js` | nouvelle raison `VOICE_END_USER_TAKEOVER` (`utilisateur-a-repris-la-main`) : `decideVoiceAutoSend` refuse l'envoi, et `applyVoiceEnd` **n'appelle même pas `write`** (la zone garde exactement ce que l'utilisateur a écrit), tout en refermant la session. |

Aucun réglage, aucun bouton, aucun libellé ajouté. **`src-tauri/src/agents.rs` non
touché** (la modification qui y figure était déjà présente avant cette tâche).

### Cas couverts par les tests (22 cas, `src/js/envoi-auto-fin-dictee.test.js`)

| Cas de la mission | Tenue |
|---|---|
| 1. fin normale + texte ⇒ envoi automatique, un seul, par `sendPrompt` | ✅ (existant) |
| 2. texte vide / espaces ⇒ rien n'est envoyé, zone inchangée | ✅ (existant) |
| 3. erreur, refus, interruption ⇒ aucun envoi | ✅ (existant) |
| 4. reprise en main ⇒ saisie non écrasée, rien ne part | ✅ **nouveau** : 3 tests (texte tapé conservé, zone vidée qui le reste, primat sur un texte dicté non vide) + test de décision pure |
| 5. aucun envoi en double | ✅ (existant) |
| 6. dictée coupée pendant la réponse de l'assistant | ✅ (inchangé : `if (state.isStreaming)` refuse de démarrer) |

### Verrous vérifiés par sabotage réel

| Sabotage appliqué au code | Tests tombés |
|---|---|
| `decideVoiceAutoSend` renvoie `autoSend: false` sur une fin normale (l'envoi automatique disparaît) | 6 ✅ |
| suppression du garde-fou « texte vide » (un texte vide partirait) | 3 ✅ |
| suppression de la règle de reprise en main (décision + `applyVoiceEnd`) | 4 ✅ |
| dans `agent-pi.js` : plus de détection `input`, plus de garde dans `onresult`, plus de `userEdited` transmis | 1 ✅ (test de câblage) |

Chaque sabotage a été appliqué puis **le code a été remis en place** (copies sauvegardées,
`node --check` repassé, suite re-verte).

---

## 1. Point de départ (audit `RAPPORT-inventaire-vocal-pilot.md`)

- La dictée existe et fonctionne (Web Speech API, `fr-FR`, `continuous = true`).
- Le texte reconnu remplissait la zone de saisie **mais n'était jamais envoyé** :
  `src/js/agent-pi.js` — `rec.onresult` écrivait `preText + sep + transcript` et
  `rec.onend` réécrivait `preText + sep + finalText`, sans aucun appel d'envoi.
- Conséquence : **deux gestes clavier par échange** (dicter, puis Entrée).

## 2. Ce qui a changé

### 2.1 Un seul endroit décide (`src/js/voice-auto-send.js`, nouveau, pur)

| Élément | Rôle |
|---|---|
| `normalizedVoiceText` | texte dicté ramené à sa forme utile (jamais `null`) |
| `composeVoiceInputValue(preText, dictatedText)` | **la même** composition de zone que le code historique (aucune surprise d'affichage) |
| `decideVoiceAutoSend({ sessionActive, dictatedText })` | décision seule : `autoSend` + `reason` (`session-fermee` / `texte-vide` / `fin-normale-avec-texte`) |
| `applyVoiceEnd({ sessionActive, preText, dictatedText, closeSession, write, send })` | l'**ordre** de la fin d'écoute, avec effets injectés : `closeSession` → `write` → `send` (le `send` seulement si la décision l'autorise) |

Le module **ne sait pas envoyer** (aucune dépendance, aucun `sendPrompt(`, aucun
`invoke(`) : il ne décide et n'ordonne que ce que l'appelant lui confie.

### 2.2 Branchement dans l'onglet agent π (`src/js/agent-pi.js`)

- `import { applyVoiceEnd } from "./voice-auto-send.js";`
- `rec.onend` : lit `wasActive` (session encore ouverte = **fin normale**) **avant**
  toute fermeture, puis délègue à `applyVoiceEnd`, dont le `send` est
  `() => { sendPrompt(); }` — c'est-à-dire le **chemin d'envoi existant** de la touche
  Entrée et du bouton ▶️. Aucun second mécanisme d'envoi, aucun appel direct au
  moteur RPC.
- La zone de saisie est vidée par ce même chemin (`sendPrompt` la vide déjà).
- `rec.onerror` et `stopVoiceInput` referment la session (comme avant) : la fin
  d'écoute qui suit ne peut donc **rien** envoyer.
- Le bouton micro retrouve son libellé au repos (`Dictée vocale (transcription
  cloud)`) à chaque fin — plus de bouton affiché « Arrêter la dictée » sans écoute
  (constante `MIC_TITLE_IDLE`).

## 3. Règles de sûreté — tenues, et où

| Règle | Teneur | Preuve |
|---|---|---|
| Jamais de message vide / d'espaces | `decideVoiceAutoSend` refuse un texte normalisé vide | `voice-auto-send.js` ; test « texte dicté vide ou blanc » |
| Envoyer **seulement** sur une fin normale | la décision exige `sessionActive === true` (strict) ; une erreur, un refus de permission, une panne réseau ou un arrêt manuel referment la session **avant** `onend` | test « fin sur erreur » + test source `onerror` |
| Aucun double envoi | `applyVoiceEnd` referme la session **avant** d'écrire et d'envoyer ; le second `onend` voit `wasActive === false` | tests « un seul message par dictée » + « la session est refermée AVANT l'envoi » |
| Entrée et bouton ▶️ inchangés | aucune ligne de `sendPrompt`, du gestionnaire `keydown` ni du clic `send` n'a été modifiée | `git diff` |
| Aucun nouveau réglage | rien ajouté dans Paramètres : c'est le défaut | `git diff` (aucun fichier de réglages touché) |
| Lecture à voix haute / voix locale intactes | aucun fichier concerné modifié | `git diff --stat` |

## 4. Ce qui n'est **pas** fait (hors portée, dit clairement)

- **Assistant 🧭** (`src/js/super-agent.js`) et **web distant** (`web/js/app.js`) :
  leur dictée garde le comportement d'avant (le texte reste dans la zone, l'envoi
  reste manuel). La mission bornait l'objectif à l'onglet agent π ; les deux autres
  chemins ont leur propre envoi et leurs propres gardes, et n'ont pas été touchés.
- Aucune dictée pendant que l'agent travaille (comportement inchangé, refus explicite).
- Aucune écoute permanente, aucun mot d'appel, aucune coupure vocale (document de
  conception `docs/architecture-conversation-vocale-interruptible.md`, toujours ouvert).

## 5. Documentation

- `spec_voice_input.md` : §5 (UX) mise à jour + nouvelle section « Envoi automatique
  en fin de dictée » + bloc `<!-- HELP:dictee-vocale -->` visible pour l'utilisateur.
- `npm run build:handbook` relancé (l'aide intégrée est générée, jamais éditée à la main).

## 6. Vérifications

| Vérification | Résultat |
|---|---|
| `npx vitest run src/js/envoi-auto-fin-dictee.test.js` | **22 tests, 0 échec** (17 de la 1ʳᵉ passe + 5 pour la reprise en main) |
| `npm test` (suite complète) | **195 fichiers, 3437 tests, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **786 passés, 1 ignoré, 0 échec** |
| `npm run build` (vite) | **OK** (`✓ built in 13.04s`, seuls des avertissements de chunks préexistants) |
| `node --check src/js/agent-pi.js` / `voice-auto-send.js` | OK |
| `npm run build:handbook` | OK (45 blocs ; la phrase « Vous gardez toujours la main » est bien dans `help/handbook.md`) |

Ce qui **n'a pas** été vérifié (impossible ici) : la dictée réelle avec un micro dans
la fenêtre (aucun son, aucune application lancée) — je ne peux pas parler dans un
micro. Le comportement est prouvé par la décision pure, l'ordre testé et le
branchement lu dans le source, jamais par une parole réelle.

Reste à faire (hors périmètre de cette tâche, dit franchement) : la barre de saisie
de l'**Assistant 🧭** (`src/js/super-agent.js`) et la **version web distante**
(`web/js/app.js`) n'ont pas l'envoi automatique ni la reprise en main ; leur dictée
reste « le texte dans la zone, puis envoi manuel ».

## 7. Conclusion

Le geste « je parle, puis j'appuie sur Entrée » n'existe plus dans l'onglet agent π :
à la fin normale d'une dictée, le texte dicté part une seule fois, par le chemin
d'envoi de toujours ; en cas d'erreur, de refus, de texte vide, ou si l'utilisateur a
repris la main en tapant dans la zone, rien ne part et la zone garde son contenu.

VERDICT : conforme à la décision du 2026-10-26, sans réglage ajouté, sans second
mécanisme d'envoi, sans régression sur Entrée / bouton ▶️ / lecture à voix haute.
