# Rapport — nettoyage après l'arrêt de la mission « garde-fou des commandes destructrices »

- **Date de l'exécution** : 2026-11-20 17:36 (horloge du poste ; la décision du
  propriétaire qui motive ce nettoyage porte la date du 2026-11-21).
- **Décision qui motive le nettoyage** : « AUCUNE modification côté Pilot pour ce
  modèle local ; la couche d'adaptation (garde-fou des commandes destructrices,
  nettoyage des balises d'appel, gestion des outils) vit dans l'API séparée,
  jamais dans Pilot » (décision enregistrée sur la tâche #437, annulée).
- **Cadre reçu pour ce nettoyage** : retirer **uniquement** les fichiers nouveaux
  créés par la mission et remettre **uniquement** les fichiers existants qu'elle a
  modifiés dans leur état **enregistré** ; ne toucher à rien d'autre ; **ne pas
  réécrire l'historique, ne retirer aucun commit existant, ne rien publier, ne rien
  pousser**.
- **Résultat en une phrase** : **rien n'a été retiré ni remis, parce qu'il n'y
  avait rien à retirer ni à remettre** — le travail de cette mission n'était plus
  « non enregistré » : il avait été **committé** avant l'arrêt, et le dépôt est
  donc **déjà exactement dans son état enregistré**. Le point est signalé au § 4.

---

## 1. Constat, fait avant toute écriture

| Contrôle | Commande | Résultat |
|---|---|---|
| Fichiers suivis modifiés (non enregistrés) | `git diff HEAD` | **aucun** (sortie vide) |
| Modifications indexées non committées | `git diff --cached` | **aucune** |
| Fichiers nouveaux non suivis | `git status --porcelain` | **4** fichiers (voir § 3), tous d'**autres missions** |
| Travail mis de côté | `git stash list` | **aucun** stash |
| Arbre de travail secondaire / sous-module | `git worktree list`, `.gitmodules` | **aucun** (un seul arbre, aucun sous-module) |
| Écritures postérieures à la mission dans le dépôt | balayage des mtimes | **aucune** hormis les 16 fichiers du commit de la mission et les artefacts auto-régénérés de `.pilot/` |

Balayage complémentaire (hors `node_modules`, `target`, `dist`, `.git`) : **aucun**
fichier nouveau laissé par la mission ailleurs dans le dépôt, ni dans `.pi/`, ni
dans `.pilot/`, ni à la racine.

## 2. Pourquoi il n'y a rien à retirer : le travail est ENREGISTRÉ

La mission arrêtée est celle du **garde-fou des commandes destructrices**. Son
travail **existe**, mais il n'est pas resté « non enregistré » : il forme le
**commit `0f58085`** (« feat: garde-fou des commandes destructrices (accord
obligatoire, fail-closed) »), qui est **la tête de `main`** (arbre identique au
commit : `git diff HEAD` vide). Ce commit est **local seulement** : `main` est
**7 commits en avance** sur `origin/main`, rien n'a été poussé ni publié.

Ce que ce commit contient (mesuré, `git show --name-status`) :

- **fichiers nouveaux (6)** : `src/js/destructive-command.js`,
  `src-tauri/extensions/pilot-bash-guard.ts`, `src/js/commande-destructrice.test.js`,
  `src/js/porte-commandes-destructrices.test.js`,
  `src/js/confirmation-transmise-a-pi.test.js`,
  `docs/rapports/RAPPORT-garde-fou-commandes-destructrices.md` ;
- **fichiers existants modifiés (10)** : `README.md`, `help/overview.md`,
  `help/handbook.md` (généré), `spec_pilot.md`, `src-tauri/src/agent_service.rs`,
  `src/js/agent-pi.js`, `src/js/agent-question-surface.js`,
  `src/js/machine-sentinel.js`, `src/js/super-agent.js`, `vitest.config.js`.

## 3. Ce qui est laissé volontairement en place (non touché)

**Fichiers non suivis appartenant à d'autres missions** — aucun n'a été ouvert en
écriture, déplacé ni supprimé :

| Fichier non suivi | Mission d'origine | Pourquoi il reste |
|---|---|---|
| `docs/rapports/RAPPORT-banc-essai-gemma4-e4b-code-et-outils.md` | banc d'essai du modèle local | note de banc d'essai **à trancher**, hors garde-fou |
| `docs/rapports/RAPPORT-gemma4-e4b-apres-correction.md` | banc d'essai du modèle local | idem |
| `docs/rapports/RAPPORT-mode-dev-blocage-demarrage.md` | diagnostic « mode dev bloqué » (2026-11-13) | étranger au garde-fou |
| `docs/rapports/RAPPORT-etude-rangement-racine.md` | étude de rangement de la racine (2026-11-17) | étranger au garde-fou |

**Les 7 commits locaux non poussés** (dont `0f58085`) : laissés intacts, la
consigne interdisant de retirer un commit existant ou de réécrire l'historique.

## 4. Point signalé au propriétaire (et non tranché ici)

Le travail du garde-fou, **abandonné** par la décision du propriétaire (« jamais
dans Pilot »), est pourtant **présent dans Pilot sous forme enregistrée**
(commit `0f58085`, non poussé). Le sortir de Pilot ne peut donc pas se faire par
un simple retour à l'état enregistré : il faudrait un **commit de revert
explicite** (l'historique restant intact), ce qui est **hors du mandat reçu**
(« ne retire aucun commit existant », « à faire, et rien de plus »). Le retrait
n'a donc pas été décidé ici.

- **À trancher par** : le propriétaire, sur demande de l'assistant de suivi.
- **Échéance** : 2026-11-28 (porteur : assistant de suivi ; tâche datée à ouvrir
  si l'accord est donné).
- **Deux options, dites franchement** : (a) `git revert 0f58085` local, sans
  publication — Pilot retrouve l'état d'avant la mission ; (b) garder le commit
  en l'état et le documenter comme non voulu. Rien n'est perdu dans l'option (a) :
  le code reste dans l'historique.

## 5. Vérifications (le projet est comme avant)

Aucune ligne de code n'a été modifiée : les deux suites ont été relancées sur
l'arbre tel qu'il est, pour prouver qu'il est sain.

| Contrôle | Résultat |
|---|---|
| `npx vitest run` (front) | **339 fichiers, 6234 tests — 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **991 tests — 0 échec**, 3 ignorés |
| `git status --porcelain` après ce compte rendu | seuls les 4 rapports d'autres missions et ce compte rendu tant qu'il n'est pas committé |

Ce compte rendu est **committé localement** (aucun envoi, aucune publication),
pour que le dépôt soit propre au regard de la seule écriture de ce nettoyage.
