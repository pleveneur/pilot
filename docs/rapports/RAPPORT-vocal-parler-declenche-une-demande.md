# Rapport — parler dans l'écran Vocal déclenche une demande

## 1. Le défaut

Dans l'écran **Vocal**, parler animait l'écran (l'objet passait en « écoute », le
trait de niveau suivait la voix) mais **ne produisait rien** : aucune
transcription, aucune demande, aucune réponse.

Cause exacte : deux choses portent le mot « micro » dans cet écran, et elles ne
font pas le même travail.

| Ce qui existait | Ce qu'il fait | Ce qu'il ne fait pas |
|---|---|---|
| `vocal-mic.js` (lot 3) | mesure le **niveau** sonore : longueur du trait, état « écoute », garde anti-larsen | **ne transcrit rien** (son en-tête le dit : aucune reconnaissance de parole) |
| la dictée de la barre de saisie (`toggleVoiceInput`) | transcrit dans la zone, puis envoie (`applyVoiceEnd` → `send`) | ne s'ouvre que sur un **clic** sur 🎙️, et ses erreurs s'écrivent dans **la conversation… qui n'est pas affichée** dans cet écran |

Résultat : on parlait dans le vide sans le savoir, et un refus de micro n'aurait
été visible nulle part.

## 2. Ce qui a été fait

Aucun nouveau moteur, aucun nouvel envoi, aucun nouvel élément d'écran.

1. **Un module pur** `src/js/vocal-conversation.js` — la seule source des
   décisions : quand la dictée **s'arme** (au repos), quand elle **se désarme**
   (Pilot parle, Pilot travaille, hors du mode, projet sensible, erreur, arrêt
   manuel), quand elle **se réarme** (fin de lecture, avec une marge plus
   longue), et l'unique phrase à afficher pour chaque panne.
2. **Un seul point d'application** : la fin de `applyVocalState()`
   (`vocalSyncConversation()`). C'est déjà l'endroit qui connaît l'état de
   l'écran ; il n'y a pas de second appelant (vérifié par test : une seule
   occurrence dans tout le fichier).
3. **Une seule voie de démarrage** : `startVoiceInput()` a été **extraite** de
   `toggleVoiceInput()` (mêmes gardes, même corps, même `rec.onend` → même
   `applyVoiceEnd` → même `send`). Le bouton 🎙️ et l'armement automatique
   passent tous les deux par elle. `new SR()` n'apparaît **qu'une fois** dans
   le fichier (vérifié par test).
4. **Idempotence** : jamais deux sessions (`if (voiceActive) return;`), jamais
   deux minuteries (`vocalArmTimer`), et la décision est **réévaluée à
   l'échéance** (l'état a pu changer pendant les 350 / 600 ms).
5. **Trois sorties du mode** : `exitVocal()` ferme la dictée
   (`stopVoiceInput()`) et annule l'armement ; les deux autres sorties passent
   déjà par `exitVocal()` (vérifié par test).
6. **Garde anti-larsen pendant la dictée** : `vocalBargeIn()` rend la main si
   une dictée est ouverte. C'est la **même voix** qui est en train d'être
   transcrite ; la prendre pour une prise de parole couperait Pilot sur les mots
   qu'on lui dicte. **Aucun seuil n'a bougé** (`VOCAL_VOICE_ON = 0.06`,
   `VOCAL_VOICE_OFF = 0.03`, `BARGE_IN_*` inchangés — verrouillié par test).
7. **Les erreurs se voient** : en mode Vocal, `rec.onerror` et l'échec de
   démarrage passent par `reportVoiceFailure()`, qui écrit dans l'**unique ligne
   d'état** (`vocalMicFerme`, le canal déjà utilisé pour les pannes de micro) et
   jamais dans la conversation masquée. Chaque message dit quoi faire
   (« … : écrivez votre demande. ») : le clavier reste utilisable.
8. **Projet sensible** : le drapeau est relu à l'entrée du mode
   (`is_project_sensitive`, comme l'onglet agent π). Un projet sensible ne
   dicte jamais (dictée cloud), la règle existait déjà et n'a pas changé ;
   l'erreur d'IPC est *fail-open*.
9. **Réarmement après une fin d'écoute** : `rec.onend` réapplique l'état, sinon
   la dictée resterait fermée après un silence jusqu'au prochain changement.

## 3. Le point à risque : deux captures micro en même temps

C'était le point signalé par le diagnostic. Il est **réel** et il est assumé :

- `vocal-mic.js` tient un flux `getUserMedia` (annulation d'écho, réduction de
  bruit, gain auto) **pendant tout le mode** ;
- la dictée ouvre **sa propre** capture (service de reconnaissance du
  navigateur), en même temps.

Ce qui a été vérifié :

- **Rien n'a été changé côté micro** : `vocal-mic.js` est intact (aucune ligne
  modifiée), donc les acquis des lots 3 / 4a (arrêt réel à la sortie, garde
  anti-auto-coupure, pannes) ne bougent pas.
- **La sortie ferme les deux** : `exitVocal()` ferme la dictée *et* le flux de
  mesure. Rien ne reste ouvert derrière l'écran.
- **La garde anti-larsen reste prioritaire** : pendant la lecture de Pilot, la
  dictée est fermée (règle 3) — donc aucune des deux captures ne peut
  s'entendre elle-même et couper la réponse.
- **Le risque résiduel**, à savoir une plateforme qui refuserait la seconde
  capture pendant la première : il se traduit par une erreur de dictée
  parfaitement visible (`audio-capture` → « Le micro est occupé par une autre
  application : écrivez votre demande. »), sans bloquer l'écran, sans boucle de
  relance (règle 6) et sans jamais toucher au micro de mesure. C'est le
  comportement attendu si WebView2 ou un pilote audio ne permet qu'une capture :
  l'écran reste utilisable, le clavier marche, et le message dit pourquoi.

## 4. Ce qui n'a pas changé (et ne devait pas)

- l'apparence de l'écran : objet, trait, **une seule** ligne d'état, barre de
  saisie, logo-bouton des modes, trois sorties — aucun élément ajouté ;
- les phrases au repos / parole / réflexion (les messages d'erreur sont des
  messages de panne, comme ceux du micro) ;
- les seuils et durées de `vocal-mic.js` ;
- la coupure de la réflexion (`vocal-couper-la-reflexion.test.js` vert) ;
- l'écran nu (`ecran-vocal-nu.test.js` vert) ;
- l'envoi automatique en fin de dictée (`envoi-auto-fin-dictee.test.js`,
  `envoi-auto-dictee-web-distant.test.js` verts) ;
- aucun réglage, aucun curseur, aucun bouton de débogage.

## 5. Tests

- `src/js/vocal-conversation.js` : décisions pures (armer au repos, réarmer
  après lecture, désarmer pendant la parole / le travail, hors mode, projet
  sensible, idempotence, arrêt manuel, erreur, sans transcription) + plan
  (une seule session, une seule minuterie) + messages (une phrase par panne,
  silence ≠ panne).
- `src/js/vocal-parler-declenche-une-demande.test.js` : 30 cas — décisions,
  messages et **câblage** (un seul point d'application, une seule voie de
  démarrage, une seule minuterie, trois sorties qui ferment, réarmement en fin
  de lecture, garde de coupure pendant la dictée, erreurs dans la ligne d'état,
  aucun second envoi, aucune API micro dans l'écran, projet sensible relu).
- Suite complète : **3708 tests verts**, aucun test supprimé.
