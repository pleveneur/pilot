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

> **Révision du 2026-11-02 — les questions sont tranchées.** Le propriétaire a
> répondu aux six questions du § 9 et une vérification technique a répondu à la
> question de la voix → texte. Les décisions sont **fermes** : ce document les
> enregistre, il ne les rediscute plus. Le § 9 s'appelle désormais
> **« décisions prises »**, la section **6bis** décrit la **mesure d'écho
> automatique déjà en place** (aucune manipulation à faire), et le § 11 tient le
> **journal des modifications** de cette révision. Le reste du document est
> conservé tel quel.

### Ce qui a été tranché, en une page

| # | Question (§ 9 d'origine) | Décision du propriétaire |
|---|---|---|
| 1 | Casque ou haut-parleurs ? | **Haut-parleurs.** Pas de casque : l'anti-écho reste nécessaire, et il est **mesuré automatiquement, à chaque lecture** (§ 6bis). |
| 2 | Le son peut-il sortir de la maison ? | **Non.** La voix → texte passe par le service local **VoiceStudio** (§ 1.3, § 5bis). |
| 3 | Couper = arrêter l'agent ou le laisser finir ? | **Aucune règle mécanique.** C'est **l'assistante** qui tranche à chaque coupure (§ 4.2). |
| 4 | Voix Piper, MeloTTS ou Windows ? | **La voix déjà réglée par défaut**, personnage actif compris (`read_aloud_voice` + `character_voices`). Aucun nouveau réglage (§ 5). |
| 5 | Version courte parlée et phrase d'attente ? | **Oui**, liste de phrases d'attente choisie par **Laya** quand il est activé (§ 4.1). |
| 6 | Faut-il mesurer l'écho à la main avant de développer ? | **Non : c'est déjà automatique.** La mesure se fait toute seule à chaque lecture, et la détection se désarme si l'écho n'est pas maîtrisé (§ 6bis). |

**Et le point qui change la conception :** la **coupure de la parole existe déjà et
fonctionne** (bouton « taire » + prise de parole par-dessus la lecture, avec garde
anti-écho, § 1.2). Le chantier n'est donc **pas** de savoir couper : il est
**d'enchaîner** — couper → comprendre → réorienter.

---

## 0. Résumé en dix lignes

- Le besoin réel n'est pas « un moteur plus rapide » : **c'est de pouvoir couper et
  réorienter**. La lenteur de Pilot vient de l'agent (secondes, parfois minutes),
  pas de la voix.
- **La moitié du travail est déjà faite** : Pilot sait couper sa propre voix
  instantanément (`stopReading()`, `src/js/read-aloud.js:549`) et publie son état
  de lecture en continu (`pilot-read-aloud-state`, même fichier ligne 117).
- **Cette moitié n'est plus une moitié : la coupure est LIVRÉE** (révision du
  2026-11-02). Le micro écoute déjà pendant que la voix parle, la parole franche
  interrompt la lecture, et une garde anti-écho empêche Pilot de se couper
  lui-même (`src/js/vocal-mic.js`, § 1.2).
- **Ce qui manque tient en une phrase** : **enchaîner** après la coupure —
  comprendre la phrase qui vient d'être dite et **réorienter** le travail en
  cours, au lieu de simplement se taire.
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
  **À réviser à la baisse** depuis le 2026-11-02 : la coupure et le moteur
  voix → texte sont déjà là.
- Le piège n° 1 n'est pas la vitesse : c'est **l'écho** (le micro qui entend les
  haut-parleurs). Travailler **aux haut-parleurs** (décision du propriétaire)
  rend ce piège central — mais il est **déjà traité** : la mesure de l'écho est
  **automatique**, faite à chaque lecture, et la détection se désarme d'elle-même
  quand l'écho n'est pas maîtrisé (§ 6bis). Rien à relever à la main.
- **Plus aucune décision n'attend le propriétaire** : les six questions du § 9
  d'origine sont tranchées (voir le tableau après l'en-tête), et le service local
  **VoiceStudio** fournit la voix → texte sans rien installer (§ 1.3).

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
| **Couper Pilot en parlant** (prise de parole par-dessus la lecture) | `src/js/vocal-mic.js` (§ 4a : `planSpeechGate`, `bargeInArmed`) · `src/js/super-agent.js` (`vocalBargeIn`) |
| **Une garde anti-écho déjà écrite** (résidu mesuré au début de chaque lecture, exigence tirée de ce résidu, désarmement tracé) | `src/js/vocal-mic.js` (garde du micro, § 6bis) |
| Envoyer la dictée **sans clic**, à la fin de la phrase | `src/js/voice-auto-send.js` (`decideVoiceAutoSend`, `applyVoiceEnd`) |
| La **voix propre au personnage actif** (réutilise le réglage existant) | `src/js/character-voices.js` (`voiceForCharacter`) |
| Page web distante (le micro y marche normalement) | `web/js/app.js` · `spec_web_remote.md` |

### 1.2 Ce qui manque, et ce qui ne manque plus

**Décision du propriétaire (2026-11-02) : la coupure existe et fonctionne.** Le
bouton « taire » et la prise de parole par-dessus la lecture sont **déjà livrés**
(`vocal-mic.js`, `super-agent.js`). Ce document ne propose donc **pas** de
réinventer la coupure : il décrit ce qu'il reste à faire **après** elle.

| Point | État au 2026-11-02 |
|---|---|
| **Couper la voix** (bouton, puis en parlant) | ✅ **livré et testé** (`ecran-vocal-lot3/4a`, `vocal-barge-in`) |
| **Savoir que ce qu'on entend est une interruption** et non un toussotement ou l'écho de Pilot | ✅ **livré** (détecteur à deux seuils + garde anti-écho, `vocal-mic.js`) |
| **Comprendre ce qui a été dit** | ⚠️ **reste à faire** : la phrase transcrite n'arrive pas encore à l'assistante **avec l'état du travail en cours** (§ 4.2) |
| **Réorienter le travail en cours** (couper → comprendre → réorienter) | ⚠️ **reste à faire** : c'est **le chantier** (étapes 7 et 8 du § 6) |
| **Meubler l'attente par une phrase parlée adaptée** | ⚠️ **reste à faire** (liste de phrases + choix par Laya, § 4.1) |

**Le chantier tient donc en une phrase :** *enchaîner* — couper (fait) →
comprendre (à brancher sur VoiceStudio) → réorienter (à décider par l'assistante,
à chaque fois).

### 1.3 Le son peut rester dans la maison — et rien n'est à installer

La dictée d'aujourd'hui utilise la reconnaissance vocale **du navigateur**
(`SpeechRecognition`, `src/js/agent-pi.js:956` et `src/js/super-agent.js:4949`),
qui envoie le son chez Microsoft sous Windows. Pour une conversation au micro
ouvert en permanence, c'était le point gênant (question de vie privée, § 7.7).

