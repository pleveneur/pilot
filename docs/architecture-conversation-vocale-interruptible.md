# Pilot — Conversation parlée interruptible (« couper Pilot en pleine phrase »)

> **Document de conception.** Il ne contient **aucune modification de code**, aucune
> installation, aucun téléchargement. Il sert à **trancher**, pas à exécuter.
> Rédigé pour être lu sans connaissance technique du projet.
> Chaque affirmation technique renvoie à un fichier du projet, entre parenthèses.

- Date : 2026-10-24
- Poste de référence : Windows, carte NVIDIA RTX 5080 (16 Go de mémoire vidéo).
- S'appuie sur les deux études déjà livrées dans l'espace assistant :
  `rapports/etude-cornelius-openlive-moshi.md` (22 oct.) et
  `rapports/comparatif-conversation-fluide.md` (23 oct.). Elles répondaient à
  « quel logiciel reprendre ». Ce document répond à l'étape suivante :
  **« comment on le construit dans Pilot, et quelle voix cela impose »**.

---

## 0. Résumé en dix lignes

- Le besoin réel n'est pas « un moteur plus rapide » : **c'est de pouvoir couper et
  réorienter**. La lenteur de Pilot vient de l'agent (secondes, parfois minutes),
  pas de la voix.
- **La moitié du travail est déjà faite** : Pilot sait couper sa propre voix
  instantanément (`stopReading()`, `src/js/read-aloud.js:549`) et publie son état
  de lecture en continu (`pilot-read-aloud-state`, même fichier ligne 117).
- **Ce qui manque tient en une phrase** : personne n'écoute le micro **pendant**
  que la voix parle.
- Trois façons réalistes : **(1) relais manuel** (appuyer pour parler),
  **(2) duplex par la mécanique de la parole** (micro ouvert + détection de voix
  + annulation d'écho), **(3) modèle temps réel « tout-en-un »** (Moshi et
  cousins).
- La n° 3 est la plus fluide et la seule **incompatible avec le français** : le
  modèle *est* la voix, donc on ne peut plus choisir Piper, MeloTTS ou la voix
  Windows.
- Je recommande **la n° 2**, avec la n° 1 comme socle et comme repli.
- Elle se fait **entièrement en local, sans clé, sans carte graphique sollicitée**.
- Estimation : **2 à 4 semaines** de travail sérieux (estimation, pas une mesure).
- Le piège n° 1 n'est pas la vitesse : c'est **l'écho** (le micro qui entend les
  haut-parleurs). Un casque supprime ce piège d'un coup.
- **Trois décisions vous appartiennent** et changent tout : casque ou
  haut-parleurs · le son peut-il sortir de la maison · couper = arrêter l'agent
  ou le laisser finir.

---

## 1. Où en est Pilot aujourd'hui, exactement

### 1.1 Ce qui existe et qu'il ne faut pas refaire

| Ce qui existe | Où c'est écrit |
|---|---|
| Lire une réponse à voix haute, un second clic arrête | `src/js/read-aloud.js` · `spec_read_aloud.md` |
| **Couper la voix instantanément** (`stopReading`) | `src/js/read-aloud.js:549` |
| Couper aussi le son de la voix locale (Piper) | `src/js/read-aloud.js:625-632` (`extraStops`) |
| **Savoir à chaque instant si la voix parle** | événement `pilot-read-aloud-state` (`read-aloud.js:117`) |
| Découper la réponse en phrases, jamais au milieu d'un mot | `read-aloud.js:605` + `speech-text.js` |
| Nettoyer le texte (émojis, tableaux, code annoncé, liens) | `src/js/speech-text.js` |
| Voix française **locale**, hors ligne, sans clé (Piper, 63 Mo) | `src-tauri/src/tts_local.rs` · `src/js/local-voice.js` |
| Choisir et mémoriser la voix, un **seul** réglage | `read_aloud_voice` · `spec_read_aloud.md` § 2 |
| Dicter en français (remplit la zone de saisie) | `src/js/agent-pi.js:845` · `spec_voice_input.md` |
| Micro autorisé dans la fenêtre (correctif local de Tauri) | `src-tauri/vendor/wry/` · `spec_voice_input.md` |
| Un **seul** endroit par lequel passent les arrêts d'agents | `src/js/agent-stop-funnel.js:81` |
| Page web distante (le micro y marche normalement) | `web/js/app.js` · `spec_web_remote.md` |

