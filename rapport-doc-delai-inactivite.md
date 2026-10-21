# Délai d'inactivité — correction de la documentation (v0.4.35)

> Mission de DOCUMENTATION bornée. Aucun code applicatif modifié, aucune valeur de
> délai changée (ni dans le code, ni dans la configuration du poste), aucun push,
> aucun tag, aucune version modifiée. Un fichier de **test** est ajouté comme
> garde-fou ; la doc est corrigée ; ce rapport en rend compte.

---

## 1. Ce qui était faux (vérifié ligne par ligne avant correction)

Le rapport amont `rapport-delai-inactivite.md` a été relu, puis **chaque ligne citée
a été vérifiée sur le disque** — les cinq preuves sont exactes :

| Preuve amont | Vérification effectuée | Verdict |
|---|---|---|
| `lib.rs:993` → `default_agent_timeout_ms()` = `600000` | ligne lue : `fn default_agent_timeout_ms() -> u32 { 600000 }` | ✅ exact |
| `agents-bus.js:78` → `DEFAULT_TIMEOUT_MS` = `600000` | ligne lue : `const DEFAULT_TIMEOUT_MS = 600000; // 10 min d'inactivité…` | ✅ exact |
| `agents-bus.js:1778` → `config.agent_timeout_ms \|\| DEFAULT_TIMEOUT_MS` | ligne lue, identique | ✅ exact |
| `index.html:572-573` → `value="600000" min="10000" max="1800000"` | lignes lues, identiques | ✅ exact |
| `spec_gestion_agents.md:38` et `:366`, `help/handbook.md:1020` annoncent 5 min | lignes lues, identiques | ✅ exact |
| `agents_md.rs:28` → `GENERATE_TIMEOUT_SECS = 300` (autre sujet) | ligne lue ; c'est bien la génération d'`AGENTS.md` | ✅ **non touché** |
| commit `31707a9` n'a modifié aucun `.md` | `git show --stat 31707a9` : 4 fichiers, tous du code (`index.html`, `lib.rs`, `agents-bus.js`, `settings.js`) | ✅ exact |

**Conclusion confirmée :** la documentation annonçait une valeur périmée (5 min) alors
que le défaut réel est **600 000 ms = 10 minutes**, réglable via `agent_timeout_ms`.
« 5 minutes » et « 10 minutes » désignent **le même réglage**, pas deux mécanismes.

---

## 2. Ce qui a été corrigé

### 2.1 Aide utilisateur — `spec_gestion_agents.md:38` (bloc `HELP:agents`)

- **Avant** : « si un agent reste silencieux trop longtemps (5 min par défaut), la run
  s'arrête et un message le signale. Réglable dans **Paramètres → Agents**. »
