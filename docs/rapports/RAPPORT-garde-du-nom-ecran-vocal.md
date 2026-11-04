# Rapport — l'écran Vocal n'obéit qu'à son nom

**Date** : 2026-11-04
**Demande du propriétaire** : « dans le mode vocal, l'assistante ne doit rien
faire tant que son nom n'a pas été prononcé ».
**Portée** : l'**écran Vocal uniquement**. Rien d'autre ne change.

---

## 1. Le défaut, avant / après

**Avant.** Dans l'écran Vocal, la dictée s'arme toute seule au repos (§6bis) et
la demande part **deux secondes après le dernier mot** (`decideVocalSilenceSend`).
Conséquence : une phrase prononcée **à côté** — « range le projet » dit à
quelqu'un d'autre, un mot de la conversation voisine, la télévision — était
transcrite, **écrite dans la zone**, **affichée** puis **envoyée** comme une
demande. L'écran répondait à des phrases qui ne lui étaient pas adressées.

**Après.** Le micro **reste ouvert** et l'écoute **continue** (mesure du niveau,
enveloppe, armement automatique, réarmement après chaque réponse : rien de tout
cela n'a bougé). Ce qui change est la **conséquence** de la phrase :

| Ce qui se passe | Avant | Après |
|---|---|---|
| Phrase **sans** le nom | transcrite, écrite, envoyée après 2 s | **rien** : ni envoi, ni texte conservé, ni affichage, **aucun message** |
| Phrase **avec** le nom (« Nova, range le projet ») | envoyée | envoyée, **exactement comme avant** |
| Nom au **milieu** ou à la **fin** | — | accepté (le nom est cherché n'importe où) |
| Clic sur **« Réveiller <Nom> »** | relançait la dictée | relance la dictée **et** la phrase suivante part **sans** exiger le nom (pour **une** phrase) |
| Saisie **clavier** | envoyée | envoyée, **jamais filtrée** |
| Chat agent π · Assistant hors mode Vocal · **web distant** | inchangés | **inchangés** (même code, aucun import de la garde) |

La **ligne d'état existante** dit lequel des deux états est actif, sans nouvel
élément d'interface et sans nouveau réglage :

- garde **armée** → `Dites « Nova » pour me parler.` (le nom réel : personnage →
  nom réglé → nom par défaut) ;
- écran **réveillé** pour une phrase → la phrase **déjà existante** du repos,
  « Je vous écoute. ».

---

## 2. Ce qui a été fait, et où

### 2.1 Un module **pur** dédié : `src/js/vocal-nom-garde.js` (nouveau)

Aucun import, aucun DOM, aucun minuteur, aucune API micro : il ne fait que
**décider**. C'est ce qui rend la règle testable seule, sans micro ni interface.

| Export | Rôle |
|---|---|
| `foldSpoken(texte)` | casse, accents (NFD), apostrophes, ponctuation et espaces ramenés à une forme comparable |
| `phoneticKey(mot)` | `ph`→`f`, `qu`→`k`, `y`→`i`, **puis** consonne finale muette française retirée (`Bernar` = `Bernard`) |
| `mentionsAssistantName(phrase, nom)` | le nom est cherché **n'importe où** : d'abord mot à mot, puis sur une fenêtre de `mots(nom) + 2` mots comparée phonétiquement (la reconnaissance coupe parfois « Nova » en « no va ») |
| `decideVocalNameGate(etats)` | les **cinq règles dans l'ordre** : hors mode → texte vide → reprise en main → réveil (consommé) → nom. Rend `{ action, raison, consommeReveil }` |
| `vocalNameSentence(nom)` | la phrase de la ligne d'état : `Dites « X » pour me parler.` |
| `vocalNameGateArmed(etats)` | la garde est-elle active ? (mode ouvert, pas réveillé, nom lisible) |

Détail des règles de `decideVocalNameGate` (l'ordre **est** la spécification) :

1. **hors mode** (`modeOuvert === false`) → `laisser` — l'écran Vocal n'est pas
   affiché : la garde n'existe pas ;
2. **texte vide** → `laisser` (c'est une fin sans parole : le plafond des
   sessions vides et l'armement automatique gardent leur comportement) ;
3. **reprise en main** (`voiceUserTookOver`) → `laisser` (l'utilisateur a tapé :
   sa saisie prime, comportement existant) ;
4. **réveil** (`reveil === true`) → `laisser` **et consommer** le réveil : une
   phrase, pas la session ;
5. **nom inutilisable** (vide ou moins de `VOCAL_GATE_MIN_KEY` = 3 caractères
   significatifs) → `laisser` — **fail-open** : on ne peut pas exiger un nom
   qu'on ne sait pas lire, donc on ne casse pas la conversation ;
6. puis : **nom entendu** → `laisser` ; **nom absent** → `jeter`.

### 2.2 Les branchements, dans `super-agent.js` seulement

Trois endroits, tous **déjà existants** — aucun nouveau chemin d'envoi :

1. **Résultats du moteur** (avant `inputEl.value = preText + sep + transcript;`) :
   si la garde est armée et que le texte ne contient pas le nom, **rien ne
   s'écrit** (la zone est remise exactement dans son état d'avant), `vocalSyncChrome()`
   est appelé et on sort. Conséquence importante : `vocalNoteWord()` n'est
   **pas** appelé, donc **aucune échéance de silence n'est programmée** — la
   phrase ne peut pas partir.
2. **Fin d'écoute** (`rec.onend`, bloc `if (wasActive === true)`), **avant** le
   chemin d'envoi unique : `decideVocalNameGate(...)` ; si `jeter` →
   `voiceActive = false; voiceRec = null; vocalMotRecu = false;
   clearVocalSilenceTimer(); vocalSessionsVides = [];` la zone redevient ce
   qu'elle était, le bouton micro est remis au repos, `applyVocalState()`
   (donc réarmement) et `return`. **`applyVoiceEnd` n'est pas dupliqué** : la
   garde se place *avant* lui, il reste **un seul** appel.
3. **La ligne d'état** (`vocalStatusLine`) : un canal **séparé**, ajouté
   **avant** `return vocalStatusText(state)` — les libellés existants
   (« Je vous écoute. », « Je vous écoute… », « Je réfléchis… », « Je réponds. »)
   sont **inchangés au caractère près**.

Deux états nouveaux, minuscules :

- `let vocalReveilUnePhrase = false;` — posé **dans `toggleVoiceInput`** (la
  voie du bouton « Réveiller <Nom> » **et** du geste 🎙️), consommé par la phrase
  qu'il ouvre, remis à `false` dans `exitVocal` (sortir de l'écran remet tout à
  zéro). **Aucun délai** ne le lève ni ne l'éteint : c'est la phrase, et rien
  d'autre.
- rien d'autre : ni réglage, ni persistance, ni nœud DOM, ni classe CSS.

### 2.3 Le nom vient d'une **seule** source

`superAgentDisplayLabel()` — la règle existante (personnage actif → nom réglé →
nom par défaut). **Aucune ligne de cette priorité n'est recopiée** dans le
module : il **reçoit** un nom. Un test vérifie, sur le code **sans commentaires
ni chaînes** (`neutraliserSource`), que `vocal-nom-garde.js` ne connaît ni
`configCache`, ni `personaDisplayName`, ni `getAssistantPersonaName`, ni
`superAgentDisplayLabel`.

---

## 3. Le point de franchise : un nom **mal transcrit** ne déclenche rien

C'est la conséquence directe du choix demandé (« en cas de doute, choisir
l'étroit »). La comparaison est **tolérante** (casse, accents, ponctuation,
espaces, `ph`/`f`, `qu`/`k`, `y`/`i`, consonne finale muette, nom coupé en deux)
mais **volontairement étroite** :

