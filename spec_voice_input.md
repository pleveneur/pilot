# Spec — Dictée vocale (micro à côté du bouton envoyer)

> Document de spécification — Statut : ✅ **Implémenté (2026-07)** sur les **deux** interfaces : desktop (bouton 🎙️ de l'onglet π et de l'Assistant, micro débloqué par le patch local de wry, voir §8) et web remote (micro Chrome HTTPS via Tailscale Serve).
> Décisions validées par l'utilisateur le 10/07/2026.
> Suivi : voir « Évolution 8 » dans `Bugs et Evolutions.md`.
> **Oreille locale (2026-11-04)** : le pont machine vers la transcription LOCALE
> est livré (§9). **L'écran n'est pas encore branché dessus** : le son de la
> dictée part toujours vers Google/Microsoft (§3, « Confidentialité »).

---

## 1. Objectif

Ajouter un **bouton micro 🎙️ à côté du bouton envoyer** dans la barre de saisie du
chat agent, pour dicter directement le texte de l'instruction. Fonctionne sur les
**deux interfaces** :

- **Web remote** (`web/`) : barre `#prompt-form` (textarea `#prompt-input` + bouton `#prompt-send` ➤).
- **Desktop** (`src/js/agent-pi.js`) : barre de saisie (textarea `#agent-input` + bouton `.agent-send-btn` ▶️).
- **Desktop — Assistant (🧭)** (`src/js/super-agent.js`) : barre d'outils de l'onglet Assistant (bouton micro 🎙️), même mécanisme.

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

### 3quater. Une seule exception : la garde du nom de l'écran Vocal

La dictée décrite ici n'exige **aucun** mot d'appel : partout (éditeur, onglet
agent π, Assistant 🧭, web distant), ce que vous dictez est écrit puis envoyé.
La **seule** exception est l'**écran Vocal**, où le propriétaire a demandé que
l'assistante ne fasse rien tant que son nom n'a pas été prononcé. Cette garde est
un module **pur** de l'écran (`src/js/vocal-nom-garde.js`), appliqué **dans
`super-agent.js` seulement** — le module de dictée partagé (`voice-auto-send.js`,
`applyVoiceEnd`) et le web distant n'en connaissent rien. Spécification
complète : `spec_modes_ecran_vocal.md` § 6quater.

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
- **2ᵉ pression** (ou `onend` du moteur) : arrête la dictée. Voir §5bis pour
  l'envoi automatique en fin de dictée.
- **Bouton masqué** si `SpeechRecognition` non supporté par le moteur (Firefox,
  WebKit non supporté) → `if (!SR) btn.style.display = "none"`.
- **Bouton désactivé** si `web_readonly` (web, chat déjà coupé) ou `isStreaming`
  (agent en cours) — cohérent avec le bouton envoyer existant.
- Sur le web non sécurisé (`!isSecureContext`) : bouton désactivé + infobulle
  « requiert HTTPS (Tailscale Serve) ».

---

## 5bis. Envoi automatique en fin de dictée (décision du 2026-10-26)

> **Décision du propriétaire, validée explicitement** : à la fin d'une dictée, le
> message part **tout seul** — l'utilisateur n'appuie plus sur Entrée.
> **Aucun réglage** ajouté (pas de réglage superflu) : c'est le défaut.

**Portée** : les **deux barres de saisie du desktop** — onglet **agent π**
(`src/js/agent-pi.js`, commit `108038e`) et **Assistant 🧭**
(`src/js/super-agent.js`, même module, même ordre, même chemin d'envoi existant
`send()`) — **et la barre de saisie du web distant** (`web/js/app.js`, même
module, même ordre, chemin d'envoi existant `submitPrompt()`, celui d'Entrée / ➤).

> **Contrainte du web distant, et la solution retenue** : le web est servi par
> axum **sans bundler** (module ES natif, `web/` embarqué par `include_dir!`) ;
> il ne peut donc pas importer un fichier situé hors de `web/`. Plutôt que de
> recopier la décision dans `web/js/`, le serveur **sert le module du bureau
> depuis sa source unique** : `include_str!("../../src/js/voice-auto-send.js")`
> dans `src-tauri/src/web_server.rs`, exposé sous `/js/voice-auto-send.js`
> (`SHARED_VOICE_AUTO_SEND_PATH`). `web/js/app.js` l'importe en
> `./voice-auto-send.js?v=1`. **Un seul fichier de décision pour les trois
> barres**, aucune copie.

### Décision et ordre — un seul module

`src/js/voice-auto-send.js` (module **pur**, aucune dépendance, testé par
`src/js/envoi-auto-fin-dictee.test.js`) est la **seule** source :

| Fonction | Rôle |
|---|---|
| `decideVoiceAutoSend({ sessionActive, dictatedText, userEdited })` | décide : `autoSend` + `reason` (`fin-normale-avec-texte`, `texte-vide`, `session-fermee`, `utilisateur-a-repris-la-main`) |
| `applyVoiceEnd({ sessionActive, preText, dictatedText, userEdited, closeSession, write, send })` | impose l'**ordre** : refermer la session → écrire la zone → envoyer (et envoyer seulement si la décision l'autorise ; **rien** n'est écrit ni envoyé si l'utilisateur a repris la main) |
| `composeVoiceInputValue(preText, dictatedText)` | la composition de zone **historique**, inchangée |

