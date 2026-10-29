# Rapport — la réponse de l'Assistant était lue à voix haute deux fois

Écran **Vocal** : la réponse de l'Assistant était prononcée **deux fois de
suite** (la même phrase s'entendait deux fois). Ce rapport dit ce qui est
établi, ce qui a été corrigé, ce qui a été vérifié, et ce qui reste ouvert.

---

## 1. Le symptôme

En mode Vocal, après une demande, Pilot lit sa réponse (lecture automatique,
lot 2). Parfois la même phrase est prononcée **deux fois de suite**.

---

## 2. Ce qui a été écarté, et sur quelle preuve

Le texte envoyé à la synthèse est le même dans les deux lectures : il fallait
d'abord écarter un doublon **de texte**, puis un doublon **de déclenchement**.

| Hypothèse | Vérification | Verdict |
|---|---|---|
| Le nettoyage / découpage duplique le texte | `textForSpeech` puis `splitSentences` sur « Bonjour, voici la réponse. Elle est courte. » → exactement 2 morceaux, aucun mot répété ; la fonction est idempotente (`spec_read_aloud.md` §8) | écarté |
| Le texte de la bulle contient deux fois la réponse | `messageTextOf` lit les seules sections finales (`read-aloud.js:1154`) ; une section est **remplacée** à chaque rendu (`super-agent.js:2729`, `section.innerHTML = md.render(content)`), jamais complétée | écarté |
| Deux chemins de synthèse tournent ensemble dans Pilot | `speakEnabled` / `speak()` (`super-agent.js:1893`, `:6823`) est un reste **jamais activé** : la variable est déclarée `false` et n'est écrite nulle part ailleurs (2 occurrences dans tout le fichier). Seul `autoReadVocalReply` déclenche la lecture | écarté |
| La voix française locale joue deux fois un morceau | `playLocalChunks` (`local-voice.js:873`) boucle sur des index croissants, un seul `playUrl` par morceau, aucun retour en arrière | écarté |
| Le rendu non streamé crée une seconde bulle avec le même texte | le cas `message` (`super-agent.js`) sert au **repli d'historique**, pas au flux live | écarté |
| L'aperçu de voix des Paramètres parle en même temps | `previewVoice` passe par le même `createSpeaker` et **arrête** la lecture en cours (une seule lecture à la fois) | écarté |

Restent **deux chemins**, tous deux réels dans le code, tous deux **sans aucune
garde** : ce sont eux qui peuvent prononcer deux fois la même chose.

---

## 3. Les deux causes établies

### 3.1. La lecture automatique n'a aucune mémoire de la réponse

`autoReadVocalReply()` (`super-agent.js:5514`) part de la **fin de tour**
(`agent_end` → `onEnd` → `autoReadVocalReply`, `super-agent.js:4141`) et
actionne le bouton d'écoute de la **dernière** réponse
(`boutons[boutons.length - 1]`, `:5516`, puis `bouton.click()`, `:5524`).

Sa seule garde était l'**état transitoire** du bouton :

```js
const etat = bouton.dataset ? bouton.dataset.readState : "";
if (etat && etat !== "idle") return;      // super-agent.js:5529
```

Cet état vaut `idle` **dès que la lecture est finie** (`notify("ended")` →
`setState("idle")`, `read-aloud.js`). Or un tour n'a pas toujours une seule
fin : le projet documente lui-même des `agent_end` **multiples** pour un même
tour (relance automatique `willRetry` — `src-tauri/src/anomaly.rs:146`, `:222`,
`agents-bus.js`). La fin de tour suivante retrouvait donc la même dernière
réponse, bouton au repos, et la **relisait en entier**.

### 3.2. La voix du système pouvait prononcer deux fois le même morceau

`createSpeaker().speak()` découpe la réponse en morceaux et enchaîne sur la fin
de chaque énoncé :

```js
utterance.onend = () => speakIndex(index + 1);   // read-aloud.js
```

`speakIndex` n'avait **aucune mémoire de l'index déjà lancé** : un `onend`
signalé deux fois pour le même énoncé (comportement connu de Chromium /
WebView2, et signalé par le moteur après certains `cancel()`) appelait deux fois
`speakIndex(index + 1)` et mettait **deux fois le morceau suivant** dans la file
de synthèse — la phrase suivante s'entendait alors deux fois de suite.

### Ce qui n'est PAS tranché

Lequel des deux s'est produit chez le propriétaire, et à quel moment : les deux
mécanismes sont établis par le code, aucun ne laisse de trace. La correction
n'a pas besoin de le savoir (les deux gardes rendent la répétition impossible
par construction), mais si l'on veut un jour **nommer** le déclencheur, la
mesure à ajouter est une ligne dans le journal des arrêts/lectures :
`lecture auto demandée — bulle …, déjà lue : oui/non` et
`morceau n°… lancé`. Rien n'a été ajouté ici : ce serait un second mécanisme au
service du diagnostic, pas de la correction.

