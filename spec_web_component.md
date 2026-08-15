# Spécification — Composant web de discussion (issue #56)

> Widget **marque blanche** intégré aux sites web des clients finaux : aide en
> ligne + remontée de bugs/évolutions + suivi des demandes + visibilité des
> demandes des autres utilisateurs. **Aucune mention Pilot/Kalico visible.**
>
> **Statut : 🟡 Plan validé — specs rédigées, aucune implémentation.**
> Le composant web s'appuie sur le **GDS** (sources centralisées + suivi
> fusionné dans PostgreSQL, `spec_gds.md`). Il n'est construit qu'**après** que
> le GDS (phases A→B→C) soit en place et stable. Chaque chantier (phase D)
> passe au **protocole quality-gate** (`.pi/skills/quality-gate/SKILL.md`).
>
> **Arbitrages utilisateur intégrés (10/10)** : cf. §0.2.

---

## 0. Synthèse

### 0.1 But final

Un **widget marque blanche** intégré aux sites web des clients finaux. Pour
l'utilisateur final : c'est l'**aide en ligne** + le **système de remontée de
problèmes** de son logiciel. Le widget est un **petit bot par projet** développé
via Pilot, qui répond aux questions de l'utilisateur (manuel + aide d'utilisation
du logiciel) et assure le **suivi de ses demandes et bugs**.

### 0.2 Arbitrages utilisateur (10/10) — à respecter strictement

| # | Sujet | Décision |
|---|---|---|
| 1 | **Migration suivi SQLite → PostgreSQL** | **Option A** : Postgres = source de vérité **quand connecté au GDS** ; SQLite local = vérité **sinon**. Mode déconnecté + résumés visuels au tableau de bord (cf. `spec_gds.md` §7). |
| 2 | **Transport git poste ↔ VPS** | **SSH par clef liée à l'email** du dev. |
| 3 | **Hébergement** | GDS interne sur le poste fixe via Tailscale (V1). Le **VPS** n'est nécessaire que pour le **widget public** plus tard. Dès le V1, le code supporte **Postgres local OU distant** (IP publique ou URL http/https). |
| 4 | **Format du widget** | **`<iframe>`** avec isolation complète (marque + sécurité). Le widget est un **petit bot par projet** développé via Pilot, qui répond aux questions (manuel + aide) et assure le **suivi des demandes et bugs**. Les demandes utilisateur doivent être **validées par un dev** avant d'être ajoutées aux évolutions du projet. |
| 5 | **Comptes utilisateurs finaux** | **Invitation par le site client** (comptes administrés par Kalico), avec **flux d'inscription via le bot** : demande d'accès sur le site → le bot collecte les infos → **validation par code envoyé par email** → compte actif. Une fois connu, l'utilisateur pose des questions (aide) et demande corrections/évolutions. Le bot **cible bien le besoin** avant de créer une issue en base. |
| 6 | **Mode urgent** | Réservé à une **personne désignée** (admin/dev/gestionnaire) — mécanisme de rôle / gestionnaire de verrous (cf. `spec_gds.md` §5.3). |
| 7 | **Visibilité des tickets des autres** | L'utilisateur voit **seulement ses propres tickets** + un **flux « problèmes en cours » filtré** (pas de lecture complète des tickets des autres). |
| 8 | **Assistant de groupe** | **Cloud (pi/plh)** pour l'instant, mais **moteur configurable côté serveur web** dès le départ. Plus tard : clients avec leurs propres APIs LLM ou comptes cloud Ollama. |
| 9 | **Sécurité remontée publique** | **Captcha** sur le formulaire de remontée + **garde-fous de base** (rate limiting + validation des contenus) **par défaut**. |
| 10 | **Sauvegardes** | Gérées par **l'utilisateur lui-même** (provision + `pg_dump` planifiés + monitoring). |

### 0.3 Évolutions durables (hors périmètre V1 — à noter, pas à implémenter)

- **API systématique pour toute discussion base de données** (ouvrir le logiciel
  sur d'autres plateformes) — évolution future.
- **Mode déconnecté** avec résumés visuels au tableau de bord (cf. `spec_gds.md` §7).
- **Clients avec leurs propres APIs LLM / comptes Ollama** (point 8, §9.4).

---

## 1. Architecture du widget

### 1.1 Intégration — `<iframe>` (arbitrage 4)

- **Intégration** : un **`<iframe>`** servé par le serveur (`GET /widget.js` +
  CSS), injecté dans la page client via une balise `<script>` qui crée l'iframe.
- **Isolation complète** : l'iframe isole la **marque** (thème neutre, copie
  personnalisée par projet/client : titre du produit, logo — **pas** de branding
  Pilot) et la **sécurité** (le contenu du widget ne peut pas interagir avec la
  page hôte au-delà de l'API postMessage contrôlée).
- **Confidentialité** : tout passe par l'API du serveur ; le widget ne contient
  **aucune** logique serveur, seulement du rendu + WS.
- **Modules** : `web_component.rs` (API + statiques), `web/js/widget.js` (front
  marque blanche), `web/css/widget.css`.

### 1.2 Le widget = un petit bot par projet (arbitrage 4)

- Le widget est un **petit bot par projet** développé via Pilot : il répond aux
  questions de l'utilisateur (manuel + aide d'utilisation du logiciel) et assure
  le **suivi de ses demandes et bugs**.
