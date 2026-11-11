# Rapport — l'écoute du mode Vocal se coupe avant la fin de la phrase

Diagnostic seul (aucune modification : ni code, ni test, ni réglage, ni service).
Date : 2026-11-10, 15 h 20. Projet : `G:\IA_PL\pilot`, mode dev
(`com.pilot.editor.dev`). Oreille : service de voix local VoiceStudio, modèle
Parakeet TDT v3.

---

## 1. Conclusion, en clair

**En mode Vocal, ce n'est pas le service de voix qui décide que vous avez fini :
c'est Pilot.** La fenêtre referme elle-même la dictée **dès qu'il s'écoule un
silence sans NOUVEAU mot transcrit** — et sur ce poste ce silence vaut
**1,5 seconde** (réglage `vocal_silence_send_ms = 1500`), alors que le défaut du
produit est 2 s.

Conséquences directes, qui collent au symptôme :

- une **pause de 1,5 s à l'intérieur d'une phrase** (le temps de chercher un mot)
  suffit à refermer l'écoute : tout ce qui suit n'est jamais entendu, et la
  demande part avec la moitié de la phrase ;
- comme le minuteur ne compte que les **mots transcrits** (jamais le son), un
  **retard de transcription** du service (aucun texte nouveau pendant 1,5 s alors
  que vous parlez) coupe « bien avant la fin », sans que vous ayez fait la
  moindre pause.

Le chronomètre est **prouvé** (8 fins d'écoute sur 8 « avec texte » viennent de
lui, voir § 4). Ce qui **n'est pas établi**, c'est la part exacte, dans vos
essais, entre « vraie pause » et « retard de transcription » : aucune trace ne
date les textes partiels du service (§ 6).

---

## 2. Ce qui termine l'écoute, et avec quelles valeurs

| Mécanisme | Valeur réelle | Où elle est définie |
|---|---|---|
| **Minuteur d'envoi sur silence** (mode Vocal) — le seul à couper | **1 500 ms** sur ce poste | configuration `%APPDATA%\com.pilot.editor.dev\config.json`, clé `vocal_silence_send_ms` (fichier écrit le 2026-11-10 15:14:09) |
| — défaut du produit | 2 000 ms | `src/js/vocal-conversation.js:244` (`VOCAL_SILENCE_SEND_MS`) |
| — bornes et pas du réglage | 1 000 ms mini, 5 000 ms maxi, pas de 500 ms | `src/js/vocal-conversation.js:247-251`, normalisation `:262` (`normalizeVocalSilenceSendMs`) |
| — curseur de l'écran de réglage | `min="1000" max="5000" step="500"` | `index.html:1505` |
| Ce qui **repousse** l'échéance | un texte reçu **et différent** du précédent (`transcript !== dernierTexte`) | `src/js/super-agent.js:5849-5851` → `vocalNoteWord()` `:7678` → `setTimeout(..., delai)` `:7686` → `vocalCloseForSend()` `:7659` → `rec.stop()` `:7667` |
| Ce qui **ne** la repousse **pas** | le **niveau du micro** (le son réel), et un texte identique au précédent | `vocalSetLevel` `:6398-6407` ne remet à zéro que la veille de 20 s (`VOCAL_ECOUTE_LIBRE_MS = 20000`, `src/js/vocal-nom-garde.js:144`) |
| Fin de silence annoncée par le moteur | **ne termine rien** avec l'oreille locale : le pont ne reçoit la fin de flux que si Pilot la demande | `src-tauri/src/asr_voicestudio.rs` (`END_FRAME` + `SessionInput::End`) |
| Plafond des dictées vides | 3 fins vides dans une fenêtre de 30 s ; une session de moins de **1 000 ms** compte comme boucle, pas comme silence | `VOCAL_EMPTY_SESSION_LIMIT = 3`, `VOCAL_EMPTY_SESSION_WINDOW_MS = 30000`, `VOICE_EMPTY_SESSION_INSTANT_MS = 1000` (`src/js/voice-auto-send.js`) |
| Délais du pont Rust (aucun ne coupe une écoute en cours) | 5 s (sonde), 20 s (ouverture de session), 20 s (texte final **après** la fin du flux seulement) | `src-tauri/src/asr_voicestudio.rs:66-76` |

Le minuteur est **annulé** (et non raccourci) pendant que Pilot parle ou qu'il
travaille, hors du mode, ou si vous avez tapé dans la zone
(`decideVocalSilenceSend`, `src/js/vocal-conversation.js:575-620`). Il n'est
**jamais reprogrammé** quand la garde se lève : seul un nouveau mot le réarme
(`vocalSyncSilenceSend`, `super-agent.js:7702`). D'où deux effets opposés, tous
deux cohérents avec le ressenti : ça coupe pendant une hésitation, et à
l'inverse une dictée peut rester ouverte sans rien faire si le premier mot n'est
jamais transcrit.

