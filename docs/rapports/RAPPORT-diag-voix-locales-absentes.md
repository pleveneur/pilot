# RAPPORT — Diagnostic : « je ne retrouve plus les voix locales dans le paramétrage »

> **Diagnostic seul.** Aucun fichier de code modifié, aucun commit, aucune correction appliquée.
> Le propriétaire décide.
> Projet : `G:\IA_PL\pilot` — `HEAD` = `794b6c3` (`git describe` : `v0.5.0-16-g794b6c3`), version installée signalée : **0.5.0** (tag `v0.5.0`).
> Vérifié aussi **contre le tag `v0.5.0`** : les lignes citées ci-dessous sont **identiques** dans le tag et dans `HEAD` (aucun correctif n'est arrivé depuis la publication).

---

## 0. Réponse courte

La section **n'a pas disparu** et **n'a pas été déplacée**. Elle est toujours là, à la même place, avec son titre, son menu déroulant et ses boutons. Ce qui a changé, c'est **son contenu** : depuis la **v0.4.46**, la liste des voix n'affiche plus les voix françaises locales **tant que l'état du moteur local n'a pas été demandé** — et cet état n'est désormais demandé **que si le réglage enregistré désigne déjà une voix locale**. Avec le réglage par défaut (`read_aloud_voice: ""` = « Automatique »), l'état n'est **jamais** demandé : la liste ne contient donc que « Automatique » et les voix du système, et la ligne d'état reste bloquée sur « vérification du moteur en cours… ».

C'est une **régression non voulue**, introduite le **2026-10-24** par le commit **`52eb3ab`** (« feat(voix): choisir la voix française locale, dont une voix masculine »), publiée dans **v0.4.46** et **v0.5.0**. En **v0.4.45** et avant, la voix locale apparaissait **toujours** dans la liste.

Il n'y a **aucun test** qui protège aujourd'hui cette apparition (et un test verrouille même la condition fautive, voir § 5).

---

## 1. La réalité du disque aujourd'hui (preuves `fichier:ligne`)

### 1.1 Où est défini le réglage

| Élément | Preuve |
|---|---|
| Clé de configuration unique côté Rust (`snake_case`, un seul champ) | `src-tauri/src/lib.rs:697` — `read_aloud_voice: String,` |
| Valeur par défaut = chaîne vide = « Automatique » | `src-tauri/src/lib.rs:1207` — `read_aloud_voice: String::new(),` |
| Valeur réservée de la **voix française locale** | `src/js/local-voice.js:41` — `export const LOCAL_VOICE_VALUE = "local:piper";` |
| Les **quatre** modèles proposés (genre et taille exacte) | `src/js/local-voice.js:51-56` — `LOCAL_VOICE_MODELS` = `fr_FR-siwis-medium` (femme, défaut), `fr_FR-tom-medium` (homme), `fr_FR-gilles-low` (homme), `fr_FR-siwis-low` (femme) |
| Traduction valeur → modèle (`null` si la valeur n'est **pas** locale) | `src/js/local-voice.js:174-186` — `localVoiceModelFor` ; `localVoiceModelFor("")` → `null` (ligne 175-176) |
| Valeur lue par la lecture elle-même | `src/js/read-aloud.js:271` `getPreferredVoiceName`, `read-aloud.js:285-293` `applyPreferredVoice` |
| Écriture du réglage (une seule) | `src/js/settings.js:2809` — `read_aloud_voice: selectReadAloudVoice ? selectReadAloudVoice.value : ""` |

### 1.2 Où est construite la section « Lecture des réponses à voix haute »

| Élément | Preuve |
|---|---|
| Section dans l'onglet **Assistant** | `index.html:1242` ouvre `#settings-section-read-aloud`, à l'intérieur du panneau `data-settings-panel="superagent"` ouvert en `index.html:1090` et refermé avant le panneau MCP de `index.html:1323` ; la section se referme en `index.html:1273` |
| Bouton d'onglet correspondant | `index.html:458` — `data-settings-tab="superagent"` libellé « Assistant » (groupe « Suivi ») |
| Le menu déroulant | `index.html:1246` — `<select id="setting-read-aloud-voice">` (une seule occurrence dans tout l'HTML) |
| Les autres éléments de la section | `index.html:1255` aperçus d'écoute (`#read-aloud-voice-previews`), `1258` état de lecture (`#read-aloud-state`), `1261` note (`#read-aloud-voice-note`), `1264` note du moteur local (`#read-aloud-local-note`), `1267` état du téléchargement (`#read-aloud-download-state`), `1270-1272` boutons « Télécharger » / « Arrêter » / « Vérifier à nouveau » |
| Aucun masquage par le style | `src/css/style.css` ne contient **aucune** règle visant `#settings-section-read-aloud` ni `:has()`, ni `display:none` conditionnel sur cette section (seules `.settings-section` et `.settings-section-title`, `style.css:3384` et `3403`, purement décoratives) |

La section est **statique dans `index.html`** : elle n'est ni créée, ni retirée, ni déplacée par du JavaScript. **Rien ne peut la faire disparaître**, ni une case à cocher, ni un moteur absent.

### 1.3 Sous quelles CONDITIONS les voix locales apparaissent dans la liste

C'est **ici** que se joue le symptôme. La liste est composée par une fonction pure, appelée une seule fois :

```js
// src/js/settings.js:669-674
function renderReadAloudVoice(wanted, local) {
  …
  const options = voiceChoiceOptions(voices, local || undefined);
```

et les voix locales n'y sont ajoutées **que si un état de moteur est fourni** :

```js
// src/js/read-aloud.js:332-350
export function voiceChoiceOptions(voices, local) {
  …
  if (local) {                                          // ← read-aloud.js:342 : condition d'apparition
    const statusModel = String((local && local.voice) || "");
    for (const entry of localVoiceChoices()) { … options.push({ value: entry.value, label }); }
  }
```

Or, à l'ouverture des Paramètres, l'état n'est demandé **que si le réglage désigne déjà une voix locale** :

```js
// src/js/settings.js:639-661  (refreshReadAloudVoice)
const model = localVoiceModelFor(wanted);                                  // 647
renderReadAloudVoice(wanted, model ? localVoiceStatusFor(model) : null);   // 648  → rendu SANS état
if (model && !localVoiceStatusFor(model)) {                                // 652  ← garde fautive
  refreshLocalVoiceStatus({ model }).then((status) => { … });              // 653
}
```

Chaîne complète du défaut, pour un utilisateur **par défaut** :

1. Réglage par défaut = `""` (`lib.rs:1207`) → `localVoiceModelFor("")` = `null` (`local-voice.js:175-176`).
2. `settings.js:648` : `local` reçu par le rendu = `null`.
3. `settings.js:652` : `model` est `null` → la condition est fausse → **aucun appel** `tts_local_status`.
4. `read-aloud.js:342` : `if (local)` faux → **aucune voix locale** dans la liste.
5. `settings.js:692-694` (`readAloudLocalNote.textContent = localVoiceNoteText(local)`) : avec `local = null`, `localVoiceNoteText` (`settings.js:715-716`) affiche **à vie** « Voix française locale : vérification du moteur en cours… » — la vérification n'a jamais été lancée.

Les deux seuls points d'entrée qui rafraîchissent la section sont, eux aussi, soumis à la même garde :
- ouverture des Paramètres : `src/js/settings.js:1821` — `refreshReadAloudVoice(currentConfig && currentConfig.read_aloud_voice)`;
- basculement sur l'onglet Assistant : `src/js/settings.js:412-415` — même fonction, même garde.

Et **aucun autre chemin** ne demande l'état du moteur sans qu'une voix locale soit déjà choisie :
- `src/js/read-aloud.js:1042-1043` — conditionné par `isLocalVoiceChoice(getPreferredVoiceName())` ;
- `src/js/read-aloud.js:676-677` — dans le chemin de lecture, sur le modèle choisi ;
- `src/js/settings.js:888-890` (aperçu d'une voix) et `928-929` (téléchargement) — sur un modèle choisi ;
- `src/js/main.js` : **aucune** mention du statut local (grep vide).

**Conséquence mesurable** : avec la configuration par défaut, la liste du réglage ne contient **que** « Automatique (voix de la langue de l'interface) » et les voix du système. Les quatre voix françaises locales — dont une voix d'homme — sont **invisibles**, alors que le moteur et les modèles peuvent être installés. C'est exactement le symptôme signalé.

### 1.4 Le contournement existe, mais il ne tient pas

Le bouton « Vérifier à nouveau » (`index.html:1272`, écouteur `src/js/settings.js:2049-2062`) force la demande d'état, y compris quand aucune voix locale n'est sélectionnée :

```js
// src/js/settings.js:2054-2058
if (!model) {
  const fallback = await refreshLocalVoiceStatus({});        // → modèle par défaut
  if (fallback) renderReadAloudVoice(selectReadAloudVoice.value, fallback);
  return;
}
```

→ les voix locales **apparaissent**, ce qui confirme que la commande `tts_local_status` fonctionne et que le catalogue est intact. **Mais** : le réglage reste sur « Automatique » (`""`), et au **prochain basculement d'onglet ou à la réouverture** des Paramètres, `refreshReadAloudVoice("")` (`settings.js:412-415` / `1821`) refait un rendu avec `null` (`settings.js:648`) : **les voix locales redisparaissent** tant qu'aucune voix locale n'a été réellement choisie et enregistrée. Le contournement n'est stable que si l'utilisateur **choisit** une voix locale dans la foulée.

La commande côté Rust existe et est enregistrée (donc ce n'est pas une panne de branchement) :
`src-tauri/src/lib.rs:3563-3568` (`tts_local_status`, `tts_local_synthesize`, `tts_local_log`, `tts_local_download`, `tts_local_cancel_download`, `tts_local_download_state`), implémentation `src-tauri/src/tts_local.rs:632-639` (lecture d'état sur disque, sans processus lancé : bon marché).

---

## 2. Les réorganisations récentes de l'interface l'ont-elles fait disparaître ou déplacée ?

**Non. Vérifié, pas supposé.**

| Question | Vérification | Résultat |
|---|---|---|
| Un commit a-t-il touché la section ? | `git log --oneline -S "settings-section-read-aloud" -- index.html` | **Un seul** commit : `17f01b3` (2026-10-22) — celui qui a **créé** la section. Aucun autre depuis. |
| La section est-elle restée dans l'onglet Assistant ? | position du panneau `superagent` → position de la section, par version | `v0.4.45` : panneau L923 → section L1071 (**148** lignes d'écart) ; `v0.5.0` : L1075 → L1227 (**152**) ; `HEAD` : L1090 → L1242 (**152**). Le panneau a grandi **en tête** (offsets absolus décalés de la même valeur), la section est **à la même place relative**, toujours en 2ᵉ position après le bloc « Assistant (suivi multi-projets) ». |
| Les commits de réorganisation récente ont-ils touché cette zone ? | `ead5d2e` (titres de blocs Paramètres), `2a673bf`, `90f73e0`, `33c2e1c`, `794b6c3` | Ils ont changé **l'habillage** (`.settings-section-title`) et la barre de fenêtre, **pas** l'emplacement des sections. Le test structurel de l'onglet Assistant reste vert (§ 5). |
| La section a-t-elle été déplacée hors des Paramètres ? | `index.html:1242`, panneau `superagent` L1090-1323 | Non : elle est dans ⚙️ Paramètres → onglet **Assistant**, comme le décrit `spec_read_aloud.md:45-52`. |

**Ce qui a réellement changé, et quand** (comparaison de la fonction fautive entre deux versions) :

| Version | `refreshReadAloudVoice` — rendu et demande d'état | Effet sur la liste |
|---|---|---|
| **v0.4.45 et avant** | `renderReadAloudVoice(wanted, getLocalVoiceStatus());` puis `if (!getLocalVoiceStatus()) refreshLocalVoiceStatus().then(…)` — **état GLOBAL, demandé sans condition** | la voix locale française apparaissait **toujours** (« installée » ou « à télécharger ») |
| **v0.4.46 / v0.5.0 / HEAD** | `renderReadAloudVoice(wanted, model ? localVoiceStatusFor(model) : null);` + `if (model && !localVoiceStatusFor(model)) refreshLocalVoiceStatus({ model })` — **état PAR MODÈLE, demandé seulement si le réglage est déjà local** | **plus aucune voix locale** quand le réglage vaut `""` (défaut) ou une voix du système |

auteur du basculement : **`52eb3ab`** — 2026-10-24, « feat(voix): choisir la voix française locale, dont une voix masculine » (`src/js/settings.js` +156 lignes, `src/js/read-aloud.js` +50, `src/js/local-voice.js` +317) ; **premier tag qui le contient : `v0.4.46`** (`git tag --contains 52eb3ab` → `v0.4.46`, `v0.5.0`). Même commit a introduit la condition `if (local)` dans `voiceChoiceOptions` (`read-aloud.js:342`).

C'était un changement **volontaire sur le fond** (un modèle présent ne doit pas faire croire qu'un autre l'est — voir `spec_read_aloud.md:142`), mais il a emporté **par effet de bord** une dépendance non voulue : la liste dépend désormais d'un état qui n'est demandé que pour une voix déjà locale. Le rapport de ce commit (`RAPPORT-voix-locale-au-choix.md`) ne mentionne **aucune** décision « les voix locales ne s'affichent qu'après vérification » : ce n'est pas un choix documenté. Et `spec_read_aloud.md:52` exige toujours « **une entrée par voix française locale** … puis une entrée par voix du système » — l'état actuel **contredit la spec**, ce qui confirme la régression et non un comportement voulu.

---

## 3. Causes possibles, classées, et cause tranchée

| # | Cause possible | Probabilité | Raison |
|---|---|---|---|
| **1** | **La liste des voix locales dépend d'un état de moteur qui n'est jamais demandé quand le réglage n'est pas déjà local** (`settings.js:648` + `652`, `read-aloud.js:342`) | **Très probable — retenue** | Explique **exactement** le symptôme (section présente, titre présent, liste sans voix locales, note figée « vérification en cours… »), sur le **chemin par défaut** (`read_aloud_voice: ""`, `lib.rs:1207`) ; daté (`52eb3ab`, v0.4.46+) ; cohérent avec le fait que « Vérifier à nouveau » les fait apparaître (§ 1.4) ; contredit `spec_read_aloud.md:52` ; aucun test ne le couvre. |
| 2 | L'utilisateur cherche au mauvais endroit (onglet Agent Pi / Général au lieu de Assistant) | Possible, secondaire | La section a été **créée** dans l'onglet Assistant en v0.4.41 (`17f01b3`) ; elle n'a jamais été ailleurs depuis. Le libellé de l'onglet est « Assistant » (icône boussole), pas « Lecture des réponses » — un utilisateur qui cherche « les voix » peut ne pas y aller. N'explique **pas** à lui seul « je ne retrouve plus » (il a déjà utilisé ce réglage). |
| 3 | La section serait masquée par une case à cocher, un moteur absent ou un statut non revenu | **Écartée** | La section est statique (`index.html:1242-1273`), aucun CSS conditionnel, aucun `display` piloté. Le contenu des boutons est conditionnel, **pas la section**. |
| 4 | Les voix locales auraient été retirées du produit (catalogue supprimé) | **Écartée** | `local-voice.js:41-56` : `local:piper` + 4 modèles, présents **dans le tag `v0.5.0`** ; les commandes Rust sont enregistrées (`lib.rs:3563-3568`). |
| 5 | Panne de la commande `tts_local_status` côté version installée | **Écartée** | « Vérifier à nouveau » les fait apparaître ; `refreshLocalVoiceStatus` ne renvoie jamais `null` en cas d'erreur (`local-voice.js:337-343`) : même en panne, la liste s'afficherait. |
| 6 | Régression due aux réorganisations de l'interface (lots, onglets, barre de fenêtre) | **Écartée** | § 2 : aucun commit n'a touché la section ; position relative inchangée depuis v0.4.45 ; les lots n'ont changé que l'habillage. |

### Cause tranchée

**Cause n° 1** : `refreshReadAloudVoice` (`src/js/settings.js:639-661`) ne demande l'état du moteur local que si la valeur enregistrée désigne **déjà** une voix locale (`settings.js:652`), et transmet au rendu un état `null` dans tous les autres cas (`settings.js:648`) ; or `voiceChoiceOptions` (`src/js/read-aloud.js:342`) n'ajoute les voix françaises locales **que** si cet état est fourni. Avec la configuration par défaut (`read_aloud_voice: ""`), la liste n'a donc plus aucune voix locale. Régression introduite par `52eb3ab` (2026-10-24), publiée en **v0.4.46** et **v0.5.0** ; la v0.4.45 affichait la voix locale en permanence.

---

## 4. Correction minimale proposée (NON appliquée — le propriétaire décide)

**Le plus petit changement** : dans `src/js/settings.js`, fonction `refreshReadAloudVoice` (lignes 639-661), **demander et transmettre l'état du modèle par défaut quand aucune voix locale n'est choisie**. Rien d'autre ne bouge.
État actuel (`settings.js:647-661`, résumé) :

```js
const model = localVoiceModelFor(wanted);
renderReadAloudVoice(wanted, model ? localVoiceStatusFor(model) : null);
if (model && !localVoiceStatusFor(model)) {
  refreshLocalVoiceStatus({ model }).then((status) => { … });
}
```

Proposition (**1 import ajouté + 3 lignes modifiées**, aucune autre fonction touchée) :

```js
// En tête de src/js/settings.js, dans l'import déjà existant depuis ./local-voice.js
// (bloc `import { … } from "./local-voice.js"`, settings.js:60-77) : ajouter
//   DEFAULT_LOCAL_VOICE_MODEL,

// puis dans refreshReadAloudVoice (settings.js:647-661) :
const model = localVoiceModelFor(wanted);
// L'état du moteur est TOUJOURS fourni au rendu : sans lui, la liste ne propose
// aucune voix locale (read-aloud.js:342). Aucune voix locale choisie → état du
// modèle par défaut, seul état qui permet d'afficher le catalogue.
const statusModel = model || DEFAULT_LOCAL_VOICE_MODEL;
const known = localVoiceStatusFor(statusModel);
renderReadAloudVoice(wanted, known);
if (!known) {
  refreshLocalVoiceStatus({ model: statusModel }).then((status) => {
    if (status && isLocalVoiceChoice(selectReadAloudVoice.value)) {
      renderReadAloudVoice(selectReadAloudVoice.value, status);
    } else if (status) {
      renderReadAloudVoice(wanted, status);
    }
  });
}
```

(`DEFAULT_LOCAL_VOICE_MODEL` = `"fr_FR-siwis-medium"`, exporté en `src/js/local-voice.js:59` ; il s'emploie **directement** comme nom de modèle — `localVoiceModelFor()` ne convient pas ici, il attend une *valeur de réglage* préfixée `local:piper` et renverrait `null` sur un nom de modèle nu.)

Pourquoi celle-là plutôt qu'une autre :
- elle **remet l'état demandé sur les deux points d'entrée existants** (`settings.js:1821` ouverture, `settings.js:412-415` onglet) sans en ajouter ;
- elle **ne touche pas** `voiceChoiceOptions` : un test **verrouille** le comportement contraire (§ 5), et `spec_read_aloud.md:52` décrit simplement la composition de la liste ;
- elle est **idempotente après le premier appel** : `localVoiceStatusFor(statusModel)` est mémorisé (`local-voice.js:303`, `Map` par modèle) → **un seul** appel `tts_local_status` par session, pas un par ouverture ;
- coût de cet appel : lecture d'état sur disque, sans processus (`tts_local.rs:632-639`).

### Ce que cette correction peut casser / coûter

1. **Changement visible pour tous** : les 4 voix locales apparaîtront désormais dans la liste même sur un poste sans moteur, libellées « … — modèle à télécharger » (`src/js/local-voice.js:90` `LOCAL_VOICE_NOT_INSTALLED_LABEL`, appliqué par `localVoiceChoiceLabel`, `local-voice.js:367-369`). C'est l'intention d'origine (l'utilisateur voit ce qui est possible), mais c'est un changement d'écran.
2. **La note « vérification du moteur en cours… »** disparaît au profit d'un état réel dès le premier appel réussi — si l'IPC échoue, l'état renvoyé est « non installé » (`local-voice.js:337-343` : `catch` → statut `installed: false`, jamais `null`), donc « pas encore installée » + quoi faire : jamais de blocage, mais **le message peut être pessimiste** en cas de panne passagère.
3. **Un appel IPC de plus** à l'ouverture des Paramètres (et à la bascule sur l'onglet Assistant) tant que l'état n'est pas connu. Négligeable, mais à savoir si un jour `tts_local_status` devient coûteux.
4. **Ancres de tests de source** : `voix-locale-choix.test.js:325-330` délimite le corps de `refreshReadAloudVoice` (jusqu'à `function showDownloadState(`) et exige qu'il **ne contienne pas** `downloadLocalVoiceModel` → la proposition est compatible, mais **toute** retouche du corps doit être relue sous cet angle (ne jamais y introduire d'appel de téléchargement).
5. **Aucune** conséquence sur la lecture elle-même : `read-aloud.js` n'est pas modifié ; le repli sur la voix système, la valeur historique `local:piper` et la mémorisation du choix restent identiques.

Recommandation complémentaire (hors correction minimale, à décider séparément) : ajouter le test du § 5 pour que la régression ne puisse pas revenir.

---

## 5. Un test protège-t-il ce réglage aujourd'hui ?

**Ce qui EST protégé** (tous verts : `npx vitest run` → **PASS (2956) FAIL (0)**) :

| Protection | Test |
|---|---|
| La section est bien dans l'onglet Assistant, avec son titre, son `<select>`, son état et ses notes | `src/js/reglage-voix-onglet-assistant.test.js:59-84` |
| Aucun doublon du réglage ailleurs dans l'interface | `src/js/reglage-voix-onglet-assistant.test.js:86-99`, `src/js/voix-locale-choix.test.js:211-229` |
| Une seule source de code remplit le sélecteur (appel à l'ouverture et à l'onglet) | `src/js/reglage-voix-onglet-assistant.test.js:100-116` |
| Le catalogue local → liste, **quand un état est fourni** | `src/js/voix-locale.test.js:206-214`, `src/js/voix-locale-choix.test.js:194-208` |
| La valeur historique `local:piper` et la mémorisation du choix | `src/js/voix-locale-choix.test.js:243-271`, `reglage-voix-onglet-assistant.test.js:146-170` |
| Aucun téléchargement hors geste | `src/js/voix-locale-choix.test.js:298-331` |
| La doc dit « Paramètres → onglet Assistant → Lecture des réponses » | `src/js/reglage-voix-onglet-assistant.test.js:310-340` |

**Ce qui n'est PAS protégé — le trou exact qui a laissé passer la régression :**

- **Aucun test ne vérifie que l'ouverture des Paramètres (ou le basculement sur l'onglet Assistant) produit une liste qui contient les voix locales** quand le réglage vaut `""` (défaut) ou une voix du système. Les tests existants appellent `voiceChoiceOptions(voices, <état explicite>)` : ils passent **même si l'appelant n'a jamais demandé l'état**. Ils vérifient le catalogue, **pas le branchement**.
- **Aucun test n'exécute `refreshReadAloudVoice`** : il n'est vérifié que par des regex de source (`reglage-voix-onglet-assistant.test.js:106-108`), qui ne disent rien de l'état transmis au rendu.
- **Pire** : un test **verrouille la condition fautive** — `src/js/voix-locale.test.js:212-213` :
  ```js
  // Sans l'état du moteur, la liste historique est inchangée (aucun doublon).
  expect(voiceChoiceOptions(voices).some((o) => o.value === LOCAL_VOICE_VALUE)).toBe(false);
  ```
  Toute correction qui rendrait la liste locale inconditionnelle **dans `voiceChoiceOptions`** casserait ce test. C'est pourquoi la correction proposée agit **dans `settings.js`**, pas dans `read-aloud.js`.

**Test manquant à ajouter** (à décider par le propriétaire) : un test qui (a) fixe `read_aloud_voice: ""`, (b) injecte un `invoke` factice répondant à `tts_local_status`, (c) exécute le rafraîchissement de la section, et (d) **exige** la présence des 4 valeurs locales dans les options du sélecteur — plus (e) le même contrôle avec une voix du système enregistrée. Sans (c), la régression reviendra au prochain remaniement du statut par modèle.

---

## 6. Ce que je n'ai pas pu vérifier

- La **configuration réelle** du poste du propriétaire (`%APPDATA%/com.pilot.editor/pilot-config.json`) : je n'ai pas lu le fichier. Le diagnostic repose sur le **défaut du code** (`read_aloud_voice: ""`, `lib.rs:1207`) ; si sa configuration contenait déjà `local:piper…`, la liste s'afficherait et le symptôme aurait une autre cause (à signaler si c'est le cas).
- Le comportement **à l'écran** de la version installée 0.5.0 : déduit du code du tag `v0.5.0` (identique à `HEAD` sur toutes les lignes citées), non observé par moi.

---

VERDICT : Ce n'est PAS une disparition ni un déplacement — la section « Lecture des réponses à voix haute » est intacte dans ⚙️ Paramètres → onglet Assistant (`index.html:1242`) ; c'est une RÉGRESSION d'affichage introduite le 2026-10-24 par le commit `52eb3ab` (publiée en v0.4.46 et v0.5.0) : la liste des voix n'obtient les voix locales que si un état de moteur lui est fourni (`read-aloud.js:342`), et `settings.js:652` ne demande cet état que si le réglage enregistré est DÉJÀ une voix locale — donc, avec le défaut `read_aloud_voice: ""`, les 4 voix locales sont invisibles ; correctif minimal = 3 lignes dans `refreshReadAloudVoice` (`settings.js:647-661`) pour toujours demander/transmettre l'état du modèle par défaut, corrigé NON appliqué (décision du propriétaire), et AUCUN test ne protège aujourd'hui cette apparition (un test verrouille même la condition fautive : `voix-locale.test.js:212-213`).
