# Spec — Réponse sur la documentation de Pilot (« Aide »)

> Répondre en langage naturel à une question sur l'utilisation / le paramétrage
> de Pilot, à partir du **handbook** (doc condensée, orientée utilisateur,
> toujours à jour).
>
> **Statut : l'ÉCRAN « ❓ Aide » a été RETIRÉ.** Le bouton du haut de la colonne,
> l'onglet Aide, son module d'écran et son mode d'onglet n'existent plus (§9).
> La brique qui répond reste — c'est le **socle** (§4.4) et son **outil pour
> l'Assistant** (§4.5) : c'est l'onglet **Assistant** qui répond désormais sur
> la documentation. Ordre décidé : l'outil d'abord, le retrait ensuite.
> Depuis §4.6, la documentation est en plus **écrite en fichiers lisibles** au
> démarrage, que l'Assistant peut ouvrir directement.

---

## 1. Objectif

Permettre à l'utilisateur d'obtenir de l'aide contextuelle sur Pilot sans
quitter l'application, en langage naturel. La base de connaissance (handbook)
est **générée à la compilation** depuis la documentation du projet et reste
donc synchronisée avec la version installée. **Le point d'entrée est l'onglet
Assistant (🧭)**, il n'y a plus d'écran d'aide séparé.

## 2. Architecture

```
┌─ Frontend ────────────────────────────────────────────────────┐
│  Onglet Assistant (🧭) — src/js/super-agent.js                 │
│  └─ outil `answer_from_documentation(question)`               │
│     relayé par le sentinel PILOT_ASSISTANT_DOC:: (§4.5)       │
│     → invoke("ask_help_doc", { question })                    │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌─ Backend (src-tauri/src/help.rs) ────────────────────────┐
│  HANDBOOK → include_str!("../../help/handbook.md")      │
│  answer_from_handbook(state, question) → HandbookAnswer │
│  ask_help_doc(question)  = la commande du socle          │
│  ask_help(question, history) = emballage historique      │
│    (pi --mode rpc --no-session, process TEMPORAIRE)     │
└─────────────────────────────────────────────────────────┘
```

**Isolation** : un **processus pi temporaire `--no-session`**. La session de
coding principale (`rpc_state`) n'est **jamais touchée** → aucune pollution.

> L'écran Aide appelait `ask_help` (historique réinjecté côté front). L'écran
> étant retiré, plus aucun fichier de `src/js/` n'appelle `ask_help` ; la
> commande reste enregistrée (socle) et n'a **pas** été supprimée.

## 3. Source de connaissance — le handbook

### 3.1 Blocs HELP marqués

Chaque spec porte sa propre version « aide » condensée, orientée utilisateur,
sous forme de blocs marqués :

```markdown
<!-- HELP:web-remote -->
## Accès distant (téléphone / autre poste)
- Paramètres ⚙️ → « Accès distant » → activer l'accès web + mot de passe.
- Adresse d'écoute = 127.0.0.1 (obligatoire pour Tailscale Serve).
- Cocher « Exposer en HTTPS automatique (Tailscale Serve) » → URL + QR code.
<!-- /HELP:web-remote -->
```

### 3.2 Fichiers sources

| Fichier | Blocs HELP |
|---|---|
| `help/overview.md` (rédigé, orienté utilisateur) | `overview`, `demarrage`, `raccourcis`, `theme`, `terminal`, `recherche` (généralités stables) |
| `spec_rpc.md` | `agent-pi` |
| `spec_orchestration.md` | `orchestration` |
| `spec_web_remote.md` | `web-remote` |
| `spec_voice_input.md` | `dictee-vocale` |
| `spec_pdf2md.md` | `pdf` |

> Le README reste propre (pas de marqueurs) : les généralités vont dans
> `help/overview.md` (fichier aide dédié, orienté utilisateur).

### 3.3 Génération à la compilation

