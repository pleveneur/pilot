# Rapport de publication — Pilot v0.6.9

> Statut : **PUBLIÉE ET VÉRIFIÉE** — étiquette `v0.6.9` poussée, Release GitHub
> ouverte avec ses 11 fichiers, `latest.json` annonce 0.6.9 (voir § 5 et § 6).
> Rédigé par : agent publieur.
> Autorisation : le propriétaire a explicitement demandé la publication de la
> version **0.6.9** avant le début de cette session (numéro imposé par la
> consigne, aucune décision de numéro à prendre).
>
> Ce rapport est un fichier **neuf**. Aucun rapport existant n'a été écrasé,
> modifié ni déplacé — notamment `docs/rapports/RAPPORT-publication-0.6.8.md`
> (preuve de la publication réelle de la 0.6.8).

---

## 1. État réel du dépôt à l'ouverture (étape 1)

Tout ce qui suit a été **lu sur le disque**, après un `git fetch origin --tags --prune`.

| Élément | Valeur constatée |
|---|---|
| Branche | `main` (aucun upstream configuré — `@{u}` répond « no upstream configured ») |
| `HEAD` local | `6b53f675ab885239a36748c9ccb56979da82ba9c` — « feat(voix): lecture avec la voix imitée de l'utilisateur (service local VoiceStudio) » |
| `origin/main` | `31b9c8700614ab1651f0ccefa5e59ae81dd5edd1` — « docs: rapport de publication 0.6.8… » |
| Arbre de travail | **propre** (`git status` → *clean — nothing to commit*), avant les modifications de cette session |
| Écart avec `origin/main` | **1 commit non poussé** (`6b53f67`) |

### Commits au-dessus de l'étiquette `v0.6.8`

```
v0.6.8 → d503dfa  chore: bump version to 0.6.8
31b9c87           docs: rapport de publication 0.6.8 (déjà poussé sur origin)
6b53f67           feat(voix): lecture avec la voix imitée de l'utilisateur  ← non poussé (HEAD)
```

### Écart assumé avec la consigne : « deux commits dont `2263a7f` »

La consigne décrit `2263a7f` + `6b53f67` comme deux commits à livrer. Le disque dit
autre chose, et le disque fait foi :

