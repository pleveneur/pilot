# Rapport — garde-fou des commandes destructrices

> Tâche : un agent (modèle local) a proposé **trois fois sur trois** une commande
> de suppression massive, sans jamais demander l'accord de l'utilisateur. Rien
> n'a été exécuté par chance, pas par protection : le défaut est réel. Ce rapport
> dit **ce qui existait déjà**, **ce qui manquait**, **ce qui a été ajouté** et
> **comment c'est vérifié**.

---

## 1. Ce qui existait déjà (constat, avant toute écriture)

Pilot possède **quatre** protections avant action, toutes construites sur le
même dessin : une **extension** pi écrit une demande `confirm` dont le message
commence par une **sentinelle** (`PILOT_…::`), l'interface reconnaît cette
sentinelle et affiche le dialogue au bon endroit.

| Protection | Où | Ce qu'elle couvre | Ce qu'elle ne couvre pas |
|---|---|---|---|
| Porte pré-écriture (A4) | `src-tauri/extensions/pilot-edit-gate.ts` | les outils `write` / `edit` : le contenu du fichier est montré avant écriture (`PILOT_EDIT_GATE::`) | **aucun outil de commande** |
| Fichiers réservés (T6) | `src-tauri/extensions/pilot-reserve-gate.ts` | un fichier réservé par un autre agent est bloqué | rien d'autre |
| Contrôle de l'écran | `src/js/screen-guard.js` + extension | les actions réelles sur l'écran (`PILOT_SCREEN_GATE::`) | rien d'autre |
| Actions de l'assistant | `src/js/super-agent.js` | ouvrir un projet, déléguer, planifier (`PILOT_ASSISTANT_ACTION::`) | rien d'autre |

Autres mécanismes connexes, **non** pertinents ici mais vérifiés pour ne pas les
doubler : détection de boucle (`loop-detection.js`, qui classe déjà les outils
`bash`/`shell` et sait extraire la ligne de commande), relais des questions
d'agent (`agent-choice-relay.js`, `agents-bus.js`), filet des sentinelles
(`machine-sentinel.js`), délais obligatoires des dialogues
(`extensions-ui-timeout.test.js`).

**Constat de recherche** : `rm -rf`, `mkfs`, `dd if=`, `shutdown`, `git push
--force`, `chmod -R 777` n'apparaissaient **nulle part** dans le code de
production — seulement dans des tests. Aucune liste de commandes interdites,
aucun réglage d'autonomie ne les arrêtait.

### La brèche exacte

Un agent disposant de l'outil `bash` pouvait lancer **n'importe quelle**
commande : l'écriture de fichiers était contrôlée, la commande qui efface un
disque ne l'était pas. C'est cette brèche — et elle seule — qui a été comblée.

---

## 2. Ce qui a été ajouté

### 2.1 Le cœur : `src/js/destructive-command.js` (module pur)

**Aucun import** (ni DOM, ni Tauri, ni autre module du projet) : ce fichier est
embarqué par Rust puis écrit **à côté** de l'extension qui l'importe
(`./destructive-command.js`). Une dépendance, même minuscule, casserait cet
import et priverait l'agent de la garde en silence — c'est le même contrat que
`regles-communes-assistants.js`, et un test le vérifie.

Neuf familles, chacune avec **un libellé court**, **pourquoi c'est dangereux** et
**ce qui arriverait si vous acceptiez** :

| Famille | Exemple reconnu |
|---|---|
| `disque` | `dd if=/dev/zero of=/dev/sda`, `rm -rf /` (viser la racine = tout le disque) |
| `formatage` | `mkfs.ext4 /dev/sdb1`, `format D:` |
| `suppression_recursive` | `rm -rf build`, `rmdir /s /q dossier` |
| `suppression_forcee` | `rm -f fichier`, `del /f /q x` |
| `droits_masse` | `chmod -R 777 .`, `chown -R root /` |
| `extinction` | `shutdown /s`, `reboot`, `systemctl poweroff` |
| `git_push_force` | `git push --force`, `git -C /p push -f` |
| `git_historique` | `git reset --hard`, `git clean -fdx`, `git filter-branch` |
| `hors_projet` | `echo x > /etc/motd`, `rm ~/autre/fichier`, `tee /etc/hosts` |

Quand plusieurs familles se reconnaissent, **la plus grave parle seule**
(`FAMILY_PRIORITY`), et une commande chaînée (`cd x && rm -rf /`) est analysée
segment par segment.

### 2.2 La porte : `src-tauri/extensions/pilot-bash-guard.ts`

Elle s'accroche à l'événement `tool_call` de pi, pour les outils `bash`/`shell` :

- commande **ordinaire** → la porte ne dit rien, la commande part normalement ;
- commande **reconnue destructrice** → `ctx.ui.confirm(...)` avec un texte
  français (quelle commande, pourquoi, ce qui se passerait), **délai borné à
  5 minutes** ;
