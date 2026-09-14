# Préparer un serveur Linux distant pour le GDS de Pilot

> Document technique d'exploitation — décrit la préparation **manuelle** d'un
> serveur Linux (VPS, machine du réseau local, VM) pour l'utiliser comme serveur
> **GDS** (Gestionnaire de Sources) depuis Pilot.
>
> **Statut : 🟢 Implémenté** — Pilot sait consommer un serveur distant
> (PostgreSQL + git via SSH) sans rien administrer à distance.
> Voir aussi `spec_gds.md` (spécification fonctionnelle).

---

## 0. Principe : ce que Pilot fait, ce qu'il ne fait pas

| Opération | Local (`localhost`, `127.0.0.1`, nom de la machine) | Distant (`gds.exemple.com`, IP non-loopback) |
|---|---|---|
| Test de connexion PostgreSQL | ✅ automatique | ✅ automatique |
| Création base + tables + compte admin | ✅ automatique (`gds_provision`) | ✅ automatique (`gds_provision`) |
| Utilisateur système `git` + dossier de repos | ✅ automatique (droits admin requis) | ❌ **manuel** (ce document) |
| Écriture de `~git/.ssh/authorized_keys` | ✅ automatique | ❌ **manuel** (§3) |
| Création du dépôt bare du projet | ✅ automatique | ❌ **manuel** (§7) |
| Ajout du remote `gds` + push initial | ✅ automatique | ✅ automatique (si le bare existe) |
| Serveur SSH | ✅ piloté localement | ❌ **jamais administré à distance** |

> **Sécurité** : Pilot n'exécute **aucune** commande d'administration sur une
> machine distante. Toute la partie serveur (§2 à §7) est faite par un
> administrateur, en SSH. Pilot ne stocke et n'affiche **jamais** de mot de passe
> dans le projet : les secrets vivent dans `~/.pilot/gds_secrets.json` (0600).

---

## 1. Prérequis

- Un serveur Linux avec un accès `sudo` (Debian/Ubuntu, RHEL-like, etc.).
- **PostgreSQL** ≥ 14 joignable depuis le poste de travail (port par défaut 5432).
- **OpenSSH Server** joignable depuis le poste (port 22, ou un port dédié).
- **git** installé (`sudo apt-get install -y git`).
- Les ports ouverts côté pare-feu réseau/serveur.

---

## 2. Utilisateur système `git` et racine des dépôts

Un compte système dédié reçoit les dépôts **bare** de tous les projets. C'est ce
dossier que Pilot appelle **« Racine des dépôts serveur »**.

```bash
# Compte système sans mot de passe, shell bash (nécessaire pour git --receive-pack).
sudo adduser --system --shell /bin/bash --group --home /home/git git

# Racine des dépôts (valeur à recopier dans Pilot, cf. §6).
sudo mkdir -p /home/git/repos
sudo chown git:git /home/git/repos
sudo chmod 755 /home/git
```

Sur un système RHEL-like, l'équivalent est :

```bash
sudo useradd --system --create-home --home-dir /home/git --shell /bin/bash git
```

> **Pourquoi `/home/git/repos` et non `/home/git` directement ?** Une racine
> dédiée (`/home/git/repos`, `/srv/git`, …) évite de mélanger dépôts et fichiers
> de service. La valeur choisie doit être **absolue** : Pilot la préfixe à
> l'URL SSH du dépôt (`ssh://git@hôte:2222/home/git/repos/projet.git`).

---

## 3. Autoriser le poste de travail (clef publique)

