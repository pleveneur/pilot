# Rapport de relecture — deux commits locaux avant la prochaine version

Date : 2026-10-21
Portée : `e711bf7` (file de missions : fenêtre de course du rejeu) et `4020ccb`
(contrôle récurrent des mises à jour + index Windows), relus **sur le code réel**
et sur les **différences réelles**, pas sur les rapports des agents.
**Aucun** fichier de code, de test ou de documentation n'a été modifié par cette
relecture ; aucun commit, tag, push ni changement de version. Seul ce rapport est
écrit.

---

## 0. État du dépôt vérifié

| Élément | Constaté |
|---|---|
| `git log v0.4.36..HEAD` | 3 commits : `3f6f817` (docs, **déjà sur `origin/main`**), `e711bf7`, `4020ccb` |
| `git rev-list --count origin/main..HEAD` | **2** commits locaux non poussés (ceux de la mission) |
| Tag `v0.4.36` | `e151a1e`, « chore(version) » |
| `git status --short` | aucun fichier suivi modifié ; 2 fichiers **non suivis** : `geminiReport.md`, `rapport-maj-non-detectee.md` |
| Périmètre `e711bf7` | `src/js/super-agent.js` (+118/−6) + `src/js/file-attente-fenetre-rejeu.test.js` (nouveau, 294 l.) + rapport |
| Périmètre `4020ccb` | `src/js/updater.js` (+138/−11), `src/js/main.js` (+12/−1), `scripts/gen-latest-json.js`, `scripts/latest-json-platforms.js` (nouveau), 2 tests, `AGENTS.md`, `spec_pilot.md`, `help/overview.md`, `help/handbook.md` |

Les deux fichiers non suivis ne partiront pas avec le prochain tag (non bloquant,
mais ils seront perdus si on ne les commite ni ne les supprime pas).

---

## 1. `e711bf7` — réservation du créneau au défilement de la file

### Ce que fait réellement le code

| Élément | Emplacement | Effet constaté |
|---|---|---|
| `MISSION_CLAIM_MAX_MS = 60_000` | `super-agent.js` ~473 | borne de validité d'une réservation |
| `runAgentsMissionClaimByProject` | ~476 | `Map` clé projet → `[{label, at}]` |
| `claimDequeuedMission()` | 656 | pose la réservation, **appel synchrone** dans `launchQueuedMission` (1147) — aucune interruption `await` entre le défilement et la réservation |
| `pendingMissionClaims()` | 631 | ignore les réservations de plus de 60 s |
| `pendingMissionsAhead()` | 611-616 | `file + réservations` ; `opts.dequeue === true` → **0 réservation** comptée |
| `releaseClaim()` | 1147-1181 | `result.then(() => releaseClaim(), onFailure)` **puis** `releaseClaim()` dans le `finally`-like |
| `launchQueuedMission` | 1140-1190 | try/catch : en cas d'échec, la mission est **remise en tête** de file, le projet est libéré, le rejeu est réarmé, puis la réservation est rendue |
| `replayQueuedMissionForProject` | ~1076-1098 | juge sur `isAdmissionFree` / `isRunStillActive`, **fail-closed** en cas d'erreur (`free = false`), prend **une** tête de file, appelle la version protégée |

### La réservation est-elle toujours rendue ?

| Issue | Réservation rendue ? | Preuve |
|---|---|---|
| Démarrage réussi | **Oui** | `onStart` → la promesse rendue par `launchRun` se résout → `then` → `releaseClaim` (1179) |
| Échec **rejeté** (exception, RPC en erreur) | **Oui** | `onFailure` remise en file + `releaseClaim` (1179) + `releaseClaim()` de secours (1181) |
| Exception **synchrone** avant la promesse | **Oui** | try/catch 1140-1190 : libère la réservation, remet la mission en tête |
| Promesse qui **ne se résout jamais** | **Non immédiatement**, mais **au plus tard après 60 s** | `pendingMissionClaims` filtre `at` trop ancien |
| `launch` qui résout `{queued:true}` (re-queue interne) | **Oui** | `then` s'exécute ; la mission est en file, la réservation tombe |