- **Validation par un dev** : les demandes utilisateur doivent être **validées
  par un dev** avant d'être ajoutées aux évolutions du projet (cf. §6.3).

---

## 2. API serveur (nouvelles routes `web_component.rs`)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/widget/bootstrap` | Infos d'initialisation pour le widget (projet, client, libellés produits, thème) |
| `POST` | `/widget/login` | Login de l'utilisateur final (email + mot de passe propre au site) |
| `GET` | `/widget/help/search?q=` | Recherche dans la base d'aide (articles par projet/client) |
| `GET` | `/widget/help/:id` | Contenu d'un article d'aide |
| `GET` | `/widget/tickets` | Tickets visibles par l'utilisateur (les siens + flux « problèmes en cours » filtré, §6.2) |
| `POST` | `/widget/tickets` | Remonte un bug / propose une évolution (captcha + validation, §7) |
| `POST` | `/widget/tickets/:id/comments` | Commente un ticket |
| `GET` | `/widget/tickets/:id` | Détail d'un ticket + suivi |
| `WS` | `/widget/ws` | Mise à jour temps réel des tickets (nouveaux, changement de statut) |

---

## 3. Identification projet / client / utilisateur

### 3.1 Identification projet / client / api_key

- Le projet fournit au widget (au chargement) :
  `{ project_id, client_id, api_key }` → le widget s'authentifie et obtient le
  **contexte** (libellés, aide, tickets).
- **Sécurité** : clef API par projet/client pour isoler les contextes (un site ne
  voit que ses projets/clients) ; tokens de session du widget révocables
  (réutilise le modèle `web_auth.rs`).

### 3.2 Utilisateur final (arbitrage 5)

- **Invitation par le site client** : les comptes sont **administrés par
  Kalico** (le site client invite ses utilisateurs).
- **Flux d'inscription via le bot** : demande d'accès sur le site → le bot
  collecte les infos → **validation par code envoyé par email** → compte actif.
- Une fois connu, l'utilisateur pose des questions (aide) et demande
  corrections/évolutions.
- **Login** : email + mot de passe propre à chaque site ; plusieurs
  utilisateurs, **demandes propres à chacun** (table `users` étendue ou
  `widget_users` par client).

---

## 4. Assistant de groupe (lecture seule)

- Le serveur héberge un **assistant de groupe** (moteur pi/plh) qui : répond aux
  **questions sur les projets gérés**, **ajoute les demandes** (bugs/évolutions)
  au **suivi (tickets)**, permet le **suivi**.
- **Lecture seule stricte** (réutilise le modèle du super-agent : session RPC
  dédiée, extension de lecture seule) — il **ne modifie pas le code**.
- **Moteur configurable** (arbitrage 8) : **cloud (pi/plh)** pour l'instant, mais
  **moteur configurable côté serveur web** dès le départ (champ config
  `gds_group_engine` : `cloud` par défaut, extensible à `ollama` / API LLM).
- **Modules** : `group_assistant.rs` (dérivé de `super_agent.rs`), extension
  `pilot-group-assistant.ts` (outils `ticket_create`, `ticket_search`,
  `project_query`), canal d'événements dédié (`__channel: group`).

---

## 5. Gestion des demandes (tickets) + suivi utilisateur

### 5.1 Cycle de vie

- Une demande (bug/évolution) du widget → **ticket** dans Postgres (`tickets`),
  traité par l'équipe interne **via Pilot** (les devs voient les tickets dans le
  desktop / dans le suivi GDS, les traitent, changent le statut).
