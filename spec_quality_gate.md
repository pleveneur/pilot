# Spec — Quality-gate interne à Pilot (skill embarqué, activable dans l'onglet agent)

> Document de spécification — Statut : **✅ Implémenté**.
> Décision initiale 10/07/2026, **modifiée 10/07/2026** (skill global supprimé par
> l'utilisateur ; le quality-gate devient un skill **embarqué dans Pilot**, activable
> depuis l'onglet de l'agent). Implémenté le 13/07/2026.
> Suivi : voir « Évolution 7 » dans `Bugs et Evolutions.md`.

---

## 1. Objectif

Pilot embarque le protocole **quality-gate** (anti-régression : lire les fichiers
avant modification, cartographier les points de connexion, vérifier après). L'utilisateur
**supprime** le skill global de pi (`~/.pi/agent/skills/quality-gate/`). À la place,
Pilot fournit son propre `SKILL.md` (embarqué dans le binaire) et l'active à la demande
pour l'agent pi lancé par Pilot.

L'activation se fait par un **bouton dans l'onglet de l'agent** (pas dans la modale
Paramètres). L'état (activé/désactivé) est **persisté** dans la config de Pilot et
**rechargé à chaque redémarrage** de l'application.

---

## 2. Décisions validées par l'utilisateur

| # | Décision | Détail |
|---|----------|--------|
| 1 | **L'utilisateur supprime le skill global `quality-gate`** | pi ne le charge plus automatiquement. Les autres skills globaux (brave-search, etc.) restent chargés normalement (découverte auto). |
| 2 | **Skill embarqué dans Pilot** | Le `SKILL.md` est inclus dans le binaire Pilot (`include_str!`), écrit sur le disque par Pilot et passé à pi via `--skill <path>`. **Pas de `--no-skills`** (les autres skills globaux restent actifs). |
| 3 | **Option dans l'onglet de l'agent** | Bouton toggle dans la toolbar de l'agent (à côté de ⏹️ ➕ 📦 🧠). Reflète l'état courant. |
| 4 | **Persistance + rechargement au démarrage** | `quality_gate_enabled: bool` dans `AppConfig` (config.json). Relu au démarrage de Pilot et appliqué au lancement de l'agent. |

---

## 3. Mécanisme de pi (skills au démarrage)

D'après la doc pi (`docs/skills.md`) :

- pi charge les skills **au démarrage** du processus (global `~/.pi/agent/skills/`,
  projet, packages, etc.).
- `--skill <path>` → charge un skill explicite (répétable, **additif** avec la
  découverte auto). Permet d'ajouter le quality-gate sans toucher aux autres.
- Les skills sont chargés au lancement du process ; pas de rechargement à chaud.
  → changer l'option impose de **relancer la session pi**.

Puisque l'utilisateur supprime le skill global, il n'y a **plus de collision de noms** :
Pilot ajoute simplement son `quality-gate` via `--skill` quand l'option est active.

---

## 4. Approche retenue

### 4.1 Ligne de commande pi

```
# Option désactivée (défaut) :
pi --mode rpc [--no-session] [--session-dir ...]

# Option activée :
pi --mode rpc [--no-session] [--session-dir ...] --skill <config_dir>/skills/quality-gate/SKILL.md
```

`<config_dir>` = dossier de config de Pilot (`AppData/Roaming/com.pilot.editor` sur
Windows, équivalent multi-plateforme via `app.path().app_config_dir()`).

### 4.2 Fichier SKILL.md embarqué

- Pilot embarque le `SKILL.md` via `include_str!("skills/quality-gate/SKILL.md")`
  (fichier source dans `src-tauri/skills/quality-gate/SKILL.md`).
- Au démarrage de l'agent **avec l'option active**, Pilot écrit ce contenu dans
  `<config_dir>/skills/quality-gate/SKILL.md` (crée le dossier si besoin, écrase
  systématiquement — le contenu est géré par Pilot, pas personnalisable).
- Puis passe ce chemin à `--skill`.

### 4.3 UI — onglet agent

- Bouton toggle dans la toolbar (`src/js/agent-pi.js`, `toolbar.innerHTML`), ex. 🛡️
  « Quality-gate ». État visuel actif/inactif (classe CSS, ex. `.active`).
- Au clic → toggle l'état → `save_config` (persiste `quality_gate_enabled`) →
  **relance l'agent** (`stop_agent_session` + `start_agent_session`) pour appliquer
  le nouveau set de skills. Voir §6 (point ouvert : relance immédiate vs au prochain
  démarrage).
