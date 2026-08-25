# Spécification — Gestion des synchronisations d'assistants (via GDS)

> Évolution du suivi fusionné du GDS (§6 / Phase C1) : le **contexte d'un
> projet** (suivi + historique de sessions + état de reprise + configuration de
> l'assistant) **voyage avec le projet** entre les postes, via le serveur GDS.
> Un **paramétrage d'envoi/réception par poste** pilote ce qui part et ce qui
> s'intègre, pour que l'assistant du poste qui prend le relais soit
> immédiatement au courant du travail déjà fait.
>
> **Statut : 🟡 Plan validé avec l'utilisateur — design défini, aucune
> implémentation.**
> **Prérequis : GDS de base (phases A→B→C) en place et stable.**
> Chaque chantier d'implémentation passe au **protocole quality-gate**
> (`.pi/skills/quality-gate/SKILL.md`) avant validation.

---

## 0. Synthèse

Quand le **GDS est activé** et que le **serveur est accessible**, le contexte
d'un projet (son **suivi**, son **historique de sessions**, son **état de
reprise** et la **configuration de son assistant**) se **partage entre les
postes** via le serveur GDS. Le poste qui a travaillé **pousse** ce contexte, le
poste qui prend le relais **le récupère et l'intègre** dans son assistant.

**Tout n'est pas synchronisé.** Le drapeau **GDS / personnel** est déduit
**automatiquement** : un projet présent sur le GDS = projet **entreprise** →
synchronisé ; sinon = projet **personnel** → **jamais** synchronisé. Cela permet
de gérer des **projets personnels hors entreprise** sans risque de fuite ni de
pollution.

Ce design est une **évolution du §6 / Phase C1 du GDS** : le suivi fusionné
existant est étendu avec le concept de « **contexte de projet qui voyage avec
le projet** » et un **paramétrage d'envoi/réception par poste**.

---

## 1. Données concernées

### 1.1 Synchronisables

| Donnée | Détail |
|---|---|
| **Suivi** | clients, projets, tâches, décisions, jalons |
| **Historique de sessions** | le fil des sessions d'agents du projet |
| **Contexte / état de reprise** | « où on en est » : avancement, travail déjà fait, prochaines étapes |
| **Configuration de l'assistant** | réglages applicables au projet (avec **validation utilisateur**) |

### 1.2 Jamais synchronisées

| Donnée | Raison |
|---|---|
| **Projets personnels (locaux)** | hors entreprise → jamais envoyés (drapeau déduit) |
| **Tables de suivi personnelles de l'assistant** | ex: `magnus_*` → propre au poste / à l'utilisateur |
| **Rappels programmés** | `assistant_schedules` → strictement locaux à l'assistant du poste |

**Principe — confidentialité par défaut :** le personnel reste local, le
partagé se sync par défaut, et l'utilisateur garde toujours le choix. Les
catégories « toujours locales » ci-dessus sont **protégées par défaut** et ne
partent **jamais** ; les catégories synchronisables (§1.1) sont partagées par
défaut, mais l'utilisateur peut affiner par catégorie (sans pouvoir forcer le
départ de données protégées).

---

## 2. Déclenchement & politique par défaut

- **Option de l'assistant, activée par défaut** : à la fin d'une session de
  travail sur un projet GDS, l'assistant de suivi multi-projets **lance un
  agent dédié hors projet** (rôle « synchronisation ») qui applique
  automatiquement la politique.
- **Aucun bouton manuel** : la synchronisation est **automatique et
  discrète** — pas d'oubli de clic, pas de panneau à remplir.
- **Politique par défaut appliquée par l'agent** :
  - pousser au serveur GDS les données **partagées** (§1.1) du projet ;
  - s'assurer que les données **personnelles** (§1.2) **restent locales** ;
  - respecter les **choix éventuels de l'utilisateur** par catégorie
    (qui **affinent**, sans jamais annuler les garde-fous globaux).
- La **config globale côté serveur** s'applique à **tous les assistants** ;
  les choix locaux la **complètent** sans l'annuler.

---

## 3. Acteurs / « qui fait quoi »

| Acteur | Rôle |
|---|---|
| **Utilisateur (dev)** | Valide ce qui **part** (envoi) et ce qui **s'intègre** (réception), via la config par poste |
| **Serveur GDS** | Source de vérité pour les projets GDS ; héberge le **suivi partagé** + l'**historique de chaque projet** + la **config globale** |
| **Assistant du poste A (modificateur)** | Accumule le **contexte** pendant le travail ; **pousse au serveur** à la fin |
| **Assistant du poste B (relais)** | Récupère le projet + son **historique depuis le serveur** ; **intègre le contexte** dans son propre assistant |
| **Agent dédié « synchronisation » (lancé par l'assistant)** | Applique la **politique par défaut** automatiquement : pousse le partagé au serveur, garde le personnel local, respecte les choix utilisateur |
| **Assistant de groupe (serveur)** | Lit le **suivi partagé** ; **ajoute les demandes clients** |

---

## 4. Cycle de vie d'un projet GDS

1. **Verrou projet posé** : un seul modifieur à la fois → pas de conflit en
   théorie.
2. Le **poste A travaille** ; son **assistant accumule le contexte**.
3. **A termine** → **synchronisation automatique** : le **suivi + l'historique**
   du projet **partent au serveur** (selon la **config d'envoi de A**).
4. Le **poste B récupère le projet** ; son **assistant reçoit et intègre
   l'historique** (selon la **config de réception de B**). Le nouvel assistant
   est **immédiatement au courant du travail déjà fait**.
5. Le **contexte continue de s'accumuler** au fil des postes ; la **connaissance
   de l'assistant s'améliore à chaque relais**.

---

## 5. Déclenchement & conflits

- **Déclenchement automatique** : l'assistant lance l'agent dédié à la fin de
  la session de travail sur un projet GDS (ou dès que le serveur répond) — le
  projet étant verrouillé, la sync est **sans compétition d'écriture**.
- **Conflits** : normalement **impossibles** grâce au **verrou global projet**
  (un seul modifieur à la fois). Si un conflit survient **quand même** → le
  **signaler à l'utilisateur**, ne **pas écraser silencieusement** (pas de
  « dernier écrit gagne » silencieux).

---

## 6. Règles / contraintes

- **Ne rien casser de l'existant** : le **super-agent desktop (SQLite)
  continue de fonctionner en mode déconnecté** (Option A, **zéro régression**).
- S'applique **côté serveur** → à **tous les assistants**.
- Chaque chantier d'implémentation passe au **protocole quality-gate**
  (`.pi/skills/quality-gate/SKILL.md`).
- **Rattachement** : évolution du **GDS §6 / Phase C1**.
- **Prérequis** : **GDS de base en place et stable** (phases A→B→C).

---

## 7. Ouvert / à préciser plus tard

*Points à détailler lors de la Phase C1 du GDS.*

- *modules Rust concrets : `gds_sync.rs` étendu, tables Postgres dédiées ;*
- *le point de savoir si **l'historique de sessions est fusionné globalement
  ou par projet**.*

---

*Voir aussi : `spec_gds.md` (§6 suivi fusionné, §5 verrous, §8 assistant de
groupe), `spec_super_agent.md` (suivi multi-projets, base SQLite
`~/.pilot/super-agent.db`, tables clients/projects/tasks/decisions/
session_summaries/milestones), `plan_gds.md` (roadmap).*
