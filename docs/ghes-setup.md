# Mise en place d'un GitHub Enterprise Server (GHES) auto-hébergé et branchement de Pilot

> Document de documentation technique — **lecture seule sur le code de Pilot**.
> Ce document décrit comment déployer un serveur **GitHub Enterprise Server (GHES)**
> auto-hébergé et comment adapter Pilot (releases, issues, feedback, mises à jour)
> pour qu'il pointe vers ce serveur au lieu de `github.com`.
>
> **Statut : 🟡 Document de référence — à valider avec l'utilisateur avant toute
> modification du code de Pilot.**

---

## 0. Résumé de l'usage actuel de GitHub dans Pilot

L'analyse du code montre que Pilot utilise GitHub à **4 endroits distincts**, tous
actuellement câblés en dur sur `github.com` et le dépôt public `pleveneur/pilot` :

| Composant | Fichier(s) | Ce qu'il fait | Dépend de github.com |
|---|---|---|---|
| **Workflow de release** | `.github/workflows/release.yml` | Déclenché par tag `v*` : tests → création release → build signé → génération `latest.json` | Oui (API + Actions) |
| **Scripts de release** | `scripts/create-release.js`, `scripts/gen-latest-json.js` | Créent la release, uploadent les assets, génèrent `latest.json` via l'API REST | Oui (`api.github.com`, `uploads.github.com`) |
| **Updater (mises à jour)** | `src/js/updater.js`, `src-tauri/tauri.conf.json` | Vérifie les MAJ via l'endpoint `latest.json` + récupère l'historique des releases | Oui (`api.github.com`, endpoint updater) |
| **Feedback / Issues** | `src/js/feedback.js`, `.github/ISSUE_TEMPLATE/` | Ouvre une issue pré-remplie, lit les issues existantes | Oui (`api.github.com`, `github.com`) |

**Points clés identifiés :**

- **Aucune commande Rust spécifique à GitHub** : la seule commande utilisée est
  `open_in_browser(path)` (`src-tauri/src/files.rs`), générique (ouvre une URL dans
  le navigateur système). Elle n'a pas besoin d'être modifiée.