**Verdict : la réservation est rendue sur toutes les issues observables** (succès,
échec, exception, re-queue). Le seul cas où elle survit est la promesse perdue, et
elle **expire** alors en 60 s.

### Une réservation perdue peut-elle bloquer la file pour toujours ?

**Non**, pour deux raisons indépendantes :

1. **Expiration** (60 s) — au-delà, `pendingMissionClaims` ne la compte plus.
2. **Le rejeu ignore les réservations** (`opts.dequeue = true` → 0 réservation
   comptée), donc une mission déjà en file repart **sans attendre** la disparition
   d'une réservation orpheline.

Une demande qui arrive **pendant** la fenêtre est mise en file (`admission.queue`)
**et** le rejeu est réarmé à cet instant : elle démarre au plus tard dans les 15 s
suivant la libération réelle du projet. Aucun blocage permanent possible.

### Couverture des tests (`file-attente-fenetre-rejeu.test.js`, 10 tests)

| Exigence | Couvert ? |
|---|---|
| Demande arrivant pendant l'enregistrement du bus → mise en file derrière | **Oui** (motif `queue-ahead`) |
| Ordre d'exécution réel : `[rejouée, arrivée]` | **Oui** |
| Réservation libérée à la conclusion, **et sur échec** | **Oui** |
| La mission rejouée n'est pas bloquée par **sa propre** réservation | **Oui** |
| Expiration d'une réservation périmée | **Oui, mais partiellement** : test unitaire avec horodatage injecté ; **aucun test** de bout en bout « promesse qui ne se résout jamais » (simulé) |
| Une seule pose de réservation dans le code source | **Oui** (assertion sur le source) |

**Verdict du point : sain.** Deux réserves mineures, non bloquantes :
(1) la borne de 60 s est une valeur de jugement — un démarrage très lent
(spawn de `pi`, initialisation MCP sur machine froide) pourrait l'atteindre ; la
conséquence est alors une **dégradation silencieuse vers l'ancien comportement**
(fenêtre rouverte), jamais un blocage : acceptable ; le cas d'expiration **de bout
en bout** n'est pas prouvé par un test.
(2) deux réservations peuvent coexister brièvement (libération de la précédente
en microtâche) → le message « N demandes attendent déjà » peut annoncer 1 de trop.
**Cosmétique uniquement** (les réservations ne servent qu'à l'admission et aux
libellés, jamais à un refus).

---

## 2. `4020ccb` — contrôle récurrent des mises à jour

Constats sur `src/js/updater.js` :

- `_checking` (ligne 313) : **anti-rebond unique**, `return` immédiat si un
  contrôle est en cours → **deux contrôles simultanés sont impossibles**, y
  compris entre le contrôle manuel (palette) et un contrôle de fond. Preuve :
  `updater-refresh.test.js` (7 tests), dont l'assertion de non-chevauchement.
- `_scheduled` (365) : `initUpdater()` est **idempotent** → un double appel
  (main.js ligne 350 + un futur appel) ne programme **pas** deux jeux de
  minuteries. Couvert par test.
- Rythme : premier contrôle à 10 s, puis `setInterval(checkSilently, 6 h)` **et**
  contrôle sur `focus` / `visibilitychange` (ignoré si `visibilityState ===
  "hidden"`).
- Application ouverte plusieurs jours : le contrôle périodique suffit, et le
  retour au premier plan rattrape le cas où Chromium aurait fortement ralenti la
  minuterie d'un onglet minimisé. **Non prouvé** : je n'ai pas mesuré le
  comportement réel du minuteur 6 h dans WebView2 fenêtre réduite sur plusieurs
  heures ; le dispositif `focus` rend la question sans conséquence pratique.
- État du dernier contrôle : `_lastCheck = { at, outcome, detail, lastSuccessAt }`
  — **purement en mémoire**, donc **perdu au rechargement de l'interface**
  (`Ctrl+R` en dev, rechargement de la WebView). Le message d'absence est
  honnête (« aucun contrôle effectué **depuis le démarrage** de Pilot »), donc
  pas de mensonge à l'utilisateur. **Acceptable, à documenter.**
