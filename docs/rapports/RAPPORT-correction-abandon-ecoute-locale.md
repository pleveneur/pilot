# RAPPORT — Une écoute abandonnée prévient le service de voix local

Date : 2026-11-18 · Projet : `G:\IA_PL\pilot` (Tauri v2 + JS, tests Vitest)
Mission : corriger le défaut établi par
`docs/rapports/RAPPORT-diagnostic-erreurs-dictee-locale.md` — une dictée locale
**abandonnée** ne prévenait pas le pont du service de voix local, alors que
l'**arrêt normal** le faisait.

Aucun fichier de VoiceStudio, aucun réglage, aucun modèle, aucune préférence
n'a été touché. Rien n'a été installé, téléchargé, relancé ni redémarré. Aucun
push, aucune PR, aucune release : **un commit local** seulement.

---

## 1. Le défaut, en une phrase

`panner(message)` — le seul chemin par lequel une écoute locale se termine
**mal** (panne du pont, session refusée, écoute jetée) — posait `termine = true`,
refermait le robinet du micro, puis **s'arrêtait là** : la session restait
**ouverte côté service**. C'est la tentative **suivante** qui la refermait, car
`asr_voicestudio_start` interrompt la session précédente — et le texte que cette
session avait déjà reconnu partait avec elle. Le journal du service enregistrait
« session précédente refermée » et la fenêtre affichait
« **Le service de voix local s'est arrêté pendant la dictée** » alors que le
service était parfaitement sain.

Sept abandons de ce type en dix-neuf secondes : c'est la trace exacte du
diagnostic.

## 2. Ce qui a changé (4 fichiers de source, 1 fichier de test)

### `src/js/oreille-locale-moteur.js` — une seule façon d'abandonner

| Avant | Après |
|---|---|
| `panner` : ni interruption, ni remise du texte | `panner` : **remet le texte déjà reconnu**, puis **abandonne** la session auprès du pont |
| refus pendant l'ouverture : `invoke("asr_voicestudio_cancel", …)` écrit en clair | appelle la fonction partagée |
| arrêt **normal** : `invoke("asr_voicestudio_cancel", …)` écrit en clair | appelle la fonction partagée |

- **`abandonnerSession(id)`** (nouvelle fonction, **seul** site de
  `invoke("asr_voicestudio_cancel", …)` du module) : sans identifiant ou sans
  `invoke`, elle ne fait rien ; elle **ne lève jamais** (l'abandon ne doit pas
  produire une seconde panne) ; elle est `await`ée là où l'ordre compte et
  lancée sans attente depuis `panner`, qui ne peut pas être asynchrone.
- **`panner` remet le texte d'abord**, par la **porte unique** du texte
  (`emettreResultat()` → `onresult`), **avant** de capturer et vider
  `sessionId` puis d'abandonner. L'écran écrit ce texte dans la zone de saisie
  par le gestionnaire de résultat existant, et la branche d'erreur **ne
  l'efface pas** : les mots déjà obtenus ne sont plus jetés une seconde fois.
- **L'arrêt normal garde son propre chemin** : `asr_voicestudio_stop` n'est pas
  remplacé par `cancel` — le service doit rendre son texte final.

### `src/js/oreille-locale.js` — la phrase n'accuse plus un service sain

`localEarFailureMessage` disait « Le service de voix local s'est arrêté pendant
la dictée ». C'était faux dès que le service était sain. Elle dit maintenant ce
qui est **prouvé** :

> La dictée locale s'est arrêtée pendant l'écoute (*<détail rendu par le pont>*).
> Rien n'a été envoyé. Je repasse à la dictée du navigateur, donc à un service
> en ligne.

La **cause réelle** n'est plus devinée : elle reste au **détail** que le pont
fournit, qui nomme le service quand c'est lui qui est en cause. Le repli vers le
navigateur reste **annoncé**, jamais silencieux (règle de `spec_voice_input.md`
§9, inchangée).

### `src/js/super-agent.js` — commentaire seulement

Le commentaire de la branche d'erreur dit désormais ce qui est vrai (la dictée
locale s'est arrêtée, le texte déjà obtenu reste dans la zone). **Aucune ligne
de code n'a changé** dans ce fichier.

### `src/js/oreille-locale-etape2.test.js` — un verrou resserré

Le test « une panne PENDANT l'écoute est dite, et le retour en ligne est
annoncé » vérifiait l'ancienne phrase. Il **n'a pas été supprimé ni relâché** :
il vérifie maintenant davantage — que l'accusation a **disparu**, que la cause
réelle est **dite**, que « Rien n'a été envoyé » et le retour au service en
ligne sont là.

### `spec_voice_input.md` — §9

