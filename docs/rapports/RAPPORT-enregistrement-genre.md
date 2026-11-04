# RAPPORT — Enregistrement du chantier « genre de l'Assistant » et « modèle par personnage »

**Date** : 2026-11-04
**Objet** : enregistrer dans le dépôt le chantier des tâches **402** (genre grammatical de
l'Assistant) et **403** (modèle par défaut porté par la fiche du personnage), sans rien casser et
sans y mêler un autre sujet.
**Rapport de livraison** (ce que le lot fait, et pourquoi) :
`docs/rapports/RAPPORT-genre-et-modele-par-personnage.md`. Ce document-ci ne décrit que
l'**enregistrement**.

---

## 1. État constaté en ouvrant le dépôt

Le chantier était **déjà présent sur le disque ET déjà enregistré** au moment de cette
micro-tâche : le relevé du dépôt ne montre **aucune** modification en attente (ni modification,
ni suppression, ni fichier non suivi). Il est réparti en trois commits, tous dédiés à ce sujet :

| Commit | Contenu |
|---|---|
| `6bdbb0d` | **Le code du chantier** : modules purs (`assistant-genre.js`, `assistant_identity.rs`), extension de `persona.rs` (genre + modèle de la fiche), branchements (`lib.rs`, `settings.js`, `index.html`, `main.js`, `super-agent.js`), verrous (`genre-et-modele-par-personnage.test.js`), specs (`spec_super_agent.md`, `AGENTS.md`), aide intégrée (`help/handbook.md`), rapport de livraison |
| `df328d2` | **Ce que l'utilisateur doit comprendre** : `README.md`, la section du `spec_super_agent.md` qui devient le bloc d'aide « genre et modèle par personnage », et le **verrou de bout en bout** côté Rust (`le_genre_regle_apparait_dans_le_prompt_construit`, dans `super_agent.rs`) |
| `6456359` | **Rapport de vérification** du point 2 (`docs/rapports/RAPPORT-reglages-assistant.md`) |

**Conclusion** : il n'y avait **rien à committer** pour le code. Le travail de cette micro-tâche a
donc été de **vérifier l'intégrité** du chantier (rien d'oublié, rien d'étranger, tout compile et
tout passe), de **régénérer l'aide intégrée pour comparer**, de **relancer les deux suites** pour
donner des chiffres réels, et d'écrire ce rapport.

---

## 2. Liste exacte des fichiers qui appartiennent à ce chantier

### Créés par le chantier

| Fichier | Rôle |
|---|---|
| `src/js/assistant-genre.js` | Décisions **pures** de la fenêtre : clé unique `assistant_gender`, trois valeurs seulement (`""` non précisé, féminin, masculin), normalisation tolérante (casse/accents, valeur inconnue ⇒ « non précisé »), libellés, aller-retour sans perte. **Aucune phrase de genre n'y est composée** |
| `src-tauri/src/assistant_identity.rs` | **Seule autorité** des deux réglages : phrase de genre (vide par défaut) et priorité des modèles (fiche du personnage → modèle choisi → réglage dédié → défaut global), avec trace lisible en cas de repli |
| `src/js/genre-et-modele-par-personnage.test.js` | Verrou front du chantier (constantes, normalisation, présence des branchements Rust/JS/HTML, non-régression du défaut) |

### Étendus par le chantier (parties concernées uniquement)

| Fichier | Partie concernée |
|---|---|
| `src-tauri/src/persona.rs` | Lecture de `genre.txt` et `modele.txt` dans la fiche du personnage (`read_persona_identity`, `read_persona_identity_from_sources`), champs `gender` / `model` **additifs et optionnels** |
| `src-tauri/src/lib.rs` | `mod assistant_identity;`, champ de configuration `assistant_gender` (`#[serde(default)]`), valeur par défaut vide |
| `src-tauri/src/super_agent.rs` | Bloc d'identité dans la construction du prompt, `assistant_session_model` comme **point unique** du modèle effectif (session vivante **et** chemin bloquant), trace `pilot-assistant-model-trace`, verrou de bout en bout |
| `src/js/settings.js` | Champ lu **et enregistré** (sinon il serait perdu à chaque enregistrement de la configuration), aux trois endroits où la configuration est relue |
| `index.html` | `<select id="setting-assistant-gender">` et son intitulé (Options → Assistant) |
| `src/js/main.js` | Écoute unique de la trace du modèle au démarrage (`initAssistantModelTraceWatch`) |
| `src/js/super-agent.js` | Affichage de la trace dans le volet « Événements » de l'onglet 🧭 |
| `spec_super_agent.md` | Section du réglage + bloc d'aide `<!-- HELP:super-agent-genre-modele -->` |
| `README.md` | Ce que l'utilisateur voit et règle (langage utilisateur) |
| `AGENTS.md` | Description de `assistant-genre.js` et de `assistant_identity.rs` (structure et règle) |
| `help/handbook.md` | **Généré** depuis les blocs `HELP` : n'est jamais édité à la main |