- **Après** : « si un agent reste silencieux trop longtemps (**10 min par défaut**, soit
  600 000 ms), la run s'arrête et un message le signale. Réglable dans **Paramètres →
  Agents** (champ « Timeout d'inactivité (ms) », de 10 s à 30 min) ; la nouvelle valeur
  est relue à l'ouverture de l'onglet Agents ou au redémarrage de Pilot. »

Ajouts utiles pour l'utilisateur : la valeur réelle en minutes **et** en millisecondes
(l'écran n'affiche que des millisecondes), les bornes du réglage, et le fait que la
valeur n'est pas appliquée à chaud.

### 2.2 Section technique « Garde-fous » — `spec_gestion_agents.md:366`

- **Avant** : « Timeout d'inactivité : 300 s (5 min, défaut). Relevé de 120 s → 300 s… »
- **Après** : « Timeout d'inactivité : **600 000 ms (10 min, défaut)** —
  `default_agent_timeout_ms()` (`src-tauri/src/lib.rs`), même valeur côté front
  (`DEFAULT_TIMEOUT_MS`, `src/js/agents-bus.js`), dans le champ de l'interface
  (`index.html`, `min="10000"`, `max="1800000"`) et au repli d'enregistrement
  (`src/js/settings.js`). Réglable par `agent_timeout_ms` ; relevé de 120 s → 300 s
  (issue #10) puis de 300 s → 600 s (issue #19, commit `31707a9`) parce que les agents
  enchaînent des outils longs (codeur/builds). … Garde-fou :
  `src/js/help-delai-inactivite.test.js` compare la valeur annoncée ici et dans l'aide
  intégrée à la valeur réelle du code. »

L'historique est conservé (il explique **pourquoi** la valeur a bougé), mais la valeur
annoncée est désormais la valeur réelle.

### 2.3 Aide intégrée régénérée — `help/handbook.md:1020`

Régénérée par la procédure du projet (`npm run build:handbook`, script
`scripts/build-handbook.js`) : **42 blocs**, 195 008 octets. Le texte régénéré a été
relu et annonce bien « **10 min par défaut**, soit 600 000 ms ».

---

## 3. Ce qui empêche la divergence de revenir

Nouveau test : **`src/js/help-delai-inactivite.test.js`** (8 tests, Vitest).

Il ne code **aucune valeur en dur** : il dérive la valeur du cœur Rust
(`default_agent_timeout_ms()`), puis exige qu'elle soit la même partout :

| Vérification | Fichier lu |
|---|---|
| défaut Rust = nombre entier de minutes | `src-tauri/src/lib.rs` |
| repli du front = défaut Rust | `src/js/agents-bus.js` |
| valeur par défaut du champ de réglage = défaut Rust | `index.html` |
| repli à l'enregistrement = défaut Rust | `src/js/settings.js` |
| aide utilisateur : annonce `N min par défaut` + `NNN NNN ms`, réglage cité, ancienne valeur absente | `spec_gestion_agents.md` |
| section technique : annonce la même valeur, plus « 300 s (5 min, défaut) » | `spec_gestion_agents.md` |
| **aide intégrée = copie conforme de la spec** (donc : oublier `npm run build:handbook` fait rougir) | `help/handbook.md` |
| aucun des deux fichiers n'annonce plus « (5 min par défaut) » | les deux |

Le test normalise les fins de ligne (`.replace(/\r\n/g, "\n")`, règle §3.4 du
quality-gate) et les espaces insécables : il reste vert sur un worktree CRLF.

### 3.1 Preuve de non-vacuité (le test rougit vraiment)

| Mutation appliquée temporairement | Résultat | Restauration |
|---|---|---|
| remettre « (5 min par défaut) » dans `spec_gestion_agents.md:38` **sans** régénérer l'aide | **3 tests rouges** (dont « aide intégrée à jour ») | spec restaurée → 8/8 verts |
| passer `default_agent_timeout_ms()` à `900000` dans `lib.rs` **sans** toucher la doc | **5 tests rouges** | `lib.rs` restauré → 8/8 verts |

Les deux fichiers touchés pour la mutation ont été restaurés à l'octet près ; `git status`
ne montre aucune modification résiduelle sur `lib.rs`.

---

## 4. Vérifications exécutées

| Commande | Résultat |
|---|---|
| `npm run build:handbook` | ✅ 42 blocs, `help/handbook.md` régénéré |
| `npx vitest run src/js/help-delai-inactivite.test.js` | ✅ 8 tests |
| `npm test` (suite complète) | ✅ **121 fichiers, 2 070 tests**, 0 échec |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ✅ **651 réussis, 1 ignoré**, 0 échec |

Le Rust est testé bien qu'aucun fichier Rust ne soit modifié : `help/handbook.md` y est
embarqué par `include_str!`, une régénération doit donc être vérifiée aussi de ce côté.

### 4.1 Note sur les fins de ligne de l'aide générée

`npm run build:handbook` recopie le contenu des blocs HELP **tel quel**
(`fs.readFileSync(..., "utf8")`, `scripts/build-handbook.js`) : sur un worktree Windows
dont certaines specs sont encore en CRLF, le `help/handbook.md` **de travail** contient
donc des CRLF mélangés (1 025 mesurés après la régénération). L'**index Git reste en LF**
(`.gitattributes`, `eol=lf`) : le commit ne contient aucune fin de ligne CRLF, et le
diff se limite à 2 lignes. Le nouveau test normalise sa lecture
(`.replace(/\r\n/g, "\n")`), conformément au § 3.4 du quality-gate.

---

## 5. Ce qui reste (hors périmètre de cette mission)

1. **Rapports amont non versionnés** — `rapport-delai-inactivite.md`,
   `rapport-file-attente-pertes-doublons.md`, `rapport-relecture-file.md`,
   `geminiReport.md` sont présents à la racine mais **non suivis** par Git. Ils
   appartiennent à d'autres missions : ni commités ni modifiés ici.
2. **`spec_anomaly.md:257`** mentionne `agent_timeout_ms` sans en donner la valeur :
   rien de faux, donc rien corrigé (mission bornée).
3. **`spec_agents_md.md:76` et `:125`** annoncent « Timeout 300 s (5 min) » : c'est
   **juste**, cela concerne la génération d'`AGENTS.md` (`agents_md.rs:28`), un autre
   mécanisme non réglable. **Volontairement non touché.**
4. **Documentation de la file d'attente et de l'arrêt automatique d'agent** : sujets
   distincts, traités par d'autres missions, non encore figés → non touchés.
5. **Confort d'interface (non fait, et hors mission)** : le libellé
   « Timeout d'inactivité (ms) » (`index.html:572`) n'affiche pas l'équivalence en
   minutes. Ce serait le vrai remède ergonomique à la confusion 5 / 10 / 30 min, mais
   cela touche le code applicatif → à traiter dans une mission dédiée.
6. **Valeur du poste** : `config.json` portait `agent_timeout_ms = 1800000` (30 min)
   pour la version installée. **Non modifiée** (interdiction explicite) : la
   documentation décrit maintenant le **défaut**, pas la valeur de ce poste.
7. **Aucune publication** : ni push, ni tag, ni `release-notes/` modifié.

---

*Preuves de l'état corrigé : `spec_gestion_agents.md:38`, `spec_gestion_agents.md:366`,
`help/handbook.md:1020`, `src/js/help-delai-inactivite.test.js`.*
