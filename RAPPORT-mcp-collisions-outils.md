# Rapport — collisions de noms d'outils MCP

Mission : vérifier la dette documentée « collisions de noms d'outils » du mode
consommateur MCP, la corriger au plus juste si elle existe, la tester, et mettre
la documentation à jour.

**Conclusion en une phrase** : la collision de noms d'outils **entre deux
serveurs** telle que la doc la redoutait **n'existe pas** (une seule serveur MCP
est chargé par session d'agent), mais **deux cas réels d'ambiguïté de nom**
subsistaient juste à côté, silencieux tous les deux — les deux sont maintenant
**explicites**, sans changer un seul nom d'outil déjà en service.

---

## 1. Ce que la documentation affirmait (avant)

`spec_pilot.md` (section « Mode consommateur MCP »), dernière phrase de la
description du mode, une seule ligne jamais vérifiée :

> « Dette post-POC : collisions de noms d'outils. »

## 2. Constat sur le disque (preuve fichier:ligne)

### 2.1 Le format du nom, et où il était fabriqué (avant ma modification)

- `src-tauri/extensions/mcp-client.src.ts:168` (état HEAD) :
  `const serverId = server.id ?? server.name ?? "mcp";`
- `src-tauri/extensions/mcp-client.src.ts:256` (état HEAD) :
  ``const registeredName = `mcp_${serverId}_${toolName}`;``
- Même fichier, `:159-166` (état HEAD) : `enabledServers` puis **un seul**
  serveur retenu (`PILOT_MCP_SERVER` s'il est activé, sinon `enabledServers[0]`).

### 2.2 Pourquoi la collision entre DEUX serveurs est impossible

Le nom d'outil est `mcp_<id du serveur>_<outil>`. Une collision entre deux
serveurs exigerait que les outils des deux soient enregistrés **dans la même
session pi**. Or c'est structurellement impossible :

- l'extension ne retient **qu'un seul** serveur par session
  (`mcp-client.src.ts:178-185`, et **une seule** variable d'environnement
  `PILOT_MCP_SERVER`, posée par `src-tauri/src/agent_service.rs:3286-3296`) ;
- le choix est identique côté Rust : `src-tauri/src/mcp_config.rs:213-224`
  (`select_session_server` : `find(|s| s.id == t && s.enabled)`, sinon
  `cfg.servers.iter().find(|s| s.enabled)`), donc le premier activé gagne ;
- le comportement est verrouillé par un test Rust existant :
  `src-tauri/src/mcp_config.rs:1469-1472` (« Cible absente/désactivée → repli sur
  le premier serveur activé »).

À l'intérieur d'un seul serveur, le préfixe est **constant** : deux noms d'outils
distincts donnent forcément deux noms enregistrés distincts
(`registeredToolName` est injective à serveur fixé — testé). Donc **pas de
collision intra-serveur non plus** par ce chemin.

Les autres pistes de la mission, vérifiées une par une :

| Piste | Constat |
|---|---|
| Même identifiant de serveur déclaré deux fois | **Cas réel** (voir 2.3) |
| Identifiants qui se ressemblent (`a` / `a_b`) | Aucun effet : un seul serveur chargé ; le nom reste lisible (`mcp_a_b_c` est ambigu à la **lecture** pour un humain, mais un seul serveur peut le produire dans une session) |
| Nom d'outil contenant un séparateur | Idem : pas de collision, seul le découpage visuel est ambigu |
| Caractères interdits dans un nom d'outil | `pi.registerTool()` ne valide que le **schéma** des paramètres (`dist/core/extensions/loader.js:234-243` du paquet `@earendil-works/pi-coding-agent` installé) : un nom reste utilisé tel quel, donc pas de collision |
| Serveur renommé alors que l'agent garde l'ancien nom | Le nom d'outil utilise l'**identifiant** (`id`), pas le nom lisible : renommer l'affichage ne change aucun nom d'outil (testé). Un id devenu inconnu fait retomber sur le premier activé, mais les outils portent alors **l'autre** id (`mcp_<autre id>_…`) : le nom trahit le changement, rien n'est masqué |
| Deux serveurs activés en même temps pour un agent | Impossible : un seul serveur par session (2.2) |

### 2.3 Les deux cas d'ambiguïté qui EXISTAIENT (et étaient muets)

**(a) Deux entrées de `mcp.json` portant le même identifiant.**
Leurs outils porteraient **exactement** le même nom (`mcp_<id>_<outil>`), et
`select_session_server` retenait le **premier** sans un mot (`mcp_config.rs:219`).
Preuve du défaut, dans le test ajouté :
`registeredToolName(mcpServerId(A), "echo") === registeredToolName(mcpServerId(A′), "echo")`
alors que `A` et `A′` sont deux serveurs différents (commandes différentes).
Rien ne le disait : ni l'interface, ni `mcp_save_servers`
(`mcp_config.rs:424-431`, qui ne contrôle que l'URL d'un serveur distant), ni
l'extension (aucun message). L'agent lisait `mcp_mcp-1_echo` et **ne pouvait pas
savoir** lequel des deux serveurs répondait. Ce cas arrive par une config écrite
ou recopiée à la main (l'interface, elle, génère des ids uniques :
`src/js/mcp-utils.js`, `newServerId`).

**(b) Un serveur qui déclare deux fois le même nom d'outil dans `tools/list`.**
`pi` range ses outils dans une table **par nom** :
`extension.tools.set(tool.name, …)` (`dist/core/extensions/loader.js:239`), donc
le second enregistrement **écrasait** le premier **sans aucun message** — et le
`catch {}` de l'extension (`mcp-client.src.ts`, boucle d'enregistrement) aurait
de toute façon étouffé toute erreur. Un outil en remplaçait bien un autre en
silence.

