# RAPPORT — Envoi automatique à la fin d'une dictée vocale

> Décision du propriétaire du **2026-10-26**, validée explicitement : à la fin d'une
> dictée, le message part tout seul — plus besoin d'appuyer sur Entrée.
> Portée volontairement bornée : **onglet agent π (desktop)**.
> Rapport écrit **avant** les tests longs (comme demandé) ; les résultats des tests
> figurent au §6 et sont mis à jour à la fin de la tâche.

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
| `npx vitest run src/js/envoi-auto-fin-dictee.test.js` | **17 tests, 0 échec** |
| `npm test` (suite complète) | **194 fichiers, 3397 tests, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **786 passés, 1 ignoré, 0 échec** |
| `node --check src/js/agent-pi.js` / `voice-auto-send.js` | OK |
| `npm run build:handbook` | OK (aide intégrée régénérée, bloc `dictee-vocale` à jour) |

Ce qui **n'a pas** été vérifié (impossible ici) : la dictée réelle avec un micro dans
la fenêtre (aucun son, aucune application lancée). Le comportement est prouvé par la
décision pure, l'ordre testé et le branchement lu dans le source.

## 7. Conclusion

Le geste « je parle, puis j'appuie sur Entrée » n'existe plus dans l'onglet agent π :
à la fin normale d'une dictée, le texte dicté part une seule fois, par le chemin
d'envoi de toujours ; en cas d'erreur, de refus ou de texte vide, rien ne part et le
texte reste dans la zone.

VERDICT : conforme à la décision du 2026-10-26, sans réglage ajouté, sans second
mécanisme d'envoi, sans régression sur Entrée / bouton ▶️ / lecture à voix haute.
