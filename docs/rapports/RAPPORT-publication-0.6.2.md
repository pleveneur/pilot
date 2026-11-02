# Rapport de publication — Pilot v0.6.2

**Date** : 27 octobre 2026 (soir/heure locale UTC+4)
**Version publiée** : `0.6.2` (correctifs, dernier chiffre — jamais reculé : `0.6.1` → `0.6.2`)
**Accord du propriétaire** : explicite et donné avant le début des travaux (mission « Publier la version 0.6.2 »).

---

## 1. Points de repère Git

| Élément | Valeur |
|---|---|
| Branche | `main` |
| Commit du bump | **`57abb628feef7dd38827a4a9d4fd9f06c94cfed0`** — `chore: bump version to 0.6.2` |
| Étiquette | **`v0.6.2`** (étiquette **annotée**, objet `4738a80d34e3b4cb143f6f640dd36bc960655980`) |
| L'étiquette pointe sur | `57abb628feef7dd38827a4a9d4fd9f06c94cfed0` (vérifié : `git rev-parse v0.6.2^{commit}`) |
| Étiquette sur le distant | **oui** — `git ls-remote origin refs/tags/v0.6.2` → `4738a80d…` et `refs/tags/v0.6.2^{}` → `57abb62…` |
| `origin/main` | `57abb628feef7dd38827a4a9d4fd9f06c94cfed0` (identique à `HEAD`) |
| `v0.6.1` | **intacte** — toujours `c2eabd4e140d6e4d46ac9115900994c422d2988d`, ni déplacée ni supprimée |
| Arbre de travail | propre (hors fichiers `RAPPORT-*.md` et `docs/proposition-*.md` non suivis, laissés tels quels) |

