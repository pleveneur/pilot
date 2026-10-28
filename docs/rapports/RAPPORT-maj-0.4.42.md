# Rapport — « J'ai une mise à jour, et elle ne se fait pas » (0.4.42)

**Rédigé :** 2026-10-23 ~18 h 30 (heure locale), projet `G:\IA_PL\pilot`
**Rôle :** codeur (diagnostic avant toute correction)
**Version du dépôt au moment du diagnostic :** **0.4.42** (arbre de travail restauré, voir § 0)

---

## 0. État de départ (remise en état demandée)

| Geste | Résultat |
|---|---|
| Restes non commités de la préparation 0.4.43 (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `Cargo.lock`) | **annulés** (`git checkout --` sur ces 4 fichiers) → les 4 sont revenus à `0.4.42` ; plus aucune trace de `0.4.43` (vérifié dans `Cargo.lock` : `grep 'version = "0.4.43"'` → vide) |
| `release-notes/v0.4.43.md` (non suivi par Git) | **mis de côté, rien supprimé** : déplacé vers **`.pilot/notes-en-suspens/v0.4.43.md`** (dossier ignoré par Git, `.gitignore:44` → `.pilot/`). Le fichier est à vous, intact, hors de `release-notes/` |
| `spec_super_agent.md` (modifié, hors périmètre demandé) | **laissé tel quel** (documentation du correctif de pulsation de la saisie, autre chantier) |

Aucune opération Git destructive : ni `reset --hard`, ni `push --force`, ni suppression d'étiquette, ni réécriture d'historique. Aucune version supérieure à 0.4.42, aucun numéro de version nouveau.
GDS : `.pilot/gds.json` → `"enabled": false` → le projet se publie sur GitHub ; la règle « pas de publication GitHub » n'est donc pas déclenchée.

---

## 1. La version réellement publiée (ce que l'updater voit)

Contrôlé **en direct** ce soir (fichiers rapatriés dans `.pilot/tmp/diag/`) :

| Élément | Valeur constatée |
|---|---|
| `https://github.com/pleveneur/pilot/releases/latest/download/latest.json` | **HTTP 200**, `version = 0.4.42`, `pub_date = 2026-10-23T13:18:10.822Z` |
| Cibles servies par l'index | `windows-x86_64` → `Pilot_0.4.42_x64-setup.exe` · `darwin-aarch64` → `Pilot_aarch64.app.tar.gz` · `darwin-x86_64` → `Pilot_x64.app.tar.gz` |
| Version de release GitHub (`v0.4.42`) | publiée `2026-10-23T12:52:37Z`, ni brouillon ni préversion, 11 fichiers attachés |
| Version gravée dans `Pilot_0.4.42_x64-setup.exe` publié | `FileVersion = 0.4.42`, `ProductVersion = 0.4.42` |
| `v0.4.43` | **n'existe pas** (ni étiquette, ni release) |

**Verdict : la publication est saine et à jour.** Ce que l'updater voit est bien 0.4.42.

## 2. Configuration de l'updater du projet, et cohérence avec le publié

| Réglage | Emplacement | Valeur | Cohérent ? |
|---|---|---|---|
| Version de l'application | `src-tauri/tauri.conf.json:4` | `0.4.42` | oui (dépôt = publié) |
| Interrupteur du greffon | `src-tauri/tauri.conf.json:58` | `"active": true` | oui |
| Adresse de contrôle | `src-tauri/tauri.conf.json:60` | `https://github.com/pleveneur/pilot/releases/latest/download/latest.json` | oui (répond 200, même contenu que l'asset) |
| Clé publique | `src-tauri/tauri.conf.json:63` | minisign `483751ABF0532005` / `Ed…` | oui |
| Fabrication des artefacts de mise à jour | `src-tauri/tauri.conf.json:8` | `createUpdaterArtifacts: true` | oui |
| Famille d'installateur retenue pour Windows | `scripts/latest-json-platforms.js` | NSIS `-setup.exe` (MSI **écarté**) | oui (l'installation réelle est NSIS, mode `currentUser`) |

**Contrôle cryptographique fait ici, pas déduit** (script Ed25519 + BLAKE2b-512 sur le fichier réellement publié, `Pilot_0.4.42_x64-setup.exe`, 64 378 169 octets) :