### Règles de sûreté tenues

1. **Jamais d'envoi** d'un message vide ou composé uniquement d'espaces.
2. **Envoi seulement sur une fin d'écoute NORMALE** : une erreur de reconnaissance,
   un refus de permission, un arrêt par panne réseau ou un arrêt manuel referment la
   session **avant** `onend` ⇒ rien ne part, et le texte reste dans la zone.
3. **Aucun double envoi** : la session est refermée **avant** l'écriture et l'envoi ;
   un second évènement de fin (ou un second `onend` du moteur) trouve la session
   fermée ⇒ un seul message par dictée.
4. **L'utilisateur reprend la main** : s'il a tapé, collé ou vidé la zone de saisie
   **pendant** la dictée, sa saisie n'est **jamais réécrite** (le moteur cesse
   d'écrire dans la zone) et **rien ne part** : c'est lui qui valide. Détection :
   les écritures du moteur sont programmatiques (`inputEl.value = …`) et n'émettent
   aucun évènement `input` — tout `input` reçu pendant l'écoute vient donc de
   l'utilisateur (`voiceUserTookOver`, remis à zéro au début de chaque dictée).
5. **L'envoi est le chemin existant du fichier appelant** : `sendPrompt` dans
   l'onglet agent π (touche Entrée / bouton ▶️), `send()` dans l'Assistant (Entrée /
   bouton Envoyer), `submitPrompt()` sur le **web distant** (Entrée / bouton ➤ — la
   logique du `submit` du formulaire a été extraite dans cette fonction unique, pour
   être réutilisée telle quelle). Aucun second mécanisme, et la zone de saisie est
   vidée par ce même chemin (refus, file d'attente et verrous du projet inchangés).
   Les gardes propres à `send()` de l'Assistant (question en attente, règle de
   démarrage, Assistant occupé) s'appliquent donc **telles quelles** ; si `send()`
   refuse, le texte dicté reste dans la zone (jamais perdu).
6. Le bouton micro revient à son libellé au repos à chaque fin de dictée.
7. Les trois barres ne recopient **pas** la décision : elles importent le même
   module et lui confient leurs effets (refermer, écrire, envoyer).

### Ce qui est prouvé, et ce qui ne l'est pas

- Prouvé (tests, **37 cas** dans `src/js/envoi-auto-fin-dictee.test.js`) : les sept
  cas ci-dessus + l'ordre refermer → écrire → envoyer + le branchement **des deux**
  barres (`agent-pi.js` : un seul point d'envoi, `sendPrompt` réutilisé ;
  `super-agent.js` : un seul point d'envoi, `send()` réutilisé, aucune décision
  recopiée, garde de reprise en main avant l'écriture du moteur) + une assertion
  croisée (les deux appelants importent le **même** module, qui reste sans envoi ni
  DOM). Verrous explicites : si l'envoi automatique disparaît
  (`decideVoiceAutoSend` renvoie `autoSend: false` sur une fin normale), 10 tests
  tombent ; si un texte vide partait, le test « n'envoie pas quand rien n'a été
  dicté » tombe ; si `applyVoiceEnd` n'est plus appelé par une barre, ou si
  `send: () => { send(); }` / `sessionActive: wasActive` / `userEdited` disparaissent,
  les tests de câblage tombent. Vérifié par sabotage réel du code (échecs
  constatés, code remis en place).
- **Non vérifié** : la dictée réelle au micro dans la fenêtre (aucun son, aucune
  application lancée) — le comportement est prouvé par la décision et l'ordre, pas
  par une parole réelle.
- **Uniquement les cas ci-dessus**, plus le branchement **du web distant**
  (`src/js/envoi-auto-dictee-web-distant.test.js`, **19 cas**) : même décision
  (envoi unique, fin reçue deux fois, texte vide, erreur, arrêt manuel, reprise en
  main au clavier), câblage de `web/js/app.js` (import du module partagé, un seul
  `applyVoiceEnd(`, `sessionActive: wasActive`, `userEdited: voiceUserTookOver`,
  garde de reprise en main AVANT l'écriture du moteur, un seul `submitPrompt` par
  chemin, aucun envoi dans les chemins d'erreur et d'arrêt manuel) et service du
  module par axum depuis la source du bureau (aucune copie dans `web/js/`).
- **Pas couvert** : la parole réelle au micro (aucun son, aucune application
  lancée) — le comportement est prouvé par la décision et l'ordre, pas par une
  phrase prononcée.

---

## 5ter. Écran Vocal : la dictée s'arme toute seule (§ de `spec_modes_ecran_vocal.md` §6bis)

Le défaut corrigé : dans l'écran Vocal, le micro ne servait qu'à **mesurer** le
niveau. Parler animait l'écran mais n'écrivait rien et n'envoyait rien ; la
dictée n'existait que derrière un clic sur 🎙️, et ses erreurs s'affichaient dans
la conversation — qui n'est **pas affichée** dans cet écran.

**Rien de nouveau comme moteur** : c'est la **même** dictée (`startVoiceInput`,
extraite de `toggleVoiceInput`) et le **même** envoi (`applyVoiceEnd` → `send`).