---

## 3. Correction (au plus juste)

Aucune correction « cosmétique » : les deux cas ambigus deviennent **explicites**,
et **aucun nom d'outil en service ne change**.

1. **Source unique du nommage** — nouveau module pur
   `src/js/mcp-tool-names.js` (même famille que `mcp-utils.js` /
   `mcp-secret-scope.js` / `screen-guard.js` : bundlé dans l'extension par
   esbuild, testé en unitaire) :
   - `mcpServerId(server)` reproduit **à l'identique** la résolution historique
     `id ?? name ?? "mcp"` ;
   - `registeredToolName(serverId, toolName)` produit **exactement**
     `mcp_<id>_<outil>` (le format ne bouge pas) ;
   - `serverIdOwners` / `serverIdClashMessage` : deux serveurs **activés** de même
     identifiant ⇒ message qui **nomme les deux serveurs** et dit quoi faire ;
   - `duplicateToolNames` / `firstDeclarationOnly` / `duplicateToolNameMessage` :
     un outil déclaré deux fois ⇒ la **première** déclaration est conservée et le
     doublon est signalé.
2. **Extension MCP** (`src-tauri/extensions/mcp-client.src.ts`, puis fichier
   généré refait par `npm run build:mcp`) :
   - le nom vient désormais de `registeredToolName(...)` (plus de gabarit écrit à
     la main) ;
   - nouveau § « 2 quater » : si l'identifiant du serveur retenu est porté par
     **plus d'un** serveur activé, le chargement est **refusé** avec le message
     qui nomme les deux serveurs (fail-closed : aucun outil enregistré, donc
     aucun nom disputé). Un identifiant unique — le cas normal — n'est jamais
     concerné ;
   - le doublon d'outil est signalé et **la première déclaration gagne**.
3. Le fichier généré `src-tauri/extensions/pilot-mcp-client.ts` a été
   **régénéré** par `npm run build:mcp` (jamais édité à la main ; il est dans
   `.gitignore`).

Ce qui n'a **pas** bougé, volontairement : le format des noms (`mcp_<id>_<outil>`),
le choix du serveur (cible activée sinon premier activé), le transport, le
périmètre de la clé du coffre, la confirmation avant usage, le contrôle de
l'écran (`isScreenTool` reçoit le même `serverId` qu'avant) et le repli
fail-open de l'extension.

---

## 4. Test ajouté, et pourquoi il attrape le retour du défaut

`src/js/mcp-tool-names.test.js` — **15 tests**, sur la **logique de nommage**
(fonctions pures) plus un garde-fou de source ; aucune capture d'écran.

