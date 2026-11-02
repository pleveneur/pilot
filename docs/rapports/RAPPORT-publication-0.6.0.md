# Rapport — Publication de la version 0.6.0

> Date : 2026-10-27 (session en cours). Version publiée : **0.6.0** (accord du
> propriétaire, numéro choisi par l'agent : 0.5.0 → 0.6.0).
> Méthode : **copie exacte de la publication 0.5.0** (commit `5a230eb`,
> `git show --stat` : `Cargo.lock`, `package.json`, `src-tauri/Cargo.toml`,
> `src-tauri/tauri.conf.json`, `release-notes/v0.5.0.md` — plus, cette fois-là
> seulement, deux mises à jour de *contenu* dans `README.md` et `spec_pilot.md`,
> déjà faites ici par les commits de documentation de la session).

---

## 1. Les quatre fichiers bumpés (avant → après)

| Fichier | Avant | Après |
|---|---|---|
| `src-tauri/tauri.conf.json` (ligne 4) | `"version": "0.5.0",` | `"version": "0.6.0",` |
| `src-tauri/Cargo.toml` (ligne 3, paquet `pilot`) | `version = "0.5.0"` | `version = "0.6.0"` |
| `package.json` (ligne 4) | `"version": "0.5.0",` | `"version": "0.6.0",` |
| `Cargo.lock` (ligne 3335, paquet `pilot`) | `version = "0.5.0"` | `version = "0.6.0"` |

Le `Cargo.toml` de la **racine** (manifeste du workspace) ne porte pas de
version : il n'a pas été touché. Aucune autre version n'a été modifiée.

## 2. Preuve que `Cargo.lock` n'a été touché qu'à l'endroit du paquet `pilot`

`git diff -- Cargo.lock` (avant commit) — **une seule ligne changée**, celle qui
suit `[[package]] name = "pilot"` :

```
@@ -3332,7 +3332,7 @@ dependencies = [
-version = "0.5.0"
+version = "0.6.0"
  dependencies = [
   "aes-gcm",
   "argon2",
 +1 -1
```

Contrôle exigé par la procédure : `grep 'version = "0.6.0"' Cargo.lock` renvoie
**2 lignes** — mais **une seule vient du bump** :

| Ligne | Paquet | Origine |
|---|---|---|
| 3335 | `pilot` | **le bump de cette publication** |
| 6639 | `window-vibrancy` (`source = "registry+…"`) | dépendance tierce **déjà en 0.6.0 avant** le bump, inchangée |

Le `git diff` ci-dessus le prouve : une seule ligne `+`/`-` dans tout le fichier.
Aucune dépendance n'a été verrouillée à une version inexistante (piège de
l'incident v0.2.30 évité : édition ciblée sur `name = "pilot"`, **aucun `sed`**).
Preuve supplémentaire : `cargo test` recompile `pilot v0.6.0` sans erreur de
verrou.

## 3. Notes de version

`release-notes/v0.6.0.md` créé (88 lignes), en français, orienté utilisateur,
sans jargon, sans nom de fichier ni de fonction. Sections
`## ✨ Nouvelles fonctionnalités`, `## 🐛 Corrections`, `## ⚡ Améliorations`.
Sujets couverts, **vérifiés sur le disque** (commits de `v0.5.0..HEAD`) :

- voix française locale installée **en un seul geste** (moteur + deux voix),
  arrêt sans rien perdre, reprise, seule la voix choisie hors paquet installée
  (`f30c878`, `d57e01e`) ;
- lecture à voix haute qui **dit** son repli à côté du bouton « Écouter »
  (`4dffca3`) ;
- **envoi automatique en fin de dictée** (onglet agent π + 🧭 Assistant, rien si
  vide ou en erreur, la saisie de l'utilisateur jamais écrasée) (`108038e`,
  `3b54f4d`, `a586432`) ;
- **menus du bas repliés au survol** (et au doigt), **ligne du bas immobile**
  (`c760a8d`, `65e6828`, `7a4badf`) ;
- **compteur « Travail » identique dans les deux modes** + démarrage avec
  l'application (`5af237d`, `721ce6c`) ;
- **badge « Distant » en bas de la colonne**, nom du moteur à un seul endroit
  (`9db5ea7`, `7758ba5`) ;
- **réglages qui affichent de nouveau les voix françaises locales** (état chargé
  tout seul) (`bbce78f`, verrouillé par `7d9e124`).

Volontairement **exclu** des notes : le chantier **en cours** de la voix du
système disparue (voir §7) — il n'est pas dans le tag.

## 4. Tests (avant le commit)

| Suite | Commande | Résultat |
|---|---|---|
| Rust (desktop) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **786 passed, 1 ignored**, 0 échec |
| Frontend | `npm test` | **195 fichiers / 3465 tests passed**, 0 échec |

Les deux suites sont vertes ⇒ publication autorisée.

## 5. Commit

- Hash complet : `752b12f0891506d38c5db118bb1f6300a76b7800`
- Message : `chore: bump version to 0.6.0`
- Contenu (**5 fichiers, sélectif, explicitement par chemin**) :
  `Cargo.lock`, `package.json`, `release-notes/v0.6.0.md`,
  `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
  (92 insertions, 4 suppressions).
- **Pas** dans ce commit (missions en cours, laissées intactes sur le disque) :
  `src-tauri/src/agents.rs`, `help/overview.md`, `spec_read_aloud.md`,
  `src/js/read-aloud.js`, `src/js/repli-voix-muet.test.js`, ainsi que les
  fichiers non suivis (rapports, propositions).

## 6. Envoi et tag

| Étape | Résultat |
|---|---|
| `git push origin main` | OK — `origin/main` = `752b12f…` (identique à `HEAD`) |
| `git tag v0.6.0` | créé localement (le tag n'existait pas : `git tag -l v0.6.0` vide avant) |
| `git push origin v0.6.0` | OK — `git ls-remote --tags origin v0.6.0` → `752b12f… refs/tags/v0.6.0` |
| Aucun tag republié | aucun `-f`, aucun tag existant réécrit |
| Workflow de release | **déclenché** : `name: "release"`, `head_branch: "v0.6.0"`, `event: "push"`, `status: "queued"` (API GitHub Actions, `per_page=5`) |

Le build n'a pas été attendu (la consigne ne demande que la preuve du
déclenchement).

## 7. Ce qui n'est PAS dans cette version

Missions encore en cours, présentes seulement sur le disque (non commitées,
donc **absentes du tag et de l'installable**) :

1. **« La voix du système mémorisée a disparu »** — dire aussi le repli de la
   voix du système là où l'on écoute (`src/js/read-aloud.js`,
   `src/js/repli-voix-muet.test.js`, `spec_read_aloud.md`, `help/overview.md`).
2. **`src-tauri/src/agents.rs`** (+39 lignes, autre mission).

## 8. Ce qui n'a pas été touché

Aucun code applicatif, aucune autre version, aucune suppression, aucun
`git push --force`. `README.md`, `spec_pilot.md` et `plan_dev.md` étaient déjà à
jour (aucune mention de numéro de version dans ces fichiers) : rien à y changer
pour ce bump.

---

*Vérifications effectuées* : `git show --stat` du bump 0.5.0 relu et imité ;
diff de `Cargo.lock` limité à la ligne du paquet `pilot` ; `cargo test --lib` et
`npm test` verts **après** le bump ; commit sélectif vérifié (`git status`
montrant exactement 5 fichiers indexés) ; `origin/main` et `origin` tag comparés
par hash ; workflow de release constaté « queued » sur le tag `v0.6.0`.
