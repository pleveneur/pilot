# RAPPORT — Pourquoi la dictée locale « marche un moment » puis coupe

Date : 2026-11-10 (lecture des traces de 13:59 à 14:00, heure du poste)
Projet : `G:\IA_PL\pilot` — `HEAD` = `ef3cabd`
(« fix(dictation): notify the voice bridge when a local listening session is abandoned »)
Contexte : Pilot lancé par `npm run tauri dev` (`com.pilot.editor.dev`), `pilot.exe`
tourne encore pendant la lecture, case « Transcrire avec le service de voix local »
cochée, modèle **Parakeet TDT v3**.

> **Diagnostic seul.** Aucun code, test, réglage, journal ni fichier de VoiceStudio
> n'a été modifié. Aucun service relancé, rien installé, aucune suite de tests lancée,
> aucun commit. **Un seul fichier écrit : celui-ci.**

---

## 0. Conclusion

1. **La cause n'est pas le service de voix, ni le pont : elle est dans la fenêtre.**
2. Le journal montre **11 dictées ouvertes d'affilée et jamais refermées** (13:54:08 →
   13:56:33), groupées par 3 ou 4 à moins d'une seconde d'intervalle. À chaque fois, le
   pont referme **lui-même** la précédente (« session précédente refermée ») : la fenêtre
   en a donc **ouvert une nouvelle sans fermer l'ancienne**.
3. La fenêtre croit pourtant être « au repos » à ce moment-là : `rec.onerror` remet
   `voiceActive = false` **sans vérifier que l'évènement vient de la session en cours**
   (aucune garde d'identité dans le fichier — vérifié), et `startVoiceInput` fabrique une
   **oreille neuve, donc une session neuve au pont**, à chaque réarmement.
4. Le message affiché **ne nomme aucune cause** : il n'a **pas** de détail entre
   parenthèses. Sa phrase exacte est un fourre-tout, et c'est en soi le défaut à corriger.
5. Le correctif `ef3cabd` est juste mais **partiel** : il couvre l'abandon par *panne
   locale* (`panner` → `asr_voicestudio_cancel`), pas le chemin *session remplacée par
   une autre*. Le journal le prouve : **0 ligne « dictée locale interrompue »** sur les
   20 ouvertures de l'après-midi.

---

## 1. Ce que le journal du service de voix dit de la dernière tentative

Fichier lu : `C:\Users\pldistance\AppData\Roaming\com.pilot.editor.dev\voix-locale\voix-locale.log`
— 13 531 octets, 122 lignes, dernière écriture **2026-11-10 13:56:33.107**.
L'application **installée** (`…\com.pilot.editor\voix-locale\voix-locale.log`, 2 257 octets)
n'a rien écrit depuis **10:12:56** : elle n'est pas en cause, le poste tourne en dev.
L'application a démarré à **13:52:50** (`config.json` et `super-agent.db` réécrits).

| Heure | Ce que dit le journal |
|---|---|
| 13:52:52 → 13:54:08 | **9 dictées ouvertes ET refermées proprement** (durées : 17, 2, 3, 1, 7, 1, 7, 15, 1 s) |
| 13:54:08 → 13:56:33 | **11 dictées ouvertes, 0 refermée, 0 interrompue** ; chaque ouverture est précédée de « session précédente refermée » |
| 13:54:08 / 13:54:09 | 3 ouvertures (grappe 1) |
| 13:54:44 / 13:54:45 | 4 ouvertures (grappe 2) |
| 13:56:31 → 13:56:33 | 4 ouvertures (grappe 3) — **la dernière session est encore ouverte à 13:59** |

Compteurs du passage (depuis 13:52) : **20** « dictée locale ouverte » — **9** « dictée
locale refermée (attente du texte final) » — **11** « session précédente refermée » —
**0** « dictée locale interrompue » — **0** erreur, **0** ligne du service.

Ce que « session précédente refermée » signifie, mot pour mot dans le pont
(`src-tauri/src/asr_voicestudio.rs:1100-1105`) : *une seule dictée à la fois, la
précédente est refermée, jamais laissée ouverte en arrière-plan*. Autrement dit : **à cet
instant, la fenêtre a demandé une nouvelle session alors que la précédente était encore
vivante.** Et « interrompue » ne s'écrit que si l'abandon vient de la fenêtre
(`asr_voicestudio_cancel`, `:1202-1203`) : **il ne l'a jamais fait.**

## 2. Durée de vie, et longueur du texte reconnu

- **Durée de la session qui a coupé** : celle qui précède la cascade a vécu **1 seconde**
  (13:54:07 → 13:54:08), et elle a été **refermée normalement**, pas abandonnée. Les deux
  précédentes avaient tenu **15 s** puis **7 s**.
- **Durée des sessions de la cascade** : **moins d'une seconde** (deux ouvertures dans la
  même seconde). Ce sont des sessions **instantanées**.
