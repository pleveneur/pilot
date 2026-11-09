# P4 — Mise à jour détectée : contrôle récurrent + bon paquet proposé

Date : 2026-10-21
Portée : `src/js/updater.js`, `src/js/main.js`, `scripts/gen-latest-json.js`,
`scripts/latest-json-platforms.js` (nouveau), plus tests et documentation.
**Aucun** push, tag, changement de version ni publication. Commit **local** seulement.

---

## Cause (rappel du diagnostic)

1. **Aucun contrôle récurrent.** `initUpdater()` ne programmait qu'un seul
   `setTimeout(…, 10000)` : la vérification avait lieu ~10 s après le démarrage,
   une seule fois, pour toute la durée de vie du processus. L'instance ouverte
   avait démarré **avant** la publication de la 0.4.36 → aucun contrôle n'a eu
   lieu ensuite. Ce n'était pas une détection ratée : c'était une absence de
   contrôle.
2. **« À jour » et « échec » indiscernables.** En mode silencieux, une erreur de
   contrôle n'écrivait que dans la console (`console.error`) : l'utilisateur
   voyait exactement la même chose (rien) dans les deux cas.
3. **Défaut latent (installation).** `platformFromBinaryName()` associait
   `…-setup.exe` (NSIS) **et** `….msi` à la **même** clé `windows-x86_64` ; la
   dernière signature lue écrasait l'autre → `latest.json` proposait le **MSI**
   alors que le poste est installé en NSIS `currentUser` (`src-tauri/tauri.conf.json`,
   `bundle.windows.nsis.installMode`). Conséquence : seconde installation, et
   l'ancienne version relancée.

État du dépôt au départ de la mission : les deux points **n'étaient pas** faits
(`grep` : aucun `setInterval`/`focus` dans `updater.js` ; mapping Windows
exclusif absent de `gen-latest-json.js`). Aucun point n'a donc été refait.

---

## Correctif 1 — le contrôle ne dépend plus d'un seul instant

`src/js/updater.js`

| Élément | Emplacement | Effet |
|---|---|---|
| `REFRESH_INTERVAL_MS` = 6 h | `updater.js:41` | période de reprise silencieuse |
| `setTimeout` de démarrage (10 s, inchangé) | `updater.js:374` | premier contrôle, sans ralentir l'ouverture |
| `setInterval(checkSilently, REFRESH_INTERVAL_MS)` | `updater.js:376` | **nouveau** : reprise périodique |
| réveil au premier plan (`focus` + `visibilitychange`, ignoré si onglet caché) | `updater.js:383-390` | **nouveau** : contrôle au retour d'utilisation |
| anti-rebond `_checking` réutilisé | `updater.js:314-315` | jamais deux contrôles simultanés |
| `initUpdater()` idempotent (`_scheduled`) | `updater.js:365-367` | un seul jeu de contrôles programmé |

### Observabilité en langage clair

- État conservé après chaque contrôle : `_lastCheck = { at, outcome, detail, lastSuccessAt }`
  (`updater.js:34` pour la déclaration, écriture dans `checkForUpdate`
  `updater.js:317-356`). `outcome` distingue `up-to-date`, `update-available` et
  `error` — « à jour » et « échec » ne peuvent plus être confondus.
- Cause traduite : `describeCheckError()` (`updater.js:268-280`) → « pas de
  connexion au serveur de mises à jour », « accès refusé… », « signature
  invalide », sinon « erreur technique : … ».
- Phrase lisible : `formatLastCheckStatus()` (`updater.js:288-306`) — date + heure,
  verdict, et pour un échec la date du **dernier contrôle réussi**.
- Exposition à l'utilisateur :
  - contrôle manuel réussi → « Pilot est à jour (contrôle effectué le …) »
    (`updater.js:337`) ; contrôle manuel en échec → message d'erreur nommant la
    cause + l'état complet (`updater.js:348-353`) ;
  - **nouvelle commande de palette « État des mises à jour »**
    (`src/js/main.js:50`, `main.js:230-239`) : affiche quand le dernier contrôle a
    eu lieu et comment il s'est terminé, y compris quand aucun contrôle n'a encore
    eu lieu depuis le démarrage.

Le contrôle silencieux reste silencieux quand rien ne change (pas de toast toutes
les 6 h) : l'information est **consultable** (palette) et l'échec manuel est
toujours explicite.

---

## Correctif 2 — l'index propose le paquet correspondant à l'installation réelle

Nouveau module **pur** (aucun réseau, testable) : `scripts/latest-json-platforms.js`.

| Élément | Emplacement | Effet |
|---|---|---|
| `WINDOWS_UPDATER_FAMILY = "nsis"` | `latest-json-platforms.js:21` | famille retenue = installateur réellement utilisé (`installMode: currentUser`) |
| `windowsInstallerFamily()` | `latest-json-platforms.js:28-33` | reconnaît `-setup.exe` → `nsis`, `.msi` → `msi` |
| `isExcludedWindowsInstaller()` | `latest-json-platforms.js:41-44` | vrai pour le MSI (jamais retenu) |
| `platformFromBinaryName()` | `latest-json-platforms.js:53-66` | MSI → `null` (jamais `windows-x86_64`) ; macOS/Linux **inchangés** |

`scripts/gen-latest-json.js` : le mapping local est supprimé (`gen-latest-json.js:265-267`)
et remplacé par l'import du module (`gen-latest-json.js:27-31`) ; la boucle écarte
explicitement le MSI **avant** d'attribuer la clé, en le journalisant
(`gen-latest-json.js:309-319`). Résultat : `windows-x86_64` = toujours le
`…-setup.exe`, quel que soit l'ordre de retour des assets ; aucune entrée
supplémentaire n'est créée pour le MSI ; les cibles macOS/Linux sont identiques à
avant.

