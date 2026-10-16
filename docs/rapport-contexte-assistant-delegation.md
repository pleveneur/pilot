# Rapport — Contexte de suivi joint automatiquement à la demande déléguée

**Date :** 2026-10-16
**Périmètre :** onglet 🧭 Assistant (super-agent) — délégation aux agents.
**Statut :** implémenté, testé, committé en local (aucun push, aucun tag).

---

## 1. Cause (le problème constaté)

Quand l'Assistant confiait une tâche à un agent (agent du projet, agent hors
projet ou `delegate_to_coder`), il envoyait **la demande seule**. L'agent
démarrait donc **sans savoir** ce qui avait déjà été fait, décidé ou réglé sur
le projet : il pouvait **refaire** un travail déjà fait, **contredire** une
décision déjà prise, ou ignorer un blocage déjà connu. Conséquence : des
allers-retours inutiles (et des tokens consommés pour rien).

Le suivi existait pourtant déjà (base de suivi de l'Assistant + mémoire de
session), mais **rien ne le transmettait à l'agent au moment de la délégation**.

---

## 2. Ce qui a changé

Avant de lancer un agent, l'Assistant **préfixe à la demande un bloc de
contexte COURT et BORNÉ**, construit **uniquement** à partir de son suivi :

```
## Contexte de suivi (assistant)
- Projet : pilot
- Taches suivies : 2 en cours, 5 terminees
- Decisions recentes : ...
- Deja traite (sessions) : ...
- Sujet en cours : ...
- Chantiers en cours : ...
- Notes de suivi : ...
- Objectif de la demande : <objectif de la demande>
```

Règles respectées :

| Exigence | Mise en œuvre |
|---|---|
| Court, borné | plafond **700 caractères**, troncature **annoncée** dans le texte |
| Séparé de la demande | titre propre (`## Contexte de suivi (assistant)`) puis la demande complète |
| Rien d'inventé | si le projet n'est pas suivi **et** la mémoire est vide → **aucun bloc**, la demande part inchangée |
| Les deux familles de délégation | `run_agents` (projet), `run_assistant_agents` (hors projet) **et** `delegate_to_coder` |
| Visible dans la conversation | message système « 🧠 Contexte de suivi joint à la demande de l'agent. » |
| Fail-open | toute erreur (base indisponible) → aucun bloc, **la délégation n'est jamais bloquée** |

Détails de contenu :

- **Projet** : nom du projet **suivi** (retrouvé par son chemin, tolérant aux
  séparateurs `\` / `/`, à la casse et à la barre finale). Si le suivi ne
  connaît pas le projet, le nom est déduit du **chemin cible** — mais seulement
  s'il y a autre chose à dire.
- **Tâches suivies** : compteurs du projet (en cours / terminées).
- **Décisions récentes** : 2 maximum. La base de suivi les expose **par client** ;
  quand le client suit **plusieurs projets**, la ligne le dit explicitement
  (« Décisions récentes (client X) ») pour ne pas faire passer une décision d'un
  autre projet pour une décision de celui-ci.
- **Déjà traité (sessions)** : la session la plus récente **du projet** (les
  résumés de sessions sont préfixés du nom du projet, donc filtrables).
- **Sujet en cours / Chantiers en cours / Notes de suivi** : mémoire de session
  de l'Assistant (3 chantiers maximum).
- **Objectif de la demande** : la demande déléguée, bornée à 300 caractères.

---

## 3. Où (fichiers touchés)

| Fichier | Nature |
|---|---|
| `src/js/super-agent-context.js` | **nouveau** — module **pur** (aucune I/O) : `buildDelegationContext`, `boundDelegationContext`, `prefixDelegationContext`, `findTrackedProject`, `parseSessionMemory`, `normalizeProjectPath`, + constantes (`MAX_DELEGATION_CONTEXT_CHARS = 700`, `DELEGATION_CONTEXT_TITLE`, `DELEGATION_CONTEXT_TRUNCATION_NOTICE`) |
| `src/js/super-agent.js` | branchement : import, `loadDelegationContext` (lecture `get_super_agent_tracking` + `super_agent_load_session_memory`, fail-open) et `attachDelegationContext` (joint le bloc + le signale dans la conversation), appelés aux **3 points de délégation** |
| `src/js/super-agent-context.test.js` | **nouveau** — 28 tests (module pur + verrouillage du branchement des 3 chemins) |
| `spec_super_agent.md` | section « Contexte de suivi joint automatiquement à la demande déléguée » + bloc `<!-- HELP:super-agent-delegation-context -->` |
| `help/handbook.md` | **généré** (`npm run build:handbook`) — aide intégrée à jour |
| `docs/rapport-contexte-assistant-delegation.md` | ce rapport |

**Aucun fichier Rust n'a été modifié** : le contexte est assemblé côté front
(JS) à partir de commandes Tauri de lecture déjà existantes. Aucune nouvelle
permission, aucun nouvel appel réseau.

---

## 4. Comment vérifier

1. **Tests interface (JS)** — tous verts :
   ```bash
   npm test            # attendu : PASS (1551) FAIL (0)
   ```
   Dont les 28 nouveaux :
   ```bash
   npx vitest run src/js/super-agent-context.test.js   # PASS (28) FAIL (0)
   ```

2. **Tests cœur (Rust)** — inchangés, tous verts (aucun code Rust touché) :
   ```bash
   cargo test --manifest-path src-tauri/Cargo.toml --lib
   # attendu : 550 passed, 1 ignored (le warning sqlx-postgres est préexistant)
   ```

3. **À l'usage** (vérification fonctionnelle) :
   - ouvrir un projet **suivi** par l'Assistant (onglet 🧭 → Suivi) ;
   - lui demander une tâche de code (« ajoute un test sur X ») ;
   - **attendu** : un message « 🧠 Contexte de suivi joint à la demande de
     l'agent. » apparaît, et la demande reçue par l'agent commence par
     `## Contexte de suivi (assistant)` (projet, tâches, décisions, sessions,
     sujet en cours), suivie de la demande complète ;
   - **attendu (cas « rien à dire »)** : sur un projet **non suivi** et sans
     mémoire de session, **aucun** message de contexte et **aucun** bloc : la
     demande part telle quelle.

4. **Contrôle du garde-fou de longueur** (testé) :
   `boundDelegationContext` ne dépasse **jamais** le plafond, même avec des
   données de suivi volumineuses, et annonce la troncature.

---

## 5. Ce qui reste (hors périmètre, non fait)

- **Décisions réellement par projet** : la base de suivi les expose par
  **client**. La ligne est donc étiquetée honnêtement en cas de client
  multi-projets. Une commande dédiée (décisions par projet) supprimerait cette
  approximation — non ajoutée ici pour rester sur un changement minimal.
- **Blocages connus** : repris via les « Notes de suivi » de la mémoire de
  session (pas de champ « blocage » dédié dans la base de suivi).
- **Rendu visuel du bloc** : il est visible **dans la conversation de l'agent**,
  pas replié/encadré comme un composant d'interface dédié.
- **Le bloc n'est pas dédupliqué** si la demande contient déjà un
  `## Contexte` : c'est volontaire (le bloc de l'Assistant est identifiable par
  son titre), mais un jour on pourra fusionner les deux.
