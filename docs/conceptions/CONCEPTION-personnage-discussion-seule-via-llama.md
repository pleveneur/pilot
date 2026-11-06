# Discussion seulement via llama — conception

> **Statut** : conception écrite, **rien n'est implémenté**. Ce document ne contient
> aucune modification technique : il décrit **ce que voit l'utilisateur** et **ce qui se
> passe dans chaque cas**. Il ne modifie aucun autre document du projet.
>
> **La règle en une phrase** : une **case à cocher, propre à chaque personnage**, fait
> passer l'assistant en **conversation pure** — il parle, avec le modèle du personnage
> servi par le llama local, sans rien faire d'autre que tenir **sa propre fiche à jour** ;
> case décochée, **rien ne change**, au mot près.
>
> **Ce que ce document ne fait pas** : aucune nouvelle mémoire, aucun nouvel écran, aucun
> second moteur. Il branche ce qui existe — le personnage de Présences, le modèle du
> personnage, le mode Vocal, l'onglet Assistant — et il **ferme** ce qui ne doit pas
> exister en conversation seule.

---

## § 0 — Le problème, en clair

Aujourd'hui, un personnage actif change **le nom affiché, le portrait, la voix et le
modèle IA**. Pour le reste, l'assistant parle et travaille comme d'habitude : il lance des
agents, lit des projets, range des tâches, propose des actions.

Le propriétaire veut, pour un personnage donné, **autre chose** : une discussion. Le
personnage parle, écoute, répond — comme un interlocuteur. Il ne travaille pas. Il ne
touche à rien. La seule chose qu'il peut écrire, c'est **sa propre fiche**, parce qu'on le
fait évoluer en lui parlant.

D'où l'interrupteur unique de ce document, et ses deux seules positions :

| La case | Ce que fait l'assistant |
|---|---|
| **décochée** | exactement ce qu'il fait aujourd'hui : suivi, agents, projets, outils, moteur habituel. **Rien ne bouge.** |
| **cochée** + un personnage actif | il **discute seulement**, avec le modèle du personnage servi par le llama local ; il ne lance aucun agent, ne touche à aucun projet, et n'écrit que **sa propre fiche** |

---

## § 1 — La case, et ce qu'elle commande

### 1.1 Nom, emplacement, apparence