---

## 3. Mode Vocal / dictée de la zone de saisie : même valeur, **pas** le même effet

Le module est le même, mais sa **première règle** le désarme hors du mode Vocal :

- `decideVocalSilenceSend` → « 1. Hors du mode Vocal : cet écran n'envoie rien
  tout seul » (`vocal-conversation.js`, règle 1, raison `hors-mode`) ;
- « mode ouvert » = `vocalOverlay !== null` (`super-agent.js:7799`), c'est-à-dire
  **l'écran Vocal seulement**.

Donc, **dans la zone de saisie** (onglet agent π, onglet Assistant hors mode
Vocal), ce minuteur de 1,5 s **n'existe pas** : l'écoute s'arrête quand le
moteur le dit (navigateur) ou quand **vous** appuyez sur 🎙️. Avec l'oreille
locale, ce dernier cas est le seul : le service ne referme jamais la session de
lui-même, et le pont n'envoie la fin de flux que sur demande de la fenêtre. Il
n'y a donc, dans la zone de saisie, **aucune détection de fin par le silence** —
d'où l'absence du symptôme à cet endroit.

---

## 4. Journaux du dernier essai (2026-11-10, 15 h 14 → 15 h 17)

Journal unique : `%APPDATA%\com.pilot.editor.dev\voix-locale\voix-locale.log`
(17 692 octets, 163 lignes, **dernière écriture 2026-11-10 15:17:50**). La raison
de fin **apparaît** bien (correctif `4c32f6f`, format
`raison=… jeton=… session=… duree_ms=… texte_caracteres=…`, sans le contenu).

| Jeton | Ouverture | Fermeture demandée | Durée mesurée | Texte reconnu | Raison enregistrée | Qui a refermé |
|---|---|---|---|---|---|---|
| 1 | 15:14:10 | 15:14:25 | 17 411 ms | 88 car. | `fin-normale-avec-texte` | minuteur de silence |
| 2 | 15:14:27 | 15:14:30 | 2 865 ms | 0 | `session-fermee` | désarmement (Pilot parle/travaille) |
| 3 | 15:14:34 | 15:14:41 | 8 132 ms | 92 car. | `fin-normale-avec-texte` | minuteur de silence |
| 4 | 15:14:43 | 15:14:46 | 3 347 ms | 0 | `session-fermee` | désarmement |
| 5 | 15:14:59 | 15:15:05 | 7 941 ms | 80 car. | `fin-normale-avec-texte` | minuteur de silence |
| 6 | 15:15:07 | 15:15:09 | 2 120 ms | 0 | `session-fermee` | désarmement |
| 7 | 15:15:23 | 15:15:29 | 8 381 ms | 117 car. | `fin-normale-avec-texte` | minuteur de silence |
| 8 | 15:15:31 | 15:15:38 | 7 432 ms | **5 car.** | `fin-normale-avec-texte` | minuteur de silence |
| 9 | 15:15:39 | 15:15:41 | 0 ms | 0 | `fin-perimee` | oreille remplacée (garde `4c32f6f`) |
| 10 | 15:15:41 | 15:15:43 | 2 515 ms | 0 | `session-fermee` | désarmement |
| 11 | 15:15:48 | 15:16:03 | 15 106 ms | **0** | `session-fermee` | désarmement (15 s sans un mot) |
| 12 | 15:17:33 | 15:17:39 | 8 655 ms | 122 car. | `fin-normale-avec-texte` | minuteur de silence |
| 13 | 15:17:42 | 15:17:48 | 7 566 ms | **11 car.** | `fin-normale-avec-texte` | minuteur de silence |
| 14 | 15:17:50 | — | — | — | **aucune ligne** | session ouverte, jamais refermée dans le journal |

**La preuve que c'est le minuteur de la fenêtre** (et non le service, ni le
pont) : 8 fins sur 8 portent `fin-normale-avec-texte`, ce qui signifie que
`voiceActive` était **encore vrai** dans `onend` (`super-agent.js:5913-5920`).
Une dictée refermée autrement que par `vocalCloseForSend` passe par
`stopVoiceInput()`, qui met `voiceActive = false` avant l'arrêt et produirait
`session-fermee` (c'est exactement ce que montrent les 8 lignes
`session-fermee`). Or `rec.stop()` **sans** `stopVoiceInput()` n'a qu'un seul
appelant dans tout le fichier : `vocalCloseForSend` (`:7667`), lui-même appelé
par un seul endroit, l'échéance du minuteur (`:7692`).

Les trois lignes en gras du tableau (5 caractères pour 7,4 s, 11 caractères pour
7,5 s, 0 caractère pour 15,1 s) sont les traces les plus proches de la plainte :
le micro était ouvert longtemps, et il n'en est sorti presque rien.

---

## 5. Service de voix / pont / fenêtre : qui parle dans la trace