- refus, expiration du délai, ou **panne quelconque** → `{ block: true }` avec un
  motif lisible : la commande **n'est pas lancée** ;
- accord explicite de l'utilisateur → `undefined`, la commande part.

Elle est **fail-closed** : c'est le contraire des autres portes. Une analyse qui
échoue ne peut pas décider qu'une commande est inoffensive.

Elle est écrite **même quand `confirm_file_edits` est désactivé** : l'autonomie
d'écriture de fichiers n'est pas un accord pour effacer un disque.

Elle ne dépend **d'aucun modèle** : rien n'est demandé au LLM, tout est décidé
par les neuf familles.

### 2.3 L'embarquement : `src-tauri/src/agent_service.rs`

`write_bash_guard_extension(dir)` écrit les deux fichiers dans le dossier
d'extensions de la session, et cette écriture est branchée dans **les cinq
chemins de lancement** (assistant, super-agent, processus d'agent, session de
projet, assistant de groupe). Un agent lancé par `run_agents` est donc protégé
comme l'agent de l'onglet π. `rpc_manager.rs` passe chaque fichier en
`--extension`, donc pi les charge réellement.

### 2.4 L'écran : trois transports corrigés

La sentinelle `PILOT_BASH_GATE::<json>` porte la commande, la famille et les
trois phrases. Elle est reconnue :

- **onglet agent π** (`agent-pi.js`) : `handleBashGateConfirm` → dialogue
  « Autoriser cette commande » / « Refuser » ;
- **assistant 🧭** (`super-agent.js`) : dialogue de confirmation existant, son
  d'attention ;
