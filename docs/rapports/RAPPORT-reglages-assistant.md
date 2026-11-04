# Rapport — Trois réglages du comportement de l'Assistant

Date : 2026-11-16 · Specs concernées : `spec_modes_ecran_vocal.md` (§ 6quater,
§ 6quater.1), `spec_super_agent.md` (genre de l'Assistant, agent jetable)

Ce rapport couvre **trois réglages du même domaine** — le comportement de
l'assistant — traités dans une même mission :

1. **mots de réveil paramétrables** (écran Vocal) ;
2. **genre grammatical réglable** (Assistant) ;
3. **agents jetables par défaut** (instructions de l'Assistant).

Les trois étaient **déjà livrés** dans le dépôt (commits `ee7607e`, `6bdbb0d`,
`09ac19d` + `3fd5bba`) : cette mission **revérifie** chaque point contre la
demande, **fixe la preuve** (tests, effets visibles, ce qui ne change pas),
**complète la documentation** et **consolide le suivi** dans ce rapport.
Aucun numéro de version n'a été touché.

---

## POINT 1 — Mots de réveil paramétrables

### La demande
En mode Vocal, l'écoute ne se déclenche que si le **nom** de l'assistante est
prononcé. Le propriétaire veut pouvoir régler **plusieurs mots de réveil**
(séparés par des virgules) dans **Paramètres → Assistant**.

### Ce qui est en place
| Élément | Fichier |
|---|---|
| Réglage unique, additif, défaut vide | `vocal_wake_words` — `AppConfig` (`src-tauri/src/lib.rs`, `#[serde(default)]`), lu/écrit par `src/js/settings.js` |
| Champ texte de l'interface | `#setting-vocal-wake-words`, section « Mode Vocal » de l'onglet Assistant (`index.html`) |
| Décisions pures de la garde | `src/js/vocal-nom-garde.js` : `wakeWordsFrom`, `wakeWordsText`, `mentionsWakeWord`, `decideVocalNameGate`, `vocalNameGateArmed` |
| Application (point unique) | `src/js/super-agent.js` (`rec.onresult`, `rec.onend`, résultats intermédiaires) |

**Ordre des règles** (c'est la spécification, il se teste tel quel) :
hors mode Vocal → texte vide → reprise en main → réveil une phrase →
**nom entendu** → **mot de réveil entendu** → nom illisible (fail-open, qui ne
joue plus que si **aucun** mot de réveil utilisable n'est réglé) → phrase jetée.

### Test ajouté (verrou)
`src/js/mots-de-reveil.test.js` — 25 cas :
champ vide = comportement d'avant à l'identique ; le nom reste accepté quand des
mots sont réglés ; un seul mot prononcé suffit, où qu'il soit ; majuscules,
accents, ponctuation, espaces multiples ; une phrase qui parle d'autre chose ne
passe pas ; **clavier jamais filtré** ; réveil une phrase prioritaire ; mot
inutilisable ignoré (jamais une faille) ; fail-open du nom illisible préservé
mais borné par un mot de réveil ; **une seule forme mémorisée** (`wakeWordsText`) ;
champ présent dans la section « Mode Vocal » avec son aide ; les réglages
existants de la section intacts ; l'enregistrement écrit **une** valeur
normalisée ; la clé Rust est bien `#[serde(default)]`.

### Effet visible
⚙️ Options → Assistant → « Mode Vocal » → champ **« Mots de réveil »**
(placeholder « Nova, hey Nova »). Saisir `Nova, hey Nova` : une phrase contenant
**un seul** de ces mots part ; son nom reste accepté **en plus**. Le réglage
s'applique **sans redémarrage** (relu à chaque dictée, fail-open).

### Ce qui ne change pas
- Champ **vide** ⇒ comportement **strictement** d'avant (nom seul).
- Le **nom** de l'assistante est **toujours** accepté (le réglage s'ajoute, il
  ne remplace jamais).
- La comparaison est **celle de la garde existante** (`mentionsAssistantName` :
  casse, accents, ponctuation, seules variantes évidentes de prononciation) —
  aucune seconde comparaison n'est écrite.
- Une phrase **sans** nom ni mot de réveil est **jetée** : ni envoyée, ni
  conservée dans la zone, ni affichée, **aucun message répété**.
- La saisie **clavier** n'est **jamais** filtrée ; le bouton « Réveiller
  <Nom> » vaut toujours pour **une** phrase.
- **Hors** de l'écran Vocal (onglet agent π, 🧭 en mode détaillé, web distant) :
  rien ne change (ces écrans n'importent pas la garde — vérifié par test).

---
