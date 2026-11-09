# Rapport — Diagnostic : le mot de réveil de l'écran Vocal

Date : 2026-11-16 · Projet : `G:\IA_PL\pilot`
Mission : **diagnostic seul**. Aucun code modifié, aucun test écrit, aucune
configuration touchée, aucun fichier déplacé.

> **Ce que vous constatez** : dans l'écran Vocal, vous devez prononcer le nom
> (ou le nom du personnage) à chaque phrase. Un réglage de « mots de réveil »
> est censé exister, mais dans les faits il ne vous en dispense pas.

---

## 0. Comment ce rapport a été fait (et ce que « prouvé » veut dire ici)

Tout a été lu dans le code exécuté, pas dans la documentation d'intention :

| Preuve | Nature |
|---|---|
| **PROUVÉ (code)** | lu dans le fichier qui décide, à la ligne citée |
| **PROUVÉ (exécution)** | j'ai fait tourner les fonctions de décision réelles (`node`, aucun fichier créé) |
| **PROUVÉ (disque)** | lu la configuration réellement enregistrée sur votre machine |
| **PROUVÉ (test existant)** | test déjà écrit qui passe (59 tests verts sur les 2 fichiers ciblés) |
| **HYPOTHÈSE** | plausible, mais non démontrée sans lancer l'application (interdit par la mission) |

Je n'ai lancé **ni l'application, ni la suite complète de tests, ni le service de
développement**.

---

## 1. La règle réellement appliquée aujourd'hui

**PROUVÉ (code + exécution).**

- La garde ne s'applique **qu'à la dictée, et seulement dans l'écran Vocal**
  (`src/js/super-agent.js:5668`, `modeOuvert: vocalOverlay !== null`). Clé rendue
  par `vocalNameGateArmed` / `decideVocalNameGate` de
  `src/js/vocal-nom-garde.js`.
- **Sur votre machine, le nom attendu est `Nova`** : `~/.pilot/portrait/nom.txt`
  contient « Aucun personnage » (donc pas de personnage actif) et votre
  configuration porte `super_agent_name = "Nova"`.
- Une phrase dictée **ne part que si elle contient `Nova`**, n'importe où dans la
  phrase. Sinon elle est **jetée** : ni envoyée, ni gardée dans la zone, ni
  affichée, **sans aucun message** (l'écran continue juste d'écouter).
- La comparaison est **tolérante** : casse, accents, ponctuation et espaces
  ignorés, plus quatre variantes de prononciation (`ph`→`f`, `qu`→`k`, `y`→`i`,
  consonne finale muette). Vérifié en exécution :
  `"nova range le projet"` avec le nom `Nova` → **acceptée**.
- **Le clavier n'est jamais filtré** : ce que vous tapez part toujours.
- **Hors de l'écran Vocal, aucune garde** : onglet π, onglet 🧭 en discussion
  écrite, web distant — une dictée sans nom part normalement (`hors-mode`).
- **Il n'existe aucun réglage qui désactive la garde.** Aucun interrupteur, aucune
  exception durable : le nom reste exigé à chaque phrase (voir § 4 et § 6).

---

## 2. Le réglage des mots de réveil existe-t-il de bout en bout ?

**PROUVÉ : oui, la chaîne est complète — mais elle est branchée sur une valeur
VIDE chez vous.** Ce n'est donc pas un chaînon manquant dans le code : c'est la
valeur qui manque.

Les cinq maillons, tous vérifiés :

| Maillon | Où | État |
|---|---|---|
| 1. Le champ existe dans les Paramètres | `index.html`, `#setting-vocal-wake-words`, section « Mode Vocal » de l'onglet **Assistant** | présent, et présent dans **votre application installée** (version `0.6.21` du `pilot.exe`, le champ date de la `0.6.16`) |
| 2. La valeur est enregistrée | `src/js/settings.js:3546` → `vocal_wake_words: wakeWordsText(inputVocalWakeWords.value)` | écrit à chaque « Enregistrer » |
| 3. La valeur est persistée | `src-tauri/src/lib.rs` — `vocal_wake_words: String` avec `#[serde(default)]`, défaut `""` | relu/écrit sans perte (aucun appelant de `save_config` n'envoie un objet partiel : tous relisent `get_config` d'abord) |
| 4. La valeur est relue à chaud | `super-agent.js:7103` `refreshVocalMotsDeReveil()`, appelée au montage de l'onglet et sur `pilot-config-changed` (`:4558`, `:4589`) | branchée, fail-open |
| 5. La valeur est utilisée par la décision | `super-agent.js:5675` puis règle 6 de `vocal-nom-garde.js` (`mot-reveil`) | branchée |

