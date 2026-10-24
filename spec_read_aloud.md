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
| `#setting-read-aloud-voice` (`<select>`) | choix de la voix (« Automatique », **une entrée par voix française locale** — genre dit en clair, puis une entrée par voix du système, libellé `nom (langue)`) |
| `#read-aloud-state` (`role="status"`, `aria-live="polite"`) | état de la lecture (aucune / en cours / terminée / aucune voix / repli sur la voix du système…) |
| `#read-aloud-voice-note` (`role="note"`) | explication et, le cas échéant, quoi faire |
| `#read-aloud-local-note` (`role="note"`) | état du **moteur de voix locale**, **dossier où déposer ses fichiers** (chemin réel renvoyé par le moteur, jamais recopié) et ce qui se passe si le modèle manque |
| `#read-aloud-download-state` (`role="status"`, `aria-live="polite"`) | état du **téléchargement** : taille, progression, terminé / arrêté / impossible |
| `#btn-read-aloud-download`, `#btn-read-aloud-download-cancel`, `#btn-read-aloud-recheck` | **télécharger le modèle**, **arrêter le téléchargement en cours**, **vérifier à nouveau** la présence du moteur et du modèle |
| `#read-aloud-voice-previews` | **écoute d'exemple** : une rangée par voix proposée (bouton « ▶ Écouter » ↔ « ⏹ Arrêter », libellé de la voix, message court en cas d'échec) — voir § 2 bis |

- **Aucun doublon** : ce réglage n'existe dans aucun autre onglet des paramètres
  et dans aucune fenêtre par message (vérifié par test).
- Le libellé du champ est relié (`<label for>`), le champ décrit sa note et sa
  ligne d'état (`aria-describedby`), la ligne d'état est annoncée.
- Le sélecteur est rempli **à l'ouverture de la modale** et **à l'ouverture de
  l'onglet Assistant** (la liste des voix peut se charger entre-temps).

## 2 bis. Écouter les voix avant de choisir (aperçu)

Objectif : ne plus choisir **à l'aveugle**. Chaque voix proposée (voix locale
installée, voix locale à télécharger, voix du système, « Automatique ») porte un
bouton d'écoute dans la section, **avant** l'enregistrement du choix.

1. **Un seul chemin de lecture** : `previewVoice(choice, options)`
   (`read-aloud.js`) crée un lecteur par **`createSpeaker`** — le même que le
   bouton « 🔊 Écouter » d'une réponse — avec `voiceName` = la valeur du réglage,
   puis appelle `speak()`. Donc **même nettoyage** (`textForSpeech`), **même
découpage** par phrase, **même voix**, **même repli journalisé**, **même règle
« une seule lecture à la fois »**. L'aperçu n'implémente ni synthèse, ni
nettoyage, ni découpage (verrouillé par test : les compteurs de
`new Utterance(`, `synth.speak(` et `splitSentences(textForSpeech(` valent 1
dans `read-aloud.js`, et `settings.js` n'appelle jamais `.speak(`).
2. **Phrase d'exemple courte** : `VOICE_PREVIEW_SAMPLE` — deux phrases, français
neutre (« Bonjour, je lis les réponses de Pilot. Cette phrase courte permet de
juger le rythme et la clarté de cette voix. »). Elle passe par le nettoyage et le
découpage communs comme n'importe quel texte lu.
3. **Un seul bouton par voix** : « ▶ Écouter » devient « ⏹ Arrêter » pendant la
lecture (libellé en clair, `aria-pressed`, encadré accentué — lisible sans
couleur). Second clic = `stopReading()` (même arrêt que la lecture).
4. **Une seule lecture à la fois** : lancer l'aperçu d'une autre voix arrête le
précédent ; **quitter les Paramètres** (Annuler **et** Enregistrer) appelle
`stopReading()` avant de fermer la modale, et `pagehide` arrête une lecture en
cours à la fermeture de la fenêtre. Aucun son orphelin.
5. **Modèle non téléchargé** : l'aperçu vérifie `localVoiceStatusFor(model)`
(ou `refreshLocalVoiceStatus`) **avant** de lire. Si le modèle manque, il **ne
joue pas** la voix du système à la place : `previewNotInstalledHint(label)`
dit que la voix « n'est pas encore installée », où cliquer pour télécharger, et
que **rien n'est téléchargé sans geste**. Aucun téléchargement n'est déclenché
par l'aperçu (`downloadLocalVoiceModel` n'apparaît pas dans ce chemin).
6. **Repli du moteur local** (moteur ou modèle installé mais synthèse en échec) :
la lecture continue avec la voix du système — comportement du chemin commun —
et la rangée affiche `readAloudStateLabel("local-fallback")` ; la ligne
correspondante est écrite dans le **journal existant** (`voix-locale.log`).
7. **Jamais de blocage ni d'exception** : `previewVoice` ne lève pas (toute
erreur devient un état), `startVoicePreview` est asynchrone, et les échecs
visibles (`unavailable`, `no-voice`, `local-fallback`, modèle absent) affichent
un message court **sur la rangée concernée** (`role="status"`, `aria-live`) ;
l'écran des Paramètres reste utilisable.
8. **Une seule liste de voix** : les rangées sont construites à partir du
résultat **unique** de `voiceChoiceOptions(...)` dans `renderReadAloudVoice`
(aucun second appel, aucun appel à `availableVoices` dans le rendu des
rangées) : une voix proposée = une rangée, dans le même ordre, avec le même
libellé (genre et taille compris).

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
- **`local:piper`** = **voix française locale par défaut** (voir § 4). Les autres
  voix locales ont la valeur `local:piper:<modèle>` — **le même champ unique**,
  jamais un second réglage. Choix **conservé** même si le moteur ou le modèle
  n'est pas installé (`kind: "local-missing"`) : la note dit alors que la lecture
  utilise la voix du système en attendant.
