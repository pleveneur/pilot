# Rapport — tâche 361 : extensions embarquées non remplacées à la mise à jour

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

## 3. Preuves (tests unitaires, répertoires temporaires, aucun `~/.pilot` touché)

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

Suite complète : voir §4 (résultats mesurés).

## 4. Résultats des suites (mesurés après le correctif)

- `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **646 passed, 1 ignored, 0 failed**
  (dont les 5 nouveaux tests de `extension_write`). Aucun avertissement résiduel
  sur les fichiers modifiés.
- `npm test` (Vitest) → **110 fichiers, 1893 tests passed, 0 failed**.

Les deux suites sont donc vertes. À noter : les comptes de référence annoncés
(559 Rust / 1796 JS) étaient antérieurs ; la base a grandi depuis, aucun test
n'a été désactivé, ignoré ou neutralisé par ce changement.

## 5. Limites honnêtes

1. **Racine non modifiable** : si le *dossier* lui-même est en lecture seule ou
   si le compte n'a pas le droit d'écrire dedans, aucune stratégie ne peut
   aboutir — le correctif ne fait que le **dire** (erreur explicite + journal)
   au lieu de le taire. Idem pour un fichier verrouillé par un autre processus
   avec partage exclusif : le renommage échoue et l'échec est remonté.
2. **Pas de test d'intégration Tauri** : les tests couvrent le module d'écriture
   (`extension_write`), pas les fonctions `spawn_*` qui exigent un `AppHandle`.
   Le branchement est vérifié par compilation + relecture ; son comportement de
   bout en bout n'est pas couvert par un test automatique.
3. **Windows non testé au-delà de la CI locale** : le retrait d'attribut est
   exercé par le test (a) sur la machine de développement Windows ; macOS et
   Linux utilisent le même code (`set_readonly(false)` → bit d'écriture) mais le
   test n'a pas été rejoué sur ces plateformes dans cette session.
4. **`probe_extension_support` faux** (backend sans support d'extensions) reste
   un cas silencieux légitime : aucune extension n'est attendue, donc aucun
   échec n'est signalé. Non changé volontairement.
5. **Course bénigne** : entre la suppression de la cible et le renommage il
   existe une fenêtre où le fichier n'existe pas. Elle n'est atteinte que sur un
   chemin déjà en échec (lecture seule), et le nom temporaire est unique ; deux
   lancements strictement simultanés peuvent donc se remplacer mutuellement,
   mais le contenu écrit est **le même** contenu embarqué, et la vérification
   finale détecte tout contenu différent.
