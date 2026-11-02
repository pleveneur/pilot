# Rapport — aucun agent invisible (tous les chemins de lancement)

**Date** : 2026-11-15
**Demande (propriétaire)** : un agent qui travaille ne doit **jamais** manquer à la
liste des agents (cercle en haut à droite), quel que soit le chemin de lancement ;
la liste doit dire la vérité (projet + état) ; aucune session ne peut exister
« nulle part » à l'écran.

---

## 1. Faits établis sur le disque (avant toute modification)

| Question | Réponse prouvée |
|---|---|
| Une correction antérieure existait-elle ? | **Oui** : tâche 364, `docs/rapports/RAPPORT-agents-visibles.md`, commit **`64d41ac`** « fix(ui): afficher tous les agents vivants sans onglet dans la liste d'activité ». |
| A-t-elle été retirée / écrasée ? | **Non** : `git merge-base --is-ancestor 64d41ac HEAD` → **ancestor**. Présent sur `main`, `feat/laya-marche2`, `gds-refonte-l1`, `gds-refonte-l2`, `verrou-par-projet`. Les identifiants `aliveBackground` / `hasTab` en viennent encore (`git log -S"aliveBackground"`). |
| A-t-elle régressé ? | **Non** — elle est intacte mais **incomplète** : son critère (`!hasTab && !aliveBackground`) ne pouvait rien voir des deux défauts ci-dessous, qui vivent **en amont** de lui (dans l'identité des lignes, pas dans la condition d'affichage). |
| État à l'ouverture | arbre propre, tête `b72756a` ; aucun fichier modifié. |

Conclusion des faits : il ne s'agit **ni d'une suppression, ni d'un commit perdu**,
mais d'une **couverture incomplète** de la correction 364.

## 2. Tous les chemins de lancement recensés

| Chemin | Entrée | Session enregistrée ? | Ligne dans la liste ? |
|---|---|---|---|
| Agent du projet (onglet) | `start_agent_session` → `AgentService::start` | oui | oui (`visible=true`) |
| Agent du projet **sans onglet** | `tabs.startAgentInvisible` → `set_agent_visible(0)` + start | oui | oui (`alive`) |
| Agent délégué par l'Assistant (`run_agents`) | `agents-bus` → `start_agent_process` | oui | **défaut A** (agent `default`) |
| Agent hors projet (`run_assistant_agents`) | `start_assistant_agent_process` | oui (projet `__assistant__`) | oui |
| Mission mise en file puis démarrée | file du projet → démarrage réel | oui | **défaut B** (fenêtre de démarrage) |
| Reprise après attente / session parkée | `park_agent` puis reprise | oui (`state="parked"`) | oui |
| Reviewer d'orchestration | `start_reviewer` | oui | **défaut A** (id ≠ libellé) |
| Agent jetable `eph-…` | `ephemeral-agents.js` | oui (mémoire) | oui (`name` additif) |
| Agent secondaire d'un projet | `assistant_agent` | oui | oui |
| **Session de groupe de l'Assistant** | `start_group_assistant` (projet `""`) | oui | **défaut C** (absorbée) |
| Processus pi « caged » uniques | `help.rs::ask_pi_caged*`, `review.rs::ask_review`, `agents_md.rs::generate_agents_md` | **non** (aucune session, one-shot) | hors liste **par construction** — vérifié, assumé, documenté ici |

## 3. Cause exacte (deux défauts dans la MÊME règle centrale)

`get_agent_supervision` (`dashboard.rs`) publie, par session, `agent` = **libellé
d'affichage** (« Dossier » pour l'id `default`, **nom réglé** pour `superagent`) et
**aucun id**. Le frontend (`agent-activity.js`) en déduisait l'**identité** :

**A. Identité prise sur un libellé.** `rawId = a.agent` → pour l'agent `default`,
identité « Dossier » ; la ligne s'affichait, mais « Afficher l'onglet » appelait
`_openAgent(label, "Dossier")` → session cherchée sous un id **inexistant**. L'agent
continuait de travailler **sans onglet atteignable** : invisible en pratique.
Deux sessions pouvaient en outre partager la même identité (une seule ligne
réellement utilisable).

**B. Aucune preuve de vie pour ces sessions.** `mergeProbeActivity` (sonde légère
de 2 s) apparie sur `project\u001fagent` avec l'id **brut** renvoyé par
`agent_activity_probe` : pour `default` (publié « Dossier ») l'appariement échouait
→ `alive` et `toolInProgress` restaient figés sur la dernière lecture lourde.

**C. Projet pseudo-global `""` = identité forcée.** `rawId = isSuper ? "superagent"`
s'appliquait à **toute** session du projet `""`, or `""` porte **deux** sessions
(`superagent` et `groupassistant`). La session de **groupe**, qui travaille
réellement, recevait l'identité, le libellé et le clic de l'assistant : elle
n'existait **nulle part** comme agent à part entière.