---

## 4. La correction (minimale, deux gardes)

1. **Une réponse ne se lit qu'une fois automatiquement** — nouveau module pur
   `src/js/reponse-lue-une-seule-fois.js` : `claimAutoRead(bouton)` rend `true`
   la première fois et marque le **bouton** (`dataset.vocalAutoRead`), `false`
   ensuite. `autoReadVocalReply` demande la garde **avant** de cliquer
   (`super-agent.js:5533`).
   - La marque vit sur le bouton, donc elle meurt avec la bulle : aucune
     mémoire globale, rien à nettoyer, aucun changement à la sortie du mode.
   - Le bouton « Écouter » reste **libre** : la garde ne concerne que la
     lecture *automatique*. Relire une réponse à la main fonctionne comme avant.
2. **Un morceau n'est jamais prononcé deux fois** — `speakIndex`
   (`read-aloud.js:999`) mémorise le dernier index lancé et ignore tout index
   antérieur ou égal. Les index ne reculent jamais : la lecture normale est
   inchangée, l'arrêt (`stopReading`) aussi.

Aucune modification : du micro, des seuils vocaux (`VOCAL_VOICE_ON` /
`VOCAL_VOICE_OFF`, `BARGE_IN_*`), de l'apparence de l'écran Vocal, des durées
d'animation, ni des décisions de la conversation parlée.

---

## 5. Ce qui a été vérifié

- **Le test anti-régression échoue sans la correction.** Avec les deux gardes
  retirées, `src/js/reponse-lue-une-seule-fois.test.js` échoue sur
  `2 failed` (le morceau suivant part deux fois ; `autoReadVocalReply` ne
  demande pas la garde). Avec les gardes, `7 passed`.
- **La lecture normale est intacte** : morceaux dans l'ordre, une seule annonce
  de fin, arrêt net qui empêche la suite.
- **La voix de l'utilisateur coupe toujours Pilot**, et **la reprise
  automatique de l'écoute** n'est pas touchée : `ecran-vocal-lot2`,
  `ecran-vocal-lot4a`, `ecran-vocal-nu`, `vocal-parler-declenche-une-demande`
  restent verts (ces deux derniers pointent seuls les fichiers concernés).
- Suite complète et build : voir le compte rendu de la session (chiffres
  recomptés sur le rapport JSON frais, pas recopiés).

---

## 6. Ce qui reste ouvert

1. **Nommer le déclencheur** chez le propriétaire (mécanisme 3.1 ou 3.2) :
   possible seulement avec la ligne de journal décrite au § 3. Rien n'est
   ajouté pour l'instant.
2. **`agent_end` multiples** : le fond du problème 3.1 est qu'un même tour peut
   se terminer plusieurs fois. La garde d'aujourd'hui empêche la relecture ;
   elle ne dit pas *pourquoi* le tour se termine plusieurs fois. Ce point
   appartient au suivi des agents, pas à la lecture.
