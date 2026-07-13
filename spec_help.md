# Spec — Aide intégrée « ❓ Aide » (LLM sur la documentation Pilot)

> Fonctionnalité d'aide en langage naturel : l'utilisateur pose une question sur
> l'utilisation / le paramétrage de Pilot, un LLM répond en se basant sur le
> **handbook** (doc condensée, orientée utilisateur, toujours à jour).
>
> **Statut : Niveau 1 (MVP) — Option A (pi cadré).**

---

## 1. Objectif

Permettre à l'utilisateur d'obtenir de l'aide contextuelle sur Pilot sans
quitter l'application, en langage naturel. La base de connaissance (handbook)
est **générée à la compilation** depuis la documentation du projet et reste
donc synchronisée avec la version installée.

## 2. Architecture (Niveau 1)

```
┌─ Frontend (src/js/help.js) ──────────────────────────────────┐
│  Onglet « ❓ Aide » (chat conversationnel)                     │
│  ├─ Historique d'aide (côté frontend, réinjecté à chaque tour)│
│  └─ invoke("ask_help", { question, history })                │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌─ Backend (src-tauri/src/help.rs) ────────────────────────────┐
│  get_handbook → include_str!("../../help/handbook.md")       │
│  ask_help(app, question, history):                           │
│    1. Construit le prompt cadré (handbook + cadrage +        │
│       historique + question)                                  │
│    2. ask_pi_for_help(cwd, pi_path, prompt):                  │
│       spawn pi --mode rpc --no-session (PROCESS TEMPORAIRE)  │
│       → new_session → prompt → collecte → kill               │
│    3. Retourne le texte de réponse                             │
└───────────────────────────────────────────────────────────────┘
```

**Isolation** : l'aide utilise un **processus pi temporaire `--no-session`**
(pattern identique à `convert_text_with_pi` dans `rpc_manager.rs`). La session
de coding principale (`rpc_state`) n'est **jamais touchée** → aucune pollution,
aucune modif de `rpc_manager.rs`.

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
le prompt ne produit aucune réponse → erreur « Aucune réponse reçue ».
L'aide envoie donc un `set_model` avant le prompt, avec le modèle sélectionné
dans l'UI.

**Sélecteur de modèle** : une liste déroulante en haut de l'onglet Aide, peuplée
via `get_available_models_list` (modèles de `~/.pi/agent/models.json`). Le choix
est **persisté** dans la config Pilot (`help_model`, format `provider/modelId`) via
la commande `set_help_model`.

- Si `help_model` est vide à l'ouverture de l'onglet, le **1er modèle** de la
  liste est auto-sélectionné et persisté (l'aide fonctionne immédiatement, sans
  action utilisateur).
- `ask_help` refuse de répondre tant qu'aucun modèle n'est sélectionné (erreur
  claire côté UI).
- `set_model` est envoyé après `new_session` et avant le `prompt` (même flux que
  `convert_text_with_pi`). Un échec `set_model` (modèle invalide) est détecté
  (event `success:false`) et remonté comme erreur à l'utilisateur.

**Préservation** : `settings.js` inclut `help_model` dans l'objet config renvoyé à
`save_config` (pour ne pas écraser le modèle choisi à chaque sauvegarde des
Paramètres).

### 4.3 Historique multi-tours

Le process pi étant `--no-session` et tué après chaque réponse, il n'a pas de
mémoire entre les tours. L'historique d'aide est **géré côté frontend**
(`help.js`) et **réinjecté** dans le prompt à chaque tour → continuité.

## 5. UX

- Onglet **« ❓ Aide »** dans la barre d'onglets (à côté de « π Agent »).
- **Liste déroulante de modèle** en haut de l'onglet (choix persisté).
- Chat conversationnel (même style visuel que l'agent Pi, Markdown rendu).
- **Pas de FAQ/suggestions** au démarrage (choix utilisateur).
- **Non-streaming** (Niveau 1) : spinner « thinking » pendant la
  génération. Le streaming est prévu au Niveau 2.
- Badge « Basé sur la doc Pilot » (statique, Niveau 1 ; version auto au Niveau 2).

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
| `scripts/build-handbook.js` | Agrégation des blocs HELP |
| `src-tauri/src/help.rs` | `HANDBOOK` (const), commande `get_handbook`, commande `ask_help`, `ask_pi_for_help` |
| `src/js/help.js` | Onglet Aide : chat, historique, envoi, rendu Markdown |
| `index.html` | Onglet « ❓ Aide » + zone chat |
| `src/css/style.css` | Styles (réutilise une partie de agent-pi) |
| `package.json` | Script `build:handbook` + hook `prebuild` |