**D. Fenêtre de démarrage.** Une mission acceptée mais pas encore démarrée
(`starting`, calculé **après** le filtre) pouvait être écartée pendant son
démarrage — précisément le moment où l'utilisateur la cherche.

## 4. Correctif, au point le plus central

**Une seule règle d'appartenance, un seul endroit** (frontend ; Rust ne fait que
publier des faits) :

| Fichier | Changement |
|---|---|
| `src-tauri/src/dashboard.rs` | champ **ADDITIF** `id` (id **brut** du registre) sur chaque entrée de supervision, à côté de `agent` (libellé, inchangé) ; couple (id, libellé) calculé par une fonction **pure** `agent_entry_ids`. |
| `src/js/agent-activity.js` | `rawAgentId(a)` (source unique de l'identité : `id`, repli `agent` pour une charge ancienne) ; `isAgentListedInWorkList(a)` (**source unique** d'appartenance : travaille → listée ; mission en démarrage non morte → listée ; assistant / espace assistant / **session globale** → toujours listée ; sinon onglet ouvert ou processus vivant) ; `flattenAgents` l'applique **après** le calcul d'identité et de `starting` ; famille `kind="global"` pour les sessions du projet `""` autres que l'assistant (identité propre, fiche sans bouton « Afficher l'onglet » — il n'en existe pas) ; `mergeProbeActivity` apparie sur l'id **brut**. |

Aucun réglage ajouté, aucun écran sans rapport touché, la sonde périodique reste
`agent_activity_probe` (jamais `list_agent_sessions` en boucle).

## 5. Le test qui échoue sans le correctif

Ajoutés dans `src/js/agent-activity.test.js` (describe « aucun agent invisible ») —
les tests existants n'ont **pas** été modifiés ni assouplis :

1. session de **groupe** du projet `""` → deux lignes, deux identités, deux `kind` ;
2. identité lue sur l'id brut (`default` / `codeur`), libellé conservé pour l'affichage ;
3. **table de vérité** de `isAgentListedInWorkList` (vivant sans onglet, mort écarté, onglet, charge ancienne, mission en démarrage, familles) ;
4. **tous les chemins** dans une même supervision → 8 lignes, identités toutes distinctes, agent jetable nommé mais identifiable ;
5. la sonde légère atteint les sessions dont la supervision publie un nom.

Preuve d'échec mesurée : avec l'ancienne identité (`a.agent`) et l'ancien filtre
réintroduits temporairement, `npx vitest run src/js/agent-activity.test.js` →
**FAIL (3)** ; correctif rétabli → **PASS (106) / FAIL (0)**.

Côté Rust : `dashboard.rs` → `l_identite_d_une_session_ne_depend_jamais_de_son_libelle`
(id brut pour `default`/`superagent`, aucune absorption de `groupassistant`, aucune
identité dupliquée).

## 6. Vérifications

| Vérification | Résultat |
|---|---|
| `npm test` | **282 fichiers / 5214 tests verts** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **828 verts, 1 ignoré** |
| `npm run build:handbook` | 47 blocs, `help/handbook.md` régénéré |
| Doc | `spec_gestion_agents.md` (bloc `<!-- HELP:agents -->`) : 2 règles ajoutées — « aucun agent invisible, quel que soit le chemin de lancement » et « chaque session est reconnue par sa propre identité » |
| Non-régression des garanties existantes | agent mort toujours écarté (aucune entrée fantôme) ; mission en démarrage dont le processus est **connu mort** toujours écartée ; tests existants inchangés (`taches-visibles-sans-onglet`, `agent-activity-nom-jetable`, `agent-activity-sonde-legere`, `panneau-suivi-trois-onglets`). |

## 7. Limites connues (dites, non masquées)

- Les processus pi **one-shot** (`ask_pi_caged`, `ask_review`, `generate_agents_md`)
  ne sont pas des sessions : ils n'apparaissent pas dans la liste — c'est leur
  nature, pas un agent « caché ».
- Une charge **ancienne** de supervision (sans champ `id`) retombe sur `agent` :
  l'identité reste alors approximative pour `default`. Le backend livré publie `id`,
  donc cet état n'est qu'un cas de compatibilité transitoire.

## 8. VERDICT

**Corrigé au point central.** La correction 364 n'avait pas régressé : elle était
incomplète. Les trois défauts prouvés (identité prise sur un libellé, appariement de
la sonde sur un libellé, session de groupe absorbée par l'assistant) plus la fenêtre
de démarrage sont réparés par **une seule règle** (`isAgentListedInWorkList`) et
**une seule identité** (`rawAgentId`), tenues par 5 tests JS et 1 test Rust qui
échouent sans le correctif. Aucun test existant n'a été modifié, aucun réglage
n'a été ajouté, le travail sans onglet est conservé.

VERDICT: OK — tout agent qui travaille est listé, quel que soit le chemin de lancement ; la liste reste consultable après la fin ; aucune session ne peut plus exister sans ligne ; suite JS et Rust verte.
