# RAPPORT — Diagnostic : « des soucis, et des erreurs » après la dictée locale réussie

Date : 2026-11-10 (investigation menée vers 11:10–11:25, heure locale du poste)
Projet : `G:\IA_PL\pilot` — `HEAD` = `b213d9a`
Contexte : Pilot lancé par `npm run tauri dev` (identifiant `com.pilot.editor.dev`), case
**« Transcrire avec le service de voix local »** cochée, service VoiceStudio sur
`http://127.0.0.1:3900`, test de reconnaissance avec le modèle **Parakeet TDT v3**
**concluant** (transcription française obtenue). Puis des erreurs, de nature incertaine, et
**aucun rapport exploitable du mode dev**.

> **Diagnostic seul.** Aucun fichier de code, de test, de configuration ni d'aide n'a été
> modifié. Aucun réglage ni fichier de VoiceStudio n'a été touché, rien n'a été installé,
> téléchargé, relancé ni redémarré, aucun commit, aucune suite de tests lancée.
> **Un seul fichier est écrit : celui-ci.** Une copie temporaire de la réponse HTTP
> `/dictation/models` a transité par `%LOCALAPPDATA%\Temp` puis a été supprimée.

---

## 1. Les fichiers de trace : ce qui existe vraiment

| Chemin | Taille | Dernière écriture | Rôle réel |
|---|---|---|---|
| `%APPDATA%\com.pilot.editor.dev\voix-locale\voix-locale.log` | 10 440 o (82 lignes) | **2026-11-10 10:51:46** | **journal unique** de la voix locale (Piper), de la voix imitée et de l'**oreille locale** |
| `%APPDATA%\com.pilot.editor.dev\config.json` | 15 756 o | 2026-11-10 10:50:26 | réglages du mode dev (`local_dictation`, `vocal_silence_send_ms`…) |
| `%APPDATA%\com.pilot.editor.dev\agent-ops.log` | — | 2026-11-10 11:04:53 | agents de projet (aucun rapport avec la dictée) |
| `%APPDATA%\com.pilot.editor.dev\super-agent.db` | — | 2026-11-10 11:06:01 | base de suivi de l'assistant (aucune table de dictée) |
| `%APPDATA%\com.pilot.editor.dev\laya.log`, `pilot.db`, `web_audit.jsonl` | — | 11:06 | sans rapport (laya, onglets, un `set_password`) |
| `%APPDATA%\com.pilot.editor\voix-locale\voix-locale.log` | — | 2026-11-10 10:12:56 | journal de la version **installée** (autre dossier de données) |

**Ce qui n'existe pas — et c'est la réponse à « je n'ai pas pu obtenir un rapport correct du
mode dev » :**

- **Aucune trace stdout/stderr du mode dev sur disque.** `scripts/tauri.js:18` lance
  `tauri dev` avec `stdio: "inherit"` : tout ce qui s'affiche dans le terminal est perdu à la
  fermeture du terminal. Rien n'est redirigé vers un fichier.
- **Aucun crochet global d'erreur côté fenêtre** : le seul écouteur du dépôt est
  `window.addEventListener("unhandledrejection", …)` (`src/js/gds.js:98`) ; il n'y a ni
  `window.onerror`, ni envoi de la console vers un journal. Les messages d'erreur **affichés**
  par l'écran Vocal ne sont écrits nulle part : ils vivent dans le DOM et disparaissent.
- **Aucun journal texte de VoiceStudio** : `%APPDATA%\VoiceStudio` ne contient que des caches
  Chromium (aucun `.log` applicatif) ; `%APPDATA%\VoiceStudio\runtime` contient le service
  Python (`omnivoice`, `.venv`, torch) mais aucun fichier de journal.
- **Aucun plantage enregistré** : `%LOCALAPPDATA%\CrashDumps` ne contient aucun vidage pour
  `pilot.exe`, `msedgewebview2.exe` ni `VoiceStudio.exe` (les seuls `.dmp` datent du 19-10,
  30-10 et 04-11 et concernent `conhost.exe` / `AcPowerNotification.exe`) ; le journal
  d'événements Windows (Application, dernières 24 h) ne porte aucune entrée pour ces
  exécutants.