Cinq fichiers seulement dans le commit de bump : `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, `Cargo.lock`, `release-notes/v0.6.2.md` (39 insertions, 4 suppressions).

### Contenu de la version (4 commits depuis `v0.6.1`)

- `8913ede` — la lecture à voix haute annonce le repli quand la voix du système a disparu ;
- `44ac90c` — le verrou anti-double-exécution ferme aussi le chemin de commande RPC ;
- `7f1a8f3` — trois textes faux corrigés (nom du moteur, position du menu, angle haut droit) ;
- `fd86524` — l'envoi automatique en fin de dictée sert aussi l'accès web distant.

### GDS : aucun changement, aucune bascule

- `git diff --stat v0.6.1..HEAD -- gds-core gds-server` → **sortie vide** (aucun fichier).
- `.pilot/gds.json` → `"enabled": false` : le projet **n'est pas basculé sur le GDS**, la
  publication GitHub est donc autorisée.
- **Image du serveur non reconstruite, conteneur non rechargé** (conformément à la consigne).

---

## 2. Version — les quatre fichiers

| Fichier | Valeur |
|---|---|
| `package.json` | `0.6.2` |
| `src-tauri/tauri.conf.json` | `0.6.2` |
| `src-tauri/Cargo.toml` | `0.6.2` |
| `Cargo.lock` (racine) — paquet `pilot` | `0.6.2` |

`Cargo.lock` : édition **ciblée** sur le paquet `pilot` (aucun `sed`, aucune ancre glissante).
Preuve : `git diff -- Cargo.lock` = **1 ligne changée, 1 ajout, 1 suppression**, dans le bloc
`name = "pilot"` (ligne 3334-3335).
`window-vibrancy` est **inchangé** : `version = "0.6.0"` (ligne 6639).

### Écart à signaler (exigence de la consigne non tenable telle qu'écrite)

La consigne demandait que `grep 'version = "0.6.2"' Cargo.lock` ne renvoie **qu'une seule**
occurrence. Il en renvoie **quatre** — mais **trois d'entre elles préexistaient au bump** et
appartiennent à des dépendances tierces légitimement en 0.6.2 :

| Ligne | Paquet | Version |
|---|---|---|
| 434 | `block2` | `0.6.2` (dépendance, déjà là avant le bump) |
| **3335** | **`pilot`** | **`0.6.2`** ← la seule modifiée |
| 3489 | `polyval` | `0.6.2` (dépendance, déjà là avant le bump) |
| 3858 | `raw-window-handle` | `0.6.2` (dépendance, déjà là avant le bump) |

Le contrôle correct (celui qui attrape l'incident v0.2.30) est « le diff ne touche qu'une
ligne, celle de `pilot` » : c'est vérifié. Aucune dépendance n'a été verrouillée sur une
version inexistante ; `cargo test --lib` compile et passe (voir §3).

---

## 3. Contrôles AVANT publication — tous verts

| Commande | Code de sortie | Résultat exact |
|---|---|---|
| `npm test` | **0** | **196 fichiers passés** (196), **3484 tests passés** (3484), **0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **0** | **792 passés, 1 ignoré** (1 suite, 10,68 s), 0 échec |

Les deux suites ont été lancées **avant** le commit du bump, une seconde fois après le bump
pour `npm test` (même résultat) ; le binaire de test est bien compilé en `pilot v0.6.2`.

`npm run build:handbook` relancé : 45 blocs, contenu **identique au fichier déjà versionné**.
Seule la date de l'en-tête généré changeait (`generated=2026-10-26` → `2026-10-27`) ;
cette ligne a été **remise à sa valeur versionnée** pour que le commit de bump ne contienne
aucun bruit. `help/handbook.md` n'apparaît donc pas dans le commit.

---

## 4. Publication réelle sur GitHub

**Workflow** `.github/workflows/release.yml`, exécution **#167**, identifiant `40459867102`,
déclenchée par le tag `v0.6.2` le 2026-10-27T06:13:57Z, terminée **`completed / success`**
le 2026-10-27T06:56:57Z.

| Job | Conclusion | Durée (UTC) |
|---|---|---|
| `create-release` | ✅ success | 06:14:01 → 06:14:08 |
| `test (windows-latest)` | ✅ success | 06:14:01 → 06:19:53 |
| `test (macos-latest)` | ✅ success | 06:14:01 → 06:17:48 |
| `test (ubuntu-22.04)` | ✅ success | 06:14:01 → 06:18:21 |
| `build (windows-latest, x86_64-pc-windows-msvc)` | ✅ success | 06:19:55 → 06:35:47 |
| `build (macos-latest, x86_64-apple-darwin)` | ✅ success | 06:19:56 → 06:28:23 |
| `build (macos-latest, aarch64-apple-darwin)` | ✅ success | 06:19:56 → 06:30:09 |
| `latest-json` | ✅ success | 06:35:50 → 06:36:01 |
| `build-linux` | ❌ **failure** | 06:19:56 → 06:56:47 |
| `latest-json-linux` | ✅ success (sans artefact à ajouter) | 06:56:50 → 06:56:57 |

### Release GitHub

| Élément | Valeur |
|---|---|
| Titre / tag | `Pilot v0.6.2` / `v0.6.2` |
| Identifiant | `425091435` |
| Publiée le | 2026-10-27T06:14:05Z |
| Brouillon / préversion | `draft: false`, `prerelease: false` |
| **Nombre d'installateurs et fichiers : 11** | **total 436 670 960 octets (416,4 Mo)** |

| Fichier | Taille | État |
|---|---|---|
| `Pilot_0.6.2_x64-setup.exe` (Windows, NSIS) | 64 707 816 o (61,7 Mo) | uploaded |
| `Pilot_0.6.2_x64-setup.exe.sig` | 416 o | uploaded |
| `Pilot_0.6.2_x64_en-US.msi` | 84 312 064 o (80,4 Mo) | uploaded |
| `Pilot_0.6.2_x64_en-US.msi.sig` | 416 o | uploaded |
| `Pilot_x64.app.tar.gz` (macOS Intel) | 39 373 410 o (37,5 Mo) | uploaded |
| `Pilot_x64.app.tar.gz.sig` | 404 o | uploaded |
| `Pilot_aarch64.app.tar.gz` (macOS Apple Silicon) | 105 837 633 o (100,9 Mo) | uploaded |
| `Pilot_aarch64.app.tar.gz.sig` | 404 o | uploaded |
| `Pilot_0.6.2_x64.dmg` (macOS Intel) | 39 053 821 o (37,2 Mo) | uploaded |
| `Pilot_0.6.2_aarch64.dmg` (macOS Apple Silicon) | 103 380 733 o (98,6 Mo) | uploaded |
| `latest.json` | 3 843 o | uploaded |

Tous les assets sont à l'état `uploaded` (aucun en échec de dépôt).

### Contenu réel de `latest.json` (téléchargé depuis la release)

```
version    : 0.6.2
pub_date   : 2026-10-27T06:35:57.998Z
platforms  : darwin-aarch64 · darwin-x86_64 · windows-x86_64   (les 3, toutes signées)
  darwin-aarch64  → Pilot_aarch64.app.tar.gz        (signature présente)
  darwin-x86_64   → Pilot_x64.app.tar.gz            (signature présente)
  windows-x86_64  → Pilot_0.6.2_x64-setup.exe       (signature présente — NSIS, pas le MSI)