- **pas** de distance d'édition (Levenshtein) : elle rapprocherait « Nova » de
  « note », « noveau », « Noël »… ;
- **pas** de dictionnaire de prénoms ni de phonétique générale ;
- **pas** de réduction des lettres doublées : essayée puis **retirée** — elle
  faisait accepter « bonne année » pour le prénom « Anne » (faux positif réel,
  mesuré en écrivant les tests). C'est le genre de « tolérance » qui rend la
  garde inutile.

**Conséquence assumée** : si la reconnaissance écrit le nom autrement (syllabe
avalée, prénom inattendu, autre langue), la phrase est **jetée alors qu'elle
vous était destinée**. Trois issues, dans cet ordre, et elles sont documentées
pour l'utilisateur (§6quater + bloc d'aide) :

1. redire le nom **clairement** ;
2. cliquer **« Réveiller <Nom> »** (la phrase suivante part sans le nom) ;
3. **taper** la demande au clavier (jamais filtrée).

*Aucun réglage ne cherchera à deviner* : un déclenchement de trop est pire qu'un
silence, et le propriétaire paie déjà ce silence d'un geste de secours qui
existe.

---

## 4. Tests

### 4.1 Le verrou : `src/js/vocal-nom-garde.test.js` (nouveau, 34 tests)

