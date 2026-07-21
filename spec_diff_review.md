# Spec — Diff Review Agent (A4)

> Porte pré-écriture : avant chaque modification de fichier par l'agent, Pilot
> affiche un diff (avant/après) et demande **Accepter** / **Refuser**. Si refusé,
> l'outil est bloqué et le fichier n'est **jamais touché**. Composant partagé
> avec C1 (Git intégré).

## 1. Objectif

Sans porte, l'agent écrit les fichiers à l'aveugle et l'utilisateur subit les
changements. A4 **intercepte les outils `write`/`edit` avant exécution** (via une
extension pi qui bloque `tool_call`), affiche un diff **avant** que le fichier ne
soit modifié, et n'autorise l'écriture que sur **Accepter**. Si **Refuser**,
l'outil est bloqué (`{block:true}`) → le fichier reste intact. C'est cohérent :
aucune modification n'arrive sur le disque tant que l'utilisateur n'a pas accepté.

## 2. Paramètre global

- Champ config `confirm_file_edits` (bool, **désactivé par défaut**).
- UI : Paramètres → « Porte pré-écriture : confirmer les modifications de fichiers ».
- **Désactivé** : l'extension n'est pas chargée — l'agent écrit librement, zéro
  surcharge, zéro blocage (comportement historique).
- **Activé** : l'extension `pilot-edit-gate` est chargée au prochain spawn de pi
  (hot-restart de l'agent au changement du paramètre, session préservée).
- **Mode Orchestration** : auto-approve systématique (le codeur est autonome, la
  porte bloquerait le pipeline). La porte ne s'applique qu'au chat interactif.

### 2.1 Compatibilité backend (sonde `--extension`)

La porte pré-écriture repose sur l'extension pi `pilot-edit-gate` chargée via le
flag CLI `-e`/`--extension`. Certains backends (ex: **plh**, réimplémentation
Rust de pi) ne supportent **pas** ce flag : clap rejette l'arg inconnu et le
processus sort immédiatement → « pipe closed (os error 232) » côté Pilot.

Pilot sonde donc la capacité du backend (`probe_extension_support` dans `lib.rs` :
exécute `<pi_path> --help` et vérifie la présence de `--extension`, résultat
**mis en cache** par `rpc_pi_path` — re-sondé si le chemin change). 

- Si `confirm_file_edits` est activé mais le backend ne supporte pas `--extension` :
  - le flag `-e` **n'est pas passé** (pas de crash) ;
  - la checkbox Paramètres est **désactivée + décochée** + une note « Non supporté
    par ce backend (plh n'accepte pas `--extension`) » s'affiche ;
  - `state.confirmFileEdits` est forcé à `false` côté JS (le gate ne se déclenche
    jamais, l'agent écrit librement).
- La sonde est bloquante mais bornée (~3s) et n'est appelée que quand le gate est
  activé → zéro coût pour les utilisateurs qui n'utilisent pas la porte.

## 3. Architecture — extension pi + protocole RPC

### 3.1 Extension `pilot-edit-gate.ts` (bundlée via `include_str!`)

`src-tauri/extensions/pilot-edit-gate.ts`, écrite au démarrage dans le dossier
data de l'app puis passée à pi via `-e <path>` **uniquement si le paramètre est
activé**.

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "write" && event.toolName !== "edit") return;
  // before = readFileSync(path)   (non-racy : l'outil n'a pas encore tourné)
  // after  = input.content (write) | appliquer input.edits (edit)
  const ok = await ctx.ui.confirm("…", "PILOT_EDIT_GATE::" + JSON.stringify({tool, path, before, after}));
  if (!ok) return { block: true, reason: "Modification refusée (Pilot edit gate)" };
});
```

- `tool_call` se déclenche **avant** l'exécution de l'outil et **peut bloquer**.
- `ctx.ui.confirm()` en RPC émet `extension_ui_request` (method `confirm`) et
  **bloque pi** jusqu'à la réponse `extension_ui_response` du client.
- Le `message` transporte un sentinel `PILOT_EDIT_GATE::` + JSON `{tool, path,
  before, after}` (before/after tronqués à 200 Ko).
- Imports type-only → effacés par jiti, **aucune dépendance npm** requise.

### 3.2 Côté Pilot (`agent-pi.js`)

`handleExtensionUiRequest` intercepte le sentinel dans les `confirm` et appelle
`handleEditGateConfirm(id, json, container, state)` :

1. Parse le JSON. Si malformé → auto-allow (ne pas casser l'agent).
2. `gateActive = state.confirmFileEdits && !state.orchestrationRunning`.
   - `!gateActive` → répond `confirmed: true` (auto-approve, orchestration).
   - `gateActive` → rend un dialogue `renderEditGateDialog` (diff + ✓ Accepter /
     ✗ Refuser). Au clic : répond `confirmed: true/false` (+ `cancelled`).
3. Le dialogue est attaché à la bulle assistant courante.

### 3.3 Rendu (`diff-view.js`)

- `computeLineDiff(before, after)` : LCS ligne à ligne (Myers simplifié), fallback
  naïf > 4000 lignes. Troncation à 200 lignes affichées.
- `renderEditGateDialog({relPath, toolName, before, after, onDecision})` : bloc
  `.agent-diff-review.agent-edit-gate` (accent ambré = en attente de décision),
  boutons ✓ Accepter / ✗ Refuser. **Aucune restauration disque** (le fichier n'a
  pas été modifié — contrairement au V1 post-hoc qui reversait via `write_file_content`).
- `renderDiffBlock` / `applyReject` : conservés pour C1 (Git) et un éventuel
  mode post-hoc futur.

## 4. Outils couverts

- `write` (`{path, content}`) → after = content.
- `edit` (`{path, edits: [{oldText, newText}]}`) → after = remplacements successifs.
- Création (before = null) → diff tout-vert. Suppression (after = null) → tout-rouge.
- **`bash`** : hors périmètre (peut toucher n'importe quel fichier sans path dans
  les args). L'extension ne hook que `write`/`edit`.

## 5. Cycle (gate activée)

```
LLLM décide write/edit
  → tool_execution_start (bloc outil « running »)
  → tool_call [extension] : read before, compute after, ctx.ui.confirm (BLOQUE pi)
  → extension_ui_request (confirm, sentinel) → Pilot
  → Pilot : renderEditGateDialog (diff) + boutons
  → utilisateur clique
  → extension_ui_response (confirmed true/false) → pi
  → si true  : l'outil s'exécute (fichier modifié)
  → si false : {block:true} → l'outil ne s'exécute PAS (fichier intact)
  → tool_execution_end
