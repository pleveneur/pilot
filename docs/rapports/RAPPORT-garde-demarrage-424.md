# Rapport — garde de démarrage : « l'application démarre vraiment » (tâche 424)

> **Décision du propriétaire, 16/11/2026 (#536), deux endroits :**
> 1. **on n'annonce jamais** « tu peux tester » **sans avoir lancé l'application et
>    vu son écran principal s'ouvrir** ;
> 2. **aucune fabrication de version** n'est autorisée sans **ce même contrôle**.
>
> **Règle de fer** : le contrôle est **fail-closed**. Pas de preuve, pas de
> preuve fraîche, preuve qui dit « ça n'a pas démarré », contrôle qui ne peut pas
> s'exécuter ⇒ la livraison est **refusée** et la mission est **DÉCLARÉE RATÉE**.
> Jamais un « c'est bon » par défaut.
>
> Version 0.6.27 **figée** : ce garde ne vaut que pour les livraisons **futures**.
> Aucun tag, aucune publication, aucune poussée git n'a été faite ici.
> Le **mode développement** (`npm run tauri dev`) est **hors périmètre** (son
> blocage a son propre rapport : `RAPPORT-mode-dev-blocage-demarrage.md`) ; le
> contrôle vise l'application **réellement construite**, pas le serveur Vite.

---

## 1. Ce qui existait déjà (et qui a été réutilisé)

| Élément | Rôle | Réutilisation |
|---|---|---|
| `scripts/release-gates.js` | décisions **pures** de publication, `EXIT_RELEASE_REFUSED = 2`, drapeaux `ALLOW_*` | même forme pour la nouvelle décision, même code de sortie, même style de message |
| `scripts/create-release.js` | **porte 0** (changelog obligatoire) exécutée avant toute fabrication | nouvelle **porte 0 bis** juste après, même fonction `refuse()` |
| `#boot-overlay` dans `index.html` | écran « Chargement de Pilot… » | **ne prouve rien** : il est aussi masqué par le filet de sécurité de 30 s et par le `catch` d'erreur de `main.js` |
| `#app-body` | corps de l'application | contrôle de présence **et** de taille |
| plugin `single-instance` | une seule instance de Pilot | motif du refus « Pilot est déjà ouvert » (sinon on observerait l'**ancienne** fenêtre) |
| `src-tauri/src/code_check.rs` | vérifications de code (syntaxe, lint, tests) | **non modifié** : il ne sait pas lancer l'application, c'est un autre sujet |

Rien de tout cela n'a été dupliqué : une décision, un lanceur, une porte.

## 2. Ce qui a été construit

### 2.1 `src/js/garde-demarrage.js` — les décisions, pures

Aucun DOM, aucune I/O, aucun import Tauri (même contrat que `pdf-gateway.js` /
`regles-communes-assistants.js`) : testable sans interface.

- `GARDE_DEMARRAGE_DELAI_MS = 90_000` — délai **borné** (au-delà : échec, jamais
  d'attente infinie) ; `GARDE_DEMARRAGE_SONDE_MS = 750` — cadence d'observation.
- `GARDE_DEMARRAGE_MARQUEUR = "data-pilot-pret"` — **la** marque de succès,
  posée sur `document.documentElement` par `main.js` (voir 2.3).
- `OBSERVATION_EXPRESSION` — l'expression évaluée **dans la page** : elle rend
  `{ url, etat, pret, chargementAffiche, corpsPresent, largeur, hauteur, tauri }`.
- `decideDemarrage(observation)` → `{ ok, enCours, raison }`. Un seul état est
  « en cours » (marque absente **et** écran de chargement encore affiché) ; tout
  le reste est **terminal** : écran de chargement encore là après la marque,
  corps absent, corps < 200 px, API Tauri absente, observation illisible.
- `preuveDeDemarrage(...)` / `parsePreuveDemarrage(...)` / `verdictPreuveDemarrage(...)` :
  la preuve est un **fichier JSON versionné** dans `release-notes/`
  (`demarrage-v<version>.json`), et son verdict exige **quatre** choses :
  `ok: true`, **la bonne version**, une **date lisible**, et une **fraîcheur de
  7 jours**. Tout manquement refuse la livraison et **nomme la raison**.
- `ALLOW_NO_STARTUP_PROOF` — sortie de secours explicite qui ne tolère **que
  l'absence** de preuve ; **une preuve qui dit « ça n'a pas démarré » refuse
  toujours**, même avec ce drapeau.
- `phraseEchecDemarrage` / `phraseSuccesDemarrage` — les phrases, écrites une fois.

### 2.2 `scripts/verifier-demarrage.js` — le lanceur (le seul endroit qui lance)

`npm run verif:demarrage`. Il fait cinq contrôles **avant** de lancer, puis
observe, puis **écrit la preuve** et sort en **code 2** si le contrôle est raté.

1. la version se lit (`package.json` **et** `tauri.conf.json`, cohérence exigée) ;
2. `--cdp <url>` : mode « fenêtre déjà joignable » (tests, dépannage) — le seul
   mode qui ne lance rien ;
3. plateforme sans protocole de débogage joignable en automatique ⇒ **refus**
   (macOS / Linux), avec preuve `ok:false` — jamais un succès par défaut ;
4. exécutable **introuvable** ⇒ refus (« construisez l'application puis relancez ») ;
5. **Pilot déjà ouvert** ⇒ refus (la seconde instance se refermerait aussitôt et
   le contrôle observerait l'ancienne fenêtre : faux positif).

Puis : lancement réel de l'exécutable avec
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port libre>`,
observation de la page **toutes les 750 ms** pendant **90 s au plus**, arrêt
propre de l'arbre de processus (`taskkill /T /F`), preuve écrite **dans tous les
cas** (succès comme échec). Aucun réglage de l'utilisateur n'est lu ni écrit ;
aucun fichier audio, aucun journal, aucun fichier supprimé.

### 2.3 `src/js/main.js` — la marque de succès (une seule ligne utile)

À la **fin normale** de l'initialisation, juste après le masquage de
`#boot-overlay` :

```js
document.documentElement.setAttribute("data-pilot-pret", "1");
```

Elle n'est posée **que là** — jamais dans le filet de sécurité de 30 s, jamais
dans le `catch`. L'écran de chargement peut donc être masqué « à tort » sans que
le garde s'y trompe : c'est la **marque** qui fait foi.

### 2.4 `scripts/create-release.js` — la porte de livraison (endroit 2 de la décision)

**Porte 0 bis**, exécutée **après** le changelog obligatoire et **avant** que la
GitHub Release existe (donc avant les trois fabrications) :

```js
const demarrageDecision = verdictPreuveDemarrage({ preuve, version, allowMissing });
if (!demarrageDecision.livrer) refuse(demarrageDecision.raison);   // code 2
```

Conséquences directes :
- une version dont on n'a **pas vu** l'application démarrer ne part pas ;
- une preuve **ratée** ne part pas, même avec `ALLOW_NO_STARTUP_PROOF=1` ;
- une preuve d'une **autre version** ou **périmée** ne part pas ;
- le refus est **net** (code 2 + `::error::` dans le résumé du run), jamais un
  avertissement silencieux.

## 3. Comment lancer le contrôle (poste du propriétaire, Windows)

```bash
# 1. construire l'application de la version à livrer
npm run tauri build

# 2. fermer Pilot (sinon le contrôle refuse : une seule instance)
# 3. lancer le contrôle : il lance Pilot, regarde l'écran, écrit la preuve
npm run verif:demarrage
#    → release-notes/demarrage-v<version>.json   (ok:true)
#    → sortie 2 + phrase « mission DÉCLARÉE RATÉE » sinon

# variantes utiles
node scripts/verifier-demarrage.js --exe "C:/Users/.../Pilot/pilot.exe"   # exe installé
node scripts/verifier-demarrage.js --delai 30000 --json                  # délai + preuve affichée
node scripts/verifier-demarrage.js --cdp http://127.0.0.1:9222           # fenêtre déjà ouverte
```

Le fichier de preuve **se committe** avec le bump : c'est lui que la chaîne de
publication lit à partir du tag (le job `create-release` tourne sur Ubuntu et
n'a besoin d'aucune fenêtre : il lit la preuve fabriquée sur le poste).

## 4. Tests ajoutés (ils échouent si le garde redevient permissif)

| Fichier | Tests | Ce qu'ils interdisent |
|---|---|---|
| `src/js/garde-demarrage.test.js` | 20 | observation absente / illisible / encore en cours / corps trop petit / sans API Tauri ⇒ **jamais** un succès ; preuve absente, illisible, **ratée**, d'une autre version, périmée, sans date ⇒ **refus** ; la tolérance ne couvre **que** l'absence ; la marque du module et celle écrite par `main.js` sont **le même texte** |
| `scripts/verifier-demarrage.test.js` | 5 | exécute le **vrai** lanceur : exe introuvable ⇒ code 2 + preuve `ok:false` ; fenêtre simulée (protocole de débogage réel, aucun écran) ⇒ code 0 **seulement** si l'écran principal est ouvert ; resté sur l'écran de chargement ⇒ code 2 à la fin du délai **borné** ; chargement encore affiché malgré la marque ⇒ code 2 ; API Tauri absente ⇒ code 2 |
| `scripts/garde-demarrage-chaine.test.js` | 6 | la **chaîne** appelle vraiment la décision unique, **avant** tout appel réseau ; le refus passe par `refuse` ; la commande `npm run verif:demarrage` existe ; la preuve vit dans un dossier **versionné** (non ignoré par git) |

Entrée de registre : **n° 34** de `spec_registre_comportements_valides.md`.

## 5. Preuves mesurées sur cette machine (18/11/2026)

L'application installée est `C:\Users\pldistance\AppData\Local\Pilot\pilot.exe`
(version 0.6.27), **ouverte pendant la mission** ; aucun `src-tauri/target`
(release) n'existe dans le dépôt.

**a) Exécutable introuvable — refus, preuve ratée, code 2**

```
ÉCHEC DU CONTRÔLE DE DÉMARRAGE : l'exécutable à lancer est introuvable
(« Z:\nulle\part\pilot.exe ») : construisez l'application puis relancez.
La mission est DÉCLARÉE RATÉE — rien n'est annoncé testable.
Preuve écrite : .pilot/tmp/preuve-test.json
exit=2
```

**b) Pilot déjà ouvert — refus, code 2, rien n'a été lancé**

```
ÉCHEC DU CONTRÔLE DE DÉMARRAGE : Pilot est déjà ouvert (processus « pilot.exe ») :
une seconde instance se refermerait aussitôt et le contrôle observerait l'ancienne
fenêtre — fermez Pilot puis relancez le contrôle.
La mission est DÉCLARÉE RATÉE — rien n'est annoncé testable.
exit=2
```

**c) Fenêtre qui répond « je suis prête » — succès, code 0, preuve écrite**
(fenêtre simulée par le protocole de débogage, aucun écran nécessaire : `--cdp`)

```
L'application a été lancée et son écran principal est ouvert en 0 s — version 0.6.27.
exit=0
{ "ok": true, "raison": "l'écran principal est ouvert", "version": "0.6.27",
  "at": "2026-11-18T03:51:48.166Z", "duree_ms": 21, "delai_ms": 5000,
  "observation": { "pret": true, "chargementAffiche": false, "corpsPresent": true,
                   "largeur": 1280, "hauteur": 860, "tauri": true } }
```

**d) Fenêtre muette — refus, code 2** (le faux serveur de test ne répondait pas) :

```
ÉCHEC DU CONTRÔLE DE DÉMARRAGE après 5 s : la fenêtre a répondu une erreur :
la fenêtre n'a pas répondu à temps. La mission est DÉCLARÉE RATÉE
```

**e) La porte de publication refuse pour de vrai (aucune preuve de la 0.6.27)**