### 1.2 Ce qui manque, et rien d'autre

1. **Écouter le micro pendant que la voix parle.** C'est la seule vraie nouveauté.
2. **Décider que ce qu'on entend est une interruption** (et pas un toussotement,
   ni sa propre voix sortie des haut-parleurs).
3. **Réorienter l'agent** quand on le coupe — sachant que Pilot a déjà l'endroit
   unique pour cela (`agent-stop-funnel.js`).

### 1.3 Une gêne de plus, à dire franchement

La dictée actuelle n'est **pas locale** : elle utilise la reconnaissance vocale du
navigateur, qui envoie le son chez Microsoft sous Windows (`agent-pi.js:845`,
commentaire « cloud sur WebView2 Windows »). Pour la dictée d'aujourd'hui, c'est
un choix qui n'a jamais été explicite. Pour une **conversation permanente**, il
devient une vraie question, parce que le micro serait ouvert en continu. Le
« tout local » que vous demandez impose donc de **remplacer aussi la dictée** par
un moteur local. C'est un coût à intégrer, pas un détail.

---

## 2. Trois façons réalistes d'obtenir une conversation interruptible en local

### Option 1 — Le relais manuel (appuyer pour parler)

**Le principe.** Vous appuyez sur un bouton (ou vous maintenez une touche) : Pilot
écoute. Vous relâchez : il comprend, il réfléchit, il répond. Pendant qu'il
répond, **il n'écoute pas** ; pour le couper, vous appuyez. C'est le talkie-walkie.

**Ce que ça donne à l'usage.** Franchement moins agréable qu'une conversation,
mais **prévisible** : rien ne se déclenche tout seul, aucun risque qu'il se coupe
lui-même. C'est exactement l'usage « je pilote Pilot à la voix ».

**Réactivité avant de pouvoir couper.** **Immédiate** : c'est le bouton qui coupe.
Aucun traitement du son n'est nécessaire.

**Poids et matériel.** Rien sur la carte graphique. Il faut seulement un moteur
voix → texte local (voir § 5). Le plus petit modèle utile pèse **75 Mo**
(whisper « base ») ; le plus confortable **~500 Mo** (« small »).

**Difficulté de mise en place.** **Faible.** Les trois quarts du chemin existent :
la dictée remplit déjà la zone de saisie, la voix sait déjà se taire.

**Ce qui existe déjà de solide.** Tout Pilot, plus la mécanique d'arrêt.

**Pourquoi ce n'est pas la réponse à votre demande.** Vous avez demandé « il parle
à Pilot, Pilot répond, et surtout il peut couper Pilot en pleine phrase ». Ici, il
faut **lâcher le bouton puis réappuyer** : ce n'est pas couper en parlant.

---

### Option 2 — Le duplex par la mécanique de la parole (recommandé)

**Le principe.** Le micro reste **ouvert en permanence**. Un détecteur de parole
très léger (sur le processeur, quelques mégaoctets) surveille le niveau sonore et
reconnaît une voix humaine. Dès qu'une **vraie** voix commence pendant que Pilot
parle, Pilot applique la recette d'interruption en quatre temps, celle qu'OpenLive
décrit dans sa documentation :

1. **baisser** le son (Pilot continue, mais plus doucement) ;
2. **baisser plus** si vous continuez ;
3. **céder** : il se tait net ;
4. **annuler** : la réponse en cours est abandonnée, on repart de ce que vous
   venez de dire.

Ce n'est pas du « vrai » duplex (Pilot ne réfléchit pas en parlant), c'est une
**imitation intelligente**, et c'est ce qui se fait de plus solide en local.

**Ce que ça donne à l'usage.** Vous parlez, il se tait, il vous écoute. Vous avez
l'impression de le couper. La seule chose qui trahit l'imitation : quand vous
l'interrompez, il ne finit pas sa phrase, alors qu'un humain la finirait parfois.

