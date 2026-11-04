# Rapport — publication v0.6.18 : tentative complète, aucune release (machine macOS jamais attribuée)

**Date** : 2026-11-04 · **Rôle** : publieur · **Projet** : `G:\IA_PL\pilot`

> *Nom du livrable* : la mission demandait `docs/rapports/RAPPORT-publication-v0.6.17.md`.
> Ce numéro avait déjà été consommé et documenté par la tentative précédente
> (`docs/rapports/RAPPORT-publication-version-unique.md`). Ce rapport porte donc le
> numéro réellement tenté : **0.6.18**.

---

## 1. Verdict en une ligne

**Aucune release n'a été créée.** Le commit de bump et l'étiquette `v0.6.18` sont
sur GitHub, **tous les contrôles locaux sont verts**, mais la chaîne d'édition a
échoué **une troisième fois de suite** pour la même cause **extérieure au code** :
le job de test `macos-latest` est **annulé sans avoir jamais reçu de machine**
(15 minutes d'attente, `runner_name` vide), ce qui annule en cascade
`create-release` puis `build` (Windows **et** macOS). Je n'ajoute pas de
quatrième numéro : la cause est structurelle, et la décision appartient au
propriétaire.

---

## 2. État trouvé au départ

| Point | Constat (preuve) |
|---|---|
| Branche | `main`, **dépôt propre** (`git status --short` vide) |
| `origin/main` | `4b287a5` (2 commits de documentation en avance locale seulement) |
| Dernière étiquette | `v0.6.17` → `063a53b` (poussée) |
| Étiquettes antérieures | `v0.6.16` → `cd1a860`, `v0.6.15` → `051929b` (les deux poussées, aucune republiable) |
| **Release la plus récente** | `v0.6.15` publiée le **2026-11-04T10:27:44Z**, **11 fichiers**, `latest.json` présent |
| Releases `v0.6.16` / `v0.6.17` | **AUCUNE** — `GET /releases/tags/…` → **HTTP 404** |
| GDS | `.pilot/gds.json` → `"enabled": false` ⇒ **publication GitHub autorisée** par ma règle absolue |
| Aucune release au-dessus | vérifié : aucun `v0.6.18` local ni sur `origin` avant bump |

Le contenu du tag `v0.6.17` est intact : **aucun fichier de code** n'a été touché
après lui (uniquement des rapports). Le code à livrer était donc bien celui de
`v0.6.17` / `v0.6.16`.

---

## 3. Version retenue

- **0.6.18** : `v0.6.15` est publiée, `v0.6.16` et `v0.6.17` sont taguées et
  poussées (jamais republiables) ⇒ la règle du projet (correctifs ⇒ dernier
  chiffre, jamais reculer) impose la suivante.
- Bump appliqué aux **quatre** fichiers, **même valeur partout** :
  `package.json` (l. 4), `src-tauri/Cargo.toml` (l. 3), `src-tauri/tauri.conf.json`
  (l. 4), `Cargo.lock` (l. 3335).
- **`Cargo.lock`** : édition **ciblée** sur le paquet racine (`name = "pilot"`,
  l. 3334-3335) — **aucun remplacement global**. Vérifications après coup :
  `version = "0.6.18"` apparaît **une seule fois** dans le fichier (l. 3335, sous
  `name = "pilot"`), et **`0.6.17` n'y apparaît plus du tout**.

---

## 4. Notes de version

Fichier écrit : **`release-notes/v0.6.18.md`** (français, accentué, orienté
utilisateur, aucun nom de fichier, aucune fonction, aucun jargon interne),
rédigé à partir des sept rapports du lot :

| # | Sujet | Rapport source |
|---|---|---|
| 1 | Volet « Tâches » fidèle au suivi réel | `RAPPORT-liste-taches-affichee.md` |
| 2 | Micro du mode Vocal qui ne s'arrête plus seul | `RAPPORT-micro-arret-mode-vocal.md` |
| 3 | Halo qui suit la voix jusqu'au bout d'une longue parole | `RAPPORT-halo-parole-longue.md` |
| 4 | Conversation qui retrouve sa place au retour du plein écran | `RAPPORT-retour-mode-conversation-en-bas.md` |
| 5 | Mots de réveil paramétrables (champ vide = nom seul) | `RAPPORT-mots-de-reveil.md` |
| 6 | Genre de l'Assistant | `RAPPORT-genre-et-modele-par-personnage.md` |
| 7 | Agents jetables par défaut | `RAPPORT-agents-jetables-par-defaut.md` |

Structure : 3 nouveautés, 3 corrections, 2 améliorations, une section
« ce que vous devez savoir » rappelant que **rien ne s'active de soi-même**, et
une phrase d'entrée disant que tout le contenu des deux versions non livrées
arrive d'un coup à qui est en 0.6.15.

---

## 5. Contrôles AVANT publication — chiffres réels

| Contrôle | Commande | Résultat exact |
|---|---|---|
| Tests front (état de départ) | `npm test` | **300 fichiers, 5 594 tests passés, 0 échec** (17,71 s) |
| Tests Rust (état de départ) | `cargo test --workspace` | **1 075 passés, 14 ignorés, 0 échec** (139 + 34 + 902) |
| Tests front (après bump 0.6.18) | `npm test` | **300 fichiers, 5 594 tests passés, 0 échec** |
| Tests Rust (après bump 0.6.18) | `cargo test --workspace` | **1 075 passés, 14 ignorés, 0 échec** |
| Front reconstruit | `npm run build` | **succès**, `✓ built in 12,13 s` |
| Fabrication de l'application | `npm run tauri build` | **succès** : `Built application at: target\release\pilot.exe`, `Finished 2 bundles` |

Installateurs réellement écrits sur ce poste :

| Fichier | Taille |
|---|---|
| `target\release\bundle\msi\Pilot_0.6.18_x64_en-US.msi` | 84,5 Mo |
| `target\release\bundle\nsis\Pilot_0.6.18_x64-setup.exe` | 64,7 Mo |

**Unique anomalie de la fabrication locale** (déjà connue, sans rapport avec
l'échec) : `Error A public key has been found, but no private key` — la clé
privée de signature de mise à jour **n'existe pas sur ce poste** ; elle est
détenue par le propriétaire et fournie au workflow par les secrets GitHub. Le
binaire et les deux installateurs sont bien produits.

Aucun test n'a été modifié, assoupli ni contourné. Aucun `ALLOW_*` n'a été employé.

---

## 6. Ce qui a été poussé (preuves)

| Élément | Valeur |
|---|---|
| Commit de bump | **`4c9e8d1`** « chore: bump version to 0.6.18 » (5 fichiers, +76 / −4) |
| `main` sur GitHub | `4c9e8d18d67a7d405bebdfa9841b7fad2ea6a2cf` |
| Étiquette `v0.6.18` | → `4c9e8d18d67a7d405bebdfa9841b7fad2ea6a2cf` (poussée) |
| Avance locale restante | 0 |
| **Release `v0.6.18`** | **AUCUNE** — `GET /releases/tags/v0.6.18` → **HTTP 404** |
| Release servant les mises à jour | toujours **`v0.6.15`** (`/releases/latest`, 11 fichiers) |

---

## 7. Le point bloquant exact

Run **41874732425**, événement `push` sur `v0.6.18`, créé `2026-11-04T17:09:11Z`,
conclusion **`failure`** à `17:41:45Z`.

| Job | Résultat | Runner attribué | Horodatage |
|---|---|---|---|
| `test (windows-latest)` | **success** | `GitHub Actions 1000001550` | 17:09:14 → 17:16:16 |
| `test (ubuntu-22.04)` | **success** | `GitHub Actions 1000001549` | 17:09:14 → 17:14:18 |
| `test (macos-latest)` | **cancelled** | **aucun (`runner_name` vide)** | 17:09:11 → **17:24:13** |
| `create-release` | **skipped** (`needs: [test]` non satisfait) | — | 17:24:14 |
| `build` (Windows + 2 macOS) | **skipped** | — | 17:24:14 |
| `build-linux` | **skipped** | — | 17:24:14 |
| `latest-json` | échec (aucune release, aucun artefact à indexer) | — | démarré 17:24:17 |
| `latest-json-linux` | idem | — | démarré 17:24:33 |

**La cause est unique et extérieure au code** : le job `test (macos-latest)` a
attendu une machine pendant **exactement 15 min 02 s**, puis a été **annulé**
sans avoir exécuté **une seule étape** (`runner_name` vide, `started_at` égal à
l'heure de création du job). La tolérance posée dans le workflow
(`continue-on-error: ${{ matrix.os == 'macos-latest' }}`) couvre un **échec**,
pas une **annulation** : le job agrégé `test` tombe donc en échec, et avec lui
`create-release` puis `build`. Sans `build`, il n'y a **ni installateur, ni
`latest.json`** ; sans `create-release`, il n'y a **pas de release du tout**.

**Répétition mesurée (ce n'est pas de la malchance)** — trois runs consécutifs,
trois annulations au même minuteur :

| Version | Run | Annulation du job macOS | Runner |
|---|---|---|---|
| 0.6.16 | 41857186819 | 15:23:15 → 15:38:17 (**15 min 02 s**) | aucun |
| 0.6.17 | (run de `063a53b`) | annulé, aucun runner | aucun |
| 0.6.18 | 41874732425 | 17:09:11 → 17:24:13 (**15 min 02 s**) | aucun |

Un plafond d'attribution de machine de 15 minutes, identique à la seconde près
sur les trois runs, **ne se corrige pas en réessayant** : chaque tentative
supplémentaire ne produit qu'une nouvelle étiquette orpheline de plus.

---

## 8. Décisions que je n'ai pas prises (et pourquoi)

1. **Pas de quatrième numéro.** La consigne de relance unique est consommée :
   `0.6.17` a servi à la relance demandée, `0.6.18` est la relance de cette
   relance, et les trois échecs sont identiques. Relancer encore serait un
   contournement à l'aveugle, pas une correction.
2. **Aucun assouplissement du workflow.** Rendre la tolérance macOS insensible
   à l'**annulation** (et pas seulement à l'échec) réglerait le symptôme, mais
   c'est une **règle de publication** : elle appartient au propriétaire, pas au
   publieur. Je ne l'ai pas touchée — `.github/workflows/release.yml` est
   inchangé.
3. **Aucun `ALLOW_INCOMPLETE_RELEASE=1`, aucun `ALLOW_*`.** Livrer une release
   sans les deux paquets macOS par une sortie de secours serait exactement le
   « contournement silencieux » interdit.
4. **Aucun git destructif** : pas de `reset`, pas de `revert`, pas de
   force-push, **aucune suppression d'étiquette**. `v0.6.16`, `v0.6.17` et
   `v0.6.18` restent en place, sans release.
5. **Rien de touché dans `G:\IA_PL\Presences`**, ni aucune tâche du suivi, ni
   aucune règle de travail.

---

## 9. Ce que le propriétaire doit faire à la main

Par ordre de propreté — **sa décision**, je n'en prends aucune :

1. **Débloquer les machines macOS** (le plus direct) : vérifier le quota / le
   budget macOS des runners hébergés du compte (Settings → Billing → Actions),
   puis **relancer les jobs du run 41874732425**
   (https://github.com/pleveneur/pilot/actions/runs/41874732425 → « Re-run all
   jobs »). Le workflow n'a **pas** de déclencheur manuel : cette relance depuis
   l'interface est la seule voie **non destructive**, elle ne crée ni commit ni
   étiquette. Avec une machine macOS, `create-release`, `build` et
   `latest-json` se dérouleront normalement pour **0.6.18** — la version est
   déjà taguée et poussée, rien d'autre n'est à faire.
2. **Ou trancher la règle** : accepter qu'une **annulation** du job macOS soit
   tolérée comme un échec (`continue-on-error` ne couvre pas l'annulation) —
   c'est une modification de garde-fou, donc sa décision, pas la mienne.
3. **Ou autoriser explicitement une livraison sans macOS** (Windows seulement),
   auquel cas `ALLOW_INCOMPLETE_RELEASE=1` devient légitime — mais seulement
   sur son accord écrit, et en le disant aux utilisateurs.

### À vérifier à la main **quand** une release existera

1. La page des releases affiche **Pilot v0.6.18** avec le texte des notes
   (accents corrects).
2. Les fichiers attendus sont présents : `Pilot_0.6.18_x64-setup.exe` (+ `.sig`),
   `Pilot_0.6.18_x64_en-US.msi` (+ `.sig`), les deux `.app.tar.gz` macOS avec
   leur `.sig`, et **`latest.json`**.
3. Dans `latest.json`, la cible `windows-x86_64` pointe sur l'artefact **NSIS**
   (le MSI est volontairement écarté) et les deux cibles macOS y figurent.
4. Un poste déjà installé détecte la mise à jour au démarrage suivant et
   l'installe sans erreur de signature.
5. Dans l'application mise à jour, les changements visibles : volet « Tâches »
   fidèle au suivi, micro qui reste ouvert, halo sur toute la parole,
   conversation à sa place au retour du mode Vocal, et les trois réglages
   (mots de réveil, genre, modèle par personnage) **tous inactifs par défaut**.

---

## 10. Reçu des contrôles (à conserver)

```
npm test                      → Test Files 300 passed (300) ; Tests 5594 passed (5594)
cargo test --workspace        → 139 + 34 + 902 = 1075 passed ; 14 ignored ; 0 failed
npm run build                 → ✓ built in 12,13 s
npm run tauri build           → Finished `release` profile in 2m 11s
                                Built application at: target\release\pilot.exe
                                Finished 2 bundles (msi 84,5 Mo / nsis 64,7 Mo)
                                Erreur finale : clé privée d'updater absente du poste (attendu)
API GitHub                    → /releases/tags/v0.6.18 = 404 ; /releases/latest = v0.6.15
```