- Clarté pour un utilisateur non technique : `formatLastCheckStatus()` distingue
  trois phrases sans ambiguïté — « aucun contrôle effectué depuis le démarrage »,
  « le JJ/MM/AAAA à HH:MM — Pilot est à jour », « **échec** le … (**cause**) —
  Pilot n'a donc **PAS** pu savoir si une nouvelle version existe. Dernier
  contrôle réussi : le … ». C'est **clair et daté**, et l'échec n'est plus
  confondu avec « à jour ». Le texte est **correct**.

### Défauts réels trouvés dans ce commit

1. **[Moyen]** La modale **revient** à chaque contrôle, y compris après « Plus
   tard » / ✕ : `closeModal()` (152-154) ne mémorise **rien**, et
   `checkForUpdate` appelle `showUpdateModal(update)` **sans condition** dès que
   `update.available` (ligne ~327). Conséquence **nouvelle** (impossible avant,
   puisqu'il n'y avait qu'un seul contrôle au démarrage) : après une publication,
   un utilisateur qui clique « Plus tard » voit la modale **se réafficher à chaque
   retour sur la fenêtre Pilot** (`focus`), et chaque réaffichage relance en plus
   `enrichWithHistory` (appel réseau supplémentaire).
2. **[Moyen]** Un contrôle de fond **pendant une installation** réinitialise la
   modale : `showUpdateModal` remet `installBtn.disabled = false` et masque la
   progression (191-199), et `installUpdate` n'a **aucun** garde de réentrance
   (`_installing` absent). Un second clic sur « Installer maintenant » lance une
   **seconde** installation en parallèle (`downloadAndInstall` deux fois). La
   fenêtre est étroite, mais elle est **créée** par le contrôle récurrent.
3. **[Faible]** Durée de toast **silencieusement ignorée** : `toastInfo` /
   `toastError` (`toast.js` 77-80) n'acceptent qu'un message →
   `toastInfo(label, 8000)` et `toastError(label, 9000)` (`main.js` 231-234)
   affichent 3 s / 6 s. Les messages d'état étant **longs** (date + cause +
   dernier succès), 3 s est court.
4. **[Faible]** « Vérifier les mises à jour » **sans effet visible** si un contrôle
   silencieux est déjà en cours : `_checking` → `return` immédiat, aucun message.
   L'utilisateur peut croire la commande cassée.
5. **[Faible]** Aucun **intervalle minimal** entre contrôles de premier plan : un
   aller-retour répété de fenêtres (`Alt+Tab`) produit N requêtes réseau.
6. **[Info]** Commentaire **périmé** `updater.js` 142-143 : « la MAJ reste
   disponible via la commande palette « check-update » **jusqu'au prochain
   démarrage** » — faux depuis le contrôle récurrent (elle est reproposée d'elle-même).
7. **[Info]** `describeCheckError` : la classe `/40[13]/` classe « accès refusé »
   tout message contenant `401`/`403` **n'importe où**, y compris « 4013 ».
   Risque de faux positif très faible.

**Verdict du point : le mécanisme (rythme, anti-rebond, idempotence, message daté,
distinction échec/à jour) est correct et prouvé par tests. Deux défauts d'ergonomie
introduits par le rythme récurrent doivent être corrigés (points 1 et 2).**

---

## 3. `4020ccb` — `scripts/gen-latest-json.js` / `latest-json-platforms.js`

| Question | Réponse étayée |
|---|---|
| Correct dans les **deux ordres** d'arrivée ? | **Oui.** `platformFromBinaryName()` renvoie `null` pour tout `.msi` (MSI → jamais `windows-x86_64`), et le générateur écarte explicitement le MSI **avant** d'attribuer la clé (`gen-latest-json.js:309-321`, `nbSkipped++` + journal). Comme la clé n'est plus jamais écrasée par le MSI, **l'ordre des assets est sans effet**. `scripts/gen-latest-json-platforms.test.js` rejoue l'indexation dans **les deux ordres** → toujours le `-setup.exe`. |
| MSI **seul** présent ? | Aucune entrée `windows-x86_64` (pas de repli silencieux vers le MSI), log + `::warning::`, **code de sortie 0** → `latest.json` est publié **sans** Windows. C'est le comportement voulu (« pas de repli silencieux »), mais un **avertissement seul** ne bloque pas la release : à surveiller. |
| Autres plateformes inchangées ? | **Oui**, testé : `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64` identiques ; `.dmg`/`.deb`/`.rpm` toujours ignorés. |
| Le diagnostic est-il réel ? | **Oui, prouvé sur l'index publié** : `releases/latest/download/latest.json` de `v0.4.36` contient `windows-x86_64 → Pilot_0.4.36_x64_en-US.msi`, alors que la release contient bien `Pilot_0.4.36_x64-setup.exe` **et** son `.sig`. Le MSI **est** produit par la release (`wix: null` dans `tauri.conf.json` n'empêche pas `tauri-action` de le fabriquer) : le défaut était donc réel et touchait tous les utilisateurs Windows. |
| Fidélité du test | Réserve : le test rejoue une **boucle simplifiée** (sans le garde `isExcludedWindowsInstaller` ni le compteur) ; il prouve le **mapping**, pas le générateur. Le garde du générateur est **redondant** avec le mapping (sans danger). Aucun test n'exécute `gen-latest-json.js` lui-même. |