**Réactivité avant de pouvoir couper.** **200 à 400 millisecondes** après le début
de votre phrase (estimation). Le détail : le son est analysé par tranches de 20 à
50 ms ; il faut 150 à 300 ms de voix pour être sûr que c'est une voix et pas un
bruit ; puis la coupure elle-même est instantanée (elle est déjà écrite).

**Poids et matériel.** **Rien sur la carte graphique** ; tout sur le processeur.

| Pièce | Poids | Rôle |
|---|---|---|
| Détecteur de parole (Silero, petit modèle) | ~2 Mo | savoir si quelqu'un parle |
| Voix → texte local (whisper « base ») | ~75 Mo | comprendre ce qui est dit |
| Voix de synthèse (Piper, déjà installé) | ~63 Mo | répondre |
| **Total** | **~140 Mo** | |

**Difficulté de mise en place.** **Moyenne.** L'assemblage est simple ; **deux
points sont délicats** : l'écho (§ 7.1) et les faux déclenchements (§ 7.3).

**Ce qui existe déjà de solide.** Pilot a déjà la moitié « se taire » (couper la
voix, publier l'état de lecture), la voix locale Piper, le nettoyage du texte, la
dictée, l'endroit unique d'arrêt des agents, et un correctif du micro pour la
fenêtre. **Le navigateur fournit l'annulation d'écho sans rien écrire.**

---

### Option 3 — Le modèle temps réel « tout-en-un » (Moshi et cousins)

**Le principe.** Un seul modèle, spécialement entraîné, écoute et parle **en même
temps**, sur deux flux séparés. Il n'y a plus d'assemblage : plus de détecteur de
parole, plus de voix → texte, plus de voix de synthèse. Le modèle entend, décide,
et parle dans le même geste. C'est la seule vraie conversation parlée.

**Ce que ça donne à l'usage.** Le meilleur des trois, de loin. On peut parler
par-dessus sans que cela ressemble à une manœuvre.

**Réactivité avant de pouvoir couper.** **~200 ms**, chiffre annoncé par l'éditeur
et cohérent avec les mesures publiques.

**Poids et matériel.** C'est ici que ça se gâte.

| Contrainte | Réalité |
|---|---|
| Mémoire vidéo | **24 Go** demandés en version de référence — vous en avez **16** |
| Version compressée | modèle de 8,2 Go ; **mémoire nécessaire non documentée** par l'éditeur |
| Windows | **pas de support officiel** |
| Langue | **anglais seulement** |
| Durée | s'arrête après **5 minutes** de conversation (versions Mac/Rust) |
| Outils | **aucun** : il ne lit pas de fichiers, ne lance pas de commande |

**Difficulté de mise en place.** **Élevée.** Et surtout : **il faudrait un second
« cerveau » à côté de celui de Pilot**, puisque le modèle ne sait pas utiliser les
outils qui font la valeur de Pilot (lire, écrire, tester, suivre des projets).

**Ce qui existe déjà de solide.** Rien dans Pilot. Ce sont des projets de
recherche, solides mais extérieurs.

**Le point décisif, en une phrase.** Moshi ne parle qu'anglais, et **sa voix est
dans le modèle** : il n'y a aucun endroit où brancher une voix française. Choisir
cette option, c'est renoncer au français, ou réentraîner un modèle (hors de
portée).

---

## 3. Tableau comparatif

Notation : ✅✅ très bon · ✅ bon · ⚠️ sous conditions · ❌ éliminatoire.

