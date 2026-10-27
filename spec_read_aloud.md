# Pilot — Lecture des réponses à voix haute (spec)

Bouton **« 🔊 Écouter » / « ⏹ Arrêter »** sous chaque réponse de l'agent (onglet
π) et de l'Assistant (onglet 🧭), et **réglage de la voix**.

## 1. Lecture

1. **Un clic lit, un second arrête.** Aucune lecture automatique : rien ne se lit
   à l'ouverture de Pilot ni à l'arrivée d'un message.
   - **Seule exception, le mode d'écran « Vocal »** (lot 2) : la réponse de
     l'Assistant s'y lit à voix haute sans clic. Ce n'est pas un second
     mécanisme — `autoReadVocalReply()` (`super-agent.js`) actionne le **bouton
     « 🔊 Écouter » déjà posé** sous le dernier message ; même nettoyage du
     texte, même découpage, mêmes voix, une seule lecture à la fois. Écrire ou
     valider pendant la lecture l'arrête (`stopReading`) puis le message part.
     Hors mode Vocal, la règle « rien ne se lit tout seul » est inchangée, et
     l'état « Pilot parle » de l'écran vient uniquement de
     `READ_ALOUD_STATE_EVENT` (aucune seconde source).
   - **Parler par-dessus Pilot arrête la lecture (lot 4a).** Pendant que Pilot
     lit **en mode Vocal**, une prise de parole de l'utilisateur arrête la
     lecture **immédiatement et proprement** : l'arrêt emprunte `stopReading()`
     (même voie que la sortie du mode), donc il tombe **entre deux morceaux**, et
     aucune reprise n'est programmée. L'écran repasse en « écoute » (le micro
     capte déjà) et le curseur revient dans la zone de saisie. **Hors mode
     Vocal, rien ne change** : les autres écrans lisent jusqu'au bout, et le
     micro n'y est pas ouvert.
   - **Pilot ne se coupe pas lui-même — c'est mesuré, pas supposé.** Le risque
     est que le micro entende la voix de Pilot sortant des haut-parleurs. Trois
     gardes, dans cet ordre (`vocal-mic.js`, fonctions pures) :
     1. **Annulation d'écho demandée puis relue** : les contraintes de capture
        demandent `echoCancellation` / `noiseSuppression` / `autoGainControl`,
        et `echoCancellationOf` lit ce que le périphérique **dit avoir appliqué**
        (`getSettings()`). Une réponse `false` **interdit** la détection ; une
        absence de réponse vaut **inconnue**, jamais « vrai par défaut ».
     2. **Seuil posé au-dessus du résidu mesuré** : au début de chaque lecture,
        `BARGE_IN_CALIBRATION_MS` (600 ms) mesure le niveau maximal (le résidu
        d'écho) sans jamais couper ; ensuite le seuil vaut
        `max(BARGE_IN_MIN_LEVEL = 0,05 ; résidu × 1,8)`. Le résidu ne remonte que
        sur les moments **calmes** : une voix ne devient jamais la référence qui
        l'empêcherait de couper.
     3. **Détection désarmée si l'écho n'est pas maîtrisé** : résidu >
        `BARGE_IN_RESIDUAL_MAX` (0,03 avec annulation averée, 0,01 quand le
        périphérique ne dit rien) ⇒ **aucune coupure** : Pilot lit jusqu'au bout,
        comme avant. Un silence vaut mieux qu'une réponse qui bégaie.
     Une coupure exige `BARGE_IN_MIN_MS` (200 ms) de voix **continue** au-dessus
     du seuil, et ne part **qu'une fois** par lecture. Les chiffres réellement
     mesurés sont rendus par `bargeInReport()` et écrits une fois par coupure
     (console : `[vocal] prise de parole : residu=… seuil=…`).
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

⚙️ **Options → onglet « Assistant »** → section **« Lecture des réponses à voix
haute »** (`index.html`, panneau `data-settings-panel="superagent"`, section
`#settings-section-read-aloud`). Elle regroupe, au même endroit :

| Élément | Rôle |
|---|---|
| `#setting-read-aloud-voice` (`<select>`) | choix de la voix (« Automatique », **une entrée par voix française locale** — genre dit en clair, puis une entrée par voix du système, libellé `nom (langue)`) |
| `#read-aloud-state` (`role="status"`, `aria-live="polite"`) | état de la lecture (aucune / en cours / terminée / aucune voix / repli sur la voix du système…) |
| `#read-aloud-voice-note` (`role="note"`) | explication et, le cas échéant, quoi faire |
| `#read-aloud-local-note` (`role="note"`) | état du **moteur de voix locale**, **dossier où déposer ses fichiers** (chemin réel renvoyé par le moteur, jamais recopié) et ce qui se passe si le modèle manque — **jamais vide** : « vérification en cours… », « état inconnu + Vérifier à nouveau », ou l'état réel (§ 2 ter) |
| `#read-aloud-download-state` (`role="status"`, `aria-live="polite"`) | état de l'**installation** : étape en cours (moteur / voix), taille et pourcentage de l'étape **et** du total, puis terminé / arrêté / impossible |
| `#btn-read-aloud-download`, `#btn-read-aloud-download-cancel`, `#btn-read-aloud-recheck` | **le geste unique « Installer la voix locale »** (moteur + les deux voix françaises), **arrêter l'installation en cours**, **vérifier à nouveau** la présence du moteur et des modèles |
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
précédent ; **quitter les Options** (Annuler **et** Enregistrer) appelle
`stopReading()` avant de fermer la modale, et `pagehide` arrête une lecture en
cours à la fermeture de la fenêtre. Aucun son orphelin.
5. **Modèle non téléchargé** : l'aperçu vérifie `localVoiceStatusFor(model)`
(ou `refreshLocalVoiceStatus`) **avant** de lire. Si le modèle manque, il **ne
joue pas** la voix du système à la place : `previewNotInstalledHint(label)`
dit que la voix « n'est pas encore installée », qu'il faut cliquer sur
**« Installer la voix locale »**, et que **rien n'est téléchargé sans geste**.
Aucun téléchargement n'est déclenché par l'aperçu (`downloadLocalVoiceModel`
n'apparaît pas dans ce chemin).
6. **Repli du moteur local** (moteur ou modèle installé mais synthèse en échec) :
la lecture continue avec la voix du système — comportement du chemin commun —
et la rangée affiche `readAloudStateLabel("local-fallback")` ; la ligne
correspondante est écrite dans le **journal existant** (`voix-locale.log`).
7. **Jamais de blocage ni d'exception** : `previewVoice` ne lève pas (toute
erreur devient un état), `startVoicePreview` est asynchrone, et les échecs
visibles (`unavailable`, `no-voice`, `local-fallback`, modèle absent) affichent
un message court **sur la rangée concernée** (`role="status"`, `aria-live`) ;
l'écran des Options reste utilisable.
8. **Une seule liste de voix** : les rangées sont construites à partir du
résultat **unique** de `voiceChoiceOptions(...)` dans `renderReadAloudVoice`
(aucun second appel, aucun appel à `availableVoices` dans le rendu des
rangées) : une voix proposée = une rangée, dans le même ordre, avec le même
libellé (genre et taille compris).

## 2 ter. État du moteur : chargement AUTOMATIQUE de la section

Décision du propriétaire : « là faut juste charger en automatique ». Ouvrir les
Options (ou afficher l'onglet « Assistant ») **suffit** — aucun clic,
notamment avec le réglage par défaut `read_aloud_voice: ""` (défaut
`lib.rs:1207`). Avant, l'état n'était demandé que si la valeur enregistrée était
**déjà** une voix locale : avec « Automatique », `localVoiceModelFor("")` =
`null` (`local-voice.js`) → aucun appel `tts_local_status` → **aucune voix locale
proposée** et une ligne bloquée sur « vérification du moteur en cours… »
(régression de `52eb3ab`, publiée en v0.4.46 et v0.5.0).

1. **Un seul point de décision** (`refreshReadAloudVoice`, `settings.js`) : le
   modèle dont on demande l'état est celui de la voix choisie, sinon
   `DEFAULT_LOCAL_VOICE_MODEL` — le seul état qui permette d'afficher le
   catalogue. L'état connu est **toujours** passé au rendu
   (`renderReadAloudVoice(wanted, known)`), sinon `voiceChoiceOptions` n'affiche
   aucune entrée locale.
2. **Un seul chemin de vérification** : `checkLocalVoiceStatus(value)` —
   exactement ce que fait le bouton « Vérifier à nouveau » (relire l'état du
   dernier téléchargement avec `refreshLocalVoiceDownloadState`, puis
   `refreshLocalVoiceStatus` pour la voix concernée, puis re-rendre). Le bouton,
   le chargement automatique et le choix d'une voix l'appellent tous : aucun
   second mécanisme, aucune commande Rust nouvelle.
3. **Coût : au plus une fois par ouverture des Options.** Drapeau
   `localVoiceAutoChecked` remis à `false` dans `resetSettingsContent` (donc à
   chaque ouverture), et une seule demande en vol (`localVoiceCheckInFlight`).
   Jamais à chaque rendu, jamais en boucle, **aucune minuterie** (`setInterval` /
   `setTimeout` absents de ce chemin). Un **geste** (choix dans la liste) reste
   une vérification à la demande : il demande l'état de SA voix, même après la
   vérification automatique (sinon le choix serait perdu).
4. **États visibles, jamais un vide** (source unique `localVoiceSectionNote`) :
   - pendant → `LOCAL_VOICE_PENDING_HINT` (« vérification de l'état du moteur en
     cours… ») ;
   - échec de la vérification → état **`unknown`** (jamais « non installé », qui
     serait une affirmation inventée) + `LOCAL_VOICE_UNKNOWN_HINT` (« État du
     moteur de voix locale inconnu : cliquez sur « Vérifier à nouveau »… ») ;
     `voiceChoiceStatus` renvoie `kind: "local-unknown"` et **conserve** le choix
     en cours (aucune décision prise à la place de l'utilisateur) ;
   - moteur absent / modèle non téléchargé → messages existants (`hint` du
     moteur, chemin du dossier) inchangés.
5. **Aucun téléchargement** n'est déclenché par ce chemin (vérifié par test :
   `downloadLocalVoiceModel` / `startReadAloudDownload` absents de
   `refreshReadAloudVoice`, `ensureLocalVoiceChecked`, `checkLocalVoiceStatus`).

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
  muette — et **jamais un remplacement silencieux** : la lecture le dit aussi
  là où l'on écoute (§ 4 ter), et le réglage enregistré n'est pas réécrit.
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
   Le chemin exact est **affiché dans les Options**. Le modèle peut être
   **téléchargé depuis les Options** (voir 4) ou déposé à la main.

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
4. **Installation — sur geste explicite seulement** (`tts_local_download.rs`) :
   - **UN SEUL geste** (« Installer la voix locale », `tts_local_download(model)`)
     installe **le moteur ET les deux voix françaises** en une fois — `plan_bundle`
     construit le plan dans cet ordre : **moteur** (`ENGINE_STEP`) s'il manque et
     si Pilot sait l'installer sur ce système, puis **`BUNDLE_MODELS`**
     (`fr_FR-siwis-medium` = voix de femme, `fr_FR-tom-medium` = voix d'homme,
     qualité moyenne) ; seuls les fichiers **absents ou incomplets** entrent dans
     le plan (un fichier présent et complet n'est **jamais** retéléchargé) ;
   - **la voix réellement choisie est installée aussi** : `install_order(requested)`
     ajoute le modèle choisi **après** le paquet s'il n'en fait pas partie
     (`fr_FR-gilles-low`, `fr_FR-siwis-low`), **sans doublon**. Sans cette règle,
     choisir une voix hors paquet la laissait définitivement manquante — régression
     du téléchargement par voix qui existait avant le geste unique ;
   - **le moteur** vient de l'archive officielle Piper
     (`piper_windows_amd64.zip`, 22 477 236 o compressés, 38 846 222 o une fois
     décompressés), **décompressée** dans `<app_data>/voix-locale/piper/`
     (`piper.exe` vérifié après extraction) ; l'archive reste dans
     `<app_data>/voix-locale/telechargements/` — **jamais supprimée** ;
   - **Windows seulement** : `tts_local::engine_install_supported()` =
     `cfg!(windows)`. Ailleurs, aucune étape moteur, **aucune erreur** : la ligne
     d'état écrit que Pilot ne fournit pas le moteur pour ce système et la lecture
     garde la voix du système ;
   - **un seul fichier à la fois**, **un seul téléchargement à la fois** (garde
     atomique `DOWNLOADING`) ;
   - URL exactes du dépôt Piper, tailles vérifiées à l'arrivée ;
   - écriture dans un fichier **`.part`** puis **renommage** une fois complet :
     le fichier final n'est **jamais** partiellement écrit ;
   - **reprise** (`Range: bytes=<déjà reçu>`), **aucune suppression** : un `.part`
     interrompu reprend, un modèle déjà présent n'est **jamais** retéléchargé ;
   - **arrêt** (`tts_local_cancel_download`) : l'installation s'arrête, rien n'est
     effacé ;
   - progression poussée par l'évènement `tts-local-download-progress` : taille
     **et** pourcentage de l'étape (`step`, `step_label`, `step_index`,
     `step_count`, `step_bytes`, `step_bytes_total`, `step_percent`) en plus du
     total (`bytes`, `bytes_total`, `percent`).
   Aucun téléchargement au démarrage, à l'ouverture des Options, ni pendant une
   lecture : seul un **clic** (ou le **choix** d'une voix dont le modèle manque)
   le déclenche.
   - **un fichier tronqué n'est jamais déclaré installé** : `tts_local::file_complete`
     compare la **taille exacte** attendue du catalogue ; un fichier de taille
     différente est **incomplet** (et sera réparé par le geste, sans suppression),
     jamais « installé » ;
   - `downloadDoneMessage` ne dit « terminé / lecture hors ligne » **que si**
     `installed` est vrai après vérification. Sinon (moteur manquant) :
     **avertissement** explicite, journalisé (`tts_local_log`) — jamais un succès
     mensonger, jamais un repli muet ;
   - **cohérence des deux catalogues** : `LOCAL_VOICE_MODELS` (JS) et `VOICES`
     (Rust) décrivent les mêmes voix, aux mêmes tailles ; `BUNDLE_MODELS` et
     `LOCAL_VOICE_BUNDLE_MODELS` sont identiques et `ENGINE_ARCHIVE_BYTES` =
     `LOCAL_VOICE_ENGINE_ARCHIVE_BYTES`. **`src/js/catalogue-voix-locales.test.js`
     échoue** dès qu'un identifiant, une taille ou le paquet installé divergent.
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
   - **la raison est dite LÀ OÙ L'UTILISATEUR ÉCOUTE** : `readAloudFallbackNotice(cause)`
     (`read-aloud.js`) affiche **une seule ligne** (`span.agent-read-notice`,
     `role="status"`) dans la rangée du bouton « 🔊 Écouter » de la réponse —
     « Voix locale indisponible (moteur absent) : lecture avec la voix du
     système. » La cause courte vient du moteur, jamais inventée :
     `localVoiceMissingCause(status)` → « moteur absent », « modèle incomplet »,
     « état du moteur inconnu » ; `localFailureShortCause(reason)` → « la
     synthèse locale a échoué », « le son local n'a pas pu être joué ». La
     mention est **transmise avec l'état** (`onstate(state, cause)`), elle est
     retirée au démarrage de la lecture suivante, et **n'existe pas** quand le
     repli n'a pas eu lieu (voix locale qui fonctionne, ou aucune voix locale
     choisie). Aucune fenêtre, aucun bandeau, aucune pastille, aucun espace
     occupé en dehors du repli.
   - une ligne datée est écrite dans **`<données>/voix-locale/voix-locale.log`**
     (`tts_local_log`, rotation au-delà de 256 Ko) — **un seul journal** ;
   - rien ne bloque, rien ne lève.
   - **la phrase affichée est non technique** (`missing_hint` côté Rust,
     `localVoiceMissingHint` côté JS) : « La voix locale n'est pas encore installée
     sur cet ordinateur (dossier utilisé : …) », puis **quoi faire** selon ce qui
     manque — moteur absent et installable : cliquer sur **« Installer la voix
     locale »** (le moteur et les deux voix sont alors installés **d'un seul
     geste, sur demande**) ; moteur absent et **non fourni** pour ce système :
     Pilot ne l'installe pas, la voix du système est utilisée ; modèle absent :
     le même bouton installe ce qui manque. Aucun `onnx`, `.exe`, `espeak` ni code
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
   avec le genre (`femme` / `homme`), la qualité et la taille exacte du `.onnx`
   (cohérence tenue par `src/js/catalogue-voix-locales.test.js`).
   `voice_for(Option<&str>)` retombe sur la voix par défaut pour une valeur
   absente **ou inconnue**.

## 4 ter. Repli de la voix du SYSTÈME : annoncé lui aussi là où l'on écoute

Même décision du propriétaire que le repli de la voix locale (§ 4.6), appliquée
à l'autre moteur : **une voix du système mémorisée dans le réglage qui n'existe
plus dans cette fenêtre** (voix désinstallée, autre ordinateur, autre système)
ne se remplace **jamais en silence**.

1. **Un seul endroit pour le constater** : `systemVoiceMissingCause(voices, choice)`
   (`read-aloud.js`, pure) compare la valeur mémorisée (`read_aloud_voice`) à la
   liste **réelle** des voix installées (`findVoiceForChoice`, identité stable
   puis nom). Elle renvoie `"voix introuvable"` quand le repli a lieu, et **rien**
   dans tous les autres cas : « Automatique » (`""` — la voix de la langue de
   l'interface *est* le choix), voix locale (son repli a sa propre phrase),
   aucune voix installée du tout (c'est `no-voice` qui parle).
2. **Un seul mécanisme, une seule ligne** : l'état `system-fallback` est transmis
   avec sa cause (`onstate(state, cause)`), et le bouton « 🔊 Écouter » affiche
   `readAloudSystemFallbackNotice(cause)` dans **le même** `span.agent-read-notice`
   que le repli local, dans la **même rangée** — aucune fenêtre, aucun bandeau,
   aucune pastille, aucun espace occupé hors repli. Phrase d'une ligne, sans
   alarme et sans jargon : « Voix du système choisie indisponible (voix
   introuvable) : lecture avec la voix de la langue de l'interface. »
3. **Cas normal muet** : la voix mémorisée est présente et sert réellement →
   l'état n'est **pas** émis, aucune mention n'existe dans la page.
4. **Le réglage n'est pas modifié** : on informe, on ne réécrit pas le choix de
   l'utilisateur (la remise sur « Automatique » reste un geste de la section des
   Options, § 3).
5. **L'état reste lisible dans les Options** : `readAloudStateLabel("system-fallback")`
   dit la même chose dans la ligne d'état de la section (aucun écran nouveau).

## 5. Portée

100 % local : synthèse du système (`speechSynthesis`) **ou** moteur local
(Piper). Aucune dépendance npm, aucun service en ligne, aucune voix installée
automatiquement, aucun enregistrement de ce qui est lu.

## 6. Couverture

`src/js/read-aloud.test.js` (lecture, nettoyage, une seule à la fois, voix),
`src/js/apercu-voix-parametres.test.js` (écoute d'exemple : **un seul chemin de
lecture** — compteurs de prise de parole et de nettoyage, aucune seconde liste
de voix —, un seul aperçu à la fois, arrêt à la fermeture des Options, échec
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
**seulement sur geste**, état visible / arrêt / échec, aucun effacement) et
`src/js/voix-locales-chargement-automatique.test.js` (chargement **automatique**
de l'état du moteur : la ligne d'état n'est jamais vide, un échec devient un état
**inconnu** et non « non installé », le rendu demande l'état **sans clic** même
avec « Automatique », le bouton et l'automatique passent par **le même**
`checkLocalVoiceStatus`, une seule fois par ouverture, aucun téléchargement).
Retirer l'appel `ensureLocalVoiceChecked(...)` fait **échouer** le contrôle de
branchement (vérifié avant/après). Côté
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

`src/js/repli-voix-muet.test.js` verrouille le **repli annoncé là où l'on
écoute** : la phrase (courte, sans jargon) et ses causes réelles, la mention
**visible à côté du bouton** avec le texte du repli, **aucune mention** quand la
voix locale fonctionne, **aucune mention** et aucun appel au moteur local quand
aucune voix locale n'a été choisie, et la disparition de la mention au démarrage
de la lecture suivante. Il couvre **les deux moteurs** : voix locale (§ 4.6) et
voix du système disparue (§ 4 ter) — `systemVoiceMissingCause` ne signale un
repli que si la voix mémorisée manque réellement, la phrase dit ce qui est
utilisé à la place, la mention apparaît près du bouton (un seul
`span.agent-read-notice`), **aucune mention** quand la voix est là, et le
réglage mémorisé (`getPreferredVoiceName()`) reste intact. Vérifié en cassant
exprès le code : retirer l'émission de `system-fallback`, forcer la cause, ou
retirer la branche d'affichage fait **échouer** ce fichier.

Aide utilisateur : `help/overview.md`, bloc `HELP:lire-reponses`.

## 6. Coupure par la voix (lot 4a) — tests et limites

`src/js/ecran-vocal-lot4a.test.js` verrouille ce qui précède : le seuil au-dessus
du résidu (et jamais sous le plancher), **trente secondes** de lecture avec un
résidu d'écho **sans aucune coupure**, une voix continue qui coupe **une seule
fois** après 200 ms, un claquement court qui ne coupe pas, la fin de lecture qui
remet la garde à zéro, l'`echoCancellation` **demandée** puis **relue**, la
**preuve par neutralisation** (même niveau, même lecture : annulation averée ⇒
coupure, annulation déclarée absente ⇒ aucune coupure), le repli sur le micro
simple quand une contrainte est refusée (un refus de l'utilisateur n'est jamais
retenté), le branchement unique `onSpeechStart` → `vocalBargeIn` → `stopReading`,
l'absence de tout lecteur supplémentaire et de toute reprise automatique, et le
fait que la coupure **n'arrête aucun agent** (c'est un arrêt d'écoute, pas un
arrêt de travail : l'entonnoir `agent-stop-funnel.js` n'a rien à y tracer).

**Ce que ces tests ne peuvent pas prouver**, et qui se vérifie au vrai micro : le
niveau d'écho réel de la pièce. La démarche est chiffrée dans
`.pilot/rapports/rapport-lot4a-coupure-parole.md` (lire `bargeInReport()` / la
ligne de console, comparer résidu et seuil). Si le résidu mesuré dépasse les
limites ci-dessus, la détection ne s'arme pas : c'est le comportement voulu.