- `scripts/build-handbook.js` (Node) agrège tous les blocs `<!-- HELP:* -->` des
  fichiers sources (ordre défini) → `help/handbook.md` (fichier **généré**).
- En-tête auto : `<!-- PILOT-HELP generated=<date> topics=... -->`.
- Lancé en `prebuild` (avant `tauri dev` / `tauri build`).
- Embarqué dans le binaire via `include_str!("../../help/handbook.md")` → toujours
  présent, pas de gestion de path ni de resource Tauri.

## 4. Backend LLM — Option A (pi cadré)

### 4.0 Séquence RPC synchronisée (point critique)

Pi traite les commandes RPC de façon **asynchrone/désordonnée** : l'accusé
`new_session` peut arriver APRÈS celui de `prompt`. Si l'on envoie
`new_session` + `set_model` + `prompt` d'affilée sans attendre les accusés,
`new_session` traité en dernier réinitialise la session et **le prompt est perdu**
→ aucune réponse streamée (erreur « Aucune réponse reçue »).

`ask_pi_for_help` envoie donc les commandes **en séquence**, en attendant
l'accusé `{"type":"response","command":<cmd>,"success":true}` de chaque commande
avant d'envoyer la suivante :

1. `new_session` → attendre `response` success
2. `set_model` → attendre `response` success (sinon erreur « modèle invalide »)
3. `prompt` → collecter le stream `message_update`/`text_delta` jusqu'à `agent_end`

La lecture stdout se fait dans un **thread dédié** + canal `mpsc` avec
`recv_timeout` (pour un timeout réel, impossible avec un `BufReader::lines()`
bloquant). stdin reste **ouvert** pendant le stream (pi a besoin du canal
ouvert) ; le process est tué après `agent_end`.

**Garde-fous robustesse** :
- Timeout **global** strict (120s) vérifié en début de chaque itération — sans
  cela, une inférence qui streame en continu (thinking_delta) ne déclencherait
  jamais le timeout (`recv_timeout(Duration::ZERO)` renvoie les lignes en
  attente → boucle infinie).
- stderr lu dans un **thread séparé** (non-bloquant) : sur Windows, `pi.cmd` →
  `node` survit à `kill()`, stderr resterait ouvert, et un `read_to_string`
  bloquant penderait indéfiniment.
- `try_wait` (non-bloquant) au lieu de `wait()` pour la même raison.
- Un **test d'intégration** `#[ignore]` (`integration_ask_pi_for_help`) valide la
  séquence réelle : `cargo test --lib -- --ignored integration_ask_pi_for_help`.

### 4.1 Prompt envoyé à pi

```
MODE AIDE PILOT. Tu es l'assistant d'aide de l'éditeur Pilot.
Réponds UNIQUEMENT à partir du HANDBOOK ci-dessous. N'utilise AUCUN outil,
ne lis ni ne modifie aucun fichier, n'exécute aucune commande. Si la question
sort du cadre de Pilot, dis-le clairement et oriente vers la documentation.
Réponds en français, de façon claire et concise, en Markdown.

=== HANDBOOK ===
<contenu du handbook>
=== FIN HANDBOOK ===

[Historique de la conversation d'aide]
Utilisateur : <q1>
Assistant : <r1>
...

Nouvelle question : <question>
```

### 4.2 Modèle utilisé

Pi `--no-session` n'a **pas de modèle par défaut** : sans `set_model` explicite,
le prompt ne produit aucune réponse → erreur « Aucune réponse reçue ». Le socle
résout donc un modèle avant chaque appel (§4.4).

**Réglage `help_model` — CONSERVÉ** (ne pas le supprimer, ni le renommer) :

- il est toujours **préservé** par `settings.js` dans l'objet config renvoyé à
  `save_config` (sinon un enregistrement des Paramètres l'écraserait) ;
- c'est le **repli de la Revue de code** (modèle de revue, sinon `help_model`,
  sinon premier modèle disponible) ;
