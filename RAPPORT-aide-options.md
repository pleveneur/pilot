# Rapport — l'aide intégrée envoie vers les « Options »

**Lot demandé** : dans l'**aide intégrée** (blocs `<!-- HELP:… -->` des specs, agrégés en
`help/handbook.md`), remplacer « Paramètres ⚙️ » / « Paramètres → … » par **« Options »**
partout où l'aide désigne le panneau ouvert par le bouton ⚙. Lot **purement textuel**.

---

## 1. Résultat en une ligne

L'aide ne dit plus jamais « Paramètres » : **77 occurrences** corrigées dans **19 fichiers**
de specs (blocs HELP uniquement), `help/handbook.md` **régénéré** par `npm run build:handbook`,
et **0 occurrence** restante — ni dans le handbook, ni dans aucun bloc HELP des 24 sources.

---

## 2. Méthode (pour que le comptage soit vérifiable)

1. Extraction des blocs HELP avec **la regex exacte du générateur**
   (`scripts/build-handbook.js`, `HELP_RE` = `/<!--\s*HELP:(\S+?)\s*-->([\s\S]*?)<!--\s*\/HELP:\1\s*-->/g`)
   appliquée aux **24 `SOURCES`** → **45 blocs**.
2. Comptage **dans les blocs seulement** (jamais dans le corps des specs, jamais dans
   les commentaires) : `param(è|e)tres`, insensible à la casse → **77** occurrences.
