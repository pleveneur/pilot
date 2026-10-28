# RAPPORT — l'Assistant active / désactive un serveur MCP nommé (depuis la conversation)

Date : 2026-10-28 · Projet : `G:\IA_PL\pilot` · Branche : `main` (tête `069b6c3` + ce lot)

## 1. Demande

L'Assistant (onglet 🧭) savait seulement **lire** l'état MCP (`mcp_state`) et
**désigner** un serveur pour une run ponctuelle (`run_agents(mcp_server)`).
Pour changer le serveur réellement branché, il fallait passer par **Paramètres →
Serveurs MCP**. Demande : qu'il puisse **activer ou désactiver un serveur nommé
directement depuis la conversation**, en suivant le motif existant, sans effet
de bord silencieux, sans toucher à aucun autre réglage, et avec des tests.

## 2. Ce qui existait (à préserver)

| Élément | Emplacement | Statut |
|---|---|---|
| Outils de l'Assistant (sentinel + `ctx.ui.input`) | `src-tauri/extensions/pilot-assistant-actions.ts` | **inchangé**, deux outils ajoutés |
| Interception des sentinels dans l'assistant | `src/js/super-agent.js` (handlers ~7500-7800) | **inchangé**, une branche ajoutée |
| Commandes MCP | `src-tauri/src/mcp_config.rs` (`mcp_list_servers`, `mcp_save_servers`, `mcp_set_enabled`, `mcp_set_agent_confirm`, `mcp_set_secret_strict`, `mcp_set_screen_guard`, `mcp_get_state`, `mcp_test_connection`) | **toutes intactes** |
| Règle « un seul serveur branché par session » | `select_session_server` (côté Rust, spawn) | **inchangée** — c'est elle que l'activation exclusive respecte |
| Non-fuite des secrets dans les sorties | `mcp_config.rs` `mod tests` (E8) | **inchangé**, un test de plus |

Aucune voie nouvelle n'a été créée : la chaîne est **exactement** celle de
`open_project` / `delegate_to_coder` / `mcp_state`.

## 3. Ajouts

### 3.1 Extension pi — deux outils

`src-tauri/extensions/pilot-assistant-actions.ts`

- `MCP_SERVER_TOGGLE_SENTINEL = "PILOT_ASSISTANT_MCP_SERVER::"` (l. 50).
- `mcp_enable_server` (l. 353) — paramètre unique `server` (`Type.String`),
  `executionMode: "sequential"`, `promptSnippet` (l. 357) et `promptGuidelines`
  (l. 359) qui portent les quatre garde-fous : identifiant découvert par
  `mcp_state`, **activation EXCLUSIVE qui DÉSACTIVE les autres**, effet à la
  **PROCHAINE session**, **ne supprime aucun serveur**, ne touche ni au client
  MCP, ni à la confirmation requise, ni aux secrets ; et la règle de
  confirmation (**c'est l'Assistant qui demande `ask_confirm`**, l'outil
  applique).
- `mcp_disable_server` (l. 380) — symétrique, `enabled: false`, précise
  qu'aucun autre serveur n'est activé d'office et qu'aucun serveur n'est
  supprimé (réactivable à tout moment).
- Les deux outils émettent `ctx.ui.input(SENTINEL + JSON { server, enabled })`
  (l. 371 et l. 398) → **aucun autre canal**, le résultat revient par le
  mécanisme de réponse existant ; `result == null` (délai 2 min) donne un
  message d'annulation dédié.

### 3.2 Décision + application — module dédié

`src/js/mcp-server-toggle.js` (nouveau)

- Constantes partagées : `MCP_SERVER_TOGGLE_SENTINEL` (l. 30),
  `MCP_SET_SERVERS_ENABLED_COMMAND`, `MCP_GET_STATE_COMMAND`,
  `MCP_NEXT_SESSION_NOTE` (l. 39), `MCP_NO_OTHER_SETTING_NOTE` (l. 43).
- Pures : `normalizeMcpServerId`, `mcpServerLabel`, `findMcpServer` (égalité
  exacte puis insensible à la casse), `knownServerIds`,
  **`planMcpServerToggle` (l. 128) — SEUL endroit qui connaît l'exclusivité** :
  elle rend les changements à écrire, `disabledOthers` (serveurs coupés,
  **nommés**) et `wasEnabled` ; un serveur déjà dans l'état demandé ne produit
  **aucune** écriture ; un identifiant inconnu ou absent rend
  `{ ok: false, reason }` avec un message qui nomme l'identifiant refusé **et
  les serveurs connus**, sans exception.