**Verdict du point : correct et suffisant.** À vérifier **après** la publication :
`windows-x86_64` doit pointer sur `…-setup.exe` dans le nouvel index.

---

## 4. Cohérence avec ce qui est déjà publié en 0.4.36

| Point à ne pas casser | Constat |
|---|---|
| File de missions non détruite à l'arrêt d'agent | **Intact** : `abandonQueuedDelegations` ne concerne que les délégations ; `e711bf7` n'y touche pas |
| Ordre d'arrivée | **Renforcé**, pas cassé : une demande arrivant pendant la fenêtre se place **derrière** (`queue-order-respected`) |
| Identité de projet (une seule identité quelle que soit l'écriture du chemin) | **Intact** : les réservations utilisent la **même** clé normalisée (`inFlightKey`) que la file |
| Arrêt automatique / verrous / anomalies | **Intact** : aucun fichier concerné |
| Documentation intégrée | **Cohérende** : `help/overview.md` (bloc `HELP:pilot-update`) annonce « premier contrôle peu après l'ouverture, puis **toutes les 6 h** et à **chaque retour au premier plan** », la palette « Vérifier les mises à jour » **et** « État des mises à jour » avec résultat **daté** et distinction échec/à jour — c'est exactement le code. `help/handbook.md` (généré) reprend le même texte ; `spec_pilot.md` § Mises à jour décrit le rythme, l'anti-rebond et « paquet proposé = type d'installation réel ». Aucune fréquence ni aucun format **faux** dans l'aide. |
| Format annoncé à l'utilisateur | L'aide ne cite **aucun** format de paquet (rien à corriger) ; `README.md` indique bien `Pilot_<version>-x64-setup.exe`, ce que le correctif rend enfin vrai pour la mise à jour automatique |
| Commentaire interne | **Périmé** (`updater.js` 142-143), cf. § 2 point 6 |

---

## 5. Mesures exactes

| Commande | Résultat |
|---|---|
| `npm test` (suite frontend complète) | **PASS (2115) — FAIL (0)**, sur **127 fichiers** de test (122 dans `src/js`, 5 dans `scripts`) |
| `npx vitest run scripts/gen-latest-json-platforms.test.js` | **PASS (7) — FAIL (0)** |
| `npm run build` | **code de sortie 0** ; `dist/` produit ; seuls avertissements : taille de chunk > 500 kB et imports dynamiques inutilisés (non bloquants) |
| Contrôle réseau de l'index publié | `latest.json` v0.4.36 : 3 cibles seulement — `windows-x86_64` → **MSI**, `darwin-aarch64`, `darwin-x86_64` |

**Observation hors périmètre (pré-existante, à traiter séparément)** : l'index
publié de `v0.4.36` **et** celui de `v0.4.35` ne contiennent **aucune** cible
`linux-x86_64`, et les deux releases **n'attachent aucun artefact Linux**
(pas d'AppImage). Les utilisateurs Linux ne reçoivent donc aucune mise à jour.
Ce n'est **pas** causé par ces deux commits, mais la prochaine publication
reproduira le même trou si la chaîne de build Linux n'est pas regardée.

---

## 6. À corriger avant publication, par gravité

**Bloquant (2)**

1. **[Moyen-fort] La modale de mise à jour revient malgré « Plus tard ».**
   `updater.js` 142-154 (aucune mémorisation du refus) + `checkForUpdate` (~327,
   `showUpdateModal` inconditionnel). Correctif minimal : mémoriser
   `_dismissedVersion` au clic « Plus tard » / ✕ et ne réafficher que si
   `update.version !== _dismissedVersion` ; test associé.
2. **[Moyen] Contrôle de fond pendant une installation → modale réinitialisée,
   seconde installation possible.** `showUpdateModal` 191-199 remet
   `installBtn.disabled = false` ; `installUpdate` 206 n'a aucun garde de
   réentrance. Correctif minimal : `_installing` + sortie immédiate de
   `showUpdateModal`/`installUpdate` si vrai (ou ne pas rafraîchir une modale
   visible pendant l'installation).

**Recommandé (3)**

3. **[Faible] Durées de toast ignorées** : remplacer `toastInfo(x, 8000)` /
   `toastError(x, 9000)` par `showToast(x, "info", 8000)` / `showToast(x, "error", 9000)`
   (`main.js` 231-234, `updater.js` 331, 349, 242).
4. **[Faible] Contrôle manuel muet si un contrôle est déjà en cours** :
   informer « contrôle déjà en cours » au lieu de ne rien faire (`_checking`).
5. **[Faible] Intervalle minimal entre contrôles de premier plan** (ex. 5 min)
   pour éviter N requêtes sur des `Alt+Tab` répétés.

**Informatif (4)**

6. Commentaire périmé `updater.js` 142-143 (« jusqu'au prochain démarrage »).
7. État du dernier contrôle **en mémoire** (perdu au rechargement) — à écrire
   noir sur blanc dans la doc, ou à persister si l'on veut survivre au rechargement.
8. `/40[13]/` dans `describeCheckError` : classification trop large.
9. Test d'indexation qui rejoue une boucle simplifiée (prouve le mapping, pas le
   générateur) ; garde du générateur redondant avec le mapping.

**Non prouvé (assumé)**

- Durée réellement écoulée avant le déclenchement du minuteur 6 h dans une fenêtre
  WebView2 réduite pendant plusieurs jours (le dispositif `focus` couvre le cas).
- Cas de bout en bout d'une réservation dont la promesse ne se résout **jamais**
  (seule l'expiration unitaire est testée).

---

## 7. Verdict

Les deux corrections sont **techniquement saines** : la fenêtre de course du
rejeu est fermée sans risque de blocage durable (réservation bornée à 60 s et
ignorée par le rejeu), et l'index Windows sert enfin l'installateur réellement
installé — défaut **confirmé sur l'index publié** de `v0.4.36`. Aucune régression
constatée sur la file de missions, l'ordre d'arrivée, l'identité de projet, les
arrêts automatiques ni la documentation d'aide. Suite complète verte
(**2115/0**) et build **exit 0**.

Le contrôle récurrent introduit toutefois **deux défauts d'usage** qui toucheront
tous les utilisateurs dès cette prochaine version : la modale qui revient à chaque
retour sur Pilot après un « Plus tard », et la réinitialisation de la modale (donc
une seconde installation possible) si un contrôle tombe pendant le téléchargement.
Les deux se corrigent en une dizaine de lignes avec un test.

**Verdict : NON PUBLIABLE en l'état** — corriger les points **1 et 2** du § 6
(les points 3 à 5 sont recommandés, les autres sont documentaires), puis relancer
`npm test` et `npm run build` avant de bumper et de taguer.
