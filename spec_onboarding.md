# Spec — Prise en main à la première ouverture

> **Statut : socle posé (lot invisible).** Aucun écran n'existe encore : ce
> fichier décrit la cible arbitrée, et ce que le socle garantit déjà.

## Le besoin

Sur une installation neuve, Pilot n'a **aucun écran de première ouverture**.
« Lancer l'agent » y ouvre un terminal au lieu de l'agent, parce qu'un réglage
(`rpc_agent_enabled`) vaut faux par défaut : le nouvel utilisateur démarre dans
un mode qui n'est pas celui qu'il attend. La prise en main doit mener
rapidement à un mode par défaut utilisable, puis — en option — à l'équipe
d'agents.

## Le critère d'affichage (unique, vérifiable)

La prise en main ne s'affiche **que si le fichier de configuration n'existe pas
encore** (première ouverture certaine). Une installation existante a forcément
ce fichier : elle ne doit **jamais** voir la modale.

Pourquoi ce critère et pas un faisceau d'indices (projets récents vides, réglage
absent, version inconnue…) : ces indices produisent des faux positifs (un
utilisateur qui n'a rien réglé ressemble à une installation neuve) et obligent à
une migration. « Le fichier est absent » est un fait binaire, sans ambiguïté, et
il ne demande aucune migration.

La décision est une **fonction pure** à deux faits, volontairement cumulative :
le fichier existe-t-il, et le champ « déjà vu » est-il posé ? Le drapeau seul ne
suffit jamais — une configuration ancienne est forcément dépourvue du champ, et
un simple `!déjà-vu` ferait réapparaître la modale chez quelqu'un qui travaille
déjà.

## Les deux niveaux

1. **Niveau 1 — mener à un mode utilisable.** Choisir le mode de l'agent (agent
   conversationnel plutôt que terminal), puis ouvrir un projet. Une seule fois,
   au tout début ; le reste de Pilot reste inchangé.
2. **Niveau 2 — optionnel : l'équipe d'agents.** Réutilise **l'écran « Équipe
   d'agents » existant** ([`spec_gestion_agents.md`](./spec_gestion_agents.md)) :
   aucun écran dédié n'est créé. On peut passer ce niveau sans conséquence.

Forme retenue : une **modale** réutilisant les composants existants (mêmes
styles, même animation d'ouverture). Ni onglet, ni refonte de navigation.

## Ce qui est écrit en configuration, et quand

- **Un seul champ** : `onboarding_seen` (« déjà vu »). `true` = la prise en main
  a été vue ; absent ou `false` = jamais vue.
- Il est écrit **à la fin de la prise en main**, en même temps que les réglages
  du niveau 1 (`save_config`), qu'elle ait été suivie ou passée.
- Il fait partie de la liste explicite de la décision « configuration restée par
  défaut » (`config_is_default`) : sans cela, le chargement paresseux pourrait
  l'écraser et la modale reviendrait après un redémarrage.
- Il survit à un redémarrage, et l'enregistrement des Paramètres le préserve
  (l'écran des Paramètres réécrit toute la configuration).
- **Une commande de lecture seule** (`get_onboarding_state`) renvoie l'état à
  l'écran : fichier présent ou non, champ posé ou non, et la décision qui en
  découle. Aucune écriture, aucune création.

## Ce que la prise en main ne fait jamais

- **Aucun tour de modèle payant** : pas d'appel LLM pour « bien démarrer ».
- **Aucun réglage coûteux ou irréversible** : rien de facturé, rien de réseau,
  aucune voix, aucun modèle lourd téléchargé.
- **Aucune suppression** : ni projet, ni session, ni conversation, ni fichier de
  configuration. Elle ne réécrit jamais une configuration existante (elle ne
  s'affiche pas dans ce cas).
- **Aucune réponse décidée à la place de l'utilisateur** : elle propose, elle
  n'impose pas.
- **Aucune modification de l'apparence** (colonne de gauche, onglets, panneau du
  bas, thèmes) : elle se superpose, elle ne réorganise pas.

## Ce qui reste à faire

Les écrans (niveau 1, puis accès au niveau 2) et leur branchement sur
`get_onboarding_state`. Le socle ci-dessus est en place et testé ; les lots
suivants n'ont qu'à lire l'état, afficher, puis écrire `onboarding_seen`.
