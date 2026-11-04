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

## POINT 2 — Genre grammatical réglable

### La demande
**Un seul** réglage dans Paramètres → Assistant, **trois valeurs**
(masculin / féminin / non précisé), « non précisé » par défaut et **sans effet**.
Le genre choisi est **injecté dans le prompt** de l'assistant pour que l'écriture
(et donc la parole lue à voix haute) s'y accorde.

### Ce qui est en place
| Élément | Fichier |
|---|---|
| Clé **unique** du réglage + valeurs canoniques + normalisation | `src/js/assistant-genre.js` (`ASSISTANT_GENDER_KEY = 'assistant_gender'`) |
| Champ d'interface (un `<select>`, trois options) | `#setting-assistant-gender` (`index.html`), lu/écrit par `src/js/settings.js` |
| Texte **unique** de la phrase de genre | `src-tauri/src/assistant_identity.rs` (`assistant_gender_instruction`, `assistant_identity_block`) |
| Priorité fiche de personnage > réglage de Pilot | `assistant_identity::effective_assistant_gender` |
| Injection dans le prompt | `src-tauri/src/super_agent.rs` : session vivante **et** reviewer par message (même bloc) |

### Test ajouté (verrou)
`src/js/genre-et-modele-par-personnage.test.js` + les tests unitaires Rust de
`assistant_identity.rs` :
« non précisé » ⇒ consigne **vide** ⇒ prompt inchangé ; masculin/féminin ⇒ une
phrase, une seule ; valeur inconnue ou casse/accents variés ⇒ « non précisé »
(tolérant, jamais un genre imposé) ; aller-retour d'interface sans perte ;
**la fiche du personnage passe avant** le réglage de Pilot ; le champ est lu
**et** enregistré à chaque ouverture/enregistrement des Options (sinon il serait
perdu à chaque écriture complète de la configuration).

### Effet visible
⚙️ Options → Assistant → **« Genre de l'Assistant »** : trois choix —
**« Non précisé (aucune indication) »** (défaut), **Féminin**, **Masculin**.
Choisir « Féminin » : l'assistant écrit et fait lire « je suis prête »,
« je suis arrivée » ; accords, adjectifs et pronoms suivent.

### Ce qui ne change pas
- **« Non précisé »** (le défaut) n'ajoute **rien** au prompt : comportement
  d'avant, à l'identique.
- Le réglage ne change **ni les réponses ni les décisions** : uniquement la
  façon de **parler de lui**.
- **Un seul** réglage de genre : aucune seconde clé concurrente n'est créée ;
  le genre porté par une **fiche de personnage** reste prioritaire (il est plus
  précis), pas un second réglage d'écran.
- Aucun fichier écrit dans `G:\IA_PL\Presences` (voir ci-dessous).

### Ce que Présences devra exposer (à traiter séparément — rien n'a été écrit là-bas)
Pilot **lit déjà** le genre par fiche de personnage, sans rien créer ni modifier.
Pour que le genre soit porté **par personnage**, Présences doit, dans **sa**
livraison :

- déposer, à côté du nom et du portrait qu'elle dépose déjà
  (`~/.pilot/portrait/` — sa décision D23), un fichier **`genre.txt`**
  contenant **une** des deux valeurs `feminin` ou `masculin` ;
- **supprimer** (ou laisser absent) ce fichier pour un personnage **sans
  genre** — l'absence est le cas normal : Pilot retombe alors sur le réglage
  général, sans erreur ni message ;
- exposer, dans son propre écran, le choix du genre par fiche (libellé
  utilisateur : « Féminin », « Masculin », « Non précisé »), et n'écrire que la
  forme canonique ci-dessus (casse et accents sont tolérés à la lecture, pas
  garantis).

Côté Pilot, **rien de plus n'est nécessaire** : la lecture, la priorité
fiche > réglage et le repli silencieux sont déjà en place et testés. Cette
partie est **signalée comme à traiter séparément** dans le suivi.

---
