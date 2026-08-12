# Spec — Agents du projet (multi-onglets configurés, issue #35)

> Document de spécification — Statut : ✅ **Implémenté**.
> Permet de définir un **nombre d'agents** par projet et de **nommer** chacun,
> avec rechargement automatique au démarrage du projet. S'appuie sur le
> multi-onglets agents (déjà implémenté).

---

## 1. Besoin

Pouvoir définir un nombre d'agents pour un projet et donner un nom à chacun. Le
nom de chaque agent s'affiche dans le **titre de son onglet**. Si l'option est
activée, au **démarrage du projet**, les agents paramétrés sont **rechargés**.

## 2. Décisions validées

| Point | Choix |
|---|---|
| Stockage | **`.pilot/agents.json`** dans le projet (versionné, partagé) |
| Bouton « + » | Reste visible, permet d'ajouter au-delà du nombre configuré |
| UI de config | Section dans la **modale des Paramètres** (onglet « Agent Pi ») |
| Renommage | **Manuel prime** ; la config fournit nombre + noms par défaut initiaux |

## 3. Format de `.pilot/agents.json`

```json
{
  "agents": [
    { "id": "agent-1", "name": "Codeur" },
    { "id": "agent-2", "name": "Revieweur" }
  ]
}
```

Les ids suivent le schéma `agent-N` du multi-onglets (l'agent principal est
`default`, non géré par la config). Le fichier est écrit par Pilot mais reste
éditable/versionnable (dépôt Git).

## 4. Backend

- `read_project_agents(projectPath) → Vec<ProjectAgent>` : lit `.pilot/agents.json`
  (liste vide si absent/invalide). `ProjectAgent { id, name }`.
- `write_project_agents(projectPath, agents)` : écrit le fichier (crée `.pilot/`
  si besoin).
- Module `src-tauri/src/project_agents.rs`, enregistré dans l'invoke_handler.

## 5. Frontend

### 5.1 Paramètres (modale)
Section « Agents du projet (multi-onglets) » dans l'onglet « Agent Pi » :
- Affiche le projet actif.
- Liste éditable des agents (id + champ nom + bouton ✕).
- « ＋ Ajouter un agent » : génère le prochain `agent-N` libre (évite les ids de
  la config et des onglets ouverts).
- « Enregistrer les agents » (et le bouton principal « Enregistrer ») : écrit
  `.pilot/agents.json`. À l'enregistrement (si multi-onglets activé), les agents
  paramétrés **non encore ouverts** sont ouverts immédiatement. Avertissement si
  le multi-onglets n'est pas activé.

### 5.2 Session d'onglets (`session-persistence.js`)
- `saveTabSession` stocke désormais `agents: [{id, name, index}]` (tous les
  onglets agents ouverts + noms, y compris renommés) en plus de `hadAgent`/
  `agentIndex` (conservés pour rétrocompatibilité).
- `restoreTabs` (si multi-onglets activé) fusionne config + session :
  1. Agent principal `default` de la session ;
  2. Agents configurés (nom renommé de la session si présent, sinon config) ;
  3. Agents de la session absents de la config (ajoutés via « + ») conservés.
  Chaque agent est rouvert via `tabs._openAgent(name, id)` puis repositionné
  (`_moveTabToIndex`, index ajusté pour le bouton « + »).
- La config est lue **en tête** de `restoreTabs` : la restauration des agents
  paramétrés s'exécute même si la session ne contient ni onglet d'édition ni
  onglet agent (ex: l'agent standard n'a jamais été ouvert, seule la config
existe).

### 5.3 Règle de fusion
- Config = set de base (nombre + noms initiaux).
- Renommage manuel (session) **prime** sur le nom configuré.
- Retirer un agent de la config **ne ferme pas** son onglet déjà ouvert (cela
  n'affecte que le rechargement au prochain démarrage).

## 6. Points de vigilance

- `_openNewAgentTab` lit aussi la config pour éviter un doublon d'id `agent-N`
  entre config et onglets manuels.
- Le multi-onglets doit être **activé** pour la restauration auto (sinon
  comportement historique : restauration de l'agent principal uniquement).
