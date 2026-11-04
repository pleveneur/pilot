# RAPPORT — Genre de l'Assistant et modèle par personnage (tâches 402 et 403)

**Date** : 2026-11-16
**Périmètre** : Pilot (desktop). Le projet **Présences** n'est **pas** modifié : rien n'y est
exigé pour que ce lot fonctionne, et rien n'y casse s'il n'ajoute rien.
**Livré en un seul lot** : les deux tâches (402 genre, 403 modèle par personnage) partagent la
même lecture de la fiche du personnage actif, donc un seul branchement, un seul rapport.

---

## 1. Ce qui est possible maintenant

### Tâche 402 — dire si l'Assistant parle au masculin ou au féminin

- **Où se règle le genre** : `Options ⚙️ → onglet « Assistant » → « Genre de l'Assistant »`,
  juste sous le nom. Trois choix seulement :
  - **« Non précisé (aucune indication) »** — **défaut**, aucune consigne ajoutée au prompt ;
  - « Féminin » ;
  - « Masculin ».
- **Ce que ça change** : une seule phrase est ajoutée au prompt système de l'Assistant, qui lui
  demande de parler de lui au genre choisi (accords, adjectifs, pronoms), avec un exemple. Elle
  ne change **ni ses réponses ni ses décisions**, seulement la façon de les dire, et l'assistant
  n'a pas à l'expliquer.
- **Le personnage actif passe avant** : si la fiche du personnage déposée par **Présences** porte
  un genre (`genre.txt`), c'est **le sien** qui s'applique, car un personnage est plus précis
  qu'un réglage général. La consigne est alors annoncée comme venant de la fiche.
- **Le nom n'est pas touché** : la consigne de genre ne nomme jamais l'assistant (le nom garde
  son chemin unique, `personaDisplayName`).

### Tâche 403 — un modèle par défaut propre à chaque personnage

- **Où se règle le modèle du personnage** : dans **sa fiche**, côté Présences (`modele.txt`, au
  format `fournisseur/modèle`, par exemple `plh/rapide`).
- **Priorité retenue** (une seule règle, dans un seul module) :
  1. **modèle de la fiche du personnage actif** — s'il est renseigné, bien formé **et encore
     présent dans le registre des modèles installés** ;
  2. modèle **choisi** dans l'onglet 🧭 (barre d'outils) ;
  3. **réglage dédié** de l'Assistant (`super_agent_default_model`, issue #88) ;
  4. **modèle par défaut global** des agents.
- **Fiche sans modèle = comportement actuel, sans erreur ni message** : on retombe simplement sur
  la chaîne de Pilot (2 → 3 → 4), exactement comme avant ce lot.
