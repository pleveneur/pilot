# RAPPORT — le nom du personnage actif s'applique partout

Date : 2026-11-19 · Spec : `spec_super_agent.md` (Technique — nom et portrait du personnage actif)

## 1. Défaut constaté

Personnage activé par **Présences** : `%APPDATA%\com.pilot.editor\.pilot\portrait\nom.txt`
contient « Sylvie » et `portrait.png` existe. La lecture Rust
(`read_assistant_persona`, `src-tauri/src/persona.rs`) renvoyait bien `{name:"Sylvie", …}`
— mais Pilot continuait d'afficher **« Nova »**, le nom **réglé**
(`super_agent_name`), dans l'onglet 🧭 **et** dans la liste des agents
(cercle en haut à droite).

Le titre de l'onglet appliquait déjà la règle unique
`personaDisplayName(personnage, nom réglé)` (`superAgentDisplayLabel()`),
mais la **liste des agents** ne la connaissait pas :
`flattenAgents()` (`src/js/agent-activity.js`) prenait le libellé rendu par la
supervision, et `dashboard.rs` construit ce libellé depuis le **nom réglé**
(champ `name` de la session). Le personnage était donc ignoré sur cette
surface, quelle que soit la qualité de la lecture.

## 2. Correctif (une seule règle, aucun redémarrage)

| Fichier | Changement |
|---|---|
| `src/js/agent-activity.js` | `flattenAgents()` calcule le libellé de l'assistant par `personaDisplayName(getAssistantPersonaName(), a.name || a.agent)`. **Aucune copie** de la priorité : elle est importée de `assistant-persona.js`. L'**identité** (`agentId`, `rawId`, `kind`) est inchangée. |
| `src/js/super-agent.js` | `findAssistantSessionAgent(agents, label, configuredLabel)` accepte les **deux** noms (affiché puis réglé). La session d'assistant est enregistrée côté moteur sous le nom réglé : sans cela, activer un personnage faisait échouer la sonde de supervision (« Connexion au super-agent perdue », état de travail faux). |
| `src/js/main.js` | Relevé du personnage au **démarrage** de Pilot puis à chaque **retour de focus**, pour toutes les surfaces — la liste des agents n'existait jusqu'ici qu'après ouverture de l'onglet 🧭. `fail-open` (`.catch(() => {})`). |
| `src/js/assistant-persona.js` | `refreshAssistantPersona()` garde la **lecture en cours** : les deux appelants d'un même événement (onglet + `main.js`) partagent une seule lecture disque (le portrait pèse plusieurs Mo). Deux relevés **successifs** lisent bien deux fois. |

Portrait : inchangé, il était déjà correct (`tabs.js::_renderTabButton` →
`<img class="tab-avatar">` si `getAssistantPortrait()` existe, sinon 🧭).
Fichier absent = aucun personnage = nom réglé et icône habituelle, sans message.

## 3. Preuves

- `src/js/assistant-nom-partout.test.js` (**7 tests**) : avec « Sylvie » → la
  liste affiche « Sylvie » ; sans fichier → « Nova » ; un codeur garde son nom ;
  la lecture alimente la liste sans redémarrage ; la sonde retrouve la session
  sous le nom réglé ; une seule lecture par événement ; garde de source (la
  règle n'est pas recopiée).
- Contre-épreuve jouée : en remettant l'ancienne ligne `const label = a.name || a.agent || "";`,
  le fichier tombe à **4 échecs** — le test échoue bien si le personnage est ignoré.
- `npx vitest run` : **4588 passés, 0 échec** (aucune régression, y compris les
  tests de l'écran Vocal).

## 4. Documentation

- `spec_super_agent.md` : bloc d'aide « Le personnage actif (nom et portrait) »
  (liste des agents + démarrage/focus) et section Technique (branchements,
  **nom affiché ≠ nom de session**, lecture partagée, couverture).
- `npm run build:handbook` relancé (`help/handbook.md`, 47 blocs).

## 5. Hors périmètre (respecté)

Nom réglé inchangé (« Nova » reste le repli) · aucune écriture dans le dossier
du personnage · écran Vocal, barre qui s'efface et calque des clics non
touchés · `list_agent_sessions` non utilisé.
