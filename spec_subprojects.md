# Spec — Sous-projets liés (ouverture groupée)

> Déclarer des **sous-projets liés** à un projet parent, pour que Pilot **propose**
> (sans forcer) de les ouvrir en même temps que le parent. **Local-first** par
> défaut, **synchro GDS optionnelle** si le GDS est configuré.
>
> **Statut : 🟡 Proposition — spec rédigée, aucune implémentation.**
> Chantier **SÉPARÉ** de la refonte du système d'agents (R1-R8) : ne pas le coder
> dans les phases 1-6 de la refonte agents. La partie synchro est rattachée au
> volet GDS (`spec_gds.md`).

---

## 1. Objectif & périmètre

Un projet peut avoir des **sous-projets liés** (ex. le projet `G:\IA_PL\pilot` a
pour sous-projets `G:\IA_PL\pilot - Analyseur` et `G:\IA_PL\Pilot_Design`).

À l'**ouverture** d'un projet, Pilot **propose** (ne force pas) d'ouvrir en même
temps ses sous-projets liés. L'utilisateur reste maître : il **accepte ou refuse**.
**Pas d'ouverture automatique en cascade.**

### Distinction avec les liens inter-projets (issue #15)
- **`project_links`** (inter-projets, `spec_interproject.md`) : relation **orientée
  source→cible** pour **déposer une tâche/analyse** et lancer l'agent cible. C'est un
  mécanisme de **travail collaboratif** entre projets.
- **Sous-projets liés** (cette spec) : relation **parent→enfants** purement
  **déclarative**, utilisée pour **proposer une ouverture groupée**. Aucun dépôt de
  tâche, aucun lancement d'agent automatique.

Les deux mécanismes sont **indépendants** et peuvent coexister (un projet peut être
lié en inter-projets ET avoir des sous-projets).

---

## 2. Gestion local-first

### 2.1 Stockage local (source de vérité par défaut)

La déclaration des sous-projets est stockée **dans le projet parent**, dans le
dossier `.pilot/` :

```
<projet_parent>/.pilot/subprojects.json
```

