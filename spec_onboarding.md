# Spec — Prise en main à la première ouverture

> **Statut : niveaux 1 et 2 ✅ implémentés** (niveau 1 : trois écrans + sortie
> en une écriture ; niveau 2 : l'équipe d'agents, à la demande, sans écran
> dédié).

## Le besoin

Sur une installation neuve, Pilot n'a **aucun écran de première ouverture**.
« Lancer l'agent » y ouvre un terminal au lieu de l'agent, parce qu'un réglage
(`rpc_agent_enabled`) vaut faux par défaut : le nouvel utilisateur démarre dans
un mode qui n'est pas celui qu'il attend. La prise en main doit mener
rapidement à un mode par défaut utilisable.

## Le critère d'affichage (unique, vérifiable)

La prise en main ne s'affiche **que si le fichier de configuration n'existe pas
encore** (première ouverture certaine). Une installation existante a forcément
ce fichier : elle ne doit **jamais** voir la fenêtre.

La décision est une **fonction pure** à deux faits, volontairement cumulative
(`onboarding_should_show`) : le fichier existe-t-il, et le champ « déjà vu »
est-il posé ? Le drapeau seul ne suffit jamais — une configuration ancienne est
forcément dépourvue du champ, et un simple `!déjà-vu` ferait réapparaître la
fenêtre chez quelqu'un qui travaille déjà. Le socle est **le seul décideur** :
`src/js/onboarding.js` ne lit que le champ `show` du verdict et ne recalcule
jamais la règle. Un état illisible (`get_onboarding_state` en échec) ⇒ **rien
n'est affiché**.

## Forme

Une **modale** qui réutilise les parties existantes (`.modal`, `.modal-content`,
`.modal-header`, `.modal-close`, `.modal-actions`), même animation d'ouverture
(`animateModalOpen`). **Ni onglet, ni écran de navigation, ni bouton dans la
colonne de gauche, ni retouche de l'apparence** (thèmes, colonne, rangée
d'onglets, panneau du bas).

## Les trois écrans (niveau 1)

Chacun est un **constat** de ce qui est réellement là, pas une promesse :

1. **Le moteur constaté** — quel agent répond (Pi ou PLh), sa version et le
   programme utilisé. Si rien ne répond : la **cause** (`no_path`,
   `not_executable`, `probe_failed`, relevé absent) **et la marche à suivre**
   (⚙️ Options → « Agent Pi »), avec le bouton **« Revérifier le moteur »**.
2. **Le projet sur lequel on travaille** — le projet ouvert (nom + chemin) ou,
   s'il n'y en a aucun, comment en ouvrir un : bouton **« Choisir un dossier de
   projet »** qui appelle le sélecteur natif existant
   (`sidebar.openProject()`), et le constat est **relu** après l'ouverture.
3. **Le modèle de l'assistant** — la liste des modèles **réellement
   disponibles**, lue **sur disque** par `get_available_models_list` (registre
   de l'agent), sans lancer de session ni appeler de modèle. Une liste vide ou
   une lecture en échec dit la cause et la marche à suivre (⚙️ Options →
   « Fournisseurs ») et propose **« Réessayer »**. Le choix du modèle est
   **facultatif** : l'option « Garder le modèle déjà réglé » n'écrase rien.

**« Je découvre »** : trois repères courts (le bouton « Lancer l'agent », l'onglet
🧭 Assistant, ⚙️ Options), puis la fenêtre se ferme en ouvrant **l'onglet de
l'Assistant déjà existant**.

## Ce qui est écrit en configuration, et quand

L'écriture a lieu **uniquement en sortie**, et **une seule fois** (jamais
partielle) : `get_config` → correctif pur → `save_config`. Aucune autre voie
n'écrit la configuration.

| Sortie | Ce qui est écrit |
|---|---|
| **Terminer** (écran 3) | `onboarding_seen: true` + `rpc_agent_enabled: true` + `integrated_terminal: true` (+ `super_agent_default_model` **seulement** si un modèle a été choisi) |
| **Je découvre** | idem « Terminer », puis ouverture de l'onglet Assistant |
| **Passer**, **Échap**, **croix** | `onboarding_seen: true` **uniquement** — rien d'autre ne change |

Les deux réglages de lancement sont ce qui fait que « Lancer l'agent » lance
vraiment l'agent (`rpc_agent_enabled` ouvre la conversation ; le terminal
intégré reste le filet de sécurité s'il est coupé plus tard). Si l'écriture
échoue : **la fenêtre le dit**, ne se ferme pas, et **rien n'a été persisté à
moitié** — « Passer » reste utilisable.

