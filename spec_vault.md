# Spécification — Coffre fort de mots de passe

> Onglet **🔐 Coffre** : coffre fort de mots de passe, chiffré **AES-256-GCM**,
> stocké dans `~/.pilot/vault.json` (hors du projet, centralisé). Déverrouillé
> par un **mot de passe maître** (clé dérivée via **Argon2id**, jamais stockée
> en clair). Issue #52.

<!-- HELP:vault -->
## Aide utilisateur — Coffre fort

L'onglet **🔐 Coffre** (bouton **🔐** de la barre latérale) stocke vos mots de
passe de façon **chiffrée**, dans un fichier situé **hors de vos projets**
(`~/.pilot/vault.json`). Tout est protégé par un **mot de passe maître**.

### Première utilisation
- À la première ouverture, créez un **mot de passe maître** (min. 4 caractères).
  Il n'est **jamais stocké en clair** : une clé AES-256 est dérivée via Argon2id.
- ⚠️ **Si vous l'oubliez, vos données sont irrécupérables.** Il n'existe aucun
  moyen de réinitialiser le coffre sans perdre son contenu.

### Déverrouiller / verrouiller
- À chaque ouverture de l'onglet, le coffre est **verrouillé** : saisissez le
  mot de passe maître pour y accéder.
- Le bouton **Verrouiller** efface la clé en mémoire (le coffre se reverrouille).
- Le bouton **Mot de passe maître** permet de le changer (les entrées sont
  ré-chiffrées avec la nouvelle clé).

### Gérer les entrées
- Chaque entrée = **description** (ex: « Serveur OVH ») + **login** + **mot de passe**.
- **Portée** : choisissez à la création/édition si l'entrée est **🌐 globale**
  (visible dans tous les projets) ou **📁 spécifique au projet actif**.
- **Copier** : boutons de copie pour le **login** et pour le **mot de passe**
  (copie dans le presse-papiers).
- **Masqué par défaut** : les mots de passe sont affichés en `••••••••` ; le
  bouton **œil** les révèle temporairement.
- **Modifier / Supprimer** : boutons d'édition et de suppression sur chaque
  entrée, depuis la vue globale.
<!-- /HELP:vault -->

---

## Architecture

| Couche | Rôle |
|---|---|
| **Backend** `src-tauri/src/vault.rs` | Chiffrement AES-256-GCM + KDF Argon2id, fichier `~/.pilot/vault.json`, commandes Tauri (status/unlock/lock/set_master_password/list/add/update/delete). Clé dérivée conservée en mémoire dans `AppState.vault_key`. |
| **Frontend** `src/js/vault.js` | `createVault(container)` : états (init / verrouillé / déverrouillé), liste des entrées, copie, œil, édition, suppression, changement de mot de passe maître. |
| **Onglet** `src/js/tabs.js` | Mode `vault` (`_openVault`), bouton 🔐 dans `index.html` + câblage `main.js`. |
| **CSS** `src/css/style.css` | Classes `.vault-*` (panneaux, lignes, boutons d'icônes). |

## Modèle de sécurité

- **Stockage** : `~/.pilot/vault.json` contient uniquement `{ version, salt,
  nonce, ciphertext }` (base64). Le clair (tableau d'entrées JSON) n'est jamais
  écrit sur disque.
- **Dérivation de clé** : Argon2id (sel aléatoire de 16 octets) → clé AES-256
  (32 octets). Le mot de passe maître n'est ni stocké ni hashé de façon
  réversible.
- **Chiffrement** : AES-256-GCM, nonce aléatoire de 12 octets par écriture.
  L'échec d'authentification GCM signale un mot de passe incorrect.
- **Clé en mémoire** : `AppState.vault_key` (`Mutex<Option<Vec<u8>>>`), `None`
  quand le coffre est verrouillé. Jamais persistée.
- **Portée** : `scope` = `"global"` (tous les projets) ou `"project"` (avec
  `project_path`). Le frontend filtre par projet actif (`window._pilotProjectPath`).

## Commandes Tauri

| Commande | Rôle |
|---|---|
| `vault_status` | Coffre initialisé ? déverrouillé ? |
| `vault_unlock(master_password)` | Déverrouille, renvoie les entrées |
| `vault_lock` | Verrouille (efface la clé) |
| `vault_set_master_password(master_password)` | Initialise ou change le mot de passe maître |
| `vault_list` | Liste les entrées (déverrouillé requis) |
| `vault_add(entry)` | Ajoute une entrée |
| `vault_update(entry)` | Met à jour une entrée |
| `vault_delete(id)` | Supprime une entrée |

## Règles

- **Hors projet** : le fichier vit dans `~/.pilot/`, jamais dans le répertoire
  du projet (pas de fuite dans Git).
- **Mot de passe maître jamais en clair** : ni sur disque, ni dans les logs.
- **Masquage par défaut** : le frontend affiche `••••••••` ; révélation
  uniquement via le bouton « œil ».
- **Copie** : via `navigator.clipboard.writeText` (pattern existant du projet).
- **Robustesse** : mot de passe maître min. 4 caractères ; erreurs claires
  (mot de passe incorrect, coffre verrouillé, coffre non initialisé).