- `mcpToggleAnswer` / `mcpToggleSystemMessage` : une ligne par changement, qui
  dit l'exclusivité, nomme les serveurs coupés et rappelle la prochaine session.
- `applyMcpServerToggle` (l. 249) : LIT l'état (`mcp_get_state`), décide, ÉCRIT
  (`mcp_set_servers_enabled`) **seulement si** la liste de changements est non
  vide. Lecture impossible / écriture refusée / écriture en échec → `ok: false`
  + message, **jamais d'exception remontée**.

### 3.3 Assistant — branchement et visibilité

`src/js/super-agent.js`

- Import du module (l. 240-242) ; `MCP_SERVER_TOGGLE_SENTINEL` (l. 6765) ;
  empreinte de boucle dédiée (`mcp_toggle_server` + `{server, enabled}`).
- Branche `title.startsWith(MCP_SERVER_TOGGLE_SENTINEL)` (l. 7728) **avant** le
  handler `MCP_STATE_SENTINEL` : parse JSON (l. 7736), `applyMcpServerToggle`
  (l. 7742), **`appendSystemMessage(messagesEl, mcpToggleSystemMessage(plan))`**
  (l. 7754) → le changement est **visible dans la conversation** (jamais
  silencieux), puis `respondSuperAgent(id, mcpToggleAnswer(plan), false)`.
  Toute exception est capturée et devient un message.

### 3.4 Rust — écriture NARROW

`src-tauri/src/mcp_config.rs`

- `McpServerEnableChange { id, enabled }` (l. 225).
- `server_index_by_id` (l. 233) : correspondance exacte (espaces ignorés) puis
  insensible à la casse.
- **`apply_server_enable_changes` (l. 265)** : valide **TOUS** les identifiants
  **avant toute écriture** (un identifiant inconnu → `Err` nommant l'identifiant
  refusé et les serveurs connus, **configuration intacte**, donc aucune écriture
  partielle), puis n'affecte **que** `server.enabled` (une seule affectation),
  et rend les identifiants réellement modifiés (liste vide = rien à écrire).
- Commande **`mcp_set_servers_enabled` (l. 644)** : `read_mcp_config` →
  `apply_server_enable_changes` → `write_mcp_config` **si** des changements ont
  eu lieu ; réponse limitée à `{ ok, applied, servers: [{ id, name, enabled }] }`
  — **aucun contenu de serveur, aucune clé, aucune URL**.
- Enregistrement : `src-tauri/src/lib.rs` l. 4004
  (`mcp_config::mcp_set_servers_enabled`), juste après `mcp_get_state`.

## 4. Garanties et périmètre

| Exigence | Où c'est tenu | Comment c'est prouvé |
|---|---|---|
| Identifiant **connu** uniquement, message clair, jamais d'exception | `planMcpServerToggle` + `applyMcpServerToggle` (JS) **et** `apply_server_enable_changes` (Rust, 2ᵉ barrière) | JS « REFUSE un identifiant inconnu » + « IDENTIFIANT INCONNU : aucune écriture » ; Rust `identifiant_inconnu_refuse_sans_rien_ecrire` |
| **Activation exclusive**, les autres sont coupés **et dits** | `planMcpServerToggle.disabledOthers` → réponse + message système | JS « ACTIVATION EXCLUSIVE … coupés ET nommés » + « après écriture, un seul serveur reste activé » ; Rust `activation_exclusive_ne_laisse_qu_un_serveur_active` |
| **Aucun autre réglage touché** | seul `enabled` est affecté ; la commande n'appelle que `read_mcp_config`/`write_mcp_config` | JS « la charge écrite ne porte QUE des couples {id, enabled} » + « ne touche JAMAIS au contenu des serveurs ni aux secrets » (liste d'interdits) ; Rust `activation_ne_change_que_le_champ_active` |
| **Aucun serveur supprimé** | liste de serveurs jamais filtrée, seul `enabled` change | JS (tous les serveurs toujours présents) ; Rust `desactivation_n_active_aucun_autre_serveur` |
| Rien de silencieux | message système + réponse qui nomment le serveur et les coupés | JS « le message système rend le changement VISIBLE en une ligne » |
| Effet **prochaine session** rappelé | `MCP_NEXT_SESSION_NOTE` dans chaque réponse | JS « la réponse dit l'exclusivité, la prochaine session et la portée » |
| Aucune écriture inutile | `changes` vide ⇒ pas d'appel d'écriture | JS « état déjà atteint : aucune écriture du tout » ; Rust `etat_deja_demande_n_ecrit_rien` |
| Confirmation par l'**Assistant**, pas par l'outil | `promptGuidelines` des deux outils | JS « les descriptions portent les garde-fous » |
| Pas de fuite de secret dans la réponse | réponse `{id, name, enabled}` | Rust `reponse_de_commande_ne_contient_aucun_contenu_de_serveur` |