Pilot génère une paire **ed25519** dans `~/.ssh/` du poste (idempotent : une
clef existante n'est jamais écrasée).

1. Dans Pilot : onglet **🌐 GDS → bloc « Avancé » → Clefs SSH** → bouton
   **« Générer / afficher la clef du poste »**.
2. Copiez la ligne complète commençant par `ssh-ed25519 AAAA…`.
3. Sur le serveur, ajoutez cette clef au compte `git` :

```bash
sudo mkdir -p /home/git/.ssh
sudo chmod 700 /home/git/.ssh
echo 'ssh-ed25519 AAAA…votre_clef… pilot@poste' | sudo tee -a /home/git/.ssh/authorized_keys
sudo chown -R git:git /home/git/.ssh
sudo chmod 600 /home/git/.ssh/authorized_keys
```

4. Testez **depuis le poste** (adaptez le port) :

```bash
ssh -p 22 git@serveur.exemple.com
# → doit ouvrir un shell (ou être accepté sans mot de passe)
```

> Sur un poste Windows, la clef du poste est le plus souvent
> `C:\Users\<vous>\.ssh\id_ed25519.pub`.

---

## 4. Serveur SSH

Vérifiez la configuration dans `/etc/ssh/sshd_config` :

```
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
```

Pour un **port SSH personnalisé** (ex. 2222) :

```
Port 2222
```

```bash
sudo systemctl restart ssh     # ou: sudo systemctl restart sshd
```

Ouvrez le port dans le pare-feu (`ufw allow 2222/tcp`, `firewall-cmd`, groupe de
sécurité cloud…). Renseignez ce port dans Pilot (**Port SSH du serveur**).

---

## 5. PostgreSQL

```bash
sudo apt-get install -y postgresql
sudo systemctl enable --now postgresql
```

Créez l'utilisateur **dédié** que Pilot utilisera (Pilot crée lui-même la base
`pilot_gds` et ses tables) :

```sql
CREATE ROLE pilot LOGIN PASSWORD '<mot_de_passe_dedie>';
ALTER ROLE pilot CREATEDB;   -- requis : Pilot crée la base pilot_gds
```

Puis autorisez les connexions **distantes** :

- `postgresql.conf` : `listen_addresses = '*'`
- `pg_hba.conf` : ajoutez la ligne (IP du poste) :

```
host    all    pilot    <IP_DU_POSTE>/32    scram-sha-256
```

```bash
sudo systemctl restart postgresql
```

Test depuis le poste (ou via `psql -h serveur -U pilot -d postgres`) : la
connexion doit réussir avec le mot de passe dédié.

> Le **mot de passe admin** demandé par Pilot n'est pas un mot de passe
> superutilisateur PostgreSQL : c'est le mot de passe du **premier compte GDS
> (admin)**, créé dans les tables de suivi. Pilot ne l'affiche jamais.

---

## 6. Configurer le projet dans Pilot

Onglet **🌐 GDS**, bloc **Identité** puis étape **« Connecter un serveur GDS »** :

| Champ Pilot | Valeur pour ce serveur | Exemple |
|---|---|---|
| Identité — email | votre email (identifiant de compte GDS) | `dev@exemple.com` |
| Identité — nom git | nom affiché dans les commits | `Prénom Nom` |
| Hôte PostgreSQL | hôte du serveur | `serveur.exemple.com` |
| Port | port PostgreSQL | `5432` |
| Utilisateur dédié | rôle Postgres dédié | `pilot` |
| Mot de passe dédié | mot de passe du rôle | *(jamais affiché)* |
| Mot de passe admin | mot de passe du compte GDS admin | *(jamais affiché)* |
| **Port SSH du serveur** | port SSH (22 par défaut) | `22` ou `2222` |
| **Racine des dépôts serveur** | racine des dépôts bare | `/home/git/repos` |
| **Dossier local de clonage** | où cloner côté poste (optionnel) | *(défaut)* |

1. **« Enregistrer la configuration »** — écrit `.pilot/gds.json` (aucun mot de
   passe : ils partent dans `~/.pilot/gds_secrets.json`, 0600).
2. **« Activer GDS »** — crée la base `pilot_gds`, les tables et le compte admin,
   puis active le GDS pour ce projet.

> **Mot de passe manquant plus tard** (secrets perdus, machine changée) :
> ressaisissez uniquement le mot de passe puis **« Enregistrer les mots de
> passe »** — **aucune** nouvelle activation n'est nécessaire, la base n'est pas
> recréée.

---

## 7. Créer le dépôt bare du projet

Le nom du dépôt est le **nom du dossier du projet** (ex. projet
`G:\IA_PL\pilot` → dépôt `pilot.git`). Sur le serveur :

```bash
sudo -u git git init --bare /home/git/repos/mon-projet.git
sudo -u git git -C /home/git/repos/mon-projet.git symbolic-ref HEAD refs/heads/main
```

