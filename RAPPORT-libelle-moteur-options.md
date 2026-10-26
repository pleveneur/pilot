# Rapport — le libelle du moteur dans les Options

> Mission : un libelle affiche nommait le moteur en cours (« Agent Pi ») alors
> qu'il etait fige, donc il mentait a un utilisateur de PLh. Le bandeau du haut,
> lui, suivait deja le moteur reel.

## Etat AVANT

- `index.html` (~ligne 499) : le bouton d'onglet des Options
  `data-settings-tab="agent"` portait le texte **ecrit en dur** « Agent Pi ».
  Un utilisateur de PLh y lisait « Agent Pi » alors que son moteur est
  « Agent PLh » — c'etait le seul libelle de l'interface qui pretendait nommer
  le moteur en cours en restant fige.
- Le mecanisme correct existait deja, sans seconde source : `agentDisplayLabel()`
  dans `src/js/backend-info.js` (alimentee par la sonde Rust `get_backend_info`,
  re-sondee a chaque evenement `pilot-backend-changed`). Le bandeau du haut
  l'utilise dans `main.js` (sous-titre `#project-engine` :
  « Moteur · Agent Pi » / « Moteur · Agent PLh »).
- Les 5 marches a suivre de la prise en main (`src/js/onboarding.js`)
  renvoyaient vers cet onglet en l'appelant « Agent Pi » : meme mensonge pour un
  utilisateur de PLh, et incoherence garantie une fois l'onglet renomme.

## Etat APRES

- `index.html` : le libelle de l'onglet vit dans un element dedie
  `<span id="settings-tab-agent-label">Agent Pi</span>` (le texte initial est le
  defaut de `agentDisplayLabel()`, avant la premiere sonde). Identifiants et
  classes inchanges : `settings-tab`, `data-settings-tab="agent"`, icone
  `data-lucide="bot"`.