**Vérification du 2026-11-02 : le moyen existe, il reste à le brancher.** Le service
local **VoiceStudio** — déjà installé sur ce poste, `http://127.0.0.1:3900`,
version 0.5.7 — **sait transcrire** :

| Ce qui a été constaté | Conséquence pour ce document |
|---|---|
| Moteur **Whisper large-v3** installé et **actif sur GPU**, dictée déclarée prête | **Rien à installer** côté voix → texte : le moteur est **déjà présent**. Le tableau des poids du § 2 et du § 3 change (ci-dessous). |
| Deux portes : `POST /v1/audio/transcriptions` (fichier) et WebSocket `/v1/audio/transcriptions/stream` (direct) | Le **direct** existe : la boucle d'écoute n'a pas besoin d'attendre la fin d'un fichier. |
| Français prévu | La conversation en français reste possible (§ 5). |
| **Aucune transcription réelle n'a encore été lancée** | **Point non vérifié, conservé explicitement** : la **qualité en français** sur les **noms de fichiers** et les **termes techniques** reste à mesurer (étape 5). Le fait que le moteur soit présent ne prouve pas qu'il écrive « `super-agent.js` » correctement. |

**Trois conséquences à retenir :**

1. **Aucun son ne part chez Microsoft dès que la dictée passe par ce service
   local.** Cela **remplace le choix implicite actuel** (le navigateur) ; ce
   remplacement est un **prérequis** de la conversation permanente, pas une option.
   **Ce qui est acquis** : le service sait transcrire. **Ce qui reste à faire** :
   brancher la dictée de Pilot dessus (étape 5). Tant que ce n'est pas fait, la
   dictée actuelle continue d'envoyer le son au navigateur.
2. **Le tableau des poids du § 2 et du § 3 est corrigé** : la ligne « voix → texte
   ~75 Mo à installer » **disparaît**. Il n'y a **rien à prévoir** en disque pour
   la voix → texte — le moteur et ses poids sont déjà là (ils appartiennent à
   VoiceStudio, Pilot ne les télécharge pas).