- **Longueur du texte reconnu juste avant : NON ÉTABLIE.** Ni le pont ni la fenêtre
  n'écrivent jamais le texte reconnu, sa longueur, ni la raison de fin. Le pont ne dit que
  « ouverte », « refermée », « session précédente refermée ». C'est un trou de trace, pas
  une preuve de texte vide.

## 3. Le message affiché, mot pour mot

Il n'y a **aucun détail entre parenthèses** dans la phrase citée. Texte exact, une seule
source (`src/js/vocal-conversation.js:306`) :

```js
export const VOCAL_MESSAGE_DICTEE_ECHEC = "La dictée n'a pas fonctionné : écrivez votre demande.";
```

Le segment après le deux-points (« écrivez votre demande ») n'est pas une cause : c'est une
consigne à l'utilisateur. Cette phrase a exactement **deux producteurs** :

1. `src/js/super-agent.js:6694` — `if (raison === "sessions-vides") return VOCAL_MESSAGE_DICTEE_ECHEC;`
   c'est-à-dire **le plafond des sessions vides** (3 fins vides instantanées en 30 s,
   `VOCAL_EMPTY_SESSION_LIMIT`, `vocal-conversation.js:495-503`) ;
2. `src/js/vocal-conversation.js:356` — la branche **`default`** de `vocalDictationMessage`,
   donc **tout code non reconnu**.

La phrase **avec** parenthèses est une **autre** phrase, produite à un autre endroit
(`src/js/oreille-locale.js:238-246`) :

```
La dictée locale s'est arrêtée pendant l'écoute (<détail>). Rien n'a été envoyé. Je repasse à la dictée du navigateur, donc à un service en ligne.
```

Elle n'apparaît que si l'évènement porte `local === true`. **Ce n'est pas la phrase
citée** : donc, au moment de la coupure, la fenêtre n'a reçu **aucune panne du pont** —
ce que le journal confirme (0 erreur). Et comme le message retenu est le fourre-tout,
**l'écran ne pouvait pas nommer la cause** : le même texte couvre 12 codes différents.

## 4. Service, pont, ou fenêtre ?

| Acteur | Verdict | Preuve |
|---|---|---|
| **Service VoiceStudio** | **hors de cause** | Il a ouvert **20** sessions « (Parakeet TDT v3) », la dernière à 13:56:33 : il répondait. Aucune ligne de panne de service. |
| **Pont Rust (`asr_voicestudio`)** | **hors de cause**, mais c'est lui qui **révèle** le défaut | Il n'a jamais été prévenu d'un abandon (0 « interrompue »), n'a émis aucune erreur, et a appliqué sa règle : une seule dictée à la fois. |
| **Fenêtre (`src/js`)** | **responsable** | Voir ci-dessous. |

Deux faits de code, dans la fenêtre :

- `createDictationSession` (`super-agent.js:5576-5599`) rend une **oreille neuve**
  (`createLocalEar`) à **chaque** `startVoiceInput` : chaque réarmement ouvre donc une
  **session neuve au pont**, sans mémoire de la précédente.
