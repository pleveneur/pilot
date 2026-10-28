# Pilot — Les trois modes d'écran et l'écran Vocal (spec)

> **Statut : ✅ livré** — lot 1 (`e3f147b`), lot 2 (`944bd0c`), lot 3 (`70fe93e`),
> lot 4a (`174cc45`).
>
> Ce document décrit **ce que Pilot fait réellement**, relu dans le code livré.
> Les raisons de conception (mesures de contraste, choix de placement, découpage
> en lots) restent dans `RAPPORT-trois-modes-ecran-vocal.md`, à la racine.
> La lecture à voix haute et la coupure de la parole sont détaillées dans
> `spec_read_aloud.md` § 1 ; ici, on décrit **l'écran** et ce qu'il promet.

---

## 1. Trois modes, un seul bouton

Un **seul** bouton fait le tour : **Détaillé** → **Assistant seul** → **Vocal** →
**Détaillé**…

| Mode | Ce que l'on voit | À quoi il sert |
|---|---|---|
| **Détaillé** | l'écran habituel : colonne de gauche (280 px), rangée d'onglets, éditeur, chat | travailler sur les fichiers |
| **Assistant seul** | uniquement la conversation de l'assistant 🧭, en plein écran | suivre et piloter les projets sans le bruit de l'éditeur |
| **Vocal** | un objet lumineux, un trait de niveau, **une** ligne de texte, la zone de saisie en bas | parler à Pilot et l'écouter |

Un mode d'écran **ne change rien au projet** : ni fichier, ni onglet, ni agent. Il
choisit seulement **ce qui est affiché**. Dans les deux modes plein écran, la
colonne de gauche et la rangée d'onglets sont **recouvertes** (pas masquées, pas
remplacées) ; les trois boutons de fenêtre restent peints **au-dessus**
(`#window-controls`, `z-index 100001`), donc Pilot reste réductible, agrandissable
et fermable.

## 2. Le bouton, et la mémoire du mode

- **Où il vit** : `#screen-mode-button`, dans la rangée d'onglets (`#tab-row`),
  **entre** l'entrée « Travail » et les trois boutons de fenêtre. Sa place est
  réservée dans le flux : aucun onglet ne passe dessous.
- **Un seul nœud dans tout le document** : en mode « Assistant seul » puis en mode
  « Vocal », le **même** bouton est **déplacé** dans la barre du plein écran, puis
  **restitué exactement** à sa place (parent + voisin suivant) à la sortie. Ce ne
  sont pas des copies : il en existe une seule, et aucun second bouton n'a été
  ajouté ailleurs.