- c'est l'étage intermédiaire de la résolution du socle (modèle de l'Assistant →
  `help_model` → défaut de la configuration) ;
- la commande `set_help_model` reste enregistrée.

> Depuis le retrait de l'écran (§9), **plus aucun écran n'édite `help_model`** :
> l'ancienne liste déroulante en haut de l'onglet a disparu. La valeur reste
> lisible en configuration et sert de repli — c'est volontaire.

### 4.4 Socle réutilisable — « répondre à partir de la documentation »

La brique qui existait à l'intérieur de l'écran Aide est **extraite** et rend un
résultat **structuré** (`help::HandbookAnswer`), sans écran :
`answer = texte`, `cited_sections`, `insufficient`, `truncated`.

| Élément | Valeur / règle |
|---|---|
| Cœur | `help::answer_from_handbook(state, question)` — **une seule entrée** (la question) : aucun chemin de projet, aucun historique, aucun fichier. |
| Commande | `ask_help_doc(question)` → `HandbookAnswer` (enregistrée à côté des autres). |
| Écran Aide | `ask_help(question, history)` reste un **simple emballage** de la même brique (`run_help_prompt` + prompt avec historique) : même modèle `help_model`, même message d'erreur, même retour texte. |
| Marqueur d'insuffisance | Le prompt impose `DOCUMENTATION_INSUFFISANTE:` **en tête** de réponse quand la doc ne dit rien. Le programme **retire** le marqueur et lève `insufficient` — déterministe, testable sans modèle. Un marqueur au milieu du texte n'est pas interprété. |
| Plafond de sortie | `MAX_ANSWER_CHARS = 6000`. Au-delà : coupure **propre** (fin de phrase, sinon fin de mot, jamais dans un mot), `truncated = true`, et la coupure est **dite dans le texte** rendu. |
| Sections citées | Calculées **par le programme** (jamais déclarées par le modèle) : recoupement des `##`/`###` du corpus avec le texte rendu, donc toujours des titres qui **existent** dans le handbook. **Approximatif par construction** — ne jamais le présenter comme une « source exacte ». |
| Modèle | Repli : modèle de l'Assistant → réglage d'aide existant (`help_model`) → défaut de la configuration, via `super_agent::resolve_super_agent_model`. Aucun modèle → **erreur explicite** (jamais un échec silencieux) : la brique ne dépend plus d'un réglage que seul l'écran Aide écrivait. |

**Tests purs, sans modèle** (`help::tests`) : marqueur → drapeau + retrait ;
réponse trop longue → coupure propre + drapeau + coupure dite ; toute section
citée existe dans le corpus ; résolution du modèle (3 étages + cas « rien
disponible » → erreur). Ces tests échouent si l'un des gestes est retiré.