- identifiant de clé de la signature = identifiant de la clé publique configurée → **oui** (`052053f0ab513748`) ;
- algorithme `ED` (pré-hachée) → **signature du fichier : VALIDE** ;
- commentaire de confiance « `timestamp:1792761421 file:Pilot_0.4.42_x64-setup.exe` » → **signature de confiance : VALIDE**.

**Verdict : la chaîne « index → adresse → paquet → signature » est intègre.** Une application 0.4.41 qui contrôle et télécharge la 0.4.42 réussit le contrôle, le téléchargement et la vérification.

## 3. Écart entre la version installée du propriétaire et celle proposée

| | Version |
|---|---|
| Installée sur ce poste (`C:\Users\pldistance\AppData\Local\Pilot\pilot.exe`) | **0.4.41** (`FileVersion`/`ProductVersion`, et `HKCU\…\Uninstall\Pilot` → `DisplayVersion = 0.4.41`) |
| Proposée par l'index | **0.4.42** |
| Écart | **une version** (normal : c'est exactement la mise à jour attendue) |

L'application en cours d'exécution ce soir est la **0.4.41**, démarrée **2026-10-23 17:35:37** heure locale, soit **43 minutes après** la mise en ligne de la 0.4.42 (12:52 UTC / 16:52 local) : le contrôle différé du démarrage (10 s après le lancement, `src/js/updater.js:72`) a donc bien pu voir la 0.4.42. C'est cohérent avec « j'ai une mise à jour ».

## 4. Où la mise à jour s'arrête : la trace disque qui tranche

L'étape d'installation du greffon extrait l'installateur dans `%TEMP%\Pilot-<version>-updater-<aléa>\Pilot-<version>-installer.exe` et **ne nettoie rien**. La preuve est là pour la 0.4.41 :

```
C:\Users\pldistance\AppData\Local\Temp\Pilot-0.4.41-updater-Pj64uJ\Pilot-0.4.41-installer.exe   (61,3 Mo)
```

Or, pour la 0.4.42 :

```
> ls %TEMP% | grep -i 0.4.4
Pilot-0.4.41-updater-Pj64uJ/         (seul dossier de mise à jour présent)
```

**Aucun `Pilot-0.4.42-updater-*`.** Donc, pour la 0.4.42, le chemin d'installation (`download` → `install`, `src/js/updater.js:508`) **n'a jamais été parcouru** : personne n'a cliqué « Installer maintenant » sur un écran de mise à jour 0.4.42 — parce que cet écran ne s'est **jamais affiché**.

## 5. Pourquoi l'écran ne s'affiche jamais (cause tranchée)

La règle du propriétaire (« l'écran de mise à jour n'apparaît que sur un terrain libre ») est appliquée par une sonde **fail-closed** et n'a **aucune priorité** sur la chaîne d'agents :

1. Détection → la mise à jour est **mémorisée** puis proposée seulement si le terrain est libre : `src/js/updater.js:668` (`_pendingUpdate = update`) → `tryOpenUpdateWindow()` (`src/js/updater.js:301`).
2. Sonde « un agent travaille ? » : `src/js/main.js:275-295` → activité réelle des sessions, **bus** (`isRunInProgress`, `src/js/agents-bus.js:3377`), état des agents du projet (`isProjectAgentBusy`, `src/js/super-agent.js:6301`). Toute erreur de sonde = « du travail est en cours » (`src/js/updater.js:238-250`).
3. Réexamen seulement sur **changement d'activité** et **toutes les 10 s** (`src/js/main.js:296-305`).
4. Or la **chaîne de missions relance la mission suivante immédiatement** à la fin d'une run, dans l'unique point de passage `launchQueuedMission` (`src/js/super-agent.js:1382`), et ne cède la place qu'au **terrain réservé** (`isTerrainReserved()`, ligne 1390 ; `src/js/run-policy.js:58` = vérification du moteur `pi` **ou** écran de mise à jour **déjà** réservé). Une mise à jour **en attente** ne figure pas dans ce test : la mission suivante démarre donc avant que la mise à jour ait pu prendre la place.
5. Sur ce poste, la file de missions n'est jamais vide : `.pilot/agent-stops.log` enregistre des passes successives avec « 1 … 5 mission(s) en file » entre 13:28Z et 14:13Z, et `agent-ops.log` montre des lancements enchaînés (13:37, 13:41, 13:45, 14:00, 14:13, …). Le terrain libre est réduit à des millisecondes : **la sonde des 10 s ne tombe jamais dedans**, l'écran ne s'ouvre jamais.
6. Entre-temps le propriétaire ne voit qu'un **toast de 8 s** (`src/js/updater.js:255-272`) et une ligne de barre de statut (« ⬆ Mise à jour v0.4.42 en attente (à la fin du travail en cours) », `src/js/updater.js:273-290`) : « à la fin du travail en cours » n'arrive jamais. Le détail aggravant : `dismissModal` (`src/js/updater.js:206`) ne vide **pas** `_pendingUpdate`, si bien que l'attente reste vraie indéfiniment.

Pourquoi cela n'était-il jamais arrivé avant ? Parce que la fenêtre réservée est née dans le commit `1d05336`, **présent dans l'étiquette `v0.4.41`** (`git tag --contains 1d05336` → `v0.4.41`, `v0.4.42`). La 0.4.41 a donc été installée par la **0.4.40**, qui n'avait pas cette règle. La **0.4.42 est la première mise à jour à la subir** — et c'est celle qui ne s'installe pas.

## 6. Causes, de la plus probable à la moins probable

| # | Cause | Indice pour | Indice contre | Retenue |
|---|---|---|---|---|
| **1** | **L'écran de mise à jour est affamé** : la sonde « terrain libre » n'est jamais vraie assez longtemps (chaîne de missions relancée immédiatement, file jamais vide), et rien ne donne priorité à la mise à jour en attente | aucun `Pilot-0.4.42-updater-*` dans `%TEMP%` (l'installation n'a jamais démarré) ; file de missions non vide en continu (`agent-stops.log`) ; règle née en 0.4.41, jamais éprouvée avant | l'attente est réexaminée toutes les 10 s (mais aucun créneau libre ne dure 10 s) | **OUI** |
| 2 | Téléchargement refusé (réseau/quota GitHub) au moment du clic | l'échec produirait le même « rien ne se passe » | aucune trace d'écran ouvert ; adresse et signature vérifiées valides ; 0.4.41 avait téléchargé sans peine | non |
| 3 | Publication incohérente (index ≠ paquet, signature invalide) | — | signature **vérifiée valide** sur le paquet publié (§ 2) ; `latest.json` sain | non |
| 4 | Installateur écarté (MSI au lieu de NSIS) | a déjà cassé une mise à jour par le passé | `latest.json` ne sert qu'un NSIS `-setup.exe` (§ 1) | non |
| 5 | Aucun contrôle de mise à jour depuis le démarrage | cas 0.4.36 | contrôles récurrents ajoutés depuis ; l'application a démarré 43 min après la mise en ligne | non |
| 6 | « Plus tard » mémorisé pour 0.4.42 | `_dismissedVersion` existe (`src/js/updater.js:43`) | suppose que l'écran ait été vu au moins une fois, ce que l'absence de dossier temporaire contredit | non |

**Cause tranchée : n° 1** — l'écran de mise à jour ne prend jamais la place, parce que la chaîne de missions la reprend instantanément et que seule une réservation *déjà posée* (jamais une mise à jour *en attente*) l'arrête.

## 7. Correction minimale proposée (dans le code de Pilot)

Un seul geste, au seul endroit qui décide du départ de la mission suivante — `launchQueuedMission` (`src/js/super-agent.js:1382`), qui couvre **et** le rejeu périodique **et** le lancement direct en fin de run :

1. `src/js/updater.js` : exposer `isUpdateWaitingForGround()` = « une mise à jour attend le terrain : mémorisée, ni reportée par le propriétaire, ni en cours d'installation, écran pas encore ouvert » (`src/js/updater.js:35/43/48`, `src/js/update-window.js`).
2. `src/js/super-agent.js:1390` : le garde du point de passage devient `isTerrainReserved() || isUpdateWaitingForGround()`. Dans ce cas la mission est **remise en tête de file** (aucune perte, ordre conservé, rejeu réarmé — comportement déjà en place) **et** l'écran de mise à jour est déclenché immédiatement (`recheckPendingUpdateWindow()`), puisque le terrain est, à cet instant précis, réellement libre.

Propriétés conservées : aucun travail n'est jamais interrompu ; une mise à jour ne peut plus être affamée (elle obtient la place dès la fin de la run en cours) ; « Plus tard » rend la place et la chaîne repart (le report est mémorisé) ; aucune mission n'est perdue ; les commandes manuelles du propriétaire ne sont pas bloquées (le garde ne touche ni `canStartWork` ni `canSendManualCommand`).

Aucune version nouvelle, aucune publication : la correction partira dans la prochaine version, à la demande du propriétaire.

## 8. Ce que disent les rapports existants (et le cas d'aujourd'hui)

| Rapport | Ce qu'il traite | Couvre le cas d'aujourd'hui ? |
|---|---|---|
| `rapport-maj-non-detectee.md` | Cas 0.4.36 : **un seul** contrôle ~10 s après le démarrage, instance lancée 1 h 25 avant la publication → rien à proposer. Correctif : contrôles récurrents (6 h + retour au premier plan) | **non** (ici une mise à jour *est* proposée) |
| `rapport-p4-maj-detectee.md` | « détectée mais pas installée » côté **index** : contrôle récurrent, états distincts (« à jour » ≠ « échec »), et surtout **NSIS au lieu du MSI** (le MSI posait une seconde copie, l'ancienne version était relancée) | **non** (l'index sert bien le NSIS, signature valide) |
| `rapport-p5-fenetre-maj.md` + `rapport-maj-pilot-fenetre-reservee.md` | Mise en place de la **fenêtre réservée** : l'écran seulement sur terrain libre, réexamen automatique, files conservées | **non** — ces rapports décrivent la règle, mais pas son angle mort : une chaîne qui ne s'arrête jamais |

Aucun des trois ne couvre donc le défaut d'aujourd'hui. C'est un **quatrième** cas, distinct : ni la détection, ni l'index, ni la règle du terrain libre en soi — mais **l'absence de priorité de la mise à jour en attente sur la relance des missions**.

## 8 bis. Installer la 0.4.42 TOUT DE SUITE (l'application installée, elle, a encore l'ancien comportement)

La correction ci-dessus est dans le dépôt : elle équipera la **prochaine** version, qui reste à votre demande (aucune version nouvelle créée ici). Pour installer la 0.4.42 publiée sur ce poste, deux gestes suffisent, au choix :

- **A — laisser le terrain libre quelques secondes** : vider la file de missions du projet (🗂 tâches / file du panneau Assistant) et ne lancer aucun agent pendant ~30 s ; la fenêtre de mise à jour s'affiche d'elle-même (elle est déjà en attente), reste ouverte, et **Installer maintenant** suffit.
- **B — installer à la main** (sans attendre) : télécharger l'installateur publié, exactement celui que l'updater aurait pris, puis le lancer :
  ```
  curl -L -o "%TEMP%\Pilot_0.4.42_x64-setup.exe" https://github.com/pleveneur/pilot/releases/download/v0.4.42/Pilot_0.4.42_x64-setup.exe
  ```
  Signature **déjà vérifiée valide** dans ce rapport (§ 2). Fermer Pilot avant de lancer l'installateur.

Dans les deux cas : ne rien changer d'autre, aucune désinstallation nécessaire (installation par-dessus, mode `currentUser`).

---

## Annexe — pièces du diagnostic (dossier ignoré par Git)

| Fichier | Contenu |
|---|---|
| `.pilot/tmp/diag/latest_publie.json` | `latest.json` réellement servi par `releases/latest/download` |
| `.pilot/tmp/diag/rel.json` | liste des releases GitHub (états, dates, assets, compteurs) |
| `.pilot/tmp/diag/exe.sig` / `exe041.sig` | signatures publiées 0.4.42 / 0.4.41 |
| `.pilot/tmp/diag/setup042.exe` | installateur 0.4.42 publié (61,4 Mo) — support de la vérification Ed25519 |
| `.pilot/notes-en-suspens/v0.4.43.md` | note de version 0.4.43 mise de côté (rien supprimé) |
