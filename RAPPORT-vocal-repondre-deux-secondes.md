# Rapport — le mode Vocal répond deux secondes après le dernier mot

**Demande du propriétaire** : dans l'écran Vocal, le vrai micro et la
transcription fonctionnent, mais la demande part **longtemps après** que
l'utilisateur a cessé de parler. Décision à appliquer telle quelle : **deux
secondes après le dernier mot transcrit, s'il n'y a pas de nouveau mot, la
demande doit être envoyée.**

---

## 1. Le délai obtenu

**2 000 ms exactement**, comptées **depuis le dernier texte réellement
récupéré** (mot provisoire **ou** définitif). Constante nommée :
`VOCAL_SILENCE_SEND_MS = 2000` dans `src/js/vocal-conversation.js` — la valeur
existe **une seule fois** dans le code, elle n'est **ni réglable, ni affichée**
(aucun réglage, aucun bouton, aucun indicateur ajouté).

Le délai n'est donc plus **subi** : avant, le seul signal d'envoi était la **fin
que déclare le moteur de reconnaissance** du navigateur, qui attend son propre
silence (plusieurs secondes). Désormais l'écran décide lui-même que la phrase est
terminée.

Mesure vérifiée par test à horloge simulée : **rien ne part à 1 999 ms**, la
demande part à 2 000 ms — et une seule fois.

## 2. Ce qui se passe si l'utilisateur continue de parler

- **Chaque nouveau mot repousse l'échéance** de deux secondes : la demande ne
  part jamais au milieu d'une phrase. Un mot à t = 1 500 ms puis un autre à
  t = 3 000 ms ⇒ rien à 3 000 ms, la demande part à 5 000 ms (2 s après le
  **dernier** mot).
- **Un texte identique au précédent n'est pas un nouveau mot** : sinon un moteur
  qui répète son résultat intermédiaire repousserait l'envoi sans fin.
- **Un seul minuteur à la fois** : celui en vol est **remplacé** à chaque mot
  (jamais deux minuteries en vol, vérifié : `vi.getTimerCount() === 1`).
- **Annulé** dès que la dictée se referme (fin d'écoute, erreur, arrêt manuel),
  quand Pilot **parle** ou **réfléchit**, à chaque nouvelle session, et aux
  **trois sorties** du mode (bouton, Échap, fermeture de l'onglet — toutes passent
  par `exitVocal`).

## 3. Gardes vérifiées (aucune n'a bougé)

| Garde | Effet sur le délai | État |
|---|---|---|
| Pilot **lit** sa réponse | aucun envoi, minuteur annulé | inchangée |
| Pilot **réfléchit** / tour en cours | aucun envoi, minuteur annulé | inchangée |
| L'utilisateur a **repris la main** dans la zone | aucun envoi, rien n'est réarmé | inchangée |
| Dictée **muette** (aucun mot récupéré) | aucun envoi | inchangée |
| **Hors du mode Vocal** | la règle ne fait rien (l'écran n'envoie que dans son mode) | inchangée |
| Projet **sensible**, micro de **mesure** d'abord, **plafond** des fins vides, **dictée unique** | non touchés | inchangées |
| Seuils de coupure de la parole (`vocal-mic.js`) | non touchés | inchangés |

Aucun second envoi, aucun second moteur de transcription, aucun second état :
à l'échéance on **referme** la dictée en demandant au moteur de s'arrêter
(`rec.stop()`), et sa **fin d'écoute normale** passe par le chemin d'aujourd'hui
(`applyVoiceEnd` → `send`). Il n'y a toujours **qu'un seul `applyVoiceEnd`** dans
le fichier.

## 4. Tests

- `src/js/vocal-repondre-deux-secondes.test.js` — **31 cas** : la valeur (2 000 ms,
  une seule fois dans le module), le module reste pur (ni horloge, ni minuteur, ni
  DOM), l'**ordre des règles** (spécification testée telle quelle) et toutes les
  gardes, le **délai respecté** et **repoussé** par chaque mot (horloges
  simulées), **un seul** minuteur, aucun envoi pendant la lecture / la réflexion /
  après une reprise en main, aucun envoi tardif après la fermeture du mode, le
  **câblage** (une seule affectation de minuteur, réévaluation à l'échéance,
  `rec.stop()` réutilisé, un seul `applyVoiceEnd`, un seul `send(` dans la voie de
  dictée, aucun réglage ni affichage ajouté) et la **documentation** (spec du mode
  Vocal, spec de la dictée, aide embarquée).
- Aucun test existant supprimé ni modifié. Suite complète : `npm test` →
  **3 793 tests, 0 échec**. Build : `npm run build` → **OK** (12,8 s).
- Les verrous de la conversation parlée restent verts : `vocal-parler-declenche-une-demande`,
  `vocal-correctifs-revue`, `vocal-deux-gardes-finales`, `envoi-auto-fin-dictee`,
  `envoi-auto-dictee-web-distant`, `ecran-vocal-lot2/3/4a`, `trois-modes-ecran`.

## 5. Fichiers touchés

| Fichier | Modification |
|---|---|
| `src/js/vocal-conversation.js` | **la décision pure** : `VOCAL_SILENCE_SEND_MS` (2 000 ms), `VOCAL_SILENCE_WAIT/CANCEL/CLOSE`, `decideVocalSilenceSend(etats, moment)` — l'ordre des règles y est documenté |
| `src/js/super-agent.js` | **un seul** minuteur (`vocalSilenceTimer`), un seul drapeau de session (`vocalMotRecu`), `vocalNoteWord()` (réarme à chaque nouveau texte), `vocalSyncSilenceSend()` (annule quand les gardes refusent), `vocalCloseForSend()` (`rec.stop()` — voie existante), annulations dans `stopVoiceInput`, `rec.onend`, `startVoiceInput`, `vocalSyncConversation` et `exitVocal` |
| `src/js/vocal-repondre-deux-secondes.test.js` | nouveau fichier de tests (31 cas) |
| `spec_modes_ecran_vocal.md` | **§6bis.1** : le délai, son signal (les mots, pas l'horloge), l'unique minuteur, l'unique envoi, les gardes ; tableau du §10 et bilan du §11 |
| `spec_voice_input.md` | **§5quater** (nouvelle section) + phrase devenue fausse corrigée dans le bloc d'aide `dictee-vocale` |
| `help/overview.md` | bloc `modes-ecran` : « la demande part deux secondes après votre dernier mot » (langage utilisateur), puis handbook régénéré |
| `README.md` | même correction, côté utilisateur |

## 6. Phrase devenue fausse, corrigée

L'aide annonçait que « la demande part **à la fin de la dictée** ». Ce n'est plus
la fin du moteur qui décide : la formulation dit maintenant **« deux secondes
après votre dernier mot »**, et précise que **chaque nouveau mot repousse ces
deux secondes**. Aucune autre phrase validée n'a été retouchée (aspect, seuils,
libellés d'état, messages de panne inchangés).

## 7. Limite connue (dite, pas masquée)

Le texte envoyé reste celui que le moteur a **finalisé** : c'est le comportement
existant de la dictée, partagé avec l'onglet agent π, et il n'a pas été modifié
(ce serait un second chemin de texte). En pratique, l'arrêt demandé au moteur
(`rec.stop()`) **finalise le segment en cours** avant la fin d'écoute — c'est
précisément ce que fait déjà un appui sur 🎙️. **Non vérifié ici** : la latence
réelle du moteur de reconnaissance de votre poste — elle n'a plus d'importance
pour l'envoi, puisqu'elle n'est plus le signal.
