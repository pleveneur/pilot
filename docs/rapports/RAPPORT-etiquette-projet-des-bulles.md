# Rapport — l'étiquette de projet des bulles nomme le projet réellement concerné

Date : 2026-11-15 · Projet : `G:\IA_PL\pilot` · Branche : `main`
Demande du propriétaire : sur une **autre installation** de Pilot, l'étiquette de
projet affichée en haut des bulles de l'Assistant nomme le **projet actif de la
fenêtre de conversation** au lieu du projet réellement concerné par l'échange.
Régression de confiance (déjà signalée), à corriger sans casser l'existant.
Protocole `quality-gate` appliqué (`.pi/skills/quality-gate/SKILL.md`).

---

## 1. Symptôme reproduit

1. La fenêtre de conversation est ouverte sur le projet **A**.
2. L'Assistant délègue une mission en visant explicitement un **autre** projet
   **B** (paramètre `project` de l'outil de délégation). La mission travaille
   bien dans **B** (fichiers, commits), et la réponse parle de **B**.
3. L'étiquette de la bulle de réponse affiche **A**.

Conséquence : le propriétaire croit qu'aucun travail n'a été fait sur **B**.

## 2. Cause trouvée (constatée dans le code, pas supposée)

La bulle de l'Assistant est créée à la réception de `message_start`, donc
**avant** l'appel d'outil qui porte le projet visé :

- `createSuperAgentBlock` figeait l'étiquette à partir de
  `resolveBubbleBadgeNames(explicitBadges, currentTurnProjectBadges,
  currentTurnConcernedBadges, currentOpenProjectBadges())` ;
- à ce moment, `currentTurnConcernedBadges` est **vide** (la mission n'a pas
  encore été demandée) et `currentTurnProjectBadges` est vide si le message de
  l'utilisateur ne nomme aucun projet ;
- la règle (4) « dernier recours » retenait donc le **projet ouvert à l'écran**,
  qui devenait le badge principal ;
- `noteConcernedProject(...)` était bien appelé au lancement réel
  (`run_agents`, `delegate_to_coder`, `open_project`), mais **trop tard pour
  cette bulle** : à `agent_end`, `extendResponseBubbleBadges` ne savait
  qu'**AJOUTER** des noms (`extendBadgesWithText(base, texte, candidats)`), la
  base restant en tête. Une mission sur B donnait donc « A, B » — le projet non
  concerné en premier.

Le mécanisme manquait d'une information : **la provenance** du badge figé
(prouvé ? simple dernier recours ?). Sans elle, impossible de distinguer un nom
qu'on a le droit de remplacer d'un nom qu'il faut conserver.

## 3. Correction

### 3.1 Module dédié, décisions pures (nouveau fichier)

`src/js/super-agent-project-label.js` — **source unique** de la décision, sans
DOM et sans `invoke` :

- `PROJECT_LABEL_SOURCE` — provenance : `explicit`, `named`, `mission`,
  `open-project`, `none` ;
- `normalizeProjectLabels` — noms nettoyés, sans doublon, jamais de nom inventé ;
- `isProvenLabelSource` — une provenance **prouvée** (jamais retirée) ;
- `decideMessageProjectLabel(explicit, named, concerned, openProject)` —
  décision **à la création de la bulle** (ordre inchangé : explicite > nommé >
  visé > projet ouvert > rien) ;
- `decideFinalBubbleProjectLabel(frozen, frozenSource, concerned, cited)` —
  décision **à la fin du tour** : les projets **réellement visés** passent en
  tête (le premier est le **projet principal**, les autres sont **signalés**),
  un badge de **dernier recours s'efface**, un nom **prouvé** ne recule jamais,
  un projet cité par la réponse efface un dernier recours, et un message
  purement conversationnel retombe sur le projet actif ;
- `projectLabelBadgeTitles(decision)` — infobulle : « Projet principal de la
  mission », « Autre projet concerné par l'échange »… et **rien** pour un badge
  de dernier recours (il ne prétend rien).

### 3.2 Branchement (un seul point d'écriture)

- `src/js/super-agent.js`
  - `bubbleBadgeSources` (WeakMap) : la **provenance** est figée avec chaque
    bulle, à côté du snapshot des noms ;
  - `createSuperAgentBlock` : appelle `decideMessageProjectLabel(...)` au lieu
    de composer l'ordre sur place ;
  - `renderProjectBadgesInto(bubble, badgeNames, titles = null)` : paramètre
    d'infobulle **optionnel** — les bulles de l'utilisateur, les messages
    système et les relais ne changent pas (aucune infobulle) ; reste le
    **seul** endroit qui crée la rangée `.agent-project-badges` ;
  - `extendResponseBubbleBadges(bulle, base, source, visés, texte)` : applique
    `decideFinalBubbleProjectLabel` et réécrit l'étiquette (même fonction de
    rendu) ;
  - `agent_end` : capture la bulle, la base, **sa provenance** et les **projets
    visés** (`respConcerned`) **avant** `onEnd()` (qui remet ces états à zéro),
    puis corrige une seule fois, en fire-and-forget (fail-open) ;
  - `applyProjectColorToBubble` : point unique de la couleur du bord gauche,
    appelé à la création **et** à la correction — sinon la couleur aurait
    continué de désigner l'ancien projet ;
  - `collectBubbleBadgeProjects(text)` : ne sert plus qu'à **détecter** les
    projets cités (plus d'extension d'une base : c'était le second mécanisme
    qui conservait le nom faux en tête).
- `src/js/super-agent-badges.js`
  - `resolveBubbleBadgeNames` **délègue** à `decideMessageProjectLabel` : l'ordre
    de priorité n'est plus écrit deux fois ;
  - en-tête et documentation mis à jour ; `extendBadgesWithText` reste un
    utilitaire **pur** (couvert par ses tests), mais n'est plus branché sur
    l'écran — c'est lui qui ajoutait sans jamais remplacer.

