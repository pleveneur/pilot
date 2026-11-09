# Pourquoi Pilot ne voit pas la 0.4.36 — diagnostic en lecture seule

Date du constat : **2026-10-21 ~09:54 (UTC+04:00) = 05:54 UTC**
Auteur : agent de diagnostic (lecture seule). Aucun fichier de code, de configuration
ou de version n'a été modifié. Aucun commit, tag, push ni publication.

---

## Verdict (une phrase)

**La mise à jour n'est pas « mal publiée » : elle est bien détectable, mais Pilot ne
la cherche qu'UNE seule fois, ~10 s après son démarrage — et l'instance actuellement
en marche a démarré à 03:32:40 UTC, soit 1 h 25 min AVANT la publication de la
0.4.36 (04:57:42 UTC). Aucun contrôle n'a donc eu lieu depuis la publication : il
n'y avait rien à proposer.**

La cause est **côté client / fréquence de vérification**, pas côté publication.

---

## Preuve maîtresse : la chronologie

| Événement | Horodatage | Source |
|---|---|---|
| Démarrage du `pilot.exe` **actuellement en marche** (PID 17032) | `2026-10-21 07:32:40 +04:00` = **03:32:40 UTC** | `Get-Process pilot \| Select StartTime` |
| Contrôle automatique de MAJ = démarrage + 10 s | ≈ **03:32:50 UTC** | `src/js/updater.js:267-272` (`setTimeout(..., 10000)`) |
| Version la plus récente à cet instant | **0.4.35** (= version installée) | release `v0.4.35` `published_at = 2026-10-20T09:29:01Z` (API GitHub) |
| Publication de `v0.4.36` | **2026-10-21T04:57:42Z** | API GitHub, release `v0.4.36` |
| `latest.json` final (notes réécrites) | `pub_date = 2026-10-21T05:48:21Z` | asset `latest.json` de la release |
| Constat de ce diagnostic | ≈ **05:54 UTC** | — |

Version réellement installée sur le poste :

```
Get-Item 'C:\Users\pldistance\AppData\Local\Pilot\pilot.exe' → FileVersion 0.4.35
```

Conclusion : entre 03:32:50 UTC (seul contrôle) et 05:48 UTC (index à jour), **Pilot
n'a jamais réinterrogé le point de contrôle**. Le mécanisme de détection n'a pas
échoué — il n'a pas été exécuté.

---

## Ce qui est formellement vérifié BON côté distant (donc écarté)

