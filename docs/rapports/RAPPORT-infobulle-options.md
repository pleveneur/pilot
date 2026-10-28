# RAPPORT — L'infobulle du bouton dit « Options »

Lot unique et minuscule : **le mot seul**. Aucun identifiant, aucune classe CSS,
aucune cle de configuration, aucun nom de fonction, aucune disposition, aucune
icone, aucune couleur, aucun comportement n'a change.

---

## 1. Etat avant

Le panneau s'appelait deja **« Options »** partout ou il se nomme :

| Endroit | Avant |
|---|---|
| `index.html`, bouton `#btn-settings`, libelle visible (`.ga-label`) | `Options` |
| `index.html`, titre du panneau (`.settings-head-title`) | `Options` |
| `src/js/tabs.js`, titre de l'onglet | `Options` |
| `src/js/main.js`, categorie et commande de palette | `Options` / `Ouvrir les Options` |

Mais **son infobulle** disait encore `Paramètres` :

```html
<button id="btn-settings" title="Paramètres">…<span class="ga-label">Options</span></button>
```

Deux mots differents pour la meme chose, au meme endroit, au survol.

En cherchant ailleurs (texte **vu par l'utilisateur** qui designe CE panneau-la),
j'ai trouve **12 occurrences dans 8 fichiers** (recompte sur le disque, aucune
reprise de la demande) :

| # | Fichier | Nature du texte |
|---|---|---|
| 1 | `index.html` | infobulle du bouton `#btn-settings` |
| 2 | `src/js/main.js` | toast « agent indisponible » |
| 3 | `src/js/tabs.js` | texte du bouton de l'ecran guide « agent indisponible » |
| 4 | `src/js/agents-bus.js` | message de timeout d'inactivite |
| 5-6 | `src/js/face-gateway.js` | message « le visage ne repond pas » (2 chemins) |
| 7 | `src/js/mcp-secret-scope.js` | refus MCP en mode strict |
| 8-10 | `src/js/screen-guard.js` | les 3 messages du garde-fou d'ecran |
| 11 | `src/js/vault.js` | infobulle de la reference du coffre |
| 12 | `src/js/super-agent.js` | infobulle du bouton de l'Assistant immersif |

## 2. Etat apres

**12 occurrences → 0** en texte vu par l'utilisateur, dans ces 8 fichiers :

| Avant | Apres |
|---|---|
| `title="Paramètres"` (bouton) | `title="Options"` |
| `Ouvre les ⚙️ Paramètres pour corriger le chemin.` | `Ouvre les ⚙️ Options pour corriger le chemin.` |
| `⚙️ Ouvrir les paramètres` (bouton) | `⚙️ Ouvrir les Options` |
| `Augmentez le timeout dans Paramètres (agent_timeout_ms).` | `… dans Options (agent_timeout_ms).` |
| `Démarre le visage (Paramètres → Avatar) puis réessaie.` ×2 | `… (Options → Avatar) …` |
| `… dans les Paramètres → Serveurs MCP.` | `… dans les Options → Serveurs MCP.` |
| `(Paramètres → Serveurs MCP)` ×3 | `(Options → Serveurs MCP)` |
| `… à choisir dans Paramètres › Serveurs MCP.` | `… à choisir dans Options › Serveurs MCP.` |
| `title="Paramètres de l'assistant"` | `title="Options de l'assistant"` |

L'infobulle reprend la **forme courte et sobre** des infobulles voisines
(`title="Brouillon (Ctrl+Shift+N)"`, `title="Client(s) distant(s) connecté(s)…"`) :
un seul mot, pas de phrase.

## 3. Fichiers touches

- `index.html` (1 ligne)
- `src/js/main.js` (1 ligne)
- `src/js/tabs.js` (1 ligne)
- `src/js/agents-bus.js` (1 ligne)
- `src/js/face-gateway.js` (2 lignes)
- `src/js/mcp-secret-scope.js` (1 ligne)
- `src/js/screen-guard.js` (3 lignes)
- `src/js/vault.js` (1 ligne)
- `src/js/super-agent.js` (1 ligne)
- `src/js/libelle-options-ecran.test.js` (**mis a jour, jamais supprime** : 1 test
  d'infobulle ajoute + 8 tests de balayage, + l'en-tete du fichier precise le
  nouveau verrou `(h)`)
- `RAPPORT-infobulle-options.md` (ce rapport)

Soit 11 insertions / 11 suppressions de texte affiche, plus les tests.

## 4. Ce qui a ete LAISSE, et pourquoi

### 4.1 Faux amis declares (le mot ne dit pas le panneau)

- `index.html:1047` — « Parametre GLOBAL (actif par defaut) » : un reglage GDS au
  singulier, pas le panneau.
- `src/js/face-gateway.js:69` — « Parametres de requete » : parametres d'URL.
- `src-tauri/src/super_agent.rs:5426` — « Parametres invalides » : message de
  deserialisation generique.

### 4.2 Commentaires et messages de console (jamais affiches a l'utilisateur)

Consigne respectee : non touches. Comptes exacts sur le disque :
`index.html:430`, `src/js/settings.js:671`,
`src/js/super-agent.js` l.55/2744/3360/7737, `src/js/vault.js:193`,
`src/js/mcp-secret-scope.js:4`, `src/js/settings.js` l.293/381/1965 (`console.*`),
plus les commentaires de `dashboard.js`, `read-aloud.js`, `local-voice.js`,
`models-config.js`, `plface-utils.js`, `telegram-notify-setting.js`.

