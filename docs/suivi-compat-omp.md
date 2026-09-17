# Suivi de compatibilité Pilot ↔ oh-my-pi (omp)

> Statut : **veille** — aucun changement de moteur, aucun code d'omp engagé dans Pilot.
> Mis à jour le 17/09 (LOT 5 de l'étude oh-my-pi). Décision du propriétaire : open source
> puis gratuit, « éviter le lourd quand le simple suffit ».

## 1. Décision de fond

**Pilot garde le moteur pi.** omp n'est **pas** adopté comme moteur d'agent.
Motifs : la boucle agent d'omp est en TypeScript/Bun (non portable dans un backend Rust),
Pilot n'embarque ni Bun ni Node, et plusieurs écarts de contrat ont été relevés
(`--skill` inexistant → le process omp meurt au démarrage, découverte des commandes,
noms d'événements de compaction, `model_changed`…). Aucun test d'exécution d'omp n'a pu
être mené (ni binaire omp ni Bun sur la machine) : les écarts restent en partie des
hypothèses.

## 2. Ce qui est repris

| Élément | Origine (étude) | Où, dans Pilot |
|---|---|---|
| Idée d'organisation « décision pure / écriture » sur la porte pré-écriture | idée 2 (`pi-edit`) | `src/js/agent-hardening.js` (`decideEditGate`) + `src/js/diff-view.js` (`renderEditGateDialog`) |
| Ne pas croire un `agent_end` non terminal (faux « terminé ») | écart F3 | `src/js/agent-hardening.js` (`isTerminalAgentEnd`, `isCompletionCredible`) + `src/js/agent-pi.js` (cas `agent_end`) |
| Détection d'une relance perdue (aucun silence) | écart F8 | `src/js/agent-hardening.js` (`isResendLost`, `isPromptAccepted`, `buildPromptPayload`) |
| Nom de commande de découverte de secours | écart F2 | `src-tauri/src/rpc.rs` (`COMMAND_DISCOVERY_ORDER`, `list_agent_commands`) + `src/js/agent-pi.js` (événement `available_commands_update`) |

Rien d'autre n'est repris d'omp : ces protections portent sur le **dialogue** Pilot ↔
agent, pas sur le moteur.

## 3. Ce qui est écarté, et pourquoi

| Élément | Décision | Raison |
|---|---|---|
| `pi-diff` comme dépendance Rust (R1) | **écarté** | La brique **n'est pas publiée sur crates.io** (l'API répond `crate pi-diff does not exist`) et la seule source disponible est une **copie d'archive sans `.git`** (donc aucun commit/version à figer). L'intégrer imposerait de **recopier (fork) le code** et de le maintenir à la main → dépendance non figée, précisément ce que le brief interdit. Licence MIT confirmée (`crates/pi-diff/Cargo.toml` : `license = "MIT"`), donc le blocage n'est pas juridique mais technique. Gain jugé marginal : Pilot calcule déjà ses différences (`src/js/diff-view.js` : LCS ligne à ligne, sans dépendance). |
| `pi-walker` (idée 4) | écarté pour l'instant | À n'ouvrir **que si un scan mesuré est trop lent** (recherche globale, graphe de code). Aucune lenteur mesurée à ce jour. |
| `pi-vcs` / `pi-iso` (idée 5) | écarté | Dépendances lourdes, licences transitives (`gix`, `jj-lib`) non auditées. |
| `provider-quirks` (idée 6) | écarté | Vivent dans la boucle agent TypeScript/Bun, que Pilot ne possède pas. |
| `snapcompact` (idée 7) | écarté (veille) | Classé « à ne pas implémenter maintenant ». |

## 4. Condition de réévaluation

Réévaluer **seulement** si l'un de ces faits se produit :

1. **pi cesse d'être maintenu** (plus de publication, ou protocole RPC gelé) ; ou
2. **omp livre un binaire autonome sans Bun** (question décisive de l'étude) ; ou
3. `pi-diff` (ou une brique équivalente) est **publiée sur crates.io** avec une version
   figée et une maintenance active — la R1 redevient alors candidate, avec notice MIT
   dans `THIRD-PARTY-NOTICES.txt` ; ou
4. une **lenteur mesurée** de la recherche globale ou de l'indexation justifie `pi-walker`.

Prérequis d'une éventuelle bascule de moteur : corriger d'abord les écarts F1
(`--skill` → `--skills`), F2 (découverte des commandes), F4/F5 (noms d'événements).

## 5. Notes de vérification (R1, 17/09)

- `https://crates.io/api/v1/crates/pi-diff` → `{"errors":[{"detail":"crate \`pi-diff\` does not exist"}]}`.
- Source locale examinée : `G:\IA_PL\SourcesAutresLogiciels\oh-my-pi-main\oh-my-pi-main`
  (archive extraite, **pas de `.git`**), `crates/pi-diff/Cargo.toml` (MIT, aucune
  dépendance déclarée), `crates/pi-diff/src/lib.rs` (~29 Ko), `LICENSE` racine (MIT),
  version d'espace de travail `18.1.21` (`Cargo.toml` ligne 22).
