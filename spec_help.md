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
> **Un seul chemin** (§4.6) : la réponse sur le mode d'emploi passe uniquement
> par l'**outil** `answer_from_documentation` du socle, sur le corpus embarqué.
> L'ancienne copie de la documentation en fichiers sur disque et le bloc de
> prompt de l'assistant qui la désignait ont été **retirés** (deux chemins
> divergeaient, et le bloc alourdissait chaque message).

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

### 4.6 Un seul chemin pour répondre sur la documentation (second chemin retiré)

La réponse sur le mode d'emploi de Pilot a compté **deux** chemins :

1. **l'outil `answer_from_documentation`** (§4.5) : le socle documentaire, le
   corpus **embarqué** (`HANDBOOK`), plafonné à **un appel par tour**, qui dit
   « la documentation ne dit rien » quand il ne sait pas ;
2. **une copie de la documentation en fichiers sur le disque**, écrite au
   démarrage (`<app_data_dir>/aide/`, un fichier par thème + `index.md`), **plus
   un bloc du prompt de l'assistant** lui désignant ces fichiers pour qu'il les
   lise lui-même.

Le **second chemin est retiré**. Deux raisons : deux chemins pour la même
question finissent par **diverger**, et le bloc alourdissait le prompt de
l'assistant à **chaque** message (donc chaque échange coûtait plus cher). Il ne
reste que **l'outil**, qui porte lui-même ses garanties : corpus embarqué
unique, un seul appel par tour, refus explicite au 2ᵉ appel, et « la
documentation ne dit rien » au lieu d'inventer.

| Retiré | Pourquoi c'était possible |
|---|---|
| L'écriture au démarrage (`help::write_startup_docs`, appel du `setup` de `run()`) et tout son découpage (`handbook_topics`, `doc_files_of`, `doc_file_name`, `doc_title`, `doc_dir`, `doc_dir_for`, constantes du dossier et de l'index) | Son **unique** consommateur était le bloc de prompt ci-dessous : vérifié, rien d'autre ne lit ce dossier, ni côté Rust ni côté `src/js/`. |
| Le bloc `SUPER_AGENT_DOC_PROMPT` du prompt de l'assistant (chemin exact, `index.md`, consigne de lire avec `read`, règles « répondre directement / ne rien inventer », garde-fou mémoire) — et le champ `doc_dir` qui l'alimentait | Il désignait la copie disque. Les garanties qu'il énonçait vivent dans **l'outil** et dans ses propres consignes (`pilot-assistant-doc.ts`) : la documentation intégrée est la **seule** source, « dire quand elle ne dit rien, ne jamais inventer », « un appel par tour ». |

**Ce qui n'a pas changé** : l'outil et son plafond, le socle
(`answer_from_handbook`, `ask_help_doc`, marqueur `DOCUMENTATION_INSUFFISANTE`,
plafond de sortie, résolution du modèle), et la génération de la documentation
(`npm run build:handbook` : **aucun contenu du handbook ne change** ; les
marqueurs `<!-- HELP-TOPIC:… -->` restent dans le fichier généré, désormais sans
consommateur).

**Rien n'est nettoyé chez l'utilisateur** : les fichiers déjà écrits par
l'ancien mécanisme (`<app_data_dir>/aide/`) ne sont **pas** supprimés — on
arrête de les écrire, on ne supprime aucune donnée.

**Budget du prompt** : le plafond anti-regonflement
(`SUPER_AGENT_FIXED_PROMPT_BUDGET`) avait été relevé pour faire tenir ce bloc ;
il est **recalculé sur le prompt réel** à chaque évolution du prompt fixe. Le
retrait du bloc a ramené la mesure à **5 532 caractères** (contre **6 213** avec
le bloc) ; la réintroduction des **deux règles de conduite des questions de
mode d'emploi** (§4.7) ajoute **307 caractères** → mesure actuelle **5 839**,
majorée de 5 % et arrondie au multiple de 50 supérieur → **6 150**.

**Tests** :