**Divergence signalee (non corrigee, car c'est un commentaire)** :
`src/js/tabs.js:596` commente encore « bouton « Ouvrir les parametres » » alors
que le bouton dit desormais « ⚙️ Ouvrir les Options ». Le test ajoute vise
volontairement le **texte du bouton** (`>⚙️ Ouvrir les Options</button>`), pas le
commentaire.

### 4.3 Doute assume — non touche, signale

- `index.html:458` — `aria-label="Catégories de paramètres"` sur la liste
  d'onglets. Ce libelle (lu par un lecteur d'ecran) decrit le **contenu** du
  panneau au sens generique, il ne le **nomme** pas. En cas de doute : non
  touche. A trancher par le proprietaire (« Categories d'options » ?).

### 4.4 Autres couches — hors perimetre de ce lot (front-end)

Signale, **non modifie** : ces textes sont eux aussi vus par l'utilisateur, mais
ils vivent dans un autre langage ou dans la documentation, avec leur propre
compilation ou leur propre regeneration :

- **Rust (messages d'erreur remontes a l'ecran)** — 14 lignes :
  `gds_client.rs:179`, `gds_handover.rs` l.1187/1199/1213/1232/1243,
  `gds_sync.rs` l.833/1113, `gds_web.rs` l.107/119 (`"GDS désactivé globalement
  (Paramètres → GDS)"`, 10 lignes au total) ; `group_assistant.rs:42` ;
  `mcp_config.rs:993/998` (`… : Paramètres → Serveurs MCP`) ;
  `super_agent.rs:1282` (`Paramètres → Assistant → « Supprimer les rappels
  inutiles »`).
- **Documentation utilisateur / aide integree** — 29 occurrences dans
  `help/overview.md`, `README.md` et les `spec_*.md` (dont
  « Paramètres → onglet « Assistant » » et « Paramètres → Agents »). Les
  renommer exige `npm run build:handbook` **et** la mise a jour de tests de
  documentation verrouilles (`reglage-voix-onglet-assistant.test.js`,
  `help-delai-inactivite.test.js`) : c'est un lot a part entiere.

`help/handbook.md` n'a **pas** ete touche et `npm run build:handbook` n'a **pas**
ete lance : aucun bloc `<!-- HELP:* -->` n'a change.

## 5. Tests

### 5.1 Comptes avant / apres (`npx vitest run`, suite complete)

| | Tests passes | Echecs |
|---|---|---|
| **Avant** (aucune modification) | **3153** | **0** |
| **Apres** | **3162** | **0** |

(+9 tests : 1 verrou d'infobulle + 8 verrous de balayage. Aucun test supprime,
aucun test desactive.)

### 5.2 Preuve que le test MORD

Le verrou ajoute dans `src/js/libelle-options-ecran.test.js` :

```js
expect(m[0], "l'infobulle du bouton ne dit plus « Options »").toContain('title="Options"');
expect(m[0], "l'infobulle du bouton dit encore « Parametres »").not.toContain("Paramètres");
```

Experience faite (aller-retour reel sur le disque, puis restauration) :

| Etat de `index.html:83` | Resultat de `npx vitest run src/js/libelle-options-ecran.test.js` |
|---|---|
| `title="Paramètres"` (remis temporairement) | **PASS (22) FAIL (1)** — echec : « l'infobulle du bouton ne dit plus « Options » » |
| `title="Options"` (etat livre) | **PASS (23) FAIL (0)** |

Le test echoue donc bien si « Parametres » revient dans cette infobulle.

### 5.3 Autres verifications

- `node --check` : OK sur les 9 fichiers JS touches (syntaxe ESM valide).
- `git diff` relu ligne a ligne : uniquement du **texte affiche**, aucun
  identifiant (`btn-settings`, `settings-modal`, `ga-label`,
  `sa-immersive-settings`, `pi-health-open-settings`, `data-settings-tab`,
  mode d'onglet `settings`), aucune classe CSS, aucune cle de configuration.
- Fin de ligne : `.gitattributes` (`eol=lf`) inchange ; le fichier de test
  normalise deja ses lectures (`.replace(/\r\n/g, "\n")`) et les nouvelles
  lectures reutilisent ce meme lecteur.
- Aucun garde-fou contourne, aucun fichier supprime, aucune commande Git de
  nettoyage ou de reinitialisation lancee.

## 6. Ce qui reste a faire (propose, non fait)

1. Lot « Rust » : aligner les 14 messages d'erreur listes en 4.4 (necessite
   `cargo test --manifest-path src-tauri/Cargo.toml --lib`).
2. Lot « documentation » : aligner `help/overview.md`, `README.md` et les specs,
   puis `npm run build:handbook`, en mettant a jour les deux tests de
   documentation verrouilles.
3. Trancher le `aria-label="Catégories de paramètres"` (`index.html:458`).
4. Rafraichir le commentaire `src/js/tabs.js:596` (libelle de bouton cite).

---

VERDICT : L'infobulle du bouton `#btn-settings` dit « Options » (forme courte,
comme ses voisines) et les 12 mentions vues par l'utilisateur qui nommaient ce
panneau « Parametres » dans le front-end disent desormais « Options » ; les faux
amis, commentaires et messages de console sont intacts ; la suite passe de 3153
a 3162 tests sans echec et le nouveau verrou echoue bien si « Parametres » revient
dans l'infobulle. Restent (signales, hors lot front-end) les 14 messages Rust et
les 29 mentions de la documentation.