| Critère | **1. Relais manuel** | **2. Duplex par mécanique** | **3. Modèle tout-en-un** |
|---|---|---|---|
| **Impression de conversation** | ❌ talkie-walkie | ✅ bonne | ✅✅ la meilleure |
| **Couper en pleine phrase** | ⚠️ oui, mais avec un bouton | ✅ oui, **en parlant** | ✅✅ natif |
| **Délai avant de pouvoir couper** | immédiat (bouton) | **200-400 ms** (est.) | ~200 ms |
| **Français parlé** | ✅ oui | ✅ **oui** (Piper) | ❌ **non** |
| **Carte graphique** | inutile | inutile | ❌ **24 Go demandés / 16 disponibles** |
| **Poids à installer** | ~75 Mo | ~140 Mo | 8 à 15 Go |
| **Windows** | ✅ | ✅ | ❌ non supporté |
| **Fonctionne hors ligne, sans clé** | ✅ | ✅ | ✅ |
| **Sait utiliser les outils de Pilot** | ✅ | ✅ | ❌ **non** |
| **Risque d'écho / d'auto-coupure** | ✅ **nul** | ⚠️ **le vrai sujet** | ✅ (géré par le modèle) |
| **Difficulté** | faible | moyenne | élevée |
| **Charge de travail (estimation)** | 3 à 5 jours | **2 à 4 semaines** | plusieurs mois, résultat incertain |
| **Existe déjà, solide** | tout Pilot | moitié de Pilot + le navigateur | projets de recherche |

**Lecture rapide.** La n° 3 gagne sur la fluidité et perd sur **la langue**, **la
carte** et **les outils** — trois critères éliminatoires pour vous. La n° 1 ne
répond pas à votre demande (« en pleine phrase »). La n° 2 est la seule qui coche
« français », « on le coupe en parlant », « tient sur ce PC », « reste utile à
Pilot ».

---

## 4. Ma recommandation, et pourquoi

**Faire la n° 2, en construisant d'abord la n° 1 comme socle.**

Trois raisons, dans l'ordre d'importance.

**1. Parce que la n° 2 est la seule qui garde les outils.** Pilot vaut par ses
agents : ils lisent les fichiers, lancent les tests, suivent les projets. Un
modèle tout-en-un ne sait rien faire de tout cela. Le mettre au centre, ce serait
construire une très belle voix **à côté** de Pilot, pas dedans.

**2. Parce que la n° 2 est déjà à moitié écrite.** `stopReading()` et l'état de
lecture existent ; la voix locale Piper existe ; le nettoyage du texte existe ;
l'arrêt des agents a un endroit unique. Ce qui reste à écrire est **une boucle
d'écoute**, pas une refonte.

**3. Parce que la n° 2 est la seule à ne demander aucun matériel.** Rien sur la
carte graphique, ~140 Mo sur le disque, tout sur le processeur. La n° 3
demanderait une carte que vous n'avez pas.

**Pourquoi je construis quand même la n° 1 d'abord.** Trois jours de travail qui
donnent : un mode vocal **utilisable tout de suite**, un **repli** si l'écho se
révèle ingérable, et surtout **la preuve que la chaîne complète fonctionne** avant
d'y ajouter la partie délicate. C'est l'ordre qui évite de tout perdre si l'étape
difficile échoue.

**Ce que je ne recommande pas :** télécharger 15 Go pour constater que le modèle
ne parle pas français, et écrire l'annulation d'écho avant d'avoir essayé un
casque.

### 4.1 La question qu'on oublie souvent

Une réponse d'agent Pilot est **longue et technique** : du Markdown, des listes,
des blocs de code, des noms de fichiers. Lue à voix haute, elle ne ressemble pas à
une conversation, elle ressemble à un rapport lu par un robot. Deux réglages sont
donc nécessaires, et ils ne coûtent presque rien :

- **Dire une phrase d'attente tout de suite** (« alors, je regarde… ») dès que
  l'agent est lancé — sinon les secondes de réflexion passent pour une panne. Cette
  idée vient de Cornelius, elle est libre de réutilisation.
- **Lire une version courte** : deux ou trois phrases, puis « le détail est à
  l'écran ». C'est un choix d'écriture, pas de technique.

Sans ces deux points, même l'option 3 décevrait.

---

## 5. L'impact sur le choix de la voix française

C'est le point que la question précédente laissait ouvert, et c'est ici qu'il se
ferme. La règle est simple :

> **L'interruption ne marche qu'avec une voix qui produit un son que Pilot peut
> arrêter.** Autrement dit : une voix **en dehors du raisonnement**.