- **agent relayé** (bus → conversation de l'assistant) : le **même** dialogue,
  la phrase française étant produite par `machine-sentinel.js` (aucune
  sentinelle brute affichée — règle protégée du propriétaire).

Payload illisible ⇒ **refus immédiat** partout (on ne peut pas décrire le danger,
donc on ne l'autorise pas). Mode orchestration autonome ⇒ refus **visible et
expliqué**, jamais un accord automatique : personne ne peut cliquer.

### 2.5 Le défaut trouvé EN VÉRIFIANT — et corrigé

En relisant la façon dont une confirmation rentre dans pi 1.6.0
(`dist/modes/rpc/rpc-mode.js`), une évidence est apparue :

```js
confirm: (…) => (r) => "cancelled" in r && r.cancelled ? false
                                 : "confirmed" in r ? r.confirmed : false
```

Une demande `confirm` n'est résolue **que** par `confirmed` **à la racine** de
la réponse ; `value` n'est lu que par `select` et `input`. Or les trois
transports de Pilot envoyaient l'accord sous forme de `value`
(`{"confirmed":true,…}`), **sans** le champ racine. Autrement dit : l'utilisateur
cliquait « Oui », et le moteur relisait « non ».

C'était plus large que la nouvelle garde (toute confirmation d'extension), et
grave pour elle : une garde qui refuse même quand on accepte n'est pas une
garde, c'est un mur. Corrigé **au seul endroit de la décision**
(`agentAnswerConfirmedRoot` dans `agent-question-surface.js`) puis appliqué aux
trois transports : `respondAgentRelay` et `respondSuperAgent`
(`super-agent.js`) et `renderInlineConfirm` (`agent-pi.js`). Le champ s'**ajoute**
à la réponse, il ne la remplace pas : les sélections et les saisies sont
inchangées.

### 2.6 Le filet des sentinelles

`machine-sentinel.js` apprend la famille `PILOT_BASH_GATE::` et sa phrase de
repli (« Je vais lancer une commande qui peut effacer des fichiers… »). La
sentinelle n'est **pas recopiée** : elle est ré-exportée depuis
`destructive-command.js` (une seule grammaire).

---

## 3. Ce qui n'a PAS été fait (et pourquoi)

- **Aucune liste d'interdits.** Une liste noire se contourne et vieillit mal ; la
  décision est prise sur la **forme** de la commande (verbe + options + cible),
  ce qui couvre aussi la variante qu'un modèle inventerait.
- **Aucun réglage d'autonomie réutilisé.** `confirm_file_edits` décide de
  l'écriture de fichiers ; l'étendre aurait laissé le disque sans garde.
- **Aucun test existant assoupli.** Rien n'a été supprimé ni rendu tolérant ; les
  verrous de sentinelles, de délais (`extensions-ui-timeout.test.js`) et de
  relais passent tels quels.

---

## 4. Vérification

| Preuve | Résultat |
|---|---|
| `npx vitest run src/js/commande-destructrice.test.js` | **82 passés, 0 échec** |
| `npx vitest run src/js/porte-commandes-destructrices.test.js` | **13 passés, 0 échec** |
| `npx vitest run src/js/confirmation-transmise-a-pi.test.js` | **7 passés, 0 échec** |
| `npx vitest run` (suite entière) | **6234 passés, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **991 passés, 3 ignorés** |
| `cargo test … --lib bash_guard` | **1 passé** (verrou d'embarquement) |

Ce que les tests prouvent :

1. **La commande destructrice ne part pas sans accord.** La porte est exécutée
   pour de vrai, dans une session pi simulée : `rm -rf /` produit **une** demande
   de confirmation, et sans réponse le résultat est `block: true` avec le motif
   « REFUSÉE / NON exécutée ». Les neuf familles demandent l'accord.
2. **La commande ordinaire passe normalement.** `npm test`, `git status`,
   `rg "rm -rf" src`, `chmod 644 README.md`, `du -sh node_modules`,
   `echo test > /tmp/pilot-essai.txt` : **zéro** demande, zéro blocage. Un `write`
   n'est pas filtré, une saisie vide non plus, et dans une série
   (`cd x && npm test && rm -rf build`) **seule** la commande dangereuse demande.
3. **Le texte est utilisable.** Le message affiché dit la commande, « Pourquoi
   c'est dangereux » et « Si vous acceptez », ne contient **aucune** sentinelle
   ni JSON brut, et le motif de refus précise que la commande n'a pas été lancée.
4. **Le délai est borné.** Les tests à horloge simulée prouvent qu'une confirmation
   sans réponse **expire** (≤ 5 min) et que l'expiration vaut refus — jamais une
   attente infinie.
5. **La panne n'ouvre pas la porte.** Un dialogue qui lève une exception produit
   un blocage avec « n'a pas pu vérifier » (fail-closed), et le cœur est vérifié
   sans aucun import.
6. **L'accord arrive réellement au moteur.** `confirmed` à la racine est testé
   (acceptation = `true`, refus = `false`, tout le reste = `null`), et les trois
   transports sont tenus par verrou.

Deux pièges ont été trouvés **par les tests**, ce qui justifie de les écrire :

- `git -C /chemin push --force` : sans lire les options globales de `git` qui
  prennent une valeur, le sous-commande `-C` masquait le `push --force` ;
- `rm /etc/hosts`, `tee /etc/motd` : `/etc` ressemble à un drapeau Windows
  (`/s`, `/q`). Un drapeau est maintenant reconnu à sa forme, et un chemin
  absolu Unix n'est plus pris pour une option.

---

## 5. Fichiers touchés

| Fichier | Rôle |
|---|---|
| `src/js/destructive-command.js` | **nouveau** — décision pure (9 familles, textes, sentinelle) |
| `src-tauri/extensions/pilot-bash-guard.ts` | **nouveau** — la porte `tool_call`, fail-closed |
| `src/js/commande-destructrice.test.js` | **nouveau** — 82 preuves sur la décision |
| `src/js/porte-commandes-destructrices.test.js` | **nouveau** — 13 preuves sur la porte en session |
| `src/js/confirmation-transmise-a-pi.test.js` | **nouveau** — 7 preuves sur `confirmed` à la racine |
| `src-tauri/src/agent_service.rs` | écriture de la porte + 5 branchements + verrou Rust |
| `src/js/agent-pi.js` | branche `PILOT_BASH_GATE::`, transport `confirmed` |
| `src/js/super-agent.js` | branche `PILOT_BASH_GATE::`, transports `confirmed` |
| `src/js/machine-sentinel.js` | famille `PILOT_BASH_GATE::` (sentinelle jamais affichée) |
| `src/js/agent-question-surface.js` | `agentAnswerConfirmedRoot` (source unique du champ) |
| `vitest.config.js` | alias du cœur vers `src/js/` (le fichier réel est écrit au lancement) |

---

## 6. Limite connue, dite franchement

Un agent **sans interface** (lancé en arrière-plan par `run_agents`) fait
remonter sa demande dans la conversation de l'assistant : c'était un relais
`value`, il porte maintenant `confirmed`, donc l'accord fonctionne. En revanche,
si **aucune** surface n'est disponible (onglet 🧭 fermé et pas de dialogue de
secours), la demande reste en attente jusqu'à la borne des 5 minutes **puis est
refusée** — le mécanisme existant (`agent-question-surface.js`) ne laisse jamais
une attente ouverte sans porteur, et le refus est la seule issue qui ne décide
rien à la place de l'utilisateur. Rien n'est détruit dans ce cas.

Ce qui reste à décider par le propriétaire, s'il le souhaite : autoriser une
commande destructrice **sans** passer par le dialogue (jamais proposé ici), ou
allonger les 5 minutes. Aucune des deux n'a été faite sans son accord.