| Vérification | Résultat constaté | Source |
|---|---|---|
| Tag publié | `v0.4.36` → `e151a1e`, présent sur `origin` | `git ls-remote --tags origin` |
| Release en **brouillon** ? | **non** — `draft: false` | API GitHub `releases?per_page=5` |
| Release en **pré-libération** ? | **non** — `prerelease: false` | idem |
| Workflow force le bon état | `releaseDraft: false`, `prerelease: false` | `.github/workflows/release.yml:288-289` |
| Point de contrôle configuré | `https://github.com/pleveneur/pilot/releases/latest/download/latest.json` | `src-tauri/tauri.conf.json:61` |
| Ce que renvoie cette adresse **aujourd'hui** | HTTP 200, 5 399 octets, `"version": "0.4.36"`, `pub_date 2026-10-21T05:48:21Z` | `curl -sL -H 'Accept: application/json' …` |
| Le même point de contrôle dans le **binaire installé** (0.4.35) | chaîne identique trouvée dans `pilot.exe` (`grep -a`) → **l'endpoint n'a pas changé** | `AppData\Local\Pilot\pilot.exe` |
| Clé publique de signature dans le binaire 0.4.35 | identique à `tauri.conf.json:63` → pas de rupture de clé | `grep -a` sur `pilot.exe` |
| Signatures présentes dans l'index | 3/3 plateformes signées (`windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`) | `latest.json` téléchargé |
| Fichiers `.sig` présents sur la release | `…x64-setup.exe.sig`, `…x64_en-US.msi.sig`, `…app.tar.gz.sig` ×2 | API GitHub (assets) |
| Noms des éléments attendus | `Pilot_0.4.36_x64-setup.exe`, `Pilot_0.4.36_x64_en-US.msi`, `Pilot_{aarch64,x64}.app.tar.gz` — conformes | assets de la release |
| Permission côté application | `updater:default` accordée | `src-tauri/capabilities/default.json:8` |
| Plugins activés | `updater.active: true`, `dialog: false` (modale maison) | `src-tauri/tauri.conf.json:58-59` |
| Mandataire (proxy) dans l'environnement | **aucune** variable `*_proxy` définie | `env \| grep -i proxy` |
| Mandataire système WinINet | `ProxyEnable = 0x0` ; pas de `AutoConfigURL` | `reg query …\Internet Settings` |
| Accès réseau réel depuis le poste | la requête aboutit en 1,9 s (HTTP 200, redirection vers `release-assets.githubusercontent.com`) | `curl -w` |
| Élément HTML de la modale | `#update-modal`, `#update-version`, `#update-notes`, `#btn-update-install`, `#btn-update-later`, `#update-progress-fill` tous présents | `index.html:1262-1281` |
| Comparaison de versions | numérique 3 composantes, pas de comparaison de texte | `src/js/updater.js:35-49` |
| Comparaison de la version | faite par le plugin Rust (`tauri-plugin-updater 2.10.1`, sémantique semver), pas par le JS | `Cargo.lock:5365-5366`, `src/js/updater.js:247` |
| Clé de désactivation locale des MAJ de **Pilot** | **aucune** (`pi_skip_update_check` concerne pi, l'agent — pas Pilot) | `AppData\Roaming\com.pilot.editor\config.json` |
| Mode développement qui couperait la vérification | aucun test `debug_assertions` / `isTauri` autour de `initUpdater()` | `src/js/main.js:339` |

---

## Tableau des causes examinées

| # | Cause examinée | Preuve | Verdict |
|---|---|---|---|
| 1 | Release en brouillon ou pré-libération (donc non servie par `releases/latest`) | `draft:false`, `prerelease:false` (API) ; `release.yml:288-289` | **Écartée** |
| 2 | Point de contrôle mal configuré / différent dans le binaire installé | `tauri.conf.json:61` = chaîne du binaire 0.4.35 | **Écartée** |
| 3 | `latest.json` absent, périmé ou incohérent | HTTP 200, `version 0.4.36`, `pub_date` postérieur à la release | **Écartée** |
| 4 | Signature absente / nom d'élément inattendu | 3 plateformes signées ; `.sig` présents ; noms conformes | **Écartée** |
| 5 | Mandataire détournant ou bloquant la requête | aucune variable proxy, `ProxyEnable=0`, requête à 200 en 1,9 s | **Écartée** (sur ce poste, à cet instant) |
| 6 | Comparaison de versions fautive (`"0.4.36" < "0.4.35"`) | comparaison numérique `updater.js:35-49` ; comparaison réelle faite par le plugin Rust semver | **Écartée** |
| 7 | Erreur réseau avalée en silence → aucun message | **réel** : `updater.js:253-258` n'écrit que dans la console, rien à l'écran quand `silent=true` ; mais la requête aboutit aujourd'hui, donc ce n'est pas la cause du cas présent | **Réelle mais non déclenchante ici** — c'est un défaut d'observabilité à corriger |
| 8 | **Vérification exécutée une seule fois, avant la publication** | `updater.js:267-272` : un seul `setTimeout(10000)` ; aucun `setInterval`, aucun contrôle à la reprise de focus, aucun contrôle périodique (`grep` sur `updater.js` : rien) ; démarrage 03:32:40 UTC < publication 04:57:42 UTC | **CAUSE RETENUE** |
| 9 | Clic sur « Plus tard » / ✕ lors d'une détection antérieure | la modale ne referme que l'affichage ; aucune trace persistée d'un refus (`config.json` ne contient aucune clé de ce type) | **Non prouvé** (aucune trace disque d'un clic) |
| 10 | Modale de MAJ qui lève une exception (mise en page du changelog) → capture silencieuse | `showUpdateModal` est appelée dans le `try` de `checkForUpdate` : une exception serait avalée par `catch` (`updater.js:253-258`) | **Possible en théorie, non prouvée** (aucune trace) |
| 11 | Installation qui aboutirait mais laisserait l'ancienne version en place (défaut latent distinct) | `latest.json` → `windows-x86_64` = **`Pilot_0.4.36_x64_en-US.msi`** alors que l'installation du poste est **NSIS `currentUser`** (`tauri.conf.json:25-26`, `uninstall.exe` NSIS dans `AppData\Local\Pilot`) | **Défaut réel, hors du symptôme « ne détecte pas »** — voir ci-dessous |

### Le défaut latent n° 11, en détail (à ne pas confondre avec la cause)

`scripts/gen-latest-json.js` associe **la même clé** `windows-x86_64` aux deux
familles d'installateurs Windows :

```js
// scripts/gen-latest-json.js:264
if (n.endsWith("-setup.exe") || n.endsWith(".msi")) return "windows-x86_64";
...
// scripts/gen-latest-json.js:329
platforms[key] = { signature, url: binAsset.browser_download_url };
```

Boucle sur **tous** les `.sig` : `Pilot_0.4.36_x64-setup.exe.sig` **et**
`Pilot_0.4.36_x64_en-US.msi.sig` produisent la même clé — **la dernière écrasé la
première**. Résultat constaté : c'est le **MSI** qui gagne. Conséquence : pour un
poste installé en NSIS (`installMode: currentUser`, `AppData\Local\Pilot`), la mise à
jour téléchargerait un MSI, donc **une seconde installation ailleurs** ; le
`pilot.exe` réellement lancé resterait en 0.4.35. Le même travers existe déjà dans
`latest.json` de `v0.4.35` (URL `…0.4.35_x64_en-US.msi`) : **antérieur à la 0.4.36**.

---

## Correction minimale proposée (NON implémentée)