### 3.3 Comportement obtenu — les trois cas de la demande

| Cas | Comportement obtenu |
|---|---|
| 1. Un message délègue sur / parle d'un autre projet | L'étiquette nomme le projet **visé** (mission), et non le projet actif de la fenêtre : « PLh » au lieu de « Pilot » |
| 2. Plusieurs projets concernés | Le **projet principal de la mission** en premier, les **autres sont signalés** (badges suivants + infobulle), et **jamais** un projet non concerné |
| 3. Message purement conversationnel | Retombe sur le **projet actif** (dernier recours) ; **aucun projet ouvert → aucune étiquette** |

## 4. Tests

### 4.1 Verrou qui échoue sur le code d'avant

`src/js/etiquette-projet-des-bulles.test.js` (nouveau, **24 tests**) :

- décisions pures (création, correction, infobulles, fail-open) ;
- **VERROU** : bulle ouverte sur « Pilot », mission réellement lancée sur
  « PLh » → étiquette `["PLh"]` **seule**, `main = "PLh"`, provenance `mission` ;
- plusieurs projets visés → le premier est le principal, les autres signalés ;
- un nom **prouvé** ne recule jamais ; un dernier recours s'efface ;
- cas 3 (conversation → projet actif ; aucun projet ouvert → rien) ;
- gardes de branchement : décision unique, provenance figée et lue, projets visés
  capturés **avant** `onEnd()`, **une seule** création de rangée de badges,
  `resolveBubbleBadgeNames` qui délègue.

**Preuve par mutation** : en restaurant le comportement fautif dans le module
(`return makeDecision([...base, ...mission, ...cited], ...)`, c'est-à-dire la
base en tête et l'ajout à la fin — exactement l'ancien comportement), le fichier
passe à **4 échecs** :

```
AssertionError: expected [ 'Pilot', 'PLh' ] to deeply equal [ 'PLh' ]
AssertionError: expected 'Pilot' to be 'PLh'
AssertionError: expected [ 'Pilot', 'PLh' ] to deeply equal [ 'PLh', 'Pilot' ]
AssertionError: expected '' to contain 'principal'
```

puis retour au code corrigé → **24/24**.

### 4.2 Test existant mis à jour (justification explicite)

`src/js/super-agent-badges-nom-projet.test.js`, cas « integration : le projet
vise (regle 2) est evalue AVANT le projet ouvert (regle 3) » : l'ancre de lecture
du code passe de `resolveBubbleBadgeNames(\n` à `decideMessageProjectLabel(\n`
dans `super-agent.js`. **L'intention du contrôle est inchangée et reste
vérifiée** (le projet visé est examiné avant le projet ouvert) ; seule la
fonction qui porte l'ordre a changé de fichier, puisque la règle a été déplacée
vers sa source unique. Aucune assertion n'a été retirée ni affaiblie.

### 4.3 Résultats

```
npm test
 Test Files  302 passed (302)
      Tests  5639 passed (5639)
```

Total **recompté**, pas figé : *avant* la correction, 301 fichiers et
5 615 tests (5 639 − 24 tests du nouveau fichier) ; *après*, **302 fichiers,
5 639 tests, 0 échec**. Les tests Rust n'ont pas été lancés : **aucun fichier
Rust n'est touché** par ce lot (`git status` ne liste que du JS, une spec et ce
rapport).

## 5. Ce qui n'a pas bougé (anti-régression)

- Bulles de l'**utilisateur**, **messages système**, **erreurs** : aucune
  étiquette, aucune infobulle.
- **Relais** d'une question d'agent : badges **explicites** conservés tels quels
  (le projet de l'agent qui pose la question), priorité 1 inchangée.
- Aucune bulle **re-étiquetée rétrospectivement** : la seule retouche est celle,
  unique, de la fin du tour de la bulle concernée.
- Ordre de priorité à la création **inchangé** (décision propriétaire du
  2026-10-22) ; détection des projets cités **inchangée** (sans IA, frontières
  de mots, suffixe « - (GDS) »).
- Aucun nouveau réglage, aucun nouveau bouton, aucun changement de la
  publication ni des versions (`package.json` reste en 0.6.20), **aucune
  release** publiée.
- Fail-open partout : base indisponible, invoke en échec ou trop lent → la bulle
  garde ses badges figés, rien n'est bloqué.

## 6. Documentation

- `spec_super_agent.md` : la règle des badges projet est mise à jour (source
  unique `super-agent-project-label.js`, décision **par message**, correction
  **unique** en fin de tour, effacement d'un dernier recours, projet principal
  puis projets signalés). Cette section n'est pas dans un bloc `<!-- HELP:* -->` :
  aucun `npm run build:handbook` nécessaire.
- `src/js/super-agent-badges.js` : en-tête et `extendBadgesWithText` réalignés.

## 7. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src/js/super-agent-project-label.js` | **nouveau** — décisions pures, source unique |
| `src/js/etiquette-projet-des-bulles.test.js` | **nouveau** — verrou (échoue sans la correction) |
| `src/js/super-agent.js` | provenance figée, décision unique, correction de fin de tour, couleur du bord |
| `src/js/super-agent-badges.js` | `resolveBubbleBadgeNames` délègue, documentation |
| `src/js/super-agent-badges-nom-projet.test.js` | ancre de lecture mise à jour (intention conservée) |
| `spec_super_agent.md` | règle des badges projet |
| `docs/rapports/RAPPORT-etiquette-projet-des-bulles.md` | ce rapport |

## 8. Commandes de vérification

```bash
npm test
npx vitest run src/js/etiquette-projet-des-bulles.test.js
```
