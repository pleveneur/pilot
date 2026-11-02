# Constat — où se brancherait un troisième mode (lecture seule)

> **Nature de ce document** : constat sur le code tel qu'il est sur le disque, aujourd'hui.
> Aucune conception du mode « Vocal », aucune proposition de refonte, aucun fichier de
> code touché. Chaque affirmation porte un fichier + une ligne ; ce qui n'a pas pu être
> établi est écrit **« non vérifié »**. Les chemins sont relatifs à la racine du dépôt.

---

## Réponse courte

1. Il n'y a pas UN mécanisme de mode mais DEUX, indépendants : poste = « standard » / « assistant seul » (`src/js/super-agent.js`, clé localStorage `pilot_superagent_immersive`) ; web distant = config `web_mode` valant `"assistant"` ou `"agents"` (`src-tauri/src/lib.rs:479-483`, `src-tauri/src/web_server.rs:967-969`).
2. Un troisième mode se branche donc à DEUX endroits distincts : la barre d'outils de l'onglet 🧭 (`super-agent.js:2796`) et le sélecteur `#web-mode-toggle` (`web/index.html:44-46`) — pas un seul.
3. Déjà réutilisable tel quel : vérification de disponibilité + téléchargement sur geste explicite de la voix locale Piper (`src/js/local-voice.js`, `src-tauri/src/tts_local.rs`, `tts_local_download.rs`), la ligne d'état « Moteur · … » en bas de la colonne (`index.html:232-235`), l'état « Prêt » du web (`web/index.html:40`, masqué en mode assistant).
4. Piège principal : côté web le mode est testé en DEUX valeurs à cinq endroits (`app.js:224`, `:437`, `:828`, `:1039`, `web_server.rs:967`) → une troisième valeur verrait **les réponses de l'Assistant jetées** et **son enregistrement refusé en silence**.
5. Aucun réglage de **périphérique d'entrée (microphone)** n'existe : `enumerateDevices` / `audioinput` absents de tout le dépôt.

---

## 0. Un avertissement de nommage (important avant tout le reste)

Les mots « Standard » et « Assistant Only » **n'existent pas dans le code**. Le code
contient deux dispositifs différents, que la documentation regroupe parfois sous le mot
« modes » :

| Ce que vous appelez | Ce qu'il y a réellement dans le code | Où |
|---|---|---|
| « Standard » (poste) | L'absence de mode : l'interface complète | implicite — `src/js/super-agent.js:3390-3397` |
| « Assistant Only » (poste) | Le **mode assistant seul** (A19, overlay immersif) | `src/js/super-agent.js:3390-3598` |
| « Assistant » (web) | `web_mode = "assistant"` | `src-tauri/src/lib.rs:479-483` |
| « Agents » (web) | `web_mode = "agents"` | idem |

Conséquence concrète : **le même mot « mode » désigne deux réglages qui ne se parlent
pas**. Le mode du poste est stocké dans le navigateur (`localStorage`), celui du web dans
le fichier de configuration côté serveur. Aucun code ne synchronise les deux (vérifié :
`grep` de `immersive` dans `src-tauri/src/*.rs` → **0 résultat**).

---

## 1. Le mécanisme de mode

### 1.1 Sur le poste : « standard » / « assistant seul »