---

## Tests

### Nouveaux tests (14 cas)

| Fichier | Cas | Ce qu'il prouve |
|---|---|---|
| `src/js/updater-refresh.test.js` | 7 | (a) **plus d'un** contrôle dans le temps : 10 s → 1, +6 h → 2, +6 h → 3 ; (b) contrôle au retour au premier plan ; (c) ignoré si onglet caché ; (d) idempotence de `initUpdater()` ; (e) anti-rebond `_checking` (aucun chevauchement) ; (f) « aucun contrôle », « à jour » et « échec » produisent trois messages **distincts**, l'échec portant la cause et la date du dernier succès |
| `scripts/gen-latest-json-platforms.test.js` | 7 | (a) familles NSIS/MSI reconnues, NSIS retenu ; (b) `windows-x86_64` = NSIS, MSI → `null` ; (c) macOS/Linux inchangés, `.dmg`/`.deb` toujours ignorés ; (d) indexation rejouée avec les deux `.sig` **dans les deux ordres** → toujours le `-setup.exe`, jamais le MSI, aucune entrée en plus ; (e) MSI seul → aucune entrée Windows (pas de repli silencieux) |

### Non-vacuité vérifiée (les deux tests échouent sur l'ancien code)

- `updater-refresh.test.js` exécuté sur la version `HEAD` de `updater.js`
  (restaurée temporairement) → **échec** : `check()` appelé **1 fois** au lieu de 2
  et 3, `getLastCheckStatus` absent, écouteur `focus` absent (8 assertions en
  échec). Version corrigée restaurée ensuite.
- `gen-latest-json-platforms.test.js` exécuté avec l'ancien mapping
  (`-setup.exe` **ou** `.msi` → `windows-x86_64`) réintroduit temporairement →
  **échec** : « expected 'Pilot_0.4.36_x64_en-US.msi' to be undefined » (le MSI
  prenait l'entrée `windows-x86_64`). Module restauré ensuite.

### Résultats exacts

| Vérification | Commande | Résultat |
|---|---|---|
| Suite frontend complète | `npx vitest run` | **PASS (2115) / FAIL (0)**, 127 fichiers de test |
| Nouveaux tests seuls | `npx vitest run src/js/updater-refresh.test.js scripts/gen-latest-json-platforms.test.js` | **PASS (14) / FAIL (0)** |
| Build frontend | `npm run build` | **✓ built in 11.80s** (avertissements de découpage de chunks préexistants, aucun avertissement nouveau) |
| Syntaxe scripts | `node --check scripts/gen-latest-json.js`, `node --check scripts/latest-json-platforms.js` | OK |
| Rust | — | **non lancé** : aucun fichier Rust modifié (hors périmètre) |
| Aide intégrée | `npm run build:handbook` | 44 blocs, `help/handbook.md` régénéré (nouveau topic `pilot-update`) |

---

## Ce qui reste NON couvert

1. **Le contrôle réellement exécuté en application** n'a pas été observé (pas de
   build Tauri ni d'installation : interdit par la mission). La preuve porte sur
   le code et sur des minuteries simulées, pas sur une session graphique réelle.
2. **La correction de l'index ne prend effet qu'à la prochaine publication** : le
   `latest.json` de la 0.4.36 (MSI) reste tel quel sur GitHub. Les versions déjà
   publiées ne sont pas réécrites ; la prochaine release produira l'index corrigé.
3. **`latest.json` actuel téléchargeable** contient encore l'URL du MSI : un poste
   resté en 0.4.35 qui installerait la 0.4.36 maintenant passerait encore par le
   MSI (défaut de l'index publié, non du code corrigé).
4. **Échecs silencieux non hurlants** : un contrôle périodique en échec reste
   silencieux à l'écran (choix assumé, pas de notification toutes les 6 h). Il est
   consultable via la palette « État des mises à jour » et réapparaît en clair lors
   d'un contrôle manuel. Aucun journal persistant des échecs n'a été ajouté (hors
   périmètre).
5. **Linux** toujours absent de `latest.json` (constat antérieur, hors périmètre de
   cette mission).
6. **Cible `windows-aarch64` / autres familles d'installateurs** non traitées : seule
   la collision NSIS/MSI sur `windows-x86_64` était en cause.

---

## Vérifications quality-gate

- Fichiers relus en entier après modification : `src/js/updater.js` (sections
  modifiées), `src/js/main.js` (import, `COMMANDS`, `executeCommand`),
  `scripts/gen-latest-json.js` (import + boucle d'indexation),
  `scripts/latest-json-platforms.js`, les deux nouveaux tests.
- Points de connexion vérifiés : `initUpdater` toujours appelé une fois dans
  `main.js:339` ; `checkForUpdate` inchangé pour la palette (`check-update`) ;
  aucun export supprimé de `updater.js` (`checkForUpdate`, `initUpdater` conservées,
  trois ajouts) ; `gen-latest-json.js` reste invoqué de la même façon par
  `.github/workflows/release.yml:328` (aucun argument changé).
- Aucune fonctionnalité existante retirée : modale, historique du changelog,
  installation/relaunch, désactivation, macOS/Linux de `latest.json` intacts.
- Documentation mise à jour : `spec_pilot.md` (§ Mises à jour), `AGENTS.md`
  (arborescence `scripts/`), `help/overview.md` (nouveau bloc `HELP:pilot-update`) et
  `help/handbook.md` régénéré.
- Pas de Rust touché → pas de test Rust lancé.