- **Une seule voie de démarrage** : `startVoiceInput()` (idempotente,
  `new SR()` n'existe qu'une fois dans `super-agent.js`), appelée par le bouton
  🎙️ **et** par l'armement automatique.
- **Une seule source de décision** : `src/js/vocal-conversation.js` (pures)
  — `decideVocalDictation` (armer / désarmer / ne rien faire + raison + délai) et
  `planVocalConversation` (effets : fermer, annuler l'armement, programmer).
- **Un seul point d'application** : la fin de `applyVocalState()`
  (`vocalSyncConversation()`), qui voit déjà l'état de l'écran.
- **Ordre des règles** (c'est la spec) : projet sensible → hors mode → Pilot
  parle → Pilot travaille → dictée déjà ouverte (idempotence) → arrêt manuel →
  erreur en cours → sans transcription → **armement au repos** (350 ms ; 600 ms
  après la lecture d'une réponse).
- **Une seule session, une seule minuterie** : jamais deux armements programmés,
  décision **réévaluée à l'échéance**.
- **Trois sorties du mode** : `exitVocal()` ferme la dictée et annule l'armement
  (les deux autres sorties passent par elle).
- **La ligne d'état est le seul canal d'erreur** de l'écran :
  `vocalDictationMessage(code)` rend **une phrase** (micro refusé, micro occupé,
  réseau, projet sensible, dictée indisponible, échec) qui dit toujours d'écrire
  la demande ; `aborted` et `no-speech` ne disent rien (ce ne sont pas des
  pannes, et un silence ne produit donc jamais de message d'échec). Le texte
  reste dans la zone : si `send()` refuse, rien n'est perdu.
- **Pendant une dictée, la voix ne coupe rien** : `vocalBargeIn` rend la main si
  `voiceActive` (c'est la voix qu'on transcrit). Aucun seuil de `vocal-mic.js`
  n'est modifié.
- **Un silence n'est pas une panne** (défaut corrigé, cf.
  `docs/rapports/RAPPORT-dictee-vocale-coupee.md`) : le plafond des sessions
  vides ne compte plus que les retours **instantanés** du moteur (durée mesurée
  < `VOICE_EMPTY_SESSION_INSTANT_MS`, 1 s, dans `voice-auto-send.js`). Une fin
  d'écoute qui a **réellement écouté** se réarme, **n'affiche aucun message** et
  **remet le compte à zéro**. Le moteur de reconnaissance termine lui-même la
  session toutes les quelques secondes de silence : compter ces fins normales
  suspendait l'écoute au bout de trois pauses en annonçant « La dictée n'a pas
  fonctionné » alors que le son était capté. Un vrai échec (permission, micro
  occupé, périphérique, réseau) garde **sa** phrase, une seule, et ne boucle pas.

**Prouvé** (`src/js/vocal-parler-declenche-une-demande.test.js`, 30 cas) : les
décisions, les messages, le câblage (un seul point d'application, une seule voie,
une seule minuterie, trois sorties qui ferment, réarmement après lecture, garde
de coupure pendant la dictée, erreurs dans la ligne d'état, aucun second envoi,
aucune API micro dans l'écran, projet sensible relu). **Non prouvé** : deux
captures micro simultanées sur votre poste (mesure + dictée) — si la seconde est
refusée, l'écran le dit (`audio-capture`) et le clavier reste utilisable.

---

## 5quater. Répondre après le dernier mot (écran Vocal) : deux secondes par défaut, réglable

> **Décision du propriétaire, appliquée telle quelle** : **deux secondes après le
> dernier mot récupéré, s'il n'y a pas de nouveau mot, la demande part.** — puis :
> **ce délai se règle, de une à cinq secondes, sans changer le défaut.**

Le défaut corrigé : l'envoi n'avait lieu qu'à la **fin que déclare le moteur de
reconnaissance** du navigateur. Cette fin arrive quand **lui** décide qu'on a fini
de parler — parfois plusieurs secondes après le dernier mot. On parlait, le texte
s'écrivait, puis on attendait sans savoir pourquoi.

- **Le délai est décidé, il n'est plus subi** : la règle
  `decideVocalSilenceSend(etats, moment)` vit dans la **source unique des
décisions de l'écran** (`src/js/vocal-conversation.js`, pures). Elle **ne lit
  aucune constante** : le délai lui arrive avec l'état (`etats.delaiMs`), fourni
  par le seul endroit qui arme le minuteur (`vocalSilenceState()` dans
  `super-agent.js`).
- **Défaut inchangé : deux secondes.** `VOCAL_SILENCE_SEND_MS = 2000` devient la
  **valeur par défaut du réglage** (et le repli si la configuration est
  illisible) ; elle n'est plus une constante figée.
- **Le réglage, à UN SEUL endroit** : Options → onglet **« Assistant »** → section
  **« Mode Vocal »**, juste sous le réglage de la voix : un **curseur de 1 à 5 s
  par pas de 0,5 s** (défaut 2 s) et la valeur **en toutes lettres** (« 2,5
  secondes »). Champ de configuration `vocal_silence_send_ms` (défaut 2 000),
  appliqué **sans redémarrage**. Bornes et pas appliqués par une seule fonction
  pure (`normalizeVocalSilenceSendMs`) : une valeur aberrante ne change jamais le
  comportement.
- **Un changement pendant une dictée s'applique au PROCHAIN armement**, jamais au
  minuteur déjà lancé (la valeur est lue au moment d'armer, pas surveillée
  ensuite) : on ne coupe jamais une parole en réglant un curseur.
- **Pilot par mots, pas à l'horloge** : chaque texte récupéré — **provisoire
  comme définitif** — **repousse** l'échéance du **délai réglé**. Un texte
  **identique** au précédent n'est pas un nouveau mot (sinon un moteur qui répète
  son résultat intermédiaire repousserait sans fin).
- **Un seul minuteur à la fois** : celui en vol est remplacé à chaque nouveau mot
  et **annulé** dès que la dictée se referme, quand Pilot parle ou réfléchit, et
  aux **trois sorties** du mode (`exitVocal`). Aucun second minuteur de ce genre.
- **Un seul envoi, celui d'aujourd'hui** : à l'échéance, on **referme** la dictée
  en demandant au moteur de s'arrêter ; sa fin d'écoute **normale** passe par
  `applyVoiceEnd` → `send`, comme avant. Aucun second envoi, aucun second moteur,
  aucune seconde détection de fin de parole.
- **Jamais de coupure d'une parole** : rien ne part si du texte arrive encore, si
  Pilot lit ou réfléchit, si la dictée s'est refermée, ou si l'utilisateur a
  **repris la main** dans la zone (`voiceUserTookOver`). Une dictée **muette**
  n'envoie rien. Les gardes existantes (projet sensible, micro de mesure, plafond
  des fins vides **instantanées**, dictée unique) sont **inchangées**.
- **Ordre des règles** (c'est la spec, il est testé tel quel) : hors mode → Pilot
  parle → Pilot travaille → dictée refermée → reprise en main → aucun mot →
  **échéance : refermer** (au moment du mot : attendre le **délai réglé**, deux
  secondes par défaut). Les gardes passent **avant** le délai.

**Prouvé** (`src/js/vocal-repondre-deux-secondes.test.js`, 31 cas, +
`src/js/vocal-delai-envoi-reglable.test.js` pour le réglage) : la valeur par
défaut (2 000 ms, une seule fois dans le module), l'ordre des règles et toutes les
gardes, le délai respecté et **repoussé** par chaque mot (horloges simulées : rien
avant 1 999 ms, la demande à 2 000 ms du **dernier** mot), **un seul** minuteur,
aucun envoi pendant la lecture / la réflexion / après une reprise en main, aucun
envoi tardif après la fermeture du mode, le réglage (bornes 1–5 s, pas de 0,5 s,
valeur aberrante ramenée, défaut inchangé), la **non-modification du minuteur en
vol** lors d'un changement de réglage, et le câblage (une seule affectation de
minuteur, réévaluation à l'échéance, `rec.stop()` réutilisé, un seul
`applyVoiceEnd`). **Non prouvé** : la latence réelle du moteur de votre poste
(elle n'a plus d'importance pour l'envoi).

---

## 6. Plan d'implémentation

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

### Mutualisation (tranché)
- Le web (`web/js/`) et le desktop (`src/js/`) sont deux codebases séparées (le web
  n'a pas de build, modules ES simples). **Solution retenue** pour l'envoi
  automatique de fin de dictée : **un seul module** (`src/js/voice-auto-send.js`),
  **servi** au web par le serveur axum depuis sa source unique
  (`include_str!` → `/js/voice-auto-send.js`) — ni duplication, ni build, ni
  dépendance nouvelle. La **capture** vocale (Web Speech API) reste propre à
  chaque codebase (DOM, état et styles différents).

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
  dans le `Cargo.toml` **racine** du workspace — une section `[patch]` n'est honorée que
  par le manifeste racine) dont le handler autorise `MICROPHONE` (uniquement).
  La dictée desktop fonctionne ; la dictée web remote reste la voie alternative (Chrome
  Android via Tailscale Serve). **Maintenance** : à chaque montée de version de
  Tauri/wry, récupérer la nouvelle source wry, réappliquer la modification du handler
  dans `src/webview2/mod.rs` (bloc « Permission handler (patched for Pilot) »), et
  ajuster la version dans `[patch.crates-io]` si besoin.

---

## 9. Oreille locale — le pont machine (étape 1, 2026-11-04) et l'écran branché (étape 2, 2026-11-15)

> **Décision du propriétaire** : la dictée doit pouvoir être transcrite **sur
> l'ordinateur**, par le logiciel de voix local (VoiceStudio), au lieu d'envoyer
> le son à Google/Microsoft.
>
> **Étape 1** = le pont machine (ci-dessous). **Étape 2 = FAITE** : la dictée de
> l'écran passe par ce pont quand la case **« Transcrire avec le service de voix
> local »** est cochée (⚙️ Options → onglet **Assistant**), et le repli vers la
> dictée du navigateur est **toujours annoncé à l'écran** — jamais silencieux.
> Décochée (défaut), la dictée reste exactement celle d'avant.

### Une seule porte, un module frère de la voix imitée

`src-tauri/src/asr_voicestudio.rs` est le **frère** de `tts_voicestudio.rs` :
lui **donne** une voix, celui-ci **reçoit** une parole. Mêmes conventions, mêmes
messages, même journal (`voix-locale.log`), même adresse (`BASE_URL` de
`tts_voicestudio.rs`, jamais recopiée). **La fenêtre ne joint jamais le service**
(verrou `src/js/oreille-locale-etape1.test.js`).

| Commande | Rôle |
|---|---|
| `asr_voicestudio_status()` | La dictée locale est-elle possible ? Sinon **pourquoi**, en une phrase (`hint`) + un code stable (`reason`) : `disponible`, `service-absent`, `service-muet`, `aucun-modele-francais`, `modele-non-accepte`, `dictee-non-prete`. |
| `asr_voicestudio_start(model?)` | Ouvre **une** dictée et rend `session_id`, le modèle **retenu**, `sample_rate` (16 000). Refus explicite sinon. |
| `asr_voicestudio_send(session_id, chunk)` | Reçoit un morceau de son (PCM 16 kHz mono 16 bits, ≤ `MAX_CHUNK_BYTES`). Ne bloque jamais : le morceau part dans la session. |
| `asr_voicestudio_stop(session_id)` | Ferme proprement : le service rend son **texte final** (évènement `final`). |
| `asr_voicestudio_cancel(session_id)` | Interrompt **en pleine dictée** : rien n'est gardé, rien n'est promis. Interrompre une session déjà finie n'est pas une erreur. |

Les cinq commandes sont `pub async fn` + `spawn_blocking` (règle « aucune
commande ne fige l'écran », `commandes-agent-non-bloquantes.test.js`).

### Ce que la fenêtre reçoit

Un seul évènement, au nom stable, `asr-voicestudio-transcript` :

| `kind` | Contenu |
|---|---|
| `started` | `engine` = le moteur **réellement** retenu par le service |
| `partial` | `text` provisoire (le texte s'écrit au fur et à mesure) |
| `final` | `text` définitif + `final_kind` (`summary` = la phrase entière) |
| `error` | `message` en français + `kind` stable (jamais un code brut) |
| `ended` | la session est refermée côté machine |

### Le modèle français est IMPOSÉ, jamais celui du service

- Le modèle est imposé dans l'adresse (`?model=…`) : sans cela le service prend
  **son** défaut (le plus petit modèle).
- Le modèle préféré est `sherpa-parakeet-tdt-v3` (européen, 25 langues, installé) ;
  sinon le premier modèle **installé** capable de français (libellés « french »,
  « european », « multilingual », « 90+ »…).
- Un modèle **absent** est une erreur dite : **aucun téléchargement** n'est
  jamais déclenché par ce module.
- **Aucune licence n'est acceptée à la place de l'utilisateur.** Le service
  refuse un modèle installé dont la licence n'a pas été acceptée : le module
  **lit** cet état (`GET /models/licenses/acceptance/<repo>`), écarte le modèle
  et dit exactement où l'accepter. Une licence **illisible** ne condamne jamais
  un modèle.

### Preuves réelles (mesurées, pas estimées)

Phrase française contenant des accents, transformée en son puis transcrite par le
service local (VoiceStudio 0.5.7, GPU RTX 5080) :

- modèle **réellement** utilisé : `sherpa-whisper-tiny` — `sherpa-parakeet-tdt-v3`
  est **refusé** par le service (licence non acceptée) et le module le dit ;
- session ouverte en ~30 ms après la sonde ; **premier partiel à ~0,9 s** du
  premier morceau, partiels ensuite toutes les ~1 s ; **texte final à ~9,5 s**
  (dont ~5,7 s de son) ;
- texte obtenu : « Bonjour, ceci est un essaye de dicter local avec des accents,
  ou déjà être ça très français. » — accents, « où », « déjà », « ça » justes ;
  erreurs observées : *essaye* (essai), *dicter* au lieu de *dictée* ;
- **service arrêté** : l'application de l'utilisateur n'a **pas** été tuée ; la
  même voie a été éprouvée vers un **port fermé** (vrai refus de connexion) :
  constat en ~2 s, phrase « le logiciel de voix (VoiceStudio) n'est pas ouvert »,
  aucune exception.

Rapport complet : `docs/rapports/RAPPORT-oreille-locale-etape1-pont-machine.md`.

### Étape 2 — l'écran est branché (faite le 2026-11-15)

**Un seul réglage, une seule clé** : la case « Transcrire avec le service de voix
local » (onglet Assistant) écrit `local_dictation` (`AppConfig`, `#[serde(default)]`,
**faux** par défaut ⇒ un fichier de configuration ancien ne change rien).

**Périmètre : la dictée de l'écran Vocal** — c'est là que le micro de l'application
est ouvert. Ailleurs (fenêtre d'édition, onglet agent π) la dictée reste celle du
navigateur, et la phrase de repli le dit au lieu de le laisser croire.

**Le micro ne bouge pas** : une seule capture dans tout le projet (`vocal-mic.js`).
L'oreille locale **consomme** le son déjà capté (robinet `setAudioTap`, muet), elle
n'ouvre ni second flux ni second `getUserMedia`.

**Aucun second chemin de dictée** : `oreille-locale-moteur.js` fabrique un objet de
la **même forme** qu'une session `SpeechRecognition` (`start/stop/onresult/onerror/onend`,
résultat final cumulatif). `createDictationSession(SR)` choisit le fournisseur ; tout le
reste (garde du nom, envoi sur silence, reprise en main, envoi automatique) est écrit
**une seule fois** dans `super-agent.js` et s'applique au texte local comme au texte du
navigateur.

**Le modèle est choisi par le pont, jamais par l'écran**, et il est affiché en clair :
note de la case (phrase de `planLocalEar`) + infobulle du bouton 🎙️ (« transcription sur
cet ordinateur avec « … » »). Un meilleur modèle installé plus tard change la phrase,
pas le code ; Pilot n'installe rien, ne télécharge rien, n'accepte aucune licence.

**Le repli est visible, jamais silencieux** — c'est la règle non négociable :

| Cas | Ce que l'écran dit |
|---|---|
| Case décochée | rien de plus (comportement historique) |
| Service absent / muet / sans modèle français / dictée non prête | phrase dans la conversation **ou** ligne d'état du mode Vocal, disant qu'on **dicte autrement** et que le son repart vers un **service en ligne** |
| Pendant l'écoute (panne du pont, session refusée, abandon) | phrase immédiate disant ce qui est **prouvé** — « La dictée locale s'est arrêtée pendant l'écoute » —, le **détail** de la cause réelle quand le pont le donne, et le retour au navigateur **annoncé** |
| Réglage coché au démarrage | « Je vérifie si la dictée locale peut servir… » avant toute dictée ; l'écoute automatique **attend** la réponse du pont au lieu de partir en ligne |

### L'abandon d'une écoute PRÉVIENT le service (correctif du 2026-11-18)

Un abandon d'écoute (panne du pont, session refusée, écoute jetée) était
silencieux **côté service** : la session restait ouverte pour rien, et c'est la
tentative **suivante** qui la refermait (`asr_voicestudio_start` interrompt la
précédente) — le texte qu'elle avait déjà reconnu partait avec elle, et le
journal se remplissait de « session précédente refermée ».

- **Une seule façon d'abandonner** : `abandonnerSession(id)` dans
  `oreille-locale-moteur.js`, seul site de `asr_voicestudio_cancel` du module,
  utilisée par l'abandon **et** par les deux refus de démarrage. L'arrêt
  **normal** garde son propre chemin (`asr_voicestudio_stop`, le service rend
  son texte final).
- **Le texte déjà obtenu n'est plus jeté** : avant d'abandonner, le moteur
  remet à l'écran ce qu'il a déjà reconnu, par la porte **unique** du texte
  (`onresult`) — l'écran l'écrit dans la zone, et la branche d'erreur ne
  l'efface pas. Rien n'est envoyé pour autant (règle inchangée : aucun envoi sur
  une erreur).
- **La phrase n'accuse plus un service sain** : `localEarFailureMessage` dit la
  seule chose prouvée et laisse la **cause réelle** au détail rendu par le pont
  (qui, lui, nomme le service à bon escient).

Verrou : `src/js/abandon-ecoute-prevenir-le-service.test.js` (14 verrous). Rapport :
`docs/rapports/RAPPORT-correction-abandon-ecoute-locale.md`.

### La session de dictée a une IDENTITÉ — et elle est fermée AVANT la suivante

**Défaut corrigé** (rapport `docs/rapports/RAPPORT-diagnostic-coupure-dictee-locale.md`,
§ 0 et § 4, 11 dictées ouvertes et jamais fermées en 2 min 30) : la dictée locale
« marchait un moment, puis coupait », puis affichait « La dictée n'a pas
fonctionné : écrivez votre demande. ». La cause était dans la **fenêtre**, pas
dans le service :

1. une **fin d'écoute PÉRIMÉE** (celle d'une session remplacée) remettait la
   fenêtre au repos (`voiceActive = false`) alors que la session locale était
   **toujours ouverte** au pont ;
2. le **réarmement** (350-400 ms) appelait donc `startVoiceInput`, qui fabriquait
   une oreille neuve — donc une **session neuve** — sans fermer la précédente ;
3. le pont appliquait sa règle (« une seule dictée à la fois : la précédente est
   refermée », `asr_voicestudio.rs`) : le texte déjà reconnu de la session
   vivante n'arrivait plus ;
4. trois fins vides instantanées atteignaient le plafond
   (`VOCAL_EMPTY_SESSION_LIMIT`), d'où la phrase d'échec.

**Les trois décisions, dans `src/js/session-dictee.js`** (pures, aucun DOM, aucun
import Tauri — donc décidables en test) :

- **l'IDENTITÉ** : un jeton monotone, jamais réutilisé, jamais 0.
  `dictationSessionStillCurrent(registre, jeton)` garde les **trois**
  gestionnaires de l'écran (`onresult`, `onerror`, `onend`) : une fin ou une
  erreur d'une session remplacée ne touche plus à l'état et ne peut donc plus
  armer de réarmement. Un registre absent rend `false` : on ne touche à rien.
- **l'ORDRE** : `startDictationSession(registre, { active, previous, stopPrevious })`
  ferme la session précédente par **son propre chemin d'arrêt** (`stopVoiceInput`
  → `rec.stop()`, donc `asr_voicestudio_stop`, qui rend le texte final) **avant**
  que le jeton n'avance. Le pont n'a plus jamais à refermer lui-même une session,
  donc son texte n'est plus jeté. Une dictée déjà ouverte n'est **jamais**
  refermée par une tentative d'ouverture (idempotence).
- **le TEXTE d'une session remplacée est encore REÇU** (`dictationTextStillAccepted`) :
  son arrêt est asynchrone, ses mots ont déjà été prononcés — les refuser les
  effacerait. **Une seule** session en bénéficie (celle qu'on vient de remplacer),
  jamais une plus ancienne, et **rien d'autre** n'est reçu d'elle : l'état reste
  protégé.

**Le canal du pont est GLOBAL** : `oreille-locale-moteur.js` ignore désormais les
évènements dont le `session_id` n'est pas le sien (`if (origine && sessionId &&
origine !== sessionId) return;`). Sans ce filtre, la fin d'une session remplacée
refermait l'écran de la session **vivante** — c'était le premier domino de la
cascade. Un évènement **sans** `session_id` reste accepté (contrat tolérant).

**Le journal se souvient** : `dictationEndLogLine({ raison, jeton, perimee, dureeMs,
longueurTexte })` compose une ligne (raison, jeton, durée mesurée, **longueur** du
texte, jamais son contenu) écrite dans le journal **existant** du pont
(`asr_voicestudio_log`, commande déjà présente, appel `void`, fail-open). Le
journal du pont ne disait ni la raison d'une fin ni l'identité de la session ;
c'est ce qui avait rendu le diagnostic long.

Verrou : `src/js/fin-de-session-perimee-ne-rearme-pas.test.js` (11 verrous, pont de
test appliquant la règle **réelle** d'`asr_voicestudio.rs`). Quatre mutations ont
été mesurées sur ce verrou : gardes de l'écran neutralisées (1 échec), ordre
d'ouverture inversé (1 échec), filtre de session du moteur retiré (3 échecs),
identité toujours vraie (3 échecs). Rapport :
`docs/rapports/RAPPORT-correction-rearmement-session-perimee.md`.

**La ligne d'état ne ment pas** : elle dit laquelle des deux oreilles écoute
(« J'écoute avec le service local. » / « Le service local est absent : je dicte
autrement. »), dans la ligne **existante**, sans nouvel élément d'interface.

**Limite connue, dite telle quelle** : la latence du service local reste de l'ordre de
**~9,5 s de texte final pour ~5,6 s de parole** (mesurée à l'étape 1). La dictée reste
utilisable (les partiels s'écrivent au fil de l'eau), mais elle **n'est pas fluide** et
ce document ne prétend pas le contraire.

Verrous : `src/js/oreille-locale-etape2.test.js` (28 verrous) + `oreille-locale-etape1.test.js`
(la porte unique) + `vocal-nom-garde.test.js` (la garde du nom, intacte).
Rapport : `docs/rapports/RAPPORT-oreille-locale-etape2-ecran-branche.md`.

---

<!-- HELP:dictee-vocale -->
## Dictée vocale 🎙️

Pilot intègre la dictée vocale (Web Speech API, langue `fr-FR`) pour saisir du
texte à la voix.

- **Dans l'éditeur / l'agent Pi (desktop)** : bouton 🎙️. Fonctionne en contexte
  sécurisé (HTTPS ou `localhost`).
- **Sur le web distant** : le micro exige **HTTPS** (Secure Context). Cocher
  « Exposer en HTTPS automatique (Tailscale Serve) » dans les Options →
  Accès distant, puis utiliser le bouton 🎙️ depuis le téléphone/autre poste.
- La transcription alimente directement la zone de saisie active (éditeur ou
  saisie de l'agent, ou saisie de l'Assistant 🧭).
- **Dans l'onglet agent Pi, dans l'Assistant 🧭 ET sur le web distant, à la fin
  d'une dictée, le message part tout seul** (comme si vous aviez appuyé sur
  Entrée) : vous n'avez plus à valider. Rien ne part si vous n'avez rien dicté, ni
  si la dictée s'arrête sur une erreur (micro refusé, réseau coupé) : dans ce cas
  le texte reste dans la zone, à vous de le relire. Un seul message part par
  dictée, même si vous parlez longtemps.
- **Vous gardez toujours la main** : si vous tapez dans la zone pendant que vous
  dictez, ce que vous écrivez n'est pas écrasé et rien ne part sans votre
  validation — sur le bureau comme sur le web distant.
- Arrêter la dictée en réappuyant sur 🎙️ n'envoie jamais le message : c'est vous
  qui décidez.
- **Dans l'écran Vocal, aucun bouton à toucher** : parler suffit. La dictée
  s'ouvre toute seule quand Pilot se tait, se ferme pendant qu'il parle ou qu'il
  travaille, et se rouvre à la fin de sa réponse — le texte part tout seul, comme
  ci-dessus, **après votre dernier mot** (chaque nouveau mot repousse l'échéance,
  et **le son de votre voix aussi** tant qu'il est capté : la dictée ne se
  referme pas au milieu d'une phrase quand la transcription prend du retard —
  plafond de 15 s contre un bruit de fond permanent, voir
  `spec_modes_ecran_vocal.md` § 6bis.1 ter, donc rien ne part tant que vous parlez). **L'écoute repart d'elle-même après
  chaque réponse** : si Pilot finit à peine sa phrase ou si le micro se libère un
  instant plus tard, elle réessaie quelques instants (jamais indéfiniment) au lieu
  de rester fermée — le rond « Réveiller … » n'est donc qu'un **secours**. **Un
  silence n'arrête rien** : quand
  vous vous taisez un moment, l'écoute se referme et **se rouvre toute seule**,
  sans message d'échec — vous reprenez la parole quand vous voulez. Ce **délai
  d'envoi** (deux secondes
  par défaut) se règle dans ⚙️ Options → onglet **« Assistant »** → section
  **« Mode Vocal »**, de **1 à 5 secondes**. Un appui
  sur 🎙️ arrête la dictée et elle ne se rouvre pas contre
  votre volonté. En quittant le mode Vocal, le micro est coupé. Sur un **projet
  sensible** (dictée cloud), l'écran Vocal ne dicte pas. Si la dictée ne peut pas
  démarrer (micro refusé, occupé, réseau absent), la phrase s'affiche **dans la
  ligne d'état de l'écran** et vous continuez au clavier.
- **Dans l'écran Vocal seulement, la dictée n'obéit qu'à son nom** : une phrase
  qui ne contient pas le nom de l'assistante ne part pas, ne s'écrit pas et ne
  s'affiche pas (le micro, lui, reste ouvert). Le bouton **« Réveiller <Nom> »**
  lève cette garde pour **une** phrase, et le **clavier** n'est jamais filtré.
  Détail : `spec_modes_ecran_vocal.md` § 6quater. **Partout ailleurs, rien ne
  change** : la dictée de l'éditeur, de l'onglet agent π, de l'Assistant 🧭 et du
  web distant n'exige aucun nom.
- **Dicter sans qu'aucun son ne parte vers Internet** : ⚙️ Options → onglet
  **« Assistant »**, cocher **« Transcrire avec le service de voix local »**.
  **Dans l'écran Vocal**, la transcription est alors faite **sur cet ordinateur**
  par le logiciel de voix local (VoiceStudio) ; ailleurs (fenêtre d'édition,
  onglet agent), la dictée reste celle du navigateur et Pilot le dit. La case
  indique sous elle **quel modèle** est employé
  (choisi tout seul parmi ceux qui sont installés) : Pilot n'installe rien, ne
  télécharge rien et n'accepte aucune licence à votre place. Laisser la case
  décochée garde la dictée habituelle (moteur du navigateur, donc un service en
  ligne). **Si le logiciel local est absent, ou s'il s'arrête en pleine dictée,
  Pilot revient à la dictée du navigateur et vous le dit à l'écran** — il ne
  bascule jamais en silence. Limite connue : la transcription locale est plus
  lente (le texte définitif arrive quelques secondes après votre dernier mot) ;
  le texte s'écrit au fur et à mesure, vous n'avez pas à attendre pour parler.
- **La dictée ne s'arrête plus toute seule** : avant, au bout d'un moment, elle
  cessait de répondre puis affichait « La dictée n'a pas fonctionné : écrivez
  votre demande. ». Une dictée qui se termine ne peut plus refermer celle qui
  est **en cours**, et Pilot ferme toujours proprement la précédente **avant**
  d'en ouvrir une nouvelle : ce que vous avez déjà dicté n'est plus perdu.
<!-- /HELP:dictee-vocale -->
