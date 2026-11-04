# Rapport — agent jetable par défaut (Assistant)

**Date** : 2026-11-15 · **Demande** : pour tout besoin ponctuel, l'Assistant doit
utiliser un **agent jetable** (décrit dans la demande) et réserver
`create_agent` aux **rôles durables**.

## 1. Le problème, en clair

La consigne qui pilotait la décision était **contradictoire** :

| Endroit | Texte avant | Effet |
|---|---|---|
| `super_agent.rs`, bloc « Outils d'agents » | « Tu disposes aussi de `create_agent(...)` (**agent sur mesure si nécessaire**) » | crée un agent permanent dès qu'aucun agent ne « convient » |
| `super_agent.rs`, mode coordinateur | « **Si aucun agent ne convient, crée-le d'abord avec `create_agent`**, puis lance. » | pousse explicitement à la création permanente |
| `pilot-assistant-actions.ts`, description de `create_agent` | « Créer un agent sur mesure … **quand les agents disponibles ne conviennent pas** » | même incitation, côté outil |
| `pilot-assistant-actions.ts`, guidelines `run_agents` | préférait déjà l'agent jetable | la seule consigne correcte, **contredite** par les trois autres |

Or l'Assistant **ne peut jamais supprimer** une entrée du registre (c'est le
propriétaire qui le fait) : chaque création inutile reste **visible chez lui**,
indéfiniment.

## 2. La source unique

Nouveau module **pur** (`src/js/`, aucun import, aucune I/O) :

**`src/js/agent-lifespan-rule.js`**

- `AGENT_LIFESPAN_RULE` — la consigne en clair, trois règles ordonnées :
  1. besoin **ponctuel** (diagnostic, analyse, vérification, rédaction de
     circonstance) → **agent jetable** via `agents` (nom + rôle) de
     `run_agents` / `run_assistant_agents` : **créé à la volée pour la seule
     durée de la tâche**, rien en base, aucune entrée dans la liste des agents,
     la définition disparaît à la fin (le travail reste) ;
  2. `create_agent` **RÉSERVÉ aux rôles DURABLES** ; « aucun agent du registre ne
     convient » n'est **pas** une raison suffisante ;
  3. dans le doute, **ne rien créer** : l'Assistant ne peut pas supprimer
     d'entrée du registre.
- `AGENT_LIFESPAN_RULE_GUIDELINE` — la même règle en une phrase, pour les
  consignes d'outils (anglais, langue des `promptGuidelines`).
- `AGENT_LIFESPAN_RULE_SNIPPET` — résumé court (`promptSnippet`).
- `decideAgentKind(need)` — décision **pure** : seul `need.durable === true`
  autorise `"create_agent"` ; tout le reste (dont le doute) donne
  `"throwaway"`.
- `findAmbiguousLifespanWording` + `AMBIGUOUS_LIFESPAN_MARKERS` — le verrou
  d'**ambiguïté** (voir § 5 bis) : il refuse les formulations qui laisseraient
  croire qu'un agent permanent est acceptable par défaut.

Aucune phrase de la règle n'est écrite ailleurs.

## 3. Les trois branchements (la règle est réellement utilisée)

1. **Prompt système** (`src-tauri/src/super_agent.rs`) :
   `include_str!("../../src/js/agent-lifespan-rule.js")` **embarque le fichier
   entier** ; `extract_agent_lifespan_rule` en extrait la consigne entre deux
   délimiteurs **contractuels** (`export const AGENT_LIFESPAN_RULE = ` + accent
   grave → accent grave + `;`) ; `agent_lifespan_rule_prompt()` compose le bloc
   `## Règle des agents — un agent jetable par défaut`, poussé **juste après**
   le bloc « Outils d'agents » par `assemble_super_agent_system_prompt`. Si
   l'extraction échoue, le bloc est **vide** — et les tests échouent (jamais de
   règle inventée par défaut).
