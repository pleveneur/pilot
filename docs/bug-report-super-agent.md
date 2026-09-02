# Bug : "Connexion au super-agent perdue" — résolution du shim `pi.cmd` cassée pour les paquets npm scopés

## Résumé

Sur Windows, quand `pi` est installé via un paquet npm **scopé** (ex. `@earendil-works/pi-coding-agent`, qui est la structure du paquet officiel actuel), `resolve_pi_executable()` (`src-tauri/src/pi_update.rs`) ne retrouve jamais le vrai fichier `cli.js` et retombe sur un lancement direct du `.cmd`, que `Command::new` ne sait pas exécuter correctement sur Windows. Résultat : le sous-processus `pi` ne démarre pas correctement dans **toutes** les sessions RPC (agent principal, assistant/super-agent, agents délégués), et l'UI affiche "⚠️ Connexion au super-agent perdue" sans jamais montrer l'erreur réelle.

## Environnement

- Pilot : v0.4.1 (`src-tauri/tauri.conf.json`)
- Agent pi : v0.84.3, paquet `@earendil-works/pi-coding-agent`
- OS : Windows
- `rpc_pi_path` configuré sur un shim npm global `pi.cmd`

## Cause racine

Dans `src-tauri/src/pi_update.rs`, fonction `resolve_pi_executable()` :

```rust
if let Some(parent) = std::path::Path::new(trimmed).parent() {
    let cli = parent.join("node_modules").join("pi").join("cli.js");
    if cli.exists() {
        return ("node".to_string(), vec![cli.to_string_lossy().to_string()]);
    }
}
(trimmed.to_string(), Vec::new())
```

Cette fonction suppose que le paquet npm s'appelle `pi` (dossier `node_modules\pi\cli.js`). Mais le paquet réel est **scopé** : `node_modules\@earendil-works\pi-coding-agent\dist\...\cli.js`. `node_modules\pi\` n'existe donc jamais, `cli.exists()` renvoie `false`, et la fonction retombe sur le fallback `(trimmed.to_string(), Vec::new())` — c'est-à-dire qu'elle renvoie le chemin du `.cmd` tel quel, sans le résoudre.

Ce chemin `.cmd` brut est ensuite passé directement à `Command::new(&pi_exe)` dans `rpc_manager.rs::spawn_and_start()` (ligne ~51). Or le commentaire de `resolve_pi_executable()` lui-même explique que c'est exactement ce que cette fonction est censée éviter :

> « `Command::new` ne sait pas exécuter un `.cmd`/`.bat` sur Windows »

Donc quand la résolution échoue, on retombe dans le cas que la fonction a été écrite pour contourner. Le sous-processus démarre dans un état cassé (ou ne démarre pas proprement), son flux stdout se referme, et `rpc_manager.rs` émet `{"type": "process_exit", "reason": "stdout_closed"}` — que le frontend (`super-agent.js` ligne ~2414) traduit en "Connexion au super-agent perdue" après une fenêtre de grâce, sans jamais afficher la cause réelle (que `read_stderr_loop` capture pourtant, mais qui n'est visible nulle part dans l'UI standard).

**Remarque supplémentaire** : le chemin exact du fichier compilé a aussi changé entre deux versions du paquet (`dist/cli.js` en 0.82.0, `dist/bundle/cli.js` en 0.84.3), donc même en corrigeant le nom du dossier scopé, un chemin en dur resterait fragile à chaque changement de structure de build du paquet `pi`.

**Bug secondaire lié** : `pi_health_check()` / `probe_backend()` (`rpc.rs`, via `run_captured()`) n'appellent **pas** `resolve_pi_executable()` — ils font `Command::new(pi_path)` directement sur le chemin brut. Le health-check au démarrage (E4) peut donc se comporter différemment (réussir ou échouer) que le vrai lancement RPC, qui lui passe par `resolve_pi_executable()`. Les deux chemins de code devraient utiliser la même résolution.

## Comment reproduire

1. Installer `pi` via npm global (`npm i -g @earendil-works/pi-coding-agent` ou équivalent) → crée un shim `pi.cmd` avec `node_modules\@earendil-works\pi-coding-agent\...\cli.js` à côté.
2. Dans Pilot → Réglages → Agent Pi, renseigner le chemin de ce `pi.cmd`.
3. Ouvrir un onglet agent ou l'assistant (super-agent) sur un projet.
4. `pi --version` et `pi --mode rpc` fonctionnent parfaitement en ligne de commande, mais dans Pilot : blocage puis "Connexion au super-agent perdue", pour tous les agents lancés (peut arriver en rafale si plusieurs sessions démarrent ensemble, ex. `agent_start_on_launch` + `super_agent_start_on_launch`).

## Pistes de correctif

1. **Le plus robuste** : ne plus essayer de deviner le nom du dossier `node_modules`. Lancer le `.cmd`/`.bat` via `cmd.exe /c` explicitement (`Command::new("cmd").args(["/c", pi_path, ...])`), qui sait nativement exécuter un shim npm sur Windows, quel que soit le nom/scope du paquet installé derrière. Ça évite toute hypothèse sur la structure interne du paquet.
2. **Alternative** si on veut garder le lancement direct via `node` (utile pour piper stdin/stdout proprement sans couche `cmd.exe` intermédiaire) : lire le `bin` déclaré dans le `package.json` du paquet réellement installé (résolu dynamiquement, ex. en listant `node_modules\@*\*\package.json` ou `node_modules\*\package.json` à la recherche d'un champ `bin.pi`), au lieu de coder en dur `node_modules/pi/cli.js`.
3. **Dans tous les cas** : remonter l'erreur réelle à l'utilisateur. Actuellement `read_stderr_loop` capture bien le texte d'erreur du process `pi` (`process_error`) mais le toast "Connexion au super-agent perdue" ne l'affiche jamais. Afficher au moins les dernières lignes de stderr (ou l'erreur de `spawn()` si le lancement échoue carrément) aurait permis de diagnostiquer ce bug en quelques minutes au lieu d'une investigation complète du code.
4. Aligner `pi_health_check()` / `probe_backend()` sur la même résolution que `spawn_and_start()` pour que le health-check reflète fidèlement ce qui va réellement se passer au lancement.

## Contournement appliqué en attendant le correctif

Un fichier `node_modules\pi\cli.js` a été ajouté manuellement à côté du `pi.cmd` configuré, qui ré-exporte le vrai point d'entrée scopé — ça satisfait la vérification `cli.exists()` de `resolve_pi_executable()` sans toucher au code de Pilot ni au paquet `pi` lui-même. Purement un contournement local, pas un correctif.