- **Libellé** : `Discussion seulement via llama`
  (le propriétaire dit aussi « conversation uniquement via llama » : c'est la même case,
  un seul libellé à l'écran — celui écrit ici, pour qu'il n'y ait pas deux noms).
- **Où** : Options ⚙️ → onglet **« Assistant »**, **juste sous le champ « modèle du
  personnage actif »**, dans le même bloc en retrait que lui, avec la même taille de texte.
  Le choix de voix du personnage reste une section plus bas (« Lecture des réponses »),
  inchangé : les trois réglages du personnage vivent dans le même onglet, groupés par ce
  qu'ils commandent — **comment il parle** (modèle + cette case), puis **comment il sonne**
  (voix).
- **Phrase d'explication**, en petit et en gris, sous la case (une ligne) :
  > « Le personnage discute uniquement, avec son propre modèle. Il ne lance aucun agent et
  > ne touche à aucun projet. Si le modèle local ne répond pas, le message n'est pas
  > envoyé. »
- **Apparence** : une case à cocher ordinaire, comme les autres réglages de Pilot, suivie
  du libellé. Aucun bouton, aucune icône, aucune couleur particulière. Cochée, elle est
  cochée ; rien de plus (pas de bandeau, pas de voyant clignotant).

### 1.2 Sans personnage actif : rien du tout

**Décision** : sans personnage actif, **la case n'existe pas à l'écran** — pas de case
grisée, pas de ligne d'explication, pas de message du genre « activez un personnage ».
La ligne entière disparaît, exactement comme la ligne « voix du personnage actif »
aujourd'hui.

Pourquoi ce choix, alors qu'une ligne discrète serait possible : la règle existe déjà dans
cet onglet et l'écran ne doit pas raconter deux choses différentes à deux endroits. Une
case grisée accompagnée d'un mode d'emploi serait aussi une petite leçon d'interface
permanente pour un réglage qui ne s'applique à personne. Le propriétaire découvre la case
**au moment où elle sert** : quand un personnage parle.

> *Alternative écartée* : une ligne grise « nécessite un personnage actif ». Elle est plus
> bavarde et n'apprend rien de plus que l'apparition de la case.

### 1.3 C'est un réglage **par personnage**, mémorisé

- La case est attachée **au personnage** (par son nom), pas à Pilot : deux personnages
  peuvent avoir deux réponses différentes, l'un en discussion seule, l'autre non.
- Elle **survit au redémarrage** : on ferme Pilot, on le rouvre, la case est telle qu'on
  l'a laissée.
- Elle est **mémorisée dans les réglages de Pilot**, pas dans le dossier de Présences :
  comme la voix du personnage, c'est un choix de Pilot sur ce personnage, pas une donnée
  du personnage. Rien n'est donc écrit dans le dossier de Présences par cette case.
- Personnage désactivé puis réactivé : la case **revient telle quelle** (même nom → même
  réglage). C'est la même règle que la voix, et elle a la même petite limite, dite au
  § 1.5.

### 1.4 Ce que la case commande : tout, et aux deux endroits

**Périmètre : les deux canaux.** Cocher la case change le comportement **du mode Vocal et
de la discussion écrite de l'onglet Assistant**, de la même manière. Il n'y a pas deux
cases, pas un réglage pour l'oral et un pour l'écrit.

Quand la case est cochée **et** qu'un personnage est actif :

| Ce qui se passe | En discussion écrite | En mode Vocal |
|---|---|---|
| Le moteur qui répond | le modèle **du personnage**, servi par le llama local | le même |
| Les agents, les tâches, les projets | **inaccessible** : il n'en parle pas, il n'en lance pas | idem |
| Les outils de travail (lire un projet, ranger une tâche, lancer un agent) | **aucun** | **aucun** |
| Écrire | **une seule chose** : sa propre fiche (§ 3 et § 4) | idem |
| La voix de lecture | la voix du personnage s'il en a une (inchangé) | la voix du personnage (inchangé) |

Le réglage du modèle du personnage **n'est pas modifié par cette case** : on ne saisit pas
un second modèle, on ne choisit pas un endpoint, on ne change rien à la ligne existante.
La case dit seulement : *« pour ce personnage, le moteur est celui-là, et il ne fait que
parler »*.

### 1.5 Si le personnage disparaît, puis revient

- **Désactivation en cours de discussion** : le message suivant repart en comportement
  normal (la case ne s'applique plus, puisqu'elle appartient au personnage). Aucun
  redémarrage. Le fil de discussion est **conservé** : on ne jette pas la conversation.
  Une ligne grise discrète dans le fil le dit, une seule fois :
  > « Le personnage a été désactivé : l'assistant reprend son fonctionnement habituel. »
- **Réactivation du même personnage** : la case revient cochée comme avant, dès le message
  suivant.
- **Limite connue, assumée** : le réglage est rangé **sous le nom** du personnage. Si le
  nom change côté Présences, la case repart décochée — exactement comme la voix du
  personnage aujourd'hui. Ce n'est pas une surprise à corriger dans ce lot, c'est la même
  règle appliquée deux fois (et la corriger demanderait un identifiant stable que Pilot
  n'a pas).

---

## § 2 — Quand llama ne répond pas : refus net

### 2.1 La règle

**Jamais de bascule silencieuse.** Si le modèle local ne répond pas — service arrêté,
modèle non chargé, délai dépassé, réponse illisible — le message **n'est pas envoyé** et
l'assistant **ne répond pas avec le moteur habituel**. Un personnage qui, soudain, se
mettrait à répondre avec un autre moteur serait pire qu'une panne : l'utilisateur croirait
parler au personnage alors qu'il parle à autre chose.

### 2.2 Le message exact, une phrase

> **« Le modèle local de llama n'a pas répondu ; ton message est gardé : réessaie dans un
> instant, ou décoche « Discussion seulement via llama » pour revenir au moteur
> habituel. »**

Une seule phrase, en français simple, qui dit trois choses : **ce qui ne va pas**, **où est
le message** (il est gardé), **les deux gestes possibles** (réessayer, ou décocher).

Variante courte si la place manque dans le mode Vocal (même contenu, une ligne) :
> « Le modèle local n'a pas répondu ; ton message est gardé. Réessaie, ou décoche la
> discussion seule. »

### 2.3 Ce que voit l'utilisateur, concrètement

| Situation | Écran |
|---|---|
| Le modèle ne répond pas (écrit) | Le message **reste dans la barre de saisie**, intact, curseur dessus. La phrase du § 2.2 s'affiche en rouge doux au-dessus de la barre. Aucune bulle n'est créée : la discussion ne contient pas un message qui n'a jamais été envoyé. |
| Le modèle ne répond pas (vocal) | La phrase est **dite à voix haute** (voix de lecture habituelle) et affichée en ligne d'état. La barre de saisie garde le texte dicté. L'écoute se réarme comme après un refus (aucune boucle de relance automatique). |
| Le modèle met du temps | Après **3 secondes**, une ligne d'état discrète : « J'attends le modèle local… ». Rien d'autre ne bouge, on peut écrire ou quitter. |
| Le modèle ne répond toujours pas | **Refus à 60 secondes** (une seule valeur, les deux canaux). Message du § 2.2. |
| Le modèle répond, puis se coupe en pleine réponse | La réponse **déjà reçue est gardée** et affichée telle quelle, sans phrase d'excuse inventée ; une ligne grise dit : « La réponse s'est arrêtée : le modèle local n'a plus répondu. » |

Rien n'est réessayé tout seul : on ne renvoie pas un message à la place de l'utilisateur.
Le geste de réessayer est le sien (bouton d'envoi, ou nouvelle phrase dictée).

---

## § 3 — D'où vient l'identité du personnage

### 3.1 Le principe absolu

**Pilot ne fabrique aucun texte qui définit qui est le personnage.** Rien en dur dans le
code, aucun prompt maison, aucune phrase de politesse inventée, aucun « tu es un assistant
chaleureux ». L'identité vient **uniquement de la fiche du personnage** dans Présences :
son nom, ce qu'il est, son ton et sa manière de parler, comment il appelle le
propriétaire, ce qu'il fait volontiers, ce qu'il ne fait jamais.

**La fiche fait foi, y compris contre Pilot.** Si la fiche dit « il vouvoie toujours », il
vouvoie, même si l'assistant, lui, tutoie ailleurs. Si la fiche ne dit rien d'un sujet,
Pilot **ne complète pas** : il laisse le personnage décider avec ce qu'il a.

Conséquence pratique, et c'est la propriété la plus importante du dispositif :
**changer la fiche suffit**. Aucun texte n'est recopié dans Pilot, donc aucun texte ne
peut rester figé sur l'ancienne version. Ce qui est réaliste, sans redémarrage :

| Ce qu'on change dans la fiche | Quand ça s'applique |
|---|---|
| un mot, une phrase, tout le texte | au **message suivant** (la fiche est relue à chaque message, rien n'est gardé en mémoire) |
| le nom du personnage | au message suivant pour le texte ; la case, elle, repart décochée (§ 1.5) |
| la fiche est supprimée | au message suivant : plus d'identité, cas du § 3.3 |

### 3.2 Ce qui est transmis, et ce qui ne l'est pas

**Transmis** (la fiche, et elle seule) : nom · ce qu'il est · ton et manière de parler ·
comment il appelle le propriétaire · ce qu'il fait volontiers · ce qu'il ne fait jamais.

**Non transmis, volontairement** — et je suis **d'accord** avec cette exclusion, pour trois
raisons différentes :

| Élément | Injecté ? | Pourquoi |
|---|---|---|
| **Carnet de souvenirs** | **non** | C'est une **mémoire**, pas une identité. Elle a déjà sa propre conception, séparée, avec ses propres règles d'écriture et de restitution. La glisser ici créerait une **seconde porte** vers les souvenirs, avec d'autres règles — exactement ce que la conception de la mémoire personnelle interdit. Si les souvenirs doivent entrer en conversation seule, c'est une décision de ce document-là, pas de celui-ci. |
| **Palier de relation** | **non** | Le palier **module** le comportement (ce qu'il ose dire, comment il se permet de parler) selon des règles qui appartiennent à Présences. Le recopier ici obligerait Pilot à **réécrire ces règles**, donc à en tenir une deuxième version qui dériverait. Une identité stable vaut mieux qu'un personnage dont l'humeur dépend d'un compteur que Pilot interprète à sa façon. |
| **Description visuelle** | **non** | Elle sert à **montrer** le personnage (le portrait, l'image), pas à le faire parler. Le modèle qui discute ne voit rien : la lui donner ne changerait pas une phrase et l'inviterait à décrire une apparence au lieu de parler. |

**Ce qui n'est pas non plus transmis** : les réglages de Pilot (son nom d'assistant, son
genre réglé, ses préférences), son prompt personnalisé, ses instructions de travail, son
suivi de projets. En conversation seule, le personnage **n'est pas** l'assistant au
travail : il ne récite pas les règles de Pilot. Le seul cadre qui reste est celui du § 4
(ce qu'il peut écrire) — un cadre, pas un personnage.

### 3.3 Cas limites : fiche absente, vide, incomplète

| Cas | Ce que fait Pilot | Ce que voit l'utilisateur |
|---|---|---|
| **Fiche absente** (un personnage est actif, il n'a pas de fiche) | Rien n'est inventé : aucune identité n'est ajoutée. Le personnage parle avec **son nom seul** (déjà affiché aujourd'hui) et le modèle du personnage. | Une ligne grise, **une seule fois par session**, en tête de la discussion : « Ce personnage n'a pas encore de fiche : il te parle sans consigne, avec son nom. » Dans les Options, sous la case, une ligne discrète : « Fiche absente — le personnage parle sans consigne. » |
| **Fiche vide** (le fichier existe, aucun champ rempli) | Identique à « fiche absente ». | Même ligne, avec le mot juste : « … pas encore de fiche remplie ». Aucune erreur, aucun rouge, aucun mot technique. |
| **Fiche incomplète** (un seul champ rempli, par exemple le ton) | Pilot transmet **ce qui existe**, et **n'ajoute rien** pour combler les trous. | **Aucun message.** Une fiche partielle est un état normal, pas un problème : prévenir à chaque session serait du bruit. La fiche peut se compléter par la discussion (§ 4). |
| **Fiche illisible** (fichier abîmé, trop gros) | Traitée comme **absente**. Rien n'est réparé, rien n'est supprimé. | La ligne de « fiche absente ». |

Règle commune : **ni panne, ni reproche**. On ne dit jamais à l'utilisateur qu'il a mal
rempli quelque chose ; on dit ce qui est, et le personnage continue de parler.

### 3.4 Changement de personnage en cours de session

- **Un autre personnage est activé** : au message suivant, l'identité est celle du nouveau
  et la case appliquée est **la sienne** (elle peut être décochée → retour au
  fonctionnement habituel). Le **fil de discussion est conservé**, avec une ligne grise
  une seule fois : « Personnage actif : <Nom>. »
- **Rien n'est rechargé à la main, rien n'est redémarré** : c'est déjà la règle pour le nom,
  le portrait, le genre et le modèle.
- **La discussion en cours n'est pas effacée** : le nouveau personnage hérite du fil. C'est
  assumé (c'est le même utilisateur, la même fenêtre) et signalé par la ligne grise.
- **Indicateur discret** : dans l'en-tête de l'onglet Assistant, à côté du nom, une petite
  pastille texte **« Discussion seule »** quand la case du personnage actif est cochée.
  Elle n'existe que dans ce cas. En mode Vocal, **aucune pastille** : l'écran vocal ne
  porte pas ce genre d'information, et la ligne d'état suffit.
- **Désactivation pendant la discussion** : voir § 1.5 (retour immédiat au comportement
  habituel, fil conservé, une ligne grise).

---

## § 4 — La seule écriture autorisée : sa propre fiche

### 4.1 Pourquoi, et ce que ça permet

Un personnage qu'on fait évoluer en parlant doit pouvoir **retenir de lui-même** ce qu'on
vient de lui dire sur lui : « appelle-moi patron », « ne me tutoie pas », « tu détestes les
excès de zèle ». Sans cela, il faudrait retourner dans Présences après chaque échange, et
la conversation ne servirait à rien.

**C'est la seule écriture de la conversation seule.** Elle est encadrée par les cinq règles
ci-dessous.

### 4.2 Les interdits, nommés un par un

En conversation seule, il **ne peut pas** :

- écrire dans la fiche d'un **autre** personnage ;
- écrire dans le **carnet de souvenirs**, ni dans la corbeille ;
- toucher au **palier de relation** ;
- toucher à la **description visuelle** ;
- modifier un **réglage de Pilot** (nom, genre, modèle, voix, prompt, préférences) ;
- lire ou écrire un **fichier de projet** ;
- **lancer un agent**, ni lui parler, ni lire son résultat ;
- créer, modifier ou clore une **tâche** de suivi, ni rien ranger dans la base de suivi.

Une demande qui sort de ce cadre reçoit une réponse simple, dite avec les mots du
personnage, sans jargon et sans mode d'emploi :
> « Là, je ne peux pas : en discussion seule, je ne touche à rien. Décoche « Discussion
> seulement via llama » si tu veux que je m'en occupe. »

**Conséquence assumée** : pendant que la case est cochée, l'assistant **ne suit plus les
projets**. Rien n'est perdu (rien n'est effacé), mais rien n'est enregistré non plus. On
retrouve le suivi à la première discussion normale, la case décochée.

### 4.3 Il n'efface jamais ce que le propriétaire a écrit

C'est la règle la plus importante du § 4, et elle est mécanique, pas une consigne de
bonne volonté :

1. **Avant** d'écrire, Pilot compare ce que le personnage propose d'écrire avec la fiche
   actuelle.
2. Si la modification **retire ou réécrit un passage écrit par le propriétaire**, elle est
   **refusée**. Dans ce cas :
   - en discussion écrite : une question est posée, une seule fois — « Ça, c'est toi qui
     l'as écrit. Je le change quand même ? » — et **rien n'est écrit** sans un oui franc
     (« oui », « change-le », « vas-y »). Un silence, une réponse à côté, une question
     renvoyée : **pas d'écriture** ;
   - en mode Vocal : voir § 4.4 (aucune question à l'écran) — la modification est
     **abandonnée** et une phrase le dit.
3. Le personnage peut toujours **ajouter** (un champ vide, une phrase en plus) et
   **réécrire ce qu'il a lui-même écrit**. Ajouter ne demande jamais rien.

### 4.4 Conservation de la version précédente, et retour en arrière

- **Avant chaque écriture**, la fiche actuelle est **copiée** dans un historique, daté et
  rangé à côté d'elle, pour ce personnage. Rien n'est jamais écrasé sans trace.
- L'historique garde **les 20 dernières versions** de chaque personnage. Au-delà, la plus
  ancienne est retirée de l'historique — **la fiche en vigueur, elle, n'est jamais
  tronquée**.
- **Retour en arrière, par l'utilisateur** : Options ⚙️ → Assistant, sous la case, un lien
  discret **« Revenir à la version précédente de la fiche »**. Il n'apparaît **que** s'il
  existe une version précédente. Un clic : la version d'avant revient, l'état actuel part
  dans l'historique (donc un second clic revient en avant, rien n'est perdu). Aucune
  fenêtre de confirmation : le geste est visible, et il est réversible par le même lien.
- **Retour en arrière, à l'oral** : pas de lien vocal. On le fait depuis les Options, ou on
  le demande : « reviens à ma fiche d'avant » — c'est un geste, pas une question.

### 4.5 En mode Vocal : il écrit sans demander, et il le dit

**Décision** : en mode Vocal, **aucune question ne s'affiche à l'écran** et aucune question
n'est posée à l'oral. Donc :

1. il **écrit sans demander** (dans les limites du § 4.3 — un passage écrit par
   le propriétaire n'est jamais touché : la modification est abandonnée) ;
2. il **garde l'ancienne version** (§ 4.4) ;
3. il **annonce à l'oral ce qu'il vient de changer**, en **une phrase**, avec sa propre
   manière de parler.

**Phrase type** (à adapter par le personnage, jamais rallongée) :

> **« C'est noté : j'ai écrit dans ma fiche que tu préfères que je te tutoie — l'ancienne
> version est gardée. »**

Trois variantes seulement, une phrase chacune :

| Cas | Phrase type |
|---|---|
| écriture faite | « C'est noté : j'ai écrit dans ma fiche que <ce qui a changé> — l'ancienne version est gardée. » |
| modification abandonnée (texte du propriétaire) | « Ça, c'est toi qui l'as écrit : je l'ai laissé tel quel. » |
| écriture impossible | « Je n'ai pas pu écrire dans ma fiche — elle est restée comme avant. » |

Ce que la phrase **ne fait jamais** : réciter la fiche, annoncer un numéro de version,
nommer un fichier, proposer de choisir entre deux textes. Une phrase, un fait.

### 4.6 Cas limites, un par un

| Cas | Ce qui se passe | Ce que voit l'utilisateur |
|---|---|---|
| **Fiche absente au moment d'écrire** | **Aucune création de fiche.** Pilot n'invente pas un document dans le dossier de Présences : sans fiche, il n'a rien à modifier. | Une phrase, dite avec les mots du personnage : « Je n'ai pas encore de fiche à moi, donc je ne peux rien y écrire. » Une ligne grise en discussion écrite ; la même phrase **à l'oral** en mode Vocal. |
| **Écriture impossible** (disque protégé, dossier en lecture seule, fichier verrouillé) | La fiche **reste exactement comme avant**. Aucun essai en boucle, aucune nouvelle tentative silencieuse. **La discussion continue normalement.** | Discussion écrite : une ligne rouge douce sous la réponse — « Je n'ai pas pu enregistrer : ta fiche est restée comme avant. » Mode Vocal : la phrase « Je n'ai pas pu écrire dans ma fiche — elle est restée comme avant. » Dite **une fois** par conversation, pas à chaque message. |
| **Personnage désactivé pendant l'écriture** | L'écriture est **annulée** (plus de personnage → plus de fiche à lui). Rien n'est écrit à moitié : soit la fiche entière est remplacée, soit rien. | La phrase « Je n'ai plus de fiche à moi, je n'ai rien changé. » puis le retour au comportement habituel (§ 1.5). |
| **Deux modifications dans la même conversation** | Chacune est écrite **et** versionnée séparément (deux entrées datées dans l'historique). | Rien de spécial à l'écran en discussion écrite : les réponses s'enchaînent. À l'oral : **une phrase par modification** (jamais deux modifications annoncées d'un coup dans une seule phrase — on ne saurait plus laquelle est laquelle). |
| **Le personnage propose d'écrire pendant qu'il attend le modèle local** | Sans réponse du modèle, il n'y a pas de proposition : rien n'est écrit. | Le refus du § 2. |

---

## § 5 — Ce qui n'existe pas, et ne doit pas exister (hors périmètre)

Pour que la suite soit sans ambiguïté, voici ce que ce lot **n'ajoute pas** :

- **Aucun second moteur, aucun second endpoint** : la case ne crée pas de réglage
  d'adresse ni de port. Le modèle est celui du personnage, point.
- **Aucun deuxième écran, aucun écran de réglage** : une case, une phrase, un lien de
  retour en arrière. Rien d'autre.
- **Aucune mémoire nouvelle** : ni souvenirs, ni résumé de conversation, ni fichier de
  personnage côté Pilot.
- **Aucun changement de Présences** : Pilot lit la fiche ; il n'écrit que dans la fiche du
  personnage actif, et seulement quand celui-ci le décide. Aucun nouveau fichier n'est créé
  dans son dossier (le cas « fiche absente » refuse, § 4.6).
- **Aucune bascule automatique de moteur**, dans aucun sens, jamais (§ 2).
- **Aucun réglage global** : pas de « discussion seule pour tout le monde ». C'est par
  personnage, ou pas du tout.

---

## § 6 — Livraison

### 6.1 Un seul lot

Tout ce document tient en **une seule mission de code** : la case et sa mémorisation, le
choix du moteur du personnage quand la case est cochée, le refus net, l'identité lue dans
la fiche, l'écriture de la fiche avec historique et retour en arrière, la phrase orale en
mode Vocal. Aucun découpage en deux temps : une case à moitié branchée serait pire que
rien.

### 6.2 Vérifications manuelles du propriétaire (version dev, en langage simple)

À faire soi-même, dans l'ordre. Chaque ligne dit ce qu'on doit voir.

1. **Sans personnage.** Ouvrir Options → Assistant : la case **n'est pas là**. Rien n'a
   changé par rapport à aujourd'hui.
2. **Avec un personnage.** Activer un personnage dans Présences, rouvrir les Options : la
   case apparaît **sous le modèle du personnage**, avec sa phrase d'explication.
3. **Case décochée.** Parler à l'assistant (écrit puis oral) : il se comporte **exactement
   comme avant** — suivi, agents, projets. Rien ne doit avoir bougé.
4. **Case cochée, discussion écrite.** Poser une question de conversation : la réponse
   arrive **avec le modèle du personnage**. Lui demander de lancer une tâche : il refuse
   poliment et propose de décocher. La pastille **« Discussion seule »** est visible dans
   l'en-tête.
5. **Case cochée, mode Vocal.** Même chose à l'oral : il répond, et il refuse le travail
   avec **sa** voix.
6. **Identité.** Modifier une phrase de la fiche du personnage dans Présences, sans toucher
   à Pilot : au message suivant, le personnage parle **avec la nouvelle version**. Aucun
   redémarrage.
7. **Fiche vide.** Vider la fiche : une ligne grise le dit **une fois**, le personnage
   continue de parler. Aucune erreur rouge.
8. **llama arrêté.** Fermer le moteur local, puis envoyer un message : le message **reste
   dans la barre**, la phrase de refus s'affiche (et se **dit** à l'oral), et la réponse
   n'arrive **pas** avec un autre moteur. Rallumer le moteur, réessayer : ça marche.
9. **Écriture de sa fiche.** Lui dire « appelle-moi patron ». En discussion écrite : la
   fiche change (ou une question est posée si le passage était le vôtre). En mode Vocal :
   la fiche change sans question et **une phrase** le dit à l'oral.
10. **Jamais effacé.** Écrire vous-même une phrase dans la fiche, puis demander au
    personnage de changer cette phrase : en Vocal elle **n'est pas touchée**, et il le dit.
11. **Retour en arrière.** Options → Assistant : le lien « Revenir à la version précédente
    de la fiche » apparaît, un clic rend la version d'avant.
12. **Redémarrage.** Fermer et rouvrir Pilot : la case est **toujours cochée** pour ce
    personnage.
13. **Désactivation.** Désactiver le personnage en pleine discussion : le message suivant
    repart en comportement habituel, le fil est conservé, une ligne grise le dit.
14. **Deux personnages.** Cocher pour l'un, laisser décoché pour l'autre, basculer de l'un
    à l'autre : chacun garde son réglage.

---

## § 7 — Ce qui ne change pas

- **Case décochée : rien ne change**, au mot près, ni dans l'onglet Assistant, ni en mode
  Vocal, ni ailleurs. C'est le cas de très loin le plus fréquent : il doit être
  indiscernable de la version d'avant.
- **Le reste de Pilot** : onglet Assistant au travail, suivi des projets, agents, tâches,
  terminal, éditeur, GDS, Telegram, web distant, paramètres. Aucun écran n'est déplacé,
  aucun bouton renommé.
- **Les agents** : ils ne voient pas la fiche, ne reçoivent rien d'elle, et ne changent pas
  de comportement. La case ne concerne **que** la conversation de l'assistant.
- **La règle de lecture seule** : elle reste la règle du travail de l'assistant. En
  conversation seule, la seule écriture est **sa propre fiche** (§ 4) — une écriture
  nommée, unique, réversible, pas une exception au silence.
- **Le réglage du modèle du personnage** et **le choix de la voix** : mêmes lignes, même
  fonctionnement, aucune valeur modifiée par cette case.
- **Le carnet de souvenirs, le palier de relation et la description visuelle** : ni lus, ni
  écrits, ni joints ici. Leur conception reste celle qui existe déjà.

---

## § 8 — Résumé (à lire tel quel au propriétaire)

1. Une case à cocher apparaît dans Options → Assistant, sous le modèle du personnage :
   « Discussion seulement via llama ».
2. Elle est **propre à chaque personnage**, gardée au redémarrage, et sans personnage elle
   n'existe pas à l'écran.
3. Décochée, Pilot est **exactement** comme aujourd'hui, au mot près.
4. Cochée, le personnage parle **uniquement** avec son propre modèle servi par le llama
   local — à l'écrit comme à l'oral — et ne lance aucun agent, ne touche à aucun projet.
5. Si le llama ne répond pas, **refus net**, le message est gardé, et on propose de
   réessayer ou de décocher. Jamais de bascule en douce.
6. Son identité vient **seulement** de sa fiche dans Présences : nom, ce qu'il est, son
   ton, comment il vous appelle, ce qu'il fait ou ne fait jamais. Rien n'est écrit en dur
   dans Pilot, donc changer la fiche suffit, sans redémarrage.
7. Le carnet de souvenirs, le palier de relation et la description visuelle **ne sont pas**
   de l'identité : ils ne sont pas joints, et c'est voulu.
8. Il peut écrire **une seule chose** : sa propre fiche. Il ne supprime jamais ce que vous
   avez écrit, l'ancienne version est gardée, et un lien permet de revenir en arrière.
9. À l'oral, il ne pose aucune question : il écrit, il garde l'ancienne version, et il
   annonce en une phrase ce qu'il vient de changer.
10. Un seul lot de code, puis quatorze vérifications à faire vous-même en version dev.