- `2263a7f` **existe** comme objet Git mais **n'est plus dans l'histoire de `main`**
  (`git merge-base --is-ancestor 2263a7f HEAD` → faux ; aucune branche ne le
  contient : c'est un commit **amendé**, devenu orphelin).
- `6b53f67` est son **remplaçant** : il porte le **même message**, la même
  arborescence que `2263a7f`, **plus** le verrou de test et le rapport complété
  (`git diff 2263a7f 6b53f67` → seulement
  `docs/rapports/RAPPORT-voix-voicestudio.md` +35/−3 lignes et
  `src/js/voix-imitee-voicestudio.test.js` +35/−3 lignes).
- Son parent est `31b9c87` (déjà poussé).

**Conséquence** : il n'y a **rien à récupérer** de `2263a7f`, et **un seul** commit
de travail reste à livrer. Le contenu annoncé (la voix imitée) est bien présent.

### Changements depuis `v0.6.8` (`git diff --stat v0.6.8..HEAD`)

```
 AGENTS.md                                  |   6 +-
 docs/rapports/RAPPORT-publication-0.6.8.md | 202 ++++++++++-
 docs/rapports/RAPPORT-voix-voicestudio.md  | 355 ++++++++++++++++++
 help/handbook.md                           |  27 ++
 help/overview.md                           |  27 ++
 spec_read_aloud.md                         |  84 ++++-
 src-tauri/src/lib.rs                       |   8 +
 src-tauri/src/tts_voicestudio.rs           | 564 +++++++++++++++++++++++++++++
 src/js/read-aloud.js                       | 272 ++++++++++++--
 src/js/settings.js                         |  44 ++-
 src/js/vocal-correctifs-revue.test.js      |  13 +-
 src/js/voicestudio-voice.js                | 451 ++++++++++++++++++++++++
 src/js/voix-imitee-voicestudio.test.js     | 430 ++++++++++++++++++++++++
 13 fichiers, 2431 insertions(+), 52 suppressions(-)
```

Une seule fonctionnalité livrée : **la voix imitée** (troisième moteur de lecture,
à côté de la voix du système et de la voix locale Piper).

### L'étiquette `v0.6.9` est-elle libre ? — OUI

```
git tag --list 'v0.6.*'                                  → … v0.6.6 v0.6.7 v0.6.8 (pas de v0.6.9)
git ls-remote --tags origin | grep v0.6.8|v0.6.9         → refs/tags/v0.6.8 seulement
```

`v0.6.7` (`490ccff`) et `v0.6.8` (`d503dfa`, objet d'étiquette
`8508651905…`) ne sont **pas** touchées par cette session.

### Le GDS bloque-t-il ? — NON

`.pilot/gds.json` → `"enabled": false`, `server_url` vide. La règle « aucune
publication GitHub si le projet est basculé sur le GDS » ne s'applique pas.
Un remote local `gds` (reliquat de test pointant
`src-tauri/laya.__probe2__/pilot-gds-absent-10988`) subsiste : il n'est **pas**
utilisé. Publication vers `origin` → `https://github.com/pleveneur/pilot.git`
uniquement.

---

## 2. Version retenue (étape 2)

**0.6.9** — règle du projet : correctifs = incrément du dernier chiffre, jamais de
recul. `0.6.8` est consommée (étiquette + Release publiées).

| Fichier | Avant | Après |
|---|---|---|
| `package.json` (l. 4) | `0.6.8` | `0.6.9` |
| `src-tauri/tauri.conf.json` (l. 4) | `0.6.8` | `0.6.9` |
| `src-tauri/Cargo.toml` (l. 3, package `pilot`) | `0.6.8` | `0.6.9` |
| `Cargo.lock` (l. 3335, package `pilot` **seulement**) | `0.6.8` | `0.6.9` |
| `release-notes/v0.6.9.md` | — | créé (§ 3) |

**Piège vérifié, sans effet cette fois** : avant édition, `Cargo.lock` ne
contenait **qu'une seule** occurrence de `0.6.8` (celle du package `pilot`) — pas
de dépendance tierce au même numéro. Après édition, `git diff --numstat Cargo.lock`
→ **1 insertion, 1 suppression** : une seule ligne, aucun `sed` global (incident
v0.2.30 évité). Les occurrences `0.6.9` de `serde_spanned` (l. 4423, préexistante)
sont **intactes**.

---

## 3. Changelog publié (étape 3)

Fichier : `release-notes/v0.6.9.md` — français, accents compris, aucune mention de
technique interne (ni nom de fichier, ni nom de fonction).

- **✨ Nouvelles fonctionnalités**
  1. **Pilot peut lire avec votre voix imitée** — elle apparaît dans les réglages
     de lecture à côté des quatre voix françaises et de la voix du système, sous
     le nom du profil avec la mention du service ; on peut l'écouter avant de la
     choisir, et le choix est **enregistré** (repris à la prochaine ouverture).
  2. **Le son arrive vite sur une longue réponse** — découpage en groupes de
     phrases, le premier n'étant qu'une phrase, le suivant préparé pendant
     l'écoute du précédent.
  3. **Le démarrage du service est annoncé, jamais subi** — préparation lancée sur
     le geste de sélection, sans bloquer la fenêtre.
- **⚡ Améliorations**
  1. **Service éteint → la lecture continue** : une ligne le dit à côté du bouton
     d'écoute, et la réponse est lue avec la voix française locale (Piper), puis la
     voix du système à défaut. Rien ne bloque, rien n'est lu en silence.
  2. **Une voix disparue du service n'est jamais remplacée sans le dire** — le
     choix reste affiché avec la raison en clair.
  3. **Tout reste sur la machine** : aucun moteur téléchargé, aucun fichier audio
     écrit, aucun son qui sort, rien de conservé.

---

## 4. Contrôles (étape 4)

> Section complétée après exécution réelle. **Un test rouge arrête tout.**

| Contrôle | Commande exacte | Résultat |
|---|---|---|
| Tests frontend | `npm test` | **VERT** — 277 fichiers / 5136 tests passés, 0 échec |
| Tests Rust (desktop) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **VERT** — 826 passés, 1 ignoré, 0 échec |
| Fabrication | `npm run tauri build` | **RÉUSSIE** — binaire + MSI + NSIS en 0.6.9 (§ 4.3) |
| Typage TypeScript | `npx tsc --noEmit` | **VERT** — « No errors found » |

**Aucun test vert obtenu par assouplissement** : aucun test n'a été modifié,
ignoré, filtré ni supprimé pendant cette session (`git status` avant commit ne
contient aucun fichier de test).

### 4.1 `npm test` — VERT

```
 Test Files  277 passed (277)
      Tests  5136 passed (5136)
   Duration  14.65s
```

Aucun fichier en échec. Les messages sur `stderr` (ex. `agent-activity-assistant-tab.test.js`)
sont des **traces attendues** d'appels Tauri hors environnement graphique : le test
qui les émet est **passé**. Ce n'est pas un échec.

### 4.2 `cargo test --manifest-path src-tauri/Cargo.toml --lib` — VERT

```
Compiling pilot v0.6.9 (G:\IA_PL\pilot\src-tauri)
Finished `test` profile [unoptimized + debuginfo] target(s) in 38.59s
Running unittests src\lib.rs (target\debug\deps\pilot-de98a88fac2c8784.exe)
cargo test: 826 passed, 1 ignored (1 suite, 11.06s)
```

L'ignoré est **ignoré par le code**, pas par cette session. La compilation confirme
au passage que le package se nomme bien **`pilot v0.6.9`** (bump `Cargo.lock` correct).

### 4.3 `npm run tauri build` — RÉUSSIE (signature faite en CI)

Journal complet : `.pilot/tmp-pub/0.6.9-build.log` (551 lignes).

| Étape | Résultat |
|---|---|
| `beforeBuildCommand` (mcp + handbook + laya + `vite build`) | OK — **4153 modules transformés**, `built in 14.20s` |
| `cargo build --release` | OK — `Finished release profile in 2m 18s` (26 avertissements, **aucune erreur**) |
| Binaire | `target/release/pilot.exe` — 44,6 Mio |
| MSI | `target/release/bundle/msi/Pilot_0.6.9_x64_en-US.msi` — 79,2 Mio |
| NSIS | `target/release/bundle/nsis/Pilot_0.6.9_x64-setup.exe` — 60,8 Mio |
| Code de sortie du processus | **1 — uniquement** sur `A public key has been found, but no private key` |

Le journal ne contient **qu'une seule** ligne commençant par `Error` : celle de la
signature. La clé privée `TAURI_SIGNING_PRIVATE_KEY` n'existe que dans les secrets
GitHub : ce comportement est **attendu en local** et identique aux publications
0.6.4, 0.6.6, 0.6.7 et 0.6.8. La signature est faite en CI (les `.sig` le prouvent,
§ 5.4).

**Bilan : aucun test rouge ⇒ publication autorisée.**

### 4.4 L'aide intégrée est régénérée sans différence

`help/handbook.md` a été régénéré par `beforeBuildCommand` : `git diff --stat
help/handbook.md` est **vide** après la fabrication. Le bloc `<!-- HELP:* -->` de
`spec_read_aloud.md` (voix imitée) était déjà à jour dans le commit livré : rien
n'a été ajouté ni perdu.

---

## 5. Livraison (étape 5)

### 5.1 Commit de livraison — UN SEUL commit

```
31f585c122738d45ca2a2f959f26da298d526da6
chore: bump version to 0.6.9
2026-11-02 16:47:31 +0400
```

6 fichiers, 275 insertions, 4 suppressions :

| Fichier | Nature |
|---|---|
| `package.json` | version 0.6.8 → 0.6.9 |
| `src-tauri/tauri.conf.json` | version 0.6.8 → 0.6.9 |
| `src-tauri/Cargo.toml` | version 0.6.8 → 0.6.9 |
| `Cargo.lock` | **seule** la ligne du package `pilot` (l. 3335) |
| `release-notes/v0.6.9.md` | créé (changelog § 3) |
| `docs/rapports/RAPPORT-publication-0.6.9.md` | créé (ce rapport) |

Aucun fichier de données, aucun secret, aucune sortie de fabrication
(`target/` et `.pilot/tmp-pub/` sont ignorés par Git — `git status` est resté
propre après la fabrication).

### 5.2 `main` poussé

```
git push origin main:main   → ok
origin/main                 → 31f585c122738d45ca2a2f959f26da298d526da6 (= HEAD)
```

### 5.3 Étiquette annotée — POUSSÉE

```
git tag -a v0.6.9 -m "Pilot v0.6.9"
git push origin v0.6.9     → ok

git rev-list -n1 v0.6.9                  → 31f585c122738d45ca2a2f959f26da298d526da6
git ls-remote --tags origin 'refs/tags/v0.6.9*'
  ac73d9e1a3f1550c8f08055e15b2cbb7cef5108b  refs/tags/v0.6.9       (objet d'étiquette)
  31f585c122738d45ca2a2f959f26da298d526da6  refs/tags/v0.6.9^{}    (commit étiqueté)
```

### 5.4 Release GitHub — PUBLIÉE, 11 fichiers

`https://github.com/pleveneur/pilot/releases/tag/v0.6.9` — id **`431453649`**,
`name` = « Pilot v0.6.9 », `draft: false`, `prerelease: false`,
`published_at` = `2026-11-02T12:46:41Z`, `target_commitish` = `31f585c`.

| Fichier | Taille (octets) |
|---|---|
| `Pilot_0.6.9_x64-setup.exe` (NSIS, installateur Windows) | 64 795 807 |
| `Pilot_0.6.9_x64-setup.exe.sig` | 416 |
| `Pilot_0.6.9_x64_en-US.msi` | 84 443 136 |
| `Pilot_0.6.9_x64_en-US.msi.sig` | 416 |
| `Pilot_0.6.9_x64.dmg` (macOS Intel) | 39 150 048 |
| `Pilot_0.6.9_aarch64.dmg` (macOS Apple Silicon) | 103 654 657 |
| `Pilot_x64.app.tar.gz` | 39 504 858 |
| `Pilot_x64.app.tar.gz.sig` | 404 |
| `Pilot_aarch64.app.tar.gz` | 106 107 209 |
| `Pilot_aarch64.app.tar.gz.sig` | 404 |
| `latest.json` | 4 155 |

Total : **437 661 510 octets**, tous en `state = uploaded`. Les **quatre `.sig`**
prouvent la signature faite en CI (absente de ma fabrication locale, § 4.3).

Le corps de la Release est bien le **changelog français** (2 255 caractères),
précédé du titre automatique du workflow :

```
## Modifications depuis v0.6.8

# Pilot v0.6.9
…
```

### 5.5 État du workflow (`release.yml`, run `41447435153`)

| Job | État | Conclusion |
|---|---|---|
| `test (windows-latest)` | completed | **success** |
| `test (ubuntu-22.04)` | completed | **success** |
| `test (macos-latest)` | completed | **success** |
| `create-release` | completed | **success** |
| `build (windows-latest, x86_64-pc-windows-msvc)` | completed | **success** |
| `build (macos-latest, x86_64-apple-darwin)` | completed | **success** |
| `build (macos-latest, aarch64-apple-darwin)` | completed | **success** |
| `latest-json` | completed | **success** |
| `build-linux` | in_progress | — |

`build-linux` est un job **séparé**, plafonné à 90 min, en `continue-on-error`,
dont aucun autre job ne dépend : il ne retarde ni ne bloque la publication.
**Cible Linux non servie = défaut connu et toléré** (identique à la 0.6.8) ; rien
n'a été relancé pour elle.

---

## 6. Vérifications après coup (étape 6) — relues dans les fichiers, pas sur parole

### 6.1 L'étiquette pointe bien sur mon commit

| Contrôle | Résultat |
|---|---|
| `git rev-list -n1 v0.6.9` (local) | `31f585c122738d45ca2a2f959f26da298d526da6` = mon commit de bump |
| `refs/tags/v0.6.9^{}` (distant) | `31f585c122738d45ca2a2f959f26da298d526da6` |
| `target_commitish` de la Release | `31f585c122738d45ca2a2f959f26da298d526da6` |

Les trois disent la même chose.

### 6.2 `latest.json` annonce bien 0.6.9 pour toutes les plateformes servies

Téléchargé depuis **l'URL exacte que l'application installée interroge**
(`src-tauri/tauri.conf.json` → `plugins.updater.endpoints` =
`https://github.com/pleveneur/pilot/releases/latest/download/latest.json`) :

```
version  : 0.6.9
pub_date : 2026-11-02T13:09:22.206Z
platforms:
  windows-x86_64  → …/download/v0.6.9/Pilot_0.6.9_x64-setup.exe
  darwin-aarch64  → …/download/v0.6.9/Pilot_aarch64.app.tar.gz
  darwin-x86_64   → …/download/v0.6.9/Pilot_x64.app.tar.gz
notes    : 2255 caractères, commence par « ## Modifications depuis v0.6.8 »
```

Sondes de texte dans les `notes` : « votre voix imitée » **OK**,
« service de voix est éteint » **OK**, « Piper » **OK**, « Tout reste sur votre
machine » **OK** — accents corrects (UTF-8), c'est bien le changelog livré.

**Conséquence concrète** : une application installée en 0.6.8 interroge cette URL
et se voit proposer **0.6.9** ; l'installateur pointé pour Windows est le NSIS
signé, pas le MSI.

### 6.3 La Release contient tous les fichiers attendus

11 fichiers (liste et tailles au § 5.4), les 4 `.sig` présents, `latest.json`
présent. Aucun fichier manquant, aucun fichier en `state` autre que `uploaded`.

### 6.4 La 0.6.8 et la 0.6.7 sont intactes

| Élément | Constat après publication | Était-ce la valeur d'avant ? |
|---|---|---|
| Objet d'étiquette `v0.6.8` | `8508651905666d30c0fc577aafcd701a729b7f4b` | oui (lu avant) |
| Commit de `v0.6.8` | `d503dfa0e4cdad2b6a542518b17f54f501becb71` | oui |
| Release `v0.6.8` | id `431382215`, 11 fichiers, publiée `2026-11-02T11:29:12Z` | oui |
| Objet d'étiquette `v0.6.7` | `137fd75f1bf07e97b4a46cbb596651d8d8d62421` | oui |
| Commit de `v0.6.7` | `490ccfffd671b6ea7937a9de419ef6d93c719799` | oui |
| Release `v0.6.7` | id `431199249`, 11 fichiers, publiée `2026-11-02T08:03:06Z` | oui |

Aucune étiquette n'a été déplacée, recréée ni supprimée ; aucune Release
antérieure n'a été modifiée.

### 6.5 Le dépôt n'a pas été poussé ailleurs qu'`origin`

Le remote local `gds` (reliquat de test) n'a reçu **aucune** poussée : les seules
commandes de publication exécutées visent `origin`
(`https://github.com/pleveneur/pilot.git`).

### 6.6 Un travail d'une AUTRE session est apparu pendant la publication — laissé intact

Juste après la poussée du rapport, `git status` signale un fichier modifié que
**cette session n'a pas touché** :

```
 M src/js/super-agent.js   (+11 −1)
```

Le contenu est un correctif vocal (« la barre du bas ne s'efface plus », daté
2026-11-15 dans son propre commentaire, `if (transcript.trim()) vocalWakeChrome();`)
: c'est le travail en cours d'une **autre session du projet**. Décisions prises :

- **rien n'a été supprimé, écrasé, restauré ni committé** ;
- il **n'est pas** dans la 0.6.9 : le commit livré (`31f585c`) a été composé par
  chemins explicites (6 fichiers), donc la Release ne contient que le bump, le
  changelog et ce rapport ;
- il reste dans l'arbre de travail du propriétaire, à livrer par la session qui
  l'a écrit.

---

## 7. Ce que le propriétaire doit vérifier lui-même à la main

1. **Ouvrir la Release** https://github.com/pleveneur/pilot/releases/tag/v0.6.9 et
   compter les **11 fichiers** (liste au § 5.4).
2. **Relire le texte affiché aux utilisateurs** : le corps de la Release commence
   par « ## Modifications depuis v0.6.8 » puis le changelog français. Vérifier que
   les trois entrées de la voix imitée disent bien ce que vous constatez en usage.
3. **La mise à jour automatique dans l'application installée** : ouvrir Pilot
   (0.6.8 installé), laisser passer la vérification de mise à jour, et vérifier
   qu'il propose **0.6.9**. C'est la seule preuve qui compte pour un utilisateur.
4. **La voix imitée en vrai** : ouvrir les réglages de lecture, vérifier que la
   voix imitée apparaît avec le nom de votre profil et la mention du service,
   l'écouter, la choisir, puis relire une réponse. La preuve qui manque encore est
   **le son réel** : je ne peux pas l'entendre depuis cette session.
5. **Le repli visible** : éteindre votre service de voix, relancer une lecture, et
   vérifier qu'une ligne l'annonce à côté du bouton d'écoute et que la lecture
   continue avec la voix française locale.
6. **`build-linux`** : le job tournait encore au moment du rapport. Si vous voulez
   la cible Linux, il faudra le regarder séparément — il n'est **pas** requis pour
   la mise à jour Windows/macOS.
7. **L'image du serveur GDS** : elle **n'a pas** été reconstruite par cette session
   (`.pilot/gds.json` → `enabled: false`, et la consigne de publication n'en
   demandait pas). Si vous voulez aligner l'image sur ce code, c'est
   `npm run gds:image` — geste volontaire, rien n'a été touché ici.
8. **Les sorties de fabrication locales** : `target/release/bundle/{msi,nsis}` et
   `.pilot/tmp-pub/0.6.9-build.log` restent sur votre disque (ignorés par Git).
   Aucune n'a été publiée en dehors de la CI.
9. **Le correctif vocal en cours d'une autre session** (`src/js/super-agent.js`,
   non committé, voir § 6.6) n'est **pas** dans la 0.6.9 : si vous le vouliez dans
   cette version, il faudra une publication suivante.

---

## VERDICT : publiée et vérifiée (étiquette annotée `v0.6.9` → `31f585c` ;
Release GitHub `431453649` avec ses 11 fichiers dont les installateurs Windows NSIS
et MSI signés et les deux macOS ; `latest.json` annonce **0.6.9** pour
`windows-x86_64`, `darwin-aarch64` et `darwin-x86_64` sur l'URL même que
l'application interroge ; contrôles **277 fichiers / 5136 tests frontend** et
**826 tests Rust passés, 1 ignoré**, fabrication réussie avec binaire + MSI + NSIS
0.6.9, `v0.6.8` et `v0.6.7` intactes). Réserves connues et tolérées : la cible
Linux n'est pas servie (`build-linux` encore en cours, job séparé qui ne bloque
rien) et la signature locale est faite en CI, comme lors des publications
précédentes.