```
$ GITHUB_TOKEN=dummy node scripts/create-release.js v0.6.27 owner/repo
✗ aucune preuve de démarrage pour la version 0.6.27 (release-notes/demarrage-v0.6.27.json) :
  l'application n'a pas été vue démarrer, la mission est DÉCLARÉE RATÉE. Lancez
  « npm run verif:demarrage » et committez la preuve, ou assumez l'absence avec
  ALLOW_NO_STARTUP_PROOF=1
exit=2
```

**f) La sortie de secours ne couvre que l'ABSENCE, et elle est dite**

```
$ GITHUB_TOKEN=dummy ALLOW_NO_STARTUP_PROOF=1 node scripts/create-release.js v0.6.27 owner/repo
↷ aucune preuve de démarrage, tolérée explicitement (ALLOW_NO_STARTUP_PROOF)
Error: GET release 401: Bad credentials        ← l'appel réseau vient APRÈS la porte
```

**g) Suites**
`npx vitest run src/js/garde-demarrage.test.js scripts/verifier-demarrage.test.js scripts/garde-demarrage-chaine.test.js src/js/registre-comportements-valides.test.js`
⇒ **41 tests passés** (20 + 5 + 6 + 10) ; suite front complète `npm test` ⇒ **6128 tests passés** (335 fichiers) ;
suite Rust `cargo test --manifest-path src-tauri/Cargo.toml --lib` ⇒ **990 passés, 0 échec** (aucun fichier Rust
touché : c'est la confirmation d'absence de régression).