3. **Pilot ne joint jamais le service depuis la fenêtre** : il passe par ses
   commandes existantes (`src-tauri/src/tts_voicestudio.rs`, et côté fenêtre
   `src/js/voicestudio-voice.js`). La transcription suivra la même règle : un
   module **frère** de la synthèse, pas un appel direct depuis la page.

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
voix → texte local (voir § 5bis). **Après la vérification du 2026-11-02, plus rien
n'est à installer** : le service local VoiceStudio fournit déjà Whisper large-v3
(§ 1.3). Les tailles citées ici (75 Mo pour « base », ~500 Mo pour « small »)
restent des **ordres de grandeur historiques** de ce qu'un moteur séparé
coûterait ; elles ne s'appliquent plus à ce poste.

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
| Voix → texte local | **rien à installer** (2026-11-02) | comprendre ce qui est dit — **déjà fourni par le service local VoiceStudio** (§ 1.3) |
| Voix de synthèse (Piper, déjà installé) | ~63 Mo | répondre |
| **Total réellement à prévoir** | **~2 Mo** (le détecteur, s'il est retenu) | le reste est déjà là |

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
| **Poids à installer** | **~rien** (voix → texte déjà présente) | **~2 Mo** (détecteur de parole) | 8 à 15 Go |
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
carte graphique, **presque rien sur le disque** (~2 Mo pour le détecteur de parole ;
la voix → texte est **déjà présente** dans le service local, § 5bis), tout sur le
processeur. La n° 3 demanderait une carte que vous n'avez pas.

**Pourquoi je construis quand même la n° 1 d'abord.** Trois jours de travail qui
donnent : un mode vocal **utilisable tout de suite**, un **repli** si l'écho se
révèle ingérable, et surtout **la preuve que la chaîne complète fonctionne** avant
d'y ajouter la partie délicate. C'est l'ordre qui évite de tout perdre si l'étape
difficile échoue.

**Ce que je ne recommande pas :** télécharger 15 Go pour constater que le modèle
ne parle pas français, et écrire l'annulation d'écho avant d'avoir essayé un
casque.

> **Note de révision (2026-11-02).** La phrase ci-dessus parlait d'un casque. La
décision est prise : **haut-parleurs, pas de casque**. L'écho est donc le sujet
principal — mais il est **déjà mesuré automatiquement** à chaque lecture (§ 6bis).
Lire cette phrase comme : « et écrire l'annulation d'écho avant d'avoir **regardé
ce que la mesure automatique donne** ».

### 4.1 La question qu'on oublie souvent

Une réponse d'agent Pilot est **longue et technique** : du Markdown, des listes,
des blocs de code, des noms de fichiers. Lue à voix haute, elle ne ressemble pas à
une conversation, elle ressemble à un rapport lu par un robot. Deux réglages sont
donc nécessaires, et ils ne coûtent presque rien :

- **Dire une phrase d'attente tout de suite** dès que l'agent est lancé — sinon les
  secondes de réflexion passent pour une panne. Cette idée vient de Cornelius, elle
  est libre de réutilisation. **Décision : oui, et sous forme d'une LISTE de
  phrases** (voir ci-dessous).
- **Lire une version courte** : deux ou trois phrases, puis « le détail est à
  l'écran ». C'est un choix d'écriture, pas de technique. **Déjà réglé** : l'écran
  Vocal impose cette brièveté par une consigne ajoutée à la demande
  (`src/js/vocal-brevity.js`, `spec_modes_ecran_vocal.md` § 6bis).

Sans ces deux points, même l'option 3 décevrait.

#### 4.1.1 La phrase d'attente parlée — décision tranchée

**Décision du propriétaire : oui, une phrase d'attente parlée, sous forme d'une
LISTE de phrases, et c'est Laya qui choisit la plus adaptée à la demande** — quand
Laya est activé. Quatre garde-fous, **écrits noir sur blanc** :

| Garde-fou | Ce que cela interdit, en clair |
|---|---|
| **(a) Ne jamais mentir sur ce qui se passe** | Aucune phrase n'affirme qu'une chose est terminée, ni qu'un fichier a été trouvé, ni qu'un résultat existe. Une phrase d'attente dit seulement qu'on **regarde** ou qu'on **travaille**. |
| **(b) Aucune durée promise** | Aucun « une seconde », « deux minutes », « tout de suite ». Rien n'oblige Pilot à tenir ce qu'il n'a pas mesuré. |
| **(c) Un SEUL point de choix, et un repli neutre** | Une seule fonction décide quelle phrase est dite. Laya absent, éteint, ou peu sûr → **une phrase neutre de repli**, jamais un tirage au hasard inventé (aucun aléatoire n'est admis). |
| **(d) Module pur et texte centralisé** | Le module ne fait ni DOM ni minuterie (testable sans navigateur) et la liste des phrases vit **à un seul endroit**, jamais recopiée dans deux fichiers. |

**Comment Laya est employé, exactement.** Laya est le classifieur **local** déjà
présent (`laya_classify`, type « choice », service local — voir `spec_laya.md`) :
on lui donne la **liste fermée** des phrases d'attente et **la demande de
l'utilisateur**, il rend la phrase la plus adaptée avec sa confiance. Aucun texte
n'est **inventé** : Laya choisit dans une liste écrite par nous, ce qui garantit
(a) et (b). Coût : zéro jeton, aucun appel sortant.

**Quand rien n'est dit.** Si Laya n'est pas activé, tombe en panne, ou rend une
confiance trop faible, la phrase de repli neutre est dite — et l'écran Vocal est
**déjà** muni de sa ligne d'état écrite (« je regarde… », `super-agent.js`) : la
voix ne fait que doubler ce qui est affiché, elle ne le contredit jamais.

### 4.2 La coupure n'est pas une règle mécanique — c'est un JUGEMENT

**Décision du propriétaire : aucune règle mécanique du type « arrêter l'agent ou
le laisser finir ».** C'est **l'assistante** qui tranche, **à chaque coupure**,
selon ce que l'utilisateur vient de dire. Trois issues possibles, et seule la
phrase entendue les distingue :

| Ce que l'utilisateur vient de dire | Ce que l'assistante peut décider |
|---|---|
| « laisse tomber », « arrête », « oublie » | **abandonner** le travail en cours |
| « non, plutôt… », « en fait, fais… », « corrige » | **continuer en corrigeant** (même tâche, autre direction) |
| une demande neuve, sans rapport | **prendre la demande neuve** (l'ancienne est abandonnée ou laissée en l'état, dit à voix haute) |

**L'information nécessaire pour trancher** — et c'est cela que la conception doit
fournir, pas un choix figé :

1. **la nouvelle phrase transcrite**, mot pour mot (`vocal-brevity.js` compose déjà
   la demande ; la transcription vient de VoiceStudio, § 1.3) ;
2. **l'état du travail en cours** : ce que l'agent fait, sur quel projet, avec
   quel libellé de tâche — l'écran Vocal affiche déjà ce libellé réel
   (`docs/rapports/RAPPORT-libelle-tache-en-cours-en-haut-a-droite.md`) ;
3. **le fait que la coupure vient d'avoir lieu** (donc que la réponse précédente
   est interrompue, et à quel endroit) ;
4. **rien d'autre n'est décidé à sa place** : aucun délai, aucun seuil, aucune
   heuristique ne choisit « abandonner » ou « continuer ». Si la phrase ne permet
   pas de trancher, **l'assistante demande** — elle ne devine pas.

**Conséquence technique, déjà tenue par le projet.** Un arrêt déclenché par la voix
est un arrêt **manuel** : il porte la marque `R3-EXCEPTION-MANUEL` de l'entonnoir
unique (`src/js/agent-stop-funnel.js`) et ne doit **jamais** être transformé en
arrêt automatique par un détecteur de boucle.

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

### 5.1 Décision tranchée : la voix DÉJÀ RÉGLÉE, personnage actif compris

**La question « Piper, MeloTTS ou Windows ? » est close : le mode conversation ne
choisit rien.** Il parle avec **la voix réglée par défaut**, telle que
l'utilisateur l'a choisie — **personnage actif compris**.

| Ce qui est réutilisé | Où c'est déjà écrit |
|---|---|
| Le **seul** réglage de voix : `read_aloud_voice` (système, `local:piper`, `local:piper:<modèle>`, `local:voicestudio:<profil>`) | `src/js/read-aloud.js` · `spec_read_aloud.md` § 2 et § 3 |
| La **voix propre au personnage actif** (Présences), qui retombe sur la voix générale si elle manque ou n'est plus disponible | `src/js/character-voices.js` (`voiceForCharacter`) · champ `character_voices` |
| Les **replis visibles** (voix locale absente → voix du système, en le disant) | `read-aloud.js` · `spec_read_aloud.md` § 4.4 |

**Conséquence ferme : aucun nouveau réglage de voix n'est créé.** Pas de second
champ, pas de « voix de la conversation ». Le mode conversation appelle la lecture
qui existe ; il ne choisit **jamais** une voix à la place de l'utilisateur, et il
ne remplace pas non plus la voix du personnage (sinon le personnage changerait de
voix en passant en conversation, ce qui serait un défaut visible).

---

## 5bis. La voix → texte : le service local VoiceStudio

Ce point est **vérifié** (2026-11-02) et il **change le tableau** du § 2 et du § 3.

| Ce qui est déjà là | Ce que cela évite |
|---|---|
| **VoiceStudio** en service local (`http://127.0.0.1:3900`, version 0.5.7) | rien à installer, aucun compte, aucune clé |
| **Whisper large-v3** installé et **actif sur GPU** | ni modèle à télécharger, ni carte graphique à réserver à Pilot : le calcul est déjà fait par un service à part |
| Porte **directe** : WebSocket `/v1/audio/transcriptions/stream` | pas besoin d'attendre la fin d'un fichier pour comprendre une interruption |
| Porte **fichier** : `POST /v1/audio/transcriptions` | un repli simple et lisible si le direct pose problème |
| **Français prévu** par le service | la conversation reste en français (§ 5) |

**Trois règles d'intégration, dans l'esprit du reste du projet :**

1. **La fenêtre ne joint jamais le service elle-même.** La synthèse passe déjà par
   des commandes Rust (`src-tauri/src/tts_voicestudio.rs`, `pub async fn` +
   `spawn_blocking`) ; la **transcription** suit la même forme : un module **frère**,
   côté machine, et un module de décision pur côté fenêtre. `tts_local.rs` (Piper)
   reste intact.
2. **Le service absent n'arrête rien.** Il est éteint, lent ou en panne → repli
   **visible** (la dictée le dit) et le mode conversation reste utilisable en
   **frappe clavier**. Jamais de blocage ni d'exception.
3. **Aucune promesse sur la qualité.** Le moteur est présent ; **aucune
transcription réelle n'a encore été lancée**. La qualité en français sur les
**noms de fichiers** et les **termes techniques** est le **point non vérifié** de
ce document (§ 10, point 4) et l'objet de l'étape 5.

**Ce que cela remplace, dit franchement :** la dictée actuelle (`SpeechRecognition`
du navigateur) envoie le son chez Microsoft. Une fois la dictée branchée sur le
service (**étape 5**), la conversation permanente passe par le **local** : **aucun
son ne sort de la maison**. C'est un changement de chemin, pas un réglage de plus —
et tant que le branchement n'est pas fait, la dictée actuelle envoie toujours le son
au navigateur.

---

## 6. Découpage en étapes, avec ce qu'on peut vérifier tout de suite

Chaque étape indique **ce qu'on peut essayer immédiatement** pour savoir si elle
tient, **avant** d'écrire quoi que ce soit de plus.

### Étape 0 — Décisions : PRISES le 2026-11-02 (aucun travail restant)

Ces trois questions ne sont **plus ouvertes** ; elles sont enregistrées ici pour
que l'étape suivante ne les rouvre pas.

| Question | Décision | Conséquence sur les étapes |
|---|---|---|
| **Casque ou haut-parleurs ?** | **Haut-parleurs.** | L'anti-écho est **nécessaire** et déjà **mesuré tout seul** (étape 2, § 6bis). Un casque n'est pas prévu. |
| **Le son peut-il sortir de la maison ?** | **Non.** | La voix → texte passe par le service local **VoiceStudio** (§ 5bis). Rien à installer. |
| **Couper = arrêter l'agent ou le laisser finir ?** | **Ni l'un ni l'autre mécaniquement : l'assistante tranche à chaque coupure** (§ 4.2). | Les étapes 7 et 8 fournissent **l'information** pour trancher, pas une règle figée. |

**Rappel qui change le plan de travail :** la coupure (`stopReading`, bouton
« taire », prise de parole par-dessus la lecture) est **déjà livrée**. L'étape 1 ne
demande donc **aucun développement** : elle ne sert qu'à **constater** sur ce
poste, en haut-parleurs, que le socle tient.

### Étape 1 — Constater la coupure qui existe déjà (½ heure, zéro code)

**À essayer tout de suite.** Ouvrir une réponse assez longue, cliquer **🔊
Écouter**, puis, pendant que ça parle, lancer la lecture d'une **autre** réponse.
La première doit s'arrêter net. Refaire avec la voix locale (`local:piper`)
sélectionnée dans ⚙️ Paramètres → Assistant. Puis, dans l'écran **Vocal**, parler
par-dessus la lecture et vérifier que Pilot **se tait**.

**Ce que ça prouve.** La moitié « se taire » est **acquise et livrée**, y compris
pour la voix locale et **en parlant**. **Ce qu'il reste à faire** : ce qui suit la
coupure — comprendre / réorienter (§ 1.2).

### Étape 2 — L'écho : mesuré automatiquement (acquis, rien à exécuter)

**Haut-parleurs, décidés.** Cette étape **n'est plus un travail** : à chaque
lecture, le micro mesure son propre résidu d'écho pendant une courte phase de
calibration, puis n'accepte une coupure que pour une voix nettement plus forte que
ce résidu, tenue un court instant. Si l'écho est trop fort pour être maîtrisé, la
détection **se désarme** : Pilot **finit sa phrase** au lieu de se couper
lui-même. Le détail est au **§ 6bis** ; il n'y a **aucune manipulation à faire**,
aucun relevé, aucun seuil à noter.

**Ce qui reste, sans protocole.** À l'usage, en haut-parleurs, le **confort** :
coupe-t-il quand on parle franchement, et faut-il parfois répéter ? C'est une
impression d'écoute, pas une mesure à mener.

**Ce que cela change pour la suite.** Plus rien n'attend une mesure d'écho pour
démarrer : le chantier continue tel quel. Si, sur une machine donnée, l'écho était
trop fort, la coupure se désarmerait d'elle-même — l'option 1 (relais manuel)
reste alors le repli prévu (§ 7.1), sans code à ajouter.

### Étape 3 — La boucle audio, dans la page web plutôt que dans la fenêtre (1-2 jours)

**Pourquoi la page web.** Le navigateur Chrome a **la meilleure annulation
d'écho** et la page distante existe déjà (`web/js/app.js`). La fenêtre de Pilot
demande un correctif local du composant d'affichage, **à réappliquer à chaque
montée de version de Tauri** (décision 5 de `spec_voice_input.md`). Prototyper côté web,
c'est ne pas payer cette dette deux fois.

**À essayer tout de suite.** Ouvrir la page distante dans Chrome, autoriser le
micro, parler : le niveau doit réagir. Puis faire tourner une voix à côté (Piper
en ligne de commande) et vérifier que **le niveau ne réagit pas** à la voix de
Pilot. Le navigateur applique sa propre annulation d'écho, et la garde automatique
du § 6bis fait le reste — **aucun relevé manuel à tenir**.

### Étape 4 — Faire de l'interruption une décision mesurée (2-3 jours)

Brancher le détecteur de parole sur `stopReading()`, avec des seuils : durée
minimale de voix, temps de silence de fin, anti-rebond.

> **État du 2026-11-02 : cette étape est déjà écrite et livrée.** Le détecteur,
> les deux seuils (montée/descente), la durée de voix continue, l'anti-rebond et
> la **garde anti-écho** existent dans `src/js/vocal-mic.js` (`planSpeechGate`,
> `stepSpeechGate`, `bargeInArmed`, `BARGE_IN_*`). Ce qui reste ici n'est **pas**
> du code : les seuils se **règlent tout seuls** sur ce poste — la calibration du
> § 6bis mesure l'écho à chaque lecture et fixe l'exigence à partir de lui. Le
> module signale `onSpeechStart` ; l'arrêt reste à l'appelant, et le module ne
> tient **aucun** lecteur.

**Ce qu'on écoute, sans compter.** Rien n'est à relever à la main : la calibration
fait le travail à chaque lecture, et la détection se désarme d'elle-même si l'écho
dépasse ce qu'elle sait absorber. La **garantie de secours** ferme le dernier cas
(une vraie voix qui ne couperait pas) — mais elle se paie d'un délai : ce délai se
constate à l'oreille, il ne se mesure pas ici.

**Le point d'attention.** Un arrêt déclenché par la voix est un arrêt **manuel**
(vous l'avez demandé en parlant). Il doit donc être marqué comme tel dans
l'entonnoir unique des arrêts (`agent-stop-funnel.js:55`, marqueur
`R3-EXCEPTION-MANUEL`), sinon le détecteur anti-régression du projet le
considérera comme un arrêt automatique non tracé et **le test échouera**.

### Étape 5 — Voix → texte, en local (2-4 jours)

**Rien à installer** (vérification du 2026-11-02) : le service local **VoiceStudio**
fournit déjà Whisper large-v3, actif sur GPU, avec une porte **directe**
(WebSocket) et une porte **fichier** (§ 5bis). Cette étape est donc un **branchement**
et une **mesure**, plus une installation.

**À essayer tout de suite.** Dicter une phrase de 5 secondes avec la dictée
actuelle (`SpeechRecognition`), chronométrer, puis **la même phrase** envoyée au
service local, et comparer. Deux mesures comptent : **le temps de transcription**
et **les fautes sur les noms propres et les termes techniques** (fichiers,
fonctions). Les noms de code sont précisément ce qu'une dictée rate le plus.

**Point non vérifié, à garder tel quel :** le moteur est **présent**, mais **aucune
transcription réelle n'a encore été lancée**. Présent ne veut pas dire bon en
français sur « `super-agent.js` » : c'est cette étape qui le dira.

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

> **Note de révision (2026-11-02).** Il n'y a **pas de réglage de voix à créer** :
> la voix du mode conversation est **celle déjà réglée** (`read_aloud_voice`, +
> `character_voices` pour le personnage actif, § 5.1). Même un réglage
> « mode conversation » n'est pas à inventer : les **trois modes d'écran**
> existent déjà (Détaillé · Assistant seul · Vocal, `src/js/screen-mode.js`).
> Cette étape se réduit donc au **journal des replis** et à la **liste des phrases
> d'attente** (§ 4.1.1).

Un **journal des replis**, sur le modèle de `voix-locale.log`
(`spec_read_aloud.md` § 4.4) — et **un seul**, jamais un second journal : le
service vocal local a déjà le sien (`[voix imitée]` y écrit aussi).

### Étape 9 — Documentation et tests anti-régression (1 jour)

Spécification dédiée, aide intégrée, et tests : la voix se coupe, une seule lecture
à la fois, aucune lecture automatique, le réglage n'existe qu'une fois, l'arrêt par
la voix est marqué comme manuel.

**Total : 2 à 4 semaines** (estimation d'ordre de grandeur). **Révisé le
2026-11-02** : la coupure est livrée, la voix → texte est déjà présente et l'écho
est mesuré automatiquement (§ 6bis), donc le reste est plus court. Ce n'est pas une
mesure, et aucune durée n'est promise ici.

---

## 6bis. L'écho : mesuré automatiquement, à chaque lecture (acquis)

**Décision du propriétaire : haut-parleurs, pas de casque** — et **plus rien à
mesurer à la main**. La mesure d'écho **a été faite**, et elle se refait **toute
seule** à chaque lecture, aussi souvent que nécessaire. Cette section décrit **ce
qui existe déjà** ; elle ne demande aucune manipulation, aucun relevé, aucune
durée à chronométrer.

### Ce qui se passe, tout seul, à chaque lecture

Ce qui suit n'est **pas une suite d'étapes à exécuter** : ce sont les trois
moments d'un mécanisme qui se déroule seul, en début de lecture, sans qu'aucun
geste soit demandé.

- **Une courte calibration, en début de lecture.** Le micro écoute **ce que les
  haut-parleurs renvoient de la voix de Pilot** et en retient le **niveau de
  résidu** propre au poste, à ce volume, dans cette pièce.
- **Une exigence tirée de ce résidu.** Pour déclencher une coupure, il faut une
  voix **nettement plus forte que ce résidu**, et **tenue un court instant** —
  de quoi distinguer une vraie prise de parole d'un toussotement ou d'un écho.
- **Un désarmement franc quand l'écho n'est pas maîtrisé.** Si le résidu est trop
  fort — ou si l'annulation d'écho du système ne peut pas être confirmée — la
  détection de coupure **se désarme** pour la lecture en cours : Pilot **va au
  bout de sa phrase** au lieu de se couper lui-même. C'est le comportement voulu :
  mieux vaut une coupure indisponible qu'un Pilot qui bégaie.

**Ce que cela garantit, en clair :** Pilot ne peut pas se couper sur le bruit de
sa propre voix. Le cas « il s'interrompt lui-même en boucle » (§ 7.1, § 7.2) est
donc **traité à la source**, sans intervention, et **à chaque lecture** — pas une
fois pour toutes : un volume changé ou une pièce différente sont repris en compte
au début de la lecture suivante.

### Ce que la mesure automatique ne dit pas

- **Le confort à l'oreille** : le délai perçu entre le moment où l'on parle et
  celui où Pilot se tait, et la fréquence à laquelle il faut répéter une phrase.
  Cela se constate **en écoutant**, pas en remplissant un tableau.
- **Le cas d'une pièce ou d'un volume exceptionnels**, où l'écho dépasserait ce
  que la calibration sait absorber : la détection se désarme alors d'elle-même et
  le **relais manuel** (option 1) reste le repli prévu, sans code à ajouter et
  sans réglage à changer.

**Une conséquence pour le plan de travail :** plus aucune étape n'attend une
mesure d'écho. Ce qui était présenté comme un préalable est un **acquis du
dispositif**.

### Ce que cette section remplace (correction du 2026-11-02)

Une version antérieure de ce document demandait une **mesure manuelle**, en cinq
étapes, **avant tout développement** : compter des coupures spontanées, refaire des
lectures à un volume plus fort, noter un seuil de décision. **C'était faux.** Le
dispositif mesure l'écho et se protège **tout seul**, à chaque lecture ; il n'y a
ni feuille à remplir, ni étape à exécuter, ni seuil à relever. La section décrit
désormais **l'acquis**, et le § 11 en garde la trace.

---

## 7. Risques et pièges connus

### 7.1 L'écho — le piège numéro un

**Le problème.** Le micro entend la voix de Pilot sortir des haut-parleurs. Pilot
croit qu'on l'interrompt, donc il se tait. Puis, se taisant, il n'entend plus rien
et reprend. Résultat : il bégaie, ou il ne parle jamais.

**Trois parades, de la plus sûre à la plus fragile :**

1. **Un casque.** Aucun code, efficacité totale. C'est la seule solution qui ne
   demande rien. **Écartée par décision du propriétaire** (2026-11-02) : l'usage
   visé est aux **haut-parleurs**. Elle reste la **bonne réponse de dépannage** si
   l'écho d'une machine particulière se révélait trop fort pour la mesure
   automatique (§ 6bis), mais elle n'est plus le plan.
2. **L'annulation d'écho du navigateur** (fournie par Chrome, une option à
   activer). Bonne dans un navigateur, **incertaine dans la fenêtre de Pilot**
   (composant d'affichage WebView2) — d'où l'étape 3 côté web. Côté fenêtre, elle
   est **déjà demandée** (`MIC_CONSTRAINTS` : `echoCancellation`, `noiseSuppression`,
   `autoGainControl`) et **relue** sur la piste (`echoCancellationOf`) : le projet
   ne suppose jamais qu'elle est active, il vérifie.
3. **Un annulateur maison.** C'est ce que fait OpenLive, et c'est la partie la plus
   délicate du projet. À réserver au cas où les deux premières échouent.

**Décision prise : haut-parleurs.** Donc **l'anti-écho reste nécessaire** — et il
est **déjà en place** : la mesure du résidu d'écho se fait **automatiquement au
début de chaque lecture**, et la détection se **désarme** si l'écho n'est pas
maîtrisé (§ 6bis). Aucun relevé, aucun seuil à noter à la main.

### 7.2 Pilot s'interrompt lui-même, en boucle

Sans écho maîtrisé, l'interruption se déclenche sur sa propre voix, il se tait, ne
s'entend plus, reprend, se coupe… Il faut donc **une garde** : ne jamais accepter
une interruption dans les **X premières millisecondes** qui suivent le début de sa
propre phrase, et **ignorer** une interruption qui ressemble trop à ce qu'il vient
de dire.

**Cette garde existe déjà.** Au début de chaque lecture, elle mesure le résidu
d'écho, puis exige une voix nettement au-dessus de ce résidu et tenue un instant ;
si l'écho n'est pas maîtrisé, elle **se désarme** (Pilot finit sa phrase). Le
risque n'est donc plus « il n'y a pas de garde » : elle **se règle sur chaque
poste** au début de chaque lecture (§ 6bis). Ce qui reste à l'oreille, c'est le
confort d'usage, pas la sûreté.

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
l'ordinateur, et le micro ouvert pose une **question de vie privée**. Sur ce second
point, **décision du 2026-11-02 : la voix → texte passe par le service local
VoiceStudio**, et **aucun son ne part chez Microsoft** (§ 1.3, § 5bis) — la partie du sujet
de vie privée qui sortait de la maison est donc réglée ; elle n'est pas supprimée
pour autant, car il reste un micro ouvert, avec ce que cela implique. Il faut donc un **arrêt franc du
mode conversation**, visible dans l'interface — l'écran Vocal en a déjà un (le
logo des modes, Échap, fermeture de l'onglet).

### 7.8 Ce qui reste fragile dans le projet

| Piège | Conséquence |
|---|---|
| Le correctif du micro de la fenêtre doit être **réappliqué à chaque montée de version de Tauri** | travail récurrent, à inscrire au coût |
| Piper est en licence **GPL** | doit rester **un programme à part**, lancé par Pilot, jamais collé dans le code — c'est déjà le cas |
| **Deux voix en même temps** | Pilot garantit déjà une seule lecture ; le mode conversation doit tenir la même règle |
| **La dictée actuelle n'est pas locale** | **Résolu** par le service local VoiceStudio (`/v1/audio/transcriptions`) : plus rien ne sort de la maison une fois la dictée branchée dessus (§ 1.3). Reste à **brancher** — c'est l'étape 5. |

---

## 8. Fichiers concernés (pour le jour où on réalisera)

Aucun n'est modifié aujourd'hui. Cette liste sert à mesurer la surface du chantier.

| Fichier | Ce qu'il porterait |
|---|---|
| `src/js/conversation-loop.js` *(nouveau)* | **seule** machine à états d'un tour de parole : écoute → texte → agent → voix → interruption |
| `src/js/voice-activity.js` *(nouveau)* | seul détecteur de parole (seuils, durées, anti-rebond) — testable sans navigateur. **Existant à ne pas doubler** : `vocal-mic.js` porte déjà une partie des seuils (§ 1.2) ; le nouveau module ne doit pas être un second détecteur. |
| `src/js/attente-parlee.js` *(nouveau)* | **seul** point de choix de la phrase d'attente parlée : liste des phrases (`VOCAL_WAIT_PHRASES`), choix par Laya (`laya_classify`, type « choice »), repli neutre — **pur**, sans DOM ni minuterie, texte centralisé une seule fois (§ 4.1.1) |
| `src/js/speech-to-text.js` *(nouveau)* | seul chemin voix → texte local : passe par les commandes de la machine (service VoiceStudio), repli explicite, jamais d'appel direct au service depuis la page (§ 5bis) |
| `src-tauri/src/tts_voicestudio.rs` | **à étendre** : la **transcription** rejoint la synthèse — module frère, `pub async fn` + `spawn_blocking`, `127.0.0.1:3900` uniquement, journal `[voix imitée]`. `tts_local.rs` (Piper) **intact**. |
| `src/js/read-aloud.js` | **réutilisé tel quel** : `stopReading`, état de lecture, découpage |
| `src/js/local-voice.js` · `src-tauri/src/tts_local.rs` | **réutilisés tels quels** (voix Piper) |
| `src/js/vocal-mic.js` | **réutilisé tel quel** : garde anti-écho, seuils, signal `onSpeechStart` — aucun second micro ne doit être ouvert |
| `src/js/character-voices.js` | **réutilisé tel quel** : la voix du personnage actif est celle de la conversation (§ 5.1) |
| `src/js/speech-text.js` | **réutilisé tel quel** (nettoyage du texte lu) |
| `src/js/agent-stop-funnel.js` | accueille l'arrêt **manuel** déclenché par la voix (`R3-EXCEPTION-MANUEL`) |
| `src/js/agent-pi.js` · `src/js/super-agent.js` | entrée vocale de la conversation (même chemin que la saisie clavier) |
| `web/js/app.js` | prototype de la boucle audio (annulation d'écho du navigateur) |
| `index.html` · `src/css/style.css` | un bouton d'arrêt franc. **Pas de nouveau réglage de voix** (§ 5.1) ; les trois modes d'écran existent déjà (`src/js/screen-mode.js`). |
| `spec_read_aloud.md` | mention du mode conversation (le réglage de voix reste unique) |
| `docs/` · `help/overview.md` | ce document, puis la spec et l'aide utilisateur |

**Une règle à respecter dès le premier fichier :** le mode conversation ne crée
**ni second réglage de voix, ni second journal de repli** — il réutilise ceux de la
lecture à voix haute.

---

## 9. Décisions prises (2026-11-02), puis ce qui reste ouvert

### 9.1 Décisions prises — **fermes**, à ne plus rouvrir

| # | Question d'origine | Décision | Où c'est mis en œuvre |
|---|---|---|---|
| 1 | Casque ou haut-parleurs ? | **Haut-parleurs.** L'anti-écho reste nécessaire et **est mesuré automatiquement**, à chaque lecture. | § 6bis, § 7.1 |
| 2 | Le son peut-il sortir de la maison ? | **Non** : voix → texte par le service local **VoiceStudio**. | § 1.3, § 5bis |
| 3 | Couper = arrêter l'agent ou le laisser finir ? | **Aucune règle mécanique** : **l'assistante** tranche à chaque coupure (abandonner / continuer en corrigeant / prendre la demande neuve). | § 4.2 |
| 4 | Voix Piper, MeloTTS ou Windows ? | **La voix réglée par défaut**, personnage actif compris (`read_aloud_voice`, `character_voices`). **Aucun nouveau réglage de voix.** | § 5.1 |
| 5 | Version courte parlée et phrase d'attente ? | **Oui.** Phrase d'attente sous forme de **liste**, choisie par **Laya** (type « choice ») quand il est activé, **repli neutre** sinon. | § 4.1, § 4.1.1 |
| 6 | Faut-il une mesure d'écho manuelle avant de développer ? | **Non** : la mesure est **automatique** (calibration à chaque lecture, désarmement si l'écho n'est pas maîtrisé). Aucun protocole manuel, aucun seuil à noter. | § 6bis, étape 2 |

**Deux points fermés en plus, par la même révision :**

7. **La coupure de la parole existe déjà et fonctionne** (bouton « taire » + prise
   de parole par-dessus la lecture, avec garde anti-écho). Le chantier est
   **d'enchaîner** (couper → comprendre → réorienter), **pas de réinventer la
   coupure** (§ 1.2, § 1.1).
8. **Rien à installer pour la voix → texte** : le service local VoiceStudio fournit
   déjà Whisper large-v3, actif sur GPU, avec porte **fichier** et porte **directe**
   (§ 1.3, § 5bis). Le tableau des poids du § 3 est corrigé en conséquence.

### 9.2 Ce qui reste réellement ouvert

Aucun des six points ci-dessus n'est rouvert ici. Ce qui reste ouvert est
**technique ou d'observation**, jamais une décision de principe :

1. **Le confort d'écoute en haut-parleurs** (délai perçu, phrases à répéter) : la
   **sûreté** de l'écho est acquise et mesurée automatiquement (§ 6bis) ; ce qui
   reste ouvert est une **impression d'usage**, pas une mesure à mener.
2. **La qualité de la transcription en français** sur les noms de fichiers et les
   termes techniques : **aucune transcription réelle n'a été lancée** (§ 10, pt 4).
3. **Quelle forme exacte pour l'information « état du travail en cours »** transmise
   avec la phrase transcrite (libellé de tâche, projet, position d'interruption) :
   le principe est décidé (§ 4.2), le **format** reste à fixer à l'écriture.
4. **La liste des phrases d'attente** elle-même (contenu, nombre) : à rédiger, avec
   les quatre garde-fous du § 4.1.1 comme cadre.
5. **Le sort de l'option 3** (modèle tout-en-un) : sans objet tant que le français
   est requis et que la carte n'a que 16 Go — conservée dans ce document comme
   trace du raisonnement, pas comme piste ouverte.

---

## 10. Ce que je n'ai pas vérifié

*Section relue le 2026-11-02 : les points devenus faux sont corrigés, les points
toujours ouverts sont conservés.*

1. **Le délai réel entre le début d'une phrase et la coupure** : l'estimation de
   200 à 400 ms n'est **toujours pas** une mesure sur ce poste. Le mécanisme, lui,
   est en place (calibration courte en début de lecture, voix tenue un instant,
   garantie de secours) et n'attend **aucun relevé**. Ce qui reste inconnu : **ce
   que cela donne à l'oreille**, ici, en haut-parleurs.
2. **La tenue de l'annulation d'écho dans la fenêtre de Pilot** (WebView2) : elle
   n'est **plus à mesurer à la main** — elle est **lue à chaque lecture**, et quand
   elle ne peut pas être confirmée, la coupure **se désarme** au lieu de mal
   fonctionner (§ 6bis). Dans Chrome elle est fiable ; ailleurs, moins — d'où ce
   désarmement prudent. Ce qui n'est pas mesuré, c'est **le ressenti** : à quel
   point la coupure tombe juste à l'oreille.
3. **La vitesse de Piper sur ce processeur, agent en train de travailler à côté** :
   aucun chiffre mesuré. C'est l'objet de l'étape 6.
4. **La qualité de la voix → texte en français** sur des noms de fichiers et de
   fonctions : **le moteur est présent** (Whisper large-v3, actif sur GPU, service
   local VoiceStudio 0.5.7), **mais aucune transcription réelle n'a encore été
   lancée**. « Installé et actif » ne prouve pas « bon en français sur
   `super-agent.js` » : à mesurer (étape 5), c'est **toujours** le point faible
   attendu.
5. **La mémoire vidéo réellement nécessaire pour un modèle duplex compressé** :
   non documentée par l'éditeur. Je ne peux donc pas affirmer qu'elle tienne sur
   16 Go — seulement qu'elle est probablement insuffisante en version de référence.
   (Sans objet pour l'option retenue.)
6. **Les durées des étapes** : des ordres de grandeur, pas des mesures. Révisées à
   la baisse le 2026-11-02 (coupure livrée, moteur voix → texte présent), sans
   qu'aucune durée ne soit devenue une mesure.
7. **Le comportement de Laya sur un choix de phrase d'attente** : le service et son
   outil (`laya_classify`, type « choice ») existent, mais **aucun essai** n'a été
   fait sur une liste de phrases courtes en français. Le repli neutre est donc prévu
   comme le cas normal, pas comme une exception (§ 4.1.1).

---

## 11. Journal des modifications (révision du 2026-11-02)

*Ce document a été mis à jour de façon **additive** : rien d'utile n'a été retiré,
les sections gardent leur numérotation et leur ordre. Ce journal dit **ce qui a
changé et pourquoi**, y compris les affirmations devenues fausses.*

| Où | Ce qui a été fait | Pourquoi |
|---|---|---|
| En-tête | Ajout d'un bloc **« révision du 2026-11-02 »** + tableau des six décisions. | Le document ne doit plus laisser croire que ces questions attendent une réponse. |
| § 0 (résumé) | La ligne « personne n'écoute le micro pendant que la voix parle » est corrigée : **la coupure est livrée** ; la ligne « trois décisions vous appartiennent » est remplacée par « plus aucune décision n'attend » ; l'estimation 2-4 semaines est **signalée à réviser à la baisse**. | Ces trois affirmations étaient devenues fausses le 2026-11-02. |
| § 1.1 | Ajout de ce qui existe déjà : coupure par la parole (`vocal-mic.js`), garde anti-écho, envoi automatique de la dictée (`voice-auto-send.js`), voix du personnage (`character-voices.js`). | La moitié « se taire » n'est pas à faire : elle est faite. |
| § 1.2 | Section réécrite en **tableau d'état** (livré / reste à faire). Le chantier est nommé : **enchaîner** (couper → comprendre → réorienter). | Répondre à la décision n° 2 (la coupure ne se réinvente pas). |
| § 1.3 | La « gêne » (dictée non locale) devient un **moyen trouvé** : VoiceStudio sait transcrire, deux portes, whisper large-v3 actif sur GPU. Ajout du **point non vérifié conservé** (aucune transcription réelle lancée) et de ce qui **reste à brancher**. | Résultat technique du 2026-11-02 et décision n° 2 (le son ne sort pas). |
| § 2, option 1 | « whisper base 75 Mo à installer » → **plus rien à installer** ; les tailles restent citées comme **ordres de grandeur historiques**. | **Correction d'une affirmation fausse** : le moteur voix → texte est déjà présent. |
| § 2, option 2 | Tableau des poids corrigé : la ligne « voix → texte ~75 Mo » devient « rien à installer » ; total réellement à prévoir **~2 Mo** (détecteur de parole). | Idem : **suppression de l'estimation 75 / 140 Mo pour la voix → texte**, devenue fausse. |
| § 3 (comparatif) | Ligne « Poids à installer » : ~75 Mo / ~140 Mo → **~rien / ~2 Mo**. | Cohérence : aucune ligne contradictoire laissée dans le document. |
| § 4 (fin) | La phrase « essayer un casque » est **conservée** mais annotée (« haut-parleurs décidés, donc **regarder ce que la mesure automatique donne** au lieu d'éviter l'écho »). | Le raisonnement d'origine reste lisible, la décision le corrige. |
| § 4.1 + **nouveau § 4.1.1** | Phrase d'attente : **oui**, sous forme de **liste**, choisie par **Laya** (`laya_classify`, type « choice »), avec les **quatre garde-fous** (jamais mentir · aucune durée · un seul point de choix + repli neutre · module pur, texte centralisé). La version courte est signalée **déjà réglée** (`vocal-brevity.js`). | Décision n° 5, et interdiction de réintroduire une durée présentée comme une mesure. |
| **Nouveau § 4.2** | « La coupure n'est pas une règle mécanique » : les trois issues, et **l'information nécessaire** pour que l'assistante tranche (phrase transcrite + état du travail + fait de la coupure + aucune décision prise à sa place). | Décision n° 3 : décrire l'information, pas un choix figé. |
| § 5 + **nouveau § 5.1** | Ajout de la décision : **la voix déjà réglée**, personnage actif compris (`read_aloud_voice` + `character_voices`), **aucun nouveau réglage de voix**, jamais de voix choisie à la place de l'utilisateur. | Décision n° 4. |
| **Nouveau § 5bis** | Section dédiée à la **voix → texte par le service local VoiceStudio** : ce qui est déjà là, les trois règles d'intégration, ce que cela remplace (plus rien chez Microsoft). | Résultat technique vérifié ; éviter d'enfouir le fait le plus structurant dans une note. |
| § 6, étape 0 | « Trois décisions à prendre » → **« décisions prises le 2026-11-02 »**, avec la conséquence de chacune sur les étapes. | Décisions fermes. |
| § 6, étapes 1, 2, 4, 5, 8, total | Étape 1 = **constater** (pas développer) et inclut la **coupure en parlant** ; étape 2 = **mesure automatique, rien à exécuter** (§ 6bis) ; étape 4 signale que le détecteur et la garde sont **déjà livrés** (les seuils se règlent avec la calibration) ; étape 5 devient **brancher + mesurer** (plus d'installation) ; étape 8 : **pas de réglage de voix**, un seul journal ; total révisé **sans** présenter de mesure. | Aligner les étapes sur l'état réel du projet ; ne plus planifier ce qui est déjà fait, ni demander un relevé manuel. |
| **Nouveau § 6bis** | **L'écho mesuré automatiquement** : calibration courte en début de chaque lecture, exigence tirée du résidu mesuré, **désarmement** de la détection quand l'écho n'est pas maîtrisé. Décrit comme un **acquis**, sans fichier, sans fonction et sans seuil chiffré (document destiné au propriétaire). | Décision n° 1 (haut-parleurs) et décision n° 6 **corrigée** : la mesure est **automatique**, elle n'est pas un travail restant. |
| **Correction du point 6** (même révision) | **L'affirmation corrigée est celle-ci : la mesure d'écho est AUTOMATIQUE, elle n'est pas manuelle.** L'ancien **« protocole de mesure d'écho » manuel** — cinq étapes à exécuter par le propriétaire, lectures à refaire à volume variable, seuil de décision à relever — est **entièrement retiré**. Il est remplacé par la description du dispositif **automatique** existant, dont les trois moments sont présentés en liste et **non** comme des étapes à exécuter. Les renvois fautifs sont corrigés : tableau des décisions (points 1 et 6), § 0, § 4, étape 0, **étape 2** (plus aucune exécution demandée), étape 3, étape 4 (plus rien à compter), total des durées, § 7.1, § 7.2, § 9.1, § 9.2 et § 10 (points 1 et 2). | Le propriétaire a signalé l'**erreur** : la mesure d'écho **avait déjà été faite, automatiquement**. Laisser un protocole manuel aurait fait perdre du temps et laissé croire que le chantier attendait une manipulation. |
| § 7.1 | « À décider : casque ou haut-parleurs » → **décidé** ; ajout de ce qui est déjà écrit (`MIC_CONSTRAINTS`, `echoCancellationOf`) ; renvoi à la **mesure automatique** du § 6bis. | Cohérence ; la parade « casque » reste citée comme dépannage, pas comme plan. |
| § 7.2 | La garde anti-écho est signalée **déjà écrite**, décrite **sans constante interne** ; elle **se règle sur chaque poste** au début de chaque lecture. | Éviter de faire croire que la garde manque, et ne pas exposer des seuils internes dans un document destiné au propriétaire. |
| § 7.7 | La question de vie privée est **précisée** : plus rien ne part chez Microsoft une fois la dictée branchée sur VoiceStudio, mais le micro reste ouvert (arrêt franc conservé). | Ne pas conclure à tort que le sujet disparaît. |
| § 7.8 | Ligne « la dictée actuelle n'est pas locale » → **résolu par le service local**, reste à **brancher**. | Correction d'une fragilité devenue infondée. |
| § 8 | Tableau complété : `attente-parlee.js` *(nouveau)*, `vocal-mic.js` / `character-voices.js` réutilisés, `tts_voicestudio.rs` **à étendre** (transcription), `speech-to-text.js` précisé, `index.html`/`style.css` **sans** nouveau réglage de voix. | Les décisions créent ou déplacent des fichiers : le tableau doit le dire. |
| § 9 | « Ce qui vous reste à trancher » → **« Décisions prises »** (six lignes + deux points fermés), puis **« Ce qui reste réellement ouvert »** (5 points techniques ou d'observation). | Livrable n° 2 : aucun des six points ne doit rester ouvert. |
| § 10 | Points 1, 2 et 4 révisés (mécanisme en place et sans relevé / écho mesuré automatiquement / moteur présent mais **jamais essayé**) ; ajout du point 7 (Laya sur une liste de phrases). | Garder la même honnêteté, avec les faits du 2026-11-02. |

> **Correction du 2026-11-02 (point 6).** Une première version de cette révision
> avait ajouté un **protocole de mesure d'écho manuel** (cinq étapes à exécuter,
> seuils à relever). Il était **faux** et il est **retiré intégralement** : la
> mesure est **automatique** et se refait à chaque lecture (§ 6bis). Aucune autre
> partie de la révision n'a été perdue : les six décisions, la prise en compte de
> VoiceStudio et ce journal restent en place.

**Ce que cette révision n'a pas fait, volontairement :** aucun fichier de `src/` ni
de test modifié · aucune vérification du service VoiceStudio relancée (faits
acquis) · aucun autre document touché (`spec_*`, `help/`, `AGENTS.md`) · aucune
durée présentée comme une mesure · aucune question déjà tranchée remise en débat.

> **Point documentaire laissé ouvert, à la connaissance du propriétaire.** La règle
> 7 d'`AGENTS.md` range les documents de conception dans `docs/conceptions/`, alors
> que celui-ci vit à la racine de `docs/` et qu'`AGENTS.md` y renvoie par ce chemin.
> Le déplacer sans mettre à jour `AGENTS.md` casserait la référence ; ce n'est
> **pas** fait ici (mission : ne pas toucher `AGENTS.md`). À trancher en même temps
> que ce renvoi.

---

*Document de conception. Aucun fichier de code n'a été modifié, aucun logiciel
installé, aucun modèle téléchargé, aucune version changée.*
