# Rapport — préparation de la version 0.6.5

Date : 2026-10-30 · Projet : `G:\IA_PL\pilot` · Portée : **local uniquement**
(aucun push, aucune étiquette, aucune release, aucune image de serveur).

Objectif demandé : préparer la publication de la 0.6.5 après la fin du chantier
« écran Vocal ». La publication elle-même est une mission séparée.

---

## 1. Version

| | Avant | Après |
|---|---|---|
| Version produit | **0.6.4** | **0.6.5** |
| HEAD de départ | `d8ef8fe` | `d8ef8fe` + commit de préparation |

## 2. Fichiers de version touchés

| Fichier | Ligne | Changement |
|---|---|---|
| `package.json` | 4 | `"version": "0.6.4"` → `"0.6.5"` |
| `src-tauri/tauri.conf.json` | 4 | `"version": "0.6.4"` → `"0.6.5"` |
| `src-tauri/Cargo.toml` | 3 | `version = "0.6.4"` → `version = "0.6.5"` (paquet `pilot`) |
| `Cargo.lock` | 3335 | **régénéré par cargo** (`cargo metadata --offline`), une seule ligne : le bloc `[[package]] name = "pilot"` |

- `src-tauri/vendor/wry/Cargo.toml` **non touché** : dépendance recopiée, sa
  version ne nous appartient pas.
- Aucune autre occurrence de `0.6.4` ne subsiste dans les fichiers de version du
  produit. Les `0.6.4` restants du `Cargo.lock` sont des **dépendances tierces**
  (`objc2` 0.6.4, `rand_core` 0.6.4) — elles doivent rester telles quelles.
- Bump fait par édition ciblée (aucun `sed` global), conformément à la
  précaution de `AGENTS.md` (incident v0.2.30).

## 3. Notes de version

`release-notes/v0.6.5.md`, en français, orienté propriétaire non technique, même
forme et même ton que `release-notes/v0.6.3.md` (intro en trois phrases puis
`🐛 Corrections`, `✨ Nouvelles fonctionnalités`, `⚡ Améliorations`).

Contenu, appuyé uniquement sur `git log v0.6.4..HEAD` et sur les rapports des
lots :

| Point annoncé | Source réelle |
|---|---|
| L'écran Vocal ne bloque plus Pilot (plus aucun clic en 0.6.4) | `e1b3005`, `docs/rapports/RAPPORT-ecran-vocal-clics-avales.md` |
| Le portrait du personnage actif s'affiche enfin (onglet, « Assistant seul », Vocal) | `4e6e5f8`, `docs/conceptions/RAPPORT-diagnostic-portrait-onglet-assistant.md` |
| Le nom du personnage s'applique partout, sans redémarrage | `10993f0`, `docs/rapports/RAPPORT-nom-du-personnage-partout.md` |
| Une demande pendant un travail : accusé immédiat puis envoi à la fin réelle du tour | `2cf9aa5`, `RAPPORT-MODE-VOCAL.md` |
| Questions de Pilot affichées et utilisables dans l'écran Vocal | `87164d1`, `8907f3a`, `docs/rapports/RAPPORT-questions-invisibles-ecran-vocal.md`, `RAPPORT-question-utilisable-ecran-vocal.md` |
| L'écoute repart toute seule après chaque réponse | `d11b692`, `src/js/vocal-conversation.js` (`vocalResumeRetry`) |
| Un seul bouton pour ne garder que le portrait | `a086c7e`, `docs/rapports/RAPPORT-bouton-tout-masquer.md` |
| Tâches en haut de la colonne de droite, portrait en bas | `0e4b845`, `docs/conceptions/RAPPORT-implémentation-vocal-taches-en-haut-portrait-en-bas.md`, `dc74a94` |
| Colonne de gauche : aperçu de la discussion | `d8ef8fe`, `docs/rapports/RAPPORT-vocal-colonne-de-gauche.md` |
| Telegram : conversation seule, message traité comme une demande de l'écran Vocal, détail toujours honoré | `17b2618`, `6d74cc8`, `3d6e67b`, `docs/rapports/RAPPORT-telegram-discussion-comme-vocal.md` |
| La suite de tests revient à zéro échec (syntaxe de `super-agent.js`) | `b4f33fa`, `docs/rapports/RAPPORT-suite-tests-zero-echec-20261029.md` — **non annoncé comme nouveauté** : le défaut n'a jamais été publié, il n'intéresse pas l'utilisateur |

Aucun chiffre inventé, aucune promesse hors dépôt : chaque ligne du changelog
renvoie à un commit présent dans `v0.6.4..HEAD`.

## 4. Tests et build

| Vérification | Base annoncée | Mesure du jour | Verdict |
|---|---|---|---|
| `npx vitest run` (front complet) | 4710 / 0 | **PASS 4710 / FAIL 0** | ✅ |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | — | **813 passés / 0 échec / 1 ignoré** | ✅ |
| `cargo test -p gds-core --lib` | — | **139 passés / 0 échec / 11 ignorés** | ✅ |
| `cargo test -p gds-server` | — | **34 passés / 0 échec** | ✅ |
| **Total Rust (espace de travail)** | 986 / 0 | **986 passés / 0 échec** (813 + 139 + 34, 12 ignorés) | ✅ |
| `npm run build` | doit passer | **`✓ built in 14.88s`**, exit 0 (avertissements `chunk > 500 kB` déjà présents) | ✅ |

Le **total** est comparé, pas seulement le compteur d'échecs : 4710 tests front
réellement exécutés (un fichier non parsable aurait fait tomber le total) et
986 tests Rust. Aucun test existant n'a été modifié, assoupli, supprimé ni
désactivé.

## 5. Ce qui reste à faire (mission suivante, séparée)

1. Pousser `main` : `git push origin main` (le dépôt local est en avance sur
   `origin/main`).
2. Créer et pousser l'étiquette : `git tag v0.6.5 && git push origin v0.6.5`.
3. Le workflow `.github/workflows/release.yml` construit Windows + macOS,
   signe les artefacts et génère `latest.json` (Linux en passe séparée,
   optionnelle).
4. Reconstruire l'image du serveur GDS si la publication le justifie :
   `npm run gds:image` (reconstruction seule ; le rechargement du conteneur du
   propriétaire est **sa** décision, `npm run gds:reload`).
5. Vérifier que le secret `TAURI_SIGNING_PRIVATE_KEY` est en place (sinon le
   build échoue à la signature).

## 6. Confirmation explicite

**Rien n'a été poussé, tagué ni publié.** Aucun `git push`, aucun `git tag`,
aucune release GitHub, aucune image Docker, aucun appel réseau de publication
dans cette mission. Le seul effet sur le dépôt est un **commit local** de
préparation (bump + notes de version).

Comme les rapports de publication précédents (cf. message du commit 0.6.4), ce
rapport n'est **pas** committé.