## 6. Ce qui reste (assumé, et daté)

1. **La première preuve réelle** de la version suivante ne peut pas être
   fabriquée aujourd'hui : Pilot 0.6.27 est **ouvert**, aucun binaire release
   n'existe dans le dépôt, et la 0.6.27 est **figée** (aucune republication).
   Geste à faire au prochain numéro de version : fermer Pilot,
   `npm run tauri build`, `npm run verif:demarrage`, committer
   `release-notes/demarrage-v<version>.json` avec le bump. **Sans ce fichier, la
   publication est refusée** — c'est exactement l'effet voulu.
2. **Endroit 1 de la décision (l'annonce)** : « on n'annonce jamais *tu peux
   tester* sans avoir lancé l'application » demande de porter la règle dans la
   consigne des assistants (là où vivent déjà les deux règles communes) et de
   signaler une annonce non prouvée. Ce n'est **pas** dans ce lot : sujet **daté**
   côté suivi — **tâche 428**, échéance **2026-11-21**, porteur : l'agent codeur de
   Pilot (règle 2 : aucun sujet validé ne disparaît faute de date). Le garde
   fournit déjà la **preuve mécanique** que l'annonce devra citer.
3. **macOS / Linux** : le protocole de débogage n'est pas joignable en
   automatique ⇒ le lanceur **refuse** honnêtement sur ces plateformes (aucun
   faux succès). Une preuve **fabricable** sur ces systèmes demanderait un autre
   mécanisme (marque écrite par l'application dans un fichier au démarrage) —
   sujet distinct, non ouvert ici.

## 7. Ce que ce garde ne fait pas

- Il ne **remplace** pas les tests : il ajoute la seule chose qu'aucun test ne
  sait dire — *l'application réelle s'ouvre*.
- Il ne répare **pas** le mode développement bloqué (sujet séparé).
- Il ne touche **aucun réglage**, ne supprime **aucune donnée**, ne lance rien
  sans le dire (la preuve écrite nomme l'exécutable et la durée).
- Il ne rend jamais l'absence de contrôle « acceptable » par défaut : la seule
  tolérance est `ALLOW_NO_STARTUP_PROOF=1`, elle est **explicite**, **journalisée**
  en avertissement, et **impuissante devant une preuve ratée**.
