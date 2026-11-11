# RAPPORT — « La dictée n'a pas fonctionné » s'affiche juste après la réponse

Constat du 10-11-2026, écran Vocal. Destinataire : agent développeur.
Diagnostic seul, aucun fichier de code n'est modifié ici.

## 1. Symptôme

L'assistante vient de **finir de lire sa réponse à voix haute**. Immédiatement après, dans le silence du
réarmement automatique de l'écoute, la ligne d'état affiche « La dictée n'a pas fonctionné : écrivez votre
demande. » L'utilisateur n'a rien dit et n'a rien cliqué. Ensuite, parler ne change plus rien.

## 2. Causes probables, classées

1. **H1 — sessions périmées (la plus probable).** `voiceActive`, `voiceRec`, `voiceStopVoulu` sont des
   variables **de module**, mais `rec.onresult`, `rec.onerror` et `rec.onend` les relisent depuis leur propre
   fermeture **sans vérifier de quelle session ils parlent**. La session arrêtée par la lecture peut donc
   rendre son `onend` après l'ouverture de la suivante : elle referme celle-ci, réécrit la zone de saisie et
   relance un réarmement en cascade. Trois fins **instantanées** (< 1 s) en moins de 30 s remplissent le
   plafond des sessions vides ⇒ `vocalDicteeSuspendue = true` ⇒ la phrase, sans bouton « Autoriser le
   micro », verrou **définitif**.
2. **H2 — démarrage refusé pendant le réarmement.** `rec.start()` lève quand la session précédente se ferme
   encore ; le `catch` de `startVoiceInput` passe le code `"demarrage"`, absent du `switch` de
   `vocalDictationMessage` ⇒ `default:` ⇒ la même phrase, immédiatement, et le réarmement est bloqué.
3. **H3 — code d'erreur inconnu.** `language-not-supported`, `bad-grammar`, `phrases-not-supported`… tombent
   aussi dans `default:`. La trappe existe mais n'est pas propre à l'après-lecture.

**Pour trancher (une mesure suffit) :** le bouton « Autoriser le micro » est-il visible sous la phrase ?
(oui ⇒ H2/H3 ; non ⇒ H1). La phrase sort-elle immédiatement ou ~1-3 s après la lecture ? (immédiat ⇒ H2).
Trace temporaire à retirer après usage : `console.warn("[vocal]", fin.reason, dureeMs, code, voiceActive)`
dans `rec.onend` et dans le `catch` de `startVoiceInput`.

## 3. Correction recommandée, et repli

**C1 (recommandée, 3 lignes)** — garde d'identité de session, en tête de `rec.onresult`, `rec.onerror` et
`rec.onend` : `if (voiceRec !== rec) return;`
Elle ferme H1 à la racine : un évènement d'une session périmée ne referme plus la session courante, n'écrit
plus dans la zone, ne déclenche plus de réarmement et n'alimente plus le plafond. Elle ne touche ni le micro,
ni les délais, ni la garde du nom, ni l'envoi. Deux points à tenir : après `stopVoiceInput()`, `voiceRec`
reste `rec` (la fin de la session que **nous** avons arrêtée reste traitée, avec `arretDemande = true`, donc
non comptée) ; `voiceRec = rec` étant posé **après** le retour de `rec.start()`, la garde ne peut pas avaler
le premier évènement d'une session neuve.

**C2 (repli, sans toucher au cycle)** — (a) un échec de démarrage survenu pendant le réarmement
**automatique** ne s'annonce pas : `reportVoiceFailure` n'écrit rien si `vocalDicteeParGeste !== true`, la
reprise bornée `vocalResumeRetry` réessaie ; la phrase reste réservée au geste 🎙️. (b) Le plafond bloque
toujours mais n'emploie plus le vocabulaire de l'échec : phrase neutre et actionnable — ⚠️ change une phrase
validée, **décision du propriétaire**.

## 4. Risque à ne pas casser

Le micro et le **réarmement de l'écoute après la lecture** sont validés : ne pas fermer le micro (le nom doit
pouvoir réveiller), ne pas toucher `echoCancellation` ni la garde anti-auto-coupure, ne pas modifier
`VOCAL_ARM_DELAY_MS` / `VOCAL_ARM_AFTER_READ_MS`, ne pas relever `VOICE_EMPTY_SESSION_INSTANT_MS`. Une phrase,
une ligne d'état, un point d'écriture : aucun second moteur, compteur ou journal.

## 5. Test de comportement à écrire

Fichier proposé : **`src/js/dictee-echec-apres-reponse.test.js`** (Vitest, en-tête commenté, source lu avec
`.replace(/\r\n/g, "\n")`).

- Garde présente en tête des trois fermetures, et dans `rec.onend` **avant** `applyVoiceEnd` et
  `closeSession` (mutation : sans elle, échec).
- Trois fins instantanées d'une session **périmée** ne suspendent rien : `suspendu === false`,
  `decideVocalDictation(...).raison !== "sessions-vides"`.
- Réarmement après lecture intact : `planVocalConversation({apresLecture: true})` rend
  `delai === VOCAL_ARM_AFTER_READ_MS`, `desarmer: false`.
- Non-régression : trois retours instantanés d'une session **vivante** suspendent encore
  (`dictee-vocale-se-rearme.test.js` reste vrai) ; `dureeMs: 5000` ne compte jamais ; `vocalDictationMessage`
  rend `""` pour `no-speech`, `aborted`, `""`.

## 6. Fichiers et fonctions concernés

- `src/js/super-agent.js` : `rec.onresult` (~5666), `rec.onerror` (~5769), `rec.onend` (~5803),
  `startVoiceInput` (~5625, `catch` ~5915), `reportVoiceFailure` (~7591), `vocalStatusLine` (~6691),
  `applyVocalState` (~6761), `vocalNoteEmptySession` (~7152), `armVoiceInput` (~7713).
- `src/js/vocal-conversation.js` : `vocalDictationMessage` (~329, `default:` ~356),
  `decideVocalDictation` (règle 5c), `planVocalConversation`, `vocalResumeRetry`.
- `src/js/voice-auto-send.js` : `isSilentEmptyVoiceEnd` (~126).
- `src/js/oreille-locale.js` : `localEarFailureMessage` (~231) — produit une **autre** phrase, pas celle du
  constat.
