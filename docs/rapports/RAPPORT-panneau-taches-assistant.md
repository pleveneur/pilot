# Rapport — panneau « tâches en cours » : le texte affiché sous l'assistant

> Micro-tâche : le panneau (haut à droite) affichait sous l'**assistant** un
> extrait de son **prompt système** (« Si une tâche déléguée ou une action
> échoue… ») au lieu d'une phrase disant ce qu'il fait. Les agents de projet,
> eux, s'affichaient correctement.
>
> Ce rapport suit le travail : chaîne réelle établie AVANT de coder (étape 1),
> puis correction, tests, neutralisation / restauration.

---

## 1. Chaîne réelle du texte affiché (vérifiée sur le disque, pas reprise du diagnostic)

Numéros de ligne **avant** correction.

| # | Maillon | Preuve |
|---|---|---|
| 1 | Le tour de l'assistant est envoyé **comme un seul message** : prompt système complet + message utilisateur | `src-tauri/src/super_agent.rs:806` — `let full_message = format!("{}\n\n{}", full_system, message);` puis `:807` `{"type":"prompt","message": full_message}` |
| 2 | Le prompt système assemblé fait **≈ 5 000 caractères** (rôle + contexte projet + agents + outils + résilience + AGENTS.md + supervision + schedule + guidelines) | `super_agent.rs:708` `assemble_super_agent_system_prompt` ; mesuré : 4 984 car. (simulation, cf. §2) |
| 3 | `AgentService::send` calcule un « instantané » du prompt : au-delà de 600 caractères, il garde une **fenêtre de 600 car. qui démarre sur la première ancre trouvée** | `agent_service.rs:411` `fn prompt_snapshot`, `:430` `.find_map(\|anchor\| text.find(anchor))`, `:306` `PROMPT_SNAPSHOT_MAX_CHARS = 600` |
| 4 | Les ancres sont `["## Objectif", "Objectif :", "=== MISSION ===", "Tâche :"]` et `text.find(anchor)` accepte **n'importe quelle occurrence, y compris au milieu d'une phrase** | `agent_service.rs:312` |
| 5 | Le prompt de l'assistant contient `## Objectif` **au milieu d'une règle** : « L'enveloppe « ## Contexte/## Objectif/## Consignes/## Ce qu'il ne faut PAS faire » est ajoutée MÉCANIQUEMENT par Pilot » | `super_agent.rs:511` (`SUPER_AGENT_RESILIENCE_PROMPT`) |
| 6 | La fenêtre démarre donc **1 909 caractères** plus loin, à l'intérieur du bloc de règles | simulation, §2 |
| 7 | Le snapshot est publié tel quel : `entry["prompt"]` (+ `entry["resume"]` si une demande a fourni un résumé) | `agent_service.rs:2417` et suiv. |
| 8 | `get_agent_supervision` recopie `prompt` / `resume` | `src-tauri/src/dashboard.rs:1298` |
| 9 | Le front calcule le libellé : `resolveMissionLabel(resume, prompt)` → à défaut de résumé, `shortMission(prompt)` qui prend la **première ligne de contenu** de la fenêtre | `src/js/agent-activity.js:359` ; appelé en `:291`, `:604` (file), `:617` (attente) |
| 10 | Le libellé est rendu sous l'agent et le projet | `src/js/agent-activity.js:664` `renderMissionsPanelHtml` (`.sa-task-meta`) |

**Pourquoi les agents de projet sont corrects** : leur prompt vient de
`buildAgentPrompt` (`src/js/agents.js:218-242`) et place la mission derrière un
vrai bandeau `\n\n=== MISSION ===\n`, avec des titres `## Objectif` en **début de
ligne** ; l'ancre tombe donc sur la mission, pas dans un bloc de règles. Le
défaut est propre à l'assistant, dont le message **contient son prompt système
de règles entières**.

## 2. Reproduction chiffrée (avant correction)

Simulation fidèle des deux étages, avec les **constantes réelles** extraites de
`super_agent.rs` et la vraie fonction JS `shortMission` :