### A. Cause retenue — ré-interroger le point de contrôle après le démarrage

- **Fichier** : `src/js/updater.js` (fonction `initUpdater`, lignes 267-272).
- **Comportement attendu** : après le premier contrôle (10 s), refaire un contrôle
  **silencieux** à intervalle raisonnable (par ex. toutes les 6 h) **et** à la
  reprise de focus de la fenêtre, avec un anti-rebond (déjà présent : `_checking`).
  Une MAJ publiée pendant que Pilot tourne doit être proposée **sans redémarrage**.
- **Test qui aurait empêché le défaut** : test unitaire de `initUpdater` avec
  horloge/minuterie simulées — vérifier que `checkForUpdate` est appelé **plus d'une
  fois** et qu'un second appel a lieu après le premier délai (par ex.
  `src/js/updater-refresh.test.js`). Le test échoue aujourd'hui : un seul appel.

### B. Défaut d'observabilité (aggravant, à corriger dans le même lot)

- **Fichier** : `src/js/updater.js:253-258`.
- **Comportement attendu** : ne jamais rendre « aucune mise à jour » et « contrôle
  impossible » indiscernables. En mode silencieux, mémoriser le dernier résultat
  (date + OK/erreur) et l'exposer dans la palette (« Vérifier les mises à jour »)
  au lieu de n'écrire que dans la console.
- **Test** : un `check()` qui rejette doit laisser un état « dernière vérification :
  échec (réseau) » consultable — pas un silence.

### C. Défaut latent d'installation (indépendant, à traiter séparément)

- **Fichier** : `scripts/gen-latest-json.js:262-275` (et non la boucle).
- **Comportement attendu** : une seule famille d'installateur Windows par clé
  `windows-x86_64`, **choisie explicitement** pour correspondre à
  `bundle.windows.nsis.installMode = currentUser` (donc `-setup.exe`), et journaliser
  l'installateur écarté. Un MSI ne doit jamais remplacer silencieusement le NSIS.
- **Test** : `platformFromBinaryName('Pilot_x64-setup.exe')` et
  `platformFromBinaryName('Pilot_x64_en-US.msi')` doivent produire des choix
  **déterministes et distincts**, et la génération de `latest.json` avec les deux
  `.sig` doit toujours sélectionner le même fichier.

---

## Ce qui reste NON PROUVÉ

1. **Aucune tentative de contrôle manuel n'a pu être constatée.** La commande de
   palette « Vérifier les mises à jour » (`src/js/main.js:49`, `226-227`) aurait
   détecté la 0.4.36. Rien sur le disque ne trace son exécution ni son résultat :
   impossible d'affirmer que l'utilisateur ne l'a pas essayée, ni ce qu'elle a
   affiché. Le fait que le symptôme soit « ne propose pas » (et non « dit que tout
   est à jour ») **oriente** vers « aucun contrôle n'a eu lieu », sans le prouver.
2. **Aucun journal de la WebView.** Les erreurs du contrôleur de MAJ partent dans
   `console.error` (`updater.js:254`), non persisté : si un contrôle avait échoué,
   il n'en resterait aucune trace. Impossible d'exclure formellement un échec
   réseau *au moment où l'utilisateur a regardé* (le réseau fonctionne maintenant,
   pas nécessairement alors).
3. **Le comportement exact du plugin lors de l'installation d'un MSI sur une
   installation NSIS** n'a pas été observé (interdiction de relancer un build ou une
   installation) : la conséquence décrite en n° 11 est **déduite du code et du
   contenu de `latest.json`**, pas constatée à l'exécution.
4. **Rien ne prouve ni n'exclut un clic sur « Plus tard »** lors d'une détection
   antérieure : cet état n'est écrit nulle part sur le disque.
5. **Plateforme Linux absente** de `latest.json` (`linux-x86_64` manquant) : sans
   effet ici (poste Windows), mais un utilisateur Linux ne recevrait jamais la MAJ.
   Constat déjà consigné dans `rapport-publication-0.4.36.md`.

---

## Reproduire la vérification (commandes utilisées, toutes en lecture)

```bash
# État de la release (brouillon / pré-libération / assets)
curl -s "https://api.github.com/repos/pleveneur/pilot/releases?per_page=5"

# Ce que l'application interroge, aujourd'hui
curl -sL -H "Accept: application/json" \
  "https://github.com/pleveneur/pilot/releases/latest/download/latest.json"

# Endpoint réellement compilé dans le binaire installé
grep -a -o "https://github.com/pleveneur/pilot/releases[^\"' <]*" \
  "/c/Users/pldistance/AppData/Local/Pilot/pilot.exe" | sort -u

# Version installée
powershell -NoProfile -Command \
  "(Get-Item 'C:\Users\pldistance\AppData\Local\Pilot\pilot.exe').VersionInfo.ProductVersion"

# Heure de démarrage de l'instance en cours (preuve maîtresse)
powershell -NoProfile -Command "Get-Process pilot | Select-Object Id,StartTime"
```
