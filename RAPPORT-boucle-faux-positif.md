# Rapport — faux positif du détecteur de boucle (sessions d'agents tuées)

Correctif ciblé. Périmètre **JavaScript uniquement** (`src-tauri/` non modifié),
sujet volontairement borné : pas de refonte du détecteur, pas de changement de
seuils.

---

## 1. Symptôme

Une session d'agent (ici le `codeur` du projet `pilot`) est **arrêtée
automatiquement** au bout d'une dizaine de millisecondes, en plein travail
normal, avec `stopReason=aborted` et le message « L'agent a tourné en boucle
(répétition du même texte ou des mêmes appels d'outils). Agent arrêté. ».
L'agent venait d'enchaîner **trois modifications différentes du même fichier**
(`agent_service.rs`).

## 2. Cause racine (tranchée, preuves à l'appui)

`buildToolLoopFingerprint` (`src/js/loop-detection.js`) construisait
l'empreinte d'un `edit` **avec le seul chemin du fichier** : `oldText`/`newText`
n'entraient jamais dans la clé.

Chaîne exacte du faux positif :

1. `buildToolLoopFingerprint("edit", { path: "…/agent_service.rs", edits: [...] })`
   → `tool::edit::…/agent_service.rs` (**identique** pour les trois appels, quel
   que soit le contenu réellement écrit).
2. `detectRepeatedToolCalls([...])` (`minRepeat = 3` par défaut) → `true` dès le
   3ᵉ `edit` consécutif sur le même fichier.
3. `maybeDetectInvisibleAgentLoop` (`src/js/super-agent.js`) → `loop.stopped = true`.
4. `stopInvisibleAgent(agentId, projectPath)` → `stop_agent_session` → session
   tuée (≈ 12 ms après le déclenchement), run perdue.

**Preuve reproductible** (fournie par le propriétaire, rejouée telle quelle) :

- `C:\Users\pldistance\.pilot\assistant\rapports\preuves\loopdata-codeur-2026-10-20.json`
  — 34 empreintes réelles de la session `codeur` du 2026-10-20 (03:28Z) ;
- `C:\Users\pldistance\.pilot\assistant\rapports\preuves\replay-loop-detection.mjs`
  — rejoue ces empreintes et le flux de texte dans les **vrais** détecteurs du
  produit.

Résultat du rejeu (constaté) :

| Détecteur | Résultat |
|---|---|
| `detectRepeatedBlock` | false |
| `detectRepeatedWord` | false |
| `detectSemanticLoop` | false |
| `detectRepeatedActions` | false |
| **`detectRepeatedToolCalls`** | **true ← cause de l'arrêt** |

Les empreintes fautives (index 0-based de la fixture) :

```
#25  tool::write::…\src-tauri\src\extension_write.rs
#30  tool::edit::…\src-tauri\src\agent_service.rs     ← 03:29:53Z
#31  tool::edit::…\src-tauri\src\agent_service.rs     ← 03:29:58Z
#32  tool::edit::…\src-tauri\src\agent_service.rs     ← 03:30:00Z
```

Trois `edit` **différents** (patchs distincts) → trois empreintes **identiques**
→ boucle « détectée ». `write` (index 25) souffre du même défaut : l'empreinte
ne dépend pas du contenu écrit.

## 3. Correctif 1 — l'empreinte inclut le contenu écrit (`loop-detection.js`)

`buildToolLoopFingerprint` ajoute, pour tout appel qui **porte du contenu
d'écriture**, une empreinte de ce contenu :

```
tool::edit::<chemin>::content=<longueur>:<hash 16 hex>
```

- Champs de contenu reconnus (aucune liste d'outils codée en dur, donc tout
  outil d'écriture qui passerait par cette fonction est couvert : `edit`,
  `write`, `create`, `patch`, `apply_patch`, `multiedit`…) :
  `edits` (tableau d'objets `{oldText,newText}` ou `{old_string,new_string}`),
  `content`, `newContent`/`new_content`, `newText`/`new_text`,
  `oldText`/`old_string`, `patch`, `diff`, `text`.
- Hash **déterministe** (deux lanes 32 bits, sans dépendance externe) + longueur
  du contenu : 3 écritures différentes → 3 empreintes différentes ; 3 écritures
  identiques → même empreinte (une vraie boucle reste détectée).
- Même emplacement que les correctifs précédents du même genre (`offset`/`limit`
  de `read`, `query` de `search/grep`) : la branche contenu est évaluée **après**
  `offset` et **avant** `query`, et le comportement historique « chemin seul »
  est conservé quand aucun contenu n'est fourni (aucun test existant cassé).
- Effet strictement **monotone** : le contenu ne peut que *retirer* des
  détections, jamais en ajouter (deux empreintes qui étaient identiques et qui
  diffèrent maintenant par le contenu étaient deux écritures différentes = pas
  une boucle ; deux écritures identiques gardent la même empreinte).

## 4. Correctif 2 — uid de session transmis à l'arrêt (`super-agent.js`)

`stopInvisibleAgent` construit désormais sa commande d'arrêt via une fonction
pure (`buildAgentStopRequest`) :

- **uid connu** → `stop_agent_process` avec `expectedUid` : c'est la commande
  dont la documentation (`agents.rs`) prévoit la **garde de propriété** pour les
  arrêts automatiques. Si la session en place n'est plus celle qui était suivie,
  l'arrêt est **REFUSÉ** : on ne tue pas la session d'une autre exécution, et
  l'arrêt effectif (`stop_agent_session`) n'est alors **pas** émis ;
- **uid inconnu** → `stop_agent_session` (chemin historique, indispensable : il
  porte la libération de l'activité du projet — issue #13 / tâche 335 — que
  `stop_agent_process` ne fait pas).

Le suivi d'agent invisible porte l'uid (`startInvisibleAgentMonitoring(...,
{ sessionUid })`) et le transmet à l'arrêt.

**Limite technique constatée, hors périmètre de ce correctif** : côté
JavaScript, l'uid n'est **pas lisible** aujourd'hui pour ce chemin. La commande
qui démarre la session invisible (`start_agent_session`, `rpc.rs`) retourne un
`bool` ; seule `start_agent_process` (`agents.rs`) retourne l'uid
(`.map(|_| session_uid(...))`). Aucune autre commande ne l'expose. Le correctif
transmet donc l'uid **dès qu'il est connu** (plomberie prête et testée) et
retombe sinon sur le chemin historique, sans régression. Pour que la garde
s'engage systématiquement sur ce chemin, il faudra exposer l'uid dans le retour
de `start_agent_session` — modification **Rust**, explicitement hors périmètre
de cette intervention.

## 5. Correctif 3 — le motif de chaque arrêt automatique est journalisé

Nouveau journal disque, en append logique (lecture + réécriture via les
commandes existantes `create_file` / `read_file_content` /
`write_file_content` — aucune commande Rust nouvelle, même mécanique que
`.pilot/screen-actions.log`) :

```
<projet>/.pilot/agent-stops.log
```

Une ligne par arrêt automatique, style `clé=valeur` séparé par deux espaces
(comme le journal des actions écran) :

```
2026-10-20T03:30:00.123Z  op=auto-stop  reason=loop-detection  detected=tool-calls  agent=codeur  project=G:\IA_PL\pilot  uid=none
```

- `reason` : cause de l'arrêt (`loop-detection`) ;
- `detected` : détecteur réellement déclenché (`tool-calls`, `text`) — le motif
  n'est plus confondu avec « répétition du même texte » ;
- `uid` : uid transmis (`none` quand inconnu, cf. § 4).
- Rotation simple (cap 256 Ko, on garde la fin du fichier), valeurs assainies
  (retours à la ligne aplatis, longueur bornée), **fail-open** : une trace qui
  ne peut pas être écrite ne bloque jamais l'arrêt.

Le motif est aussi journalisé pour les arrêts automatiques du **bus d'agents**
(`agents-bus.js`, boucle d'outils / boucle de réflexion), qui n'écrivaient
jusqu'ici la cause qu'en mémoire (`loopAbortReason`).

## 6. Tests (Vitest, nouveau fichier `src/js/loop-detection-content.test.js` — 24 tests)

| Test | Attendu |
|---|---|
| (a) 3 `edit` **différents** sur le même fichier | empreintes distinctes, `detectRepeatedToolCalls` → **false** |
| (b) 3 `edit` **identiques** | même empreinte, `detectRepeatedToolCalls` → **true** |
| (b') idem pour `write` (contenu) | contenu différent → false, contenu identique → true |
| (c) suite réaliste longue (dizaines d'appels variés, séquence réelle de la fixture anonymisée : `read` à offsets différents, `bash`, `write`, `edit` successifs) | aucune boucle |
| (d) motif écrit dans la trace | `buildAgentStopTraceLine` contient `reason=loop-detection` + `detected=` ; `appendAgentStopTrace` ajoute la ligne, gère l'absence de fichier et la rotation |
| (e) `buildAgentStopRequest` | uid connu → `stop_agent_process` + `expectedUid` ; uid absent/invalide → `stop_agent_session` |

## 7. Tests existants adaptés

Aucun test existant n'a eu besoin d'être neutralisé. Les tests d'empreintes
existants portent sur `bash`, `read` (+ `offset`/`limit`), `db_query`,
`run_agents` et « chemin seul sans offset » : tous ces cas **ne portent pas de
contenu d'écriture**, leur empreinte est donc inchangée (vérifié par la suite
`npm test` complète). Aucun test n'assertait la forme exacte d'une empreinte
`edit`/`write`.

## 8. Anti-régression

- Correctif limité à `src/js/` (`loop-detection.js`, `agent-stop-trace.js`,
  `super-agent.js`, `agents-bus.js`) ; aucun fichier Rust, aucun seuil, aucune
  refonte.
- `npm run build:handbook` relancé (nouveau bloc `HELP:loop-detection-writes`
  dans `spec_super_agent.md`) ; `AGENTS.md` mis à jour (nouveau module).
- `npm test` (Vitest) lancé avant chaque commit.
- Aucun `git push`/tag/publication, aucun `reset`/`checkout`/`clean`, aucune
  donnée du propriétaire touchée, `~/.pilot/agents.json` non modifié.
- `start_agent_session`, le suivi d'onglet, la restitution de fin de run, la
  file d'attente des délégations et les autres détecteurs sont inchangés.

## 9. Hors périmètre (suivi proposé)

1. Exposer l'uid de session dans le retour de `start_agent_session` (Rust) pour
   que la garde de propriété s'engage systématiquement sur le chemin invisible.
2. Unifier le journal des arrêts avec `agent-ops.log` (Rust) le jour où une
   commande d'append existe côté IPC.