2. **Outils de l'extension** (`src-tauri/extensions/pilot-assistant-actions.ts`) :
   le module est **importé** (`./agent-lifespan-rule.js`) ; la description de
   `create_agent`, ses `promptGuidelines`, celles de `run_agents` et de
   `run_assistant_agents` **citent** la source unique.
3. **Écriture sur disque** (`src-tauri/src/agent_service.rs`) :
   `AgentService::write_agent_lifespan_rule` dépose le module à côté des
   extensions, dans les **deux** chemins d'écriture (agents d'assistant et
   session de l'Assistant). Sans lui, l'import de l'extension casse : l'échec est
   **remonté** (`report.failures`), pas avalé.

## 4. Textes contradictoires supprimés / remplacés

- « Si aucun agent ne convient, crée-le d'abord avec `create_agent`, puis
  lance. » → « … applique la règle des agents (ci-dessus) : un besoin ponctuel se
  traite avec un agent **JETABLE** décrit dans la demande, jamais avec une
  nouvelle entrée permanente du registre. »
- « `create_agent(...)` (agent sur mesure si nécessaire) » → « `create_agent(...)`
  (RÉSERVÉ aux rôles DURABLES — voir la règle des agents ci-dessous) », et le
  bloc outils nomme désormais `agents` (« agent JETABLE décrit dans la demande »).
- Extension : « Use create_agent when the available agents do not fit the task »
  et « Créer un agent sur mesure … quand les agents disponibles ne conviennent
  pas » → supprimés ; la guideline commune est citée.

Le mode coordinateur (le plus incitatif à créer des agents) **renvoie** à la
règle au lieu de créer.

## 5. Verrous

**Front** — `src/js/agents-jetables-par-defaut.test.js` (16 tests, 100 % verts) :
règle en clair (trois règles), contrat d'extraction (une seule déclaration, pas
d'accent grave ni `${` — sinon Rust ne saurait plus extraire), décision pure
(le doute → jetable), extension qui **cite sans recopier**, injection réelle
dans l'assemblage (`push_str(&agent_lifespan_rule_prompt())`, mesuré ≥ 4 fois),
absence de texte contradictoire dans `super_agent.rs`, écriture sur disque dans
les deux chemins, et **ambiguïté** (§ 5 bis).

### 5 bis. Le verrou d'ambiguïté — une consigne qui ne peut plus se relâcher

Un verrou de présence (« la bonne phrase est là ») ne suffit pas : il laisse
passer une consigne qui **ajoute** une permission. La source unique porte donc
la décision inverse, **pure** :

- `AMBIGUOUS_LIFESPAN_MARKERS` — les fragments qui font croire qu'un agent
  permanent est acceptable **par défaut** : « si nécessaire » / « si necessaire »,
  « au besoin », « agent sur mesure », « aucun agent ne convient », « agents
  disponibles ne conviennent pas », « crée-le d'abord », « if needed », « when
  necessary », « do not fit the task ».
- `findAmbiguousLifespanWording(text)` — compare sans casse, sans accents et
  sans espaces superflus, et rend les marqueurs trouvés (vide = consigne nette).

Le test l'applique aux textes **réellement envoyés au modèle** : la consigne, la
consigne d'outil, le résumé, les blocs `create_agent` / `run_agents` /
`run_assistant_agents` de l'extension, le bloc « Outils d'agents » et le passage
du mode coordinateur de `super_agent.rs`. Trois garde-fous pour qu'il reste
utilisable :

