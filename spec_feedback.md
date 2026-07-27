# Spécifications — Feedback utilisateurs (💬)

> Recueil des remarques / évolutions envoyées par les utilisateurs de Pilot,
> et consultation des retours déjà postés. Sans backend dédié ni secret embarqué.

---

## 1. Objectif & contraintes

Permettre à un utilisateur d'envoyer un retour (bug / évolution / remarque) et
de consulter ceux déjà envoyés, **sans backend à héberger ni secret dans le
client** (Pilot est livré en binaire signé → aucun token ne peut y vivre).

Deux canaux d'envoi + un canal de lecture, tous gratuits :

| Canal | Mécanisme | Compte requis ? |
|---|---|---|
| Ouvrir sur GitHub | `https://github.com/pleveneur/pilot/issues/new?title=…&body=…` (issue « vierge » pré-remplie, ouverte dans le navigateur système) | Compte GitHub |
| Envoyer par email | `mailto:patrick.leveneur@gmail.com?subject=…&body=…` (client mail par défaut) | Aucun |
| Lire les retours | `GET https://api.github.com/repos/pleveneur/pilot/issues` (dépôt public, anonyme, CORS `*`) | Aucun (lecture seule) |

Le dépôt `pleveneur/pilot` est **public** → la lecture des issues ne nécessite
aucun token (limite anonyme : 60 req/h/IP, suffisante pour un usage ponctuel).

## 2. UI

Onglet **« 💬 Feedback »** ouvert via un bouton du panneau d'actions
(`#btn-feedback`, icône Lucide `message-square-plus`). **Accessible sans projet
ouvert** (comme l'onglet Aide). Ouverture aussi via la palette de commandes
(« Envoyer une remarque… »).

### Zone 1 — Envoyer un retour (formulaire)

- **Type** (select) : 🐛 Bug / ✨ Évolution / 💬 Remarque.
- **Titre court** (input, requis, ≥ 3 caractères).
- **Description** (textarea, requise, ≥ 5 caractères).
- **Email de contact** (input optionnel).
- **Métadonnées auto** affichées read-only et jointes au corps :
  - Version de Pilot (`getVersion()`).
  - OS détecté via `navigator.userAgent` (Windows / macOS / Linux).
- Boutons d'envoi (désactivés tant que titre + description invalides) :
  - **Ouvrir sur GitHub** → `open_in_browser(<URL issue pré-remplie>)`.
  - **Envoyer par email** → `open_in_browser(<mailto pré-rempli>)`.
- Hint : « GitHub nécessite un compte. Pas de compte ? Email. »

Le corps envoyé est **construit dans Pilot** (Markdown structuré : type, titre,
description, séparateur, infos techniques, mention « Envoyé depuis l'onglet
Feedback »). On ouvre une issue « vierge » (pas un template GitHub) pour que le
corps pré-construit ne soit pas écrasé par un template.

### Zone 2 — Remarques déjà envoyées (lecture issues)

- Liste chargée automatiquement à l'ouverture de l'onglet, bouton « Rafraîchir ».
- Filtre texte local (titre, n°, labels, auteur).
- Chaque entrée : état (🟢 ouverte / 🔴 fermée), `#num`, titre, auteur `@login`,
  date de création, labels (chips). Clic → ouvre l'issue dans le navigateur
  (`open_in_browser`).
- Les **pull requests** renvoyées par l'endpoint `/issues` sont filtrées
  (champ `pull_request` absent).
- Gestion d'erreur réseau et **rate limit GitHub** : message clair avec l'heure
  de reset (`X-RateLimit-Reset`).

## 3. Backend

Aucune nouvelle commande Rust. Réutilisation de la commande existante
`open_in_browser(path: String)` (crate `open`) pour ouvrir :
- une URL `https://github.com/…` (navigateur système) ;
- une URL `mailto:…` (client mail par défaut).

Le `fetch` vers l'API GitHub se fait depuis la WebView (CSP = `null` → aucune
restriction ; CORS `*` côté GitHub en lecture anonyme).

## 4. Templates d'issue GitHub

`.github/ISSUE_TEMPLATE/` structure les issues créées **manuellement** depuis
l'UI GitHub (complémentaire du formulaire interne) :

- `bug.yml` — bug (description + étapes + version + OS + logs).
- `feature.yml` — évolution (description + cas d'usage + version).
- `remark.yml` — remarque (description + version).
- `config.yml` — `blank_issues_enabled: true` + lien de contact email.

## 5. Fichiers

| Fichier | Rôle |
|---|---|
| `src/js/feedback.js` | UI + logique (createFeedback) |
| `src/css/style.css` | Styles isolés `.fb-*` |
| `index.html` | Bouton `#btn-feedback` |
| `src/js/tabs.js` | Mode `feedback` + `_openFeedback` |
| `src/js/main.js` | Listener bouton + entrée palette de commandes |
| `.github/ISSUE_TEMPLATE/*` | Templates d'issue GitHub |

## 6. Confidentialité

- Aucune donnée n'est envoyée sans action explicite de l'utilisateur.
- L'email de contact est **optionnel** et n'est jamais stocké par Pilot.
- La lecture des issues est anonyme (pas de token, pas d'identification).
- Tout se passe côté client ; aucun serveur intermédiaire.

## 7. Limites connues

- Limite API GitHub anonyme : 60 req/h/IP. L'UI le signale et affiche l'heure
  de reset.
- Les issues fermées sont affichées (état `state=all`) pour l'historique.
- Nécessite une connexion internet pour la lecture des retours (l'envoi lui-même
  se fait dans le navigateur/mail du système, indépendamment de Pilot).