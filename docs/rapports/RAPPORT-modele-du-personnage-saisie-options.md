# RAPPORT — Saisir le modèle du personnage depuis les Options

Micro-tâche : **le modèle IA d'un personnage devient réglable dans Pilot**
(Options ⚙️ → onglet **Assistant**), alors que Présences n'a aucun écran.

---

## 1. Ce qui manquait

Avant ce lot, la chaîne de repli du modèle de l'Assistant existait et
fonctionnait (tâches 402/403) :

```
fiche du personnage (modele.txt)  →  modèle choisi (super_agent_model)
                                  →  réglage dédié (#88)
                                  →  défaut global des agents
```

mais **personne ne pouvait écrire `modele.txt`** : Présences n'a pas d'écran,
et `persona.rs` ne fait que lire. Un personnage ne pouvait donc jamais porter
de modèle propre — la première marche de l'escalier restait toujours vide.

## 2. Décision d'implémentation

| Exigence de la demande | Mise en œuvre |
|---|---|
| Un champ texte + enregistrer / effacer | `#setting-assistant-model` + `#btn-assistant-model-save` + `#btn-assistant-model-clear`, dans la section Assistant existante (aucun écran nouveau) |
| Clé de configuration **additive**, cohérente avec le genre, survivant à un enregistrement complet | `AppConfig.assistant_model` (`#[serde(default)]`, défaut `""`) à côté de `assistant_gender` ; écrite explicitement dans l'objet sauvegardé par `settings.js` (sinon `save_config`, qui réécrit TOUTE la config, l'effacerait) |
| Valeur vide = aucun modèle propre, repli **silencieux** | `modele.txt` vidé ; `read_persona` → `model: None` → chaîne de Pilot, aucun message d'erreur |
| Valeur inconnue du registre = jamais bloquant + une ligne dans le volet « Événements » | `decide_assistant_model` **existant** (aucune modification) ; la commande d'écriture appelle `assistant_session_model`, qui publie la trace **existante** `pilot-assistant-model-trace` (affichée par `initAssistantModelTraceWatch`), sans créer un second journal |
| Écrire dans la fiche du personnage (même emplacement que le genre) | `modele.txt` dans le dossier du personnage **actif**, à côté de `genre.txt` — jamais un réglage parallèle |
| Aucun réglage inventé, mêmes styles | `setting-row setting-row-indent`, mêmes composants que la ligne du genre |

### Le seul point délicat : le contrat « lecture seule »

`persona.rs` et `spec_super_agent.md` disaient « Pilot ne fait que LIRE le
dossier du personnage ». La demande impose d'y écrire le modèle : le contrat est
donc **amendé explicitement**, au plus juste :

- **un seul fichier** peut être écrit : `modele.txt` ;
- **uniquement sur geste de l'utilisateur** (bouton « Enregistrer » / « Effacer le
  choix »), jamais automatiquement ;
- **jamais de création de dossier** : sans personnage actif, l'écriture est
  refusée avec un message clair (créer le dossier ferait apparaître un
  personnage qui n'existe pas) ;
- **le dépôt historique** (`<app_data_dir>/.pilot/portrait`) n'est **jamais** une
  cible d'écriture ;
- `nom.txt`, `portrait.png` et `genre.txt` ne sont **ni lus autrement, ni
  modifiés, ni supprimés** ; la lecture, l'empreinte et la règle de priorité
  entre dépôts sont **inchangées**.

## 3. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src/js/assistant-model.js` | **nouveau** — décisions PURES du champ (clé, normalisation, valeur d'affichage, texte d'aide) |
| `src/js/settings.js` | lecture + préremplissage, deux gestes (enregistrer / effacer), clé ajoutée à l'objet sauvegardé |
| `index.html` | la ligne du champ, dans la section Assistant |
| `src-tauri/src/persona.rs` | décision pure de l'écriture + `read_assistant_persona_model` + `write_assistant_persona_model` |
| `src-tauri/src/lib.rs` | `AppConfig.assistant_model` (`#[serde(default)]`, défaut vide) + enregistrement des deux commandes |
| `spec_super_agent.md` | technique de la tâche 403 + amendement du contrat lecture seule + bloc HELP |
| `README.md` | ce que l'utilisateur peut faire désormais |
| `help/handbook.md` | **régénéré** (`npm run build:handbook`), jamais édité à la main |
| `src/js/modele-du-personnage-dans-les-options.test.js` | **nouveau** — test verrou |

## 4. Règles tenues (et où elles vivent)

1. **La priorité des modèles n'est pas recopiée** : elle reste dans
   `assistant_identity::decide_assistant_model`, appelée par
   `super_agent::assistant_session_model`. La commande d'écriture ne décide
   **aucun** modèle : elle écrit un fichier, puis **réutilise** cette décision
   pour publier la trace existante.
2. **La normalisation d'une spécification de modèle** reste
   `persona::normalize_model_line` → `super_agent::parse_model_spec` (une seule
   grammaire `fournisseur/modèle`). Une valeur mal formée est **refusée** : elle
   n'est jamais écrite dans la fiche (une faute de frappe ne doit pas effacer un
   modèle ni en inventer un).