**Ce qu'est le mode.** Un overlay plein écran, construit une fois, dans lequel on
**déplace** les nœuds existants de la conversation — rien n'est recréé :
`src/js/super-agent.js:3390-3397` (commentaire de conception), `:3497-3505`
(déplacement de `messagesEl`, `inputBar`, `pendingBar`), `:3510-3518` (déplacement de
l'entrée « Travail »), `:3544-3562` (restitution symétrique à la sortie).

**Comment on bascule.**
- Bouton `data-action="immersive"` dans la barre d'outils de l'onglet 🧭 :
  `src/js/super-agent.js:2796`.
- Raccourci `Ctrl+Shift+A` (`Cmd+Shift+A` sur macOS) : `src/js/super-agent.js:3579`.
- Fonctions `enterImmersive()` / `exitImmersive()` : `src/js/super-agent.js:3486` et
  `:3534`. Le garde-fou de ces deux fonctions est uniquement « ne pas entrer deux fois » :
  `if (immersiveOverlay) return;` (`:3486-3487`, `:3534-3535`).

**Où c'est mémorisé, et retrouvé au redémarrage.**
- Écrit : `localStorage.setItem(IMMERSIVE_KEY, "1")` à l'entrée
  (`src/js/super-agent.js:3522`), `"0"` à la sortie (`:3569`) ; clé déclarée
  `IMMERSIVE_KEY = "pilot_superagent_immersive"` (`:3398`).
- Relu à la **création de l'onglet** 🧭 : `src/js/super-agent.js:3947`.
- Donc retrouvé au redémarrage **par ricochet** : au lancement, `main.js` rouvre l'onglet
  🧭 si `super_agent_open` ou `super_agent_start_on_launch` (`src/js/main.js:1217-1228`),
  ce qui rappelle la création de l'onglet, qui relit le `localStorage`. **Ce n'est pas un
  réglage de configuration** : il n'existe aucune clé `immersive` dans `AppConfig`
  (`grep` de `immersive` dans `src-tauri/src/lib.rs` → **0 résultat**).

**Ce que la bascule montre / cache concrètement.**

| Élément | Entrée en mode | Preuve |
|---|---|---|
| `body` reçoit la classe `superagent-immersive-active` | ajoutée / retirée | `super-agent.js:3520` / `:3568` |
| Sidebar, aire de travail, rangée d'onglets, boutons système | masqués par la classe (overlay au-dessus) | `src/css/style.css:10973-10999`, `:11240` |
| Conversation (`messagesEl`), barre de saisie (`inputBar`), barre d'attente (`pendingBar`) | **déplacées** dans l'overlay | `super-agent.js:3497-3505`, `:3544-3548` |
| Entrée « Travail » + compteur | déplacée dans la barre du mode | `super-agent.js:3510-3518`, restitution `:3552-3562` |
| Liste d'agents (point qui respire) | montée / démontée | `super-agent.js:3494-3496`, `:3536-3540` |
| Indicateurs `#sa-immersive-status`, `#agent-status` | masqués par CSS | `src/css/style.css:2349-2353` |
| Modales | remontées au-dessus de l'overlay | `src/css/style.css:10989` |

**Le mode peut-il changer pendant qu'un agent travaille ?**
- **Aucun garde-fou** : ni `enterImmersive` ni `exitImmersive` ne consultent l'état
  « en cours » (`super-agent.js:3486-3533`, `:3534-3598`). La bascule est permise à tout
  moment. Elle est **sans perte** parce que les nœuds sont déplacés, jamais recréés
  (`:3394-3397`), et parce qu'un report d'indicateur est prévu si l'assistant réfléchissait
  déjà (`applyReflecting()`, appelé `super-agent.js:3525`).
- **Il existe en revanche un garde-fou dans l'autre sens** : ouvrir les Options quitte
  d'abord le mode assistant seul — `src/js/settings.js:3264-3265` émet
  `pilot-exit-assistant-only`, écouté en `super-agent.js:3594`, retiré à la sortie
  `:3974`. C'est verrouillé par un test : `src/js/reglages-lot-b.test.js:145`.

### 1.2 Sur l'accès web distant : `web_mode`

**Ce que c'est.** Un réglage **de configuration serveur**, pas un état de navigateur :
- Déclaré : `src-tauri/src/lib.rs:479-483` (`web_mode: String`).
- Valeur par défaut : `fn default_web_mode() -> String { "assistant".to_string() }`
  (`src-tauri/src/lib.rs:1006`), appliquée à l'initialisation `:1164`.
- Lu par HTTP : `GET /api/settings` → `src-tauri/src/web_server.rs:944-955`.
- Écrit par HTTP : `POST /api/settings` → `src-tauri/src/web_server.rs:958-981`, avec
  **validation stricte** : `if mode != "assistant" && mode != "agents" { 400 }`
  (`:967-969`).

**Ce que la bascule montre / cache** — fonction `applyMode()`,
`web/js/app.js:1008-1040` :

| Élément | En mode « assistant » | Preuve |
|---|---|---|
| `#chat-model-bar` (sélecteur de modèle + état « Prêt ») | masquée | `app.js:1013-1014` |
| `#btn-immersive` (⛶) | visible | `app.js:1015-1017` |
| `#btn-new`, `#btn-abort`, `#btn-compact`, `#btn-load-history` | masqués | `app.js:1018-1021` |
| Onglets `#tabbar` sauf `chat` | masqués | `app.js:1022-1025` |
| Placeholder de `#prompt-input` | « Message à l'Assistant… » | `app.js:1026-1027` |
| `#chat-mode-hint` (bandeau d'explication) | rempli et visible | `app.js:1028-1033` |

**Où c'est mémorisé, retrouvé au redémarrage.** Côté serveur (donc retrouvé à chaque
connexion, sur n'importe quel appareil) : relu au démarrage de la page par
`loadWebMode()` — `web/js/app.js:223-231`, appelé dans `enterApp()`
(`web/js/app.js:224-225` porte aussi le test des deux valeurs autorisées).

**Le mode peut-il changer pendant qu'un agent travaille ?** Oui, sans garde-fou :
le gestionnaire de clic (`web/js/app.js:1045-1056`) ne teste que « même mode ? » puis
appelle `applyMode()`, qui termine par `clearChat()` **inconditionnel** (`app.js:1039`).
Or `clearChat()` vide le DOM et remet `state.isStreaming = false`
(`web/js/app.js:993-1002`) : **changer de mode en pleine réponse jette la réponse en
cours**. C'est un fait du code actuel, pas une hypothèse.

### 1.3 Tableau récapitulatif

| | Poste (desktop) | Web distant |
|---|---|---|
| Nombre de valeurs | 2 (présent / absent) | 2 (`"assistant"` / `"agents"`) |
| Nature du stockage | `localStorage` navigateur | `config.json` (serveur) |
| Écrit par | `super-agent.js:3522` / `:3569` | `POST /api/settings` (`app.js:1052`) |
| Validé par | rien | `web_server.rs:967-969` |
| Restauré par | `super-agent.js:3947` | `app.js:224-225` |
| Garde-fou pendant un travail | aucun | aucun (+ effacement du chat) |

---

## 2. Visite de contrôle / vérification de disponibilité, et téléchargement sur geste

Il n'existe **aucun module générique** nommé « visite de contrôle ». Il existe en revanche
**quatre dispositifs** qui font déjà exactement ce travail (vérifier, dire ce qui manque,
proposer d'agir). Voici leur état réel.

### 2.1 Verrou de démarrage du moteur — `src/js/pi-startup-gate.js`

- Réserve le terrain avant tout démarrage de travail ; exporte ses motifs
  (`PI_STARTUP_GATE_REASONS`) et ses messages : `src/js/pi-startup-gate.js` (en-tête).
- Il est **consulté, jamais dupliqué**, par la politique d'admission des missions :
  `src/js/run-policy.js` (import `isPiStartupGateBlocking`, `piStartupGateMessage`,
  lignes 20-21) — c'est le branchement déjà en place pour « rien ne démarre tant que
  quelque chose n'est pas prêt ».

### 2.2 Rapports de prise en main — `src/js/onboarding.js`

- Trois rapports qui disent **pourquoi** ça ne marche pas et **quoi faire** :
  moteur (`onboardingEngineReport`, `:148`), projet (`onboardingProjectReport`, `:217`),
  modèle (`onboardingModelReport`, `:245`).
- Présentation avec bouton **Réessayer** et sortie toujours active :
  `src/js/onboarding-niveau2.js` (modale à état vivant, « Réessayer »).

### 2.3 État du service Laya — `src/js/laya-utils.js` + `src/js/laya-gateway.js`

- Messages d'état et de « modèle absent » : `layaStatusMessage` (`:29`),
  `layaModelStateMessage` (`:134`) ; message de service indisponible
  `layaOffMessage` (`laya-gateway.js:162`).
- Côté Rust : `laya_status`, `laya_model_state`, et **téléchargement sur geste**
  `laya_model_download` / `laya_model_cancel` (`src-tauri/src/lib.rs:2615`, `:2683`,
  `:2694`, `:2723`).

### 2.4 Voix locale (Piper) — le cas le plus proche d'un « mode vocal »

- **Vérification de disponibilité** : `refreshLocalVoiceStatus` et
  `localVoiceStatusFor` — `src/js/local-voice.js:344`+ ; commandes
  `tts_local_status`, `tts_local_synthesize`, `tts_local_log`
  (`src/js/local-voice.js:93-100`), toutes enregistrées côté Tauri
  (`src-tauri/src/lib.rs:3667-3672`).
- **Ce qui manque est dit explicitement** : `LocalVoiceStatus` expose
  `installed`, `engine_present`, `engine_dir`, `engine_shared`, `model_present` —
  `src-tauri/src/tts_local.rs:117-140`. Le catalogue des 4 voix et leurs tailles
  exactes : `tts_local.rs:75-108` ; modèle par défaut `:110-112`.
- **Téléchargement UNIQUEMENT sur geste** : `tts_local_download` /
  `tts_local_cancel_download` / `tts_local_download_state`
  (`src-tauri/src/tts_local_download.rs`, en-tête + `lib.rs:3670-3672`), déclenché à un
  seul endroit de l'interface, sur un clic ou un choix de voix : voir le commentaire de
  `src/js/settings.js:1884-1886` (« aucun geste ici — un téléchargement ne part que d'un
  clic ou d'un choix de voix »).
- **Repli visible, jamais une exception** : toute erreur → `null` + journal
  `voix-locale.log` (`tts_local.rs:113-118`).

### 2.5 Verdict de réutilisation

| Besoin d'un 3e mode | Dispositif existant | Verdict |
|---|---|---|
| « Le moteur est-il prêt ? » | `pi-startup-gate.js` + `run-policy.js` | **réutilisable tel quel** |
| « Dire pourquoi et quoi faire » | `onboarding*.js` (Réessayer) | **modèle réutilisable**, code à rebrancher |
| « La voix est-elle installée ? » | `local-voice.js` + `tts_local.rs` | **réutilisable tel quel** |
| « Télécharger ce qui manque, sur mon geste » | `tts_local_download.rs` | **réutilisable tel quel** |
| « Vérifier le micro avant d'utiliser » | **rien** — voir §3 | **à créer** |

---

## 3. Réglages liés à la voix

### 3.1 Ce qui existe

| Réglage | Valeur par défaut | Où c'est lu | Où c'est écrit |
|---|---|---|---|
| `read_aloud_voice` (voix de la lecture à voix haute) | `""` = automatique (voix système de la langue de l'interface) — `src-tauri/src/lib.rs:702` et `:1221` | `src/js/settings.js:651-652` (remplissage de la liste), `src/js/read-aloud.js:293-294` (application) | `src/js/settings.js:2874` (`selectReadAloudVoice.value`) |
| Voix locale Piper (`local:piper`, `local:piper:<modèle>`) | `LOCAL_VOICE_VALUE = "local:piper"`, modèle `fr_FR-siwis-medium` — `src/js/local-voice.js:41`, `:59` ; `tts_local.rs:110-112` | `local-voice.js:41`, `settings.js:655-660` | même champ unique `read_aloud_voice` (aucun second réglage) |
| Projet « sensible » (bloque la dictée cloud) | liste vide — `src-tauri/src/lib.rs:551`, `:1183` | `agent-pi.js:868-880` (badge 🔒) | `set_project_sensitive` → `lib.rs:2758-2762`, piloté par le clic sur le badge `agent-pi.js:900-910` |
| Volume du son de notification | `100` — `lib.rs` (`assistant_sound_volume`), écrit `settings.js:2870` | `settings.js:1875-1877` | `settings.js:2870` |

À noter : **`assistant_sound_volume` n'est pas de la voix** (c'est le son de notification),
mais il vit dans la même section des Options — ne pas le confondre avec un réglage vocal.

### 3.2 La dictée vocale n'a AUCUN réglage

- Le bouton existe : `agent-pi.js:562` (`data-action="voice"`) et `super-agent.js:2892`.
- La langue est **écrite en dur** : `const VOICE_LANG = "fr-FR";` —
  `agent-pi.js:847` (utilisée `:933`) et `super-agent.js:3268` (utilisée `:3293`).
- La disponibilité est testée **au rendu**, et le bouton est simplement masqué si l'API
  manque : `agent-pi.js:848-850`.
- Les erreurs de micro sont dites **après coup**, dans la conversation :
  `agent-pi.js:972-977` (message « 🎙️ Micro indisponible (…) »).
- **Aucune clé de configuration** ne concerne la dictée (`grep` de `dictée` dans
  `index.html` → **0 résultat** ; aucun champ de `AppConfig`).

### 3.3 Réglage de périphérique d'entrée (microphone) : **il n'existe pas**

Preuve négative, faite sur tout le dépôt :
`grep -rn "enumerateDevices\|audioinput\|deviceId" src/js/ src-tauri/src/ web/js/`
→ **0 résultat**. Il n'y a donc :
- aucun choix de micro,
- aucun test de présence d'un micro **avant** utilisation,
- aucune mémorisation de micro dans la configuration.

C'est le seul manque « matériel » du constat, et il est cohérent avec la façon dont la
dictée est faite aujourd'hui (API du navigateur, qui choisit elle-même le périphérique).

---

## 4. Place à l'écran pour un troisième choix

### 4.1 Sur le web — place disponible, mais fragile sur un téléphone

- Le sélecteur est une rangée de boutons : `web/index.html:45-46`
  (`data-mode="assistant"` / `"agents"`), dans `#web-mode-toggle` (`:44`).
- Mise en page : `.top-area-mode { display:flex; gap:4px; … }` et
  `.top-area-mode .mode-btn { flex:1; padding:8px; font-size:13px; }` —
  `web/css/web.css:105-107`.
- **Conséquence vérifiable** : `flex:1` répartit la largeur entre les boutons ; un
  troisième bouton ne casse donc pas la rangée, il **rétrécit les trois**. Et
  `grep "@media" web/css/web.css` → **0 résultat** : il n'existe **aucune** règle adaptative.
  Avec deux libellés à emoji (« 🧭 Assistant », « 🤖 Agents »), un troisième libellé du même
  genre tient sur un écran large ; sur un téléphone étroit, il n'y a **aucun mécanisme
  prévu** (pas de retour à la ligne : `flex-wrap` absent de `.top-area-mode`) → risque de
  compression/rognage. **Constat, pas essai réel** : la largeur exacte à laquelle ça casse
  est **non vérifiée** (aucune mesure faite).

### 4.2 Sur le poste — place dans la barre d'outils, pas de sélecteur

- Il n'y a **pas de sélecteur** : un seul bouton ⛶ (`super-agent.js:2796`) dans la barre
  d'outils de l'onglet 🧭, dont la mise en page est
  `.agent-chat-toolbar { display:flex; gap:6px; … }` (`src/css/style.css:4828-4835`) —
  **sans `flex-wrap`**. Cette barre porte déjà plusieurs boutons + le sélecteur de modèle ;
  un troisième état sous forme de **bouton-icône** s'y insère sans casser la rangée, un
  **libellé texte** y serait serré (**non mesuré**).

### 4.3 Y a-t-il déjà un endroit prévu pour un état « prêt / non prêt » ?

**Oui, deux, et ils existent déjà et sont alimentés :**

| Endroit | Ce qu'il affiche aujourd'hui | Preuve |
|---|---|---|
| `#sidebar-engine-row` — bas de la colonne de gauche | `#project-engine` = « Moteur · Agent Pi » (ou « Agent PLh » selon le backend) + `#remote-badge` | `index.html:218-235` ; rempli par `src/js/main.js:626-640` ; styles `src/css/style.css:816-838` |
| `#agent-status` — barre du haut du web | « Prêt » (classe `status idle`) | `web/index.html:38-41` ; **masqué en mode assistant** par `app.js:1013-1014` |

Détail utile : sur le web, l'état « Prêt » est **dans** `#chat-model-bar`, donc invisible
en mode « assistant ». Il n'y a donc pas, aujourd'hui, d'état de disponibilité visible dans
le mode le plus minimaliste du web — alors que c'est précisément là qu'un mode vocal
voudrait dire « la voix est prête / pas prête ».

---

## 5. Ce qu'il manque pour un troisième mode (la partie la plus utile)

### 5.1 Les points de contact, classés

**Indispensable** (sans ça, le mode ne peut pas exister) :

1. **Un endroit qui nomme le mode.** Sur le web, la valeur est **refusée par le serveur**
   si elle n'est pas `"assistant"` ou `"agents"` : `src-tauri/src/web_server.rs:967-969`.
   Il faut élargir **cette** validation, sinon le mode ne sera jamais enregistré (400) et
   sera oublié au rechargement.
2. **Un bouton dans `#web-mode-toggle`** : `web/index.html:44-46` (structure) et
   `web/css/web.css:105-107` (mise en page) — et, si le mode doit tenir sur téléphone,
   une règle adaptative qui **n'existe pas aujourd'hui**.
3. **La restauration du mode** : `loadWebMode()` n'accepte que deux valeurs —
   `web/js/app.js:224-225`. Sans modification, une troisième valeur est **silencieusement
   jetée** au rechargement (retour au mode par défaut).
4. **Le routage du prompt** : `const endpoint = state.mode === 'assistant' ?
   '/api/superagent/prompt' : '/api/agent/prompt'` — `web/js/app.js:828`. Une troisième
   valeur part donc vers l'**agent du projet**, ce qui n'est pas forcément ce que veut un
   mode vocal.
5. **Le filtrage des évènements WebSocket** : `if (state.mode !== 'assistant') return;`
   pour le canal `superagent` et `else if (state.mode === 'assistant') return;` pour les
   évènements d'agent — `web/js/app.js:436-441`. Une troisième valeur est traitée comme
   « agents » : **les réponses de l'Assistant sont jetées**, le chat reste muet.
6. **Sur le poste, un état de mode supplémentaire dans `super-agent.js`** : aujourd'hui
   l'état est **binaire par construction** (présence ou absence de `immersiveOverlay`,
   `super-agent.js:3486-3487`, plus la classe `superagent-immersive-active`,
   `:3520` / `:3568`). Un troisième état ne peut pas être « un peu plus immersif » : il
   demande soit une seconde clé de `localStorage`, soit une valeur à trois états à la
   place du `"1"` / `"0"` (`:3522`, `:3569`, relu `:3947`).

**Souhaitable** (le mode marche sans, mais l'utilisateur est moins bien servi) :

7. **Un état « prêt / non prêt » visible dans le mode minimaliste.** Le web n'en a pas
   (l'état « Prêt » est masqué en mode assistant — `app.js:1013-1014`) ; le poste a la
   ligne « Moteur · … » (`main.js:626-640`) qui est libre et toujours visible.
8. **La vérification « le micro existe-t-il ? »** : inexistante (§3.3). Ce serait le
   pendant exact de ce que fait déjà la voix locale pour le haut-parleur.
9. **La réutilisation de la visite de disponibilité** plutôt qu'une nouvelle : les
   dispositifs du §2 font déjà « vérifier + dire quoi faire + télécharger sur geste ».
   Un quatrième mécanisme créerait une seconde vérité.

**Facultatif** (confort, à trancher plus tard) :

10. **Les chips de suggestion** (« Faire un point sur un projet », … —
    `super-agent.js:3457-3478`) : un mode vocal n'en a pas besoin, mais les réutiliser est
    gratuit puisqu'elles ne font que préremplir la saisie.
11. **Le libellé de l'onglet et de l'aide** : aucune conséquence technique.
12. **Les tests anti-régression** : cinq fichiers verrouillent aujourd'hui le
    fonctionnement binaire (`agent-activity.test.js`, `barre-fenetre-assistant-seul.test.js`,
    `compteur-taches-travail.test.js`, `reglages-lot-b.test.js`,
    `suivi-multi-projets-dashboard.test.js`) — à faire évoluer, mais aucun ne bloque la
    création du mode.

### 5.2 Les pièges — là où un troisième mode casse quelque chose

Classés du plus grave au plus discret. **Chacun est adossé à une ligne du code actuel.**

1. **Le serveur refuse la troisième valeur (bloquant, silencieux côté utilisateur).**
   `src-tauri/src/web_server.rs:967-969` renvoie `400` avec le message
   « web_mode invalide (attendu 'assistant' ou 'agents') ». Le client, lui, **avale
   l'erreur** : `web/js/app.js:1052-1053` (`catch` → `console.error` seulement). Le mode
   s'affiche donc à l'écran… et disparaît au rechargement. C'est le piège le plus
   trompeur : ça « marche » pendant la session.

2. **Les réponses de l'Assistant sont jetées (bloquant, difficile à diagnostiquer).**
   `web/js/app.js:437` : `if (state.mode !== 'assistant') return;` — tout évènement du
   canal `superagent` est ignoré si le mode n'est pas exactement `"assistant"`. Un mode
   vocal qui discute avec l'Assistant paraîtrait **muet** (aucune erreur, aucun message).

3. **Le prompt part vers le mauvais destinataire.**
   `web/js/app.js:828` : deux routes seulement. Une troisième valeur → `/api/agent/prompt`
   (l'agent du projet), alors qu'on croyait parler à l'Assistant.

4. **Le chat est effacé à chaque changement de mode, même en pleine réponse.**
   `web/js/app.js:1039` appelle `clearChat()` sans condition, et `clearChat()`
   (`:993-1002`) vide le DOM **et** remet `state.isStreaming = false`. Changer de mode
   pendant qu'un agent travaille jette la réponse en cours. Ce piège existe **déjà**
   aujourd'hui entre les deux modes ; un troisième bouton le rend trois fois plus
   probable.

5. **Les deux modes ne sont pas un seul concept : il y a deux endroits, et un seul ne
   suffit pas.** Le mode du poste est dans `localStorage`
   (`super-agent.js:3398`, `:3522`, `:3569`, relu `:3947`), celui du web dans
   `config.json` (`lib.rs:479-483`). Aucun code ne les relie (0 résultat pour `immersive`
   dans `src-tauri/src/*.rs`). Un troisième mode déclaré d'un seul côté donnerait deux
   comportements différents selon qu'on est devant la machine ou à distance.

6. **Ouvrir les Options fait sortir du mode assistant seul.**
   `src/js/settings.js:3264-3265` émet `pilot-exit-assistant-only` ; écouté
   `super-agent.js:3594`. Un mode vocal qui voudrait ouvrir ses réglages se ferait donc
   **éjecter** par ce mécanisme pensé pour le mode immersif — sauf à distinguer les deux
   modes dans cet évènement (aujourd'hui il ne porte aucune information de mode).

7. **L'état du poste est un booléen, pas une valeur.**
   `super-agent.js:3486-3487` (`if (immersiveOverlay) return;`), `:3520` / `:3568`
   (`classList.add/remove`) puis `:3522` / `:3569` (`localStorage` à `"1"` / `"0"`) :
   tout code qui lit cet état lit un booléen. Une troisième valeur dans la même clé
   casserait `:3947` (restauration) sans erreur visible.

8. **La mise en page du web n'a aucune règle adaptative.**
   `grep "@media" web/css/web.css` → **0 résultat**, et `.top-area-mode` n'a pas de
   `flex-wrap` (`web/css/web.css:105`). Un troisième bouton ne casse pas la rangée sur un
   ordinateur, mais rien n'est prévu pour un téléphone. **Non mesuré.**

9. **La documentation dit déjà autre chose que ce que ferait un troisième mode.**
   `docs/architecture-conversation-vocale-interruptible.md:404-408` place le « mode
   conversation » **dans ⚙️ Paramètres → Assistant**, « à côté » de la section de lecture,
   et non comme un troisième choix du sélecteur de mode. Le même document
   (`:514-520`) pose une règle explicite : « ni second réglage de voix, ni second journal
   de repli ». À trancher **avant** d'écrire du code, sinon les deux emplacements
   coexisteront.

10. **Deux tests verrouillent la structure actuelle** : `src/js/reglages-lot-b.test.js:145`
    (ouvrir les Options quitte le mode assistant seul) et
    `src/js/barre-fenetre-assistant-seul.test.js`. Ils ne bloquent pas, mais ils
    signaleront la moindre régression de l'existant — c'est leur rôle, ne pas les
    assouplir.

### 5.3 Ce qu'il ne faut pas faire (constaté, pas supposé)

- **Ne pas créer un second stockage pour le mode.** Il en existe déjà deux (poste/web) et
  ils ne se parlent pas ; un troisième ajouterait une troisième vérité.
- **Ne pas dupliquer la vérification de disponibilité ni le téléchargement.** Quatre
  dispositifs le font déjà (§2) ; la voix locale (Piper) est le plus complet et le plus
  proche du besoin.
- **Ne pas confondre l'effacement du chat (`clearChat`) avec un changement de mode.** Ce
  sont deux effets du même gestionnaire aujourd'hui (`app.js:1039`).

---

## 6. Ce qui reste « non vérifié »

- La largeur d'écran exacte à laquelle un troisième bouton du `#web-mode-toggle` devient
  illisible : **non vérifié** (aucune mesure, aucun test en navigateur effectué).
- Le comportement réel du mode immersif du poste **pendant** une réponse en cours
  (aucun garde-fou dans le code, mais je n'ai pas exécuté l'application pour l'observer) :
  **non vérifié à l'exécution** — seul le code a été lu.
- L'effet réel d'une troisième valeur `web_mode` sur les autres routes du serveur : le
  serveur ne branche sur `web_mode` qu'à deux endroits (`web_server.rs:944-981`) ; je n'ai
  pas trouvé d'autre lecture (vérifié par `grep`), mais je ne peux pas exclure une
  dépendance indirecte : **non vérifié au-delà de ces deux points**.
- Aucun test n'a été lancé, aucun fichier de code n'a été modifié, aucune session d'agent
  n'a été listée pendant cette analyse.

---

DONE: constat terminé — le mode se branche à deux endroits distincts (poste : `super-agent.js` état binaire + localStorage ; web : `web_mode` validé en dur dans `web_server.rs:967`), les mécanismes de disponibilité et de téléchargement sur geste existent déjà et sont réutilisables (voix locale Piper), le piège principal est que le web traite le mode en deux valeurs à cinq endroits (`app.js:224`, `:437`, `:828`, `:1039`, `web_server.rs:967`) et qu'aucun réglage de périphérique d'entrée (microphone) n'existe ; rapport écrit dans `RAPPORT-constat-trois-modes.md`, aucun fichier de code touché.