| Test | Sort |
|---|---|
| `help::tests::la_documentation_est_ecrite_en_fichiers_lisibles_au_bon_endroit` | **Retiré** : verrouillait l'écriture disque supprimée. |
| `help::tests::le_decoupage_par_theme_suit_les_marqueurs_du_handbook` | **Retiré** : verrouillait le découpage supprimé. |
| `help::tests::le_nom_de_fichier_dun_theme_est_sur` | **Retiré** : verrouillait la fabrication des noms de fichiers supprimée. |
| `help::tests::lecriture_au_demarrage_est_branchee_dans_le_setup` | **Retiré** : verrouillait un branchement qui n'existe plus. |
| `super_agent::tests::assistant_prompt_designates_no_doc_files` | **Ajouté** : échoue si le bloc de doc **revient** (aucun `index.md`, aucune mention « lisible sur disque », aucune consigne de lecture de la doc ; prompt complet = exactement les textes figés connus, mis à jour pour inclure le bloc des deux règles de mode d'emploi). |
| `super_agent::tests::super_agent_fixed_prompt_stays_under_budget` | **Conservé** : garde-fou de budget (valeur recalculée ci-dessus). |

### 4.7 Deux règles de conduite des questions de mode d'emploi (réintroduites)

Le bloc de prompt retiré en §4.6 portait aussi **deux règles de conduite** qui
n'ont rien à voir avec des fichiers. Elles sont **réintroduites seules**, dans un
bloc figé dédié (`SUPER_AGENT_HOWTO_PROMPT`, **307 caractères**) :

1. une question de **mode d'emploi** reçoit une réponse **directe** — elle n'est
   **jamais** déléguée à un agent ;
2. une question de **mode d'emploi** **n'entre pas** dans la mémoire de suivi
   des projets (ni tâche, ni décision, ni projet).

Ce bloc ne désigne **aucun fichier** de documentation, aucun dossier, aucun
chemin : le second chemin de réponse reste retiré, et le garde-fou
`assistant_prompt_designates_no_doc_files` reste **vert** et continue de
**mordre** (vérifié : un nom de fichier de doc injecté dans le prompt le fait
échouer).

### 4.3 Historique multi-tours

Le process pi étant `--no-session` et tué après chaque réponse, il n'a pas de
mémoire entre les tours. **Le socle (`ask_help_doc`) n'a volontairement aucun
historique** : une seule entrée, la question (§4.4). L'emballage `ask_help`
accepte, lui, un historique — il servait à l'écran Aide, désormais retiré.

## 5. UX

- **Aucun écran d'aide dédié.** Le point d'entrée est la conversation de
  l'**Assistant** (🧭) : on lui pose la question, il appelle l'outil
  `answer_from_documentation` et répond (Markdown, sections recoupées).
- Le haut de la colonne de gauche ne porte plus **aucun bouton** : « Brouillon » et
  « Options » (les deux anciennes portes du haut) sont désormais les **deux premières
  lignes du bloc du bas**, avec leurs libellés, infobulles, icônes et identifiants
  inchangés (`btn-scratchpad`, `btn-settings`). Le bloc du bas compte **sept lignes**
  (aucune mise en évidence) et **« Lancer l'agent » y a laissé sa place** : il est la
  première entrée du menu « Autres écrans » (dix entrées), voir
  `RAPPORT-design-colonne-entrees.md` § 2.2, § 2.3 et § 4 lot 1. Aucune porte de
  remplacement n'a été ajoutée en haut (aucune place
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
| `scripts/build-handbook.js` | Agrégation des blocs HELP + marqueurs `<!-- HELP-TOPIC:x -->` (provenance des blocs ; **aucun consommateur** depuis le retrait du second chemin, §4.6) |
| `src-tauri/src/help.rs` | `HANDBOOK` (const), socle structuré (`answer_from_handbook`, `finish_help_answer`, `resolve_help_doc_model`), commandes `get_handbook`, `ask_help_doc`, `ask_help`, `ask_pi_caged`/`ask_pi_caged_timed` — **plus aucune copie de la documentation sur disque** (§4.6) |
| `src-tauri/src/lib.rs` | `setup` de `run()` : **plus d'écriture de documentation au démarrage** (§4.6) |
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
bouton revient dans le haut (il y repasserait à 1 bouton alors que ce haut doit
rester vide), si le mode `help` revient dans
`tabs.js`, si `help.js` réapparaît, ou si un style partagé / le socle est
supprimé. `src/js/lot2-colonne-haut.test.js` est mis à jour (le haut ne contient
plus aucun bouton) et `src/js/lot3-colonne-bas.test.js` vérifie que « Brouillon »
puis « Options » sont les deux premières lignes du bloc du bas.