- **Ce qu'il dit** : le **libellé** est le mode **courant** (« Détaillé »,
  « Assistant seul », « Vocal »), l'**infobulle** (`title` **et** `aria-label`)
  annonce le mode **suivant** (« Mode d'écran : Vocal. Passer à « Détaillé ». »),
  et une **pastille** reprend la teinte du mode courant. Un état se lit donc deux
  fois : par le mot, et par la couleur.
- **Mémoire** : **une seule clé** de stockage local, `pilot_screen_mode`, avec trois
  valeurs `detailed` / `assistant` / `vocal`. Elle est écrite à **chaque** bascule.
- **Migration** : l'ancien réglage **binaire** `pilot_superagent_immersive` (présent
  / absent) est repris **une fois** — clé neuve absente **et** ancienne valeur
  `"1"` ⇒ `assistant`. L'ancienne valeur n'est plus **lue** (elle reste écrite par
  le plein écran de l'assistant, ce qui permet un retour arrière sans perte).
- **Au lancement** : le mode est relu **avant** l'affichage, et un mode plein écran
  fait **ouvrir l'onglet 🧭 Assistant** avant d'être rejoué — sans cela le bouton
  annoncerait un écran qui n'existe pas. Fermer puis rouvrir cet onglet restitue le
  mode mémorisé.
- **Entrer et sortir** : le mode « Assistant seul » n'a **qu'une seule entrée** —
  ce bouton, ou le raccourci **Ctrl+Shift+A** (`Cmd+Shift+A` sur macOS, onglet 🧭
  ouvert). Il n'y a **plus** de bouton ⛶ dans la barre d'outils de l'onglet 🧭, et
  la barre du plein écran n'a **plus** de flèche « retour ». On en sort par le
  **même bouton de mode** (il affiche le mode courant et annonce le suivant),
  par **Ctrl+Shift+A**, ou en fermant l'onglet 🧭. **Échap** ne sort **pas** du
  mode « Assistant seul » (elle n'en est jamais sortie ; rien n'a été ajouté) :
  elle ne sert qu'à quitter l'écran **Vocal**, et à fermer une modale ouverte.
- **Aucun écran de réglage** n'a été créé pour cela : le choix du mode est un geste
  d'écran, pas une préférence à configurer.

## 3. L'écran Vocal, de haut en bas

Plein écran `.pilot-vocal` (`position: fixed; inset: 0; z-index: 99990`), de la
même famille que celui de l'assistant seul, avec un **fondu de 0,3 s** à l'entrée
et à la sortie (pas de zoom : on change d'écran, on ne déplie pas un panneau).
Aucun cadre, aucune carte, aucune bordure.

1. **Barre de 44 px**, juste **sous** la bande des trois boutons de fenêtre
   (`margin-top: var(--window-controls-height)`) : elle ne porte que le bouton des
   trois modes, à gauche. Rien au centre, rien à droite.
2. **Au centre**, un bloc vertical : un **disque de 168 px** (anneau plein de 2 px
   + remplissage lumineux de 18 % au centre, 0 % aux bords : aucune image), puis
   **24 px** plus bas un **trait de niveau de 200 × 3 px**, puis **24 px** plus bas
   **l'unique ligne d'état**. Le bloc suit la fenêtre sans calcul.
3. **La zone de saisie**, en bas, **toujours visible** et discrète : c'est la barre
   de saisie de l'onglet Assistant, **déplacée** (même nœud, même envoi, même
   dictée 🎙️), 720 px au plus, centrée, 16 px de marge basse, sans filet ni fond
   pleine largeur, plafonnée à **120 px** de haut (au lieu de 200 px dans l'onglet).
   Son texte d'invite y devient **« Écrivez, ou parlez. »** et il est restitué tel
   quel à la sortie.
4. **Un bouton de dépannage, caché par défaut** : « Autoriser le micro »
   (`.vocal-mic-fix`), qui n'apparaît que si le micro est fermé.

**Rien de la conversation n'est affiché** sur cet écran : ni les messages, ni les
outils, ni l'état des agents. C'est le principe même du mode.

## 4. Les quatre états visuels

**Une seule** classe d'état à la fois sur l'overlay : deux états simultanés sont
impossibles par construction. Priorité : **parole** > **réflexion** > **écoute** >
**repos**.

| État | Quand | Teinte (jeton `--vocal-*`) | Mouvement | Ligne d'état |
|---|---|---|---|---|
| **Repos** | personne ne parle, l'agent ne réfléchit pas, rien n'est lu | accent du thème (`--vocal-rest`) | respiration lente de 4 s | « Je vous écoute. » |
| **Écoute** | le micro **capte vraiment** | vert (`--vocal-listen`) | aucun mouvement propre : **le trait suit la voix** | « Je vous écoute… » |
| **Réflexion** | l'agent réfléchit | violet de l'assistant (`--vocal-think`) | arc de 60° qui tourne en 3 s | « Je réfléchis… » |
| **Parole** | Pilot lit la réponse | ambre (`--vocal-speak`) | halo de 1,6 s + enveloppe du trait | « Je réponds. » |

- **Le texte ne porte jamais la couleur** de l'état (toujours `--text-primary`) :
  la couleur vit dans l'objet. C'est ce qui rend l'écran lisible dans les dix
  palettes du projet.
- **En « écoute », aucun niveau n'est inventé** : la longueur du trait vient du
  niveau **réellement mesuré**. Sans mesure (micro fermé, refusé, en panne), le
  trait retombe au silence (8 %), il ne simule rien.
- **En « parole », le trait ne mesure rien** : la voix de la synthèse n'est pas
  capturable par le navigateur, il suit donc une **enveloppe fixe** de 1,6 s,
  volontairement lente et bornée (jamais synchrone avec les mots). Seule
  l'écoute mesure votre voix.
- **Mouvement réduit** : le même drapeau que les animations d'ouverture
  (`prefers-reduced-motion` **et** le réglage « Animer l'ouverture des modales »).
  Quand il est actif, plus aucune animation, plus aucune transition, et le trait est
  **figé** à 8 / 45 / 20 / 70 % selon l'état. **Aucun nouveau réglage** n'a été créé
  pour cet écran.

## 5. Le micro : quand il s'ouvre, quand il se ferme

- **Rien n'est ouvert à l'entrée du mode.** La permission est demandée au **premier
  geste** dans l'écran (un clic, une touche) — jamais à l'ouverture du mode, jamais
  dans les autres modes.
- **Un refus n'est jamais redemandé tout seul** : l'écran le **dit en une phrase**
  et propose « Autoriser le micro ». Le mode reste **entièrement utilisable**
  (écrire, envoyer, écouter). Les messages sont : « Le micro est fermé. » ·
  « Aucun micro n'est branché. » · « Le micro est occupé par une autre
  application. » · « Le micro n'a pas répondu. »
- **À la sortie du mode, le micro est réellement rendu** : les pistes sont
  arrêtées (`stop()`), le contexte audio est fermé, la boucle de mesure est
  annulée. Le témoin du système s'éteint : Pilot ne vous écoute pas en dehors de
  cet écran. Un retour dans le mode redemande la capture (une demande par entrée,
  jamais en boucle).
- **Le niveau affiché** est le volume mesuré, **lissé** (montée rapide, retombée
  lente) et projeté sur la longueur du trait (8 % au silence, 100 % au fort). Le
  trait ne saute donc pas d'une image à l'autre.

## 6. Parler par-dessus Pilot : comment cela marche

Pendant que Pilot lit une réponse **en mode Vocal**, prendre la parole
l'**arrête**. Le mécanisme est borné, et il est volontairement prudent.

- **Un seul signal « Pilot parle »** : l'état de la lecture à voix haute
  (`pilot-read-aloud-state`, émis par `read-aloud.js`). L'écran ne devine jamais la
  parole et ne crée **aucun second lecteur**.
- **À chaque début de lecture**, une **mesure de 600 ms** (calibrage) : Pilot ne
  coupe pas, il écoute **son propre son** sortir des haut-parleurs et retient le
  niveau maximal observé (le **résidu d'écho**).
- **Le seuil** vaut ensuite `max(0,05 ; résidu × 1,8)` : il est toujours posé
  **au-dessus** de ce que Pilot s'entend faire. Le résidu ne remonte que sur les
  moments **calmes** — une voix ne peut pas devenir elle-même la référence qui
  l'empêcherait de couper.
- **Il faut une voix continue** au-dessus du seuil pendant **200 ms** : des
  claquements, une toux brève ou un bruit de chaise ne suffisent pas.
- **Une seule coupure par lecture.** Aucune reprise automatique n'est programmée.
- **Ce que fait la coupure** : `stopReading()` — la **seule** voie d'arrêt de
  lecture du projet, donc l'arrêt tombe **entre deux phrases**, jamais au milieu
  d'un mot ; l'objet repasse en « écoute » ; le curseur revient dans la zone de
  saisie. **Aucun agent n'est arrêté** : la voix coupe l'écoute, pas le travail.
- **Hors mode Vocal, rien ne change** : les autres écrans lisent jusqu'au bout, et
  le micro n'y est pas ouvert.

## 7. Pourquoi cela peut légitimement ne pas se déclencher

**Ce sont des protections, pas des pannes.** Le choix est explicite : *un silence
vaut mieux qu'une réponse qui bégaie ou qui se coupe toute seule.* Les quatre cas
ci-dessous sont **voulus** et se produisent sans que rien ne soit cassé.

| Ce que vous vivez | Pourquoi (c'est voulu) | Quoi faire |
|---|---|---|
| **Rien ne se coupe quand vous parlez** | La machine ne **prouve** pas qu'elle annule l'écho : le navigateur ne répond pas « oui » (champ absent) ou répond « non » à l'annulation d'écho. Sans cette preuve, la détection reste **désarmée** et Pilot lit jusqu'au bout. | Casque (l'écho disparaît), ou accepter la lecture complète. Le motif est lisible sans coupure : `bargeInReport()` (`echoCancellation`, `residu`, `seuil`, `arme`, `calibre`, `motif`). |
| **Rien ne se coupe si vous parlez tout de suite** | Les **600 premières millisecondes** d'une lecture servent à mesurer le son de Pilot lui-même : couper pendant cette mesure reviendrait à juger avec un seuil qui n'existe pas encore. | Parler après le tout début d'une phrase. |
| **Rien ne se coupe avec des haut-parleurs forts** | Le **résidu d'écho mesuré** dépasse la limite (0,03 quand l'annulation d'écho est prouvée, 0,01 quand le navigateur ne dit rien) : la détection se désarme d'elle-même. | Baisser le volume, rapprocher le micro, ou mettre un casque — puis relire la mesure. |
| **Il faut vraiment insister** | Une voix **brève ou hachée** (moins de 200 ms continues au-dessus du seuil) n'est pas une prise de parole : c'est un bruit. | Parler d'une traite, une phrase entière. |

Conséquence assumée : sur un poste où le navigateur ne rapporte pas l'annulation
d'écho, **la coupure ne marchera pas** — et Pilot **lit jusqu'au bout**, exactement
comme avant le lot 4a. Aucun réglage n'a été ajouté pour forcer la détection : ce
serait le moyen le plus sûr de faire bégayer Pilot.

## 8. Sortir du mode Vocal — trois voies, aucune surprise

| Voie | Effet |
|---|---|
| **Le même bouton de mode** (il affiche « Vocal » ; un clic passe à « Détaillé ») | retour à l'écran normal |
| **Échap** | idem — sauf si une modale est ouverte : la touche lui appartient alors, on ne quitte pas le mode sous elle |
| **Fermer l'onglet 🧭 Assistant** | idem (la lecture est arrêtée et le mode quitté) |

`Ctrl+Shift+A` (le raccourci du plein écran de l'assistant) **sort** aussi du mode
Vocal au lieu d'empiler un second plein écran.

**Jamais deux pleins écrans superposés** : entrer en Vocal sort d'abord de
« Assistant seul », et entrer en « Assistant seul » sort d'abord du Vocal — la
garde est posée aux deux endroits qui créent un overlay. **Symétrie exacte** : tout
nœud déplacé à l'entrée (le bouton des modes, la barre de saisie) est restitué à sa
place et dans le bon ordre, avec son texte d'invite et sa hauteur d'origine.

## 9. Ce qui n'est pas fait (et n'est pas simulé)

- **La conversation continue** : après une réponse, Pilot **ne reprend pas**
  l'écoute tout seul (c'est la suite du lot 4, non commencée).
- **La réorientation de l'agent** quand on le coupe : la coupure arrête la
  **lecture**, elle ne relance pas l'agent avec ce qui vient d'être dit.
- **La dictée vocale** reste celle du navigateur (le son peut sortir du poste) :
  rien de local n'a été ajouté ici.
- **Deux éléments du rapport de conception ne sont pas livrés** : le bouton
  « Reprendre ici » (devenu inutile — la coupure rend déjà la main au clavier) et la
  ligne d'état « Je finis ce que je fais, puis je vous réponds. ».

## 10. Où c'est dans le code, et ce que les tests tiennent

| Fichier | Rôle |
|---|---|
| `src/js/screen-mode.js` | **source unique** des trois modes : cycle, libellé, infobulle, clé `pilot_screen_mode`, migration, `screenModeScreen()` (mode → écran) |
| `src/js/super-agent.js` | `enterVocal` / `exitVocal`, `applyVocalState`, `vocalBargeIn`, `autoReadVocalReply`, `vocalScreenState` / `vocalStateClass` / `vocalStatusText` / `vocalReducedMotion` (pures) |
| `src/js/vocal-mic.js` | **seul** endroit où le micro est ouvert : capture, niveau lissé, arrêt réel, messages de panne, garde anti-auto-coupure (`stepSpeechGate`, `bargeInArmed`) |
| `src/js/main.js` | câblage du bouton, ouverture de l'onglet 🧭 quand un mode plein écran est mémorisé |
| `index.html` · `src/css/style.css` | le bouton unique (`.screen-mode-*`), l'écran `.pilot-vocal` et ses jetons `--vocal-*` |

Verrous : `trois-modes-ecran.test.js` (lot 1), `ecran-vocal-lot2.test.js` (écran,
états, trois sorties, symétrie), `ecran-vocal-lot3.test.js` (micro, arrêt réel,
messages), `ecran-vocal-lot4a.test.js` (garde anti-auto-coupure, chiffres).

## 11. Ce qui est prouvé, et ce qui dépend de votre matériel

**Prouvé par les tests** : le cycle des trois modes, la clé unique et la migration,
le libellé et l'infobulle, la structure de l'écran, une seule classe d'état, la
priorité parole > réflexion > écoute, les trois sorties, la restitution des nœuds,
l'arrêt réel du micro, et — sur images audio simulées — **zéro auto-coupure** sur
30 s d'écho résiduel puis **une** coupure quand une voix continue dépasse le seuil.

**Non prouvable par un test, à vérifier chez vous** : le niveau d'écho **réel** de
votre pièce (haut-parleurs, volume, distance, pilote audio). Pilot ne le suppose
jamais : quand il ne peut pas prouver que l'écho est maîtrisé, **il ne coupe pas**.
