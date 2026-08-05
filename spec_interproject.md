# Spec — Discussion inter-projets (issue #15)

> Permettre de **lier des projets entre eux** : un projet (source) peut déposer une
> analyse / une tâche dans un projet lié (cible), qui est alors ouvert (si besoin),
> activé, son agent lancé, et à qui l'on demande de **traiter le fichier déposé**.

## 1. Objectif

L'agent d'un projet ne peut aujourd'hui voir que le code de son propre projet
(cwd). La #15 demande de pouvoir, depuis un projet A :

1. **Voir le code source d'un projet lié B** (en lecture seule, sans le modifier).
2. **Déposer un fichier** décrivant son analyse / ce qu'il faut faire.
3. **Ouvrir B** s'il n'est pas déjà ouvert, **lancer son agent**, et **lui dire de
   traiter ce fichier**.

La « lecture seule du code de B » est rendue possible en communiquant à l'agent de
B le chemin du projet source A (il peut le lire, mais la consigne lui interdit de
le modifier). La base du mécanisme est le **dépôt d'une tâche inter-projets**.

## 2. Comportement

### Liaison de projets (persistée)
- Chaque projet peut avoir une liste de **projets liés** (chemins normalisés),
  persistée dans la config (`AppConfig.project_links`).
- Lier/unlier se fait depuis la **modale « Discussion inter-projets »**
  (bouton 🔗 de la barre d'actions, visible dès qu'un projet est ouvert).
- Seuls des projets **ouverts** sont proposés au lien (pas de doublon, le projet
  courant est exclu).

### Dépôt d'une tâche (handoff)
- Depuis la modale, on choisit un **projet cible lié**, on tape l'**analyse /
  instructions**, puis « Déposer la tâche & lancer l'agent cible ».
- Le backend :
  1. écrit un fichier `target/.pilot/handoffs/from-<source>-<ts>.md` contenant
     l'analyse + l'en-tête (source, cible, horodatage) + la consigne « le projet
     source est accessible en lecture seule, ne pas le modifier » ;
  2. garantit que `target` est **ouvert** (`open_project_shared` s'il ne l'est pas)
     et **actif** (`do_set_active_project`) ;
  3. **lance/reprend l'agent** de la cible (`rpc::do_start_agent_session`) ;
  4. envoie à cet agent un **prompt** lui ordonnant de lire et traiter le fichier.

## 3. Architecture backend (Rust)

### Module `src-tauri/src/interproject.rs` (nouveau)
| Élément | Rôle |
|---|---|
| `get_project_links(state, project)` | Liste des projets liés (seuls ceux qui existent encore) |
| `set_project_links(state, app, project, links)` | Remplace la liste des liens (persisté) |
| `remove_project_link(state, app, project, linked)` | Retire un lien précis |
| `interproject_handoff(state, app, source, target, content)` | Dépôt du handoff + ouverture/activation + lancement agent + prompt |

### Persistance
- `AppConfig.project_links: HashMap<String, Vec<String>>` (défaut vide, `serde(default)`).

### Réutilisation
- `crate::open_project_shared` (ouvre la cible si absente), `crate::do_set_active_project`
  (active la cible), `crate::rpc::do_start_agent_session` / `do_send_agent_prompt`.
- `save_config_disk` passe `pub(crate)` pour être appelé depuis `interproject.rs`.

## 4. Frontend

| Fichier | Rôle |
|---|---|
| `index.html` | Bouton 🔗 dans la barre d'actions + modale `#interproject-modal` |
| `src/js/interproject.js` (nouveau) | Logique de la modale (lier/unlier, envoyer une tâche) |
| `src/js/main.js` | `initInterproject()` après l'init de la sidebar |
| `src/css/style.css` | Styles de la modale et des listes de liens |

## 5. Points de vigilance / limites
- La « lecture du code du projet lié » passe par la **consigne** donnée à l'agent
  cible (il peut lire le chemin source, sans le modifier). Pas de sandbox matériel :
  la confiance repose sur la consigne du prompt.
- L'agent de la cible traite le handoff de façon **asynchrone** : l'utilisateur peut
  consulter la discussion dans l'onglet agent de la cible après le dépôt.
- Les liens orphelins (projets supprimés) sont filtrés à la lecture.

---

<!-- HELP:interprojets -->
## Discussion inter-projets (lier des projets)

Pilot peut **lier des projets entre eux** pour qu'un projet dépose une **analyse /
tâche** à un autre projet, dont l'agent est lancé pour la traiter.

- **Ouvrir** : bouton **🔗** de la barre d'actions (visible quand un projet est ouvert).
- **Lier** : dans la modale, choisis un projet ouvert et clique **Lier**. Le lien est
  conservé (config). Un projet lié est **exclu** des propositions une fois lié ; tu peux
  retirer un lien avec ✕.
- **Envoyer une tâche** : choisis un projet cible lié, décris l'analyse / ce qu'il faut
  faire, puis **« Déposer la tâche & lancer l'agent cible »**. Pilot :
  1. écrit un fichier de tâche dans `cible/.pilot/handoffs/` ;
  2. ouvre le projet cible (s'il ne l'est pas) et le rend actif ;
  3. lance son agent et lui demande de **lire et traiter le fichier**.
- Le projet source est indiqué à l'agent cible comme **accessible en lecture seule**
  (il peut le consulter pour le contexte, sans le modifier).
- L'agent cible traite la tâche **en arrière-plan** ; suis le résultat dans l'onglet
  agent du projet cible.
<!-- /HELP:interprojets -->
