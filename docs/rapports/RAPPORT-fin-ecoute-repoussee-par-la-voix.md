# RAPPORT — La fin d'écoute est repoussée par la VOIX, plus seulement par le texte

Date : 2026-11-17 · Projet : `G:\IA_PL\pilot` (front Tauri + JS, tests Vitest)
Demande du propriétaire : *« En mode vocal, l'écoute se coupe avant que j'aie fini de
parler, même quand je ne marque pas de pause. »*

---

## 1. Le défaut, tel qu'il a été établi

Le diagnostic est écrit et n'est pas refait ici : il vit dans
`docs/rapports/RAPPORT-diagnostic-ecoute-coupee-avant-la-fin.md`. Ce qu'il établit, en une
phrase : **c'est l'écran (Pilot) qui referme la dictée**, par son minuteur de silence
(`vocalSilenceTimer`), et ce minuteur **ne comptait que les MOTS TRANSCRITS** — jamais le
son. Huit fins d'écoute sur huit ont été imputées à ce minuteur, aucune au moteur de
reconnaissance, aucune à la garde anti-écho, aucune au service de voix local.

Conséquence directe : dès que la transcription **rend la main en retard** (ou par
morceaux), on continue de parler alors qu'aucun texte n'arrive ; l'échéance tombe
(**2 000 ms** par défaut, **1 500 ms** réglé sur le poste du propriétaire) et la dictée se
referme **au milieu de la phrase**, alors que le micro entendait parfaitement la voix.

Ce que le correctif ne change pas, et qui n'était donc pas en cause : la capture du micro,
la transcription, le service de voix local, la garde anti-écho (barge-in), la veille de
20 s, le réglage du délai, ni le défaut de 2 secondes.

---

## 2. Le correctif

**Un fait nouveau dans la décision, aucun nouveau capteur.** Tant que le micro **capte une
voix**, l'échéance **recule**. Le son n'est pas mesuré une seconde fois : c'est le drapeau
`vocalMicCapte`, produit par la décision de niveau qui existe déjà (deux seuils, hystérésis
0,06 / 0,03, `vocalCapte`) et qui sert **déjà** à la veille de 20 s. Le micro de mesure est
ouvert pendant toute la dictée, quelle que soit l'oreille (navigateur ou service local) :
le fait est donc disponible sans rien ajouter.

