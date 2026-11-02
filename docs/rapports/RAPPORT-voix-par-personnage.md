# Rapport — voix propre au personnage actif (lecture à voix haute)

Date : 2026-11-13 · Demande du propriétaire : « le personnage actif peut avoir sa
propre voix de lecture, avec repli obligatoire sur la voix générale ».

## 1. Ce qui a été fait

| Couche | Fichier | Changement |
|---|---|---|
| Décision (pure) | `src/js/character-voices.js` (**nouveau**) | **Source unique** des deux règles : `voiceForCharacter` (quelle voix pour cette lecture) et `characterVoiceRow` (cette ligne existe-t-elle à l'écran) + `withCharacterVoice` / `normalizeCharacterVoices` / `normalizeCharacterName` / `storedVoiceForCharacter` / `isUsableVoiceValue` / `characterVoiceOptions` |
| Lecture | `src/js/read-aloud.js` | `resolveReadingVoice(options)` : **seul** point de décision, branché dans `speak` (`let choice = resolveReadingVoice(options);`) et dans les deux lectures d'état du bouton ; `applyVoicePreferenceFromConfig` applique les **deux** champs ; `setCharacterVoices` / `getCharacterVoices` ; `readingVoiceAvailable` (existence réelle) |
| Réglage | `settings.js` + `index.html` | ligne `#read-aloud-character-row` (« Voix de <nom> : ») **dans** la section « Lecture des réponses », masquée par le code tant qu'aucun personnage n'est actif ; même catalogue que le sélecteur général ; mémorisation dans `characterVoicesDraft`, écrite à la sauvegarde sous la clé de la source unique |
| Configuration | `src-tauri/src/lib.rs` | champ **additif** `character_voices: HashMap<String, String>` (`#[serde(default)]`, défaut vide) à côté de `read_aloud_voice`, inchangé |
| Documentation | `spec_read_aloud.md` (§ 2 + **§ 3 bis** + § 6), `help/overview.md` (bloc `HELP:lire-reponses`), `README.md`, `AGENTS.md` | règles, couverture, texte utilisateur |

## 2. Où vit la décision de priorité

**Une seule fonction, un seul point d'application.**

1. `voiceForCharacter(nom, voixGénérale, characterVoices, isAvailable)` —
   `src/js/character-voices.js`. Ordre, et c'est tout :
   1. aucun personnage actif → voix générale ;
   2. pas de voix attribuée (ou valeur inutilisable) → voix générale ;
   3. voix attribuée **indisponible** sur cette machine (modèle local absent,
      profil imité retiré, voix système désinstallée) → voix générale ;
   4. sinon → la voix du personnage.
   Un **état inconnu** ne condamne jamais une voix ; un contrôle d'existence
   qui échoue non plus (les replis de la lecture restent là pour ça).
2. `resolveReadingVoice(options)` — `src/js/read-aloud.js` — appelle cette
   fonction et rien d'autre. `speak` la lit **une fois** (`let choice =
   resolveReadingVoice(options);`). Le nom du personnage est relu **à chaque
   lecture** (`getAssistantPersonaName()`), donc changer de personnage change la
   voix **sans redémarrer**.

Aucun second mécanisme de lecture : toujours un `SpeechSynthesisUtterance`, un
`synth.speak(` et un `splitSentences(textForSpeech(...))` dans le module.

## 3. Règle « rien à l'écran sans personnage »

- `characterVoiceRow(...).visible === false` dès que le nom est vide (absent,
  `null`, `undefined`, espaces) → `settings.js` met la ligne en `display:none`
  **et vide la liste** : pas de ligne vide, pas de message, pas de bouton, pas
  d'invite à « vérifier ». La section reste celle d'avant.
- Le premier choix de la ligne vaut `""` = « Comme la voix de lecture
  ci-dessus » (`CHARACTER_VOICE_INHERIT_LABEL`) ; choisir cette valeur **retire**
  l'entrée de la configuration (jamais une valeur vide conservée).

## 4. Tests ajoutés (chacun tombe si la règle est retirée)

`src/js/voix-par-personnage.test.js` — **28 tests** :

- décision : aucun personnage → voix générale ; sans voix → voix générale ;
  voix du personnage gag ; casse différente tolérée ; valeur inutilisable →
  voix générale ; voix disparue → voix générale ; `voiceName` imposé gagne ;
- écran : `visible: false` pour toutes les formes d'absence ; libellé contenant
  le nom ; premier choix = libellé d'héritage ; catalogue de **même longueur**
  que le général ; `index.html` : un seul `id="setting-read-aloud-character-voice"`
  et un seul `id="read-aloud-character-row"`, `display:none` par défaut,
  **dans** la section « Lecture des réponses » (découpage **vérifié** via
  `sliceSource`, ancre absente ⇒ échec) ;
- mémorisation : ajout / remplacement / **retrait**, aucune mutation de
  l'argument, une seule entrée par nom (casse confondue), configuration abîmée
  tolérée, nom borné ;
- configuration : champ **additif** et **indépendant** du champ général ;
- branchement : la règle ne vit que dans `character-voices.js` ; `resolveReadingVoice`
  défini **une** fois et appliqué **une** fois dans `speak` ; aucun second
  mécanisme (`synth.speak(`, `SpeechSynthesisUtterance`) ; les Paramètres ne
  lisent jamais à voix haute ; la sauvegarde écrit la clé de la source unique ;
  la ligne est masquée **par le code**, pas par le CSS seul.

Côté Rust (`src-tauri/src/lib.rs`) :
`character_voices_field_is_additive_and_backward_compatible` — une configuration
**sans** le champ donne un objet vide (comportement d'avant, aucun autre champ
touché), une configuration **avec** le champ le relit à l'identique.

## 5. Vérifications manuelles et automatiques

```bash
npx vitest run                       # 5207 tests, 0 échec
cargo test --manifest-path src-tauri/Cargo.toml --lib   # 827 tests, 0 échec
npm run build:handbook               # handbook régénéré (bloc lire-reponses)
```

- Neutralisation (vérifiée) : retirer la ligne de `speak`, rendre la ligne
  toujours visible, ou relire `getPreferredVoiceName()` en direct **fait
  échouer** `voix-par-personnage.test.js` ; retirer le champ Rust fait échouer
  le test de sérialisation.
- Gardes existantes **inchangées** et vertes : `reglage-voix-onglet-assistant`,
  `apercu-voix-parametres`, `voix-locale`, `voix-locale-choix`,
  `voicestudio-explique-dans-les-reglages`, `repli-voix-muet`,
  `source-slice` (inventaire des découpages de source).
- Aucun réglage touché côté VoiceStudio : l'explication reste affichée telle
  quelle ; aucune valeur recopiée (`local:piper` reste défini une seule fois).
- Projet externe `G:\IA_PL\Presences` **non modifié** : Pilot ne fait que lire
  le nom et le portrait du personnage.

## 6. Limites connues

- Le réglage par personnage est **par nom** : renommer le personnage côté
  Présences crée une entrée distincte (l'ancienne reste, inutilisée, dans la
  configuration — elle ne gêne rien et n'est jamais lue).
- macOS / Linux : rien de particulier, ce sont les mêmes voix que la voix
  générale (voix du système ; voix locale seulement si le moteur y existe).
- Aucune synchronisation entre postes : `character_voices` vit dans la
  configuration **locale** de Pilot (comme `read_aloud_voice`).

## VERDICT

Le personnage actif peut avoir **sa** voix de lecture ; sans voix attribuée,
voix disparue ou aucun personnage actif, la voix **générale** s'applique
exactement comme avant, et la section « Lecture des réponses » est, dans ce
dernier cas, **identique à celle d'aujourd'hui**. La priorité tient dans une
seule fonction pure, branchée à un seul endroit, tenue par 28 tests JS + 1 test
Rust. Suite complète verte (5207 JS, 827 Rust).