- `src/js/main.js` : la fonction deja branchee sur `pilot-backend-changed`
  (`syncEngineSubtitle`, conservee telle quelle — le verrou existant
  `lot2-colonne-haut.test.js` l'exige) rafraichit **aussi**
  `#settings-tab-agent-label` avec `agentDisplayLabel()`. Une seule source, un
  seul branchement, aucune seconde methode : la valeur suit donc chaque re-sonde
  pi <-> plh et chaque changement de configuration (`pilot-config-changed`
  declenche `refreshBackendInfo()`).
- `src/js/onboarding.js` : `onboardingEngineReport` recoit un parametre optionnel
  `optionsLabel` et compose la marche a suivre « ⚙️ Options → « <libelle> » ».
  Le site d'appel passe `agentDisplayLabel()` : la marche a suivre nomme l'onglet
  tel qu'il est reellement affiche. Repli : « Agent Pi » (le defaut de la source).

## Liste COMPLETE des occurrences de « Agent Pi » examinees

### Corrigees (2 endroits — celles qui mentaient)

| Fichier | Nature | Traitement |
|---|---|---|
| `index.html:499` | libelle **affiche** de l'onglet des Options | libelle porte par `#settings-tab-agent-label`, rempli par `agentDisplayLabel()` |
| `src/js/onboarding.js` (5 chaines affichees) | marches a suivre « ⚙️ Options → « Agent Pi » » | composees avec le libelle reel (`optionsLabel`), repli « Agent Pi » |

### Deja correctes — non touchees

| Fichier | Pourquoi |
|---|---|
| `src/js/backend-info.js:69-70` | **source unique** du libelle (`agentDisplayLabel` / `agentDisplayPhrase`), avec son defaut « Agent Pi » avant la premiere sonde. C'est la reference, pas une copie. |
| `src/js/onboarding.js` `engineLabel()` | rend deja « L'agent PLh » quand `kind === "plh"`. Correct (doublon de logique signale plus bas). |
| `main.js:873,1195`, `tabs.js` (204, 570, 612, 629, 683, 2354, 2363), `sidebar.js:337,958`, `agent-pi.js:8623`, `prompt-builder.js:330`, `session-persistence.js:253` | tous passent par `agentDisplayLabel()` / `agentDisplayPhrase()` : deja dynamiques (onglet π, barre d'etat, menus). |

### Figees VOLONTAIREMENT — non touchees (avec la raison)

| Fichier | Pourquoi je n'y touche pas |
|---|---|
| `index.html:707` — titre de section « Agent **Pi ou PLh** » | nomme les **deux** moteurs possibles (quel que soit celui en service) : il ne pret en d aucune seconde d'etre le moteur en cours, il decrit la section « gestion RPC de l'agent pi ou plh ». |
| Commentaires de code : `agent-pi.js:1,250,8619`, `tabs.js:216,288,506,2361`, `sidebar.js:942`, `orchestration.js:4`, `prompt-builder.js:329`, `src/css/style.css:3207` | jamais affiches a l'utilisateur. |
| `help/overview.md`, `help/handbook.md` (8 mentions de l'onglet) | **documentation d'aide embarquee : interdite par la mission** (une autre mission travaille dessus). A faire suivre dans une autre mission : ces marches a suivre citent l'onglet « Agent Pi », elles devraient dire « l'onglet de l'agent » ou suivre le libelle dynamique. |
| `docs/proposition-navigation.md`, `docs/proposition-presentation-ui.md`, `docs/bug-report-super-agent.md`, `AGENTS.md` | documents de travail / de projet, pas l'interface. |
| Tests existants (`backend-info.test.js`, `session-persistence.test.js`, `super-agent-delegation-tab.test.js`, `lot2-colonne-haut.test.js`, `thinking-levels-wiring.test.js`, `context-engine.test.js`) | titres de tests et jeux d'essai, pas l'interface. |
| `dist/index.html` (artefact de build, regenere par `npm run build`), `.pilot/_goldtmp/**` (copies d'or), `.pilot/mesure/style.orig.css`, `.pilot/tests/**` | artefacts / materiel d'analyse, pas l'interface servie. |

## Fichiers touches

- `index.html` (libelle de l'onglet des Options + un commentaire d'intention)
- `src/js/main.js` (2 instructions ajoutees dans `syncEngineSubtitle`)
- `src/js/onboarding.js` (import de `agentDisplayLabel`, parametre `optionsLabel`, 5 chaines)
- `src/js/libelle-moteur-options.test.js` (**nouveau** verrou de 5 tests)
- `RAPPORT-libelle-moteur-options.md` (ce rapport)

Aucun autre fichier n'a ete modifie. En particulier : **aucun fichier Rust**, aucun
plan editable, aucune documentation d'aide embarquee, aucun style (largeur de
colonne 280 px, hauteur de bande 48 px et coin haut droit **intacts**), aucun
reglage ni bouton ajoute, aucun rapport existant supprime, aucun numero de
version change.

## Verrou ajoute (il doit rougir si le libelle redevient fige)

`src/js/libelle-moteur-options.test.js` — 5 tests :

1. le libelle de l'onglet vit dans `#settings-tab-agent-label` et n'est **pas**
   un texte nu dans le bouton ;
2. `main.js` le rafraichit depuis `agentDisplayLabel()`, dans la fonction
   `syncEngineSubtitle` **deja** branchee sur `pilot-backend-changed` ;
3. plus aucun « Agent Pi » en dur dans les chaines de `onboarding.js`
   (commentaires exclus ; seul le repli est tolere) ;
4. la marche a suivre suit le libelle fourni (cas PLh : dit « Agent PLh », ne
   dit plus « Agent Pi ») pour les 4 cas d'erreur ;
5. sans libelle fourni, la marche a suivre reste lisible (repli).

**Preuve que le verrou mord** : le libelle a ete remis en dur temporairement dans
`index.html`, le test a **rougi**, puis le fichier a ete restaure a l'identique
(md5 `c9819973461dbf8310da3551a2ec86b9` avant et apres — verifie).

## Resultat des tests et de la compilation (comptes reels)

| Verification | Avant | Apres |
|---|---|---|
| `npm test` | 188 fichiers, **3278 tests passes**, 0 echec | 189 fichiers, **3283 tests passes**, 0 echec |
| `npm run build` | — | **reussi** (avertissements Vite prealables sur les imports dynamiques et la taille de chunk, inchanges) |

`grep "settings-tab-agent-label" dist/index.html` apres build : present.

## Ce qui reste a faire

1. **Documentation d'aide embarquee** (`help/overview.md`, `help/handbook.md`) :
   ses marches a suivre citent encore l'onglet « Agent Pi ». Interdite ici par la
   mission — a reprendre par la mission qui en a la charge (meme correction :
   « l'onglet de l'agent » ou le libelle dynamique).
2. **Doublon de logique** dans `onboarding.js` (`engineLabel()` recalcule
   « L'agent Pi/PLh » au lieu d'utiliser la source unique) : correct aujourd'hui,
   donc laisse ; a unifier si le proprietaire le souhaite (libelle avec
   majuscule initiale non fourni par `backend-info.js`).
3. **Non verifie a l'ecran** : le rendu reel de l'onglet renomme en mode PLh
   n'a pas ete observe visuellement (aucun lancement de l'application dans cette
   mission) — non verifie a l'ecran.

## Commit

Un seul commit local en francais, sans push, sans tag, sans changement de version,
limite aux fichiers de la mission (le fichier Rust modifie par une autre mission
en cours n'est **pas** inclus).
