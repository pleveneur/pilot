# Rapport — publication de Pilot v0.6.11

**Date** : 2026-11-02 (horloge du poste)
**Ordre du propriétaire** : « publier une nouvelle version quand tout est fait » —
accord explicite donné pour **cette** version avant le début des opérations.
**VERDICT : PUBLIÉ.** Étiquette poussée, release publiée, 11 fichiers d'installation
en ligne, `latest.json` en 0.6.11. Contrôles tous verts.

---

## 1. Version et commit

| Élément | Valeur |
|---|---|
| Version précédente | `0.6.10` (tag `v0.6.10`) |
| Version publiée | **`0.6.11`** (règle du projet : correctifs = dernier chiffre ; aucun retour en arrière) |
| Commit de version | **`34caa8e`** — `chore: bump version to 0.6.11` |
| Étiquette | **`v0.6.11`** (annotée, objet `c541e14`, cible `34caa8e`) |
| Branche | `main`, poussée (`origin/main` = `34caa8e` avant le tag) |
| GDS | `.pilot/gds.json` → `"enabled": false` ⇒ **pas de bascule GDS**, publication GitHub autorisée |

Bump des quatre fichiers, une seule ligne changée par fichier :

- `src-tauri/tauri.conf.json` : `0.6.10` → `0.6.11`
- `package.json` : `0.6.10` → `0.6.11`
- `src-tauri/Cargo.toml` : `0.6.10` → `0.6.11`
- `Cargo.lock` (racine) : **paquet `pilot` uniquement** (motif ancré
  `name = "pilot"` + `version`), `git diff` = **1 insertion / 1 suppression**.
  Vérification du piège v0.2.30 : les seules autres occurrences de `0.6.11` du
  fichier appartiennent à la dépendance **`tower-http`** (coïncidence de
  numéros, non touchée). Aucune autre occurrence de `0.6.10` ne subsiste dans
  les quatre fichiers.

## 2. Contenu livré (5 commits depuis `v0.6.10`)

| Commit | Contenu |
|---|---|
| `a7700cd` | Voix propre au personnage actif, repli sur la voix générale |
| `b72756a` | Cinq finitions du titre de la tâche en cours (écran Vocal) |
| `56159ab` | Aucun agent invisible, quel que soit le chemin de lancement |
| `e1f1ab8` | Au repos, ce n'est pas du travail |
| `8cfbbc0` | Préchauffage de la voix imitée au démarrage |

Changelog utilisateur : **`release-notes/v0.6.11.md`** (français, accents,
orienté utilisateur, trois catégories, 6 entrées). Il est committé avec le bump
et a été **repris comme corps de la release** (vérifié : le corps contient les
6 entrées sous « ## Modifications depuis v0.6.10 »). Les skills maison **ne sont
pas** mentionnés (chantier reporté par le propriétaire).

## 3. Contrôles — résultats exacts

| Contrôle | Commande | Résultat |
|---|---|---|
| Aide intégrée à jour | `npm run build:handbook` | ✅ 47 blocs, 325 144 octets — **aucun diff** dans `help/` (rien à committer) |
| Tests frontend | `npm test` | ✅ **284 fichiers / 5237 tests passés, 0 échec** (16,27 s) |
| Tests Rust (desktop) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ✅ **830 passés, 1 ignoré (déclaré), 0 échec** — compilation `pilot v0.6.11` OK |
| Fabrication frontend | `npm run build` | ✅ `dist/index.html` produit, 13 Mo |
| Fabrication application | `npx tauri build --no-bundle` | ✅ `target/release/pilot.exe` (44,8 Mo) + `Pilot_0.6.11_x64_en-US.msi` (79,3 Mo) + `Pilot_0.6.11_x64-setup.exe` (60,9 Mo) |

Aucun test assoupli, aucun test supprimé, aucun code de livraison modifié.

**Point d'honnêteté sur la fabrication** : la commande se termine par
`A public key has been found, but no private key` — c'est la **signature de
l'updater**, qui exige `TAURI_SIGNING_PRIVATE_KEY`. Cette clé privée n'existe
**que** dans les secrets GitHub : son absence en local est attendue et
**n'empêche pas la fabrication** (binaire + les deux installateurs ont bien été
produits sur le disque). La signature est faite par le workflow, et les trois
`.sig` figurent bien dans la release.

## 4. Release GitHub — preuve par les fichiers

`https://github.com/pleveneur/pilot/releases/tag/v0.6.11` — `draft: false`,
`prerelease: false`, **11 fichiers** :

| Fichier | Taille |
|---|---|
| `latest.json` | — |
| `Pilot_0.6.11_x64-setup.exe` + `.sig` | 61,8 Mo |
| `Pilot_0.6.11_x64_en-US.msi` + `.sig` | 80,5 Mo |
| `Pilot_0.6.11_x64.dmg` | 37,4 Mo |
| `Pilot_x64.app.tar.gz` + `.sig` | 37,7 Mo |
| `Pilot_0.6.11_aarch64.dmg` | 98,8 Mo |
| `Pilot_aarch64.app.tar.gz` + `.sig` | 101,2 Mo |

`latest.json` publié : `"version": "0.6.11"`, cibles
`windows-x86_64` → `Pilot_0.6.11_x64-setup.exe` (NSIS retenu, MSI écarté comme
prévu), `darwin-x86_64` et `darwin-aarch64` → `.app.tar.gz`. Les notes de mise à
jour sont le changelog français. Les utilisateurs installés recevront la mise à
jour au prochain démarrage.

## 5. Ce que le propriétaire doit vérifier à la main

1. **La liste des agents** : ouvrir l'Assistante au repos → elle ne doit plus
   afficher « en cours » ni pulser ; lancer un agent depuis l'Assistant, puis un
   agent sans onglet → les deux lignes doivent apparaître, et « Afficher
   l'onglet » doit ouvrir le bon.
2. **Le réglage « réduire les animations »** (Paramètres → Apparence) : les
   pastilles doivent cesser de pulser, le reste restant lisible.
3. **La voix du personnage** : avec un personnage actif (Présences), Paramètres →
   Assistant → « Lecture des réponses » doit montrer « Voix de <nom> » ; sans
   personnage actif, la ligne doit être absente.
4. **Le préchauffage** : avec la voix imitée choisie et le service VoiceStudio
   lancé, lire une réponse juste après le démarrage → plus d'attente de ~6 s.
   Service éteint → repli normal, aucun message d'erreur bloquant.
5. **La mise à jour** : depuis un poste en 0.6.10, redémarrer Pilot et vérifier
   que la modale propose 0.6.11.
6. **Job Linux** (optionnel, ne bloque rien) : il est séparé et sans dépendance ;
   son échec éventuel ne retarde pas la publication Windows/macOS.

## 6. Ce qui n'a pas été fait (volontairement)

- Aucune image ni conteneur GDS reconstruit, aucun serveur GDS touché
  (consigne de la mission, et `enabled: false`).
- Aucune opération Git destructive : pas de reset, pas de force push, pas de
  réécriture d'historique, aucun tag déplacé.
- Aucune correction de code : la mission publie, elle ne modifie pas le livré.
