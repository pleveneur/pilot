# Spec — Dictée vocale (micro à côté du bouton envoyer)

> Document de spécification — Statut : **planifié, non implémenté**.
> Décisions validées par l'utilisateur le 10/07/2026.
> Suivi : voir « Évolution 8 » dans `Bugs et Evolutions.md`.

---

## 1. Objectif

Ajouter un **bouton micro 🎙️ à côté du bouton envoyer** dans la barre de saisie du
chat agent, pour dicter directement le texte de l'instruction. Fonctionne sur les
**deux interfaces** :

- **Web remote** (`web/`) : barre `#prompt-form` (textarea `#prompt-input` + bouton `#prompt-send` ➤).
- **Desktop** (`src/js/agent-pi.js`) : barre de saisie (textarea `#agent-input` + bouton `.agent-send-btn` ▶️).

La transcription est injectée dans le `textarea` ; l'utilisateur valide ensuite avec
le bouton envoyer existant (aucun changement du flux d'envoi).

---

## 2. Décisions validées par l'utilisateur

| # | Décision | Détail |
|---|----------|--------|
| 1 | **HTTPS via Tailscale Serve accepté** (web remote) | Le micro navigateur exige un *secure context*. Le web remote en HTTP sur Tailscale ne suffit pas → accès via Tailscale Serve (`https://fixe.ts.net`) requis pour la dictée web. |
| 2 | **Web Speech API** | `SpeechRecognition` natif du navigateur. Pas de backend, pas de Whisper. |
| 3 | **Langue `fr-FR` figée** (dans un premier temps) | Paramètre préparé pour une future config, mais valeur codée `fr-FR` à l'implémentation. |
| 4 | **Desktop + Web remote** | Code dictée présent sur les deux interfaces (cohérence). Desktop débloqué via le patch wry (décision 5) ; web remote via Tailscale Serve (HTTPS). |
| 5 | **Option B appliquée pour le desktop** (patch wry) | wry 0.55.1 est patché en local (`src-tauri/vendor/wry`) : le handler `PermissionRequested` du WebView2 autorise `MICROPHONE` sans condition, ce qui débloque la dictée desktop. Voir §8. **Maintenance** : re-appliquer le patch à chaque montée de version de Tauri/wry. |

---

## 3. Mécanisme — Web Speech API

```js
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const rec = new SR();
rec.lang = "fr-FR";
rec.interimResults = true;   // résultats partiels en continu
rec.continuous = true;       // ne s'arrête pas tout seul
rec.onresult = (e) => {
  // Distinguer mode cumulatif (Android) vs incrémental (desktop) — voir §3bis.
  // Cumulatif : garder le résultat le plus complet. Incrémental : concaténer.
};
rec.onerror = ...; rec.onend = ...;
rec.start(); / rec.stop();
```

- `interimResults: true` → transcription en continu, injection au curseur dans le
  `textarea` au fur et à mesure (résultats intermédiaires remplacés par le texte
  final du segment).
- `continuous: true` → la reconnaissance ne s'arrête pas automatiquement à la fin
  d'une phrase (l'utilisateur arrête lui-même).

### 3bis. Traitement des résultats — anti-doublon Android

**Problème observé (Chrome Android, `continuous=true`)** : le moteur finalise des
résultats **cumulatifs** — chaque résultat final contient les précédents, par ex.
`["salut", "salut comment", "salut comment ça va"]`. Une simple concaténation
produit `salutsalut commentsalut comment ça va` (doublons collés).

**Solution** : distinguer deux modes à chaque `onresult` :