**Le fait décisif (PROUVÉ, disque)** — votre configuration réelle :

```
C:\Users\pldistance\AppData\Roaming\com.pilot.editor\config.json
  "vocal_wake_words": ""            ← vide
C:\Users\pldistance\AppData\Roaming\com.pilot.editor.dev\config.json
  "vocal_wake_words": ""            ← vide
  "super_agent_name": "Nova"
```

Or, **champ vide ⇒ comportement historique** : seul le nom ouvre la phrase (règle
documentée, et c'est bien ce que fait le code : `wakeWordsFrom("")` → liste
vide). Vérifié en exécution : avec un réglage vide, `"allô tu m'entends"` et
`"hey range le projet"` sont **refusées**, `"salut Nova …"` passe.

**Ce que je ne peux pas prouver** : *pourquoi* il est vide. Deux possibilités,
qu'aucune trace ne permet de départager :

- **(a) probable** : le champ n'a jamais été rempli puis enregistré (vous avez pu
  régler la longueur des réponses et le délai d'envoi — qui sont bien enregistrés
  dans la même section — sans passer par ce champ) ;
- **(b) non prouvée** : il a été rempli puis effacé. J'ai relu **tous** les
  chemins d'écriture de la configuration (`settings.js`, `main.js` ×2,
  `agent-pi.js`, `pi-update.js`, `onboarding.js`, côté Rust `save_config_disk`) :
  **aucun** n'écrit un objet partiel, donc **aucun effacement silencieux n'est
  démontré**.

---

## 3. Un mot de réveil correctement réglé remplace-t-il le nom, ou s'y ajoute-t-il ?

**PROUVÉ : il S'AJOUTE. Ce sont deux voies alternatives, pas deux conditions à
remplir.**

- Dans `decideVocalNameGate`, la règle du nom est évaluée **d'abord** (`nom-entendu`),
  puis la règle 6 (`mot-reveil`). **L'une OU l'autre suffit** : ce n'est jamais
  « le nom ET le mot ».
- Côté écoute (`super-agent.js:5674`) la condition de refus est
  `!mentionsAssistantName(...) && !mentionsWakeWord(...)` : la phrase n'est jetée
  que si **aucun** des deux n'est entendu.
- **Le nom reste toujours accepté**, même quand des mots sont réglés. Le réglage
  n'a jamais remplacé le nom.
- Vérifié en exécution, avec le réglage `"hey"` : `"hey range le projet"` →
  **acceptée** (`mot-reveil`), `"range le projet"` → **refusée**.

---

## 4. Après une phrase acceptée, la garde retombe-t-elle tout de suite ?

**PROUVÉ : oui — immédiatement. Et c'est le cœur du problème.**

