# RAPPORT — le nom de l'agent en attente devient lisible

Lot unique : dans la **file d'attente d'un projet**, la ligne d'une demande
**en attente** affichait l'**identifiant enregistré** de l'agent. Le pire cas est
l'agent principal du projet, dont l'identifiant est `default` : l'utilisateur
lisait « agent : default ».

Travail **front-end uniquement**, sans toucher ni à la composition de la file,
ni à l'envoi des missions, ni au registre des agents. Un seul commit local.

---

## 1. Etat AVANT (relu et recompté par moi sur le disque)

| Point | Constat |
|---|---|
| Composition de la file visible | `src/js/project-queue-view.js` (`readProjectQueueView`) lit les 4 files réelles et appelle `buildProjectQueueView` |
| Vue + textes | `src/js/project-task-queue.js` : `buildProjectQueueView`, `formatQueueReport` (texte `/file`), `formatQueueLines` (bloc de l'onglet) |
| Construction de la ligne | **une seule** : `entryLine` (`src/js/project-task-queue.js:230`), appelée par `formatQueueReport` (lignes 250 et 252) et `formatQueueLines` (lignes 279 et 281) |
| Nom de l'agent | `queueAgentLabel` (`src/js/project-task-queue.js:157`) renvoyait les identifiants **bruts**, joints par « , » |
| Défaut constaté | une demande dont l'agent enregistré est `default` s'affichait « · agent : default » |

Le texte de `entryLine` avant ce lot :

```
· agent : ${queueAgentLabel(entry)}      // → « · agent : default »
```

---

## 2. Ce que désigne réellement `default` (vérifié dans le code, pas supposé)

| Preuve recomptée | Ce qu'elle dit |
|---|---|
| `spec_project_agents.md:36` | « Les ids suivent le schéma `agent-N` du multi-onglets (**l'agent principal est `default`**, non géré par la config). » |
| `src/js/tabs.js:295` | l'ouverture d'un onglet agent passe `agentId || "default"` : `default` est l'**onglet agent standard**, celui qui existe pour **chaque** projet |
| `src/js/project-task-queue.js:385` | une commande manuelle mise en file sans agent précis reçoit `agentId || "default"` : c'est donc l'agent **par défaut du projet** qui la traitera |

Conclusion : `default` **n'est pas un nom technique quelconque**, c'est
l'**agent principal du projet** (l'onglet agent standard, hors
`.pilot/agents.json`).

---

## 3. Formule retenue, et pourquoi

Ajouts dans `src/js/project-task-queue.js` (tous **purs**, aucun import, aucun
accès Tauri, aucun appel réseau) :

| Symbole | Ligne | Rôle |
|---|---|---|
| `AGENT_DEFAULT_ID` | 92 | `"default"` — l'identifiant **enregistré** de l'agent principal |
| `AGENT_MAIN_LABEL` | 99 | `"principal du projet"` — la formule **affichée** |
| `AGENT_LABELS` | 108 | la **seule** table identifiant → libellé (une seule entrée) |
| `agentIdLabel(agentId)` | 118 | traduction d'**un** identifiant ; tout autre identifiant est rendu **tel quel** |
| `queueAgentLabel(entry)` | 157 | applique `agentIdLabel` à chaque identifiant de la demande |

Formule choisie : **« principal du projet »**.

Pourquoi celle-là plutôt que « agent principal du projet » : la ligne de la
file dit **déjà** « · agent : … ». Écrire « agent principal du projet »
donnerait « agent : agent principal du projet ». La formule retenue est la plus
**courte** et la plus **vraie** dans ce contexte :

```
- en attente (2e) : commande « corrige le bug 12 » · agent : principal du projet
```

Elle est **vraie** (c'est bien l'agent principal du projet, cf. § 2) et
**compréhensible sans connaissance technique** : plus aucun identifiant
(`default`) n'apparaît.

---

## 4. Ce qui reste en identifiant brut, et pourquoi

| Cas | Affichage | Raison |
|---|---|---|
| `codeur`, `reviewer`, `testeur`… | inchangé (`agent : codeur`) | ce sont déjà des noms lisibles, **enregistrés** avec la demande |
| `agent-1`, `agent-2`… | inchangé (`agent : agent-1`) | le **nom réel** de cet agent vit dans `.pilot/agents.json` ou dans la session (renommage manuel) : il faudrait une **lecture disque** (ou Tauri) que la file ne doit pas faire. Rien n'est **inventé** (« Agent 1 » contredirait un agent renommé) |
| agent inconnu | `agent : agent non défini` (`AGENT_UNKNOWN_LABEL`) | comportement existant, conservé |
| ligne « **en cours** » | inchangée (aucun suffixe d'agent) | hors périmètre de ce lot, comme demandé |

---

## 5. Un seul point d'affichage (pas de double correction)

```
queueAgentLabel (project-task-queue.js:157)
   └── agentIdLabel (:118)        ← la SEULE traduction identifiant → libellé
       └── entryLine (:230)       ← la SEULE construction de la ligne
           ├── formatQueueReport  → commande `/file`
           └── formatQueueLines   → bloc discret de l'onglet agent
```

Vérifié : `entryLine` n'apparaît **que** dans `src/js/project-task-queue.js`
(aucun autre fichier ne construit la ligne de file). L'identité **stockée** avec
la demande n'est **pas** réécrite : `queueAgentIds` continue de renvoyer
l'identifiant enregistré (`["default"]`), seul l'**affichage** change.

Rien d'autre n'a bougé : ordre, rangs, nombre de demandes, ligne « en cours »,
couleurs (aucune teinte ajoutée), envoi des missions, registre des agents.

---

## 6. Tests

### 6.1 Comptes avant / après

| Moment | Commande | Résultat |
|---|---|---|
| **Avant** (worktree non modifié) | `npx vitest run` | **PASS (3162) — FAIL (0)** |
| **Après** | `npx vitest run` | **PASS (3167) — FAIL (0)** |

Soit **+5 tests** (un nouveau bloc `f.` dans le fichier de preuves existant,
aucun test supprimé) : le fichier `src/js/file-attente-nom-agent.test.js` passe
de 12 à 17 tests.

Tests **mis à jour** (jamais supprimés) : `src/js/file-attente-nom-agent.test.js`
— nouveau `describe("f. l'agent principal du projet ne s'affiche pas « default »")`
(5 tests) :

1. **la morsure** — aucune ligne **affichée** (rapport `/file` **et** bloc de
   l'onglet, toutes familles de demandes) ne contient la chaîne `default`, et
   aucun libellé d'agent n'est vide ;
2. la formule « principal du projet » est celle des **deux** points d'affichage,
   et `queueAgentLabel` / `agentIdLabel` la renvoient ;
3. un mélange `default` + `codeur` donne « principal du projet, codeur » (ordre
   conservé, seule l'identité principale est traduite) ;
4. l'identité **stockée** reste `["default"]` (le registre ne bouge pas), alors
   que l'affichage dit « principal du projet » ;
5. les autres identifiants (`codeur`, `agent-1`) restent **tels quels**
   (aucun nom inventé).

### 6.2 Preuve que le test mord (phase rouge, puis verte)

1. Test écrit **avant** la correction, sans la traduire : `npx vitest run
   src/js/file-attente-nom-agent.test.js` →
   **`Tests 3 failed | 13 passed (16)`**, avec la ligne réellement reçue :

   ```
   - en attente (1er) : commande « commande de l'agent principal » · agent : default
   ```

2. Correction appliquée → le même fichier : **PASS (17) — FAIL (0)**.

3. **Contre-épreuve** (morsure réelle, pas un test complaisant) : remise
   temporaire de l'ancien `return ids.join(", ")` (traduction neutralisée) →
   **`Tests 4 failed | 13 passed (17)`**, mêmes lignes fautives ; puis
   restauration à l'identique (`ids.map(agentIdLabel)`) → **PASS (17)** et suite
   complète **PASS (3167) — FAIL (0)**.

Aucune référence Tauri : ces tests exercent les fonctions **pures** ; le câblage
réel reste prouvé par `src/js/project-queue-wiring.test.js` (inchangé, vert).

---

## 7. Documentation mise à jour

| Fichier | Modification |
|---|---|
| `spec_gestion_agents.md` | bloc d'aide `<!-- HELP:agents -->` : l'agent principal s'affiche « agent : principal du projet », l'identifiant `default` n'est jamais montré ; paragraphe technique : rôle de `agentIdLabel`, identité stockée non réécrite, file toujours pure et synchrone |
| `spec_super_agent.md` | bloc d'aide `<!-- HELP:file-attente-identite-mission -->` : même règle (agent principal lisible, `default` jamais affiché) |
| `help/handbook.md` | **régénéré** par `npm run build:handbook` (45 blocs, 272809 octets) — jamais édité à la main |

---

## 8. Ce qui reste à faire (hors de ce lot)

- **Noms des agents configurés** (`agent-1`, `agent-2`…) dans la file : ils
  restent des identifiants. Les rendre lisibles demanderait de **passer le nom**
  au moment de la mise en file (comme pour le libellé), pas une lecture à
  l'affichage — c'est une décision à prendre, ce lot ne la prend pas.
- La ligne « **en cours** » affiche encore l'identifiant brut de l'agent
  (`src/js/project-queue-view.js:85`) : volontairement **hors périmètre**.
- L'en-tête de relais des questions d'agent (`src/js/super-agent.js`, « par
  défaut ») est un **autre** point d'affichage : non touché ici.

---

VERDICT : livré — `default` ne s'affiche plus jamais dans la file ; l'agent principal du projet se lit « agent : principal du projet », les autres identifiants restent tels quels (aucun nom inventé), au seul point d'affichage `entryLine` ; tests 3162 → 3167 verts, morsure prouvée, documentation et aide régénérées, un seul commit local.
