# Pilot — Lecture des réponses à voix haute (spec)

Bouton **« 🔊 Écouter » / « ⏹ Arrêter »** sous chaque réponse de l'agent (onglet
π) et de l'Assistant (onglet 🧭), et **réglage de la voix**.

## 1. Lecture

1. **Un clic lit, un second arrête.** Aucune lecture automatique : rien ne se lit
   à l'ouverture de Pilot ni à l'arrivée d'un message.
2. **Une seule lecture à la fois** : lancer une autre réponse arrête la
   précédente (`stopReading` avant toute nouvelle prise de parole).
3. **Texte nettoyé — un seul endroit** : `textForSpeech` (`src/js/speech-text.js`),
   fonction **pure**, seule implémentation appelée par le chemin de la voix
   (`read-aloud.js` : `markupToSpeech` n'est plus qu'un alias historique, et
   `speak` nettoie avant de découper). Elle retire : **émojis et pictogrammes**
   (drapeaux, carnations, ZWJ, sélecteurs de variation — les **chiffres** restent),
   les marques de mise en forme (`**`, `__`, `~~`, accents graves, `#`, `>`),
   puces et numéros de liste, traits de séparation, les **blocs de code**
   (annoncés « bloc de code … affiché à l'écran », jamais lus), l'**URL** des
   liens (le libellé est gardé) et les balises HTML.
   - **Tableaux** : lus en **texte courant** (lignes de séparation supprimées,
     barres → espaces). Choisi plutôt que supprimés : dans une réponse
     d'assistant un tableau porte une information (comparatif, valeurs) dont la
     disparition appauvrirait la lecture.
   - **Conservé** : accents, ponctuation (y compris l'espace avant `!`, `?`,
     `;`, `:`), apostrophes, chiffres, texte entre accents graves (sans les
     accents graves).
   - **Idempotente** : le chemin applique le nettoyage deux fois (construction du
     texte du message puis prise de parole) sans effet supplémentaire.
   - **Rien d'autre ne l'appelle** : l'affichage, le rendu Markdown et le fil de
     discussion ne changent pas d'un caractère.
4. **Découpage phrase par phrase** (`splitSentences`, plafond
   `SPEECH_MAX_CHUNK`) ; une phrase trop longue est coupée par
   `cutTextAtBoundary` sur une **fin de phrase**, sinon sur une **fin de mot** —
   jamais au milieu d'un mot.
5. **Seule la réponse finale est lue** : la frontière est lue dans la
   **structure** du flux (`finalAnswerSections`) — raisonnement, appels et
   résultats d'outils, sorties de commandes, notes techniques marquées
   (`isInternalNotice` / `INTERNAL_MARKER`) ne sont jamais lus. Aucune heuristique
   sur les mots.
6. **Vos messages** et les **événements système** n'ont pas de bouton.

## 2. Réglage de la voix — un seul endroit

⚙️ **Paramètres → onglet « Assistant »** → section **« Lecture des réponses à voix
haute »** (`index.html`, panneau `data-settings-panel="superagent"`, section
`#settings-section-read-aloud`). Elle regroupe, au même endroit :

| Élément | Rôle |
|---|---|
| `#setting-read-aloud-voice` (`<select>`) | choix de la voix (« Automatique », **voix française locale**, puis une entrée par voix du système, libellé `nom (langue)`) |
| `#read-aloud-state` (`role="status"`, `aria-live="polite"`) | état de la lecture (aucune / en cours / terminée / aucune voix / repli sur la voix du système…) |
| `#read-aloud-voice-note` (`role="note"`) | explication et, le cas échéant, quoi faire |
| `#read-aloud-local-note` (`role="note"`) | état du **moteur de voix locale** et **dossier où déposer ses fichiers** (chemin réel renvoyé par le moteur, jamais recopié) |

- **Aucun doublon** : ce réglage n'existe dans aucun autre onglet des paramètres
  et dans aucune fenêtre par message (vérifié par test).
- Le libellé du champ est relié (`<label for>`), le champ décrit sa note et sa
  ligne d'état (`aria-describedby`), la ligne d'état est annoncée.
- Le sélecteur est rempli **à l'ouverture de la modale** et **à l'ouverture de
  l'onglet Assistant** (la liste des voix peut se charger entre-temps).

## 3. Choix de la voix

- Clé de configuration : **`read_aloud_voice`** (`AppConfig`, `serde(default)`,
  défaut `""`), écrite par la modale (réécriture complète de la config) et
  appliquée au démarrage puis à chaque `pilot-config-changed`
  (`applyVoicePreferenceFromConfig`).
- **`""` = automatique** : `pickVoiceForLang` prend la voix de la langue de
  l'interface.
- Identité stable : `voiceKey` = `voiceURI`, à défaut le nom ; `findVoiceForChoice`
  essaie l'identité puis le nom (voix réinstallée avec une autre URI).
- **Voix mémorisée disparue** : `resolveVoiceForChoice` retombe sur la voix de la
  langue de l'interface ; la section annonce le repli (`voiceChoiceStatus` →
  `kind: "missing"`) et remet le choix sur « Automatique ». Ni erreur, ni lecture
  muette.