| Voix | Coupable en pleine phrase ? | Pourquoi | Verdict |
|---|---|---|---|
| **Piper** (voix locale, 63 Mo) | ✅ **oui, immédiatement** | Chaque phrase devient un fichier son lu par Pilot ; couper = arrêter la lecture et jeter la suite. Le mécanisme existe déjà (`extraStops`, `read-aloud.js:625`) | ✅ **compatible, et déjà en place** |
| **Voix Windows** (`speechSynthesis`) | ✅ oui, mais ⚠️ grossièrement | `cancel()` coupe net (`read-aloud.js:631`), sans nuance : pas de baisse progressive, pas de fondu, pas de repère de mot fiable | ⚠️ **repli acceptable**, pas la voix d'une conversation |
| **MeloTTS** | ✅ oui (même modèle de fichier) | Comme Piper, il fabrique un fichier qu'on peut arrêter. **Mais** : il faut Python et une bibliothèque de calcul lourde (~1-2 Go), il est plus lent sur processeur, et il n'apporte **rien** en matière d'interruption | ⚠️ **possible, sans bénéfice** — à ne choisir que si sa voix vous plaît davantage |
| **La voix intégrée d'un modèle duplex (Moshi)** | ❌ **non** | La voix *est* le modèle. Il n'y a pas de fichier à arrêter, pas de réglage de voix, pas de français possible sans réentraînement | ❌ **incompatible avec le français** |

**Trois conséquences pratiques.**

1. **Le choix de la voix devient indépendant du chantier conversation** — à une
   condition : que la voix reste **un moteur séparé qui produit du son**. Que vous
   choisissiez Piper aujourd'hui et MeloTTS dans six mois, l'interruption continue
   de fonctionner sans être réécrite. C'est un argument fort pour **ne pas** aller
   vers l'option 3.
2. **Le réglage de la voix reste unique.** Pilot a déjà un seul endroit pour la
   voix (`read_aloud_voice`, valeur réservée `local:piper`,
   `spec_read_aloud.md` § 2 et § 3). Le mode conversation **doit réutiliser ce
   réglage**, pas en créer un second — sinon un même son aurait deux endroits de
   configuration, ce que le projet interdit déjà pour ce réglage.
3. **La voix Windows reste le filet.** Si Piper est absent ou échoue, Pilot lit
   déjà avec la voix du système en le disant clairement
   (`spec_read_aloud.md` § 4.4). Le mode conversation hérite de ce filet : on
   peut toujours le couper, même dégradé.

**Et si vous préférez la voix Windows à Piper ?** La conversation reste possible :
on peut la couper, mais **sans nuance** (le son s'arrête net, sans baisse
progressive). Le résultat sera plus brusque à l'oreille. Ce n'est pas bloquant,
c'est moins agréable.

---

## 6. Découpage en étapes, avec ce qu'on peut vérifier tout de suite

Chaque étape indique **ce qu'on peut essayer immédiatement** pour savoir si elle
tient, **avant** d'écrire quoi que ce soit de plus.

### Étape 0 — Trois décisions à prendre (aucun travail)

| Question | Ce qu'elle change |
|---|---|
| **Casque ou haut-parleurs ?** | Un casque supprime le piège n° 1. Des haut-parleurs imposent d'écrire l'annulation d'écho : c'est le gros du risque. |
| **Le son peut-il sortir de la maison ?** | Non → la dictée actuelle doit être remplacée par un moteur local (§ 1.3). Oui → on garde la dictée telle quelle. |
| **Couper = arrêter l'agent, ou le laisser finir ?** | Arrêter perd le travail en cours ; laisser finir produit une réponse qui ne vous intéresse plus. Les deux sont défendables. |

### Étape 1 — Mesurer la coupure qui existe déjà (½ heure, zéro code)

**À essayer tout de suite.** Ouvrir une réponse assez longue, cliquer **🔊
Écouter**, puis, pendant que ça parle, lancer la lecture d'une **autre** réponse.
La première doit s'arrêter net. Refaire avec la voix locale (`local:piper`)
sélectionnée dans ⚙️ Paramètres → Assistant.

