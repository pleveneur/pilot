# Rapport — compteur « Travail » unifié (un seul calcul, deux modes)

> Demande : le compteur « Travail » doit afficher la **même valeur** en mode normal
> et en mode « Assistant seul », **calculée à un seul endroit** (règle de la
> décision 361 : tâches en cours + tâches en attente — **règle inchangée**).
> Contraintes : constater d'abord, écrire la cause **avant** de corriger, aucun
> nouveau bouton, aucun nouveau réglage, aucune modification du calcul.
> Protocole `quality-gate` appliqué (`.pi/skills/quality-gate/SKILL.md`).

---

## 1. Constate sur le disque — la cause, écrite AVANT toute correction

**Il n'y a jamais eu deux calculs.** Le disque ne contient qu'un seul calcul, un
seul peintre et un seul nœud — la demande était donc déjà tenue sur ce point
(commits antérieurs `5af237d`, `80adab2`, `e55f60e`). Ce qui divergeait, c'est
**l'alimentation** de ce calcul :

| Élément | Où il vit (constaté) | Nombre |
|---|---|---|
| Calcul | `publishSuperMissionsCount()` — `src/js/super-agent.js` | **1** définition |
| Composition du texte | `agentTaskCounterText()` — `src/js/agent-activity.js` | **1** définition, **1** appel |
| Peintre | `paintAgentPanelTaskCount()` → `setAgentPanelTaskCount()` — `agent-activity.js` | **1** définition, **1** appel (dans le calcul) |
| Nœud affiché | `#agent-activity-count` — `index.html` | **1** occurrence dans tout le document |
| Mode « Assistant seul » | `enterImmersive()` **déplace** `#agent-activity` dans la barre du mode (jamais de copie) | aucun calcul, aucun texte |

**Le défaut, lui, est dans l'abonnement.** Avant correction :

- `main.js` appelle `initAgentActivity(tabs)` au démarrage : ce module abonne la
  **pastille d'état** au store partagé, mais **ne publie pas le compte**.
- Le compte n'était publié que par deux chemins, tous deux dans
  `super-agent.js` : l'ouverture de l'onglet 🧭 Assistant
  (`startSuperMissionsWatch()`, appelée à la création du bloc de l'onglet) et sa
  fermeture (abonnement de secours).
- Conséquence : **tant que l'onglet 🧭 n'avait jamais été ouvert dans la
  session, personne ne publiait le compte**. Le bouton « Travail » restait muet
  (chiffre `hidden`, texte vide) en mode normal, alors que des agents
  travaillaient et que des demandes attendaient leur tour.
- En mode « Assistant seul », l'onglet 🧭 **existe forcément** (c'est lui qui
  porte le mode) : le compteur y était donc alimenté, et donc juste.

**Deux valeurs pour deux modes, sans une seule ligne de calcul dupliquée.** La
cause est l'**alimentation**, pas le calcul.

---

## 2. Valeurs mesurées (recomptées ici, rien n'est recopié)

Mesure exécutée avec les modules de production réels, DOM minimal, deux
commandes manuelles réellement mises en file dans `project-task-queue.js`,
**sans ouvrir aucun onglet** :

| Situation | File réelle | `#agent-activity-count` | Affiché |
|---|---|---|---|
| Avant correction (démarrage, mode normal) | 2 demandes | `hidden = true` | *(rien)* |
| Après correction (démarrage, mode normal) | 2 demandes | `hidden = false` | `0/2` — infobulle « Travail : aucune tache en cours (2 en attente) » |
| Après correction, nœud déplacé dans la barre du mode « Assistant seul » | 2 demandes | même nœud, `hidden = false` | `0/2` — infobulle identique |

Écarts constatés par rapport à ce qui était annoncé avant travaux : **aucun
écart de règle** (le total compte toujours en cours + en attente). Le seul écart
était documentaire (§ 5).

---

## 3. Correction appliquée (minimale, sans changer le calcul)

1. `src/js/super-agent.js`
   - `publishSuperMissionsCount()` est désormais **exportée** (elle reste **le**
     calcul, inchangé au caractère près) pour que le test puisse l'appeler.
   - Ajout de `startTaskCounter()` : **un seul** abonnement
     (`subscribeAgentActivity(publishSuperMissionsCount)`), **idempotent**
     (`if (taskCounterUnsub) return false;`).
   - À la fermeture de l'onglet 🧭, l'ancien abonnement de secours (qui créait un
     **second** abonnement) est remplacé par `startTaskCounter()`.