- **Aucune voix installée** : `voiceChoiceStatus` → `kind: "empty"` avec une
  phrase claire (`NO_VOICE_INSTALLED_HINT`) ; le sélecteur est **désactivé** et
  le bouton de lecture passe à l'état `novoice` (visible, `disabled`, infobulle
  `NO_VOICE_HINT`), réactivé si une voix apparaît (`voiceschanged`).
- État publié par évènement (`pilot-read-aloud-state`) : la section des
  paramètres l'affiche sans couplage direct avec la lecture.
- **`local:piper`** = **voix française locale** (voir § 6). Choix **conservé**
  même si le moteur n'est pas installé (`kind: "local-missing"`) : la note dit
  alors que la lecture utilise la voix du système en attendant.

## 4. Voix française LOCALE (hors ligne, sans clé, sans GPU)

1. **Moteur** : **Piper** (exécutable local) + modèle **`fr_FR-siwis-medium`**
   (≈ 63 Mo, 63 201 294 octets). Hors ligne, aucune clé, aucun compte, aucune
   carte graphique, **aucun appel réseau à la lecture**.
2. **Dépôt des fichiers** (une seule fois, à la main : Pilot ne télécharge rien) :
   `<dossier de données de Pilot>/voix-locale/piper/` (binaire + DLL + données
   eSpeak) et `.../voix-locale/voix/fr_FR-siwis-medium.onnx` + `.onnx.json`.
   Le chemin exact est **affiché dans les Paramètres**.
3. **Un seul réglage** : le champ `read_aloud_voice` (aucun autre), valeur
   réservée **`local:piper`** définie une seule fois (`LOCAL_VOICE_VALUE`,
   `src/js/local-voice.js`). Le texte nettoyé et le découpage par phrase sont
   **identiques** aux deux moteurs : seul le moteur de synthèse change.
4. **Repli obligatoire et visible** (moteur absent, modèle absent, synthèse en
   échec, audio refusé, délai dépassé 30 s) :
   - la lecture **continue avec la voix du système** et l'état passe à
     `local-fallback` (« Voix française locale indisponible : lecture avec la
     voix du système ») ;
   - une ligne datée est écrite dans **`<données>/voix-locale/voix-locale.log`**
     (`tts_local_log`, rotation au-delà de 256 Ko) — **un seul journal** ;
   - rien ne bloque, rien ne lève.
5. **Côté Rust** : `src-tauri/src/tts_local.rs` — `tts_local_status` (présence
   réelle des fichiers), `tts_local_synthesize` (processus local en
   `spawn_blocking`, sans fenêtre, sorties drainées, plafond de temps, WAV en
   base64), `tts_local_log` (journal). Aucun fichier supprimé : le WAV de
   synthèse est un temporaire retiré après lecture.

## 5. Portée

100 % local : synthèse du système (`speechSynthesis`) **ou** moteur local
(Piper). Aucune dépendance npm, aucun service en ligne, aucune voix installée
automatiquement, aucun enregistrement de ce qui est lu.

## 6. Couverture

`src/js/read-aloud.test.js` (lecture, nettoyage, une seule à la fois, voix),
`src/js/speech-text.test.js` (nettoyage du texte de la voix : cas réels avec
émojis, gras, bloc de code, tableau, lien, liste ; coupure sur frontière),
`src/js/reglage-voix-onglet-assistant.test.js` (emplacement unique, absence de
doublon, défaut automatique, mémorisation, repli, liste vide, aucune lecture
automatique) et `src/js/voix-locale.test.js` (voix locale : réglage unique, aucune
valeur recopiée, aucun réseau, texte nettoyé avant le moteur local, repli
visible + journal, arrêt du son local). Côté Rust : tests de `tts_local` (statut
sur dossier vide/équipé, chemins déduits d'un seul dossier, journal du repli).

Aide utilisateur : `help/overview.md`, bloc `HELP:lire-reponses`.