- `rec.onerror` (`super-agent.js:5771-5772`) fait `voiceActive = false; voiceRec = null;`
  **sans aucune garde d'identité de session** (`voiceRec !== rec` : **0 occurrence** dans
  le fichier). Une fin appartenant à une session **périmée** remet donc la fenêtre
  « au repos » alors que la session locale, elle, **est toujours ouverte au pont** ; le
  réarmement suivant en ouvre une autre, et le pont referme la première — dont le texte
  déjà reconnu est alors **jeté**. C'est le mécanisme décrit comme H1 dans
  `RAPPORT-dictee-echec-apres-reponse.md` : **il est toujours là.**
- Effet secondaire cohérent avec le message : ces sessions de cascade durent moins d'une
  seconde ; trois fins vides instantanées en 30 s atteignent le plafond, et le plafond
  produit **exactement** la phrase citée par le propriétaire.

Chaîne reconstituée (les trois premiers points sont **prouvés** par le journal, le
quatrième est **déduit** du code, faute de trace côté fenêtre) :
session ouverte → une fin d'une session périmée remet `voiceActive` à `false` → réarmement
(350-400 ms) → nouvelle session au pont → le pont referme la précédente → sa fin revient et
remet encore `voiceActive` à `false` → … jusqu'au plafond des sessions vides, qui affiche
« La dictée n'a pas fonctionné : écrivez votre demande. »

## 5. Ce qui manque dans les traces, et où il faudrait l'inscrire

Rien de tout cela n'a été ajouté ici (mission de diagnostic seul). Ce qui manque, et le
point exact où l'écrire :

1. **La longueur du texte reconnu et la raison de fin de chaque dictée** : une ligne à la
   fin d'écoute, dans `rec.onend` (`super-agent.js`, ~5840-5880) — raison, `dureeMs`,
   longueur du texte final, identifiant de session. **La commande existe déjà pour cela**
   (`asr_voicestudio_log`, `src-tauri/src/asr_voicestudio.rs:1215`, enregistrée côté
   `lib.rs`) et **aucun fichier de `src/js/` ne l'appelle** — le canal est prêt, il est
   vide.
2. **L'identité des sessions dans le journal du pont** : les lignes ne portent aucun
   identifiant, donc aucune ligne ne peut être reliée à une session de la fenêtre. Un
   suffixe d'identifiant sur « ouverte » / « refermée » / « session précédente refermée »
   suffirait.
3. **La réception des fins côté fenêtre** : quel évènement (`onerror` / `onend`), quel code,
   et si la session qui le reçoit est **celle en cours**. Sans cela, le point 4 de la § 4
   reste déduit et non prouvé.
4. **Le message réellement affiché** au moment où il l'est : aujourd'hui, aucun des deux
   producteurs de la phrase ne laisse de trace, donc on ne peut pas distinguer « plafond
   des sessions vides » de « code inconnu ».

## 6. Ce que je n'ai pas fait

Aucun correctif, aucune modification de code, de test, de réglage, de journal ni de
VoiceStudio ; aucun redémarrage, aucune installation, aucun test lancé, aucun commit.
Le journal du service continue de grossir tout seul (application en cours d'exécution) :
l'état décrit ici est celui de **13:56:33**, relevé à **13:59**.

DONE: Cause de la coupure = **la fenêtre**, pas le service ni le pont : à chaque réarmement elle ouvre une session locale neuve sans fermer la précédente (11 « session précédente refermée », 0 « interrompue »), parce que `rec.onerror` remet `voiceActive=false` sans garde d'identité de session ; le pont referme alors l'ancienne et jette son texte, et le plafond des sessions vides affiche « La dictée n'a pas fonctionné : écrivez votre demande. » — phrase qui, contrairement à l'hypothèse de la mission, **ne contient aucun détail entre parenthèses** (celle à parenthèses est « La dictée locale s'est arrêtée pendant l'écoute (<détail>)… », jamais affichée ici) ; durée de la session coupée = 1 s, longueur du texte reconnu = **non tracée** (le canal `asr_voicestudio_log` existe et n'est jamais appelé).
