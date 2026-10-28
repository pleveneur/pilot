# RAPPORT — chaque demande en attente dit quel agent la traite

Tâche : devant la **file d'attente d'un projet**, une demande **en attente** doit
afficher **le nom de l'agent qui la traitera**, à côté de son **rang** et de son
**libellé**. Jamais de champ vide : si l'agent est inconnu, la ligne doit
l'écrire. La tâche **en cours** (rang 1) garde son affichage.

Travail **front-end uniquement** (`src/js`), un seul commit local.

---

## 1. Existant constaté (recompté par moi, pas recopié d'une consigne)

### 1.1 Où la file est composée et où elle s'affiche

| Élément | Fichier | Rôle recompté |
|---|---|---|
| Composition de la file visible | `src/js/project-queue-view.js` | `readProjectQueueView(project)` lit les **4 files réelles** et appelle `buildProjectQueueView` |
| Vue + textes | `src/js/project-task-queue.js` | `buildProjectQueueView`, `formatQueueReport` (texte `/file`), `formatQueueLines` (bloc de l'onglet) |
| Bloc discret de l'onglet agent | `src/js/agent-pi.js` | appelle `formatQueueLines` |
| Commande `/file` | `src/js/agent-pi.js` + `project-queue-view.js` | appelle `formatProjectQueueReport` |

**Recompte des points d'affichage (fait par moi) :**

```
grep -rn "en attente (" src/js/*.js | grep -v test
→ une seule construction de la ligne : project-task-queue.js:186 (entryLine)
grep -rn "formatQueueLines\|formatProjectQueueReport" src/js/*.js | grep -v test
→ 2 appelants (bloc de l'onglet, `/file`) qui passent tous deux par le MÊME module
```

**Conclusion : un seul point d'affichage** (la fonction `entryLine` de
`project-task-queue.js`), partagé par le bloc de l'onglet et `/file`. **Aucune
duplication n'a été trouvée** — donc rien à corriger deux fois.

### 1.2 L'agent était-il déjà enregistré avec la demande ?

**Oui, pour les 4 familles** (recompté dans le code, pas supposé) :

| Famille | Où l'agent est enregistré | Champ |
|---|---|---|
| Mission de l'assistant (`run_agents`) | `allocateMissionIdentity(agentIds)` → `stampQueuedMission` (`mission-identity.js`) **à la mise en file** | `agentIds[]` |
| Commande manuelle du chat | `enqueueProjectCommand({ agentId })` (`agent-pi.js:1292`) | `agentId` |
| Délégation (`delegate_to_coder`, #66) | `delegationState(p).queue.push({ …, agentId })` (`super-agent.js:6287`) | `agentId` |
| Demande d'agent en file d'exclusivité | `listProjectExclusivityEntries(p)` (`agents-bus.js`) | `agentId` |

**Le nom n'avait donc pas à être « déterminé plus tard »** : il est enregistré
**au moment de la mise en file** dans les 4 cas (aucun chemin ne met en file une
demande sans agent — sauf entrée forgée/ancienne, traitée en §3).

Le défaut était donc **uniquement d'affichage** : `agentIds` / `agentId`
n'étaient **pas** propagés jusqu'à la ligne. Pire, pour la famille
**délégation**, `getProjectDelegationQueue` **jetait** `agentId` (`{ label }`
seulement) : l'information existait et était perdue en route.

---

## 2. Ce que j'ai ajouté (le strict minimum)

### 2.1 `src/js/super-agent.js` — la délégation ne jette plus son agent

```js
export function getProjectDelegationQueue(projectPath) {
  const queue = (delegationState(projectPath).queue || []);
  return queue.map((item) => ({
    label: String((item && item.request) || "délégation"),
    agentId: String((item && item.agentId) || ""),
  }));
}
```

Un seul champ **relu** (aucun agent inventé, aucune valeur par défaut).

### 2.2 `src/js/project-task-queue.js` — lecture, libellé, affichage

- `AGENT_UNKNOWN_LABEL = "agent non défini"` : la phrase affichée quand la
  demande ne porte **aucun** agent (jamais un blanc).
- `queueAgentIds(entry)` : lit **uniquement** `agentIds` (tableau, mission) et
  `agentId` (chaîne, les 3 autres familles), ignore les valeurs vides ou non
  textuelles, dédoublonne.
- `queueAgentLabel(entry)` : joint les agents (`"codeur, testeur"`) ou renvoie
  `AGENT_UNKNOWN_LABEL`.
- `normalizeEntries` transporte `agentIds` **avec** l'entrée normalisée ;
  `buildProjectQueueView` le recopie dans `view.waiting[]` → l'affichage ne
  relit jamais la file d'origine (aucune seconde source).
- `entryLine(entry, running)` : la ligne d'une demande **en attente** gagne
  ` · agent : <…>`. La branche `running` **n'est pas modifiée** (tâche en cours =
  affichage actuel).

