# Rapport — mise en cohérence documentaire avant publication

- **Date** : 2026-10-21, 09:05 (heure locale de la machine)
- **Commit de départ** : `275eb04` — branche `main`, **5 commits en avance** sur `origin/main`
  (`3c67064`, tag `v0.4.35`, **seule version publiée**)
- **Périmètre** : **documentation seule**. Aucun fichier de code applicatif, aucun fichier de
  configuration, aucune version, aucun tag, aucun push. Les réserves A et B **ne sont pas
  corrigées** : elles sont **écrites**.
- **Protocole** : `.pi/skills/quality-gate/SKILL.md` (analyse avant modification, modification
  ciblée, tests **avant** commit). Tests lancés : `npx vitest run` → **2 091 verts, 0 échec**.
- **Ce que cette mission ne fait pas** : corriger L1/L2, publier, pousser, changer la version,
  lister les sessions d'agents (outil jamais appelé).

---

## 0. Résultat en une ligne

Les **deux contradictions doc ↔ code encore ouvertes** (C1, C2) sont **corrigées**, les **deux
réserves** de `rapport-relecture-finale.md` (A et B) sont **écrites et publiées dans la
documentation et l'aide intégrée** (§ 13 de `spec_super_agent.md` + bloc
`HELP:file-attente-limites`), la description du **nouveau comportement** (arrêt d'agent,
ordre d'arrivée) a été **vérifiée** — elle était déjà juste, elle n'a **pas** été réécrite —,
l'aide intégrée est **régénérée** et la fiche de référence décrit désormais l'**état final**.

---

## 1. Vérification préalable (ne rien refaire)

Chaque point a été relu sur le disque **avant** d'être modifié, parce que la mission pouvait
rejouer une demande déjà traitée.

| Élément demandé | État constaté sur le disque | Action |
|---|---|---|
| Ordre d'arrivée décrit dans la doc | **déjà présent** : `spec_gestion_agents.md:48` (aide) et section technique « Ordre d'arrivée à l'admission (P1) » ; aide intégrée `help/handbook.md:1027` (motif ajouté par `4cf5356`) | **une seule retouche** (datation « à l'admission » + renvoi à la limite L1), pas de réécriture |
| Nouveau comportement de l'arrêt d'agent (P2) | **déjà présent** : `spec_super_agent.md:649-659` (`keepQueuedRunAgentsMissions`, `queue-kept`, `detected=stop-agent`, rejeu armé) et `:641-644` (délégations abandonnées) | **conservé tel quel** |
| Identité de projet unique (P3) | **déjà présent** : bloc `HELP:file-attente-identite-mission` (`spec_super_agent.md:662-710`), absent de l'aide générée car handbook non régénéré | **aucune réécriture** ; simple **régénération** de l'aide (§4) |
| Document « limites connues » existant | **aucun** trouvé (`spec_pilot.md`, `plan_dev.md`, `idees_evolutions.md` : rien) | **création** du § 13 dans `spec_super_agent.md` |

---

## 2. Contradictions documentaires corrigées

### 2.1 C1 — « `stop_agent` annule la file d'attente » (faux, deux fois)

**Avant** (aide utilisateur, `spec_super_agent.md:592`, texte encore publié dans la v0.4.35) :

> Un `stop_agent` **annule** la file d'attente.

**Après** (`:589-596` et section technique `:1515-1530`, mêmes faits) :

> Un `stop_agent` **abandonne la file des DÉLÉGATIONS** (`abandonQueuedDelegations`) : chaque
> demande abandonnée est **nommée**, consignée au journal du projet et annoncée. La file des
> **MISSIONS** (`run_agents` / `run_assistant_agents`) suit une règle **différente** : un arrêt
> d'agent ne la détruit **jamais**.

Preuves code (relues pour cette correction) :

| Fait | Preuve |
|---|---|
| Délégations abandonnées à l'arrêt | `src/js/super-agent.js:5420-5427` (`abandonQueuedDelegations`, `detected: "stop-agent"`) |
| Missions **conservées** (P2) | `super-agent.js:5436-5460` (`keepQueuedRunAgentsMissions`, rejeu armé) et `:801-834` (nommage, `queue-kept`) |
| File de l'Assistant : même règle | `super-agent.js:5462-5483` (`ASSISTANT_SPACE`) |

### 2.2 C2 — « Rejeu garanti / la file ne peut plus rester bloquée » (exagéré)

**Avant** (`:593-598`) :

> **Rejeu garanti de la file de missions (POINT G)** : … l'admission réelle (verrou du bus OU
> travail en cours) est surveillée périodiquement, donc la file ne peut plus rester bloquée.

**Après** (`:597-610` et `:1521-1531`) : le paragraphe décrit le mécanisme **réel** — admission
décidée par `decideMissionAdmission` (la **file est consultée avant tout lancement**), rejeu
réarmé à chaque empilement / après chaque arrêt / tant qu'il reste des missions, disponibilité
jugée sur les **sessions vivantes** (`isRunStillActive`) — **et** renvoie explicitement aux
**deux limites connues**, au lieu d'affirmer une garantie absolue.