```
prompt système : 4984 car. ; message envoyé : 5051 car.
ancre prise : "## Objectif"   position (car.) : 1909

=== EXTRAIT CONSERVÉ (600 car.) ===
## Objectif/## Consignes/## Ce qu'il ne faut PAS faire » est ajoutée
MÉCANIQUEMENT par Pilot : n'insère que le contenu de la tâche.

Si une tâche déléguée ou une action échoue (échec EXPLICITE : compte-rendu reçu
— le silence n'est JAMAIS un échec), relance AU MOINS UNE FOIS en changeant
d'approche (autre agent, autre formulation, autre méthode, autre découpage) …

=== CE QUE LE PANNEAU AFFICHE ===
Si une tâche déléguée ou une action échoue (échec EXPLICITE : compte-rendu reçu
— le silence n'est JAMAIS un échec)…
```

C'est **mot pour mot** le symptôme rapporté.

## 3. Correction (à la bonne hauteur)

Trois corrections, toutes dans la **chaîne d'extraction / d'alimentation**, aucune
découpe cosmétique à l'affichage :

1. **Ancrage structurel (`agent_service.rs`)** — une ancre ne compte que si elle
   **commence une ligne** (début du texte, ou précédée d'un retour à la ligne,
   espaces/indentations tolérés). Une mention `## Objectif` **citée dans une
   phrase** de règle n'ancre plus rien. Vaut pour tous les agents ; les prompts
   de délégation, qui ont de vrais titres en début de ligne, sont inchangés.
2. **La mission de l'assistant, c'est sa demande (`super_agent.rs`)** — tout
   prompt envoyé à la session de l'assistant joint désormais son **résumé court**
   (`pilotResume`, déjà prévu pour cela) construit à partir de la **première
   ligne utile du message** : ce que l'assistant a réellement à traiter, jamais
   ses règles. Le champ est retiré avant écriture vers pi (contrat existant).
3. **Repli honnête (`agent-activity.js`)** — pour l'assistant sans résumé
   exploitable, l'affichage ne réinterprète plus son prompt : il dit une chose
   neutre et vraie (`travail en cours`). Les agents de projet gardent leur
   comportement exact.

## 4. Résultats — avant / après (simulation sur les constantes réelles)

Script jetable (supprimé depuis, jamais committé) qui relit les constantes du
prompt dans `super_agent.rs`, applique l'extraction puis la **vraie** fonction JS
`resolveMissionLabel`, dans l'ancien réglage puis dans le nouveau :

```
=== AVANT ===
prompt système : 4984 car. ; message envoyé : 5051 car.
ancre prise : "## Objectif"   position (car.) : 1909
panneau affiche :   Si une tâche déléguée ou une action échoue (échec EXPLICITE :
                    compte-rendu reçu — le silence n'est JAMAIS un échec)…

=== APRÈS ===
ancre en début de ligne : aucune → fenêtre à la position : 0
la fenêtre contient une règle ? false
avec la mission jointe    : Peux-tu me faire le point sur les tâches en cours du projet GDS ?
sans mission (repli)      : travail en cours
agent de projet (inchangé): afficher la tâche réelle.
```

## 5. Neutralisation puis restauration (les tests mordent-ils vraiment ?)

Chaque correction a été **défaite exprès**, test relancé, puis **restaurée**.

### 5.1 Neutralisation de l'ancrage en début de ligne (`agent_service.rs`)

Retour à `text.find(anchor)` (n'importe quelle occurrence) :

```
cargo test --manifest-path src-tauri/Cargo.toml --lib -- prompt_snapshot_never_anchors_inside_the_assistant_rules
→ FAILED. 0 passed; 1 failed
  panicked at src-tauri/src/agent_service.rs:5856:
  la fenêtre ne doit pas reprendre une règle de l'assistant :
  ## Objectif/## Consignes/## Ce qu'il ne faut PAS faire » est ajoutée MÉCANIQUEMENT
  par Pilot : n'insère que le contenu de la tâche.

  Si une tâche déléguée ou une action échoue (échec EXPLICITE : compte-rendu reçu),
  relance AU MOINS UNE FOIS en changeant d'approche.…
```

C'est **exactement** le symptôme rapporté : le test tombe sur la règle.

### 5.2 Neutralisation du repli neutre côté affichage (`agent-activity.js`)

Suppression de la seule ligne `if (kind === "superagent") return MISSION_ASSISTANT_FALLBACK;` :

```
npx vitest run src/js/agent-activity.test.js
→ PASS (98) FAIL (1)
  panneau des tâches — l'assistant n'affiche JAMAIS ses règles ›
  sans résumé : repli NEUTRE et VRAI, jamais un extrait des règles
  AssertionError: expected 'Tu es « Magnus », l\'assistant de sui…' to be 'travail en cours'
```

### 5.3 Restauration

Les deux fichiers restaurés à l'identique (`prompt_snapshot` de nouveau ancré sur
`find_anchor_at_line_start`, branche `superagent` rétablie) :
`agent-activity.test.js` → **PASS (99) FAIL (0)**, et la suite Rust complète
repasse au vert (chiffres ci-dessous).