Rendu réel :

```
- en cours : agent « codeur »
- en attente (2e) : commande « corrige le bug 12 » · agent : codeur
- en attente (3e) : mission « écrire la documentation » · agent : documenteur
```

Rangs, ordre des familles et nombre de demandes : **inchangés** (même code de
calcul, `rank` attribué comme avant).

### 2.3 Origine du nom affiché (réponse nette)

Le nom affiché est **l'identifiant d'agent enregistré avec la demande** :
`agentIds`/`agentId` tels quels. Aucune table de correspondance, aucune
constante, aucun nom codé en dur. Conséquence assumée et vérifiée : pour
l'onglet de l'**agent principal** du projet, l'identifiant enregistré est
`default` — c'est la valeur réellement portée par la demande, pas un nom
inventé. La correspondance identifiant → **nom du registre** (`list_agents`) est
**asynchrone** ; l'ajouter au point d'affichage aurait rendu la file dépendante
de Tauri (module volontairement pur, testable sans Tauri). Ce point est écrit en
« Limite » (§6), pas masqué.

---

## 3. Jamais de champ vide

Cas où l'agent n'est pas connu (entrée forgée, ancienne file, `agentIds: []`) :
`queueAgentLabel` renvoie `"agent non défini"` → la ligne affiche
`… · agent : agent non défini`. Un test vérifie qu'**aucune** ligne de demande en
attente ne peut contenir `agent :` suivi de rien (§4.b).

---

## 4. Tests

Base de test du projet : `npx vitest run`.

### 4.1 Nouveau fichier — `src/js/file-attente-nom-agent.test.js` (12 tests)

| Bloc | Ce qui est prouvé |
|---|---|
| **a** (4 tests) | Le nom de l'agent est affiché pour **chaque** famille (commande, mission, délégation, agent), dans `/file` **et** dans le bloc de l'onglet ; il vient de la **demande** (`enqueueProjectCommand` réelle) ; plusieurs agents visés sont tous nommés. |
| **b** (2 tests) | Agent inconnu ⇒ `agent non défini` ; **aucune** ligne `en attente (…)` n'affiche `agent :` vide (8 lignes contrôlées : 4 demandes × 2 affichages). |
| **c** (1 test) | Aucun nom inventé : seuls les champs `agentIds`/`agentId` sont lus, une entrée sans agent n'en produit aucun. |
| **d** (2 tests) | La tâche **en cours** garde son affichage (pas de suffixe d'agent), dans `/file` et dans le bloc. |
| **e** (3 tests) | Ordre, rangs (2,3,4,5 puis 1er), `waitingCount` et association agent↔demande **inchangés** ; file vide = vide. |

### 4.2 Test ajouté au fichier existant — `src/js/project-queue-wiring.test.js` (+1 test)

Sur la **file réelle** (`readProjectQueueView` / `formatProjectQueueReport`,
harnais existant) : mission de l'assistant (`agentIds:["reviewer"]`), commande
manuelle (`agentId:"codeur"`), délégation (`agentId:"testeur"`) ⇒ chaque ligne
nomme **son** agent ; une mission sans agent ⇒ `agent : agent non défini` et
**aucune** ligne vide. C'est ce test qui prouve le correctif de la famille
**délégation** (§2.1).

**Aucun test existant n'a été supprimé ni affaibli** : seuls des `it()` ont été
ajoutés (fichier existant) et un fichier créé. Les suites du domaine
(`project-task-queue.test.js`, `file-attente-retrait-mission.test.js`,
`file-attente-fifo-admission.test.js`) passent sans modification.

### 4.3 Preuve que les tests **mordent** (mutations réelles, exécutées)

1. **On retire le nom de l'affichage** (`entryLine` sans le suffixe) :

```
mutation: nom retire
PASS (25) FAIL (7)   ← 7 échecs, dont les 4 de « a », celui de « b » et celui du câblage
restauration :
PASS (32) FAIL (0)
```

2. **Un agent inconnu n'est plus dit** (`queueAgentLabel` renvoie `""` au lieu de
   `AGENT_UNKNOWN_LABEL`) :