| Où | Quoi |
|---|---|
| `src/js/vocal-conversation.js` | **décision pure** `decideVocalSoundExtension(etats)` → `VOCAL_SOUND_RESTART` / `VOCAL_SOUND_HOLD`, plus `VOCAL_SILENCE_SOUND_MAX_MS` (plafond). Elle ne lit ni l'horloge ni le micro : `ecouleMs` et `voixCaptee` **arrivent avec l'état**. |
| `src/js/super-agent.js` | `vocalSoundState()` : les faits existants (`vocalSilenceState`) **plus deux** seulement — `voixCaptee` (`vocalMicListening && vocalMicCapte`) et `ecouleMs` (depuis le dernier mot transcrit, `vocalMotInstant`). Dans `vocalNoteWord`, à l'échéance : la décision du silence est réévaluée **d'abord**, puis celle du son ; si le son repousse, **le même** minuteur est réarmé par une fonction imbriquée ; sinon `vocalCloseForSend()` (voie d'envoi inchangée). |

**Un seul minuteur.** Le réarmement passe par la **même** affectation
(`vocalSilenceTimer = setTimeout(`) : le fichier n'en contient toujours qu'une, et il n'y a
jamais deux minuteurs en vol. Les gardes de la décision du silence (Pilot parle, dictée
refermée, reprise en main, aucun mot) **passent avant** : elles annulent tout, comme avant.

**Ordre des règles du son** (c'est la spec, testé tel quel) : hors du mode → **Pilot
parle** → dictée refermée → reprise en main → aucun mot → pas de voix → plafond →
**repousser**. La règle « Pilot parle » compte : pendant la lecture, ce qu'entend le micro
est la voix de Pilot sortie des haut-parleurs ; la laisser compter ferait tourner le
minuteur sans fin pendant chaque réponse.

---

## 3. Le garde-fou : un bruit de fond permanent ne tient pas l'écran ouvert

Sans borne, un ventilateur, une télévision ou une conversation voisine au-dessus du seuil
de détection **repousserait l'envoi sans fin** : plus rien ne partirait jamais, ce qui
serait **pire** que le défaut corrigé (l'utilisateur devrait reprendre la main à la voix ou
au clavier). Le plafond est donc explicite, et il n'est **pas** auto-entretenu : il se
mesure depuis le **dernier mot TRANSCRIT**, pas depuis le dernier report.

`VOCAL_SILENCE_SOUND_MAX_MS = 15 000 ms`, et voici pourquoi **15 s** :

- **7,5 ×** le défaut (2 s) et **3 ×** le réglage maximal (5 s) : de quoi absorber un vrai
  retard de transcription, jamais de quoi s'installer ;
- **plus court que l'autre référence de silence du produit** (la veille, 20 s) : « j'attends
  la fin de la phrase » ne dépasse jamais « je vous crois silencieux » ;
- **bien plus long qu'une hésitation** (une à deux secondes) : aucune parole réelle n'est
  coupée par ce plafond.

Le report est de plus **borné par ce qui reste** (`Math.min(délai réglé, reste)`) : un
report de 2 s ne peut pas franchir le plafond, il est raccourci.

**Non établi** : aucune mesure au vrai micro n'a été faite ici (aucun banc audio lancé).
15 s est un choix **argumenté**, pas une valeur mesurée sur la voix du propriétaire. La
mesure qui le confirmerait (durée maximale observée d'un retard de transcription sur les
deux oreilles) n'existe pas dans le dépôt.

---

## 4. La preuve

Fichier neuf : `src/js/fin-ecoute-repoussee-par-la-voix.test.js` — **15 tests**, dont un
banc temporel sous horloge simulée qui reproduit exactement la règle de l'appelant, et des
verrous de source qui vérifient que le code **fait** ce que le banc dit.

Il couvre, dans cet ordre :

1. la décision pure : un son repousse, une voix absente laisse tomber ; le report suit le
   **réglage** (1 s comme 5 s) et jamais une constante recopiée ; le plafond **raccourcit**
   le dernier report ; les cinq faits de conversation qui priment sur le son ; le plafond
   justifié (15 s, sous la veille, au-dessus du réglage) ; l'absence d'horloge et de micro
   dans la fonction ;
2. le temps : une voix continue **repousse** (l'écoute ne se referme pas pendant la
   parole), la parole qui s'arrête **referme et envoie**, le plafond referme à 15 s pile,
   un nouveau mot **remet le plafond à zéro**, sans voix le délai réglé est **inchangé**,
   et Pilot qui parle ou une reprise en main ne repoussent **rien** ;
3. le branchement réel : ordre silence → son → fermeture, **un seul** minuteur, **un seul**
   appel à la décision du son, `vocalMotInstant` posé et remis à zéro, aucune seconde
   capture ni analyseur, barge-in et veille **intacts**, ni le défaut (2 s) ni le plafond
   (15 s) recopiés dans l'écran.

### Les mutations (le test mord, et on sait sur quoi)

Chaque mutation a été appliquée seule, le test lancé, puis le code **restauré à
l'identique** (`diff` vide, vérifié) :

| # | Mutation | Ce qui échoue |
|---|---|---|
| 1 | **Le défaut d'origine** : le son ne compte plus (`if (true) return tenir("sans-voix")`) | **5 tests** : « un son capte repousse l'echeance… », « le report suit le delai REGLE… », « une voix continue repousse l'echeance… », « le son ne repousse pas indefiniment… », « un nouveau mot REMET le plafond a zero… » |
| 2 | **Aucun plafond** (report illimité, un bruit de fond repousse sans fin) | **3 tests** : « le report suit le delai REGLE, et il est borne par le plafond », « le son ne repousse pas indefiniment… », « un nouveau mot REMET le plafond a zero… » |
| 3 | **L'écran ignore la décision du son** (le minuteur ne compte que les mots — l'appelant d'avant) | **1 test** : « l'echeance est repoussee par le son, puis refermee par la voie existante » |
| 4 | **Plus aucun envoi à l'échéance** (`vocalCloseForSend()` retiré) | **1 test** : « l'echeance est repoussee par le son, puis refermee par la voie existante » |
| 5 | **La voix de Pilot compte** (règle « Pilot parle » retirée) | **1 test** : « le son ne repousse rien quand un fait de conversation prime sur lui » |

---

## 5. Chiffres mesurés

| Mesure | Valeur |
|---|---|
| Suite complète (`npx vitest run`), après correctif | **5895 tests, 319 fichiers, 0 échec** |
| Même suite avant ce lot (dernier chiffre connu) | 5880 |
| Delta | **+15**, exactement les 15 tests du fichier neuf (aucun test existant touché) |
| `src/js/fin-ecoute-repoussee-par-la-voix.test.js` seul | 15 tests, 0 échec |
| `src/js/registre-comportements-valides.test.js` | 10 tests, 0 échec (registre à **27** entrées) |
| Tests existants du mode Vocal rejoués | `vocal-repondre-deux-secondes`, `vocal-delai-envoi-reglable`, `vocal-nom-garde` : 99 tests, 0 échec |
| `npm run build:handbook` | 50 blocs, `help/handbook.md` régénéré |

**Non mesuré** : aucune exécution Rust (`cargo test`) — aucun fichier Rust n'est touché par
ce lot. Aucun essai au vrai micro, donc **aucune preuve en conditions réelles** que le
défaut rapporté disparaît sur le poste du propriétaire : la preuve est **la règle** et son
branchement, pas l'oreille du propriétaire.

---

## 6. Documents tenus à jour

- `spec_modes_ecran_vocal.md` : nouvelle section **§ 6bis.1 ter « Le SON de la voix
  repousse l'échéance »** (règle, mécanisme de niveau réutilisé, ordre des règles, plafond
  justifié, ce qui n'est pas touché, couverture).
- `spec_voice_input.md` : la phrase utilisateur du mode Vocal dit que **le son** repousse
  l'échéance, et renvoie au § 6bis.1 ter.
- `help/overview.md` : nouvelle puce « **Votre voix compte autant que le texte** » (défaut
  corrigé, garde-fou des 15 s) ; `help/handbook.md` **régénéré** (`npm run build:handbook`).
- `spec_registre_comportements_valides.md` : entrées **25, 26, 27** (parole qui tient
  l'écoute ouverte, plafond du bruit de fond, délai inchangé sans voix).
- `AGENTS.md` : la ligne de `vocal-conversation.js` décrit désormais la décision du report
  par le son et son plafond.

## 7. Ce qui est garanti, et ce qui ne l'est pas

**Garanti, par construction et par test** : un son capté repousse l'échéance du silence ;
on ne referme plus la dictée pendant que le micro entend une voix ; un bruit de fond
permanent ne peut pas dépasser 15 s après le dernier mot transcrit ; il n'existe toujours
qu'**un** minuteur et **une** voie d'envoi ; les décisions du silence, le délai par défaut,
le réglage du propriétaire, l'interruption par la voix et la veille de 20 s sont
**inchangés** (et verrouillés comme tels).

**Non établi** : le comportement sur la machine du propriétaire (aucun essai au vrai
micro) ; la valeur « idéale » du plafond (15 s est argumenté, pas mesuré) ; la fréquence
réelle des retards de transcription sur les deux oreilles.