La ligne « Pendant l'écoute » est corrigée et une sous-section décrit l'abandon
(une fonction, le texte conservé, la phrase honnête) avec le renvoi vers ce
rapport et vers le verrou.

## 3. La preuve

### 3.1 Un verrou neuf : `src/js/abandon-ecoute-prevenir-le-service.test.js`

14 tests, un **faux pont** qui se comporte comme le vrai sur le point qui
compte (une session abandonnée **sans être prévenue** reste ouverte, et c'est le
`start` suivant qui la referme **en jetant son texte**), un faux micro et
l'oreille locale **réelle** (`createLocalEar`). Rien n'est simulé du module
corrigé.

| Groupe | Ce qui est interdit de régresser |
|---|---|
| 1. L'abandon prévient le pont | une panne d'envoi et une erreur annoncée par le pont interrompent la session **une seule fois**, avec le bon identifiant ; le robinet du micro est refermé ; l'arrêt normal garde `stop` et n'appelle **jamais** `cancel` ; une panne répétée ne réabandonne rien ; **il n'y a qu'une seule fonction d'abandon** et la panne ne recopie pas l'appel |
| 2. Le texte n'est plus jeté | le texte déjà reconnu est remis **avant** la panne, le texte final du pont est remis, la tentative **suivante ne jette plus rien** (`jetes` vide), une panne sans texte n'invente **aucun** résultat, et la branche d'erreur de l'écran **n'efface pas** la zone de saisie |
| 3. La phrase est honnête | elle dit ce qui est prouvé, ne contient **plus** « service de voix local s'est arrêté », porte la cause réelle quand le pont la donne, n'invente pas de parenthèses vides, et **ne prend pas** les erreurs qui ne sont pas locales |

### 3.2 Morsures (mutations) — trois, chacune restaurée aussitôt

| Mutation appliquée | Résultat mesuré |
|---|---|
| M1 : retirer `void abandonnerSession(abandonnee);` de `panner` | **6 échecs** / 14 |
| M2 : retirer `emettreResultat();` de `panner` (le texte n'est plus remis) | **2 échecs** / 14 |
| M3 : remettre la phrase accusatrice dans `localEarFailureMessage` | **4 échecs** (3 du verrou neuf + 1 du verrou de l'étape 2) |

Après chaque morsure, le fichier a été restauré **à l'identique** et la suite
repassée au vert.

### 3.3 Suite complète, chiffres **mesurés**

```
npx vitest run
  fichiers de test : 317   (306 dans src/js, 11 dans scripts)
  tests            : 5868
  réussis          : 5868
  échoués          : 0
  en attente       : 0
  ignorés (todo)   : 0
  code de sortie   : 0
```

Comptage obtenu par le rapporteur JSON de Vitest (`--reporter=json`) puis
supprimé ; le total inclut les 14 tests neufs. Aucun test existant n'a été
supprimé, sauté ni relâché.

## 4. Ce qui reste non établi

1. **La cause exacte des huit réouvertures n'est pas établie.** Le correctif
   répare ce que l'abandon faisait de travers ; il ne dit pas **pourquoi** la
   fenêtre a rouvert l'écoute huit fois en dix-neuf secondes. Aucun journal côté
   fenêtre n'existe (`tauri dev` hérite de stdio, pas de `window.onerror`, pas de
   trace de dictée dans le journal du service).
2. **Aucune preuve en conditions réelles.** Rien n'a été lancé : ni Pilot, ni
   VoiceStudio. Les preuves sont des preuves de code et de décision, pas une
   observation du service avec le correctif en place. Le journal
   `%APPDATA%\com.pilot.editor*\voix-locale\voix-locale.log` **n'a pas été
   relu** après correction.
3. **Le nombre d'abandons évités en usage réel n'est pas mesuré.**
4. **La version publiée (buildée) n'est pas corrigée** : `dist/` n'est pas
   touché par ce lot, et l'application installée porte encore le texte
   précédent tant qu'une version n'est pas construite.

## 5. Fichiers touchés

- `src/js/oreille-locale-moteur.js` — `abandonnerSession` + `panner` remanié ;
- `src/js/oreille-locale.js` — `localEarFailureMessage` ;
- `src/js/super-agent.js` — commentaire de la branche d'erreur (aucun code) ;
- `src/js/oreille-locale-etape2.test.js` — un verrou resserré ;
- `src/js/abandon-ecoute-prevenir-le-service.test.js` — **neuf** ;
- `spec_voice_input.md` — §9 ;
- ce rapport.

`help/handbook.md` n'a pas bougé (`build:handbook` : « déjà à jour »), les blocs
`<!-- HELP:* -->` de la spec concernée étant hors de la zone modifiée.

Aucun fichier d'un autre chantier n'a été modifié.
