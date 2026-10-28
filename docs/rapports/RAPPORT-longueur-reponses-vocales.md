# Rapport — la longueur des réponses du mode Vocal devient réglable

> Demande : *la longueur des réponses orales du mode Vocal est figée à « deux ou
> trois phrases » ; elle doit devenir un réglage à **quatre niveaux** — très
> courte, courtes, moyenne, détaillées — avec **« courtes » par défaut** et un
> effet à la **demande suivante**.*
> Contraintes tenues : **défaut identique mot pour mot**, **un seul module pur**,
> **un seul point de composition**, **aucune troncature**, **un seul réglage**,
> **aucune migration**, seuils de coupure / micro / délai d'envoi / lecture à voix
> haute / cercle de l'écran Vocal / bouton « Outils » **non touchés**.
> Protocole `quality-gate` appliqué (`.pi/skills/quality-gate/SKILL.md`), sur le
> modèle exact du précédent `RAPPORT-delai-envoi-reglable.md`.

---

## 1. Constat de départ (état réel du code avant modification)

| Élément | Avant |
|---|---|
| La consigne | `VOCAL_BREVITY_INSTRUCTION` : tableau de **cinq lignes figées**, joint par `\n`, dont la règle « réponds en DEUX OU TROIS PHRASES AU PLUS » (`src/js/vocal-brevity.js`) |
| La composition | `composeVocalPrompt(texte, { modeVocal })`, appelée **une seule fois** dans `send()` de `src/js/super-agent.js` |
| Le réglage | **aucun** : ni champ, ni interface, ni configuration — la spec le disait noir sur blanc (« Rien à l'écran, rien à régler ») |
| Les invariants | déjà présents dans la consigne : développement sur demande, sécurité dite entièrement, aucune coupe, texte inchangé hors mode Vocal, demande vide sans consigne |

Pour changer la longueur, il fallait donc **modifier le code et republier** :
c'est ce que la demande corrige, **sans changer le comportement par défaut**.

---

## 2. Ce qui a changé

### 2.1 `src/js/vocal-brevity.js` — le module pur (source unique)

- **`VOCAL_BREVITY_LEVELS`** : les quatre clés **stables** (mémorisées dans la
  configuration, donc jamais renommables) —
  `["tres-courte", "courtes", "moyenne", "detaillees"]`.
- **`VOCAL_BREVITY_DEFAULT_LEVEL = "courtes"`** : le défaut, et le repli.
- **`normalizeVocalBrevityLevel(value)`** : **seul juge** de ce qu'une valeur
  vaut. Chaîne inconnue, vide, `null`, `undefined`, nombre, objet, **casse
  différente** ⇒ `"courtes"`. Espaces autour d'une clé valide tolérés
  (`" courtes "` ⇒ `"courtes"`), sans jamais accepter une autre casse. Fonction
  **idempotente**.
- **`vocalBrevityLabel(value)`** : **seul libellé** — « Très courte »,
  « Courtes », « Moyenne », « Détaillées ».
- **`vocalBrevityInstruction(niveau)`** : la consigne d'un niveau, construite à
  partir de quatre morceaux — en-tête commun (2 lignes), **règle de longueur du
  niveau**, clause de développement, clause d'exception sécurité.
- **`VOCAL_BREVITY_INSTRUCTION`** = `vocalBrevityInstruction("courtes")` : pour le
  niveau par défaut, la consigne produite est **exactement** la chaîne
  historique (vérifié caractère par caractère par le test, contre une copie
  littérale).
- **`composeVocalPrompt(text, { modeVocal, niveau })`** : seul assemblage. Le
  niveau est lu **au moment de composer** — d'où l'effet « à la demande
  suivante » — et normalisé sur place, donc une valeur illisible ne peut pas
  produire de consigne inattendue.

**Le contenu des quatre niveaux** (le cœur du travail) :

| Clé | Règle de longueur |
|---|---|
| `tres-courte` | UNE À DEUX PHRASES, l'essentiel seulement |
| `courtes` | DEUX OU TROIS PHRASES AU PLUS — **phrase historique, mot pour mot** |
| `moyenne` | QUATRE À SIX PHRASES, avec le pourquoi quand il aide |
| `detaillees` | réponse COMPLÈTE ET DÉVELOPPÉE, mais toujours **dite à l'oreille** : des phrases, jamais de tableau, jamais de code, jamais un nom de fichier lu à voix haute |

### 2.2 Les cinq invariants, pour **les quatre** niveaux

| Invariant | Où il est dit |
|---|---|
| (a) une demande de développer passe **avant** le niveau | clause de développement, identique dans les quatre consignes ; les niveaux réglés ajoutent la phrase « Cette demande de développement passe AVANT le niveau de longueur choisi. » (le niveau par défaut garde sa formulation historique, où « alors développe » tranche) |
| (b) panne / refus / erreur / confirmation dits **entièrement** | clause d'exception « Exception qui passe AVANT la brièveté … se disent ENTIÈREMENT », avec la référence de longueur du niveau |
| (c) **aucune troncature** | le module ne contient **aucune** primitive de coupe (`slice`, `substring`, `substr`), aucun plafond de caractères ; testé sur le source et sur 4 000 répétitions d'un mot |
| (d) hors mode Vocal, texte **inchangé** | `composeVocalPrompt` rend le texte tel quel quand `modeVocal !== true` |
| (e) demande vide, **aucune consigne** | `if (!demande.trim()) return demande;` |

### 2.3 Le réglage : un champ, aucune migration

- `src-tauri/src/lib.rs` : champ `vocal_brevity_level: String` avec
  `#[serde(default = "default_vocal_brevity_level")]`,
  `fn default_vocal_brevity_level() -> String { "courtes".to_string() }`, et
  l'initialisation dans `impl Default`. **Aucune migration** : un fichier de
  configuration ancien (sans le champ) prend le défaut, donc le comportement
  historique.

### 2.4 Le branchement côté écran (`src/js/super-agent.js`)

- Nouvelle variable d'état `vocalLongueurNiveau = null` (documentée : `null` /
  illisible ⇒ le module pur tranche « courtes »).
