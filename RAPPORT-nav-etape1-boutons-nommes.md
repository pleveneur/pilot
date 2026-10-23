# Rapport — Etape 1 de la navigation : nommer les boutons de la colonne de gauche

> Date : 2026-10-23. Reference du plan : `docs/proposition-navigation.md`, § 5
> (etape 1) et § 5 « points de vigilance ». Aucune publication, aucun tag,
> aucune version changee.

## Etat avant

Les 14 boutons du bas de la colonne de gauche (`index.html`, bloc
`#project-footer`) n'affichaient **qu'une icone** ; leur sens n'apparaissait
qu'au survol (attribut `title`). Ils etaient poses en grille d'icones de 32 x 32
pixels sur une seule ligne par sous-onglet (`.pj-panel`, `flex-wrap: wrap`).

## Etat apres

Chaque bouton affiche son **icone + un libelle court en francais**, dans le meme
sous-onglet, au meme rang, dans le meme ordre. **Aucun bouton n'est deplace,
fusionne, renomme en interne ni supprime** : les 14 identifiants
(`btn-explorer`, `btn-terminal`, ... `btn-interproject`) sont inchanges, ainsi
que les attributs `title` d'origine.

Dans chaque panneau, les boutons forment une **seule colonne de lignes pleine
largeur** (`flex-direction: column`, libelle a droite de l'icone) : le texte
n'est ni tronque ni coupe et la largeur de la colonne de gauche reste de
**280 px au minimum** (aucun elargissement au detriment de la zone de travail ;
la largeur reste redimensionnable par le separateur comme avant).

## Liste ancien libelle -> nouveau libelle

| # | Identifiant (inchange) | Sous-onglet | Avant (infobulle seule) | Apres (texte visible) |
|---|---|---|---|---|
| 1 | `btn-explorer` | Projet | Ouvrir le dossier dans l'explorateur | **Ouvrir le dossier** |
| 2 | `btn-terminal` | Projet | Ouvrir le terminal | **Terminal** |
| 3 | `btn-terminal-cmd` | Projet | Agent / Terminal | **Agent / Terminal** |
| 4 | `btn-commands` | Projet | Commandes du projet (lancer une commande parametree) | **Commandes du projet** |
| 5 | `btn-prompt-builder` | Projet | Prompt Builder | **Prompt Builder** |
| 6 | `btn-dashboard` | Projet | Tableau de bord du projet (metriques, Git, langages, activite) | **Tableau de bord** |
| 7 | `btn-code-graph` | Vues | Graphe du projet (visualisation 2D du Code Graph) | **Graphe du projet** |
| 8 | `btn-review` | Vues | Revue de code du diff Git (H5) | **Revue de code** |
| 9 | `btn-history` | Vues | Historique des sessions agent (H9) | **Historique des sessions** |
| 10 | `btn-gds` | Vues | GDS (gestionnaire de sources) | **GDS du projet** |
| 11 | `btn-agents` | Assistant | Equipe d'agents multi-roles (H2 V2) | **Equipe d'agents** |
| 12 | `btn-superagent` | Assistant | Assistant : suivi multi-projets (lecture seule) | **Assistant** |
| 13 | `btn-superkanban` | Assistant | Ouvrir la vue Kanban (taches de suivi) | **Kanban** |
| 14 | `btn-interproject` | Assistant | Discussion inter-projets (lier des projets, envoyer une tache) | **Discussion inter-projets** |

Les intitules reprennent le vocabulaire deja retenu dans
`docs/proposition-navigation.md` (§ 4.3 : « Ouvrir le dossier »,
« Commandes du projet », « Prompt Builder », « Tableau de bord »,
« Graphe du projet », « Historique des sessions », « Revue de code »,
« Equipe d'agents », « Discussion inter-projets », « GDS du projet ») et
n'inventent de vocabulaire nouveau que pour les quatre raccourcis
(`Terminal`, `Agent / Terminal`, `Assistant`, `Kanban`), qui sont les mots
employes par le document pour ces boutons.

Le bouton `btn-terminal-cmd` garde le libelle **« Agent / Terminal »** : sa
desambiguisation est l'objet de l'**etape 3** du plan, jamais de l'etape 1.

## Fichiers modifies

| Fichier | Nature de la modification |
|---|---|
| `index.html` | 14 boutons du bloc `#project-footer` : ajout d'un `<span class="pj-btn-label">` apres l'icone (identifiants et `title` conserves) ; trois commentaires de section mis a jour. |
| `src/css/style.css` | `.pj-panel` : passage en une colonne de lignes pleine largeur (`flex-direction: column`, `align-items: stretch`, `gap: 4px`). Ajout de `.pj-panel button` (largeur 100 %, contenu aligne a gauche, texte 12 px) et de `.pj-btn-label` (`nowrap` + ellipse de securite). La regle partagee `#global-actions button` (rangee d'icones du haut) n'est **pas** touchee. |

Aucun autre fichier de code n'a ete modifie. Ni couleur, ni theme, ni version,
ni fichier Rust, ni JavaScript : les gestionnaires d'evenements et les tests
continuent de cibler les memes identifiants.

## Tests

| Verification | Commande | Resultat |
|---|---|---|
| Frontend (Vitest) | `npx vitest run` | **2580 passes, 0 echec** |
| Rust (desktop) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **695 passes, 1 ignore, 0 echec** |

Aucun test ne s'appuyait sur le contenu textuel de ces boutons : aucun test n'a
eu besoin d'etre adapte.

## Ce que le proprietaire doit regarder a l'ecran

Ouvrir un projet, puis, en bas de la colonne de gauche, passer par les trois
sous-onglets **Projet / Vues / Assistant** : chaque ligne doit afficher son
icone suivie d'un libelle lisible en entier (jamais coupe), les 14 boutons
doivent etre la, au meme endroit et dans le meme ordre qu'avant, et la colonne
de gauche doit conserver sa largeur (redimensionnable par le separateur).

## Ce qui reste a faire (etapes suivantes du plan, non traitees ici)

- Etape 2 : memoriser le sous-onglet du bas et l'onglet des Parametres.
- Etape 3 : desambiguiser Terminal / Agent et renommer « Agents » en
  « Equipe d'agents » (+ nom fixe de l'onglet de conversation, decision D3).
- Etape 4 : palette universelle ; etape 5 : 3 boutons + menu « Autres ecrans »
  (D1), qui remplacera la liste nommee livree ici.
- Etapes 6 a 10 (haut de la colonne, panneau Travail unique, fusion des
  Parametres, fil d'Ariane, finitions).
