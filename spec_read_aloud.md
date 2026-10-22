# Pilot — Lecture des réponses à voix haute (spec)

Bouton **« 🔊 Écouter » / « ⏹ Arrêter »** sous chaque réponse de l'agent (onglet
π) et de l'Assistant (onglet 🧭), et **réglage de la voix**.

## 1. Lecture

1. **Un clic lit, un second arrête.** Aucune lecture automatique : rien ne se lit
   à l'ouverture de Pilot ni à l'arrivée d'un message.
2. **Une seule lecture à la fois** : lancer une autre réponse arrête la
   précédente (`stopReading` avant toute nouvelle prise de parole).
3. **Texte nettoyé** : le balisage (titres, puces, gras, tableaux, liens,
   symboles) n'est pas débité ; un lien est lu par son libellé ; un **bloc de
   code** est annoncé (« bloc de code … affiché à l'écran »), jamais lu.
4. **Découpage phrase par phrase** (`splitSentences`, plafond
   `SPEECH_MAX_CHUNK`), pour éviter les coupures en plein milieu.
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
| `#setting-read-aloud-voice` (`<select>`) | choix de la voix (« Automatique » + une entrée par voix, libellé `nom (langue)`) |
| `#read-aloud-state` (`role="status"`, `aria-live="polite"`) | état de la lecture (aucune / en cours / terminée / aucune voix…) |
| `#read-aloud-voice-note` (`role="note"`) | explication et, le cas échéant, quoi faire |

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

## 4. Portée

100 % local : la synthèse vocale du système (`speechSynthesis`). Aucune
dépendance, aucun service en ligne, aucune voix installée automatiquement,
aucun enregistrement dans un fichier.

## 5. Couverture

`src/js/read-aloud.test.js` (lecture, nettoyage, une seule à la fois, voix) et
`src/js/reglage-voix-onglet-assistant.test.js` (emplacement unique, absence de
doublon, défaut automatique, mémorisation, repli, liste vide, aucune lecture
automatique).

Aide utilisateur : `help/overview.md`, bloc `HELP:lire-reponses`.