- **`refreshVocalLongueurNiveau()`** : relit `get_config` et applique
  `normalizeVocalBrevityLevel(cfg.vocal_brevity_level)` ; `catch` ⇒
  `normalizeVocalBrevityLevel(null)`. **Fail-open.**
- Appelée **deux fois, pas plus** : au **montage** de l'onglet et dans le
  gestionnaire **déjà existant** `onConfigChanged` de `pilot-config-changed`
  (aucun second écouteur, donc aucune fuite à la recréation d'onglet, issue #12).
- Le seul point de composition transmet le niveau :
  `composeVocalPrompt(text, { modeVocal: vocalOverlay !== null, niveau: vocalLongueurNiveau })`.
  Aucun niveau écrit en dur dans l'écran.

### 2.5 L'interface : un seul choix, dans la section existante

- `index.html`, section **`#settings-section-vocal-delay`** (« Mode Vocal »,
  Paramètres → onglet Assistant) : **sous le curseur du délai d'envoi**, une
  `setting-row` avec `<label for="setting-vocal-brevity-level">`, un
  `<select id="setting-vocal-brevity-level">` **vide dans le balisage** et une
  note `role="note"` reliée (`aria-describedby="vocal-brevity-note"`).
- `src/js/settings.js` : les **quatre entrées sont construites** depuis
  `VOCAL_BREVITY_LEVELS` + `vocalBrevityLabel` (**aucun libellé recopié**) ;
  `refreshVocalBrevityLevel()` remplit et sélectionne la valeur mémorisée ;
  l'enregistrement écrit `vocal_brevity_level: normalizeVocalBrevityLevel(...)` —
  une valeur aberrante ne peut donc **jamais** être écrite.
- Aucun autre réglage, aucun bouton, aucune couleur.

---

## 3. Ce qui n'a **pas** changé (interdits respectés)

- **Défaut identique mot pour mot** : `vocalBrevityInstruction("courtes")` et
  `VOCAL_BREVITY_INSTRUCTION` sont la chaîne historique exacte (test contre copie
  littérale).
- **Hors mode Vocal** : texte inchangé (chat écrit π, onglet 🧭 Assistant).
- **Aucune troncature** : la brièveté vient de la consigne ; aucune limite de
  caractères ajoutée nulle part.
- **Seuils de coupure, micro, anti-écho, cercle de l'écran Vocal, délai
  d'envoi, lecture à voix haute, bouton « Outils »** : **aucune ligne touchée**
  (`vocal-mic.js`, `vocal-conversation.js`, `voice-auto-send.js`, `read-aloud.js`
  intacts).
- **Aucun second système de consigne** : une seule fonction de construction, un
  seul point d'appel, aucun autre module ne recopie la consigne ou les clés.
- **Aucune migration de configuration** : `#[serde(default)]` suffit.
- **Aucun document à la racine** : ce rapport est dans `docs/rapports/`.

---

## 4. Documentation mise à jour

| Fichier | Ce qui est dit maintenant |
|---|---|
| `spec_modes_ecran_vocal.md` | nouvelle section **§ 6bis.3 « La longueur des réponses orales se règle (quatre niveaux) »** : tableau des quatre clés / libellés / contenus, source unique, effet à la demande suivante, les cinq invariants, le réglage (emplacement, champ Rust, fail-open, deux points de relecture), le verrou de test ; § 6bis.2 corrigée (« rien à régler » → renvoi vers § 6bis.3) |
| `spec_read_aloud.md` § 2 | la section voisine `#settings-section-vocal-delay` porte désormais **aussi** la longueur (`#setting-vocal-brevity-level`, `vocal_brevity_level`, les quatre libellés) — voisin, jamais mélangé |
| `help/overview.md` — bloc `HELP:modes-ecran` | la règle utilisateur : « Pilot parle court », puis **« Cette longueur se règle »** avec le chemin exact, les quatre choix décrits en une phrase chacun, l'effet à la demande suivante, la priorité du développement et la sécurité dite en entier |
| `help/overview.md` — bloc `HELP:lire-reponses` | la ligne **« Longueur des réponses à l'oral »**, juste sous le **Délai d'envoi** |
| `help/handbook.md` | **régénéré** (`npm run build:handbook` — 46 blocs) |

---

## 5. Preuves (tests)

Nouveau fichier **`src/js/vocal-longueur-reglable.test.js`** :

1. **les quatre niveaux** : clés exactes, aucun doublon ; un **libellé français
   non vide et distinct** par niveau ; le libellé passe par la normalisation ;
2. **le défaut** : `"courtes"`, et la consigne produite **égale** la chaîne
   historique recopiée littéralement dans le test — y compris sans niveau
   transmis et avec un niveau inconnu ;
3. **la normalisation** : 13 valeurs aberrantes (chaîne approchante, casse
   différente, vide, `null`, `undefined`, nombre, objet, tableau, booléen) ⇒
   défaut ; les quatre clés reconnues (espaces tolérés) ; idempotence ;
4. **le contenu** : chaque niveau annonce **sa** longueur (regex par niveau) ;
   « moyenne » ajoute le pourquoi ; « détaillées » reste parlée et ne fixe aucun
   plafond ; les quatre consignes sont **différentes** ; toutes interdisent
   listes, titres, tableaux, noms de fichiers, code ;
5. **les cinq invariants pour les quatre niveaux** (test paramétré, 20 cas) :
   développement d'abord, sécurité entière, aucune troncature (4 000 mots),
   texte inchangé hors mode, demande vide sans consigne ;
6. **la pureté** : ni DOM, ni `invoke`, ni état, ni clé de configuration dans le
   module ; aucune copie de la consigne ailleurs ;
7. **le branchement** : une seule variable d'état, `get_config` + juge unique,
   fail-open, **deux** appels exactement, **aucun nouvel écouteur**, niveau
   transmis au seul point de composition, champ Rust à `#[serde(default)]` ;
8. **l'interface** : un seul `id="setting-vocal-brevity-level"`, dans la section
   du mode Vocal, **sous** le curseur du délai, dans l'onglet Assistant, libellé
   relié, note reliée, **aucune entrée ni libellé en dur**, enregistrement
   normalisé ;
9. **la documentation** : la spec du mode Vocal, la spec de la lecture à voix
   haute, l'aide source **et** le handbook généré disent le réglage.

Test existant **adapté** : `src/js/vocal-reponses-courtes.test.js` — l'import
`composeVocalPrompt` porte désormais aussi `normalizeVocalBrevityLevel`, le
message de `send()` transmet `niveau`, le cas « aucun réglage, aucun bouton,
aucune phrase d'interface » devient « le module de consigne reste PUR » (le
réglage existe maintenant, mais il vit dans l'écran et les Paramètres, pas dans
le module). **Son intention et tous ses autres cas sont conservés.**

Vérifiés sans modification par les fichiers voisins : `vocal-delai-envoi-reglable`
(le curseur du délai est intact), et toute la suite JS + Rust (compteurs réels
ci-dessous).

---

## 6. Limites connues (dites, pas cachées)

- **Le web distant n'a pas ce réglage** : l'écran Vocal n'existe pas en mode web ;
  le champ reste dans la configuration du poste.
- **Le niveau par défaut ne dit pas littéralement « passe avant le niveau »** :
  c'est la formulation historique, conservée mot pour mot (« alors développe ») ;
  les trois autres niveaux le disent explicitement.
- **Une demande déjà partie n'est pas réécrite** : c'est voulu (le niveau est lu
  au moment de composer), et c'est ce qui rend l'effet « à la demande suivante »
  vérifiable.