- **Anti-régression du format** : `registeredToolName("mcp-1","echo")` doit valoir
  `"mcp_mcp-1_echo"`. Si quelqu'un « améliore » le format (préfixe, séparateur,
  casse), ce test tombe → les consignes d'agents existantes ne peuvent pas être
  cassées en silence.
- **Le défaut d'origine est reproduit puis interdit** : deux serveurs de même
  identifiant produisent le **même** nom d'outil (assertion explicite) ; la
  détection doit alors renvoyer **2** propriétaires et un message contenant
  **les deux noms de serveurs** et l'identifiant. Si quelqu'un supprime la
  détection, `serverIdOwners` renvoie 1 et le test casse — c'est exactement le
  retour du défaut.
- **Pas de faux positif** : identifiants distincts, ou second serveur
  **désactivé** ⇒ message `null`. Si quelqu'un « corrige » en refusant tout, ce
  test casse.
- **Remplacement silencieux** : `firstDeclarationOnly` doit conserver la
  **première** déclaration (le test vérifie la description « première », pas
  seulement le nombre d'outils) ; `duplicateToolNameMessage` doit nommer le
  serveur, l'outil et le nom enregistré.
- **Branchement réel** : le test lit `mcp-client.src.ts` (fins de ligne
  normalisées, quality-gate § 3.4) et exige qu'il utilise
  `registeredToolName(...)`, `serverIdOwners(...)`, `duplicateToolNames(...)`,
  `firstDeclarationOnly(...)`, et qu'il ne contienne **plus** le gabarit
  `` `mcp_${serverId}_${toolName}` ``. Revenir à une fabrication manuelle du nom,
  ou débrancher la détection, fait échouer le test.

Vérifications lancées :

- `npx vitest run src/js/mcp-tool-names.test.js` → 15/15.
- `npm test` → **184 fichiers, 3219 tests, 0 échec**.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **775 réussis,
  0 échec, 1 ignoré** (aucun code Rust modifié ; le handbook embarqué a été
  régénéré).

---

## 5. Documentation mise à jour

- `spec_pilot.md` § « Mode consommateur MCP » : la ligne « Dette post-POC :
  collisions de noms d'outils » est **supprimée** et remplacée par la **règle
  réelle** (un seul serveur par session ⇒ pas de nom disputé entre serveurs ;
  format inchangé ; identifiant dupliqué ⇒ chargement refusé en nommant les deux
  serveurs ; outil déclaré deux fois ⇒ première déclaration seule, doublon
  signalé ; source unique `src/js/mcp-tool-names.js`).
- `spec_super_agent.md`, bloc d'aide intégrée `HELP:super-agent-mcp` : nouvelle
  puce **« Nom des outils exposés »** côté utilisateur (format, cas des deux
  serveurs de même identifiant, cas de l'outil annoncé deux fois), puis
  `npm run build:handbook` (le handbook généré est committé, il est embarqué par
  `include_str!`).
- `AGENTS.md` : la nouvelle source unique `src/js/mcp-tool-names.js` est décrite
  dans l'arborescence (une ligne), avec sa couverture de test.

Non modifiés, et pourquoi : `README.md` ne mentionne pas MCP du tout ;
`AGENTS.md` ne décrivait pas le nommage des outils MCP avant cette mission.

## 6. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src/js/mcp-tool-names.js` | **nouveau** — source unique du nommage + détection des ambiguïtés (pur) |
| `src/js/mcp-tool-names.test.js` | **nouveau** — 15 tests (logique de nommage + garde-fou de source) |
| `src-tauri/extensions/mcp-client.src.ts` | extension : nom via le module partagé, refus explicite si identifiant dupliqué, doublon d'outil signalé |
| `src-tauri/extensions/pilot-mcp-client.ts` | **régénéré** par `npm run build:mcp` (non versionné) |
| `spec_pilot.md` | dette retirée, règle réelle décrite |
| `spec_super_agent.md` | aide intégrée (bloc `HELP:super-agent-mcp`) |
| `help/handbook.md` | généré par `npm run build:handbook` |
| `AGENTS.md` | arborescence : `mcp-tool-names.js` |
| `RAPPORT-mcp-collisions-outils.md` | ce rapport |

Aucun code Rust, aucune commande Tauri, aucune migration : le comportement côté
backend (sélection du serveur, clé du coffre) est **inchangé**.
