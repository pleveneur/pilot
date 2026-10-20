# Rapport — tâche 361 : extensions embarquées non remplacées à la mise à jour

> **Statut de livraison** : le code et la documentation sont posés (commit
> `007e827`), puis cette passe a ajouté la journalisation des dossiers
> d'extensions inutilisables (§2.3). **Aucun test et aucune compilation n'ont été
> exécutés** — voir §4 « Non vérifié ».

## 1. Constat (défaut réel, cause identifiée)

Les extensions pi embarquées (`src-tauri/extensions/*.ts`, générées par
`scripts/build-mcp-extension.js` pour la partie MCP) sont écrites sur disque à
chaque lancement de session, dans `<app_data_dir>/extensions/`, puis passées au
processus pi via `--extension`.

Le motif utilisé partout dans `agent_service.rs` était :

```rust
if std::fs::write(&file, content).is_ok() {
    extensions.push(file.to_string_lossy().to_string());
}
```

Deux défauts :

1. **Échec avalé.** `is_ok()` jette l'erreur. Aucun journal, aucun retour à
   l'appelant. L'utilisateur ne voit rien.
2. **Fichier périmé conservé.** Si l'écriture échoue (fichier resté en
   **lecture seule** — cas classique après une copie de sauvegarde, un outil de
   sync, ou un antivirus qui pose l'attribut — ou fichier verrouillé), l'ancien
   contenu reste sur disque mais **n'est pas** ajouté à la liste des
   extensions : la session démarre avec **une extension en moins**, en silence.
   C'est exactement la forme de l'incident 0.4.31 (assistant sans ses outils de
   lancement d'agents).

Le défaut était présent dans **tous** les chemins de lancement qui écrivent des
extensions : `spawn_session` (agent standard), `spawn_agent_process` (agents
multi-rôles et `run_agents`), `spawn_superagent_session` (Assistant 🧭),
`spawn_assistant_session` (agents d'assistant, tâche #140),
`spawn_group_assistant_session` (assistant de groupe), plus
`write_laya_extension` (qui utilisait `.ok()?`, encore plus silencieux).

## 2. Correctif

### 2.1 Nouveau module `src-tauri/src/extension_write.rs`

Écriture fiabilisée, avec une stratégie ordonnée et **vérifiée** :

1. **Contenu déjà identique** sur disque → aucune écriture (`WriteOutcome::Unchanged`) :
   pas de verrou pris, pas de date de modification touchée.
2. **Écriture directe** (`std::fs::write`).
3. Échec → **retrait de l'attribut lecture seule**
   (`Permissions::set_readonly(false)` + `set_permissions`) puis **nouvelle
   tentative**. C'est portable : sous Windows cela retire
   `FILE_ATTRIBUTE_READONLY`, sous Unix le bit d'écriture du mode.
4. Échec → **fichier temporaire voisin** (même dossier, donc renommage sans
   traversée de système de fichiers, nom unique par `pid`+compteur atomique+
   nanosecondes) puis **suppression de la cible** et **renommage**.
   On ne renomme **pas** par-dessus une cible en lecture seule : ce n'est pas
   garanti partout — d'où la suppression explicite préalable. Les fichiers
   temporaires sont supprimés sur tous les chemins d'échec.
5. **Vérification finale** : relecture du fichier et comparaison octet à octet
   avec le contenu embarqué. Un succès n'est jamais annoncé sans preuve.

API :

- `write_embedded(path, content) -> Result<WriteOutcome, String>` : message
  d'erreur explicite et cumulatif (chaque tentative ratée est conservée dans le
  message final, on sait donc *pourquoi*).
- `write_embedded_batch(dir, files) -> BatchReport` : un lot, avec
  `paths` (fichiers **réellement à jour** — un fichier en échec n'y figure
  JAMAIS), `failures` (`nom : raison`) et `unchanged`. Chaque échec est aussi
  journalisé (`eprintln!`).

### 2.2 Branchement dans `agent_service.rs`

| Chemin de lancement | Avant | Après |
|---|---|---|
| Agents d'assistant (#140) | 12 `fs::write().is_ok()` | `write_embedded_batch` + `face-gateway.js` via `write_embedded` ; **échec = session NON lancée** avec message nommant les fichiers |
| Agent standard (`spawn_session`) | 6 écritures silencieuses | lot fiabilisé + journal des échecs |
| Agents multi-rôles / `run_agents` | 6 écritures silencieuses | lot fiabilisé + journal des échecs |
| Assistant 🧭 (`spawn_superagent_session`) | 12 écritures silencieuses | lot fiabilisé + journal des échecs |
| Assistant de groupe | 1 écriture silencieuse | lot fiabilisé + journal |
| Service Laya (`pilot-laya.ts` + `laya-gateway.js`) | `.ok()?` → `None` muet | `Result<String, String>` remonté, échec journalisé |
| Skill `quality-gate` (`spawn_session`) | `fs::write().is_ok()` | `write_embedded` + journal |

Choix de gravité, assumé et différencié :

- **Agents d'assistant** : échec = **lancement refusé**. C'est le chemin de
  l'incident 0.4.31 ; y tourner sans ses outils de délégation casse
  l'orchestration de façon opaque. Un message explicite vaut mieux qu'un agent
  silencieusement infirme.
- **Tous les autres chemins** : la session démarre, mais **jamais avec un
  fichier périmé** (le chemin fautif n'est pas transmis) et l'échec est
  **journalisé** (`[extensions] <contexte> : écriture incomplète, session lancée
  SANS les fichiers périmés — …`). Bloquer une session d'édition pour un
  `pilot-choices.ts` non écrit serait une régression d'usage pire que le défaut.

Cas normal (écriture simple, fichier inscriptible) : **comportement inchangé**,
à une différence près — un contenu identique n'est plus réécrit du tout (moins
d'écritures disque, aucune date de modification artificiellement modifiée).

### 2.3 Dossier d'extensions inutilisable (complément de la relecture)

Si `create_dir_all(<app_data>/extensions)` échouait, la session démarrait **sans
la moindre extension**, toujours en silence : `if create_dir_all(&dir).is_ok()`
n'avait pas de branche `else`. C'est la même famille de défaut que l'écriture
avalée. Les **quatre** chemins concernés — agent standard, agents multi-rôles /
`run_agents`, Assistant 🧭, assistant de groupe — journalisent désormais
`[extensions] <contexte> : dossier d'extensions inutilisable (<chemin>) — session
lancée SANS extensions`. Le chemin des agents d'assistant remontait déjà
l'échec (`dossier d'extensions inutilisable` ajouté aux `failures`, donc session
refusée). Aucun changement de comportement : uniquement la fin du silence.

## 3. Tests unitaires écrits (NON exécutés — voir §4)

`src-tauri/src/extension_write.rs` (module `#[cfg(test)]`, `TempDir` auto-nettoyé) :

- `fichier_en_lecture_seule_est_remplace` — **(a)** un fichier réellement mis en
  lecture seule (assertion préalable sur `permissions().readonly()`) contenant
  `ANCIEN CONTENU PERIME` est **remplacé** ; le contenu relu est le nouveau et
  n'est plus l'ancien.
- `echec_ecriture_est_remonte_et_nettoie` — **(b)** cible impossible à écrire
  (un **dossier** à la place du fichier) : `write_embedded` retourne une `Err`
  non vide, la cible n'est pas altérée et **aucun `.tmp`** ne reste sur disque.
- `contenu_identique_n_est_pas_reecrit` — **(c)** contenu identique sur un
  fichier en lecture seule → `Unchanged`, **date de modification inchangée** et
  fichier toujours en lecture seule (preuve qu'aucune écriture n'a eu lieu).
- `lot_remonte_les_echecs_sans_exposer_le_fichier_perime` — le lot signale
  l'échec, le nomme, et **n'expose pas** le chemin du fichier non écrit (donc
  impossible de le passer en `--extension`) ; le fichier en lecture seule du
  même lot est bien mis à jour.
- `lot_idempotent_ne_reecrit_rien` — second passage : `unchanged == 2`, mêmes
  chemins, aucune réécriture.

Suite complète : **non exécutée** à ce stade — voir §4.

## 4. Non vérifié (état honnête)

**Aucun test n'a été exécuté, et aucune compilation n'a été lancée, dans la passe
qui livre ce correctif.** La mission de livraison interdisait explicitement
`cargo build`, `cargo check`, `cargo test`, `npm test` et `npm run build` : les
tentatives précédentes avaient été interrompues pendant la phase de vérification,
et la priorité était de sécuriser le code déjà écrit par un commit.

Ce qui n'est donc **pas** prouvé à ce stade :

- `cargo test --manifest-path src-tauri/Cargo.toml --lib` — **non exécuté**. Les
  cinq tests de `extension_write` (§3) sont écrits ; leur résultat est inconnu.
- `npm test` (Vitest) — **non exécuté** (le correctif est en Rust, aucun impact
  attendu côté JS, mais ce n'est pas vérifié).
- La **compilation** du crate n'a pas été rejouée : signatures, appels et imports
  ont été vérifiés **par lecture** du code, pas par le compilateur.
- Aucun nombre de tests n'est mesuré. Tout chiffre qui aurait été annoncé
  auparavant doit être considéré comme **périmé** et re-mesuré.

Reste à faire, dans une mission dédiée **sans modification de code** :

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --workspace
npm test
```

Critère de succès : les cinq tests de `extension_write` passent, les suites
restent vertes, et le test (a) — fichier réellement en lecture seule remplacé —
passe bien sous Windows.

## 5. Limites honnêtes

1. **Racine non modifiable** : si le *dossier* lui-même est en lecture seule ou
   si le compte n'a pas le droit d'écrire dedans, aucune stratégie ne peut
   aboutir — le correctif ne fait que le **dire** (erreur explicite + journal)
   au lieu de le taire. Idem pour un fichier verrouillé par un autre processus
   avec partage exclusif : le renommage échoue et l'échec est remonté.
2. **Pas de test d'intégration Tauri** : les tests couvrent le module d'écriture
   (`extension_write`), pas les fonctions `spawn_*` qui exigent un `AppHandle`.
   Le branchement n'est vérifié que **par relecture** (la compilation n'a pas été
   relancée dans cette passe) ; son comportement de bout en bout n'est couvert
   par aucun test automatique.
3. **Windows / macOS / Linux non vérifiés en exécution** : le retrait d'attribut
   (`set_readonly(false)` → `FILE_ATTRIBUTE_READONLY` sous Windows, bit
   d'écriture sous Unix) est le même code partout, mais le test (a) — le seul qui
   l'exerce — **n'a pas été exécuté**.
4. **`probe_extension_support` faux** (backend sans support d'extensions) reste
   un cas silencieux légitime : aucune extension n'est attendue, donc aucun
   échec n'est signalé. Non changé volontairement.
5. **Course bénigne** : entre la suppression de la cible et le renommage il
   existe une fenêtre où le fichier n'existe pas. Elle n'est atteinte que sur un
   chemin déjà en échec (lecture seule), et le nom temporaire est unique ; deux
   lancements strictement simultanés peuvent donc se remplacer mutuellement,
   mais le contenu écrit est **le même** contenu embarqué, et la vérification
   finale détecte tout contenu différent.
