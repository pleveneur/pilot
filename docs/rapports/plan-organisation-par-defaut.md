# Organisation par défaut de Pilot — plan de mise en œuvre

> Rédigé pour la version **0.4.37**. Document de travail : il décrit ce qu'on veut
> obtenir et par quelles étapes on y arrive. Il ne décrit **pas** un code déjà écrit.
> Chaque étape a été relue dans le code réel de ce dépôt (les fichiers cités existent).

Aujourd'hui, quand vous tapez une demande sans choisir d'agent, c'est **l'agent
standard du projet** (`default`) qui répond seul : il n'y a **aucune organisation**
automatique, aucun découpage, aucun passage de relais entre rôles (constat vérifié :
`src/js/super-agent.js` L137, `src-tauri/src/rpc.rs` `DEFAULT_AGENT_ID`, et le
registre fourni dans `src-tauri/src/agents.rs` qui ne propose que 7 rôles, sans
règle de choix).

---

## 1. Comportement visé

1. Vous tapez une demande **sans choisir d'agent**.
2. Elle part au **coordinateur** du projet — jamais directement au codeur.
3. Le coordinateur la **découpe** en petites tâches et donne un **rôle** à chacune.
4. L'ordre est toujours : **plan** (lecture) → **code** (écriture) → **tests** →
   **relecture** → **documentation**.
5. Sur un projet, **une seule écriture à la fois** ; les autres demandes attendent.
6. **Rien n'est perdu** : une demande en attente reste visible et démarre seule.
7. Vous voyez **qui travaille, sur quoi**, et vous pouvez **arrêter**.
8. Organisation **désactivée** = comportement d'aujourd'hui, à l'identique.

---

## 2. Ce que le code fait déjà (relevé, à réutiliser)