`onboarding_seen` survit au redémarrage, fait partie de la liste
`config_is_default` (sinon le chargement paresseux l'écraserait) et l'écran des
Paramètres le préserve (il réécrit toute la configuration).

## Priorité au démarrage (jamais par-dessus la vérification)

La fenêtre ne s'affiche **jamais par-dessus la vérification de version du
moteur** : `waitForStartupHandback` attend que le terrain soit rendu, c'est-à-dire
que le gardien unique `pi-startup-gate.js` ne bloque plus et qu'aucune
proposition de mise à jour (`pi-update-modal`) n'est visible. L'attente est
**bornée** (`ONBOARDING_STARTUP_WAIT_MS`, 30 s) ; un échec réseau rend la main en
environ une seconde. Passé le délai, la fenêtre **ne s'ouvre pas** et
**n'écrit rien** : elle reviendra au démarrage suivant. Le démarrage de Pilot
n'attend jamais cette fenêtre (appel détaché, après le masquage du chargement)
et la vérification du moteur reste l'instruction première et non attendue.

## Ce que la prise en main ne fait jamais

- **Aucun tour de modèle payant** : pas d'appel LLM pour « bien démarrer ».
- **Aucune session d'agent lancée** (ni `list_agent_sessions`, ni prompt).
- **Aucun réglage coûteux ou irréversible** : rien de facturé, rien de réseau,
  aucune voix, aucun modèle lourd téléchargé.
- **Aucune suppression** : ni projet, ni session, ni conversation, ni fichier de
  configuration.
- **Aucune réponse décidée à la place de l'utilisateur** : elle propose.
- **Aucun cas muet** : jamais de liste vide sans cause ni marche à suivre,
  jamais de bouton mort, jamais « Passer » désactivé ; Pilot reste utilisable.

## Ce qui reste à faire

Rien sur ce lot : les deux niveaux sont livrés.

## Niveau 2 — l'équipe d'agents (facultatif, à la demande)

But : apprendre **plus tard et à la demande** à se servir de l'équipe d'agents,
sans jamais rien imposer ni rouvrir quoi que ce soit au démarrage.

**Réutilisation stricte.** Le niveau 2 ne crée **aucun** écran de gestion, **aucun**
onglet, **aucun** bouton dans la colonne de gauche. Il réutilise l'écran
« Équipe d'agents » existant (`agents-ui.js`, mode d'onglet `agents` de
`tabs.js`) et, pour la forme, la modale et les classes du niveau 1
(`.modal`, `.modal-content`, `.onboarding-*`). À la fin, l'utilisateur **arrive
sur cet écran existant** : jamais une impasse.

**Jamais tout seul.** `openOnboardingTeamModal` exige `gesture: true` — la garde
est la **première** instruction, avant tout accès au document ; aucun autre
argument, aucun état d'équipe, aucune minuterie ne l'ouvre. Le démarrage de
Pilot ne connaît pas ce module. Deux points d'entrée **discrets**, tous deux sur
un clic : le lien « Apprendre à organiser mon équipe d'agents » de la fenêtre de
première ouverture (`#btn-onboarding-team-learn`) et le bouton du même nom en bas
de l'écran d'équipe (`#btn-agents-learn`).

**Deux écrans au maximum** (`ONBOARDING_TEAM_SCREENS = 2`) :

1. **À quoi sert une équipe, et comment elle se compose** — constat réel du
   registre (lu par `loadAgentRegistry`, sans session). Équipe déjà en place :
   le constat le dit et **n'exige aucune modification**. Équipe vide ou registre
   illisible : la **cause** et la **marche à suivre** (↻, +) sont dites, avec
   « Réessayer » vivant.
2. **Le premier geste** — ouvrir une fiche pour **lire** son rôle (rien n'est
   lancé, rien n'est modifié), puis confier une tâche à 🧭 Assistant.

**Ce qu'il ne fait jamais** : aucune écriture de configuration, aucune
modification d'agent (lecture seule), aucun appel de modèle, aucune session
d'agent (jamais `list_agent_sessions`, qui bloque la file), aucune couleur en
dur, aucun token nouveau.

Échap dans le niveau 2 est traité par le niveau 2 : la prise en main de niveau 1
ne doit pas refermer les deux fenêtres d'un coup en écrivant « déjà vu ».

## Couverture

`src/js/onboarding-niveau1.test.js` (fonctions pures + câblage du niveau 1),
`src/js/onboarding-niveau2.test.js` (niveau 2 : garde du geste, absence d'écran
de navigation, lecture seule, cas non muets, sortie vers l'écran d'équipe,
tokens), plus le socle `src/js/settings-onboarding.test.js` (critère, commande
de lecture seule, préservation du champ). Les tests échouent si la fenêtre
s'ouvre alors que le socle dit non, si « Passer » écrit autre chose que
« déjà vu », si l'écriture n'est pas unique, si un cas devient muet, si l'écran
appelle un modèle ou lance une session — et, pour le niveau 2, s'il s'ouvre sans
geste de l'utilisateur, s'il crée un écran de navigation, s'il écrit une
configuration ou s'il modifie un agent.
