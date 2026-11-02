# Rapport — Sauvetage du travail « voix du système disparue » + état de `src-tauri/src/agents.rs`

> Micro-tâche en deux temps, sans changement de version et **sans aucun tag**
> (version toujours `0.6.1` dans les 4 fichiers, `git tag --points-at HEAD` → 0 tag).

## 1. Travail livré mais jamais commité — commité et poussé

### 1.1 Vérification des diffs avant de committer (pas de confiance aveugle)

| Fichier | Ce que le diff contient réellement | Conforme à la description ? |
|---|---|---|
| `src/js/read-aloud.js` (+64/−4) | `systemVoiceMissingCause(voices, choice)` (pure : `""` pour « Automatique », voix locale, liste vide ; `"voix introuvable"` sinon), `readAloudSystemFallbackNotice(cause)` (une ligne, avec ou sans cause), `notify("system-fallback", cause)` dans `speak()` après `resolveVoiceForChoice`, branche `else if (state === "system-fallback")` dans `createReadAloudButton` → `setState("speaking")` + `showNotice(...)` dans le **même** `span.agent-read-notice`, et `readAloudStateLabel("system-fallback")` | ✅ oui, exactement |
| `src/js/repli-voix-muet.test.js` (+137/−6) | 7 nouveaux contrôles : `systemVoiceMissingCause` (présente par nom / par `voiceURI` / disparue / « Automatique » / voix locale / liste vide / `null`), phrase (courte, une ligne, sans alarme, reste lisible sans cause), `readAloudStateLabel`, émission de l'état + cause par le lecteur, CAS 4 (mention visible près du bouton, un seul `.agent-read-notice`, `role="status"`, réglage intact), CAS 5 (voix présente → aucune mention), disparition de la mention à la lecture suivante | ✅ oui (7 `it()` ajoutés dans 2 `describe`) |
| `spec_read_aloud.md` (+39/−2) | § 3 (« jamais un remplacement silencieux »), **nouveau § 4 ter** (un seul endroit pour constater, un seul mécanisme, cas normal muet, réglage non réécrit, état lisible dans les Options), § 6 (couverture des deux moteurs + neutralisations) | ✅ oui |
| `help/overview.md` (+9/−3) | Bloc `HELP:lire-reponses`, puce « La voix choisie a disparu de l'ordinateur » : le dit aussi **à côté du bouton « 🔊 Écouter »**, choix enregistré non modifié, aucune ligne quand la voix est là | ✅ oui |

Aucun autre fichier n'appartenait à ce travail : `index.html`, `settings.js`,
`style.css`, le Rust et les versions n'ont pas bougé.

### 1.2 Handbook

`help/overview.md` a changé → `npm run build:handbook` relancé : **45 blocs**,
fichier régénéré. `git diff -- help/handbook.md` est **vide** : le `handbook.md`
suivi par git était déjà à jour (le contenu généré correspondant à la nouvelle
puce « remplacement silencieux » / « voix introuvable » s'y trouvait déjà — donc
rien de plus à inclure dans le commit, et surtout rien à éditer à la main).

### 1.3 Les deux suites, comptes réels

| Suite | Résultat |
|---|---|
| `npm test` (worktree contenant ces 4 modifications) | **195 fichiers de test, 3465 tests passés, 0 échec** (11,19 s) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **786 passés, 1 ignoré, 0 échec** (compilation `pilot v0.6.1` OK, 27,10 s) |

Les deux suites sont vertes → commit autorisé.

### 1.4 Commit et push

- Fichiers ajoutés **un par un, par leur chemin exact** (`git add -- <chemin>` ×4),
  vérifiés dans l'index (`git diff --cached --stat` = 4 fichiers, 249 insertions,
  15 suppressions ; `agents.rs` absent de l'index).
- **Commit** : `8913edef8d85665753709ded68cd3ba801e63001`
  — `fix(lecture): annoncer le repli quand la voix du systeme a disparu` (message
  exact demandé).
- **Push** : `git push origin main` → `origin/main` = `8913ede`. **Aucun tag,
  aucune version touchée.**
- Reste non commité après l'opération : **uniquement** `src-tauri/src/agents.rs`
  (laissé volontairement, voir § 2).

## 2. `src-tauri/src/agents.rs` — diff non commité, laissé tel quel

*(Ni commité, ni modifié, ni restauré : simple lecture.)*

### Contenu du diff (+39 lignes, **aucune suppression**)

1. `command_is_prompt(command: &Value) -> bool` (nouvelle, `pub(crate)`) : vrai si
   `command["type"] == "prompt"`.