**Ce que ça prouve.** La moitié « se taire » est acquise, y compris pour la voix
locale. **Ce que ça ne prouve pas** : que Pilot sache *quand* se taire.

### Étape 2 — Le test décisif : l'écho (½ journée, aucun code dans Pilot)

**À essayer tout de suite.** Ouvrir la console de développement de Pilot, ouvrir le
micro, et **afficher le niveau sonore** pendant que Pilot lit à voix haute.
D'abord **avec un casque**, puis **avec les haut-parleurs**.

**Ce qu'on doit voir.** Casque : le niveau reste au plancher, l'écho n'existe pas.
Haut-parleurs : le niveau monte avec la voix de Pilot — et là, sans annulation
d'écho, **Pilot se couperait lui-même en boucle**.

**Ce que ça décide.** Le casque fait passer le chantier de « 4 semaines risquées »
à « 2 semaines maîtrisées ». C'est la mesure la plus rentable de tout le document.

### Étape 3 — La boucle audio, dans la page web plutôt que dans la fenêtre (1-2 jours)

**Pourquoi la page web.** Le navigateur Chrome a **la meilleure annulation
d'écho** et la page distante existe déjà (`web/js/app.js`). La fenêtre de Pilot
demande un correctif local du composant d'affichage, **à réappliquer à chaque
montée de version de Tauri** (décision 5 de `spec_voice_input.md`). Prototyper côté web,
c'est ne pas payer cette dette deux fois.

**À essayer tout de suite.** Ouvrir la page distante dans Chrome, autoriser le
micro, parler : le niveau doit réagir. Puis faire tourner une voix à côté (Piper
en ligne de commande) et vérifier que **le niveau ne réagit pas** à la voix de
Pilot. C'est le test d'écho du navigateur, réel et mesuré.

### Étape 4 — Faire de l'interruption une décision mesurée (2-3 jours)

Brancher le détecteur de parole sur `stopReading()`, avec des seuils : durée
minimale de voix, temps de silence de fin, anti-rebond.

**À essayer tout de suite.** Lire **10 minutes** de texte à voix haute sans rien
dire, et compter les coupures qui se déclenchent seules. **Objectif : zéro.** Puis
parler franchement par-dessus et compter les coupures manquées.

**Le point d'attention.** Un arrêt déclenché par la voix est un arrêt **manuel**
(vous l'avez demandé en parlant). Il doit donc être marqué comme tel dans
l'entonnoir unique des arrêts (`agent-stop-funnel.js:55`, marqueur
`R3-EXCEPTION-MANUEL`), sinon le détecteur anti-régression du projet le
considérera comme un arrêt automatique non tracé et **le test échouera**.

### Étape 5 — Voix → texte, en local (2-4 jours)

**À essayer tout de suite.** Dicter une phrase de 5 secondes avec la dictée
actuelle, chronométrer, puis comparer avec un moteur local sur la même phrase.
Deux mesures comptent : **le temps de transcription** et **les fautes sur les noms
propres et les termes techniques** (fichiers, fonctions). Les noms de code sont
précisément ce que la dictée rate le plus.

### Étape 6 — Boucler un tour complet (2-3 jours)

Écoute → texte → agent → voix, **avec la phrase d'attente**. Sans elle, on croit à
une panne.

**À essayer tout de suite.** Chronométrer du début de votre phrase à la **première
seconde de son** de la réponse. C'est ce chiffre, et non les 200 ms du modèle, qui
décidera si l'expérience est bonne.

### Étape 7 — Enchaîner deux tours, et réorienter (2-3 jours)

Régler les seuils sur un vrai enchaînement, puis brancher la réorientation :
quand vous coupez, l'agent doit **tenir compte de ce que vous venez de dire** au
lieu de continuer sa réponse précédente.

**À essayer tout de suite.** Couper Pilot au milieu d'une tâche longue et vérifier
qu'il repart de votre nouvelle demande, sans reprendre l'ancienne.

### Étape 8 — Un seul réglage, un journal, un repli (1-2 jours)

Un réglage « mode conversation » dans ⚙️ Paramètres → Assistant, **à côté** de la
section de lecture existante, réutilisant le **même** choix de voix. Un journal
des replis, sur le modèle de `voix-locale.log` (`spec_read_aloud.md` § 4.4).

