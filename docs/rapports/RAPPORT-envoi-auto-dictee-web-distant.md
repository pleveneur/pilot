# Rapport — envoi automatique à la fin d'une dictée vocale sur le WEB DISTANT

**Micro-tâche** : le bureau envoie le message tout seul à la fin d'une dictée
(onglet agent π, Assistant 🧭) ; le web distant ne le faisait pas — il fallait
appuyer sur ➤. Alignement réalisé, **sans recopier la décision**.

- Commit : **`fd865243534825d31ae8bd940a5260a550bb487c`** —
  `feat(web): envoi automatique en fin de dictée vocale (module partagé servi par axum)`
  (poussé sur `origin/main`).
- Aucune version bumpée, aucun tag.

---

## 1. Contrainte structurelle (et pourquoi il n'y a pas de copie)

Le web distant est servi par **axum** (`src-tauri/src/web_server.rs`) :

- `static WEB_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/../web")` — le dossier
  `web/` est **embarqué** dans le binaire ; `serve_static` ne peut servir que ce
  qui s'y trouve.
- `web/js/app.js` est un **module ES natif, sans bundler** (commentaire d'origine :
  « Module ES unique (servi par axum, sans build Vite) »).

Conséquence : `web/js/app.js` **ne peut pas** faire `import ... from '../../src/js/voice-auto-send.js'`
— ce chemin n'existe ni dans le binaire, ni côté navigateur. Les deux options
habituelles étaient : recopier la décision dans `web/` (interdit par la tâche), ou
casser l'absence de bundler (build supplémentaire).

**Solution retenue : le serveur sert le module du bureau depuis sa source unique.**

```rust
// src-tauri/src/web_server.rs
static SHARED_VOICE_AUTO_SEND_JS: &str = include_str!("../../src/js/voice-auto-send.js");
const SHARED_VOICE_AUTO_SEND_PATH: &str = "js/voice-auto-send.js";
// dans serve_static() :
if path == SHARED_VOICE_AUTO_SEND_PATH {
    return javascript_response(SHARED_VOICE_AUTO_SEND_JS);
}
```

Le module part du même fichier que le bureau (aucune copie, aucun build) et
devient disponible à l'URL `/js/voice-auto-send.js`. Côté web :

```js
import { applyVoiceEnd, composeVoiceInputValue } from './voice-auto-send.js?v=1';
```

Le `?v=1` est le cache-buster déjà utilisé par le projet (`index.html` est passé
de `/js/app.js?v=2` à `?v=3`) ; `serve_static` compare `uri.path()`, la
query-string est donc ignorée.

## 2. Point d'accroche réel dans le web

`web/js/app.js`, fonction `toggleVoiceInput()` (~l. 1795-1900), évènement
`rec.onend` du moteur `SpeechRecognition` :

| Avant | Après |
|---|---|
| `const wasActive = voiceActive; voiceActive = false; if (wasActive) input.value = preText + sep + finalText;` — la zone était réécrite, **rien ne partait** | `applyVoiceEnd({ sessionActive: wasActive, preText, dictatedText: finalText, userEdited: voiceUserTookOver, closeSession, write, send: () => { submitPrompt(); } })` |

Deux autres points ont dû être traités :

1. **Chemin d'envoi unique.** Le corps du listener `submit` de `#prompt-form` a été
   extrait dans `async function submitPrompt()` (logique **inchangée** : garde
   `trim()`, garde `state.isStreaming`, `stopVoiceInput()`, `appendUserMessage`,
   vidage de la zone, POST). Le listener de formulaire appelle simplement
   `await submitPrompt()` — donc Entrée, ➤ et la fin de dictée empruntent
   **exactement** le même chemin (un seul `apiJson(endpoint`, un seul vidage).