**Format** (liste de chemins normalisés, avec nom optionnel pour l'affichage) :

```json
{
  "version": 1,
  "subprojects": [
    { "path": "G:\\IA_PL\\pilot - Analyseur", "name": "pilot - Analyseur" },
    { "path": "G:\\IA_PL\\Pilot_Design", "name": "Pilot_Design" }
  ]
}
```

- **Pourquoi dans le projet** (et pas dans la config globale) : la déclaration
  **suit le projet** (versionnable, partageable, cohérente entre postes), et survit
  au redémarrage sans dépendre d'une config machine.
- **Chemins normalisés** : même canonicalisation que le reste de Pilot
  (`canonicalize` + normalisation des séparateurs). Les entrées orphelines
  (dossier supprimé) sont **filtrées à la lecture**.
- **Nom** : optionnel, dérivé du dernier segment du chemin si absent.

### 2.2 Commandes Tauri (module `subprojects.rs`)

| Commande | Rôle |
|---|---|
| `get_subprojects(project)` | Liste des sous-projets liés (seuls ceux qui existent encore) |
| `set_subprojects(project, subprojects)` | Remplace la liste (persistée dans `.pilot/subprojects.json`) |
| `add_subproject(project, path)` | Ajoute un sous-projet (dédupliqué) |
| `remove_subproject(project, path)` | Retire un sous-projet |

- Lecture/écriture du fichier via les helpers I/O existants (`files.rs`).
- Écriture **atomique** (fichier temp + rename) pour ne pas corrompre le fichier.

### 2.3 UI de gestion

- **Modale « Sous-projets »** (bouton dans la barre d'actions, à côté de 🔗) :
  - liste des sous-projets liés (avec ✕ pour retirer) ;
  - ajout via sélecteur de dossier natif (ou choix parmi les projets ouverts /
    récents) ;
  - bouton « Envoyer vers le GDS » (visible **seulement si GDS configuré**, cf. §4).

---

## 3. Proposition d'ouverture (UI)

### 3.1 Déclenchement

À la fin de `openProjectByPath` (après chargement du projet, restauration des
onglets), le frontend appelle `get_subprojects(project)`. Si la liste est non vide
et contient des projets **pas encore ouverts**, Pilot affiche une **proposition**.

### 3.2 Présentation

- **Modale de proposition** (non bloquante, style des modales existantes) :
  - titre : « Ouvrir aussi les sous-projets liés ? » ;
  - liste des sous-projets **non ouverts** (nom + chemin), avec case à cocher
    pré-cochée par défaut ;
  - boutons : **« Ouvrir la sélection »** / **« Non, merci »**.
- **Pas d'ouverture en cascade** : si un sous-projet sélectionné a lui-même des
  sous-projets, on **ne les ouvre pas** automatiquement (l'utilisateur les verra à
  l'ouverture de ce sous-projet). Évite les boucles et les cascades inattendues.
- **Mémorisation du refus** (optionnel, à décider) : un flag « ne plus demander
  pour ce projet » persisté dans la config globale, réinitialisable dans la modale
  de gestion. Par défaut : **toujours demander** (comportement le plus simple et
  le plus sûr).

### 3.3 Ouverture

- « Ouvrir la sélection » → pour chaque sous-projet coché : `openProjectByPath`
  (ajoute le projet à la collection multi-projets, sans le rendre actif si un autre
  projet est déjà actif — ou en gardant le parent actif). Le parent reste le projet
  actif ; les sous-projets s'ajoutent à la barre « Projets en cours ».
- Les sous-projets **déjà ouverts** sont ignorés (pas de doublon).

---

## 4. Pont optionnel vers le GDS

### 4.1 Principe

- **Local par défaut** : la déclaration vit dans `.pilot/subprojects.json` et
  fonctionne sans GDS.
- **Synchro GDS optionnelle** : si le GDS est **configuré/disponible** (cf.
  `spec_gds.md`), Pilot **propose** d'envoyer la déclaration de sous-projets vers
  le GDS. Sinon, tout reste local.

### 4.2 Modèle GDS

- Nouvelle table `subprojects` dans PostgreSQL (phase C du GDS, ou table dédiée
  ajoutée à la phase A/B) :

```
subprojects(
  id, parent_project_id FK, child_project_id FK,
  created_at, updated_at
)
```

- Le GDS enregistre la relation **parent→enfant** entre projets connus du GDS.
  Les projets doivent être enregistrés dans `projects` (GDS) pour être liés.

### 4.3 Comportement

- **Envoi** : bouton « Envoyer vers le GDS » dans la modale de gestion → commande
  `gds_sync_subprojects(project)` qui pousse la déclaration locale vers Postgres
  (upsert des relations, suppression des retirées).
- **Réception** : à l'ouverture d'un projet, si GDS connecté, Pilot peut **fusionner**
  les sous-projets déclarés localement avec ceux déclarés côté GDS (union). La
  **source de vérité reste locale** ; le GDS est un **miroir/partage**.
- **Mode déconnecté** : sans GDS, la déclaration locale reste pleinement
  fonctionnelle (cohérent avec l'arbitrage 1 du GDS : SQLite/local = vérité sinon).

### 4.4 Rattachement au volet GDS

- La partie synchro (table `subprojects`, commande `gds_sync_subprojects`) est
  rattachée au **volet GDS** (`spec_gds.md`) et implémentée **après** que le GDS
  de base (phases A-B) soit stable. La partie **local-first** (cette spec, §2-3)
  est **indépendante** et peut être livrée en premier.

---

## 5. Points de vigilance / anti-régression

- **Ne pas casser l'ouverture mono-projet** : si un projet n'a pas de sous-projets,
  aucun changement de comportement (pas de modale, pas de coût).
- **Pas d'ouverture en cascade** : garantit l'absence de boucles et de surcharge
  d'ouverture.
- **Ne pas confondre avec `project_links`** (inter-projets) : mécanismes distincts,
  stockages distincts (config globale vs `.pilot/subprojects.json`).
- **Écriture atomique** du fichier JSON pour éviter la corruption.
- **Filtrage des orphelins** à la lecture (projets supprimés).
- Chaque implémentation passe au **protocole quality-gate**
  (`.pi/skills/quality-gate/SKILL.md`).

---

<!-- HELP:subprojects -->
## Sous-projets liés (ouverture groupée)

Un projet peut déclarer des **sous-projets liés** (ex. un projet principal et ses
projets satellites). À l'ouverture d'un projet, Pilot **propose** d'ouvrir aussi ses
sous-projets — tu restes maître : tu **acceptes ou refuses**, rien ne s'ouvre
automatiquement en cascade.

- **Déclarer** : bouton « Sous-projets » dans la barre d'actions → ajoute des
  dossiers liés. La déclaration est stockée **dans le projet** (`.pilot/`) et
  conservée au redémarrage.
- **À l'ouverture** : si le projet a des sous-projets non ouverts, Pilot affiche une
  proposition avec cases à cocher → « Ouvrir la sélection » ou « Non, merci ».
- **Local par défaut** : tout fonctionne sans serveur. Si le GDS est configuré, un
  bouton permet d'**envoyer la déclaration vers le GDS** pour la partager.
<!-- /HELP:subprojects -->