### Étape 9 — Documentation et tests anti-régression (1 jour)

Spécification dédiée, aide intégrée, et tests : la voix se coupe, une seule lecture
à la fois, aucune lecture automatique, le réglage n'existe qu'une fois, l'arrêt par
la voix est marqué comme manuel.

**Total : 2 à 4 semaines** (estimation d'ordre de grandeur, à réviser après
l'étape 2).

---

## 7. Risques et pièges connus

### 7.1 L'écho — le piège numéro un

**Le problème.** Le micro entend la voix de Pilot sortir des haut-parleurs. Pilot
croit qu'on l'interrompt, donc il se tait. Puis, se taisant, il n'entend plus rien
et reprend. Résultat : il bégaie, ou il ne parle jamais.

**Trois parades, de la plus sûre à la plus fragile :**

1. **Un casque.** Aucun code, efficacité totale. C'est la seule solution qui ne
   demande rien.
2. **L'annulation d'écho du navigateur** (fournie par Chrome, une option à
   activer). Bonne dans un navigateur, **incertaine dans la fenêtre de Pilot**
   (composant d'affichage WebView2) — d'où l'étape 3 côté web.
3. **Un annulateur maison.** C'est ce que fait OpenLive, et c'est la partie la plus
   délicate du projet. À réserver au cas où les deux premières échouent.

**À décider :** casque, ou haut-parleurs.

### 7.2 Pilot s'interrompt lui-même, en boucle

Sans écho maîtrisé, l'interruption se déclenche sur sa propre voix, il se tait, ne
s'entend plus, reprend, se coupe… Il faut donc **une garde** : ne jamais accepter
une interruption dans les **X premières millisecondes** qui suivent le début de sa
propre phrase, et **ignorer** une interruption qui ressemble trop à ce qu'il vient
de dire.

### 7.3 Les faux déclenchements (toux, bruit de chaise, porte)

Un détecteur de niveau seul se déclenche sur tout. Un détecteur de **voix** (petit
modèle) est bien plus sûr, pour 2 Mo. Il faut aussi un **temps de silence de fin**
pour savoir quand vous avez terminé (trop court : on coupe au milieu d'une
hésitation ; trop long : on attend).

### 7.4 Il coupe votre dernière phrase

Piège discret : vous parlez, il se tait — mais ce que vous venez de dire se perd,
parce qu'il avait déjà commencé à répondre autre chose. Il faut **conserver la
dernière phrase entendue** et la traiter en priorité.

### 7.5 Les trous entre les phrases

La voix Piper est fabriquée **phrase par phrase** ; entre deux phrases, un silence
peut s'entendre si la fabrication suivante n'est pas prête. Pilot anticipe déjà
(il prépare la phrase suivante pendant que la précédente est lue,
`src/js/local-voice.js`), mais sur un processeur chargé — un agent qui compile en
même temps — le trou s'entend. C'est un point à écouter à l'étape 6.

### 7.6 Le décalage qui déçoit

Le vrai délai n'est pas la voix, c'est **la réflexion de l'agent** : secondes,
parfois minutes pour une tâche de code. Aucune option de ce document ne le
supprime. Les deux seules choses qui aident : **la phrase d'attente** et **la
possibilité de le couper**. C'est exactement pourquoi l'option 3, qui ne règle ni
l'un ni l'autre, ne mérite pas son coût.

### 7.7 Le micro ouvert en permanence

Deux effets à connaître : la conversation **empêche la mise en veille** de
l'ordinateur, et le micro ouvert pose une **question de vie privée** — encore plus
si le moteur de reconnaissance envoie le son au-dehors (§ 1.3). Il faut donc un
**arrêt franc** du mode conversation, visible dans l'interface.

### 7.8 Ce qui reste fragile dans le projet

| Piège | Conséquence |
|---|---|
| Le correctif du micro de la fenêtre doit être **réappliqué à chaque montée de version de Tauri** | travail récurrent, à inscrire au coût |
| Piper est en licence **GPL** | doit rester **un programme à part**, lancé par Pilot, jamais collé dans le code — c'est déjà le cas |
| **Deux voix en même temps** | Pilot garantit déjà une seule lecture ; le mode conversation doit tenir la même règle |
| **La dictée actuelle n'est pas locale** | contraire au « tout local » si le micro reste ouvert |

---

## 8. Fichiers concernés (pour le jour où on réalisera)

Aucun n'est modifié aujourd'hui. Cette liste sert à mesurer la surface du chantier.

| Fichier | Ce qu'il porterait |
|---|---|
| `src/js/conversation-loop.js` *(nouveau)* | **seule** machine à états d'un tour de parole : écoute → texte → agent → voix → interruption |
| `src/js/voice-activity.js` *(nouveau)* | seul détecteur de parole (seuils, durées, anti-rebond) — testable sans navigateur |
| `src/js/speech-to-text.js` *(nouveau)* | seul chemin voix → texte local, avec repli explicite |
| `src/js/read-aloud.js` | **réutilisé tel quel** : `stopReading`, état de lecture, découpage |
| `src/js/local-voice.js` · `src-tauri/src/tts_local.rs` | **réutilisés tels quels** (voix Piper) |
| `src/js/speech-text.js` | **réutilisé tel quel** (nettoyage du texte lu) |
| `src/js/agent-stop-funnel.js` | accueille l'arrêt **manuel** déclenché par la voix (`R3-EXCEPTION-MANUEL`) |
| `src/js/agent-pi.js` · `src/js/super-agent.js` | entrée vocale de la conversation (même chemin que la saisie clavier) |
| `web/js/app.js` | prototype de la boucle audio (annulation d'écho du navigateur) |
| `index.html` · `src/css/style.css` | un réglage « mode conversation », un bouton d'arrêt franc |
| `src-tauri/src/` | éventuel service local de reconnaissance vocale |
| `spec_read_aloud.md` | mention du mode conversation (le réglage de voix reste unique) |
| `docs/` · `help/overview.md` | ce document, puis la spec et l'aide utilisateur |

**Une règle à respecter dès le premier fichier :** le mode conversation ne crée
**ni second réglage de voix, ni second journal de repli** — il réutilise ceux de la
lecture à voix haute.

---

## 9. Ce qui vous reste à trancher

1. **Casque ou haut-parleurs ?** (change le risque et la durée)
2. **Le son peut-il sortir de la maison ?** (change le moteur voix → texte)
3. **Couper = arrêter l'agent ou le laisser finir ?**
4. **Voix Piper, MeloTTS ou Windows ?** (les trois sont compatibles ; Piper est déjà
   en place)
5. **Version courte parlée et phrase d'attente : oui ou non ?** (je recommande oui)
6. **Fait-on l'étape 2 (test d'écho) avant tout le reste ?** (je recommande oui)

---

## 10. Ce que je n'ai pas vérifié

1. **Le délai réel de 200 à 400 ms** avant la coupure : c'est une estimation
   construite à partir des tailles de fenêtre d'analyse audio, pas une mesure sur
   ce poste. L'étape 4 la mesurera.
2. **La tenue de l'annulation d'écho dans la fenêtre de Pilot** (WebView2) : je ne
   l'ai pas testée. Dans Chrome, elle est fiable ; ailleurs, moins.
3. **La vitesse de Piper sur ce processeur, agent en train de travailler à côté** :
   aucun chiffre mesuré. C'est l'objet de l'étape 6.
4. **La qualité de la reconnaissance vocale locale en français** sur des noms de
   fichiers et de fonctions : à mesurer (étape 5), c'est le point faible attendu.
5. **La mémoire vidéo réellement nécessaire pour un modèle duplex compressé** :
   non documentée par l'éditeur. Je ne peux donc pas affirmer qu'elle tienne sur
   16 Go — seulement qu'elle est probablement insuffisante en version de référence.
6. **Les durées des étapes** : des ordres de grandeur, pas des mesures.

---

*Document de conception. Aucun fichier de code n'a été modifié, aucun logiciel
installé, aucun modèle téléchargé, aucune version changée.*