2. **Reprise en main au clavier.** Le bureau détecte « l'utilisateur a tapé »
   autrement ; ici : les écritures du moteur sont programmatiques
   (`input.value = …`) et n'émettent **aucun** évènement `input`, donc tout
   `input` reçu **pendant** `voiceActive` vient de l'utilisateur :
   ```js
   let voiceUserTookOver = false;
   (function initVoiceTakeoverWatch() {
     document.getElementById('prompt-input')
       .addEventListener('input', () => { if (voiceActive) voiceUserTookOver = true; });
   })();
   ```
   - remis à `false` au **début** de chaque dictée (`toggleVoiceInput`) ;
   - `rec.onresult` s'arrête **avant** d'écrire si le drapeau est levé (sa saisie
     n'est jamais écrasée) ;
   - `userEdited: voiceUserTookOver` est transmis à `applyVoiceEnd` ⇒ **aucun
     envoi**.

## 3. Ce qui a été réutilisé / adapté

| Élément | Réutilisation |
|---|---|
| `decideVoiceAutoSend` / `applyVoiceEnd` / `composeVoiceInputValue` | **réutilisés tels quels**, importés depuis la source unique (aucune ligne recopiée ; test qui vérifie l'absence de `function applyVoiceEnd` / `decideVoiceAutoSend` dans le web) |
| `src/js/voice-auto-send.js` | **non modifié** (le module reste pur : ni DOM, ni `fetch`, ni import — vérifié par test) |
| Envoi | réutilise `submitPrompt()`, extrait du listener existant — aucun second mécanisme |
| Arrêt manuel (`stopVoiceInput`) et erreur (`rec.onerror`) | **comportement inchangé** : la session est refermée avant `onend`, donc `sessionActive: false` ⇒ ni écriture ni envoi |
| `web/index.html` | seule la version du cache-buster a changé (`?v=2` → `?v=3`) |

Adaptations propres au web (aucune duplication de logique de décision) : la
détection de reprise en main par évènement `input`, et la livraison du module par
axum.

## 4. Preuves — tests qui mordent

### `src/js/envoi-auto-dictee-web-distant.test.js` — **19 cas**

- **A. La décision (6 + 2 cas)** — harnais reproduisant exactement le motif de
  `app.js` (état `voiceActive` unique, `wasActive` lu avant fermeture, écriture
  programmatique sans évènement `input`) :
  1. texte dicté → **un seul** envoi, par le chemin existant ;
  2. `onend` reçu **deux fois** → un seul envoi ;
  3. texte vide / uniquement des espaces → aucun envoi ;
  4. fin sur **erreur** → aucun envoi, zone non réécrite ;
  5. **arrêt manuel** → aucun envoi (comportement d'avant conservé) ;
  6. **clavier pendant l'écoute** → aucun envoi et saisie intacte (+ 6 bis, et
     conservation du texte préexistant avant le texte dicté).
- **B. Câblage de `web/js/app.js` (source, verrou)** : import du module partagé,
  aucun `applyVoiceEnd` recopié, **un seul** `applyVoiceEnd(` et **un seul**
  `submitPrompt(` dans le bloc `onend`, `sessionActive: wasActive`,
  `userEdited: voiceUserTookOver`, sept clés transmises, garde de reprise en main
  **avant** l'écriture du moteur, drapeau remis à zéro au démarrage, aucun envoi
  dans les chemins `onerror` / arrêt manuel, `submitPrompt` appelé 3 fois en tout
  (définition + formulaire + fin de dictée).
- **C. Un seul module** : **aucune** copie dans `web/js/` (`fs.existsSync(...) === false`),
  `include_str!("../../src/js/voice-auto-send.js")` + `SHARED_VOICE_AUTO_SEND_PATH`
  présents, spécificateur d'import web cohérent avec l'URL servie, module partagé
  toujours pur (`document.`, `window.`, `fetch(`, `import `, `invoke(`,
  `submitPrompt(` interdits).

### `src-tauri/src/web_server.rs` — `shared_voice_module_tests` — **3 cas**

1. le module embarqué vient bien de `src/js/voice-auto-send.js` (les 3 exports) ;
2. le chemin servi correspond au spécificateur d'import du web (`js/voice-auto-send.js`)
   et le type MIME est `application/javascript` ;
3. `#[tokio::test]` : `serve_static("/js/voice-auto-send.js?v=1")` → **200** + corps
   exact + type JS, et `/js/inconnu.js` → **404**.

### Suites complètes (exécutées après restauration)

| Suite | Résultat |
|---|---|
| `npm test` | **196 fichiers / 3484 tests passés, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **792 passés, 1 ignoré, 0 échec** (dont 3 nouveaux) |

## 5. Sabotages réels (tests rouges constatés, puis code restauré)

Chaque sabotage a été appliqué sur le vrai fichier, vérifié, puis restauré
(`diff` à l'identique contre la sauvegarde).

| # | Sabotage | Rouges |
|---|---|---|
| A | suppression de `send: () => { submitPrompt(); }` dans `onend` | **3** |
| B | `userEdited: voiceUserTookOver` → `userEdited: false` | **2** |
| C | suppression de la garde `if (voiceUserTookOver) return;` dans `onresult` | **1** |
| D | retour à l'ancien comportement (réécrire la zone, n'envoyer jamais) | **4** |
| E | dans le module partagé : `if (userEdited === true)` → `if (false)` | **2** |
| F | suppression de la ligne d'import du module partagé | **2** |
| G | neutralisation de la détection de reprise en main (`input`) | **1** |
| H | (Rust) suppression de la route `/js/voice-auto-send.js` | **1** |

Total : **16 rouges** sur 8 sabotages, aucun sabotage silencieux ; après
restauration, **19/19** et **792/792** verts.

## 6. Documentation mise à jour

- `spec_voice_input.md` § 5bis : portée étendue au web, contrainte « pas de
  bundler » et solution retenue, règle 5 (`submitPrompt()`), preuves, « pas
  couvert » corrigé, bloc `<!-- HELP:dictee-vocale -->`.
- `spec_web_remote.md` : ligne du tableau des fonctionnalités, encart « envoi
  automatique (web = bureau) », bloc `<!-- HELP:web-remote -->`.
- `AGENTS.md` : entrée `voice-auto-send.js` (trois barres + service par axum) et
  ligne `web/` (assets embarqués).
- `help/handbook.md` régénéré (`npm run build:handbook`, 45 blocs).

## 7. Limites

- **Non vérifié** : la dictée réelle au micro dans un navigateur (aucun son,
  aucune application lancée). Le comportement est prouvé par la décision partagée
  et l'ordre, pas par une parole réelle.
- Les tests de câblage sont des tests de **source** : ils garantissent la présence
  et la forme du branchement (import, clés, ordre, unicité du chemin d'envoi), pas
  son exécution dans un DOM réel — le harnais du groupe A couvre, lui, l'exécution
  de la décision avec la forme d'appel exacte du web.