## 5. Preuves — tests (recomptés, aucun chiffre figé)

### Rust

```
$ cargo test --manifest-path src-tauri/Cargo.toml --lib mcp_config
cargo test: 41 passed, 759 filtered out (1 suite, 0.56s)
$ cargo test --manifest-path src-tauri/Cargo.toml --lib assistant_server_toggle_tests
cargo test: 7 passed, 793 filtered out (1 suite, 0.00s)
```

7 tests ajoutés (`mod assistant_server_toggle_tests`, l. 2672) :
`activation_ne_change_que_le_champ_active` (2710),
`desactivation_n_active_aucun_autre_serveur` (2730),
`identifiant_inconnu_refuse_sans_rien_ecrire` (2745),
`etat_deja_demande_n_ecrit_rien` (2762),
`identifiant_reconnu_a_la_casse_pres` (2777),
`activation_exclusive_ne_laisse_qu_un_serveur_active` (2788),
`reponse_de_commande_ne_contient_aucun_contenu_de_serveur` (2805).

Suite desktop complète : `cargo test --manifest-path src-tauri/Cargo.toml --lib`
→ **799 passed, 1 ignored**.

### JavaScript

```
$ npx vitest run
PASS (4111) FAIL (0)
```

Sorties brutes :
`docs/rapports/sorties/vitest-mcp-activation-assistant-20261029.txt` et
`docs/rapports/sorties/rust-mcp-activation-assistant-20261029.txt`.

`src/js/mcp-server-toggle.test.js` (22 tests) couvre : activation, désactivation,
identifiant inconnu, identifiant manquant, activation **exclusive** (décision
ET application), état déjà atteint, lecture/écriture en panne, périmètre
d'écriture (charge `{changes:[{id,enabled}]}` uniquement), chaîne complète
outils → sentinel → assistant → commandes Rust, et présence effective de
l'enregistrement Rust. Les découpages de source passent par `sliceSource`
(découpage **vérifié**) : l'inventaire de `source-slice.test.js` reste à zéro
site non protégé.

## 6. Documentation

- `spec_super_agent.md` : bloc `<!-- HELP:super-agent-mcp -->` complété (ce que
  l'utilisateur peut demander, exclusivité dite, périmètre, effet à la prochaine
  session, identifiant inconnu) + nouvelle section technique « Activer /
  désactiver un serveur MCP depuis la conversation » + la liste des outils de
  `pilot-assistant-actions.ts`.
- `spec_pilot.md` § MCP : une ligne sur les deux outils et l'écriture NARROW, et
  `mcp_set_servers_enabled` / `mcp-server-toggle.js` ajoutés aux listes.
- `help/handbook.md` régénéré (`npm run build:handbook`, 46 blocs).
- `AGENTS.md` : `src/js/mcp-server-toggle.js` ajouté à l'arborescence.

## 7. Ce qui n'a **pas** été fait (volontairement)

- **Règle « un seul serveur par session »** : inchangée (aucun réglage, aucun
  code de sélection touché). Le lot ne fait que **respecter** la règle en la
  rendant explicite.
- **Contenu et secrets des serveurs** : jamais lus, jamais réécrits.
- **`mcp_enabled`, `mcp_agent_confirm`, `mcp_secret_strict`, contrôle de
  l'écran** : aucun chemin de ce lot ne peut les modifier.
- **Publication / tag / geste Git destructif** : aucun.
- Aucune modification du projet `G:\IA_PL\Presences`.

## 8. Reste à faire (proposé, non engagé)

1. **Rendre le changement encore plus direct** : proposer à l'Assistant, dans
   sa réponse, de **relancer l'agent** pour que le nouveau serveur soit pris en
   compte sans attendre une nouvelle session (aujourd'hui il le dit seulement).
2. **Afficher dans Paramètres → Serveurs MCP** l'origine du dernier changement
   (« modifié par l'Assistant le … ») — confort de diagnostic, aucun réglage
   nouveau.
3. Si le besoin apparaît : un `mcp_state` enrichi d'un champ `effective`
   (serveur réellement retenu par la session courante), pour que l'Assistant
   distingue « activé » de « branché maintenant ».
