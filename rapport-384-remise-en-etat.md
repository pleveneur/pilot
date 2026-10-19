# Rapport 384 — Le planificateur (plan-maker) va au bout et livre un plan

## 1. Point de départ

**Fichier de diagnostic attendu absent** : `DIAGNOSTIC-383-plan-maker.md` **n'existe pas** à la
racine du projet (vérifié : `No such file or directory`). Le diagnostic s'appuie donc sur
`.pilot/rapports/diag-watchdog-10-secondes.md`, sur `rapport-381-agent-demande.md`,
`rapport-380bis-verif.md` et sur la lecture du code du bus d'agents.

Les deux missions précédentes (381 : l'agent lancé est exactement l'agent demandé ;
380bis : levée des verrous orphelins sur les cinq points d'entrée) **ne sont pas refaites**.

## 2. Ce qui a été établi

Le diagnostic du chien de garde concluait **« cause partielle »**. Mission 384 confirme et
ferme la partie établie :

- **Établi** — une mission de **LECTURE** (le plan-maker) qui se terminait sans rien produire
  était rapportée comme un **succès** :
  1. `provesWorkOnDisk()` acceptait un **commit tombé pendant la run** comme preuve de travail
     **même pour une mission de lecture** (qui n'écrit rien) — un commit venu d'ailleurs
     transformait une session vide en « travail présent sur le disque, ce n'est pas un échec » ;
  2. une part de groupe parallèle **sans texte** était enregistrée `status: "done"` avec un
     texte vide, agrégé en « (aucun texte) », et la mission était livrée à l'Assistant comme
     **réussie**. D'où l'impression que « le plan existait » alors que rien n'avait été produit.
- **Non établi** — un **arrêt du processus au bout de ~10 s**. Aucun chemin de code ne coupe un
  agent à 10 s (les seuils réels sont : inactivité 10 min, anomalie 30 s/30 min, balayage 30 s,
  busy-stale 25 min). L'observation « s'arrête en quelques secondes » est très probablement la
  **conséquence visuelle** du faux succès ci-dessus (session close, aucun plan affiché), ce que le
  nouveau test de non-régression encadre désormais dans les deux sens : la session **reste
  ouverte** tant qu'aucun livrable n'est arrivé, et une fin **sans** livrable est un **échec
  explicite**.

## 3. Correctifs (frontend uniquement, `src/js/agents-bus.js`)

1. **Une mission de LECTURE ne prouve jamais son travail par le disque** —
   `provesWorkOnDisk(status, startedAt, readonly)` renvoie `false` dès que `readonly === true`
   (plan-maker, architecte, reviewer). Les deux usages restent *fail-safe* côté sonde.
   Les missions d'**écriture** gardent exactement le comportement de la mission 310.
2. **Une part sans livrable et sans preuve disque est un ÉCHEC** (`finishAgentTurn`, branche
   parallèle) : elle est enregistrée `status: "error"` avec un message nommant l'agent et disant
   que la demande **n'a pas été exécutée** (message spécifique pour une lecture). Fini le `done`
   vide agrégé en « (aucun texte) ».
3. **Une mission sans aucun résultat exploitable est livrée en échec** — nouvelle fonction
   **pure** exportée `parallelMissionFailed(results)` : si **toutes** les parts sont en `error`,
   `settleMission(..., "error", …)` au lieu de `"done"`. Une part en échec parmi des parts
   réussies ne fait pas échouer la mission.

Effet de bord assumé et vérifié : le projet est **libéré avant la livraison** dans les deux cas
(succès comme échec), l'Assistant peut donc relancer immédiatement la planification.

## 4. Non-régression

**Nouveau fichier** `src/js/planificateur-plan-complet.test.js` (8 tests) — échoue si l'on
revient à un faux succès de session vide :

- `provesWorkOnDisk` : commit pendant la run + lecture → **aucune** preuve ; la même preuve reste
  valable en écriture.
- `parallelMissionFailed` : toutes parts en échec → échec ; une part exploitable → non-échec ;
  aucun résultat → pas d'échec prononcé (fail-open).
- Mission nommant le **seul** plan-maker : **seul agent lancé**, clé de run de **LECTURE**
  (`projet#read:N`, elle ne prend pas le créneau d'écriture), plan livré **complet** (au moins une
  tâche, intitulé + fichiers), fichiers exploitables par `parsePlanFiles`, verrou **libéré**.
- La session **ne se termine pas en quelques secondes** : sans livrable, la run reste ouverte.
- Une session qui finit **sans livrable** (commit étranger pendant la run) est un **échec**
  nommant le plan-maker, mentionnant « PAS été exécutée », et **libère le projet**.

**Test existant adapté** `src/js/verrou-par-projet.test.js` (POINT I) : il vérifiait l'**ordre**
« verrou libéré AVANT livraison » en s'appuyant sur l'ancien `done` d'une run sans modèle. Il
mesure maintenant la livraison **succès ou échec** (`finally`) et affirme en plus que cette run
est livrée en **échec** (agent sans modèle = aucun livrable). L'invariant testé est conservé,
aucune assertion n'est supprimée.

Résultats : `npm test` → **107 fichiers / 1860 tests, 0 échec** ;
`cargo test --manifest-path src-tauri/Cargo.toml --lib` → **641 passés, 1 ignoré, 0 échec**.

## 5. Documentation et aide intégrée

- `spec_super_agent.md` (bloc d'aide `super-agent`) : nouvelle règle « le plan-maker va au bout et
  livre un plan complet » — session ouverte tant que le plan n'est pas arrivé, échec explicite sans
  livrable, projet libre pour relancer. Rappel de la règle mission 381 (agent lancé = agent
  demandé, identifiant inconnu **refusé** avec la liste des agents disponibles) conservé et
  inchangé.
- `spec_gestion_agents.md` (fiche `plan-maker`) : « Livrable obligatoire » (plan exploitable, échec
  si session vide, une lecture ne prouve rien par le disque).
- `spec_anomaly.md` (§ 2.4 ter + bloc d'aide `anomaly`) : une mission de **lecture** n'a **aucune**
  preuve disque ; verdict « vérifié sur le disque » expliqué à l'utilisateur.
- Commandes de verrou (`/verrou`, `/verrou libere`) : déjà documentées dans
  `spec_multiprojects.md` (bloc d'aide `multiprojets` + § technique) — vérifiées, inchangées.
- `npm run build:handbook` exécuté : `help/handbook.md` régénéré (41 blocs).

## 6. Points ouverts

- **`DIAGNOSTIC-383-plan-maker.md` absent** : la piste « processus tué vers 10 s » n'a **pas** été
  démontrée. Une **mesure en direct** reste nécessaire pour la trancher définitivement (horodatage
  des événements `agent_start` / `message_update` / `agent_end` et de la mort du processus). Le
  correctif rend en tout cas l'issue **honnête** dans les deux cas (succès seulement avec livrable).
- Un arrêt **volontaire** (utilisateur, arrêt auto) garde ses messages dédiés : seul le cas
  « tour terminé sans livrable » change de statut.
- Aucune publication, aucun tag, aucun bump de version, aucune modification de la configuration
  utilisateur.

## 7. Comment vérifier à la main

1. `npm test` puis `cargo test --manifest-path src-tauri/Cargo.toml --lib` → 0 échec.
2. Dans Pilot, demander à l'Assistant une **planification seule** (« fais-moi un plan pour … ») :
   - l'onglet de l'agent **plan-maker** reste actif pendant la réflexion (pas de clôture immédiate) ;
   - le rapport reçu contient un **plan JSON** avec au moins une tâche et ses fichiers ;
   - taper `/verrou` dans la discussion renvoie « 🔓 Verrou de run du projet : LIBRE » après la fin.
3. Provoquer une planification **sans modèle configuré** pour le plan-maker (ou un prompt qui ne
   produit rien) : le compte-rendu doit dire **« ❌ Tâche terminée en ÉCHEC »** en nommant
   l'agent — plus de « ✅ terminée » avec « (aucun texte) ».