- **Compatibilité** : une configuration enregistrée avant le choix multi-voix
  contient `local:piper` → elle désigne la voix par défaut, rien à migrer. Un nom
  de modèle **inconnu** (voix retirée d'une version à l'autre) retombe sur la voix
  par défaut : jamais d'échec, jamais de lecture muette.
- **L'état d'un modèle ne vaut que pour ce modèle** : `localVoiceStatusFor(model)`
  mémorise un état **par modèle** et `voiceChoiceStatus` ignore un état portant un
  autre nom de modèle (un modèle installé ne fait jamais croire qu'un autre
  l'est).

## 4. Voix française LOCALE (hors ligne, sans clé, sans GPU)

1. **Moteur** : **Piper** (exécutable local). Hors ligne, aucune clé, aucun
   compte, aucune carte graphique, **aucun appel réseau à la lecture**.
2. **Catalogue** (4 voix mono-locuteur du dépôt officiel `rhasspy/piper-voices`,
   dossier `fr/fr_FR/`) — source unique : `LOCAL_VOICE_MODELS`
   (`src/js/local-voice.js`) et `VOICES` (`src-tauri/src/tts_local.rs`), mêmes
   noms et mêmes tailles des deux côtés :

   | Modèle | Genre | Qualité | Taille du `.onnx` |
   |---|---|---|---|
   | `fr_FR-siwis-medium` (défaut) | femme | moyenne | 63 201 294 o |
   | `fr_FR-tom-medium` | homme | moyenne | 63 511 038 o |
   | `fr_FR-gilles-low` | homme | légère | 63 104 526 o |
   | `fr_FR-siwis-low` | femme | légère | 28 130 791 o |

   Les modèles **multi-locuteurs** (`upmc` : 2 voix ; `mls` : 125 voix) sont
   écartés : choisir une voix y demanderait un second réglage (le locuteur), hors
   périmètre. Le genre des voix retenues est vérifié (fréquence fondamentale
   mesurée sur les échantillons officiels + fiche du jeu de données).
3. **Dépôt des fichiers** : `<dossier de données de Pilot>/voix-locale/piper/`
   (binaire + DLL + données eSpeak) et
   `.../voix-locale/voix/fr_FR-<nom>-<qualité>.onnx` + `.onnx.json`.
   Le chemin exact est **affiché dans les Paramètres**. Le modèle peut être
   **téléchargé depuis les Paramètres** (voir 4) ou déposé à la main.

   **Le MOTEUR est partagé par le produit, pas par l'identifiant de version.**
   La version installée et la version de test ont deux dossiers de données
   (`com.pilot.editor` / `com.pilot.editor.dev`) mais **un seul** moteur sur
   l'ordinateur : `product_identifier` (retire le suffixe `.dev`) et
   `is_product_data_dir` désignent le produit ; `engine_candidate_roots` liste le
   dossier courant **puis** les dossiers de données des autres versions de Pilot
   (triés, aucun autre produit) ; `resolve_engine_root` retient le premier qui
   contient `piper.exe`. **Aucune copie, aucun déplacement, aucune suppression**
   (seule une **lecture** de présence), et les **modèles restent dans le dossier de
   données courant**. Le partage est **dit** (`engine_shared` + `engine_dir`, phrase
   `ready_hint_shared`) : jamais silencieux. Sans cette règle, un moteur installé
   une seule fois restait invisible pour l'autre version et la lecture retombait
   **toujours** sur la voix du système, quelle que soit la voix choisie (incident
   « joue Hortense »).
4. **Téléchargement — sur geste explicite seulement** (`tts_local_download.rs`) :
   - **un seul modèle à la fois** (garde atomique), **un seul fichier à la fois** ;
   - URL exactes du dépôt Piper, tailles vérifiées à l'arrivée ;
   - écriture dans un fichier **`.part`** puis **renommage** une fois complet :
     le fichier final n'est **jamais** partiellement écrit ;
   - **reprise** (`Range: bytes=<déjà reçu>`), **aucune suppression** : un `.part`
     interrompu reprend, un modèle déjà présent n'est **jamais** retéléchargé ;
   - **arrêt** (`tts_local_cancel_download`) : le téléchargement s'arrête, rien
     n'est effacé ;
   - progression poussée par l'évènement `tts-local-download-progress` (taille + %).
   Aucun téléchargement au démarrage, à l'ouverture des Paramètres, ni pendant une
   lecture : seul un **clic** (ou le **choix** d'une voix dont le modèle manque)
   le déclenche.
   - **le moteur n'est jamais téléchargé** (par Pilot). Un modèle téléchargé ne
     suffit donc pas : `downloadDoneMessage` ne dit « installé / lecture
     hors ligne » **que si** `installed` est vrai après vérification. Sinon
     (moteur manquant) : **avertissement** « téléchargé, mais la voix locale n'est
     pas encore utilisable : il manque le moteur (dossier `piper`) », journalisé
     (`tts_local_log`) — jamais un succès mensonger, jamais un repli muet.
5. **Un seul réglage** : le champ `read_aloud_voice` (aucun autre), valeur
   réservée **`local:piper`** définie une seule fois (`LOCAL_VOICE_VALUE`,
   `src/js/local-voice.js`). Le texte nettoyé et le découpage par phrase sont
   **identiques** aux deux moteurs : seul le moteur de synthèse change. La voix
   choisie est transmise aux commandes (`model`) ; absente, c'est la voix par
   défaut.
6. **Repli obligatoire et visible** (moteur absent, modèle absent, synthèse en
   échec, audio refusé, délai dépassé 30 s, téléchargement en échec) :
   - la lecture **continue avec la voix du système** et l'état passe à
     `local-fallback` (« Voix française locale indisponible : lecture avec la
     voix du système ») ;
   - une ligne datée est écrite dans **`<données>/voix-locale/voix-locale.log`**
     (`tts_local_log`, rotation au-delà de 256 Ko) — **un seul journal** ;
   - rien ne bloque, rien ne lève.
   - **la phrase affichée est non technique** (`missing_hint` côté Rust,
     `localVoiceMissingHint` côté JS) : « La voix locale n'est pas encore installée
     sur cet ordinateur (dossier utilisé : …) », puis **quoi faire** selon ce qui
     manque — moteur absent : déposer le dossier `piper` puis « Vérifier à nouveau »
     (et il est dit qu'il n'est **jamais téléchargé automatiquement**) ; modèle
     absent : bouton « Télécharger ». Aucun `onnx`, `.exe`, `espeak` ni code
     d'erreur dans le texte vu par l'utilisateur.
   - **à chaque clic**, l'état du modèle est relu (`tts_local_status`) : jamais un
     cache périmé, le repli est journalisé à chaque fois.
7. **Côté Rust** : `src-tauri/src/tts_local.rs` — `tts_local_status(model)`
   (présence réelle des fichiers), `tts_local_synthesize(text, model)` (processus
   local en `spawn_blocking`, sans fenêtre, sorties drainées, plafond de temps,
   WAV en base64), `tts_local_log` (journal). `src-tauri/src/tts_local_download.rs`
   — `tts_local_download(model)`, `tts_local_cancel_download()`,
   `tts_local_download_state()`. Aucun fichier supprimé : le WAV de synthèse est
   un temporaire retiré après lecture.

   Table des voix (Rust) : `VOICES` = mêmes modèles que `LOCAL_VOICE_MODELS`,
   avec le genre (`femme` / `homme`), la qualité et la taille exacte du `.onnx`.
   `voice_for(Option<&str>)` retombe sur la voix par défaut pour une valeur
   absente **ou inconnue**.

## 5. Portée

100 % local : synthèse du système (`speechSynthesis`) **ou** moteur local
(Piper). Aucune dépendance npm, aucun service en ligne, aucune voix installée
automatiquement, aucun enregistrement de ce qui est lu.

## 6. Couverture

`src/js/read-aloud.test.js` (lecture, nettoyage, une seule à la fois, voix),
`src/js/apercu-voix-parametres.test.js` (écoute d'exemple : **un seul chemin de
lecture** — compteurs de prise de parole et de nettoyage, aucune seconde liste
de voix —, un seul aperçu à la fois, arrêt à la fermeture des Paramètres, échec
non silencieux, modèle local absent qui **ne joue pas** la voix du système),
`src/js/speech-text.test.js` (nettoyage du texte de la voix : cas réels avec
émojis, gras, bloc de code, tableau, lien, liste ; coupure sur frontière),
`src/js/reglage-voix-onglet-assistant.test.js` (emplacement unique, absence de
doublon, défaut automatique, mémorisation, repli, liste vide, aucune lecture
automatique), `src/js/voix-locale.test.js` (voix locale : réglage unique, aucune
valeur recopiée, aucun réseau, texte nettoyé avant le moteur local, repli
visible + journal, arrêt du son local) et `src/js/voix-locale-choix.test.js`
(choix de la voix : catalogue réel avec genre et taille, une valeur par voix dont
la première reste historique, état mémorisé **par modèle**, téléchargement
**seulement sur geste**, état visible / arrêt / échec, aucun effacement). Côté
Rust : tests de `tts_local` (statut sur dossier vide/équipé, chemins déduits d'un
seul dossier, table des voix complète et sans doublon, voix masculine avec ses
propres fichiers et son propre état, journal du repli, **moteur de l'autre version
réutilisé** (`resolve_engine_root` → dossier installé + `engine_shared`, voix
choisie utilisable, partage visible ; et **un dossier voisin étranger n'est jamais
utilisé**), identifiants regroupés par produit) et de `tts_local_download` (URL
exactes, tailles, `.part` jamais confondu avec le fichier final, aucun
retéléchargement, dossier absent, état par défaut).

`voix-locale-choix.test.js` ajoute les tests qui **mordent** sur cet incident :
(a) avec un moteur partagé, la voix **choisie** est réellement synthétisée
(`tts_local_synthesize` reçoit le bon `model`) et **aucune** voix du système n'est
prononcée, l'état ne passe pas à `local-fallback` ; (b) `downloadDoneMessage`
refuse de dire « installé / hors ligne » quand `installed` est faux et renvoie un
message **journalisé** ; (c) la note affichée dit « pas encore installée » +
« Vérifier à nouveau » sans aucun terme technique. Vérifié par neutralisation :
`resolve_engine_root` forcé sur le dossier courant fait **échouer** le test Rust ;
`downloadDoneMessage` forcé en succès fait **échouer** les deux tests JS.

**Règle des tests de lecture (leçon de la CI 0.4.43)** : aucun de ces tests ne
doit dépendre d'un **délai au temps réel** pour supposer qu'une lecture est
encore en cours. Le son factice est soit laissé volontairement sans fin
(`fakeWindow({ autoEnd: false })`), soit terminé explicitement
(`finishLast(...)`) ; on attend un **fait observable** (`waitUntil(...)`), jamais
un `await` de quelques millisecondes. Un `sleep` court est vert sur une machine
lente et rouge sur une machine rapide (incident : Linux/macOS rouges, Windows
vert, sans aucune différence de comportement).

Aide utilisateur : `help/overview.md`, bloc `HELP:lire-reponses`.