Six sections :

1. **les cinq règles et leur ordre** (hors mode, texte vide, reprise en main,
   réveil — consommé **une fois**, nom inutilisable en fail-open, nom
   entendu/absent) ;
2. **la comparaison** : ce qui est accepté (nom au début / au milieu / à la fin,
   majuscules, accents, ponctuation, « Bernar », « no va ») **et ce qui est
   refusé** (« bonne année », un mot qui contient le nom, une phrase vide) ;
3. **le branchement** : la garde est dans les résultats du moteur **avant**
   l'écriture, la décision est prise **avant** l'envoi, il y a **un seul**
   `applyVoiceEnd` et **un seul** `send(` dans le bloc, aucun `vocalNoteWord`
   dans la branche qui renonce ;
4. **le bouton de secours** : `vocalReveilUnePhrase` est posé par
   `toggleVoiceInput`, **avant** `startVoiceInput()`, remis à `false` dans
   `exitVocal`, et il n'est levé par **aucun délai** ;
5. **la ligne d'état** : deux phrases différentes, une seule ligne, aucune
   constante de `vocalStatusText` modifiée ;
6. **hors du mode Vocal** : ni `agent-pi.js` ni `web/js/app.js` n'importent le
   module, et le corps de la garde ne fait rien si l'écran n'est pas affiché.