1. **mutation** — six variantes fautives réelles (dont « agent sur mesure si
   nécessaire » et « Use create_agent when the available agents do not fit the
   task », les deux textes de l'incident) doivent être **détectées** ;
2. **non-régression inverse** — une consigne qui **déconseille** la création
   (« n'est PAS une raison suffisante… », « ne crée RIEN ») n'est **jamais**
   signalée : sinon le verrou serait désactivé à la première alerte inutile ;
3. **anti-vide** — les blocs contrôlés doivent être non vides, pour qu'un bloc
   vidé ne fasse pas passer le test en silence.

Éprouvé par mutation manuelle : en réinjectant « agent sur mesure si nécessaire »
dans `AGENT_LIFESPAN_RULE`, la suite **échoue** (« laisse les textes RÉELS du
dépôt sans ambiguïté ») ; restaurée, elle repasse verte.

**Rust** :
- `la_regle_de_l_agent_jetable_est_injectee_dans_le_prompt` (`super_agent.rs`) :
  extraction de la source unique, texte injecté **identique**, présence dans le
  prompt assemblé **avec et sans** mode coordinateur, aucune phrase interdisant
  encore la création dans le doute (littéraux formés par `concat!` pour ne pas
  réintroduire le texte interdit), bloc outils réservant `create_agent` aux rôles
  durables, extraction **fermée** (source sans délimiteur, consigne vide ⇒
  `None`).
- `write_agent_lifespan_rule_ecrit_la_source_unique` (`agent_service.rs`) : le
  fichier écrit est **exactement** la source unique, et reste extractible.
- `coordinator_guideline_imposes_delegation_and_names_both_agent_families`
  complété : le mode coordinateur ne doit plus pousser à créer un agent
  permanent et doit renvoyer à la règle.

**Garde-fou de budget du prompt** : `super_agent_fixed_prompt_stays_under_budget`
compte désormais le nouveau bloc ; mesuré **5 947 caractères** pour un plafond de
**6 150** — aucun relèvement nécessaire.

## 6. Documentation

- `spec_super_agent.md` : nouvelle section « Règle « agent jetable par défaut »
  (source unique, injectée) » (source, extraction, branchements, textes
  supprimés, verrous) ; point 1 de « coordinateur de la redistribution »
  réécrit (create_agent = rôles durables) ; deux passages (`run_assistant_agents`
  du mode coordinateur, « Méthode par défaut ») alignés.
- Bloc utilisateur `<!-- HELP:super-agent-agent-jetable -->` réécrit : l'agent
  jetable y est présenté comme **la façon par défaut** de travailler, avec la
  raison (« l'Assistant ne peut jamais supprimer une entrée de votre liste »).
- `AGENTS.md` : la ligne d'arborescence du nouveau module (source unique, trois
  branchements, verrous). Remarque de traçabilité : ce fichier portait déjà,
  **non committées**, deux lignes d'autres travaux en cours (mots de réveil,
  genre/modèle par personnage) ; elles partent donc avec ce commit — ce sont des
  lignes de documentation qui décrivent du code déjà présent sur le disque.
- `help/handbook.md` **régénéré** (`npm run build:handbook`, 48 blocs). Le
  fichier reste non committé par cette tâche : il portait déjà les blocs HELP
  d'autres travaux en attente (mots de réveil, genre/modèle par personnage).

## 7. Résultats des tests

Vérifiés à nouveau sur `main` après le durcissement du verrou :

```
npx vitest run                      → 5540 passés, 0 échec
cargo test --manifest-path src-tauri/Cargo.toml --lib
                                    → 900 passés, 3 ignorés, 0 échec
```

Le texte de la consigne gagne « créé à la volée pour la seule durée de la
tâche » (une quarantaine de caractères) : le garde-fou de budget du prompt
(`super_agent_fixed_prompt_stays_under_budget`) reste **vert**, aucun plafond
n'a été relevé.

## 8. Ce qui n'a pas été touché (interdits respectés)

- Aucun agent du registre créé, modifié ni supprimé ; aucune migration.
- La création d'agent **durable** justifiée fonctionne à l'identique : seuls les
  textes qui la **présentaient comme le réflexe par défaut** ont changé.
- Aucun bump de version, aucun tag, aucune release.
- Aucun refactor global : quatre fichiers de code touchés (un module pur
  nouveau, une extension, deux fichiers Rust), la logique d'exécution
  (`run_agents`, `create_agent`, agents jetables) est **inchangée**.
