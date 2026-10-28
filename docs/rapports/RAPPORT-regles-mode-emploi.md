# Deux règles de conduite des questions de mode d'emploi (réintroduites seules)

Micro-tâche : le retrait du second chemin de réponse sur la documentation
(commit `5cee50b`, rapport `RAPPORT-un-seul-chemin-doc.md`) avait emporté **deux
règles de conduite** qui n'ont rien à voir avec des fichiers. Ce lot les remet
dans le prompt de l'assistant, **sans** rouvrir le mécanisme de fichiers.

---

## 1. Vérification préalable sur disque : les deux règles étaient bien absentes

Relevé fait **avant** toute modification, sur la version de `HEAD` du fichier
portant le prompt (aucun chiffre recopié d'une demande) :

```bash
git show HEAD:src-tauri/src/super_agent.rs | grep -n "mode d.emploi\|délègue"
```

Résultat : **aucune** des constantes de prompt (`SUPER_AGENT_TOOLS_PROMPT`,
`SUPER_AGENT_RESILIENCE_PROMPT`, `SUPER_AGENT_AGENTSMD_PROMPT`,
`SUPER_AGENT_NO_WAIT_PROMPT`, `SUPER_AGENT_SCHEDULE_PROMPT`,
`SUPER_AGENT_SESSION_MEMORY_PROMPT`, `voice_guideline`) ne parle de **mode
d'emploi**. Les seules occurrences trouvées sont :

| Occurrence | Nature |
|---|---|
| ligne 8550 | **commentaire de test** (`/// … la réponse sur le mode d'emploi passe par l'outil`), pas du prompt ; |
| lignes 505, 533, 616 | « délègue / délégation » au sens **délégation de travail à un agent** (outils, supervision, mode coordinateur) — **pas** la règle « une question de mode d'emploi ne se délègue jamais ». |

⇒ Les deux règles annoncées par le rapport de retrait comme « plus énoncées »
l'étaient effectivement **plus** dans le prompt. Le constat du rapport est
confirmé sur le disque.

Les deux règles perdues :

1. une question de **mode d'emploi** reçoit une réponse **directe** — elle n'est
   **jamais** déléguée à un agent ;
2. une question de **mode d'emploi** **n'entre pas** dans la mémoire de suivi des
   projets.

---

## 2. Texte exact ajouté (bloc figé `SUPER_AGENT_HOWTO_PROMPT`, 307 caractères)

```
## Questions de mode d'emploi
Une question de mode d'emploi (comment faire dans Pilot) reçoit une réponse DIRECTE : tu y réponds toi-même, tu ne la délègues JAMAIS à un agent.

Une question de mode d'emploi n'entre PAS dans la mémoire de suivi des projets : elle ne crée ni tâche, ni décision, ni projet.
```

Ce que ce bloc **ne fait pas** :

- il ne nomme **aucun** fichier de documentation, **aucun** dossier, **aucun**
  chemin (ni `index.md`, ni dossier d'aide, ni commande de lecture) ;
- il n'ajoute **aucune** troisième règle : deux règles, c'est tout ;
- il ne réintroduit **rien** du mécanisme de fichiers (ni écriture au démarrage,
  ni consigne de lecture) ;
- il ne touche **ni** l'outil `answer_from_documentation`, **ni** son plafond
  d'appels, **ni** le socle `ask_help_doc` / `answer_from_handbook`.

**Branchement** : `assemble_super_agent_system_prompt` (source unique partagée par
l'envoi réel et les tests) l'insère **juste après** `SUPER_AGENT_NO_WAIT_PROMPT`
et avant le prompt personnalisé — donc dans le groupe des textes **fixes**
injectés à chaque message.

---

## 3. Taille du prompt et plafond, avant / après (mesurés, pas recopiés)

Mesure obtenue en exécutant le test de mesure par bloc et le garde-fou de budget
(`cargo test --lib super_agent_fixed_prompt_stays_under_budget -- --nocapture`)
sur les deux états :

| | Textes **fixes** du prompt (chars) | Plafond `SUPER_AGENT_FIXED_PROMPT_BUDGET` |
|---|---|---|
| **Avant** | **5 532** | 5 850 |
| **Après** | **5 839** | **6 150** |

- Le bloc ajouté pèse **307 caractères** mesurés (ligne « texte fige MODE
  D'EMPLOI : 307 caracteres »), soit exactement l'écart 5 532 → 5 839.
- Le plafond est **recalculé sur la mesure réelle**, selon la convention déjà en
  place (mesure + 5 %, arrondi au multiple de 50 supérieur) :
  5 839 × 1,05 = **6 130,95** → **6 150**.
- Le plafond reste donc **collé à la mesure** (307 caractères de marge utile) :
  il rougit encore si une consigne regonfle le prompt fixe.

---

## 4. Le garde-fou `assistant_prompt_designates_no_doc_files` reste vert — et mord

### Ce qui a dû changer dans le test (et pourquoi ce n'est pas un affaiblissement)

Le test vérifie deux choses : (a) aucun texte interdit de documentation, et (b)
le prompt complet (blocs dynamiques vides) est **exactement** la concaténation des
textes figés connus. L'ajout d'un bloc figé **légitime** obligeait donc à mettre à
jour cette liste de référence — c'est la seule modification faite :

- ajout de `super::SUPER_AGENT_HOWTO_PROMPT` dans la concaténation attendue
  (passage de 6 à 7 termes) ;
- ajout du même texte dans le total du test de mesure par bloc, avec sa ligne
  « MODE D'EMPLOI » (le total assemblé reste égal à la somme des blocs mesurés).

**Rien n'a été retiré ni assoupli** : la liste des textes interdits est
**inchangée** (`index.md`, « lisible sur disque », « un fichier par thème »,
« Ouvre-la avec `read` », « documentation ne laisse RIEN ») et l'égalité stricte
du prompt complet est **conservée**. Au contraire, l'égalité stricte est le filet
qui interdit toute insertion silencieuse : elle est maintenant plus serrée d'un
terme (le nouveau bloc est nominativement attendu, il ne peut pas être remplacé
par un bloc de doc reformulé).

### Preuve que le test mord encore (fait, pas supposé)

Injection **temporaire** d'un nom de fichier de doc dans l'assemblage du prompt,
exécution du test, puis restauration :

```
# injection : full_system.push_str("\n\n## Documentation\nTu peux lire index.md dans le dossier aide.\n");
cargo test --lib assistant_prompt_designates_no_doc_files
→ panicked at src-tauri\src\super_agent.rs:8598:13:
  le bloc de documentation est revenu dans le prompt (« index.md »)
```

Après restauration du fichier (sauvegarde binaire, aucune autre modification) :

```
cargo test --lib assistant_prompt_designates_no_doc_files
→ test result: 1 passed; 759 filtered out  (exit 0)
```

Contrôle final : `grep -c "index.md" src-tauri/src/super_agent.rs` → **2**, et les
deux occurrences sont **dans le test** (son commentaire et sa liste de textes
interdits) — aucune dans le prompt.

---

## 5. Comptes de tests, avant / après

| Mesure | Avant | Après |
|---|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **759** passed, 0 failed, 1 ignored (exit 0) | **759** passed, 0 failed, 1 ignored (exit 0) |
| `npx vitest run` | **3 113** passed, 0 failed (exit 0) | **3 113** passed, 0 failed (exit 0) |
| Textes fixes du prompt | 5 532 car. | **5 839 car.** (+307) |
| Plafond du prompt | 5 850 | **6 150** |

Aucun test ajouté ni retiré (le lot n'ajoute aucune fonctionnalité, seulement deux
règles de conduite) ; **aucun fichier JS n'a été touché** (les 3 113 tests JS sont
identiques avant/après, à la constante du corpus d'aide près — voir §6).

---

## 6. Documentation et aide intégrée

| Fichier | Ce qui a changé |
|---|---|
| `spec_help.md` | §4.6 : budget recalculé (5 532 → 5 839, plafond 6 150) et tableau des tests mis à jour ; **§4.7 ajouté** : les deux règles de conduite, leur bloc figé, et le rappel qu'aucun fichier n'est nommé (le second chemin reste retiré). |
| `spec_super_agent.md` | Plafond recalculé (6 150 / mesure 5 839) ; bullet « Réponse sur le mode d'emploi : UN SEUL chemin » corrigé (la règle « ne se délègue jamais » n'est plus « non réintroduite ») ; **nouveau bullet** décrivant les deux règles et leur bloc ; **bloc d'aide utilisateur** complété d'une courte section « Une question de mode d'emploi ». |
| `help/handbook.md` | **Régénéré** par `npm run build:handbook` (un bloc d'aide a changé) : **+7 lignes**, exactement la nouvelle section. Jamais édité à la main. |

`npm run build:handbook` → 45 blocs, 268 555 octets ; `git diff help/handbook.md`
ne contient **que** les 7 lignes ajoutées.

---

## 7. Ce qui n'a pas été touché (explicitement)

- L'outil `answer_from_documentation`, son plafond **d'un appel par tour**, son
  refus du 2ᵉ appel et sa réponse « la documentation ne dit rien » ;
- le socle Rust (`answer_from_handbook`, `ask_help_doc`, `ask_help`,
  `get_handbook`) et le corpus embarqué ;
- l'écriture de documentation au démarrage (reste retirée) ;
- les autres blocs du prompt (outils, résilience, AGENTS.md, supervision,
  schedule, voix, guidelines à bascule) : **aucune** ligne modifiée ;
- aucune fonctionnalité supprimée ni altérée.

VERDICT : les deux règles de conduite perdues (une question de mode d'emploi se répond directement et ne se délègue jamais à un agent ; elle n'entre pas dans la mémoire de suivi) sont réintroduites seules dans un bloc figé de 307 caractères qui ne nomme aucun fichier ni chemin — prompt fixe mesuré 5 532 → 5 839 caractères, plafond recalculé sur la mesure réelle 5 850 → 6 150, garde-fou anti-documentation toujours vert et prouvé mordant (injection temporaire d'un nom de fichier de doc → test rouge, puis restauré → vert), tests identiques avant/après (759 Rust + 3 113 JS, 0 échec), documentation et aide intégrée à jour.