2. `ensure_command_launch_allowed(service, anomaly_map, project, agent_id, command)`
   (nouvelle, `pub(crate)`) : si la commande **n'est pas** un `prompt`, laisse
   passer ; sinon délègue à la garde existante `ensure_agent_not_busy`.
3. Un appel à cette garde **en tête** de `do_send_agent_process_command`.

### Comportement visé

`send_agent_process_command` accepte une commande RPC **arbitraire**. Jusqu'ici
seuls les prompts directs (`do_send_agent_process_prompt`) passaient la porte du
verrou par couple (projet, agent) ; un `prompt` glissé dans une commande
arbitraire démarrait donc une **seconde exécution concurrente** sur le même agent.
Le diff ferme ce trou, sans filtrer les autres commandes — indispensable, car
`extension_ui_response` (réponse à une question), `abort`, `get_state`,
`set_model` doivent continuer à passer **pendant** que l'agent travaille (c'est
même le cas d'usage d'`extension_ui_response`).

### Cohérence avec le reste

Oui : aucune nouvelle politique, aucun nouvel état, aucun nouveau message d'erreur
— c'est la **même** garde `ensure_agent_not_busy` (même refus honnête
« L'agent « X » est déjà en train de travailler… ») réutilisée sur un second point
d'entrée. Le diff est purement additif : il ne peut pas casser le comportement
existant, hormis le refus nouvellement introduit sur un `prompt` concurrent, qui
est précisément l'effet voulu.

### Ça compile ?

Oui : `cargo test --manifest-path src-tauri/Cargo.toml --lib` a **recompilé
`pilot v0.6.1` avec ce diff présent** puis exécuté la suite (786 passés, 1
ignoré). Aucun avertissement nouveau (seul le rappel `sqlx-postgres v0.8.0`
préexistant).

### Les tests couvrent-ils ce changement ?

**Non, pas la partie nouvelle.** Le seul test Rust de ce sujet,
`prompt_gate_refuses_while_agent_process_is_busy` (`src-tauri/src/agent_service.rs`),
exerce directement `ensure_agent_not_busy` (session absente → autorisé,
`busy=true` → refus nommé, `busy=false` → autorisé). Aucun test n'appelle
`command_is_prompt` ni `ensure_command_launch_allowed`, et aucun test ne traverse
`send_agent_process_command`. Côté JS, `agents-bus-questions-relais.test.js`
vérifie seulement que le relais de questions passe bien par
`send_agent_process_command` (cas **non-prompt**, toujours autorisé) : il ne
couvre pas le nouveau refus.

### ⚠️ Incohérence à trancher : la promesse du commentaire est plus large que le code

Le commentaire de `ensure_command_launch_allowed` annonce couvrir **deux** points
d'entrée : `send_agent_command_to` **et** `do_send_agent_process_command`.
Or **seul le second** a reçu l'appel. `send_agent_command_to`
(`src-tauri/src/rpc.rs:642`) est inchangé et fait toujours
`state.agent_service.send(&project, &agent_id, command)` sans aucune garde — et
`src/js/super-agent.js:6732` lui envoie réellement
`{ type: "prompt", message: request }` (chemin `delegate_to_coder` de
l'Assistant). **Un vrai chemin de prompt contourne donc encore le verrou** : le
dessein annoncé n'est qu'à moitié réalisé (aucune régression, mais le trou visé
n'est pas entièrement fermé).

À noter aussi : `send_agent_command_to` n'est jamais passé sur ce point par un
`prompt` depuis le bus JS ordinaire (le relais n'y envoie que des
`extension_ui_response`), donc le risque concret restant concerne la délégation
de l'Assistant.

### Avis pour décider : garder ou abandonner

- **Garder** : c'est additif, compilé, cohérent, et ça ferme un vrai trou.
- **Mais le finir** (2 lignes + 1 test, hors de cette micro-tâche) : ajouter le
  même appel dans `send_agent_command_to` (`rpc.rs`) et un test Rust qui prouve
  `command_is_prompt` vrai/faux et le refus effectif sur une commande
  `{"type":"prompt"}`. Sinon le commentaire induit en erreur un futur lecteur.
- Aucun autre garde équivalent n'existe ailleurs dans le code (vérifié par
  recherche sur `ensure_agent_not_busy` / `ensure_command_launch_allowed`) : ce
  diff n'est pas un doublon d'un mécanisme plus récent.

## 3. Ce que cette micro-tâche n'a PAS fait

- Aucune modification de `src-tauri/src/agents.rs` (ni commit, ni restauration, ni
  correction, y compris de l'incohérence ci-dessus).
- Aucun changement de version, aucun tag, aucune publication.
- Aucun test lancé sur une voix réellement désinstallée (hors périmètre, déjà
  signalé dans `RAPPORT-voix-systeme-disparue.md` § 6).