- **Mode cumulatif (Android)** : `norm(finals[last]).startsWith(norm(finals[last-1]))`
  → on ne garde que le **dernier** résultat (le plus complet). Idem pour l'interim
  (`norm(interim).startsWith(norm(finalText))` → l'interim remplace `finalText`).
- **Mode incrémental (Chrome desktop)** : chaque résultat est un segment nouveau
  → on **concatène** (`finals.join(' ')` + interim).

`norm(s) = s.trim().toLowerCase().replace(/\s+/g, ' ')` normalise pour la comparaison
(ponctuation/casse pouvant varier entre versions cumulées).

**Cache-busting** : `web/index.html` référence `app.js?v=N` ; bumper `N` à chaque
modification de `app.js` pour forcer le rechargement par le navigateur (sinon le
navigateur sert une version en cache, et le fix peut sembler inefficace).

**Desktop** : même logique appliquée dans `src/js/agent-pi.js` (le micro desktop reste
cependant bloqué par wry/Tauri tant que non patché — voir §8).

### ⚠️ Confidentialité (trade-off à connaître)

Sur **Chrome / WebView2 (Edge)**, `SpeechRecognition` en mode par défaut **envoie
l'audio aux serveurs cloud** du moteur (Google/Microsoft) pour la transcription —
ce n'est **pas** une transcription 100% locale. Le texte transcrit revient dans le
navigateur, puis n'est envoyé à Pilot (`/api/agent/prompt`) qu'au moment de
l'envoi volontaire.

- **Web remote (Chrome Android)** : transcription cloud Google. Le trafic audio va
  à Google, pas à Pilot. Acceptable pour de la dictée d'instructions courtes, à
  signaler dans l'UI (petite mention « transcription cloud »).
- **Desktop (Tauri = WebView2 sur Windows, WebKit sur macOS/Linux)** :
  - Windows : WebView2 (Edge) → transcription cloud.
  - macOS/Linux : WebKit → `SpeechRecognition` pas ou peu supporté (à vérifier au
    moment de l'implémentation). Fallback : masquer le bouton si non supporté.

L'alternative 100% locale (Whisper backend, approche B) garantirait le hors-ligne
mais a été écartée (lourdeur, dépendance Rust). Trade-off accepté.

---

## 4. Contrainte secure context (HTTPS / localhost)

`SpeechRecognition` et `getUserMedia` exigent un **secure context** (HTTPS ou
`localhost`) sur tous les navigateurs modernes.

| Interface | Origine | Secure context ? | Micro OK ? |
|---|---|---|---|
| **Web remote** (`http://100.x.y.z:8787`) | HTTP sur IP Tailscale | ❌ Non | **Bloqué** — il faut `https://fixe.ts.net` (Tailscale Serve) |
| **Web remote** via Tailscale Serve | `https://fixe.ts.net` | ✅ Oui | ✅ |
| **Desktop** (Tauri dev) | `http://localhost:5173` | ✅ (localhost) | ✅ |
| **Desktop** (Tauri prod) | `tauri://localhost` ou `http://localhost` (asset protocol) | ✅ | ✅ |

→ **Desktop : pas de contrainte.** **Web remote : dictée conditionnée à Tailscale
Serve (HTTPS)**. Si l'utilisateur accède en HTTP, le micro est bloqué par le
navigateur → le bouton doit détecter cela et afficher un message (« microphone
requiert un accès HTTPS — activez Tailscale Serve ») plutôt que de échouer
silencieusement.

Détection : `window.isSecureContext` (booléen navigateur) — si `false`, désactiver
le micro sur le web et afficher l'avertissement.

---

## 5. UX proposée

- Bouton 🎙️ **à côté du bouton envoyer** (➤ / ▶️), dans la même barre.
- **1ʳᵉ pression** : démarre la dictée. Indicateur visuel (bouton rouge / pulsant,
  éventuellement un point « ● REC »).
- Transcription **en continu** injectée au curseur dans le `textarea` (les résultats
  intermédiaires sont remplacés par le texte final du segment en cours).
- **2ᵉ pression** (ou `onend` du moteur) : arrête la dictée. Le texte final reste
  dans le `textarea` ; l'utilisateur relit/modifie puis clique ➤/▶️.
- **Bouton masqué** si `SpeechRecognition` non supporté par le moteur (Firefox,
  WebKit non supporté) → `if (!SR) btn.style.display = "none"`.
- **Bouton désactivé** si `web_readonly` (web, chat déjà coupé) ou `isStreaming`
  (agent en cours) — cohérent avec le bouton envoyer existant.
- Sur le web non sécurisé (`!isSecureContext`) : bouton désactivé + infobulle
  « requiert HTTPS (Tailscale Serve) ».

---

## 6. Plan d'implémentation (à faire)

### Web remote
- [ ] **`web/index.html`** : ajouter `<button type="button" id="prompt-mic">🎙️</button>`
      dans `#prompt-form`, à côté de `#prompt-send`.
- [ ] **`web/js/app.js`** : logique `SpeechRecognition` (démarrage/arrêt, injection
      au curseur, détection `isSecureContext` + support, disable si
      `state.isStreaming` / `web_readonly`).
- [ ] **`web/css/web.css`** : style du bouton + état « REC » (rouge/pulsant).

### Desktop
- [ ] **`src/js/agent-pi.js`** : ajouter bouton 🎙️ dans la `inputBar` (à côté de
      `.agent-send-btn`), logique `SpeechRecognition` (même principe), disable si
      `state.isStreaming`. Masquer si non supporté (WebKit macOS à vérifier).
- [ ] **`src/css/style.css`** : style du bouton + état « REC ».

### Mutualisation (à décider)
- Le web (`web/js/`) et le desktop (`src/js/`) sont deux codebases séparées (le web
  n'a pas de build, modules ES simples). Pas de partage direct de module. Deux
  options :
  1. **Duplication minimale** d'une fonction `createVoiceInput(textarea, btn, opts)`
     dans chaque codebase (~50 lignes chacune). Simple, pas de couplage.
  2. **Module partagé** copié dans les deux (ex: `web/js/voice.js` + `src/js/voice.js`
     maintenus en parallèle).
  - Recommandé : option 1 (duplication) — le code est court et les contextes diffèrent
    (DOM, état, styles).

### Documentation
- [ ] `spec_web_remote.md` : section dictée vocale + mention HTTPS obligatoire.
- [ ] `Bugs et Evolutions.md` : pointer ici (Évolution 8).
- [ ] `README.md` : mention si orienté utilisateur.
- [ ] `AGENTS.md` : ajouter `spec_voice_input.md` dans la navigation.

---

## 7. Points ouverts / à valider (à l'implémentation)

1. **Support WebKit (macOS/Linux desktop)** : `SpeechRecognition` est mal supporté
   par WebKit. À tester au moment de l'implémentation ; si non supporté, masquer le
   bouton sur ces OS (Windows WebView2 = OK).
2. **Comportement `continuous`** : certains navigateurs arrêtent la reconnaissance
   après un silence même en `continuous: true`. Prévoir une reprise auto ou un
   message « dictée arrêtée, appuyez pour reprendre ».
3. **Injection au curseur vs à la fin** : injecter au curseur (si focus) ou à la fin
   du `textarea` (plus simple et prévisible) ? À trancher (recommandé : à la fin
   pendant la dictée, plus simple).
4. **Langue** : `fr-FR` figée à l'implémentation, mais prévoir une constante unique
   (`const VOICE_LANG = "fr-FR"`) pour futur réglage.
5. **Mention de confidentialité** : afficher une infobulle « transcription cloud »
   sur le bouton ? Ou un avertissement à la 1ʳᵉ utilisation ?

---

## 8. Compatibilité & limites

| Navigateur / moteur | SpeechRecognition | Micro autorisé |
|---|---|---|
| Chrome / Edge (Windows, Android) | ✅ | ✅ (si secure context) |
| WebView2 (Tauri Windows) | ✅ | ✅ (wry patché — `src-tauri/vendor/wry`) |
| Firefox | ❌ | — |
| Safari (iOS/macOS) | ⚠️ partiel (`webkit`) | ✅ si secure context |
| WebKit (Tauri macOS/Linux) | ⚠️ à vérifier | ✅ (localhost/tauri://) |

- **Perte réseau mobile** : la dictée peut s'interrompre si le WS se reconnecte ;
  la transcription est locale au `textarea` (déjà injectée), pas de perte de texte.
- **Mode lecture seule** (`web_readonly`) : micro désactivé comme le chat.
- **Agent en streaming** (`isStreaming`) : micro désactivé comme le bouton envoyer.
- **Micro desktop débloqué par patch de wry (appliqué)** : Tauri v2 / wry 0.55
  n'exposait aucune API pour autoriser le micro du WebView — le handler
  `PermissionRequested` de wry ne gérait que le presse-papiers, et `SpeechRecognition`
  échouait avec `not-allowed` sur le desktop Windows. Pilot embarque désormais une
  copie locale patchée de wry (`src-tauri/vendor/wry`, branchée via `[patch.crates-io]`
  dans `src-tauri/Cargo.toml`) dont le handler autorise `MICROPHONE` (uniquement).
  La dictée desktop fonctionne ; la dictée web remote reste la voie alternative (Chrome
  Android via Tailscale Serve). **Maintenance** : à chaque montée de version de
  Tauri/wry, récupérer la nouvelle source wry, réappliquer la modification du handler
  dans `src/webview2/mod.rs` (bloc « Permission handler (patched for Pilot) »), et
  ajuster la version dans `[patch.crates-io]` si besoin.
---

<!-- HELP:dictee-vocale -->
## Dictée vocale 🎙️

Pilot intègre la dictée vocale (Web Speech API, langue `fr-FR`) pour saisir du
texte à la voix.

- **Dans l'éditeur / l'agent Pi (desktop)** : bouton 🎙️. Fonctionne en contexte
  sécurisé (HTTPS ou `localhost`).
- **Sur le web distant** : le micro exige **HTTPS** (Secure Context). Cocher
  « Exposer en HTTPS automatique (Tailscale Serve) » dans les Paramètres →
  Accès distant, puis utiliser le bouton 🎙️ depuis le téléphone/autre poste.
- La transcription alimente directement la zone de saisie active (éditeur ou
  saisie de l'agent).
<!-- /HELP:dictee-vocale -->