```

## 6. Limites / évolutions

- **Pas de toggle live sans restart** : l'extension est chargée au spawn. Le
  hot-restart au changement de paramètre préserve la session (quelques secondes).
- **Pas de per-hunk** : Accepter/Refuser porte sur l'outil entier (pas sélection
  de hunks individuels). Per-hunk = évolution.
- **Bash non couvert** (voir §4).
- **Web distant** : l'UI web ne gère pas `extension_ui_request`. La porte est une
  feature desktop ; en usage remote-only, ne pas activer le paramètre (sinon pi
  reste bloqué en attente d'une réponse que le web ne fournit pas).

<!-- HELP:diff-review -->
## Porte pré-écriture (confirmer les modifications de l'agent)

Par défaut, l'agent Pi modifie les fichiers librement. Activez **Paramètres →
« Porte pré-écriture : confirmer les modifications de fichiers »** pour qu'avant
chaque `write`/`edit`, Pilot affiche un **diff (avant/après)** et vous demande :

- **✓ Accepter** : l'outil s'exécute, le fichier est modifié.
- **✗ Refuser** : l'outil est bloqué, le fichier **n'est pas touché**.

Le diff est calculé avant l'écriture (le fichier est intact pendant la décision).
En **Mode Orchestration**, la confirmation est automatique (le codeur est
autonome). Le changement du paramètre relance l'agent à chaud (session préservée).
<!-- /HELP:diff-review -->