- **Aucune table de journal de dictée** dans `super-agent.db` (`clients`, `projects`, `tasks`,
  `decisions`, `session_summaries`, `injection_logs`, `assistant_*`).

**Conséquence de méthode** : la seule source de vérité exploitable pour la dictée locale est
`voix-locale.log`, côté **pont Rust**. Le **côté fenêtre** (JS) n'écrit rien : on ne peut donc
pas lire le texte exact des messages affichés, mais on peut **déduire** le chemin qui les a
produits (§ 4).

---

## 2. Le service local n'est pas en cause (vérifié en lecture seule aujourd'hui)

| Contrôle | Réponse |
|---|---|
| `GET /health` | `{"status":"ok","device":"cuda (NVIDIA GeForce RTX 5080)","version":"0.5.7"}` |
| `GET /dictation/readiness` | `{"ready": true, "missing": null}` |
| `GET /dictation/models` | moteur disponible (`engine_available: true`), `default_model_id: sherpa-whisper-tiny`, **`sherpa-parakeet-tdt-v3` `installed: true`** (« 25 European languages ») |
| licence Parakeet v3 | `GET /models/licenses/acceptance/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` → acceptée le **2026-11-10T06:48:05Z** (= **10:48:05** heure locale) |

Le service **tourne**, il est **prêt**, le modèle employé au moment du test est **installé** et
sa licence a été acceptée **2 min 43 s avant** la première dictée Parakeet réussie. Les erreurs
de 10:51 ne viennent donc pas d'un service arrêté ni d'un modèle manquant.

> Observation, sans incidence sur la conclusion : à l'heure du diagnostic, le catalogue annonce
> `sherpa-whisper-tiny` **`installed: false`**, alors que le journal du matin montre des
> sessions ouvertes sur « Whisper Tiny » (10:14). Or `pick_candidates`
> (`src-tauri/src/asr_voicestudio.rs:288-292`) ne retient que des modèles **installés** : cet
> état a donc **changé depuis 10:14**. Pourquoi : **non établi** (aucune trace).

---

## 3. Chronologie établie, à la seconde (`voix-locale.log`, lignes 36 à 82)

Deux exécutions distinctes du mode dev apparaissent (le pont est neuf entre les deux : aucune
ligne « session précédente refermée » ne relie 10:14:53 à 10:50:48, donc **l'application a été
relancée** entre-temps).

**Exécution A — modèle « Whisper Tiny » (13 ouvertures, 10:14:09 → 10:14:53)**

