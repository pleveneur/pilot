# Rapport — Mots de réveil de l'écran Vocal (réglage unique `vocal_wake_words`)

Date : 2026-11-16 · Spec : `spec_modes_ecran_vocal.md` § 6quater.1

## 1. La demande

À côté de son nom, l'écran Vocal doit pouvoir obéir à des **mots de réveil
libres** (« Nova, hey Nova »), réglés à **un seul endroit**, sans perdre ce qui
existait :

- champ **vide** ⇒ comportement **strictement inchangé** (seul le nom) ;
- champ rempli ⇒ phrase acceptée si elle contient **au moins un** des mots
  (un seul suffit, où qu'il soit), **casse et accents ignorés** ;
- **le nom de l'assistante reste toujours accepté en plus** ;
- une phrase sans mot ni nom reste **ni envoyée, ni conservée, ni affichée** ;
- bouton « Réveiller <Nom> » inchangé (**une** phrase), clavier jamais filtré,
  réglage **additif** (défaut vide, jamais d'erreur s'il est absent), **rien**
  hors de l'écran Vocal.

## 2. Ce qui a été fait (et pourquoi là)

**La décision reste dans le module pur existant** `src/js/vocal-nom-garde.js`
— aucun second mécanisme d'écoute, aucun second chemin d'envoi :

| Ajout | Rôle |
|---|---|
| `VOCAL_WAKE_WORDS_KEY` = `"vocal_wake_words"` | la clé, écrite une seule fois |
| `wakeWordsFrom(saisie)` | sépare (virgule, point-virgule, retour à la ligne), nettoie, **dédoublonne** (casse/accents), ignore les vides ; accepte un texte **ou** une liste ; ne lève jamais |
| `wakeWordsText(saisie)` | la **seule** forme mémorisée (« Nova, hey Nova ») : ce qui est écrit est exactement ce que la garde relira |
| `mentionsWakeWord(phrase, mots)` | un mot est-il entendu ? comparaison = **celle du nom** (`mentionsAssistantName`), donc même tolérance et même étroitesse |
| `decideVocalNameGate({ …, motsDeReveil })` | **6ᵉ règle** : nom (`nom-entendu`) puis mot de réveil (`mot-reveil`) ; le fail-open `nom-inutilisable` ne joue plus que si **aucun** mot utilisable n'est réglé |
| `vocalNameGateArmed({ …, motsDeReveil })` | la garde reste armée sur un mot de réveil utilisable même si le nom est illisible |

**Un seul point d'application**, celui qui existait déjà (`src/js/super-agent.js`) :
`rec.onresult` (rien ne s'écrit tant que le nom **ou** un mot de réveil n'est pas
entendu) et `rec.onend` (`decideVocalNameGate` → jeté, ou le chemin unique
`applyVoiceEnd` → `send`, jamais dupliqué). Les mots sont relus à chaud par
`refreshVocalMotsDeReveil()` — **fail-open** (configuration illisible ⇒ liste
vide ⇒ comportement d'avant), au montage et dans le gestionnaire
`pilot-config-changed` **déjà existant**.

**Réglages** : un champ texte `#setting-vocal-wake-words` dans la section
**« Mode Vocal »** (`index.html`, juste sous la dictée locale), avec son aide
`role="note"` ; enregistrement `vocal_wake_words` dans `settings.js` (valeur
passée par `wakeWordsText`, donc une seule normalisation).
**Rust** : `vocal_wake_words: String` avec `#[serde(default)]` (défaut `""`)
dans `AppConfig` — un fichier de configuration ancien ne change rien.

## 3. Ce qui n'a **pas** été touché

- `src/js/vocal-nom-garde.test.js` : **aucune ligne modifiée** (il reste vert).
- Le micro, la détection de coupure de parole, le silence d'envoi, la longueur
  des réponses, la dictée locale, les autres écrans (agent π, web distant).
- Aucun réglage par personnage, aucune suppression de réglage, aucun nouveau
  mécanisme d'envoi, aucune version/tag/release touchés.

## 4. Preuves — les commandes, et ce qu'elles ont rendu

### 4.1 Les deux vérifications demandées (exécutées pour ce rapport)

```bash
npm test                                                        # suite front complète
cargo test --manifest-path src-tauri/Cargo.toml --lib           # tests Rust du desktop
```

Résultat **réel** de l'exécution :

| Commande | Sortie |
|---|---|
| `npm test` (vitest, suite **complète**) | **5517 tests passés, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **900 passés, 3 ignorés** (`1 suite, 10.68s`), aucune erreur de compilation |

### 4.2 Les verrous échouent-ils vraiment ? (mutation, mesurée)

Un verrou qui ne casse rien ne verrouille rien. Les deux mutations ont été
appliquées **puis annulées** (fichier restauré, 25/25 vert) :

| Mutation appliquée à `vocal-nom-garde.js` | Effet mesuré sur `mots-de-reveil.test.js` |
|---|---|
| supprimer la règle `if (mentionsWakeWord(...)) return laisser("mot-reveil")` | **ÉCHEC** (`expected 'nom-absent' to be 'mot-reveil'`) |
| supprimer la règle `if (mentionsAssistantName(...)) return laisser("nom-entendu")` | **ÉCHEC ×2** (`expected 'jeter' to be 'laisser'`) |

Donc : « un mot saisi réveille sans le nom » et « le nom réveille toujours »
sont réellement tenus. Le cas « champ vide = seul le nom » est tenu par la
première mutation (le champ vide n'a plus AUCUNE règle de mot) et par le test
`champ vide : le comportement d'avant, a l'identique`.

### 4.3 Les autres preuves

- `src/js/mots-de-reveil.test.js` (nouveau, 25 assertions) : le réglage est
  **additif** (champ vide = comportement à l'identique, nom toujours accepté avec
  réglage), **un seul mot suffit** n'importe où, plusieurs mots dont **un seul**
  prononcé, **casse/accents/ponctuation ignorés** (même fonction que le nom),
  phrase sans mot **refusée**, mot inutilisable ignoré, fail-open préservé,
  normalisation de la saisie (doublons, séparateurs, idempotence), **un seul**
  point de décision et **un seul** chemin d'envoi, relecture à chaud fail-open,
  **aucun import** de la garde hors de l'écran Vocal, et le réglage à un seul
  endroit (HTML, `settings.js`, Rust).
- Suites existantes : `vocal-nom-garde.test.js` (34) reste **inchangé** et vert.
- `npm run build:handbook` : aide intégrée régénérée (bloc
  `HELP:vocal-garde-du-nom` enrichi) ; relancé pour ce rapport, le fichier
  `help/handbook.md` est **identique** à la sortie du script (aucune dérive).

## 4 bis. À taper pour tester à la main (5 minutes)

1. `npm run tauri dev`, puis ouvrir l'onglet **🧭 Assistant** et passer en
   **mode Vocal** (le logo du bandeau, ou Échap pour en sortir).
2. ⚙️ **Options → onglet « Assistant » → section « Mode Vocal »** : laisser le
   champ **« Mots de réveil »** **vide**, enregistrer. Dire « range le projet » :
   rien ne part (comportement d'avant). Dire « <Nom>, range le projet » : ça part.
3. Revenir aux Options, écrire **`Nova, hey Nova`**, enregistrer.
   - Dire « Nova, range le projet » → ça part **sans le nom**.
   - Dire « hey Nova, et ça ? » → ça part (un seul mot suffit).
   - Dire « <Nom>, range le projet » → ça part **toujours** (le nom reste reçu).
   - Dire « nouvelle version » / « range le projet » → rien ne part.
4. Vider le champ, enregistrer : « Nova, range le projet » ne part **plus**
   (retour strict au nom seul). Aucun redémarrage nécessaire entre les étapes.
5. Vérifier hors mode Vocal : l'onglet agent π et la saisie clavier sont
   inchangés, et la saisie **clavier** n'est jamais filtrée.

## 5. Re-vérification de la livraison

La fonctionnalité livrée a été **re-contrôlée sur l'arbre courant** (le module
`vocal-nom-garde.js` et son verrou sont inchangés depuis la livraison) :

| Commande | Sortie RÉELLE |
|---|---|
| `npm test` (suite front complète) | **5 594 tests passés, 0 échec** (300 fichiers) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **901 passés, 3 ignorés** |
| `npx vitest run src/js/mots-de-reveil.test.js src/js/vocal-nom-garde.test.js` | **59 passés, 0 échec** |
| `npm run build:handbook` | `help/handbook.md` **identique** (aucune dérive, arbre propre) |
| mutation : suppression de la règle `mot-reveil` | **ÉCHEC** du verrou (puis fichier restauré, vert) |

Aucune version, aucun tag, aucune release n'a été touché.

## 6. Limites assumées (dites à l'utilisateur)

- Un mot de réveil **mal transcrit** ne déclenche rien : la tolérance est
  étroite **par choix** (comme pour le nom). Remèdes, dans l'ordre : redire,
  « Réveiller <Nom> », ou écrire. Un mot de réveil plus simple à reconnaître
  (« hey Nova ») est souvent la bonne réponse — c'est à cela qu'il sert.
- Un mot de réveil est une **expression** : « hey Nova » ne se déclenche pas sur
  « hey, nova » (même comparaison que le nom, donc même rigueur).