- **Fenêtre** : c'est elle, dans 17 cas sur 17, qui **demande** la fin —
  chaque fermeture est précédée de la ligne du pont
  « dictée locale refermée (attente du texte final) »
  (`asr_voicestudio.rs:1178`, dans `asr_voicestudio_stop`, donc sur appel de la
  fenêtre).
- **Pont Rust** : aucune de ses pannes n'apparaît (ni « session refermée sans
  texte final », ni « flux interrompu », ni « texte final absent (délai
  dépassé) »). Il n'a donc jamais coupé.
- **Service de voix** : il n'écrit **aucun journal de transcription lisible**
  (`%APPDATA%\VoiceStudio` ne contient que des caches Electron — Session Storage
  modifié pour la dernière fois à 13:56). Rien ne permet, côté service, de dire
  quand il a rendu ses textes partiels : c'est le trou de trace du § 6.

---

## 6. Ce qui n'est PAS établi

1. **La cause de chaque coupure prise isolément** (pause réelle de 1,5 s ou
   retard du service). La trace donne la durée totale et la fin, pas l'instant
   de chaque texte partiel. Il manque une ligne par texte reçu (heure + longueur
   cumulée), qui n'existe nulle part aujourd'hui.
2. **La cadence réelle des textes partiels de Parakeet TDT v3** (toutes les
   100 ms ? par paquets de plusieurs secondes ?), et le fait qu'il réémette ou
   non un texte **identique** — un texte identique est volontairement ignoré
   (`transcript !== dernierTexte`).
3. **La latence du service** en dictée de flux : elle n'est mesurée nulle part
   (les 20 s du pont ne concernent que le texte final, après la fin du flux).
4. Le sort de la session n° 14 (15:17:50, jamais refermée dans le journal) :
   application fermée, ou dictée restée ouverte faute d'un premier mot
   transcrit — les deux sont possibles, la trace ne le dit pas.

---

## 7. Le réglage exact à changer (il n'a pas été changé)

- **Réglage** : Paramètres → onglet Assistant → section « Mode Vocal » →
  **« Délai d'envoi »** (`index.html:1505`), mémorisé dans `config.json` sous
  `vocal_silence_send_ms`.
- **Valeur actuelle : 1 500 ms. Valeur maximale : 5 000 ms.** La mettre au
  maximum (5 s) est le seul geste qui repousse mécaniquement la coupure, sans
  toucher au code ni au service ; une valeur intermédiaire (2,5–3 s) laisse
  encore couper pendant une hésitation.
- **Limite honnête** : ce réglage ne corrige pas le cas « retard de
  transcription ». La correction de fond (non faite, hors mission) serait que le
  **son** repousse l'échéance comme il repousse déjà la veille de 20 s
  (`vocalRestartVeilleTimer` est appelé sur `vocalCapte === true`,
  `super-agent.js:6406`, alors que `vocalNoteWord` — seul à réarmer l'envoi sur
  silence — n'est appelé que sur un texte, `:5850`).

---

## 8. Fichiers de trace consultés (lecture seule)

| Fichier | Dernière modification | État |
|---|---|---|
| `%APPDATA%\com.pilot.editor.dev\voix-locale\voix-locale.log` | 2026-11-10 15:17:50 | 163 lignes ; 17 fins d'écoute avec raison (8 `fin-normale-avec-texte`, 8 `session-fermee`, 1 `fin-perimee`) |
| `%APPDATA%\com.pilot.editor.dev\config.json` | 2026-11-10 15:14:09 | `vocal_silence_send_ms = 1500`, `local_dictation = true`, `read_aloud_voice = local:voicestudio:d14b0e58` |
| `%APPDATA%\VoiceStudio\` | 2026-11-10 13:56 (Session Storage) | aucun journal de transcription lisible |
| `docs/rapports/RAPPORT-arret-ecoute-vocale.md` | 2026-11-10 10:11 | cause précédente (identité de session), corrigée |
| `docs/rapports/RAPPORT-diagnostic-erreurs-dictee-locale.md` | 2026-11-10 11:19 | plafond des sessions vides |
| `docs/rapports/RAPPORT-diagnostic-coupure-dictee-locale.md` | 2026-11-10 13:59 | cascade de réarmement |
| `docs/rapports/RAPPORT-correction-rearmement-session-perimee.md` | 2026-11-10 14:17 | correctif `4c32f6f` (d'où la raison de fin dans le journal) |

**Cause établie** : la fin d'écoute du mode Vocal est décidée par la fenêtre, sur
un silence de **1 500 ms sans nouveau mot transcrit** (réglage
`vocal_silence_send_ms`, défaut 2 000 ms) ; cette décision est tenue par
`src/js/vocal-conversation.js` (`decideVocalSilenceSend`) et appliquée par
`src/js/super-agent.js:7678-7694`. **Part non établie** : la répartition entre
pause réelle et retard de transcription, faute d'une trace des textes partiels.