Puis, dans Pilot : bouton **« Ajouter ce projet au GDS »**.

Pilot ajoute alors le remote `gds` (sans toucher à un éventuel `origin`) et
pousse la branche courante. Si le dépôt bare n'existe pas, Pilot ne peut rien
créer à distance : le push échoue avec un message renvoyant à ce document.

> **Plusieurs postes / plusieurs développeurs** : répétez le §3 pour chaque
> poste. Le dépôt bare est partagé, les clefs publiques s'ajoutent les unes après
> les autres dans `authorized_keys`.

---

## 8. Dépannage

| Symptôme | Cause probable | Correction |
|---|---|---|
| `Permission denied (publickey)` | clef du poste absente de `authorized_keys`, mauvais port, droits `~git/.ssh` | refaire §3 ; vérifier `chmod 700/600` et le port |
| `Could not read from remote repository` au push | dépôt bare absent sur le serveur | appliquer §7 avant d'ajouter le projet |
| `password authentication failed for user "pilot"` | mot de passe faux ou `pg_hba.conf` absent | ressaisir via **« Enregistrer les mots de passe »** ; vérifier §5 |
| `database "pilot_gds" does not exist` | provision non effectuée, ou rôle sans `CREATEDB` | cliquer **« Activer GDS »** ; `ALTER ROLE pilot CREATEDB;` |
| `connection refused` sur PostgreSQL | `listen_addresses` / pare-feu | §5 |
| Port SSH ignoré / erreur git étrange (Windows) | variante SSH git indéfinie | définir `GIT_SSH_VARIANT=ssh` dans l'environnement |
| `Racine des dépôts serveur non renseignée` | champ vide pour un serveur distant | renseigner la racine (§6) puis réessayer |
| Badge Pilot « ● En attente » | serveur injoignable ou bare absent | vérifier connexion Postgres + §7 |

---

## 9. Protocole de test de bout en bout

À exécuter après chaque préparation de serveur (local ou distant).

| # | Action | Attendu | Validation |
|---|---|---|---|
| 1 | Onglet GDS, saisir l'identité (email + nom git), « Enregistrer » | identité mémorisée, pré-remplie | badge/identity persistés après rechargement |
| 2 | Renseigner hôte/port/user/mots de passe + Port SSH + Racine des dépôts, « Enregistrer la configuration » | message ✅, aucun mot de passe visible | `.pilot/gds.json` ne contient **aucun** mot de passe |
| 3 | « Activer GDS » | base `pilot_gds` + tables + admin créés | badge **● Connecté** ; `psql -d pilot_gds -c '\dt'` liste les tables |
| 4 | Cliquer « Enregistrer les mots de passe » sans rien saisir | erreur explicite, aucune écriture | message « saisissez au moins un mot de passe » |
| 5 | Serveur distant non préparé : « Ajouter ce projet au GDS » | erreur claire renvoyant à ce document | aucun dossier créé sur le poste |
| 6 | Créer le bare (§7) puis « Ajouter ce projet au GDS » | remote `gds` ajouté + push réussi | `git remote -v` montre `gds` ; `git log` du bare contient le commit |
| 7 | Vérifier `origin` | intact | `git remote -v` montre toujours l'`origin` d'origine |
| 8 | « Synchroniser » (Phase B) | fetch/pull depuis `gds` | badge toujours **● Connecté**, aucune erreur |
| 9 | Verrou : acquérir / relâcher | état de verrou cohérent | `GET /api/gds/locks` (ou bloc avancé) reflète le titulaire |
| 10 | Serveur **local** : refaire 2→6 | comportement **strictement identique** à avant (bare créé par Pilot) | `cargo test --lib` + `npm test` verts ; bare sous `<dossier local>/repos/<projet>.git` |
| 11 | Ancien `.pilot/gds.json` (sans `ssh_port`/`gds_server_repos`) | chargé sans erreur, port SSH 22 | `gds_get_config` renvoie `ssh_port: 22` |
| 12 | Changer un champ de config puis « Enregistrer la configuration » | champs non touchés préservés | comparer avant/après `gds_get_config` |