---

## 3. Vérifications de cohérence (avant de conclure)

| Point vérifié | Résultat |
|---|---|
| Le réglage est-il **lu et écrit** côté configuration Rust ? | Oui : `assistant_gender: String` avec `#[serde(default)]`, valeur par défaut vide (comportement historique inchangé) |
| Le champ de la fenêtre est-il **lu et enregistré** dans `settings.js` ? | Oui : présent à la lecture (3 endroits) **et** à l'écriture, toujours normalisé |
| « Non précisé » ne change-t-il **rien** ? | Oui : `assistant_identity_block("", "") == ""`, donc prompt identique ; verrou Rust + verrou front |
| Le personnage passe-t-il **avant** le réglage général ? | Oui : `effective_assistant_gender(fiche, réglage)` puis le réglage, à un seul endroit |
| La fiche du personnage est-elle lue **sans imposer** le portrait ? | Oui : `read_persona_identity` (lecture légère, fail-open) ; le portrait reste le chemin séparé de `persona.rs` |
| Une fiche au modèle **absent ou mal formé** empêche-t-elle le démarrage ? | Non : repli sur la chaîne de Pilot + trace lisible dans le volet « Événements » |
| Les **deux** chemins de démarrage de l'Assistant utilisent-ils la même décision ? | Oui : `assistant_session_model` (session `AgentService` et appel bloquant hérité) |
| Y a-t-il des **restes d'un autre sujet** dans ces commits ? | Non : les cinq fichiers mixtes ne contiennent que des hunks de ce chantier (vérifié bloc par bloc sur `settings.js`, `main.js`, `index.html`, `lib.rs`, `super_agent.rs`) |
| L'**aide intégrée** est-elle à jour ? | Oui : `npm run build:handbook` a été relancé → `help/handbook.md` **identique** (aucun diff), 48 blocs, et le topic `super-agent` contient bien « genre grammatical » et « modèle propre à chaque personnage » |
| Le code **compile**-t-il ? | Oui : `cargo test --workspace` construit puis exécute toutes les suites, code de sortie 0 |

---

## 4. Chiffres réels des tests (exécution du 2026-11-04)

### Front (Vitest) — `npm test`

```
Test Files  300 passed (300)
     Tests  5594 passed (5594)
  Duration  17.66 s
```
Code de sortie : **0**.

### Rust (workspace complet) — `cargo test --workspace`

```
cargo test: 1075 passed, 14 ignored (6 suites)
```
Code de sortie : **0**. Détail par paquet :

| Paquet | Résultat |
|---|---|
| `pilot` (lib, desktop) | 902 passed, 3 ignored |
| `gds-core` | 139 passed, 11 ignored |
| `gds-server` | 34 passed |
| `pilot` (binaire `main.rs`), doc-tests | aucun test |

> Les 14 tests ignorés sont les **preuves réelles** qui demandent un service ou un matériel
> (`#[ignore]`), inchangées par ce chantier.

### Tests ciblés sur le chantier

| Périmètre | Résultat |
|---|---|
| `genre-et-modele-par-personnage.test.js` + `assistant-persona.test.js` | **32 passed**, 0 échec |
| Rust `assistant_identity` | 8 passed |
| Rust `persona` | 22 passed |
| Rust filtre `genre` (identité + verrou de prompt) | 8 passed |

---

## 5. Ce qui a été laissé de côté, et pourquoi

| Laissé de côté | Pourquoi |
|---|---|
| Les commits de **version** et de **publication** (`063a53b` bump 0.6.17, `4b287a5` rapport de publication) | Autre sujet. La consigne interdit de toucher à un numéro de version, à un tag ou à une publication : **rien n'a été modifié** de ce côté |
| Les **rapports de campagne** (`RAPPORT-reglages-assistant.md`, `RAPPORT-*.md` des points 1 et 3) | Autres sujets, déjà enregistrés par leurs propres commits |
| Le projet **Présences** (`G:\IA_PL\Presences`) | Interdit par la consigne : **aucune écriture**, aucun fichier touché |
| Aucun test existant | Aucun test supprimé, aucun test modifié |
| `assistant-persona.js` | **Volontairement inchangé** : le genre et le modèle de la fiche sont consommés **côté Rust** (`read_persona_identity`), le module JS ne transporte que le nom et le portrait. Rien à brancher, donc rien à modifier |

**Ce qui reste en attente sur ce chantier à la fin de cette micro-tâche : RIEN.** Le seul ajout de
cette tâche est ce rapport.

---

## 6. Enregistrement

Un commit unique, documentaire, sans aucun changement de code ni de version :
`docs(rapport): enregistrement du chantier genre et modèle par personnage`.

Il ne contient que ce fichier. Le dépôt est **propre** après ce commit : plus aucune modification
en attente sur ce chantier, ni sur aucun autre.