> Le réglage `help_model` est **conservé** (la Revue s'en sert comme repli), et
> le style de l'écran Aide n'est pas touché (partagé par la Revue et
> l'Historique).

### 4.5 L'Assistant appelle la réponse documentaire (outil `answer_from_documentation`)

Lot intermédiaire de la disparition de l'écran Aide : l'**Assistant** (onglet 🧭)
peut désormais **appeler** la réponse sur la documentation. Rien n'est encore
retiré de l'écran Aide.

| Élément | Valeur / règle |
|---|---|
| Outil | `answer_from_documentation(question)` — déclaré par `src-tauri/extensions/pilot-assistant-doc.ts`. **Une seule entrée** (la question) : aucun chemin de projet, aucun fichier, aucun historique — l'inverse des outils de lecture de projet. **Lecture seule**, n'écrit rien. |
| Brique | Aucune duplication : le relais de l'interface exécute la commande du socle `ask_help_doc` (§4.4). Aucun second prompt, aucune lecture de fichier. |
| Relais | **Un seul point** : `super-agent.js` reconnaît le sentinel `PILOT_ASSISTANT_DOC::` (à côté des autres sentinels d'outils de l'Assistant), exécute `ask_help_doc` et renvoie le JSON `HandbookAnswer` comme `value`. |
| Plafond | **Un seul appel par tour.** Chaque appel renvoie toute la documentation au modèle : le 2ᵉ appel du même tour est **refusé** avec un message qui dit pourquoi, quoi faire, et interdit d'inventer ; il n'atteint pas Pilot (aucun coût). Remise à zéro au début du tour suivant (hook `before_agent_start`). |
| Sortie (honnête) | Texte de la réponse, **sections de doc qui recoupent** la réponse (recoupement approximatif par titre, jamais présenté comme une citation exacte), avertissement explicite **« la documentation ne dit rien »** quand `insufficient` est levé, mention de la coupure quand `truncated`. Une erreur de Pilot est dite, jamais masquée. |
| Déclaration | Le fichier d'extension est écrit sur disque dans les **deux** listes de `agent_service.rs` (`write_assistant_extensions`, `spawn_superagent_session`) : sans les deux, l'outil n'existe pas. |

**Tests** (`src/js/assistant-outil-doc.test.js`) : le **test de câblage** échoue si
l'extension n'est pas déclarée (une seule liste, outil renommé) ou si le relais
de l'interface manque / utilise un sentinel **différent** ; le **test du plafond**
échoue si le 2ᵉ appel n'est plus refusé ou si le compteur n'est plus remis à zéro
au tour suivant.

### 4.6 Documentation de Pilot LISIBLE sur disque (l'Assistant la consulte)

L'Assistant ne pouvait répondre aux questions de mode d'emploi qu'en passant par
l'outil documentaire (`answer_from_documentation`). Il peut désormais **lire la
documentation comme des fichiers**, sans rien réécrire ni dupliquer.

| Élément | Valeur / règle |
|---|---|
| Où | `<app_data_dir>/aide/` (dossier de données de l'application, sous-dossier `aide`). Chemin **annoncé** à l'Assistant = chemin **écrit**, même fonction `help::doc_dir`. |
| Quoi | `index.md` (sommaire cliquable) + **un fichier par thème** (`overview.md`, `agent-pi.md`, `super-agent.md`…). |
| Contenu | Le bloc du handbook **tel quel** — aucune réécriture de fond, aucun second contenu. Deux blocs déclarant le **même** thème sont fusionnés dans le fichier de ce thème. |
| Découpage | Sur les marqueurs `<!-- HELP-TOPIC:<slug> -->` que `scripts/build-handbook.js` place devant chaque bloc. Le séparateur `---` ne peut pas servir de frontière : un bloc peut légitimement en contenir un. |
| Quand | **Au démarrage** (`setup` de `run()` → `help::write_startup_docs`, appel direct vérifié par un test). |
| Idempotent | Un fichier dont le contenu est déjà exact n'est **pas réécrit** (0 écriture) ; seule une différence provoque une écriture. |
| Fail-open | Un échec d'écriture est signalé (`eprintln`) et **ne bloque jamais** le démarrage. Aucun réseau. |
| Sécurité | Le slug d'un thème est réduit aux caractères sûrs : aucun séparateur de chemin ne peut venir du handbook. |

**Prompt de l'Assistant** (`SUPER_AGENT_DOC_PROMPT` dans `super_agent.rs`) : il
porte le **chemin exact**, la nature du contenu (`index.md` + un fichier par
thème) et les **deux règles** exigées :

1. une question de **mode d'emploi** se répond **directement**, avec ce que dit
   la documentation — elle n'est **jamais** déléguée à un agent ;
2. si la documentation **ne dit rien** sur le point demandé, le dire clairement
   **au lieu d'inventer**.

**Garde-fou mémoire** : la mémoire de suivi n'est écrite que par les outils de
l'Assistant lui-même (`update_session_memory`, `create_task`, `add_decision`…).
La voie la plus simple ET la plus sûre est donc une **règle explicite dans le
prompt** : une question de mode d'emploi ne laisse **rien** dans la mémoire
(aucune tâche, décision, note de projet, mémoire de session ni utilisateur).
Aucune modification du code d'écriture de la mémoire — aucun second mécanisme.

> L'écran, le bouton et l'onglet Aide restent retirés (§9) et `help_model` reste
> tel quel (repli de la Revue). Rien d'autre ne bouge.

**Tests** (tous **échouent** si le geste est retiré) :

| Test | Ce qu'il verrouille |
|---|---|
| `help::tests::la_documentation_est_ecrite_en_fichiers_lisibles_au_bon_endroit` | Fichiers produits dans `<app_data_dir>/aide/`, index complet dont chaque lien existe, contenu réel, idempotence (0 puis 1 écriture). |
| `help::tests::le_decoupage_par_theme_suit_les_marqueurs_du_handbook` | Découpage par marqueur (`---` interne non coupant), en-tête hors thème, fusion des thèmes homonymes, handbook sans marqueur → erreur explicite. |
| `help::tests::le_nom_de_fichier_dun_theme_est_sur` | Aucun chemin ne peut sortir du dossier. |
| `help::tests::lecriture_au_demarrage_est_branchee_dans_le_setup` | L'appel `help::write_startup_docs(&handle);` existe **non commenté** dans `lib.rs`. |
| `super_agent::tests::assistant_prompt_names_readable_docs_path_and_both_rules` | Le prompt contient le **chemin**, `index.md`, `read`, la règle (a), la règle (b) et le garde-fou mémoire. |

### 4.3 Historique multi-tours

Le process pi étant `--no-session` et tué après chaque réponse, il n'a pas de
mémoire entre les tours. **Le socle (`ask_help_doc`) n'a volontairement aucun
historique** : une seule entrée, la question (§4.4). L'emballage `ask_help`
accepte, lui, un historique — il servait à l'écran Aide, désormais retiré.

## 5. UX

- **Aucun écran d'aide dédié.** Le point d'entrée est la conversation de
  l'**Assistant** (🧭) : on lui pose la question, il appelle l'outil
  `answer_from_documentation` et répond (Markdown, sections recoupées).
- Le haut de la colonne de gauche ne garde que **deux portes** : « Brouillon » et
  « Réglages ». Aucune porte de remplacement n'a été ajoutée (aucune place
  réservée).
- Quand la documentation ne dit rien, la réponse le dit explicitement ; si elle
  est trop longue, la coupure est annoncée.

## 6. Maintenance (mise à jour au fil des évolutions)

| Mécanisme | Rôle |
|---|---|
| Règle `AGENTS.md` | À chaque évolution impactant l'utilisateur → mettre à jour le bloc `<!-- HELP:* -->` de la spec concernée (ou `help/overview.md` pour les généralités). |
| `npm run build:handbook` | Regénère `help/handbook.md` depuis les blocs HELP. Lancé en `prebuild`. |
| Fichier versionné | `help/handbook.md` est commité (artifact stable) pour que `cargo build` direct fonctionne même sans npm. |

> Le Niveau 2 ajoutera : `npm run check:handbook` (vérifie blocs bien formés +
> topics obligatoires, gate CI), badge de version, feedback « réponse
> insuffisante », streaming.

## 7. Garde-fous

- **Pas d'accès aux fichiers** du projet utilisateur : l'aide ne voit QUE le
  handbook (jamais le code, les fichiers, ni la conversation de coding).
- **Pas d'outil** : le prompt cadré interdit tout tool use ; pi est lancé en
  `--no-session` (process jetable) → même si pi tentait un tool, il n'aurait pas
  de session projet pertinente.
- **Hors-scope géré** : le cadrage demande au LLM de dire « hors-scope » et
  d'orienter vers la doc si la question ne concerne pas Pilot.
- **Coût** : ~5-15k tokens/requête (handbook + historique) ; acceptable pour un
  usage ponctuel. Rate-limiting optionnel au Niveau 2.

## 8. Fichiers

| Fichier | Rôle |
|---|---|
| `help/overview.md` | Source aide : généralités (rédigé, orienté utilisateur) |
| `help/handbook.md` | **Généré** (ne pas éditer) — embarqué via `include_str!` |
| `scripts/build-handbook.js` | Agrégation des blocs HELP + marqueurs `<!-- HELP-TOPIC:x -->` (frontières des fichiers lisibles, §4.6) |
| `src-tauri/src/help.rs` | `HANDBOOK` (const), **documentation lisible** (`handbook_topics`, `doc_files_of`, `write_doc_files`, `write_startup_docs`, `doc_dir`), socle structuré (`answer_from_handbook`, `finish_help_answer`, `resolve_help_doc_model`), commandes `get_handbook`, `ask_help_doc`, `ask_help`, `ask_pi_caged`/`ask_pi_caged_timed` |
| `src-tauri/src/lib.rs` | `setup` de `run()` : `help::write_startup_docs(&handle);` (écriture au démarrage, fail-open) |
| `src-tauri/extensions/pilot-assistant-doc.ts` | Outil `answer_from_documentation` de l'Assistant (§4.5) : une entrée (la question), plafond 1 appel/tour, sortie honnête |
| `src/js/super-agent.js` | Relais du sentinel `PILOT_ASSISTANT_DOC::` → `ask_help_doc` (point unique) |
| `src/js/assistant-outil-doc.test.js` | Câblage (extension + déclaration ×2 + relais + sentinel identique) + plafond + sortie honnête |
| `src/js/help.js` | **Supprimé** — l'onglet Aide n'existe plus (§9) |
| `index.html` | **Plus de bouton « Aide »** ni de zone chat d'aide (§9) |
| `src/css/style.css` | Styles `.help-*` — **conservés** : partagés par la Revue (`.review-chat`) et l'Historique (`.history-chat`) |
| `src/js/retrait-ecran-aide.test.js` | Verrou du retrait : bouton, mode `help`, module, styles partagés, socle |
| `package.json` | Script `build:handbook` + hook `prebuild` |

## 9. Retrait de l'écran Aide (livré)

| Élément retiré | Détail |
|---|---|
| Bouton « Aide » (`#btn-help`) | Retiré de `#global-actions` (`index.html`) ; aucun câblage restant dans `main.js`. |
| Onglet Aide (mode `help`) | Branche d'ouverture, méthode `_openHelp`, nettoyages `unlistenHelp`, entrée de la table des modes spéciaux et de la garde de renommage : tout a disparu de `tabs.js`. |
| Module d'écran | `src/js/help.js` supprimé (plus aucun import). |

**Conservé volontairement :**

| Élément | Pourquoi |
|---|---|
| Styles `.help-*` | Partagés par la Revue de code et l'Historique des sessions (même en-tête, mêmes bulles, même zone de saisie). |
| `help_model` + `set_help_model` | Repli de la Revue de code et étage de résolution du modèle du socle. |
| Socle `answer_from_handbook` / `ask_help_doc`, outil `answer_from_documentation` et son plafond d'appels | C'est ce qui permet à l'Assistant de répondre. |
| Commandes `ask_help` et `get_handbook` | Restées enregistrées dans le socle : **plus aucun appelant côté écran** (signalé, non supprimées). |

**Comment le retrait est tenu** : `src/js/retrait-ecran-aide.test.js` rougit si le
bouton revient (le haut repasserait à 3 boutons), si le mode `help` revient dans
`tabs.js`, si `help.js` réapparaît, ou si un style partagé / le socle est
supprimé. `src/js/lot2-colonne-haut.test.js` est mis à jour (deux portes nommées).