2. `src/js/main.js` — `startTaskCounter()` est appelé **au lancement de Pilot**,
   juste après `initAgentActivity(tabs)` : le compteur ne dépend plus de
   l'ouverture d'un onglet (même schéma que l'écoute Telegram et l'écoute de
   l'engagement du propriétaire).
3. `src/js/compteur-taches-travail.test.js` — nouveau bloc **(i)** (§ 4).

Résultat : **1 calcul, 1 abonnement, 1 peintre, 1 nœud** → même libellé, même
place, même valeur dans les deux modes. Aucun bouton ajouté, aucun réglage
ajouté, aucune règle de comptage modifiée, aucun changement d'apparence.

---

## 4. Vérifications

### 4.1 Suite complète et build

| Commande | Avant travaux | Après travaux |
|---|---|---|
| `npm test` | 194 fichiers / **3397** tests, 0 échec | 194 fichiers / **3401** tests, 0 échec |
| `npx vitest run src/js/compteur-taches-travail.test.js` | **35** tests | **39** tests, 0 échec |
| `npm run build` | — | **exit 0** (avertissements de découpage préexistants) |
| `npm run build:handbook` | — | 45 blocs régénérés |

### 4.2 Le test exigé — égalité des deux modes

Bloc **(i)** « les deux modes affichent la MEME valeur, alimentee des le
demarrage » (4 tests) :

1. le compteur **démarre avec l'application** (`main.js` importe et appelle
   `startTaskCounter()`, et ne fabrique pas l'onglet 🧭 au démarrage) ;
2. **un seul** abonnement, **un seul** appel au peintre, **une seule**
   définition du calcul dans le module Assistant ;
3. avec le **calcul réel** (`publishSuperMissionsCount`), le nœud est peint avec
   la même valeur, le même texte et la même infobulle **avant**, **pendant** et
   **après** le déplacement dans la barre du mode « Assistant seul » — et c'est
   **la même instance** de nœud (aucune copie) ;
4. une demande qui arrive **pendant** le mode « Assistant seul » change le
   chiffre de la même façon qu'en mode normal.

### 4.3 Contre-épreuves (le test doit rougir si on sépare à nouveau)

| Mutation posée volontairement | Résultat | Restauration |
|---|---|---|
| A — retirer `startTaskCounter()` de `main.js` (compteur rendu dépendant de l'onglet) | **ROUGE** : 1 échec (`expected … to match /^\s*startTaskCounter\(\);$/m`) | code remis à l'identique |
| B — remettre l'ancien **second abonnement** à la fermeture de l'onglet | **ROUGE** : 1 échec (`expected 2 to be 1`, test « un SEUL abonnement ») | code remis à l'identique |
| C — ajouter un **second calcul** propre au mode « Assistant seul » dans `enterImmersive()` | **ROUGE** : 2 échecs (bloc (g) « aucune peinture propre au mode » + bloc (i) « un SEUL calcul ») | code remis à l'identique |

Après restauration : `npx vitest run src/js/compteur-taches-travail.test.js`
→ **39 / 39** ; `npm test` → **3401 / 3401**.

---

## 5. Écart documentaire corrigé

`spec_super_agent.md` (bloc `<!-- HELP:super-agent -->`, donc l'aide intégrée)
affirmait encore, dans la description du mode « Assistant seul » :

> « Ni bouton de synthèse vocale (🔊), ni **suivi du travail** (cercle + panneau à
> trois onglets) en mode assistant seul — ces contrôles restent propres au mode
> standard. »

C'est **faux depuis le déplacement du nœud** : le suivi du travail (entrée
« Travail » + compteur + panneau à trois onglets) **est** dans la barre du mode.
Phrase corrigée, et section « Technique — compteur de travail » complétée
(démarrage au lancement, abonnement unique idempotent, cause de la divergence,
référence du test). `npm run build:handbook` a été relancé (`help/handbook.md`
régénéré, jamais édité à la main).

---

## 6. Ce qui n'a PAS pu être vérifié

- **Aucune vérification à l'écran.** L'application **ne peut pas être lancée**
  dans cet environnement (pas de session graphique Tauri/WebView2) : le
  comportement visuel n'a donc pas été observé — ni la position du compteur dans
  la rangée d'onglets, ni son déplacement dans la barre du mode « Assistant
  seul », ni l'ouverture du panneau à trois onglets depuis cette position.
- Toutes les preuves ci-dessus sont **au niveau du code et des modules réels**
  (fonctions de production appelées, DOM minimal, files réelles), pas au niveau
  du pixel.
- Le rendu réel de l'infobulle et du nom lu par un lecteur d'écran n'a pas été
  vérifié ; seule la valeur des chaînes est testée.

---

## 7. Périmètre respecté

- **Non touchés** : badge « Distant », ligne moteur en bas de colonne (commit
  `9db5ea7`), colonne 280 px, bandeau, thèmes, trois onglets du panneau, barre de
  boutons système.
- `src-tauri/src/agents.rs` était **déjà modifié** avant cette tâche : il est
  laissé **hors** du commit.
- Aucun `push`, aucun tag, aucune version modifiée. **Un seul commit local.**