- L'utilisateur final suit sa demande : statut (`ouvert`/`en cours`/`en
  correction`/`fermé`), commentaires, **mises à jour temps réel** via WS.

### 5.2 Visibilité des tickets des autres (arbitrage 7)

- L'utilisateur voit **seulement ses propres tickets** + un **flux « problèmes
  en cours » filtré** (filtre par statut ouvert/en cours).
- **Pas de lecture complète des tickets des autres** : les détails d'un ticket
  non lié à lui ne sont pas accessibles (seul le flux agrégé filtré est visible).

### 5.3 Validation par un dev (arbitrage 4)

- Les demandes utilisateur doivent être **validées par un dev** avant d'être
  ajoutées aux évolutions du projet. Un ticket remonté passe par un statut
  « en attente de validation » ; le dev valide (→ ajout aux évolutions) ou
  rejette (avec commentaire).

---

## 6. Inscription via le bot (arbitrage 5)

### 6.1 Flux d'inscription

1. **Demande d'accès** sur le site (formulaire du widget).
2. Le **bot collecte les infos** (nom, email, besoin).
3. **Validation par code envoyé par email** → compte actif.
4. Une fois connu, l'utilisateur pose des questions (aide) et demande
   corrections/évolutions.

### 6.2 Ciblage du besoin

- Le bot **cible bien le besoin** avant de créer une issue en base : il pose des
  questions de clarification (via `pilot-choices`) et ne crée un ticket que
  lorsque le besoin est clair.

---

## 7. Sécurité de la remontée publique (arbitrage 9)

- **Captcha** sur le formulaire de remontée (anti-bot).
- **Garde-fous de base par défaut** :
  - **Rate limiting** sur `/widget/login` et `/widget/tickets` (réutilise
    `web_rate.rs`).
  - **Validation des contenus** (longueur max, contenu attendu, refus de
    contenu vide/abusif).
  - **Quotas par utilisateur** (nombre de tickets / période).
- **Isolation stricte des contextes client** par clef API (un site ne voit que
  ses projets/clients).
- **CORS** restreint aux domaines clients autorisés (liste blanche) ; cookies
  Secure/HttpOnly ; TLS obligatoire pour le widget public.

---

## 8. Découpage en phase D avec critères de fin

> Chaque étape : **objectif** · **modules** · **dépendances** · **tests** ·
> **critère de fin**. Chaque étape passe au **quality-gate** avant validation.
> La phase D n'est lancée qu'**après** que les phases A→B→C du GDS soient
> stables (`spec_gds.md` §11).

### PHASE D — Composant web (issue #56)

**D1. API tickets & contexte widget**
- Modules : `web_component.rs` (routes §2), `tickets.rs`, `gds_db.rs`
  (tickets/ticket_comments/ticket_events), `web_rate.rs`/`web_audit.rs` étendus.
- Dépendance : A1, A2, C1 (GDS). Tests : création ticket, statuts, pagination,
  isolation client, captcha + rate limiting + validation des contenus.
- Critère : API complète + isolation par clef projet/client + garde-fous de
  remontée publique.

**D2. Widget marque blanche (front)**
- Modules : `web/js/widget.js`, `web/css/widget.css`, endpoint `/widget/*`.
- Dépendance : D1. Tests : rendu dans une page tierce (iframe), login utilisateur
  final, aide, remontée, suivi, visibilité filtrée des autres.
- Critère : §9 MVP complet.

**D3. Assistant de groupe → remontée dans le suivi**
- Objectif : l'assistant de groupe **ajoute les demandes** au suivi (tickets) et
  répond aux questions des utilisateurs du widget. Flux d'inscription via le bot
  (code email) + ciblage du besoin avant création d'issue.
- Modules : `group_assistant.rs` (outils ticket_create/search), `tickets.rs`.
- Dépendance : C2 (GDS), D1. Critère : une demande posée au widget → ticket
  visible côté interne + suivi utilisateur à jour ; une demande d'accès → compte
  actif après validation par code email.

---

## 9. Critère de fin (MVP complet)

- Le widget s'affiche dans un site client (**marque blanche**, `<iframe>`
  isolé), aide consultable, remontée de bug/évolution fonctionnelle (captcha +
  validation par un dev), suivi de la demande par l'utilisateur, **et**
  visibilité filtrée des demandes des autres (ses tickets + flux « problèmes en
  cours ») — le tout **sans aucune mention Pilot/Kalico**.

---

## 10. Anti-régression

- **Ne pas casser l'existant** : le widget s'appuie sur le GDS (Postgres) et
  réutilise `web_server.rs` / `web_auth.rs` / `web_rate.rs` / `web_audit.rs`
  sans les casser.
- **Ne pas modifier** les modules existants d'agents ni `ask_pi_caged_timed`.
- **Session et canal dédiés** pour l'assistant de groupe (`__channel: group`).
- **Lecture seule garantie techniquement** pour l'assistant de groupe.
- Chaque chantier passe au **protocole quality-gate**
  (`.pi/skills/quality-gate/SKILL.md`) avant validation.

---

*Voir aussi : `plan_gds.md` (roadmap), `spec_gds.md` (GDS, prérequis),
`spec_web_remote.md` (web-server/axum existant), `spec_super_agent.md` (suivi
multi-projets + base SQLite), `spec_multiprojects.md` (collection de projets),
`AGENTS.md` (architecture & conventions).*
