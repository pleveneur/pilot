# Rapport — CORRECTION 3 : un arrêt d'agent de l'onglet agent est NOMMÉ, plus seulement compté

Date : 2026-01-01 (session courante)
Périmètre : `src/js/agent-pi.js` (marqueurs en commentaire uniquement) + `src/js/agent-stop-trace-paths.test.js` (contrôle de test).
Aucun comportement d'arrêt modifié. Aucun seuil modifié. Aucun appel déplacé.

---

## 1. Problème constaté (audit post v0.4.33)

Le test `agent-pi.js : les arrêts de SESSION sont tracés, les arrêts de TOUR sont comptés`
vérifiait **un COMPTE** (`invoke("abort_agent")` → exactement 13 sites) sans
distinguer un arrêt **automatique** d'un arrêt **manuel / de tour**. Conséquence :
un arrêt automatique ajouté **et** un arrêt manuel retiré laissaient le compte à 13
→ contrôle vert, site suspect invisible, diagnostic d'un agent coupé en plein
travail sur une fausse piste.

`agent-pi.js` ne portait **aucune** occurrence du marqueur nommé
`R3-EXCEPTION-MANUEL` (présent dans `agents-bus.js`, `super-agent.js`,
`agent-stop-funnel.js`).

## 2. Ce qui a été fait

### 2.1 Marqueurs nommés (11 sites, `src/js/agent-pi.js`)

Convention reprise **à l'identique** de l'existant (`agents-bus.js:3195`,
`super-agent.js:3036`/`5185`) : un commentaire `// R3-EXCEPTION-MANUEL : …`
**accolé à l'appel**, disant la raison courte.

| # | Site (fonction / contexte) | Raison nommée |
|---|---|---|
| 1 | `case "abort"` du panneau de l'onglet | arrêt demandé par l'utilisateur (bouton Stop) |
| 2 | `finish()` du test de modèle | fin du TEST de modèle (nettoyage du processus de test) |
| 3 | `handleOrchestrationTimeout` — extraction mémoire | arrêt de TOUR (timeout extraction), le plan reprend |
| 4 | `handleOrchestrationTimeout` — révision | arrêt de TOUR (timeout révision), plan actuel conservé |
| 5 | `handleOrchestrationTimeout` — subdivision | arrêt de TOUR (timeout subdivision), escalade |
| 6 | `handleOrchestrationTimeout` — inactivité tâche | arrêt de TOUR, échec de tâche traité ensuite |
| 7 | `compaction_end` — reprise du plan | arrêt de TOUR (tour zombie) avant relance |
| 8 | `compaction_end` — reprise du chat | arrêt de TOUR avant ré-émission du prompt |
| 9 | `compaction` (ancien format) — reprise plan | arrêt de TOUR avant relance |
| 10 | `compaction` (ancien format) — reprise chat | arrêt de TOUR avant ré-émission |
| 11 | `auto_retry_start` (modèle injoignable) | arrêt de TOUR, bascule en pause/erreur explicite |

Les **2 sites restants** (`maybeDetectLoop` / `maybeDetectActionLoop`, boucle de
texte et boucle d'actions) **ne portent pas le marqueur** : ils restent **tracés**
(`traceAutomaticAgentStop` avec `reason: "loop-detection"`), donc comptés comme
`traced` et non comme exceptions.

### 2.2 Contrôle de test (`src/js/agent-stop-trace-paths.test.js`)

- Le simple compteur est **remplacé** par le contrôle de **précédence** déjà
  utilisé pour les autres fichiers :
  `precedences(SRC_PI, /invoke\("abort_agent"\)/g, "abort_agent")`.
  Exigences : `sites === 13`, `untraced` **vide**, `traced === 2`,
  `exceptions` **de longueur 11**.
- L'assertion de **cardinalité** existante (`toHaveLength(13)`) est conservée
  (elle attrape l'ajout/retrait brut, y compris un site correctement marqué).
- Ajout ciblé : chaque exception doit porter **son propre** marqueur dans le
  commentaire **accolé** à l'appel (helper `adjacentComment`) — un marqueur ne
  peut donc pas blanchir deux sites voisins du même bloc, ni être « hérité » du
  site précédent (le regard de 700 caractères de `precedences` le permettrait).
- Le nombre de marqueurs `R3-EXCEPTION-MANUEL` du fichier est épinglé à **11**
  (un marqueur retiré sans changer les sites fait rougir).
- Le test est renommé : « … les arrêts de TOUR sont **NOMMÉS** ».

### 2.3 Preuve d'anti-vacuité (obligatoire, faite puis restaurée)

1. Neutralisation du marqueur du site **manuel** (bouton Stop) → **ROUGE** :
   `arrêt de TOUR ou manuel MUET dans l'onglet agent (ni trace, ni marqueur…)`,
   `untraced = [<offset>]`. Restauré.
2. Neutralisation du marqueur d'un site **voisin** (timeout révision, autre
   marqueur à ~11 lignes au-dessus) → **ROUGE** également : la couverture n'est
   pas héritée d'un voisin du même bloc. Restauré.
3. Après restauration : `npm test` **vert** (2052 tests), marqueurs = 11.

## 3. Points signalés (non corrigés, conforme à la consigne)

Plusieurs sites marqués sont, à la lecture, des arrêts **automatiques** (décidés
par Pilot, non par l'utilisateur) : timeout d'orchestration (3 à 6), reprise
après compaction (7 à 10), modèle injoignable (11), fin de test de modèle (2).
Ils ne **terminent pas la session** (arrêt de TOUR : le flux reprend, passe en
pause ou escalade) et n'ont donc pas à écrire de trace d'arrêt de session.
Seul le site 1 est réellement **manuel** (bouton Stop).

Conséquence pour la règle 3 : le nom du marqueur (`R3-EXCEPTION-MANUEL`) est
imparfait pour ces huit sites — leur vraie nature est « arrêt de TOUR, hors
périmètre de la règle 3 ». **Rien n'a été renommé ni modifié** (hors périmètre de
cette correction) ; si le projet veut un second marqueur explicite
(`R3-EXCEPTION-TOUR`), c'est une décision séparée.

Point d'attention relevé aussi : les blocs 7/8 et 9/10 sont **dupliqués** (deux
formats d'événement de compaction) — une future factorisation supprimerait 2
sites et demanderait de mettre à jour la cardinalité (13 → 11).

## 4. Vérifications

- `npm test` : **120 fichiers / 2052 tests verts**.
- `npm run build` : build OK ; seuls les avertissements **préexistants** de Vite
  (imports dynamiques + taille de chunk) apparaissent, **aucun nouvel
  avertissement**.
- Aucune logique d'arrêt, aucune condition, aucun seuil modifié (`git diff` :
  31 lignes **ajoutées** en commentaire dans `agent-pi.js`, 0 suppression).
- Lecture des fichiers modifiés relue (quality-gate §3.1) ; ancres des autres
  tests qui lisent `agent-pi.js` vérifiées (aucune ne porte sur ces zones).