Preuves code : `decideMissionAdmission` (`super-agent.js:618`) et ses **3** points d'appel
(`:4654`, `:4732`, `:4906`) ; `isRunStillActive` (`:959`) ; `armQueueReplay` (`:1021`).

### 2.3 C3 et C4 (rappel, sans réécriture)

- **C3** (délai d'inactivité « 5 min ») était **déjà corrigé** par `8aa8f0d` : rien refait.
- **C4** (phrase fausse sur les réservations dans `rapport-delai-inactivite.md`) **n'est pas
  réécrite** : un rapport daté est un instantané ; la doc de référence
  (`spec_orchestration_multiagents.md`) est, elle, exacte.

---

## 3. Les deux réserves, écrites et publiées

Elles ne sont **pas** corrigées (interdit de cette mission) : elles sont **déclarées**, avec
leur effet pour l'utilisateur, la preuve code, et le correctif **connu mais non appliqué**.

### 3.1 Où

| Emplacement | Contenu |
|---|---|
| `spec_super_agent.md` **§ 13 « Limites connues »** (nouveau) | **L1** et **L2**, version technique : lignes citées, effet, preuve, ce qui n'est **pas** couvert, correctif connu |
| `spec_super_agent.md` bloc `<!-- HELP:file-attente-limites -->` (nouveau) | version **utilisateur**, courte, sans jargon (« Deux limites connues, écrites noir sur blanc ») |
| `spec_gestion_agents.md` (aide, l. 48 + section P1) | renvoi explicite : la garantie d'ordre vaut **à l'admission**, la limite L1 est nommée |
| `help/handbook.md` (régénéré) | les deux textes arrivent dans l'**aide intégrée** (topic `file-attente-limites`) |

### 3.2 Réserve A → limite **L1** (ordre d'attente)

Énoncé retenu : *une mission **déjà sortie de file** qui ne peut pas démarrer repart **en queue**
au lieu de la tête* ; avec `[B, C]`, la file devient `[C, B]` ; **aucune perte, aucun doublon**
(même mission, même numéro, rejeu réarmé), attente supplémentaire ≤ 1 tour de rejeu (15 s).

Preuves : `launchQueuedMission` (`super-agent.js:1053`) → `isRunInProgress` (`:4722`) →
`decideMissionAdmission` (`:4732`) → `enqueueMissionForProject` (`:4741`) → `queue.push` (`:554`).
Cause : le rejeu juge sur les **sessions vivantes** (`isRunStillActive`, `:959`), l'admission sur
le **bus**. Échec de lancement, lui, remis **en tête** (`:1066`). **Aucun test** ne couvre ce cas.

### 3.3 Réserve B → limite **L2** (identité de projet partielle)

Énoncé retenu : *la file des **commandes manuelles** (`project-task-queue.js`) est encore indexée
par le **chemin brut***. Deux écritures du même dossier (« `G:\IA_PL\pilot` » et
« `g:/ia_pl/pilot/` ») → **deux** files ; `/file` peut ne pas voir — donc ne pas abandonner — les
commandes de l'autre écriture. **Aucune perte** : chaque commande démarre à son tour.

Preuves : `queueOf` (`project-task-queue.js:262-266`), lecture `:315`, abandon `:333`, sonde
`:443-448`. Les **autres** familles sont bien unifiées : `project-cle-unicite.test.js`
(4 écritures d'un même dossier → une file, un ordre, une réservation).

### 3.4 Ce que la rédaction évite

| Piège | Traitement retenu |
|---|---|
| Dramatiser | « Aucune perte, aucun doublon », « correctifs connus, **non appliqués** », « hors périmètre » : la limite est un **fait daté**, pas un incident |
| Masquer | Les deux limites sont dans l'**aide utilisateur** (pas seulement dans la spec technique) |
| Laisser croire que c'est corrigé | Le texte dit explicitement que L1/L2 **subsistent**, et cite le correctif **restant à faire** |
| Contredire l'aide « ordre d'arrivée respecté » | L'aide est datée « **à l'admission** » et renvoie à la limite |

---

## 4. Aide intégrée régénérée

| Étape | Commande | Résultat |
|---|---|---|
| Régénération (jamais d'édition manuelle) | `npm run build:handbook` | **43 blocs**, `help/handbook.md` = **200 759 octets** |
| Nouveau topic | — | `file-attente-limites` présent dans la liste des sujets |
| Vérification de disparition de l'ancien texte | `grep -n "annule\*\* la file\|Rejeu garanti" help/handbook.md` | **0 résultat** |
| Effet de bord **attendu** | — | le bloc `D3` (identité de projet, `4cf5356`… `275eb04`) déjà présent dans la spec arrive enfin dans l'aide : c'était une conséquence de l'absence de rebuild, pas une lacune de rédaction |
| Garde-fou doc ↔ code | `npx vitest run src/js/help-delai-inactivite.test.js` | **8 tests verts** (l'aide porte toujours la valeur réelle du timeout) |

---

## 5. Fiche de référence mise à jour (état final)

`fiche-reference-pilot.md` a été réécrite **dans son format** (tableaux sujet / valeur / preuve /
date), avec une **date de vérification** nouvelle (2026-10-21 **09:05**) :

| Section | Changement |
|---|---|
| §0 VERDICT | version **0.4.35** toujours publiée ; **0.4.36 non commencée** ; **5 commits locaux** ; `stop_agent` décrit avec le comportement **P2** ; contradictions : **0 ouverte** (C1, C2, C3 soldées) ; **2 limites connues** ; **2 091 tests verts** |
| §1 Version / dépôt | 5 commits listés, fichiers suivis modifiés = **documentation seule**, fichiers non suivis = **7** |
| §2 Réglages | file d'attente : renvoi corrigé à `armQueueReplay` (`:1021`), `decideMissionAdmission` (`:618`), `RUN_AGENTS_QUEUE_REPLAY_MS` (`:928`) ; `isRunInProgress` = `agents-bus.js:3159` |
| §4 `stop_agent` | **réécrit** : missions **conservées** (P2), délégations abandonnées, journal `queue-kept`, risque D2 **supprimé** |
| §5 | C1/C2 **corrigées**, C3 **corrigée ailleurs**, C4 inchangée, A1/A2 **ouvertes**, A3 **clarifiée**, nouveau § 5.4 = **L1 / L2** |
| §6 | lignes « faites » barrées + les **deux ambiguïtés restantes** (A1, A2) et la règle « handbook jamais édité à la main » |
| §7 | L1 « non prouvée en exécution » ajoutée ; journal à **16 lignes** |
| §8 / §9 | `rapport-relecture-finale.md` et `rapport-doc-finale.md` ajoutés ; **2 091 tests verts** / 124 fichiers ; handbook 43 blocs |

---

## 6. Fichiers touchés (tous documentaires)

| Fichier | Nature |
|---|---|
| `spec_super_agent.md` | C1, C2 (aide + section technique), tableau des traces (`queue-kept`), **§ 13 Limites connues** + bloc d'aide |
| `spec_gestion_agents.md` | aide « ordre d'arrivée **à l'admission** » + renvoi L1 ; paragraphe « Limite connue (L1) » dans la section P1 |
| `help/handbook.md` | **régénéré** par `npm run build:handbook` (jamais édité à la main) |
| `fiche-reference-pilot.md` | réécrite à l'**état final** |
| `rapport-doc-finale.md` | ce rapport |

**Aucun** fichier de code (`src/`, `src-tauri/`, `web/`, `scripts/`), **aucun** fichier de
configuration, **aucune** version (`package.json`, `Cargo.toml`, `Cargo.lock`,
`tauri.conf.json`) : `git diff --stat` ne montre que les trois fichiers de documentation suivis.

---

## 7. Tests exécutés (avant commit)

| Commande | Résultat |
|---|---|
| `npx vitest run` | **2 091 tests verts, 0 échec** (124 fichiers de test) |
| `npx vitest run src/js/help-delai-inactivite.test.js` | **8 verts** (garde-fou doc ↔ code) |
| `git diff --stat` | `help/handbook.md`, `spec_gestion_agents.md`, `spec_super_agent.md` — **documentation seule** |
| `cargo test` | **non lancé** : aucun fichier Rust touché (aucune justification à une compilation de 10 min) |

---

## 8. Ce qui reste ouvert (et qui n'est pas de cette mission)

| # | Sujet | Où c'est écrit |
|---|---|---|
| 1 | **L1** — mission défilée remise en **queue** (inversion d'ordre possible, sans perte) | `spec_super_agent.md` § 13.1 + aide |
| 2 | **L2** — file des **commandes manuelles** indexée par chemin brut | `spec_super_agent.md` § 13.2 + aide |
| 3 | **A1 / A2** — ambiguïtés de formulation (`max_calls_per_run` 20 vs 5, `4000 tokens`) | `spec_gestion_agents.md:140`, `:407` |
| 4 | **C4** — phrase fausse sur les réservations dans un rapport daté | `rapport-delai-inactivite.md` §2.2 |
| 5 | Publication d'une **0.4.36** contenant les 3 correctifs + la doc corrigée | `plan_dev.md` / procédure de release de `AGENTS.md` |

---

*Rapport écrit en lecture seule sur le code, le 2026-10-21 à 09:05, sur le commit `275eb04`
(5 commits en avance sur `origin/main` ; `v0.4.35` = `3c67064`). Aucun push, aucun tag, aucun
changement de version, aucune correction de L1/L2, aucun outil de listage des sessions d'agents.*