- **Modèle de la fiche introuvable** (désinstallé) ou **mal formé** : il est écarté, une **trace
  lisible** est écrite (`[assistant] modele du personnage : …`, évènement
  `pilot-assistant-model-trace`), **affichée dans le volet « Événements »** de l'onglet 🧭 par
  `initAssistantModelTraceWatch` (écoute unique posée au démarrage de Pilot, donc elle existe
  même si l'onglet est fermé — un démarrage de session peut venir du web distant). Pilot repart
  alors sur sa chaîne. **Jamais un échec de démarrage** : une fiche périmée ne peut pas empêcher
  l'assistant de parler.
- La sélection de modèle **par couple (projet, agent)** (C4) et le modèle **actif** de l'Assistant
  (`super_agent_model`) sont **inchangés**.

---

## 2. Tolérance stricte à l'absence des nouveaux champs

Aucune fiche existante ne doit être réécrite, et **Présences n'a rien à faire pour que Pilot
continue de marcher** :

| Situation | Ce qui se passe |
|---|---|
| Fiche **sans** `genre.txt` ni `modele.txt` (toutes les fiches actuelles) | aucun genre, aucun modèle imposé → réglages de Pilot. Aucune erreur, aucun message. |
| `genre.txt` vide, inconnu (« autre », un prénom…) ou non UTF-8 | traité comme **absent** : aucun genre. Jamais une erreur. |
| `modele.txt` vide, commentaire (`#…`), sans `/`, ou mal formé | traité comme **absent** : chaîne de Pilot. Jamais une erreur. |
| Modèle cité **absent du registre** | écarté **avec une trace lisible**, repli sur Pilot. |
| Ancien fichier de configuration **sans** `assistant_gender` | `#[serde(default)]` → chaîne vide = « non précisé » = aucune consigne. |
| `PRESENCES_PILOT_DIR` non défini / dossier absent | identité vide → réglages de Pilot. Fail-open de bout en bout. |

Le **dépôt historique** (`<app_data_dir>/.pilot/portrait`) ne porte **ni genre ni modèle** : seule
la fiche personnelle (celle que Présences gère) fait autorité, comme pour le portrait.

---

## 3. Ce qu'il reste à ajouter côté Présences (rien d'obligatoire)

Pilot **lit** ces deux fichiers, il ne les écrit jamais et ne crée jamais le dossier :

1. `genre.txt` — une ligne, `feminin` ou `masculin` (casse et accents tolérés :
   `Féminin`, `FEMININ`, `femme` sont reconnus). Absent = rien.
2. `modele.txt` — une ligne, `fournisseur/modèle`, par exemple `plh/rapide`. Absent = rien.

Le champ de genre **de la fiche du personnage** doit être celui du **personnage** (ce qu'il est),
pas une préférence d'écriture : Présences décide de son ergonomie. Tant que ces fichiers
n'existent pas, tout fonctionne avec les réglages de Pilot.

---

## 4. Où vit chaque décision (une seule source par règle)

| Règle | Source unique | Verrou |
|---|---|---|
| Phrase de genre injectée | `src-tauri/src/assistant_identity.rs` (`assistant_gender_instruction`) | `genre-et-modele-par-personnage.test.js` : un seul `fn assistant_gender_instruction`, aucune phrase de genre en dur dans `super_agent.rs` |
| Priorité genre (fiche → réglage) | `assistant_identity::effective_assistant_gender` | tests unitaires du module + test JS de la position des étages |
| Bloc `identity` du prompt | `assistant_identity::assistant_identity_block`, branché **une fois** (`SuperAgentPromptBlocks.identity`) | test Rust `le_genre_s_injecte_dans_le_prompt_une_seule_fois` |
| Priorité des modèles | `assistant_identity::decide_assistant_model` | tests Rust + verrou JS (ordre fiche > choisi > dédié > global, `trace` obligatoire) |
| Lecture de la fiche | `src-tauri/src/persona.rs` (`read_persona`, `read_persona_identity`) | tests Rust de `persona.rs` |
| Normalisation côté fenêtre | `src/js/assistant-genre.js` | `genre-et-modele-par-personnage.test.js` |
| Trace du repli de modèle | `super_agent::assistant_session_model` (émission) + `initAssistantModelTraceWatch` (`super-agent.js`, écoute et affichage) | `genre-et-modele-par-personnage.test.js` : la décision ne renvoie aucun `Result`, l'évènement est écouté et affiché |

Points de branchement (aucun autre) :

- `super_agent::do_send_super_agent_prompt` → construit `identity` (une fois par tour) ;
- `super_agent::assistant_session_model` → décision du modèle, appelée par
  `do_start_super_agent_session` **et** par l'appel bloquant hérité `ask_super_agent` (même
  décision, donc même modèle dans les deux chemins) ;
- `settings.js` → lit et écrit `assistant_gender` en le **normalisant toujours**.

---

## 5. Preuves (tests)

Ajoutés dans ce lot :

- `src-tauri/src/assistant_identity.rs` — décisions pures : tolérance du genre, défaut qui
  n'ajoute rien, fiche prioritaire sur le réglage, fiche muette = chaîne de Pilot, modèle
  introuvable = repli **avec trace**, modèle choisi désinstallé = repli dédié puis global.
- `src-tauri/src/persona.rs` — fiche sans genre ni modèle (aucune erreur, sérialisation `null`),
  genre normalisé, modèle normalisé, **identité qui ne lit jamais le portrait**, dépôt historique
  sans genre ni modèle, empreinte qui suit les deux nouveaux fichiers.
- `src-tauri/src/super_agent.rs` — verrou « la consigne de genre n'est injectée qu'une fois », et
  « le modèle du personnage replie toujours sur Pilot » ; plus le verrou **de bout en bout**
  `le_genre_regle_apparait_dans_le_prompt_construit` : la VRAIE consigne passée à la VRAIE
  construction du prompt — « non précisé » rend un prompt **identique, octet pour octet**, et un
  genre réglé y **apparaît une seule fois** (« au féminin »).
- `src/js/genre-et-modele-par-personnage.test.js` (nouveau, 19 tests) — trois valeurs et défaut
  vide, valeur inconnue jamais un genre, aller-retour sans perte, une seule phrase de genre,
  `#[serde(default)]`, réglage présent à l'écran et **enregistré** (jamais perdu), lecture de la
  fiche sans erreur, identité sans le portrait, ordre des étages de modèle + `trace`, démarrage de
  session qui passe par la décision unique, **décision sans `Result`** (donc un modèle inconnu ne
  peut pas faire échouer le démarrage), **trace réellement écoutée et affichée** (aucun évènement
  mort), et **sélection par couple (projet, agent) intacte** (l'identité du personnage n'est lue
  que par `super_agent.rs` ; `set_agent_process_model` règle toujours la session de l'agent).

Non-régression vérifiée : `npm test` → **5594 tests / 0 échec** et
`cargo test --manifest-path src-tauri/Cargo.toml --lib` → **902 tests / 0 échec** (3 ignorés),
recomptés à l'exécution au moment de la livraison (aucun total figé dans le code).

Les tests existants qui devaient rester verts sans modification de leur intention :
`settings-superagent-active-model.test.js` (le modèle actif survit à un enregistrement des
Options), les tests de mesure et d'anti-regonflement du prompt de l'Assistant (le bloc de genre
vaut `""` par défaut, donc le prompt par défaut est **strictement identique** à avant), et les
tests de `persona.rs` sur le nom et le portrait.

---

## 6. Risques et parades

| Risque | Parade |
|---|---|
| Deux règles de genre qui divergent (une en Rust, une en JS) | la fenêtre **ne compose aucune phrase** : elle ne normalise qu'une valeur ; la phrase n'existe qu'en Rust |
| Le prompt enfler sans limite | la consigne n'est ajoutée que si un genre est réglé (une phrase, ~230 caractères) ; défaut = **zéro ajout** ; le garde-fou `SUPER_AGENT_FIXED_PROMPT_BUDGET` compte les textes **fixes** et n'est pas contourné |
| Lire le portrait à chaque message (8 Mio en base64) | `read_persona_identity` ne lit que trois petits fichiers texte — verrou de test explicite |
| Une fiche périmée bloque le démarrage | tout modèle écarté est remplacé par la chaîne de Pilot, avec une trace ; aucun `?` ni `expect` dans la lecture de la fiche |
| Un ancien `config.json` casse au chargement | `#[serde(default)]` sur le nouveau champ, vérifié par un test |
| Le réglage est perdu à chaque enregistrement des Options | `assistant_gender` est écrit dans l'objet sauvegardé (les Options réécrivent **toute** la configuration), verrou de test |
| Un genre imposé à l'utilisateur | défaut « non précisé » = aucune consigne ; une valeur inconnue retombe sur ce défaut |

---

## 7. Documentation mise à jour

- `spec_super_agent.md` : nouvelle section « Genre de l'assistant et modèle par personnage »
  (réglage, priorité, tolérance d'absence, trace affichée) + bloc d'aide intégrée
  `<!-- HELP:super-agent-genre-modele -->` régénéré (`npm run build:handbook`).
- `AGENTS.md` : arborescence complétée (deux modules ajoutés).
- `spec_pilot.md` : inchangé (aucun changement de pile ni de commande existante).
- `README.md` (documentation **utilisateur** de l'onglet ⚙️) : la liste des réglages des Options
  porte désormais le **genre de l'Assistant** — les trois valeurs, le défaut qui ne change rien,
  l'accord de **ce qu'il écrit comme de ce qu'il fait lire**, et la priorité du personnage actif.
- `spec_super_agent.md` : le titre du bloc d'aide est passé de « Le genre de la **voix** de
  l'Assistant » à « Le genre **grammatical** de l'Assistant », pour qu'on ne le confonde pas avec
  le **choix de la voix de lecture** (section « Lecture des réponses », réglage distinct) ; l'aide
  dit maintenant que l'accord couvre l'**écrit** et la **lecture à voix haute**.
- Ce rapport : `docs/rapports/RAPPORT-genre-et-modele-par-personnage.md`.
