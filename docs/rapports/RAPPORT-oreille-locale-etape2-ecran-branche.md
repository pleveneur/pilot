# Rapport — Oreille locale, étape 2 : l'écran est branché

**Date** : 2026-11-15
**Demande du propriétaire** : « que ma dictée soit transcrite sur cet ordinateur,
et que l'écran me le dise — sans jamais basculer en silence vers un service en
ligne ».
**Périmètre de cette étape** : brancher la dictée de l'écran sur le pont machine
livré à l'étape 1 (`fa7a8c3` reste intact : la garde du nom de l'écran Vocal).

---

## 1. Ce qui est livré, en une phrase par point de la mission

| Point de la mission | Ce qui a été fait | Où |
|---|---|---|
| **1. Un seul réglage** | Une case à cocher « Transcrire avec le service de voix local » (périmètre : **la dictée de l'écran Vocal**, là où le micro de l'application est ouvert ; ailleurs, la dictée reste celle du navigateur, et c'est dit), **une seule clé** `local_dictation` (`#[serde(default)]`, **faux** par défaut ⇒ configuration ancienne inchangée). Décochée, **aucune** décision ne change. | `index.html`, `src/js/settings.js`, `src-tauri/src/lib.rs` |
| **2. Le micro ne bouge pas** | Une seule capture dans tout le projet (`vocal-mic.js`, un seul `getUserMedia`). L'oreille locale **consomme** le flux déjà capté par un robinet muet (`setAudioTap` sur un `ScriptProcessorNode`), elle n'ouvre ni second flux ni second micro. | `src/js/vocal-mic.js` |
| **3. Le modèle choisi et affiché** | Le modèle est **lu dans la réponse du pont** (`model_label`), jamais choisi par l'écran. Il est dit en une phrase simple sous la case, et rappelé dans l'infobulle du bouton 🎙️ (« transcription sur cet ordinateur avec « … » »). Un meilleur modèle installé plus tard change la phrase, pas le code. | `src/js/oreille-locale.js`, `src/js/settings.js`, `src/js/super-agent.js` |
| **4. Repli visible, jamais silencieux** | Chaque panne a sa phrase, et cette phrase dit **toujours** que la dictée repart vers un **service en ligne**. Pendant l'écoute, la panne est dite immédiatement et la décision est recalculée **sans statut** (donc « service absent »). | `oreille-locale.js`, `super-agent.js` |
| **5. Ligne d'état honnête** | La ligne **existante** dit laquelle des deux oreilles écoute : « J'écoute avec le service local. » / « Le service local est absent : je dicte autrement. » / « Je vérifie si la dictée locale peut servir… ». **Aucun nouvel élément d'interface.** | `super-agent.js` |
| **6. Latence connue** | **~9,5 s de texte final pour ~5,6 s de parole** (mesure de l'étape 1). La dictée reste utilisable (les partiels s'écrivent au fil de l'eau) mais **elle n'est pas fluide** : ce rapport ne prétend pas le contraire. | § 6 de ce rapport |

## 2. Trois modules, une seule porte

- `src/js/oreille-locale.js` — les **décisions**, pures : la clé, le plan lu dans
  la réponse du pont, les phrases (repli, ligne d'état, panne), le format du son
  (16 kHz, PCM 16 bits petit-boutiste écartelé, morceaux de 3 200 octets = 100 ms).
- `src/js/oreille-locale-moteur.js` — le **moteur** : un objet de la **même forme**
  qu'une session `SpeechRecognition`. C'est le point qui évite un second chemin de
  dictée : tout le reste (garde du nom, envoi sur silence, reprise en main, envoi
  automatique) reste écrit **une fois** dans `super-agent.js`.
- `src/js/super-agent.js` — le **branchement** : `createDictationSession(SR)`
  choisit le fournisseur, `startVoiceInput()` reste la seule voie de démarrage,
  `SR` est fourni par l'appelant (un seul `new SR()` dans tout le fichier).

La fenêtre ne joint **jamais** le service : elle n'utilise que les commandes et
l'évènement de l'étape 1 (`oreille-locale-etape1.test.js`, revérifié).

## 3. Le repli, cas par cas (la règle non négociable)

| Situation | Ce que l'écran fait |
|---|---|
| Case décochée | Rien de plus : dictée du navigateur, comme avant. |
| Service absent / muet / sans modèle français / dictée non prête | Phrase dans la conversation (hors mode Vocal) ou dans la ligne d'état (mode Vocal), disant qu'on **dicte autrement** et que le son repart vers un **service en ligne**. |
| Réglage coché, avant la première dictée | « Je vérifie si la dictée locale peut servir… » ; l'écoute automatique **attend** la réponse du pont au lieu de partir en ligne. |
| Service qui s'arrête **pendant** l'écoute | Phrase immédiate (« s'est arrêté pendant la dictée… Je repasse à la dictée du navigateur, donc à un service en ligne »), robinet refermé, décision recalculée sans statut. |
| Hors du mode Vocal (micro de l'application fermé) | Le moteur refuse de démarrer et le dit : « Le service de voix local ne peut pas recevoir le son du micro hors du mode Vocal. Ici, la dictée passe par le navigateur, donc par un service en ligne. » |

## 4. Verrous ajoutés (`src/js/oreille-locale-etape2.test.js`, 34 verrous)

Les verrous échouent **si le repli devient muet** ou **si le son repart en ligne
sans que l'écran le dise**. Deux mutations ont été jouées pour le prouver :

1. rendre `localEarFallbackSentence()` muet ⇒ 2 verrous rouges
   (« raison service-absent muette », « un service indisponible ne donne JAMAIS
   une dictée locale muette ») ;
2. supprimer l'annonce du repli dans `createDictationSession()` ⇒ 1 verrou rouge
   (« le choix du fournisseur ANNONCE le repli avant de repartir en ligne »).

Le fichier verrouille aussi : la clé unique et son défaut faux, la case unique
dans les Paramètres, le micro unique (un seul `getUserMedia`, aucun `AudioContext`
dans le moteur), l'absence de toute adresse ou `fetch` dans la fenêtre, le format
du son, le modèle affiché, la ligne d'état unique, la garde du nom appliquée au
texte local (**aucun test sur `localEar` dans le gestionnaire de résultats**), et
le comportement réel du moteur sur un faux pont (ouverture, morceaux de 100 ms,
texte cumulatif, panne dite, arrêt qui n'envoie plus rien).

`vocal-nom-garde.test.js` (garde du nom, 34 verrous) et
`oreille-locale-etape1.test.js` restent **verts sans modification**.

## 5. Mesures

```text
npx vitest run                                        → PASS (5451) FAIL (0)
cargo test --manifest-path src-tauri/Cargo.toml --lib  → 882 passed, 3 ignored
```

Aucun test existant n'a été modifié pour passer.

## 6. Limite connue : la latence

Mesurée à l'étape 1 sur le service local (RTX 5080) : **premier partiel à ~0,9 s**,
**texte final à ~9,5 s pour 5,6 s de parole**. À l'usage : on parle normalement, le
texte s'écrit au fur et à mesure, et le texte définitif arrive quelques secondes
après le dernier mot — donc l'envoi automatique du mode Vocal part plus tard que
sur la dictée du navigateur. C'est **utilisable**, ce n'est **pas fluide**, et
l'écran ne promet rien d'autre.

## 7. Ce qui reste ouvert (hors mission)

- Le service local refuse `sherpa-parakeet-tdt-v3` tant que **sa licence n'est pas
  acceptée** : c'est un acte de l'utilisateur, Pilot ne l'accepte pas à sa place
  (il le dit et propose un autre modèle installé).
- Le mode Vocal hors micro ouvert (dictée par `startVoiceInput` sans le micro de
  l'écran) ne peut pas alimenter l'oreille locale : le repli est dit, pas silencieux.
- Le web distant n'est pas concerné : il n'importe pas ces modules.