Le « réveil » (le fait d'être dispensé du nom) **ne vaut que pour UNE phrase**,
puis il est **consommé** :

```
if (gardeNom.consommeReveil === true) vocalReveilUnePhrase = false;   // super-agent.js:5767
```

Le cycle exact, tel qu'il est écrit :

1. Vous dites une phrase contenant le nom (ou un mot de réveil) → **acceptée**.
2. Elle part, Pilot répond, la réponse est lue.
3. L'écran **réarme la dictée tout seul** (`armVoiceInput` → `startVoiceInput`),
   et cet armement automatique **ne pose pas de réveil** (il n'y a aucun geste).
4. La garde est donc **de nouveau armée** : la phrase suivante **doit** contenir le
   nom ou un mot de réveil, sinon elle est jetée.
5. Retour à l'étape 1.

**Conséquence, en clair : même avec des mots de réveil parfaitement réglés, il
faut prononcer quelque chose à CHAQUE phrase.** Le réglage change le **mot** à
dire ; il ne supprime **pas** le besoin de réveiller. C'est exactement ce que vous
décrivez : « dans les faits, ça ne me dispense de rien ».

Le drapeau `vocalReveilUnePhrase` n'est remis à `false` que par cette
consommation, et il meurt à la sortie de l'écran Vocal (`:7804`) — **jamais par un
délai**.

---

## 5. Le comportement est-il identique dans les deux modes ?

**PROUVÉ : non.**

| Situation | Garde du nom |
|---|---|
| Écran **Vocal** (plein écran), dictée | **active** : nom ou mot de réveil exigé à chaque phrase |
| Onglet 🧭 ou π en **discussion écrite**, dictée hors plein écran | **inactive** (`hors-mode`) : la phrase part sans nom |
| Web distant | **inactive** (le module de garde n'y est pas importé) |
| Saisie **au clavier**, partout | **jamais filtrée** |

C'est une dissymétrie voulue : la garde protège l'écran vocal d'une phrase
prononcée « à côté ».

---

## 6. Existe-t-il un cas où la garde est définitivement levée ?

**PROUVÉ : non. Aucun cas durable, aucun réglage.**

Les seules levées sont **temporaires et bornées** :

| Levée | Durée | Preuve |
|---|---|---|
| Bouton « Réveiller \<Nom\> » du cercle | **une** phrase (consommée) | `super-agent.js:5522` + tests verts (`vocal-nom-garde.test.js:97-101`, `:306-318`) |
| Bouton 🎙️ de la barre (même voie : `toggleVoiceInput` → `startVoiceInput`) | **une** phrase | idem |
| Sortie de l'écran Vocal | la garde ne s'applique plus (et le drapeau meurt) | `:7804` |
| Nom inutilisable (nom vide/illisible) | fail-open — **ne joue plus** dès qu'un mot de réveil utilisable est réglé | règle `nom-inutilisable` |

**Aucune durée, aucune fenêtre de tolérance, aucun interrupteur « ne plus me
demander le nom ».**

---

## 7. Pourquoi, dans les faits, le réglage ne vous dispense de rien

Classé par solidité de la preuve.

### Certaines

1. **Le champ est vide chez vous** (§ 2). Aujourd'hui, la seule clé qui ouvre une
   phrase est « Nova ».
2. **Par conception, il faut un mot à chaque phrase** (§ 4). Même rempli, le
   réglage ne change pas le cycle : il remplace « Nova » par un autre mot, à
   répéter à chaque phrase. **C'est la cause de fond**, et elle ne dépend pas de
   votre configuration.
3. **L'exemple montré dans le champ est un piège** (PROUVÉ par exécution).
   Le champ propose `hey bonjour, allô`, et la note dit qu'un seul mot suffit. En
   réalité, un mot de réveil **peut contenir des espaces**, donc `hey bonjour`
   est **UN SEUL** mot de réveil à deux mots. Résultat mesuré :

   | Réglage `hey bonjour, allô` | Phrase | Verdict |
   |---|---|---|
   | | « hey range le projet » | **refusée** |
   | | « bonjour, range le projet » | **refusée** |
   | | « hey bonjour range le projet » | acceptée |
   | | « allô tu m'entends » | acceptée |

   Autrement dit : quelqu'un qui recopie l'exemple tel quel obtient un réglage
   qui **ne se déclenche presque jamais**. Avec un mot **d'un seul mot** (`hey`,
   `allô`, `salut`, `ok`, `coucou`), tout fonctionne (vérifié en exécution).

### Probables

4. **La comparaison est très étroite.** Avec `hey` réglé, une transcription
   `« hé »` ou `« et »` est **refusée** (vérifié en exécution) : la tolérance
   phonétique ne couvre que `ph/f`, `qu/k`, `y/i` et la consonne finale muette,
   et exige au moins 3 caractères. Un mot court ou non français échoue donc
   souvent, en silence.
5. **Rien à l'écran ne montre que vos mots comptent.** La ligne d'état du mode
   Vocal affiche toujours `Dites « Nova » pour me parler.`
   (`super-agent.js:6615`, `vocalNameSentence(superAgentDisplayLabel())`) — elle
   ne nomme **jamais** les mots de réveil réglés. On croit donc que le réglage est
   sans effet, et l'on continue à dire le nom.

### Hypothèses (non démontrées sans lancer l'application)

6. **Texte qui s'affiche puis disparaît.** La garde est appliquée deux fois : à
   l'arrivée du texte (`rec.onresult`) et à la fin de la dictée (`rec.onend`, sur
   le texte final seulement). Si le moteur ne finalise jamais le morceau qui
   contenait le mot de réveil, la phrase peut être acceptée puis jetée à la fin.
7. **Le mot de réveil est mangé au début.** Pendant que Pilot parle, la dictée
   automatique est désarmée : si vous commencez à parler à ce moment-là, le début
   de la phrase — donc le nom ou le mot — est perdu, et il faut tout redire.

---

## 8. Comportements possibles pour demain (aucun n'est implémenté)

À trancher par vous ; je ne recommande rien ici, je décris.

| # | Comportement | Effet sur votre gêne | Ce qu'il faudra vérifier |
|---|---|---|---|
| A | **Ne rien changer au fond** : corriger seulement la présentation (exemple du champ à un seul mot, ligne d'état nommant les mots réglés) | faible : il faudra toujours un mot par phrase, mais vous saurez lequel | aucun risque de conception |
| B | **Le réglage devient l'interrupteur** : si des mots de réveil sont réglés, la garde s'ouvre (le nom n'est plus exigé) | total, mais l'écran n'est plus protégé des phrases voisines | distinguer « réglé » et « garde active » |
| C | **Réglage explicite « ne plus demander le nom dans cet écran »** (case à part, vide par défaut) | total, au choix de l'utilisateur | migration, valeur par défaut, spec § 6quater |
| D | **Garde ouverte pour la conversation en cours** : après le premier appel, la garde reste levée tant que le dialogue continue, et se réarme après un long silence ou à la sortie | total pendant une conversation, protection conservée au démarrage | durée d'inactivité à fixer, comportement en cas de question de l'assistant |
| E | **Garde seulement au réveil de l'écran** : le nom n'est exigé qu'à la première phrase après l'entrée dans le mode (ou après un silence long) | total en pratique | ce qui protège encore des phrases « à côté » |
| F | **Deux modes dans l'écran** : « conversation parlée » (aucun nom) et « dictée ponctuelle » (nom exigé) | total, explicite | un bouton de plus à l'écran |
| G | **Garde limitée aux phrases ambiguës** : n'exiger le nom que pour les réponses courtes du type « oui »/« non » (le risque réel : répondre à une confirmation par accident) | fort, et proportionné au risque | liste des cas jugés ambigus |
| H | **Interdire les mots de réveil multi-mots** et corriger l'exemple | faible, mais supprime une cause de panne silencieuse | compatibilité des valeurs déjà saisies |
| I | **Supprimer la garde** et ne garder qu'un voyant d'écoute | total | décision de fond, contraire à § 6quater |

---

## 9. Ce qui reste incertain

- Pourquoi `vocal_wake_words` est vide chez vous (jamais rempli, ou vidé) : aucune
  trace ne permet de le dire.
- Les hypothèses 6 et 7 (texte accepté puis jeté ; mot mangé pendant la parole de
  Pilot) demandent une exécution réelle pour être confirmées — hors du périmètre
  autorisé de cette mission.
- Le comportement exact de la transcription du navigateur sur votre machine
  (quelle orthographe il produit pour « hey ») n'a pas été mesuré.

---

## 10. Fichiers lus et vérifications exécutées (lecture seule)

**Lus** : `src/js/vocal-nom-garde.js`, `src/js/super-agent.js` (zones
`vocalReveilUnePhrase`, `vocalMotsDeReveil`, `onresult`/`onend`, `armVoiceInput`,
ligne d'état, sortie du mode), `src/js/settings.js`, `index.html`,
`src-tauri/src/lib.rs` (`AppConfig`, `vocal_wake_words`, `load_config_disk`,
`save_config_disk`), `spec_modes_ecran_vocal.md` § 6quater / § 6quater.1,
`docs/rapports/RAPPORT-mots-de-reveil.md`.

**Exécuté** (aucune écriture, aucun fichier créé) :

- appel direct des fonctions de décision réelles sur 24 cas (nom seul, mot d'un
  mot, mot multi-mots, variantes de transcription, hors mode) ;
- `npx vitest run src/js/mots-de-reveil.test.js src/js/vocal-nom-garde.test.js`
  → **59 tests passés, 0 échec** (tests existants, aucun ajouté) ;
- lecture des deux fichiers `config.json` (installation et dev) et de
  `~/.pilot/portrait/nom.txt` ;
- version de l'application installée : `0.6.21`.

**Aucune modification** : ni code, ni spec, ni aide générée, ni configuration, ni
base de suivi, ni fichier déplacé ou supprimé. Le seul fichier écrit est ce
rapport.