notes           : 1 949 caractères = « ## Modifications depuis v0.6.1 » + le texte intégral
                  de release-notes/v0.6.2.md (vérifié : le fichier local y est contenu mot pour mot)
```

Aucune cible Linux dans `latest.json` (voir §5).

---

## 5. Écarts constatés

1. **Job `build-linux` en échec** — étape fautive : « Build and sign Tauri app »
   (`npm run tauri build -- --target x86_64-unknown-linux-gnu`, code de sortie **1**,
   après ~36 min). **Cause exacte non vérifiée** : les journaux de job de l'API GitHub
   répondent **403** sans jeton d'authentification ; seule l'annotation d'échec est lisible.
   **Conséquences** : aucun installateur Linux dans la release, aucune entrée Linux dans
   `latest.json`. **Ce job est en `continue-on-error`, aucun autre job n'en dépend** : il
   n'a ni retardé ni bloqué la publication, et les utilisateurs Windows/macOS reçoivent bien
   la mise à jour.
   **Non-régression** : `build-linux` était **déjà en échec** sur la publication `v0.6.1`
   (exécution du 2026-10-26T16:45:16Z, même job, même conclusion). C'est une condition
   **préexistante**, pas une conséquence de la 0.6.2.
2. **Contrôle `grep 'version = "0.6.2"' Cargo.lock`** : 4 occurrences au lieu d'une — trois
   sont des dépendances déjà en 0.6.2 (§2). Le contrôle réellement pertinent (une seule ligne
   modifiée, celle de `pilot`) est vert.
3. **Anomalie cosmétique de fabrication** : la date de l'en-tête de `help/handbook.md` change
   à chaque régénération (elle passe au jour courant). Elle a été remise à la valeur
   versionnée pour ne pas polluer le commit ; **aucun contenu du handbook n'a changé**.
4. **Avertissements sans effet** (à connaître) : `sqlx-postgres v0.8.0` est signalé
   « code rejeté par une future version de Rust » lors de `cargo test` ; côté CI,
   `actions/cache@v4` est forcé sur Node.js 24 (avertissement de dépréciation Node 20).
   Aucun des deux n'a fait échouer quoi que ce soit.

---

## 6. Ce que le propriétaire doit vérifier à la main

1. **La mise à jour s'installe** : ouvrir Pilot **v0.6.1** installé et attendre la proposition
   de mise à jour (ou ⚙️ → vérifier les mises à jour) → elle doit annoncer **0.6.2** et
   proposer le téléchargement. Un utilisateur Windows recevra `Pilot_0.6.2_x64-setup.exe`.
2. **La page de release** : <https://github.com/pleveneur/pilot/releases/tag/v0.6.2> —
   vérifier le titre « Pilot v0.6.2 », le texte des notes (il doit reprendre le changelog
   français), et la présence des **11 fichiers** listés au §4.
3. **Les trois vérifications de comportement visibles de cette version** :
   - lecture à voix haute avec une voix du système **désinstallée** → la ligne courte doit
     apparaître à côté du bouton « 🔊 Écouter » (et le réglage enregistré ne doit pas changer) ;
   - dictée vocale **sur l'accès web distant** depuis un navigateur → le message doit partir
     tout seul à la fin de la dictée, et **pas** si vous reprenez la main au clavier ;
   - aide intégrée : demander à l'Assistant où se trouve « Lancer l'agent » → il doit répondre
     **première ligne du menu « Autres écrans »**, et nommer l'onglet de l'agent selon le
     moteur réellement en service.
4. **Le point Linux** : décider s'il faut ouvrir une enquête sur `build-linux` (journaux
   inaccessibles sans jeton — il faut soit un jeton GitHub, soit relancer ce job seul pour
   récupérer la sortie depuis l'interface web). **Décision du propriétaire, rien n'a été
   corrigé ici.**
5. **Le tag `v0.6.1`** doit rester à `c2eabd4` (il n'a pas bougé) — à ne pas retoucher.

---

## 7. Ce qui n'a pas été fait (volontairement)

- **Aucune reconstruction de l'image du serveur GDS**, aucun rechargement de conteneur
  (aucun changement dans `gds-core` / `gds-server`).
- **Aucune correction de code** : les seules modifications sont les quatre numéros de version
  et le fichier `release-notes/v0.6.2.md`.
- **Aucun fichier `RAPPORT-*.md` non suivi n'a été committé ni supprimé** (ce rapport-ci reste
  volontairement **non suivi par git**, comme les précédents).
- Aucun outil listant les sessions d'agents n'a été appelé.