| Fichier | Ce qui existe déjà |
|---|---|
| `src-tauri/src/agents.rs` | Registre **fourni** de 7 rôles : coordinateur, architecte, codeur, reviewer, testeur, documenteur, plan-maker (avec `readonly`, `call_depth`, `max_calls_per_run`). |
| `src/js/agents.js` | Protocole de délégation : `[[CALL:agent_id]]` (+ `task`, `files`, `context`) et `[[PARALLEL]]` ; `classifyAgent` distingue **codeur** et **spécialiste**. |
| `src/js/run-policy.js` | Admission : **plusieurs lectures** en parallèle, **une écriture exclusive** — **par projet**. |
| `src/js/exclusivity-queue.js` | File d'attente par couple (projet, agent), relancée automatiquement. |
| `src/js/agents-bus.js` | Bus d'agents : lancement, `launchNextQueued`, `releaseStuckRunLock` (verrou fantôme). |
| `src/js/super-agent.js` | Rejeu de la file de missions d'un projet : `replayQueuedMissionForProject` (+ `armQueueReplay`). |
| `src/js/project-task-queue.js`, `src/js/project-queue-view.js` | File visible du projet, commandes `/file` et `/file vide`. |
| `src/js/mission-identity.js` | Numéro de mission + refus du double empilement. |
| `src/js/ephemeral-agents.js` | Agent **jetable** : rôle décrit dans la demande, jamais enregistré. |
| `src/js/reservations.js` | Réservation de fichiers `.pilot/reservations.json` (explicite seulement). |
| `src/js/loop-detection.js`, `src/js/agent-stop-funnel.js`, `src/js/agent-stop-trace.js` | Arrêts automatiques : détection de boucle, entonnoir **unique**, trace `.pilot/agent-stops.log`. |
| `src-tauri/src/lib.rs` | Config `config.json` (champ par champ, `#[serde(default)]` : un ancien fichier reste inerte). |
| `src/js/settings.js` | Modale des Paramètres (thème, agents, timeout d'inactivité…). |

Ce qui **manque** : un réglage « organisation par défaut », la règle de choix
écrite une seule fois, l'aiguillage vers le coordinateur, l'ordre des rôles comme
donnée, et la preuve que tout cela se désactive proprement.

---

## 3. Le plan, étape par étape

Chaque étape est **courte et bornée** : un seul agent de code peut la mener seule.
Le « test de preuve » est le fichier de test qui doit exister et passer.

### Étape 1 — Écrire la règle de choix, une seule fois
- **Vous verrez** : rien de visible. C'est la règle qui garantit que tout le reste
  se comporte pareil partout.
- **Fichiers** : `src/js/default-organization.js` (neuf).
- **Test de preuve** : `src/js/default-organization.test.js` — pour chaque écran
  (onglet d'agent, Assistant) et chaque état (actif / inactif), la fonction rend
  **un seul** agent cible ; avec l'organisation active, elle ne rend **jamais** le
  codeur en premier.

### Étape 2 — L'interrupteur, éteint par défaut
- **Vous verrez** : une case « Organisation par défaut » dans **Paramètres**,
  **décochée** à l'installation ; votre choix est conservé au redémarrage.
- **Fichiers** : `src-tauri/src/lib.rs` (champ `organization_mode` +
  `#[serde(default)]`), `src/js/settings.js`, `src/js/main.js`.
- **Test de preuve** : côté Rust, un `config.json` **sans** le champ donne
  `false` (ancien fichier inerte) ; côté JS, `src/js/organization-setting.test.js`
  vérifie lecture / écriture du réglage.

### Étape 3 — L'ordre des rôles devient une donnée
- **Vous verrez** : l'ordre affiché dans les Paramètres correspond exactement à
  l'ordre d'exécution (plus de texte caché dans un prompt).
- **Fichiers** : `src/js/organization-order.js` (neuf).
- **Test de preuve** : `src/js/organization-order.test.js` — l'ordre est plan →
  code → test → relecture → documentation ; un rôle inconnu est **refusé**
  explicitement au lieu d'être ignoré en silence.

### Étape 4 — Un bandeau d'état dans l'onglet de l'agent
- **Vous verrez** : « 🧩 Organisation par défaut : active » (ou « inactive ») en
  haut de l'onglet, sans changer d'écran.
- **Fichiers** : `src/js/agent-pi.js`, `src/css/style.css`.
- **Test de preuve** : `src/js/organization-banner.test.js` — le texte affiché
  dépend du réglage et nomme le prochain rôle attendu.

### Étape 5 — La demande part au coordinateur
- **Vous verrez** : votre demande, sans choix d'agent, affiche « 🧠 Coordinateur »
  comme premier intervenant au lieu de l'agent standard.
- **Fichiers** : `src/js/agents-bus.js`, `src/js/super-agent.js`,
  `src/js/default-organization.js`.
- **Test de preuve** : `src/js/organization-routing.test.js` — organisation
  active : premier agent appelé = `coordinateur` ; inactive : premier agent =
  `default`, **comportement inchangé**.

### Étape 6 — Le découpage du coordinateur est réellement exécuté
- **Vous verrez** : la liste des tâches découpées, dans l'ordre, chacune avec son
  rôle — et aucune tâche inventée.
- **Fichiers** : `src/js/agents.js` (parseurs existants), `src/js/agents-bus.js`.
- **Test de preuve** : `src/js/organization-decoupage.test.js` — deux
  `[[CALL:…]]` produisent deux missions ordonnées ; un identifiant de rôle
  inconnu est **refusé avec message**, jamais remplacé.

### Étape 7 — Une seule écriture à la fois sur un projet
- **Vous verrez** : si une écriture tourne déjà, votre demande écrit « en attente »
  au lieu de se lancer en même temps.
- **Fichiers** : `src/js/run-policy.js` (règle existante), `src/js/agents-bus.js`.
- **Test de preuve** : `src/js/organization-exclusivite.test.js` — deux écritures
  du même projet ne tournent **jamais** ensemble ; deux projets différents ne se
  bloquent pas ; deux lectures peuvent cohabiter.

### Étape 8 — La file du projet, avec son rang
- **Vous verrez** : « en attente (2ᵉ) », puis le démarrage automatique, et `/file`
  pour la liste complète.
- **Fichiers** : `src/js/project-task-queue.js`, `src/js/exclusivity-queue.js`,
  `src/js/project-queue-view.js`.
- **Test de preuve** : `src/js/organization-file-rang.test.js` — la 3ᵉ demande
  porte le rang 3, démarre après la 2ᵉ, et **aucune** demande ne disparaît.

### Étape 9 — Un rôle à la volée, quand aucun rôle fourni ne convient
- **Vous verrez** : la tâche confiée à un rôle décrit à la demande, exécuté puis
  disparu — **sans** nouvelle ligne dans votre liste d'agents.
- **Fichiers** : `src/js/ephemeral-agents.js` (existant), `src/js/agents-bus.js`,
  `src/js/organization-order.js`.
- **Test de preuve** : `src/js/organization-jetable.test.js` — après la tâche, le
  registre est **identique** à avant (aucune écriture de ligne).

### Étape 10 — Voir qui travaille
- **Vous verrez** : nom de l'agent, rôle, tâche en cours, et le repère
  « arrière-plan » pour un agent sans onglet ouvert.
- **Fichiers** : `src/js/agents-ui.js`, `src/js/agent-activity.js`.
- **Test de preuve** : `src/js/organization-qui-travaille.test.js` — l'état
  affiché nomme l'agent et la tâche ; un agent au repos n'est **jamais** présenté
  comme travaillant.

### Étape 11 — Arrêter l'organisation en un geste
- **Vous verrez** : le bouton ⏹ arrête les agents de **ce projet**, et chaque
  arrêt automatique laisse un motif écrit.
- **Fichiers** : `src/js/agent-pi.js`, `src/js/agent-stop-funnel.js`,
  `src/js/agent-stop-trace.js`.
- **Test de preuve** : `src/js/organization-arret.test.js` — l'arrêt ne touche que
  le projet visé ; tout arrêt automatique passe par l'entonnoir unique et écrit
  `.pilot/agent-stops.log`.

### Étape 12 — Chaque décision laissée par écrit
- **Vous verrez** : un journal lisible (`.pilot/organisation.log`) disant qui a
  reçu quoi, qui a découpé, qui a exécuté.
- **Fichiers** : `src/js/organization-journal.js` (neuf), `src/js/agent-stop-trace.js`
  (réutilisé : append + rotation + échec visible).
- **Test de preuve** : `src/js/organization-journal.test.js` — une ligne par
  décision, la rotation ne perd pas la fin du journal, une erreur d'écriture est
  **signalée** et ne bloque pas la tâche.

### Étape 13 — Reprise : une mission en file ne reste pas morte
- **Vous verrez** : une demande mise en attente repart toute seule, même après une
  panne, et sans doublon.
- **Fichiers** : `src/js/super-agent.js` (`replayQueuedMissionForProject`),
  `src/js/agents-bus.js` (`releaseStuckRunLock`), `src/js/mission-identity.js`.
- **Test de preuve** : `src/js/organization-reprise.test.js` — un verrou fantôme
  est levé, la mission repart **une** fois, la même mission n'est pas empilée deux
  fois.

### Étape 14 — Les garde-fous existants s'appliquent aussi
- **Vous verrez** : une chaîne trop longue ou un agent silencieux s'arrête avec un
  message clair ; relire `git status` ou `ls` entre deux corrections **n'arrête rien**.
- **Fichiers** : `src/js/loop-detection.js`, `src/js/agents.js` (`call_depth`,
  `max_calls_per_run`), `src-tauri/src/lib.rs` (timeout d'inactivité existant).
- **Test de preuve** : `src/js/organization-garde-fous.test.js` — profondeur
  dépassée = refus nommé ; inactivité = arrêt annoncé ; trois lectures identiques
  n'arrêtent **pas** la tâche.

### Étape 15 — L'écran de réglage des rôles
- **Vous verrez** : les 7 rôles fournis, leur ordre, leur modèle, et un blocage
  clair si un rôle manque.
- **Fichiers** : `src/js/settings.js`, `src-tauri/src/agents.rs` (registre existant).
- **Test de preuve** : `src/js/organization-ecran-reglages.test.js` — changer un
  modèle ne change **pas** l'ordre ; un rôle indispensable manquant **empêche**
  l'activation et le dit.

### Étape 16 — Désactivée, l'application se comporte comme avant
- **Vous verrez** : exactement l'écran et le comportement d'aujourd'hui.
- **Fichiers** : `src/js/default-organization.js`, `src/js/agent-pi.js`.
- **Test de preuve** : `src/js/organization-desactivee-identique.test.js` — un seul
  agent (`default`), aucun découpage, aucune file imposée ; **et** les tests
  existants du comportement actuel restent verts (`npm test` complet).

### Étape 17 — Documentation, aide intégrée et recette
- **Vous verrez** : une page d'aide « Organisation par défaut » dans l'onglet ❓
  Aide, expliquant on / off et l'ordre des rôles.
- **Fichiers** : `spec_organisation_defaut.md` (neuf) + bloc `<!-- HELP:organisation -->`
  + `help/handbook.md` régénéré par `npm run build:handbook` ; `README.md`.
- **Test de preuve** : `src/js/organization-doc.test.js` — le bloc HELP existe dans
  la spec, il est présent dans le handbook généré, et il dit explicitement comment
  désactiver. Recette manuelle finale notée dans la spec (3 gestes à refaire).

**Ordre de livraison conseillé** : 1 → 2 (socle invisible), puis 3 → 4 (visible),
puis 5 → 6 → 7 → 8 (le cœur), puis 9 → 10 → 11 → 12 → 13 → 14 (robustesse),
enfin 15 → 16 → 17 (réglages, non-régression, documentation).

---

## 4. Ce qui reste sous le contrôle du propriétaire

- **Activer ou non** l'organisation par défaut : elle est **éteinte** à l'installation.
- **Choisir un agent vous-même** : un choix explicite l'emporte toujours sur
  l'organisation (aucune substitution silencieuse).
- **Choisir les modèles** de chaque rôle et modifier leurs rôles (régler, garder le contexte,
  lecture seule, plafonds).
- **Décider des priorités** : vous pouvez laisser une demande attendre, ou vider la
  file (`/file vide`) — la tâche en cours n'est jamais arrêtée par cette commande.
- **Arrêter** à tout moment les agents d'un projet.
- **Lire** : qui a reçu quoi, dans quel ordre, et pourquoi quelque chose s'est arrêté
  (journal + `.pilot/agent-stops.log`).

---

## 5. Comment on désactive l'organisation par défaut

1. **Paramètres → Organisation** : décocher « Organisation par défaut ».
2. Le réglage est écrit immédiatement dans `config.json` (champ `organization_mode`,
   `false`), donc conservé au redémarrage.
3. **Effet immédiat sur les demandes suivantes** : elles repartent à l'agent standard
   (`default`), comme aujourd'hui.
4. **Ce qui est déjà lancé n'est pas coupé au milieu** : les tâches en cours
   finissent ; la file n'est ni vidée ni perdue.
5. **Aucun fichier de projet n'est modifié** par cette désactivation (seul
   `config.json` change).

Trois façons de revenir en arrière si besoin : recocher la case, éditer `config.json`,
ou réinstaller (le défaut reste **éteint**).

---

## 6. Ce qui n'est pas dans ce plan

- **Aucun nouveau rôle fourni** : on utilise les 7 existants (coordinateur,
  architecte, codeur, reviewer, testeur, documenteur, plan-maker).
- **Pas de refonte graphique** : l'organisation se voit par un bandeau, un journal
  et les écrans existants.
- **Pas de changement du serveur GDS**, ni du mode distant web, ni de Telegram.
- **Pas de facturation, pas de compteur de coût monétaire** : seuls les plafonds
  déjà existants (tours, profondeur, inactivité) s'appliquent.
- **Pas de parallélisme d'écriture** : une seule écriture par projet reste la règle.
- **Pas de choix automatique de modèle** en fonction du prix ou de la difficulté.
- **Pas de modification du comportement par défaut du mode Orchestration** existant
  (une seule session, bascule orchestrateur → codeur) : il reste une option distincte.
- **Pas de publication** dans ce plan : le bump de version et la release restent une
  décision du propriétaire, hors périmètre des étapes ci-dessus.