```
mutation: nom vide au lieu de « agent non defini »
PASS (29) FAIL (3)   ← dont « aucune ligne n'affiche agent : suivi de rien »
restauration :
PASS (32) FAIL (0)
```

Les deux exigences de test demandées (nom qui **disparaît** / nom **vide**
affiché) échouent donc bien quand la règle casse.

### 4.4 Comptes avant / après

| Moment | Résultat `npx vitest run` |
|---|---|
| **Avant** (baseline, mesurée deux fois avant toute modification) | `PASS (2999) FAIL (0)` — exit 0 |
| **Après** | `PASS (3012) FAIL (0)` — exit 0 |
| Delta | **+13** = 12 (nouveau fichier) + 1 (câblage) — aucun test supprimé |

---

## 5. Documentation mise à jour

| Fichier | Mise à jour |
|---|---|
| `spec_gestion_agents.md` — bloc `<!-- HELP:agents -->` (« File d'attente du projet ») | la file **nomme l'agent** de chaque demande en attente ; agent inconnu ⇒ « agent non défini », jamais un blanc ; tâche en cours inchangée |
| `spec_gestion_agents.md` — § technique « Affichage » | liste des **sources réelles** de l'agent (`agentIds` mission, `agentId` commande/délégation/exclusivité), **point d'affichage unique** `entryLine`, `AGENT_UNKNOWN_LABEL`, ligne « en cours » inchangée |
| `spec_gestion_agents.md` — § « Tests » | ajout de `src/js/file-attente-nom-agent.test.js` et du cas « agent réel de chaque famille » |
| `spec_super_agent.md` — bloc `<!-- HELP:file-attente-identite-mission -->` | « **la file affiche ces agents** » : rang + libellé + agent, dans le bloc de l'onglet comme dans `/file` |
| `help/handbook.md` | **régénéré** par `npm run build:handbook` (45 blocs, 262 358 octets) — jamais édité à la main |

---

## 6. Limites écrites noir sur blanc

1. **L'affichage montre l'identifiant d'agent**, pas le libellé du registre
   (`Codeur`, `Reviewer`…) : la résolution id → nom est asynchrone
   (`list_agents`) et ajouterait Tauri au module de la file (pur par
   conception, testé sans Tauri). Pour l'agent **principal** du projet,
   l'identifiant enregistré est `default`, affiché tel quel.
2. Une demande **déjà en cours** ne dit pas son agent : c'est **voulu** (la
   consigne est de garder l'affichage actuel du rang 1).
3. Rien n'a été fait pour les demandes **sans agent** (entrées forgées) : elles
   l'écrivent, rien de plus — l'agent n'est pas deviné après coup, il n'existe
   aucun chemin de mise en file qui l'omette (§1.2).

---

## 7. Ce qui n'a **pas** été touché

- **Formulaire de demande et envoi des missions** : intacts (`agent-pi.js`,
  `sendPrompt`, `run_agents`, `launchOrQueue`, admission FIFO) — aucune ligne
  modifiée dans ces chemins.
- Ordre de la file, rangs, plafonds, rejeu, abandon, retrait ciblé
  (`removeProjectQueuedMission`, `/file retire`), `/file vide` : **intacts**.
- Barre du bas, thèmes/couleurs, aide, onglet 🧭 lui-même : **intacts**. Aucune
  couleur ni teinte ajoutée (la ligne est du **texte** dans le style existant
  `.agent-queue-block`, aucun jeton de thème nouveau, donc aucun contraste à
  mesurer).
- Backend Rust : **aucune** modification.
- Aucun appel à `list_agent_sessions` ni à un outil de listing de sessions.

Fichiers modifiés par ce lot (vérifiable par `git diff --stat`) :
`src/js/project-task-queue.js`, `src/js/super-agent.js`,
`src/js/project-queue-wiring.test.js`, `spec_gestion_agents.md`,
`spec_super_agent.md`, `help/handbook.md` — plus le nouveau
`src/js/file-attente-nom-agent.test.js`.

Commit local unique prévu :
`feat(file): chaque demande en attente dit quel agent la traite`
(aucun autre `RAPPORT-*.md` committé).

VERDICT : la file nomme désormais l'agent de chaque demande en attente (4 familles sur 4, un seul point d'affichage, aucun nom vide ni inventé), la tâche en cours et l'ordre/les rangs sont inchangés, 13 tests ajoutés dont 2 prouvés mordants par mutation, suite complète 3012 PASS / 0 FAIL (avant 2999 / 0).