3. Remplacement **confiné aux bornes des blocs** (le texte hors blocs est recopié à
   l'identique, fins de ligne préservées), puis vérification que **0** occurrence ne subsiste.
4. `npm run build:handbook` → handbook régénéré (jamais édité à la main).
5. Re-comptage, contrôle des blocs (aucun bloc vide, aucun doublon nouveau), tests.

---

## 3. Endroits corrigés (fichier → lignes après modification)

| Fichier | Bloc(s) HELP | Lignes | Occ. |
|---|---|---|---|
| `help/overview.md` | `demarrage`, `theme-parametres`, `terminal`, `multi-agents`, `lire-reponses`, `gds` | 117, 157, 159, 161, 167, 193, 372, 377, 407, 411, 416, 459, 539 | 13 |
| `spec_rpc.md` | `agent-pi` | 477, 488, 535, 541 | 4 |
| `spec_orchestration.md` | `orchestration` | 1000, 1006, 1018 | 3 |
| `spec_super_agent.md` | `super-agent`, `super-agent-mcp`, `super-agent-checklist`, `super-agent-tracabilite`, `super-agent-temps`, `super-agent-taches-longues` | 21, 27, 36, 66, 71, 87, 142, 152, 221, 238, 273, 280, 288, 332, 362, 475, 482, 1015, 1262, 1272, 1283, 1443, 1528, 1590, 1597, 1606, 1896, 2705, 2736, 2754, 2779, 2792, 2828 | 34 |
| `spec_anomaly.md` | `anomaly` | 103, 108, 114 | 3 |
| `spec_dashboard.md` | `dashboard` | 59, 77, 83 | 3 |
| `spec_telegram.md` | `telegram` | 54, 82, 166 | 3 |
| `spec_context_engine.md` | `context-engine` | 323, 337 | 2 |
| `spec_laya.md` | `laya` | 45, 115 | 2 |
| `spec_code_graph.md` | `code-graph` | 392 | 1 |
| `spec_diff_review.md` | `diff-review` | 133 | 1 |
| `spec_gestion_agents.md` | `agents` | 45 | 1 |
| `spec_orchestration_reviewer.md` | `orchestration` | 264 | 1 |
| `spec_pdf2md.md` | `pdf` | 80 | 1 |
| `spec_project_memory.md` | `project-memory` | 211 | 1 |
| `spec_session_history.md` | `session-history` | 220 | 1 |
| `spec_vault.md` | `vault` | 34 | 1 |
| `spec_voice_input.md` | `dictee-vocale` | 234 | 1 |
| `spec_web_remote.md` | `web-remote` | 562 | 1 |
| `help/handbook.md` | **régénéré** (pas édité à la main) | 78 lignes | 77 |

Les formes traitées sont toutes celles de l'aide : « **Paramètres ⚙️ → onglet « Assistant »** »,
« dans les Paramètres », « depuis les **Paramètres ⚙️** », « **Paramètres → Agents** »,
« **Paramètres ⚙️ → Avatar** », « section **Paramètres → RAG (Context Engine V2)** »,
« l'ouverture des Paramètres », « l'enregistrement des Paramètres », « (Options → Agent) »…

---

## 4. Tournures changées (et pourquoi)

Le simple remplacement du nom aurait laissé du français fautif ou redondant. Sept endroits
ont donc été retouchés — **le sens et les chemins (`→ onglet … → section …`) sont identiques** :

| Lieu | Avant | Après | Pourquoi |
|---|---|---|---|
| `help/overview.md:157` | `## Thème et paramètres` | `## Thème et Options` | titre du bloc qui définit le panneau ; il annonçait l'ancien nom en minuscule |
| `spec_laya.md:115-116` | « le bouton **Enregistrer** de la fenêtre des Paramètres » | « le bouton **Enregistrer** du panneau des Options » | le panneau n'est plus une fenêtre mais un onglet : « des Paramètres » → « du panneau des Options » |
| `spec_vault.md:34` | « le champ « Clé » **de** Paramètres → Serveurs MCP » | « le champ « Clé » **des** Options → Serveurs MCP » | article : « de Options » était fautif |
| `spec_rpc.md:488` | « dans son onglet **de** Paramètres » | « dans son onglet **des** Options » | même raison |
| `spec_super_agent.md:1528` | « dans **Paramètres → Assistant** » | « dans **les Options → Assistant** » | article manquant (« dans Options » ne se disait pas) |
| `spec_super_agent.md:1896-1897` | « le bouton ⚙ qui ouvre les **paramètres existants** de l'Assistant (modale Paramètres, onglet « Assistant ») » | « le bouton ⚙ qui ouvre les **Options** de l'Assistant (onglet « Assistant ») » | deux occurrences sur deux lignes + « modale » devenu faux (le panneau est un onglet) |
| `help/overview.md:161` | « **Paramètres ⚙️** : les Options s'ouvrent dans un onglet » | « **Options ⚙️** : les Options s'ouvrent dans un onglet » | phrase **volontairement laissée identique au README** (« Les Options s'ouvrent dans un onglet »), verrouillée par `libelle-options-ecran.test.js` (g) |
| `help/overview.md:411` | « ni dans un autre onglet des **paramètres** » | « ni dans un autre onglet des **Options** » | minuscule oubliée, même panneau |

---

## 5. Ce qui est laissé — et pourquoi

### 5.1 Faux amis (jamais renommés, conformément à la consigne)

| Endroit | Texte laissé | Pourquoi |
|---|---|---|
| `spec_laya.md` (bloc `laya`) | « rangés dans **« Réglages avancés »** » | nom du sous-bloc replié **du service de classification** (Laya), pas le panneau ⚙ |
| `spec_laya.md` (bloc `laya`) | « **Réglages** disponibles dans **Options → Service Laya** » / « **Réglages** : … » | « réglages » au sens générique de *settings*, pas le nom du panneau |
| `spec_super_agent.md` (bloc `super-agent-session-memory`) | « Réglages, Comportement, Apparence » | **rubrique de la mémoire de session** à conserver, pas le panneau |
| `spec_super_agent.md` | « `super_agent_checklist_mode` … **Réglages** : mode + modèle de points » | clés de configuration, pas le panneau |
| `index.html` / JS | « Réglages Windows », réglages du **système** | réglages de l'OS |
| partout | **commentaires de code**, messages de console, identifiants (`#btn-settings`, `read_aloud_voice`, `agent_timeout_ms`, mode d'onglet `settings`…) | identifiants et commentaires : hors texte vu par l'utilisateur |

### 5.2 Hors périmètre « aide intégrée » — **signalé, non touché**

Ces textes ne sont **pas** dans un bloc HELP (ils n'alimentent pas l'aide embarquée).
Je les laisse et les signale, comme demandé en cas de doute :

| Fichier | Occ. | Lignes | Nature |
|---|---|---|---|
| `README.md` | 5 | 112, 152, 230, 249, 253 | documentation **utilisateur** : `⚙️ **Paramètres → onglet « Assistant »**`, titre `### Paramètres (onglet ⚙️)`, « dans les Paramètres » (×2), « section « Accès distant » » |
| `spec_read_aloud.md` | 9 | 45, 89, 106, 116, 136, 214, 215, 241, 297 | spec fonctionnelle (dont la même phrase « ⚙️ **Paramètres → onglet « Assistant »** ») |
| corps des specs (hors blocs HELP) | 73 | réparties sur 22 specs (dont `spec_web_remote.md` 13, `spec_telegram.md` 10, `spec_orchestration.md` 6) | **documentation de développement** : elle décrit le panneau tel qu'il est nommé dans le code/les clés de config, elle n'est pas lue par l'utilisateur |

**Pourquoi je ne les ai pas touchés** : ce lot est l'**aide intégrée** ; le README garde une
décision ouverte du propriétaire (cf. `RAPPORT-renommage-options.md` §5.1, qui signalait déjà
le titre `### Paramètres` du README comme « à trancher ») et les corps de specs sont la
documentation de développement. À noter : ces restes créent une **divergence visible**
(le README dit « Paramètres → onglet « Assistant » » là où l'aide dit « Options → onglet
« Assistant » ») ; deux assertions de test la figent encore volontairement
(`reglage-voix-onglet-assistant.test.js` l. 334 pour le README, l. 342 pour la spec).
**Un lot « README + spec_read_aloud » de 14 occurrences suffirait à supprimer la divergence.**

---

## 6. Tests

### Avant (référence, avant toute modification)
```
npx vitest run   →  PASS (3162)   FAIL (0)
```

### Pendant (état intermédiaire, avant mise à jour des assertions)
`PASS (3157) FAIL (5)` — 5 tests lisaient l'ancien nom. **Aucun n'a été supprimé ; 3 assertions
ont été mises à jour** (les 2 autres sont redevenues vertes par une tournure conservée, cf. §4) :

1. `src/js/help-delai-inactivite.test.js:104` — `toContain("Paramètres → Agents")` → `"Options → Agents"`
   (l'aide du timeout dit désormais « **Options → Agents** »).
2. `src/js/reglage-voix-onglet-assistant.test.js:318` — le chemin exact du réglage de la voix dans
   l'aide : `/Paramètres → onglet\s*« Assistant »/` → `/Options → onglet\s*« Assistant »/`.
3. `src/js/reglage-voix-onglet-assistant.test.js:328` — le même chemin dans le handbook régénéré :
   `toContain("Paramètres → onglet")` → `toContain("Options → onglet")`.
   (+ le titre du test l. 310 : « donne Parametres → … » → « donne Options → … ».)

Les 2 tests redevenus verts sans être modifiés sont ceux qui exigent
`overview`/`handbook` contienne « **les Options s'ouvrent** » (`libelle-options-ecran.test.js`,
groupe (g)) : c'est exactement pourquoi la phrase du §4 ligne 161 a été conservée telle quelle.

### Après
```
npx vitest run   →  PASS (3162)   FAIL (0)
cargo test --manifest-path src-tauri/Cargo.toml --lib help::
                 →  4 passed; 0 failed; 1 ignored   (le handbook est embarqué par include_str!)
```

---

## 7. Recherche finale — commande exacte et résultat

```bash
grep -rn "Paramètres\|paramètres" help/handbook.md
```
**Résultat : aucune ligne** (code de sortie 1) — l'aide embarquée ne contient plus une seule
occurrence, majuscule ou minuscule.

Contrôle complémentaire, **dans les blocs HELP des 24 sources** (là où le handbook puise) :

```bash
node -e 'const fs=require("fs");const RE=/<!--\s*HELP:(\S+?)\s*-->([\s\S]*?)<!--\s*\/HELP:\1\s*-->/g;
let n=0;for(const f of ["help/overview.md","spec_pilot.md","spec_rpc.md","spec_orchestration.md","spec_web_remote.md","spec_voice_input.md","spec_pdf2md.md","spec_context_engine.md","spec_code_graph.md","spec_diff_review.md","spec_project_memory.md","spec_review.md","spec_orchestration_reviewer.md","spec_session_history.md","spec_gestion_agents.md","spec_agents_md.md","spec_multiprojects.md","spec_interproject.md","spec_super_agent.md","spec_dashboard.md","spec_vault.md","spec_anomaly.md","spec_telegram.md","spec_laya.md"]){const t=fs.readFileSync(f,"utf8");let m;RE.lastIndex=0;while((m=RE.exec(t))!==null)n+=(m[2].match(/param(è|e)tres/gi)||[]).length;}console.log(n)'
```

**Résultat : `0`.**

---

## 8. Comptes avant / après

| Mesure | Avant | Après |
|---|---|---|
| Blocs HELP (24 sources) | 45 | 45 |
| Occurrences « Paramètres/paramètres » **dans les blocs HELP** | **77** (19 fichiers) | **0** |
| `help/handbook.md` : « Paramètres » | 74 | **0** |
| `help/handbook.md` : « paramètres » | 3 | **0** |
| `help/handbook.md` : « Options » | 7 | **83** |
| `help/handbook.md` : blocs (`HELP-TOPIC`) | 45 | 45 |
| `help/handbook.md` : blocs vides | 0 | **0** |
| Fichiers modifiés | — | 19 specs + `help/handbook.md` + 2 fichiers de test |
| Lignes de texte modifiées | — | 78 (specs) + 78 (handbook) |
| Tests | 3162 ✓ / 0 ✗ | **3162 ✓ / 0 ✗** |

*Doublon de topic* : le handbook contient **deux blocs nommés `orchestration`**
(`spec_orchestration.md` et `spec_orchestration_reviewer.md`) → 45 blocs / 44 topics uniques,
**avant comme après** : ce n'est pas un doublon créé par ce lot.

---

## 9. Ce qui n'a pas bougé (garanties du lot)

- **Aucun fichier de code applicatif** : ni `src/js/**` (hors les 3 assertions de test citées),
  ni `src-tauri/**`. **Aucune couleur**, aucun style, aucun comportement.
- **Aucun libellé affiché** changé (le bouton ⚙ dit déjà « Options » depuis le lot précédent),
  **aucun identifiant** renommé (`#btn-settings`, `settings`, `read_aloud_voice`, `agent_timeout_ms`…).
- Aucune consigne perdue : les chemins (`→ onglet « Assistant » → section …`), les noms de
  réglages et les valeurs entre guillemets sont **identiques**, seul le nom du panneau change.
- `help/handbook.md` **n'a pas été édité à la main** : il est régénéré par `npm run build:handbook`
  (dont il porte l'en-tête `PILOT-HELP generated=…`).

---

## 10. Commandes à taper après ce lot

```bash
npm run build:handbook   # régénère l'aide embarquée (déjà fait ici)
npx vitest run           # 3162 ✓ / 0 ✗
```

VERDICT : l'aide intégrée envoie désormais vers les « Options » — 77 occurrences corrigées à la source, handbook régénéré, 0 occurrence restante, 7 tournures ajustées pour un français correct (et 1 phrase conservée telle quelle), 3162 tests verts comme avant ; restent (signalés, hors périmètre) 78 occurrences de « Paramètres » dans le README, la spec de lecture à voix haute et le corps des specs de développement.