3. **La fenêtre ne compose aucune phrase de repli** : le texte affiché vient de
   la commande Rust, qui le tient de la décision unique.
4. **Un seul préremplissage** : `assistantModelPrefill` (module pur) dit quelle
   valeur afficher — celle de la fiche quand un personnage est actif, sinon la
   valeur mémorisée en configuration.

## 5. Couverture

- `src/js/modele-du-personnage-dans-les-options.test.js` — le verrou :
  champ + deux boutons présents dans `index.html`, clé **additive** côté Rust et
  côté enregistrement, préremplissage qui suit la fiche (repli), appel des
  commandes réelles, écriture qui **refuse** de créer un dossier, dépôt
  historique jamais ciblé, trace **réutilisée** (une seule publication),
  priorité des modèles **non recopiée**.
- `src-tauri/src/persona.rs` — tests unitaires des décisions pures et de
  l'écriture dans un dossier temporaire (écrit, effacé, refusé, jamais créé).

## 6. Preuve par mutation

Chaque mutation a été appliquée, l'échec constaté, puis le fichier restauré
(`diff` vide). Détail en fin de rapport après exécution.

Résultats mesurés (chaque mutation appliquée seule, test ciblé relancé, fichier
restauré, `diff -q` **vide** après restauration) :

| # | Mutation | Ce que l'écran ou le socle ne fait plus | Constat |
|---|---|---|---|
| M1 | suppression de `<input id="setting-assistant-model">` dans `index.html` | il n'y a plus de champ de saisie | **2 tests échouent** (`toContain 'id="setting-assistant-model"'`, puis `-1 to be greater than 1241`) |
| M2 | `persona.rs` : la commande d'écriture appelle `assistant_identity::decide_assistant_model` au lieu de `super_agent::assistant_session_model` | une **seconde** décision de modèle apparaît à côté de la vraie (le repli peut diverger) | **1 test échoue** (`not.toContain 'decide_assistant_model('`) |
| M3 | suppression de la ligne `assistant_model:` de l'objet de configuration enregistré par `settings.js` | la clé n'est plus réémise, donc `save_config` la remet à vide | **1 test échoue** (`expected +0 to be 1`) |
| M4 | `assistant-model.js` : `assistantModelPrefill` n'honore plus la fiche du personnage | l'écran affiche le souvenir au lieu du modèle qui tourne (il ment) | **1 test échoue** (`expected 'openai/gpt-4o' to be 'ollama/glm-5.2:cloud'`) |

Après restauration des quatre fichiers, le verrou repasse **16/16** et les deux
suites complètes sont vertes (tests front et `cargo test --lib`). Aucun total
n'est figé ici : les chiffres sont ceux du moment.

## 7. Documentation mise à jour

- `spec_super_agent.md` : nouvelle sous-section « Saisie du modèle du personnage
  depuis les Options (tâche 403, suite) », amendement explicite du « Pilot ne
  fait que LIRE » (une seule exception, `modele.txt`, sur geste), et bloc
  `<!-- HELP:super-agent-genre-modele -->` complété (où se règle le modèle, ce
  que fait un champ vide, ce qui est refusé).
- `README.md` : nouvelle puce « Modèle du personnage » dans les réglages.
- `help/handbook.md` régénéré (`npm run build:handbook`).