| Heure | Ligne du journal |
|---|---|
| 10:14:09 | `dictée locale ouverte (Whisper Tiny)` |
| 10:14:13 | `dictée locale refermée (attente du texte final)` *(seul arrêt demandé)* |
| 10:14:14 → 10:14:53 | **12 ×** `session précédente refermée` + `dictée locale ouverte (Whisper Tiny)`, souvent à moins d'une seconde d'intervalle (10:14:14, :15, :35, :36, :52, :53) |
| 10:14:53 | dernière ouverture : **jamais refermée** dans cette exécution (l'application est relancée plus tard) |

**Exécution B — modèle « Parakeet TDT v3 » (11 ouvertures, 10:50:48 → 10:51:46) — la session du test réussi**

| Heure | Ligne du journal | Durée |
|---|---|---|
| 10:50:48 | `dictée locale ouverte (Parakeet TDT v3)` | |
| 10:50:55 | `dictée locale refermée (attente du texte final)` | 7 s |
| 10:50:57 | `dictée locale ouverte (Parakeet TDT v3)` | |
| 10:51:02 | `dictée locale refermée (attente du texte final)` | 5 s |
| 10:51:03 | `dictée locale ouverte (Parakeet TDT v3)` | |
| **10:51:27** | `dictée locale refermée (attente du texte final)` | **24 s — le test concluant** |
| 10:51:27 | `dictée locale ouverte (Parakeet TDT v3)` | **abandonnée** |
| 10:51:28 | `session précédente refermée` + ouverture (× 3 fois) | |
| 10:51:29 | idem (1 fois) | |
| *(16 s)* | | |
| 10:51:45 | idem (2 fois) | |
| 10:51:46 | idem (2 fois) → **dernière ouverture, jamais refermée** | |

**Comptes exacts, sans interprétation :** 24 `dictée locale ouverte`, 4 `dictée locale refermée
(attente du texte final)`, 19 `session précédente refermée`, et **deux sessions jamais
refermées** (10:14:53 et 10:51:46). **Zéro** `dictée locale interrompue`, **zéro** `texte final
absent`, **zéro** `flux interrompu`, **zéro** `session refermée sans texte final`, **zéro**
`service : …`, **zéro** `session impossible`, **zéro** `modèle refusé par le service`.

Les 8 ouvertures de 10:51:27 → 10:51:46 sont donc **huit tentatives consécutives** après la
dictée réussie, en trois salves (4, 2, 2) séparées par 16 s.

---

## 4. Ce que ces comptes **prouvent** (déduction, pas supposition)

### 4.1 « Session précédente refermée » = la fenêtre a **abandonné** une session encore vivante

`asr_voicestudio_start` ne journalise `session précédente refermée` que si le **créneau est
encore occupé**, et il envoie alors `Cancel` à l'ancienne session
(`src-tauri/src/asr_voicestudio.rs:1100-1105`). Le créneau n'est libéré que lorsque la tâche de
session se termine (`…:1129-1140`).

Or une session ne se termine que sur **trois** causes : le service ferme le flux, un `End`
(arrêt demandé) ou un `Cancel` (interruption). Ces trois causes **laissent une trace** dans le
journal (`refermée (attente du texte final)`, `interrompue`, `sans texte final`,
`flux interrompu`, `texte final absent`). **Aucune de ces lignes n'apparaît entre deux
ouvertures d'une salve.** Il n'y a donc **aucun arrêt demandé** et **aucune fin de session**
entre elles : la session précédente était **toujours ouverte et vivante** au moment de
l'ouverture suivante.

Côté fenêtre, il n'existe **qu'un seul** chemin qui abandonne une session sans la refermer :
`panner()` (`src/js/oreille-locale-moteur.js:123-135`) — il retire l'écoute, prévient l'écran…
et **ne prévient jamais le pont**. Les autres chemins sont exclus :

| Chemin côté fenêtre | Effet sur le pont | Trace attendue | Présente ? |
|---|---|---|---|
| arrêt demandé (`arreter()`, `…:336-338`) | `asr_voicestudio_stop` | `refermée (attente du texte final)` | 4 fois, et **jamais** entre deux ouvertures d'une salve |
| ouverture annulée pendant le démarrage (`…:266-281`) | `asr_voicestudio_cancel` | `interrompue` | **jamais** |
| écoute impossible (`…:310-317`) | `asr_voicestudio_cancel` | `interrompue` | **jamais** |
| **panne signalée (`panner()`)** | **rien** | **aucune** | ✔ **c'est le cas** |
| fin reçue du pont (`ended` → `finir()`) | — | la session se termine côté service | contredit le créneau encore occupé |

**Conclusion (établie) : chacune des 19 sessions remplacées a fait l'objet d'une panne
signalée par la fenêtre — donc d'un message d'erreur à l'écran — immédiatement après son
ouverture.** C'est cela, « des soucis, et des erreurs ».

### 4.2 Le message affiché accuse le service local, à tort

Toute panne locale passe par `localEarFailureMessage`
(`src/js/oreille-locale.js:231-246`) et s'affiche ainsi :

> « Le service de voix local s'est arrêté pendant la dictée **(détail)**. Rien n'a été envoyé.
> Je repasse à la dictée du navigateur, donc à un service en ligne. »

Le service, lui, **n'a jamais été en cause** (§ 2) : `health` ok, `readiness` prête, modèle
installé, et le pont n'a journalisé **aucune** panne réseau de session. La phrase est donc
**fausse dans son diagnostic** chaque fois que la cause est côté fenêtre — et c'est
précisément ce qui rend les erreurs « de nature incertaine » pour l'utilisateur.

Second effet : `rec.onerror` remet le statut du service à `null`
(`src/js/super-agent.js:5778-5786`), ce qui **annonce le repli** sur la dictée du navigateur ;
or les ouvertures suivantes sont de nouveau **locales** (`Parakeet TDT v3`). L'écran a donc dit
une chose et fait l'autre.

### 4.3 Fuite : une session abandonnée reste ouverte jusqu'à la tentative suivante

`panner()` ne joint jamais le pont : la session reste **vivante** (socket vers le service
ouverte, plus aucun son puisqu'entre-temps `fermerRobinet()` a retiré le robinet du micro).
Symptômes mesurables : 19 lignes `session précédente refermée`, et **deux sessions que rien
n'a jamais fermées** — dont celle de 10:51:46, qui n'a été libérée que par la **fin du
processus** (le mode dev n'est plus lancé ; seul `pilot.exe` installé, démarré à 09:12, tourne).

Conséquence directe sur le travail de l'utilisateur : `Cancel` est envoyé à la session
précédente (`…:1102-1104`), donc **le texte final qu'elle aurait rendu est jeté**. Une dictée
en cours de transcription peut ainsi être perdue par la tentative suivante.

### 4.4 Après une panne, plus aucun réarmement automatique

`decideVocalDictation` refuse d'armer tant qu'une erreur est affichée (règle 6,
`src/js/vocal-conversation.js:424-426`) et cette raison n'est **jamais** reprise automatiquement
(`VOCAL_RESUME_TRANSIENT_REASONS`, `…:165-176`). Seuls un **geste 🎙️** (qui efface l'erreur) ou
une nouvelle entrée dans le mode relancent l'écoute. C'est cohérent avec les salves observées
(3-4 ouvertures en 1-2 s : autant de clics), puis 16 s de lecture du message avant un nouveau
clic, et enfin l'arrêt complet après 10:51:46.

---

## 5. Nature exacte de la panne : ce qui est établi, ce qui ne l'est pas

Le message affiché contient entre parenthèses le **détail** de la panne. Le journal ne le
contient pas ; ce qui suit est donc classé par force de preuve.

### Établi

1. Les erreurs sont **côté fenêtre**, pas côté service (pont sain, journal sans panne réseau).
2. Elles surviennent **moins d'une seconde après une ouverture réussie** (sinon le créneau
   serait libre à l'ouverture suivante).
3. Elles sont **affichées** sous la forme de la phrase du § 4.2, et elles **laissent la session
   ouverte** côté pont.
4. Le service était **sain** et le modèle **installé** à ce moment ; le réseau local n'a jamais
   échoué dans les traces.

### Le détail le plus probable (haute vraisemblance, non prouvé)

Après une ouverture réussie, les seuls détails possibles sont au nombre de trois :

| Détail possible | Message du pont | Compatible avec « session laissée ouverte » ? | Vraisemblance |
|---|---|---|---|
| `le son du micro n'a pas pu être dirigé vers la dictée locale` (`oreille-locale-moteur.js:320-329`) | aucun (échec silencieux de `setAudioTap`) | **oui** | **la plus forte** |
| `cette session de dictée locale n'est plus la session courante` / `aucune session de dictée locale n'est ouverte` (`asr_voicestudio.rs:805-806`, via un envoi de son refusé) | aucun | oui | moyenne : suppose un envoi provenant d'une session périmée |
| `le pont de dictée locale n'a pas ouvert de session` (`…:288`) | — | **non** (rien ne serait resté ouvert) | exclue |

Le premier cas mérite une explication concrète : `setAudioTap` échoue quand `brancherRobinet`
n'a **ni contexte audio ni source** (`src/js/vocal-mic.js:936-937`), c'est-à-dire quand la
**capture du micro n'est plus ouverte**. Cette capture était pourtant ouverte 30 s plus tôt
(les trois dictées Parakeet ont reçu du son). Deux circonstances rendent cette perte crédible
**sur ce poste**, sans qu'aucune trace ne la confirme : la session Windows est une session
**Bureau à distance** (`RDP-Tcp#1`), dont la redirection audio peut disparaître, et le module
prévoit lui-même une **reprise automatique après une perte passagère** de piste
(`micFailureIsRecoverable`, `src/js/vocal-mic.js:151`). La capture perdue produirait de surcroît son propre
message d'écran, distinct de celui de la dictée.

### Non établi (à ne pas présenter comme un fait)

- Le **texte exact du détail** affiché entre parenthèses, et l'heure exacte de chaque message
  (aucun journal côté fenêtre : § 1).
- La **cause matérielle** d'un éventuel refus du robinet (perte de capture RDP, périphérique
  pris par un autre logiciel, ré-énumération…) : aucune trace disque.
- L'explication de l'**écart de 16 s** entre les salves : aucune minuterie de dictée ne vaut
  cette durée (350 / 400 / 1 500 / 2 500 ms) ; l'hypothèse d'un geste humain est la plus
  simple, elle n'est pas prouvée.
- La raison du changement d'état de `sherpa-whisper-tiny` (`installed: false` aujourd'hui).

---

## 6. Point le plus probable à corriger

**Un seul point, et il est prouvé par les traces : `panner()`
(`src/js/oreille-locale-moteur.js:123-135`) abandonne la session sans prévenir le pont.**
Il doit être le pendant exact de `arreter()` : prévenir le pont (`asr_voicestudio_cancel`) avant
de rendre la main. Trois défauts en découlent, tous visibles dans le journal :

1. la session reste vivante et le créneau occupé → `session précédente refermée` (19 fois) ;
2. le texte final de la dictée abandonnée est **jeté** par le `Cancel` de la tentative suivante ;
3. la cause réelle de la panne est **masquée** derrière une phrase qui accuse le service local
   (§ 4.2), ce qui interdit à l'utilisateur — et au prochain diagnostic — de savoir ce qui a
   échoué.

Ensuite seulement, deux points secondaires méritent d'être regardés, sans être confondus avec
le premier : (a) la phrase d'échec ne devrait nommer le service que si le service a réellement
échoué ; (b) la perte de capture du micro (§ 5) reste à prouver ou à écarter.

### Ce qui trancherait en deux minutes, sans modifier une ligne

1. Relancer le mode dev et reproduire ; **lire le détail entre parenthèses** de la phrase. Il
   nomme la cause : robinet du micro, session périmée, ou envoi refusé.
2. Au même instant, la **ligne d'état** du mode Vocal : si elle parle du micro, la perte de
   capture est confirmée ; si elle parle du service, c'est le pont.
3. Avant et après, `GET /dictation/readiness` : si la réponse change, le service est en cause ;
   si elle ne change pas, il ne l'est pas.

---

## 7. Pistes voisines, à ne pas confondre

- **Erreurs de la voix imitée (lecture à voix haute), 2026-11-09 13:33 → 13:38** — 32 lignes
  dans le même journal : `[voix imitée] Aucun son imité — service injoignable (error sending
  request for url (http://127.0.0.1:3900/profiles))`, `Synthèse imitée impossible`,
  `Voix imitée indisponible`, toutes suivies de « repli sur la voix locale ». **Rien à voir avec
  la dictée** : ces lignes précèdent de 21 h les erreurs décrites ici, et le service répond
  aujourd'hui sans difficulté.
- **Piper absent, 2026-10-24 23:37** — 3 lignes `Voix francaise locale non installee`
  (`il manque le moteur Piper (piper.exe)`) : lecture, pas dictée, et hors période.
- **Rapport voisin du même matin** : `docs/rapports/RAPPORT-dictee-echec-apres-reponse.md`
  (écrit à **11:05:33**, non suivi par Git), qui traite du message « La dictée n'a pas
  fonctionné : écrivez votre demande. » juste après une réponse lue. Il avance l'hypothèse
  « sessions périmées » (garde d'identité `voiceRec !== rec` absente de `super-agent.js` —
  vérifié : toujours absente). Cette hypothèse reste plausible pour **l'affichage** et la
  cascade, mais **elle ne rend pas compte du fait établi ici** : une session abandonnée reste
  ouverte côté pont, ce qui exige le chemin `panner()` du § 4.1. Les deux défauts peuvent
  coexister ; le diagnostic ci-dessus ne les confond pas.

---

## 8. Réponse courte à la question posée

- **Nature des erreurs** : pannes **côté fenêtre** signalées par l'écran Vocal, pas pannes du
  service local. Le service est sain, le modèle Parakeet est installé, sa licence a été
  acceptée à 10:48:05, et trois dictées ont abouti (7 s, 5 s, 24 s) entre 10:50:48 et 10:51:27.
- **Moment** : à partir de 10:51:27 — immédiatement après l'envoi de la dictée réussie — huit
  tentatives en 19 s, en trois salves, dont **aucune n'a été refermée proprement**, la dernière
  restant ouverte jusqu'à la fermeture de l'application.
- **Ce qui s'est passé juste avant** : l'arrêt demandé de la dictée de 24 s
  (`refermée (attente du texte final)`, 10:51:27), donc l'envoi de la demande et l'attente de la
  réponse — le contexte exact décrit par le rapport voisin de 11:05.
- **Cause exacte** : **non établie** (le détail du message n'est écrit nulle part), mais le
  chemin est **prouvé** (§ 4.1) et le point à corriger est **unique et localisé** (§ 6).

---

## 9. Fichiers touchés

- **Écrit** : `docs/rapports/RAPPORT-diagnostic-erreurs-dictee-locale.md` (ce rapport).
- **Modifiés** : aucun. `git status` ne montre, avant et après, que des rapports non suivis.
- **Consultés** : `%APPDATA%\com.pilot.editor.dev\{voix-locale\voix-locale.log,config.json,
  agent-ops.log,super-agent.db}`, `%APPDATA%\com.pilot.editor\voix-locale\voix-locale.log`,
  `%APPDATA%\VoiceStudio`, `%LOCALAPPDATA%\CrashDumps`, journal d'événements Windows
  (Application, 24 h), et dans le dépôt : `src-tauri/src/asr_voicestudio.rs`,
  `src/js/oreille-locale-moteur.js`, `src/js/oreille-locale.js`, `src/js/vocal-mic.js`,
  `src/js/vocal-conversation.js`, `src/js/super-agent.js`, `src/js/gds.js`, `scripts/tauri.js`.
- **Service local** : interrogé en lecture seule (`/health`, `/dictation/readiness`,
  `/dictation/models`, licences). Aucun réglage, aucun fichier, aucune session créée.

`DONE: Les erreurs de 10:51 sont des pannes signalées par la fenêtre (chemin panner), pas des pannes du service local : 8 sessions ouvertes après la dictée réussie de 24 s, dont 7 abandonnées sans être refermées (d'où 19 « session précédente refermée » et un texte final jeté) et 1 laissée ouverte jusqu'à la fermeture de l'app ; le message affiché accuse à tort le service de voix local ; cause exacte non établie faute de journal côté fenêtre (tauri dev en stdio inherit, aucun window.onerror, aucun log VoiceStudio), point unique à corriger : panner() doit prévenir le pont (asr_voicestudio_cancel) comme le fait arreter(). Rapport écrit dans docs/rapports/RAPPORT-diagnostic-erreurs-dictee-locale.md, aucun autre fichier touché.`