- Au démarrage de Pilot, l'état du bouton est initialisé depuis la config lue.

### 4.4 Persistance & rechargement

- `AppConfig.quality_gate_enabled: bool` (`#[serde(default)]`, défaut `false`).
- `load_config_disk` au démarrage → l'état est disponible pour `do_start_agent_session`.
- `do_start_agent_session` lit `quality_gate_enabled` ; si true, écrit le SKILL.md et
  ajoute `--skill` à `spawn_and_start`.

---

## 5. Plan d'implémentation — ✅ Terminé (13/07/2026)

- [ ] **`src-tauri/skills/quality-gate/SKILL.md`** : nouveau fichier, copie du skill
      global actuel (voir §7). Embarqué via `include_str!`.
- [ ] **`src-tauri/src/lib.rs`** :
  - `AppConfig` : ajouter `quality_gate_enabled: bool` (`#[serde(default)]`).
  - `default AppConfig` : `quality_gate_enabled: false`.
  - `do_start_agent_session` : lire `quality_gate_enabled` ; si true, écrire le
    `SKILL.md` (depuis `include_str!`) dans `<config_dir>/skills/quality-gate/` puis
    passer le chemin à `spawn_and_start`.
  - `needs_web_reload`-style : inclure `quality_gate_enabled` dans la comparaison de
    config si pertinent (suivre le pattern existant, ex. `show_thinking`).
- [ ] **`src-tauri/src/rpc_manager.rs`** : `spawn_and_start` reçoit un paramètre
      `skill_path: Option<&str>` (ou `&str` vide) ; si non vide, ajoute
      `--skill <path>`. (Évite de reconstruire la commande dans lib.rs.)
- [ ] **`src/js/agent-pi.js`** :
  - Ajouter le bouton 🛡️ dans `toolbar.innerHTML`.
  - Au chargement de l'onglet, lire l'état depuis la config (déjà disponible côté JS via
    `load_config`/`get_config` — réutiliser le pattern existant).
  - Au clic → toggle, `save_config`, puis relancer l'agent (appeler
    `stop_agent_session` + `start_agent_session` via `invoke`).
- [ ] **`src/css/style.css`** : style du bouton toggle actif/inactif.
- [ ] **Documentation** : `spec_pilot.md` (paramètres agent), `AGENTS.md` (navigation
      déjà présente), `Bugs et Evolutions.md` (pointer ici).

---

## 6. Points ouverts — résolus à l'implémentation

1. **Relance immédiate vs au prochain démarrage** : au clic sur 🛡️, doit-on relancer
   l'agent tout de suite (applique le set de skills immédiatement, mais interrompt
   la session en cours) ou seulement au prochain redémarrage de Pilot (l'utilisateur a
   dit « rechargé à chaque redémarrage de Pilot ») ? **Proposition : relance immédiate**
   avec avertissement, car les skills ne se rechargent pas à chaud — sinon l'option
   semble sans effet. À confirmer.
2. **Perte de contexte à la relance** : si `rpc_no_session` est true (pas de
   persistance), la relance perd l'historique de conversation. Si false (session
   persistée via `--session-dir`), l'historique est conservé. Préciser dans l'UI
   (infobulle).
3. **Contenu du SKILL.md embarqué** : copie exacte du skill global actuel (cf. §7) ?
   Ou version adaptée (références aux chemins Pilot) ? **Proposition : copie exacte**
   (le protocole est générique, pas spécifique à Pilot).
4. **Icône/label du bouton** : 🛡️ « Quality-gate » ? Autre ? À confirmer.
5. **`--skill` accepte-t-il un dossier (contenant `SKILL.md`) ou un fichier `.md`
   direct** ? Vérifier dans la doc/code pi par test. On partira sur un fichier `.md`
   direct (`--skill <config_dir>/skills/quality-gate/SKILL.md`).

---

## 7. Contenu embarqué du SKILL.md

Copie du skill global actuel
(`C:\Users\pldistance\.pi\agent\skills\quality-gate\SKILL.md`) — protocole anti-régression
en 3 phases (Analyse AVANT / Modification ciblée / Vérification APRÈS) + checklist.

Frontmatter :
```yaml
---
name: quality-gate
description: "Protocole anti-régression à activer avant toute modification de code..."
---
```

Le corps est repris tel quel du skill global (aucune adaptation Pilot nécessaire — le
protocole s'applique à toute modification de code, indépendamment du projet). Le
fichier source `src-tauri/skills/quality-gate/SKILL.md` est figé dans le repo Pilot et
embarqué à la compilation via `include_str!`.