- **Secrets utilisés** (déclarés dans `release.yml`) :
  - `GITHUB_TOKEN` (token d'authentification Actions, fourni automatiquement par GitHub)
  - `TAURI_SIGNING_PRIVATE_KEY` (clé privée de signature de l'updater)
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (mot de passe de la clé, si protégée)
- **URLs en dur** à adapter pour un GHES :
  - `https://api.github.com/repos/...` (API REST) → `https://<GHES>/api/v3/repos/...`
  - `https://uploads.github.com/repos/...` (upload d'assets) → `https://<GHES>/api/uploads/repos/...`
  - `https://github.com/<repo>/issues/new` (ouverture d'issue) → `https://<GHES>/<repo>/issues/new`
  - `https://github.com/pleveneur/pilot/releases/latest/download/latest.json` (endpoint updater) → `https://<GHES>/<repo>/releases/latest/download/latest.json`
  - `REPO = "pleveneur/pilot"` (dans `updater.js` et `feedback.js`)

---

## 1. Prérequis matériel et logiciel pour GHES

> ⚠️ Les valeurs ci-dessous sont les **recommandations officielles GitHub** pour GHES.
> Elles dépendent de la **version** de GHES et du **nombre d'utilisateurs** — à
> confirmer avec l'utilisateur (voir §8).

### 1.1 Matériel (recommandations officielles GitHub)

| Taille | Utilisateurs | vCPU | RAM | Stockage (données) | Stockage (racine) |
|---|---|---|---|---|---|
| Petite | ≤ 300 | 8 | 32 Go | 250 Go | 200 Go |
| Moyenne | 300 – 3 000 | 16 | 64 Go | 500 Go | 300 Go |
| Grande | 3 000 – 5 000 | 32 | 128 Go | 1 To | 500 Go |

- **Disque** : SSD recommandé (les dépôts git et les Actions génèrent beaucoup d'I/O).
- **Sauvegardes** : prévoir un espace de sauvegarde hors serveur (au moins 2× la taille
  des données).
- **Réseau** : adresse IP statique ou nom DNS dédié.

### 1.2 Logiciel

- **Système d'exploitation** : Ubuntu 20.04 / 22.04 / 24.04 LTS (recommandé), ou
  Red Hat Enterprise Linux 8/9, ou Oracle Linux 8/9. **64 bits uniquement.**
- **Version de GHES** : la dernière version stable (ex. 3.15+). Vérifier la
  compatibilité avec les fonctionnalités utilisées (releases, issues, Actions).
- **Licence** : un fichier de licence `.ghl` fourni par GitHub (essai ou commercial).
  Le nombre de **seats** (utilisateurs) doit couvrir les comptes qui se connecteront.
- **Accès internet sortant** : GHES doit pouvoir joindre `github.com` pour les mises à
  jour du produit et les licences (sauf configuration hors-ligne).

---

## 2. Installation et configuration du serveur GHES

### 2.1 Installation de la machine

1. **Installer l'OS** (Ubuntu 22.04 LTS recommandé) sur la machine cible.
2. **Configurer le réseau** : IP statique, hostname, DNS (voir §3).
3. **Ouvrir les ports** nécessaires (voir §3.3).
4. **Télécharger l'image GHES** depuis le portail GitHub (fichier `.tar.gz` de la
   version choisie) et la transférer sur le serveur.

### 2.2 Installation de GHES

1. **Créer l'utilisateur d'installation** :
   ```bash
   sudo useradd --create-home --shell /bin/bash admin
   sudo passwd admin
   ```
2. **Déployer l'image** (en tant que `admin`) :
   ```bash
   sudo mkdir -p /opt/github-enterprise
   sudo tar -xzf github-enterprise-<version>.tar.gz -C /opt/github-enterprise
   sudo /opt/github-enterprise/install.sh
   ```
3. **Configurer via l'interface web** : ouvrir `https://<GHES-hostname>/setup` dans
   un navigateur et suivre l'assistant :
   - Charger le fichier de licence `.ghl`.
   - Définir le mot de passe administrateur.
   - Configurer le certificat TLS (voir §3.2).
   - Configurer le stockage et les sauvegardes.
   - Activer les services souhaités (Git, GitHub Actions, Pages, etc.).

### 2.3 Configuration des services

- **Git** : activé par défaut (dépôts, branches, tags).
- **GitHub Actions** : à activer explicitement (voir §5.3 — nécessite des runners
  auto-hébergés, contrairement à github.com).
- **Issues** : activé par défaut (permet le feedback).
- **Releases** : activé par défaut (permet la publication des versions).

---

## 3. Configuration réseau (DNS, HTTPS, ports)

### 3.1 DNS

- Créer un enregistrement **A** (ou **CNAME**) pointant vers l'IP du serveur GHES.
  Exemple : `ghes.example.com → 192.168.1.50`.
- Le hostname doit être **stable et définitif** : il est utilisé dans les URLs des
  dépôts, les tokens, et l'endpoint updater. Le changer plus tard casse les URLs.

### 3.2 HTTPS / certificat TLS

- GHES gère le TLS. Deux options :
  - **Certificat auto-signé** (test uniquement) — déconseillé en production.
  - **Certificat signé par une autorité** (Let's Encrypt, ou CA interne d'entreprise)
    — recommandé. GHES peut générer un certificat Let's Encrypt automatiquement si le
    DNS et le port 80 sont accessibles.
- ⚠️ **Important pour Pilot** : le certificat doit être **fiable pour les clients**.
  Si c'est une CA interne, la racine doit être installée sur les postes qui exécutent
  Pilot (sinon les `fetch` de la WebView et l'updater échoueront avec une erreur TLS).

### 3.3 Ports réseau

| Port | Protocole | Usage |
|---|---|---|
| 22 | TCP | SSH (git over SSH) |
| 80 | TCP | HTTP (redirection vers HTTPS) |
| 443 | TCP | HTTPS (interface web, API, git over HTTPS) |
| 8443 | TCP | HTTPS (console d'administration `/setup`) |
| 9418 | TCP | git:// (optionnel) |

---

## 4. Création des tokens et secrets pour Pilot

### 4.1 Tokens d'accès personnel (PAT) sur GHES

GHES supporte les **PAT classiques** et les **PAT fine-grained** (selon version).

- **PAT classique** : créé dans `https://<GHES>/settings/tokens`.
  - Scopes nécessaires pour le workflow de release : `repo` (lecture/écriture sur les
    dépôts, releases, issues), `workflow` (si le token doit déclencher des workflows).
- **PAT fine-grained** (recommandé si version ≥ 3.9) : créé dans
  `https://<GHES>/settings/personal-access-tokens`.
  - Permissions : `Contents: Read and write`, `Releases: Read and write`,
    `Issues: Read and write`, `Metadata: Read` (obligatoire).
  - Restreindre au dépôt `pilot`.

### 4.2 Secrets à configurer dans le dépôt GHES

Dans `https://<GHES>/<owner>/pilot/settings/secrets/actions` :

| Secret | Valeur | Usage |
|---|---|---|
| `GITHUB_TOKEN` | **Automatique** (fourni par GHES Actions) | Authentification des jobs Actions |
| `TAURI_SIGNING_PRIVATE_KEY` | Clé privée de signature updater (inchangée) | Signature des artefacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Mot de passe de la clé (si protégée) | Déverrouillage de la clé |

> **Note** : `GITHUB_TOKEN` est **généré automatiquement** par GHES pour chaque
> workflow (comme sur github.com). Il n'a pas besoin d'être créé manuellement.
> Les deux secrets `TAURI_*` sont **identiques** à ceux utilisés aujourd'hui sur
> github.com — ils n'ont pas besoin d'être régénérés.

### 4.3 Token pour l'updater / le feedback (si accès privé)

- Si le dépôt sur GHES est **privé**, l'updater et le feedback ne pourront pas lire
  les releases/issues **anonymement** (contrairement à github.com où le dépôt est
  public). Il faudra alors :
  - soit rendre le dépôt **public** (recommandé pour un usage simple),
  - soit embarquer un token de lecture dans Pilot (⚠️ **déconseillé** : un binaire
    signé ne doit pas contenir de secret — c'est le principe actuel de Pilot).

---

## 5. Adaptation du workflow de release de Pilot vers le GHES

### 5.1 Ce qui change

Le workflow `.github/workflows/release.yml` et les scripts `create-release.js` /
`gen-latest-json.js` utilisent des **URLs en dur** vers `api.github.com` et
`uploads.github.com`. Pour GHES, il faut :

1. **Remplacer les URLs d'API** dans les scripts :
   - `https://api.github.com/repos/...` → `https://<GHES>/api/v3/repos/...`
   - `https://uploads.github.com/repos/...` → `https://<GHES>/api/uploads/repos/...`
2. **Remplacer le repo** : `pleveneur/pilot` → `<owner>/pilot` (le propriétaire sur GHES).
3. **Adapter les runners** : GHES **ne fournit pas de runners hébergés** (les
   `ubuntu-latest`, `windows-latest`, `macos-latest` de github.com n'existent pas sur
   GHES). Il faut des **runners auto-hébergés** (voir §5.3).

### 5.2 Modifications concrètes

**`scripts/create-release.js`** :
- Ligne `https://api.github.com/repos/${REPO}/releases/tags/...` → `https://<GHES>/api/v3/repos/${REPO}/releases/tags/...`
- Ligne `https://api.github.com/repos/${REPO}/releases` (POST) → `https://<GHES>/api/v3/repos/${REPO}/releases`

**`scripts/gen-latest-json.js`** :
- Ligne `https://api.github.com/repos/${REPO}/releases/tags/...` → `https://<GHES>/api/v3/repos/${REPO}/releases/tags/...`
- Ligne `https://api.github.com/repos/${REPO}/releases/${releaseId}` (PATCH) → `https://<GHES>/api/v3/repos/${REPO}/releases/${releaseId}`
- Ligne `https://api.github.com/repos/${REPO}/releases/assets/${assetId}` (DELETE) → `https://<GHES>/api/v3/repos/${REPO}/releases/assets/${assetId}`
- Ligne `https://uploads.github.com/repos/${REPO}/releases/${releaseId}/assets` (POST) → `https://<GHES>/api/uploads/repos/${REPO}/releases/${releaseId}/assets`

**`.github/workflows/release.yml`** :
- Remplacer `runs-on: ubuntu-latest` / `windows-latest` / `macos-latest` par des
  labels de **runners auto-hébergés** (ex. `runs-on: [self-hosted, linux, x64]`).
- Les `actions/checkout@v7`, `dtolnay/rust-toolchain@stable`, `actions/setup-node@v7`
  et `tauri-apps/tauri-action@v0` restent utilisables (ce sont des actions du
  marketplace, à condition que les runners aient accès à internet ou que les actions
  soient mises en cache localement).

### 5.3 Runners auto-hébergés pour GitHub Actions sur GHES

GHES nécessite des **runners auto-hébergés** (self-hosted runners) :

1. **Installer le runner** sur une machine (ou plusieurs, une par plateforme cible :
   Windows, macOS, Linux) :
   ```bash
   # Depuis https://<GHES>/<owner>/pilot/settings/actions/runners/new
   mkdir actions-runner && cd actions-runner
   curl -o actions-runner-linux-x64-<version>.tar.gz -L <URL fournie par GHES>
   tar xzf actions-runner-linux-x64-<version>.tar.gz
   ./config.sh --url https://<GHES>/<owner>/pilot --token <REGISTRATION_TOKEN>
   ./run.sh
   ```
2. **Configurer les labels** : chaque runner doit avoir un label correspondant à la
   plateforme (ex. `linux`, `windows`, `macos`, `x64`, `arm64`) pour que la matrice
   du workflow puisse les cibler.
3. **Prérequis par plateforme** (dépendances Tauri) :
   - **Linux** : `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`,
     `librsvg2-dev`, `patchelf`, `libssl-dev`, `libgtk-3-dev`, `libfuse2`.
   - **Windows** : Visual Studio Build Tools + WebView2.
   - **macOS** : Xcode Command Line Tools.

> ⚠️ **Contrainte majeure** : le workflow actuel build sur **3 OS** (Windows, macOS,
> Linux) et **4 cibles** (dont 2 macOS). Pour reproduire cela sur GHES, il faut des
> runners auto-hébergés **pour chaque plateforme**. Si l'utilisateur ne dispose que
> d'une seule plateforme, il faudra réduire la matrice (voir §8).

---

## 6. Adaptation de l'updater et de `latest.json`

### 6.1 Endpoint updater (`tauri.conf.json`)

Le fichier `src-tauri/tauri.conf.json` contient l'endpoint updater :

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/pleveneur/pilot/releases/latest/download/latest.json"
    ]
  }
}
```

**Adaptation** : remplacer par l'URL GHES :
```json
"endpoints": [
  "https://<GHES>/<owner>/pilot/releases/latest/download/latest.json"
]
```

> **Note** : l'URL `releases/latest/download/latest.json` fonctionne sur GHES de la
> même manière que sur github.com (redirection vers le dernier asset `latest.json`).

### 6.2 `src/js/updater.js`

Le fichier contient `const REPO = "pleveneur/pilot";` et fait un `fetch` vers
`https://api.github.com/repos/${REPO}/releases?per_page=100` pour l'historique.

**Adaptation** :
- `REPO` → `<owner>/pilot`
- `https://api.github.com/repos/...` → `https://<GHES>/api/v3/repos/...`

### 6.3 `latest.json` — pas de changement de format

Le format de `latest.json` (version, notes, pub_date, platforms) est **identique**
sur GHES. Seule l'URL de téléchargement des binaires (`browser_download_url`) changera
(elle pointera vers le GHES). Le script `gen-latest-json.js` le génère déjà
correctement à partir des assets de la release.

---

## 7. Adaptation de l'onglet Feedback / issues

### 7.1 `src/js/feedback.js`

Le fichier contient :
```js
const REPO = "pleveneur/pilot";
const ISSUES_API = `https://api.github.com/repos/${REPO}/issues?state=all&per_page=50&sort=created&direction=desc`;
const NEW_ISSUE_URL = `https://github.com/${REPO}/issues/new`;
```

**Adaptation** :
- `REPO` → `<owner>/pilot`
- `ISSUES_API` → `https://<GHES>/api/v3/repos/${REPO}/issues?state=all&per_page=50&sort=created&direction=desc`
- `NEW_ISSUE_URL` → `https://<GHES>/${REPO}/issues/new`

### 7.2 ⚠️ CORS et accès anonyme (point critique)

Sur github.com, le dépôt est **public** et l'API renvoie `Access-Control-Allow-Origin: *`
→ le `fetch` depuis la WebView fonctionne sans token.

Sur GHES :
- **Dépôt public** : l'API REST de GHES supporte CORS pour les dépôts publics
  (comportement similaire à github.com). Le `fetch` devrait fonctionner.
- **Dépôt privé** : l'accès anonyme est impossible → le `fetch` échouera (401/403).
  Il faudrait soit rendre le dépôt public, soit embarquer un token (déconseillé).

> **À vérifier** : la version exacte de GHES et sa configuration CORS. Si le `fetch`
> échoue, il faudra peut-être passer par une commande Rust (backend) pour faire la
> requête avec un token, ou rendre le dépôt public.

### 7.3 Templates d'issue (`.github/ISSUE_TEMPLATE/`)

Les fichiers `bug.yml`, `feature.yml`, `remark.yml`, `config.yml` sont **portables
tels quels** sur GHES (même format YAML). Il suffit de les pousser dans le dépôt
`pilot` sur le GHES. Le `config.yml` référence un `mailto:` — inchangé.

---

## 8. Questions à l'utilisateur (informations manquantes)

Avant toute modification du code de Pilot, les informations suivantes sont
**indispensables** (ne pas deviner) :

1. **Adresse du serveur GHES** : quel hostname / IP ? (ex. `ghes.example.com`)
2. **Version de GHES** : quelle version exacte ? (ex. 3.15)
3. **Licence** : essai ou commerciale ? Combien de **seats** ?
4. **Accès réseau** : le serveur est-il accessible depuis les postes qui exécutent
   Pilot ? En interne (LAN) ou via internet ? DNS et HTTPS configurés ?
5. **Certificat TLS** : signé par une CA publique (Let's Encrypt) ou une CA interne ?
   (impacte la confiance des clients Pilot)
6. **Visibilité du dépôt `pilot` sur GHES** : public ou privé ? (impacte l'updater
   et le feedback — voir §6 et §7)
7. **Runners Actions** : quelles plateformes sont disponibles pour les runners
   auto-hébergés (Windows / macOS / Linux) ? Le workflow actuel build sur 3 OS —
   faut-il réduire la matrice ?
8. **Propriétaire du dépôt** : quel nom d'organisation/utilisateur sur GHES ?
   (ex. `pleveneur` ou une org d'entreprise)
9. **Migration du dépôt** : faut-il migrer l'historique git de `pleveneur/pilot`
   (github.com) vers le GHES, ou repartir d'un dépôt vide ?
10. **Conservation de github.com** : Pilot doit-il continuer à fonctionner avec
    github.com en parallèle, ou basculer entièrement sur le GHES ?

---

## 9. Vérifications et tests de bout en bout

Après adaptation, voici la checklist de validation :

### 9.1 Serveur GHES
- [ ] `https://<GHES>/setup` accessible (console d'admin).
- [ ] `https://<GHES>/` affiche l'interface web.
- [ ] Le dépôt `pilot` existe et est visible.
- [ ] Un PAT de test peut lire les releases et issues via l'API :
  ```bash
  curl -H "Authorization: token <PAT>" https://<GHES>/api/v3/repos/<owner>/pilot/releases
  ```

### 9.2 Workflow de release
- [ ] Un runner auto-hébergé est enregistré et visible dans les settings Actions.
- [ ] Pousser un tag `vX.Y.Z` déclenche le workflow.
- [ ] La release est créée sur le GHES avec les assets signés.
- [ ] `latest.json` est généré et uploadé sur la release.

### 9.3 Updater
- [ ] `curl https://<GHES>/<owner>/pilot/releases/latest/download/latest.json` renvoie
  un JSON valide.
- [ ] Lancer Pilot → la modale de mise à jour s'affiche si une version plus récente
  existe.
- [ ] L'historique des releases s'affiche dans la modale (fetch API OK).

### 9.4 Feedback / Issues
- [ ] Ouvrir l'onglet 💬 → la liste des issues existantes se charge.
- [ ] « Ouvrir sur GitHub » ouvre `https://<GHES>/<owner>/pilot/issues/new` pré-rempli.
- [ ] Les templates d'issue sont proposés lors de la création manuelle d'une issue.

### 9.5 Anti-régression
- [ ] `cargo test --lib` passe (protocole quality-gate).
- [ ] `npm test` (Vitest) passe.
- [ ] Les fonctionnalités non liées à GitHub (édition, orchestration, etc.) sont
  inchangées.

---

## 10. Fichiers de Pilot à modifier (récapitulatif)

> ⚠️ **Lecture seule** : ce document ne modifie aucun fichier. La liste ci-dessous
> est le périmètre des modifications à faire **après validation** de l'utilisateur.

| Fichier | Modification |
|---|---|
| `src-tauri/tauri.conf.json` | Endpoint updater → `https://<GHES>/<owner>/pilot/releases/latest/download/latest.json` |
| `src/js/updater.js` | `REPO` + URL API → GHES |
| `src/js/feedback.js` | `REPO`, `ISSUES_API`, `NEW_ISSUE_URL` → GHES |
| `scripts/create-release.js` | URLs API → `https://<GHES>/api/v3/...` |
| `scripts/gen-latest-json.js` | URLs API + uploads → `https://<GHES>/api/v3/...` et `https://<GHES>/api/uploads/...` |
| `.github/workflows/release.yml` | Runners → auto-hébergés ; repo → GHES |
| `.github/ISSUE_TEMPLATE/*` | Portables tels quels (à pousser sur le GHES) |
| `README.md`, `spec_feedback.md`, `spec_pilot.md` | Mettre à jour les URLs de documentation |

---

## 11. Points d'attention / pièges

- **Ne pas changer le hostname GHES après coup** : toutes les URLs (dépôts, tokens,
  updater) en dépendent.
- **Certificat TLS non fiable** : si la CA interne n'est pas installée sur les postes
  Pilot, l'updater et le feedback échoueront silencieusement (erreur TLS). C'est le
  piège n°1.
- **Dépôt privé + updater/feedback** : l'accès anonyme est impossible → il faut un
  dépôt public ou un token embarqué (déconseillé).
- **Runners auto-hébergés** : GHES n'a pas de runners hébergés. La matrice 3 OS du
  workflow actuel nécessite 3 plateformes de runners.
- **`GITHUB_TOKEN`** : sur GHES, il est généré automatiquement par Actions (comme sur
  github.com) — ne pas le créer manuellement.
- **Les secrets `TAURI_*`** : inchangés, réutilisables tels quels sur le GHES.