## 6. Tests ajoutés (et ce qu'ils interdisent)

**Rust — `src-tauri/src/agent_service.rs`**
- `prompt_snapshot_never_anchors_inside_the_assistant_rules` : sur un message de
  la forme réelle de l'assistant (prompt système contenant la règle
  « … « ## Objectif/## Consignes » est ajoutée MÉCANIQUEMENT par Pilot … » PUIS
  la demande), la fenêtre conservée **ne contient aucun fragment de règle**.
- `mission_anchor_must_start_a_line` : citation dans une phrase → **aucune**
  ancre ; vrai titre de section → ancre, position en caractères ; indentation
  tolérée ; ancre vide ignorée ; une 1re occurrence en pleine phrase n'empêche
  pas la bonne.

**Rust — `src-tauri/src/super_agent.rs`**
- `mission_resume_comes_from_the_request_not_from_the_system_prompt` : le
  `message` envoyé est **rigoureusement identique** (prompt non modifié), et
  `pilotResume` est la **demande**, sans aucun fragment de règle.
- `mission_resume_is_none_without_a_usable_request` : message vide / blancs /
  décoration seule → **aucun** résumé inventé (pas de champ) ; décoration de tête
  retirée ; plafond 120 + coupe sur un mot.

**JS — `src/js/agent-activity.test.js`**
- « affiche la DEMANDE portée par l'assistant » (résumé fourni) : forme de
  l'entrée inchangée.
- « sans résumé : repli NEUTRE et VRAI, jamais un extrait des règles » :
  `mission === "travail en cours"`, **aucun** fragment de règle (ni dans la
  donnée, ni dans le HTML rendu).
- « ne change RIEN pour un agent de projet » : `buildRunningMissions` avec
  `kind: "agent"` est **strictement égal** (deep-equal) au résultat historique
  sans `kind`, et vaut l'objectif extrait du prompt.

## 7. Chiffres réels des suites

```
$ npm test
 Test Files  159 passed (159)
      Tests  2742 passed (2742)

$ cargo test --manifest-path src-tauri/Cargo.toml --lib
 test result: ok. 721 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out
```

## 8. Documentation mise à jour (même commit)

- `spec_super_agent.md` :
  - item **4** ajouté à la liste « RÉSUMÉ COURT FOURNI AVEC LA DEMANDE » :
    l'assistant, dont le `prompt` n'est **jamais** interprété ;
  - bullet « Alimentation du texte de mission (Rust) » précisé : un marqueur ne
    compte que **s'il commence une ligne** (`find_anchor_at_line_start`) ;
  - nouveau bullet « **Mission de l'Assistant** » : les points d'envoi passent par
    `superagent_prompt_command`, message envoyé **inchangé**.
- Nouveau bloc `<!-- HELP:super-agent-panneau-taches -->` (ce que dit la ligne
  sous un agent, dont l'assistant) puis `npm run build:handbook` → `help/handbook.md`
  régénéré (45 blocs).

## 9. Périmètre respecté

- **Prompt de l'assistant non modifié** : `SUPER_AGENT_*` intacts ; seul le
  champ additif `pilotResume` accompagne la commande (il est retiré avant
  l'écriture vers pi, contrat déjà testé).
- **Agents de projet** : aucun code de leur extraction n'est changé (le test
  deep-equal le verrouille).
- Aucune autre mission touchée ; aucun bump, tag, publication, installation ni
  lancement de l'application ; aucun rapport d'une autre mission modifié ou
  committé.