**Preuve que le verrou mord** (test de mutation, fait puis annulé) : en
remplaçant `decideVocalNameGate({...})` par une décision figée `{ action:
"laisser" }` dans `super-agent.js`, **2 tests échouent** (« la décision est prise
AVANT l'envoi, et l'envoi reste unique », « aucun second envoi, aucun second
chemin de décision n'est créé ») ; restauré, **34/34**.

### 4.2 Résultats réels recomptés

| Commande | Résultat |
|---|---|
| `npx vitest run src/js/vocal-nom-garde.test.js` | **34 tests**, 1 fichier, **0 échec** |
| `npm test` (= `npx vitest run`, tout) | **291 fichiers, 5 397 tests, 0 échec** |
| dont, sans le nouveau fichier (`--exclude`) | 5 363 tests, **0 échec** → 5 363 + 34 = 5 397 ✔ |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **861 passed, 1 ignored**, 0 échec |

Aucun test existant n'a été modifié. Aucun n'a cassé : les verrous sensibles
(`applyVoiceEnd` **une seule fois**, `vocalNoteEmptySession(fin, …)` **une seule
fois**, `vocalStatusText("idle" | "listening")` au caractère près,
`vocalDicteeParGeste`, `vocalReveilUnePhrase` absent des compteurs) sont tous
passés **sans retouche**.

---

## 5. Ce qui n'a **pas** été fait (et pourquoi)

- **Le micro n'est pas touché** : `vocal-mic.js` est inchangé au caractère près
  (ouverture, fermeture, mesure, garde anti-auto-coupure). L'écoute continue :
  c'était l'exigence.
- **La détection de coupure de parole n'est pas touchée** (`vocalBargeIn`,
  `stepSpeechGate`, seuils, calibration d'écho) — verrouillée par
  `ecran-vocal-lot4a.test.js`, et sans rapport avec la garde.
- **Le silence de 2 s et son réglage ne sont pas touchés**
  (`decideVocalSilenceSend`, `normalizeVocalSilenceSendMs`, curseur des
  Paramètres) : la garde agit **avant**, en empêchant qu'une échéance soit
  programmée.
- **La transcription et le service de voix local ne sont pas touchés** (mission
  ultérieure, comme demandé) : aucun `tts_local`, aucun `local-voice.js`.
- **Aucune dépendance, aucun téléchargement, aucune installation.**
- **Aucun réglage utilisateur nouveau, aucun élément d'interface nouveau** :
  une phrase dans la ligne d'état qui existait déjà.
- **Le web distant n'est pas modifié** : il importe `voice-auto-send.js` et
  n'a jamais connu la garde.
- **Aucun test existant n'a été modifié pour « faire passer »** : la garde a été
  placée là où elle ne duplique aucun chemin, précisément pour cela.

---

## 6. Fragilités connues (à dire, pas à cacher)

1. **Nom mal transcrit ⇒ silence** (§3). C'est le prix de l'étroitesse, et le
   secours existe (réveil, clavier).
2. **Le nom doit être prononcé distinctement** : dans une phrase très rapide, la
   reconnaissance peut le fusionner avec le mot voisin (« novarange ») — le nom
   n'est alors pas détecté. Une respiration avant le nom suffit.
3. **Deux prénoms proches** : si le nom réglé est « Anne » et que vous dites
   « bonne année », la garde **ne déclenche pas** (voulu, testé). C'est
   asymétrique par choix : on préfère un silence.
4. **`vocalReveilUnePhrase` est un drapeau de session d'écran** : il vit et meurt
   avec l'écran Vocal (remis à `false` dans `exitVocal`). Un rechargement de la
   fenêtre repart donc **garde armée** — c'est le comportement voulu.
5. **Un projet sensible ne dicte pas** (§6bis) : la garde n'a rien à y faire, et
   elle n'y fait rien (le refus d'armement est décidé avant elle).

---

## 7. Documentation mise à jour

| Fichier | Ce qui a changé |
|---|---|
| `spec_modes_ecran_vocal.md` | nouvelle section **§6quater** (le défaut, les deux états, le réveil, le clavier, le hors-mode, le point de franchise, le code et le verrou) ; note sous le tableau des quatre états (la ligne d'état du repos peut dire la phrase de la garde) ; **§10** : ligne du module `vocal-nom-garde.js` + le verrou dans la liste ; **bloc `HELP:vocal-garde-du-nom`** (orienté utilisateur) |
| `spec_voice_input.md` | nouvelle sous-section **§3quater** (la seule exception à « la dictée n'exige aucun mot d'appel ») + une puce dans le **bloc `HELP:dictee-vocale`** |
| `help/handbook.md` | **régénéré** (`npm run build:handbook`) — 48 blocs, topic `vocal-garde-du-nom` présent |
| `AGENTS.md` | ligne d'arborescence pour `vocal-nom-garde.js` + mention dans la navigation rapide (écran Vocal) |
| `docs/rapports/RAPPORT-garde-du-nom-ecran-vocal.md` | ce rapport |

---

## 8. Commandes

```bash
npx vitest run src/js/vocal-nom-garde.test.js   # le verrou (34 tests)
npm test                                        # tout le front (5 397 tests, 291 fichiers)
cargo test --manifest-path src-tauri/Cargo.toml --lib   # 861 passed, 1 ignored
npm run build:handbook                          # aide intégrée (bloc vocal-garde-du-nom)
```
