// vocal-sides.js — LOT 1 de l'ecran Vocal : la LARGEUR des deux colonnes
// laterales, en une seule formule PURE ; LOT 2 : le contenu de la colonne de
// droite ; la ZONE D'IMAGE (§ 7bis) et la POSE de la fenetre du visage.
//
// PRESENTATION (correction du 2026-10-31, sur decision du proprietaire) : la
// ZONE D'IMAGE est EN HAUT A DROITE de l'ecran et la LISTE DES TACHES vient
// DESSOUS. Le DISQUE, lui, reste INTACT : rien dedans, ni portrait ni nom. La
// zone d'image a donc TROIS cas (le personnage, sinon la fenetre du visage,
// sinon rien) et la ligne d'activite du bas de la colonne n'existe plus. La
// colonne des taches s'arrete AVANT la couronne du disque : sa largeur est
// rendue separement (`taskTrack`).
//
// Source : docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md
// (§ 2.4 pour les noms, § 3.1 pour la formule, § 3.2 pour le tableau que le
// test T10 rejoue ligne par ligne).
//
// Aucun DOM, aucun import Tauri, aucune ecriture : ce module ne fait que
// calculer. Le seul ecrivain de la valeur `track` est `vocalSyncSides()`
// (super-agent.js), qui la pose en `--vocal-side` sur l'overlay.
//
// LES NOMBRES, ET D'OU ILS VIENNENT (aucune valeur inventee) :
//   320 px   largeur d'une colonne sous 1600 px de fenetre — 42 caracteres a
//            13 px, une ligne de texte lisible et pas un mot par ligne ;
//   400 px   plafond, atteint a 1920 px (0,25 px de plus par pixel de fenetre
//            au-dela de 1600) — 52 caracteres ;
//   240 px   seuil de presence : en dessous, une tache ne tient plus sur une
//            ligne (son identite a 11 px et son resume a 13 px). Le seuil vient
//            du § 3.1 et n'a pas bouge ;
//   24 px    jour de chaque cote du disque (le `column-gap` de la grille) ;
//   16 px    marge de chaque cote de l'ecran (le `padding` de la scene) ;
//   289 px   ce que le reste de l'ecran prend en hauteur (36 onglets + 44 barre
//            + 80 ligne d'etat + 60 saisie + 69 respirations) — le meme nombre
//            que `--vocal-orb-size` dans la feuille de style ;
//   88 px    la couronne du halo autour du disque (jeton `--vocal-crown` de la
//            feuille de style) : c'est devant ELLE que la colonne des taches
//            doit s'arreter.
// Les deux derniers existent DEJA : ce module les lit, il ne les invente pas.

/** Largeur minimale d'une colonne pour qu'elle apparaisse (seuil de decision 7). */
export const VOCAL_SIDE_MIN_PX = 240;
/** Largeur nominale d'une colonne tant que la fenetre fait 1600 px ou moins. */
export const VOCAL_SIDE_MAX_PX = 320;
/** Plafond de largeur, atteint a 1920 px de fenetre. */
export const VOCAL_SIDE_WIDE_MAX_PX = 400;
/** Largeur de fenetre a partir de laquelle les colonnes commencent a s'elargir. */
export const VOCAL_SIDE_WIDE_AT_PX = 1600;
/** Jour de chaque cote du disque, en px (`column-gap` de la scene). */
export const VOCAL_SIDE_GAP_PX = 24;
/** Marge de chaque cote de l'ecran, en px (`padding` de la scene). */
export const VOCAL_SIDE_PAD_PX = 16;
/**
 * Ce que le CADRE d'une colonne prend sur sa largeur, en px :
 * `2 x (1 de bordure + 10 de marge interieure) = 22`. La feuille de style ecrit
 * les trois valeurs (`border: 1px solid var(--glass-frame)` et
 * `padding-inline: 10px` sur `.vocal-side-discussion` et `.vocal-side-tasks`,
 * en `box-sizing: border-box`) ; ce chiffre en est la somme, et
 * `vocalCharsPerLine()` le retranche AVANT de compter les caracteres, sinon la
 * mesure annoncerait plus de place qu'il n'en reste et un message serait coupe
 * sans le dire. La hauteur, elle, n'en perd rien : aucun `padding-block` n'est
 * ajoute, donc les budgets de lignes et de taches restent exacts.
 * Verrou : src/js/cadre-listes-panneaux.test.js.
 */
export const VOCAL_SIDE_FRAME_PX = 2 * (1 + 10);
/** Hauteur d'une tache dans la liste, en px (lot 2). */
export const VOCAL_TASK_PX = 46;
/** Hauteur d'un en-tete de groupe de la liste, en px (lot 2). */
export const VOCAL_TASK_HEADER_PX = 20;
/**
 * Couronne du halo autour du disque, en px : le jeton `--vocal-crown` de la
 * feuille de style (`inset: calc(var(--vocal-crown) * -1)` sur `.vocal-orb::before`).
 * C'est une LONGUEUR, pas une fraction : le halo deborde de 88 px, quel que
 * soit le disque.
 */
export const VOCAL_CROWN_PX = 88;
/**
 * De combien le CONTENU d'une colonne se decale vers l'exterieur, en px : la
 * couronne (88) moins le jour deja compte par la grille (24). Les DEUX colonnes
 * s'arretent ainsi EXACTEMENT au bord de la couronne : aucune ne passe sous la
 * lueur, quel que soit le texte qu'elle porte (remarque du proprietaire du
 * 2026-10-03 : la colonne de gauche mordait de 64 px dans le halo, faute de
 * porter cette largeur).
 */
export const VOCAL_SIDE_CLEARANCE_PX = VOCAL_CROWN_PX - VOCAL_SIDE_GAP_PX;
/**
 * Total fixe du haut de la colonne HORS zone d'image : le titre
 * (14 + 11 + 14 = 39 px) et l'air du bas (12 px) = 51 px. Ce qui reste a la
 * suite est la place de la zone d'image, puis celle de la liste.
 */
export const VOCAL_SIDE_FIXED_PX = 39 + 12;

// ── LA ZONE D'IMAGE, A TROIS CAS ──
// Source : CONCEPTION-ecran-vocal-portrait-et-colonnes.md, § 7bis (la zone
// d'image) et correction du 2026-10-31 : la zone est EN HAUT A DROITE, la
// liste des taches DESSOUS, et le DISQUE ne porte RIEN (ni image, ni nom).
//
//   1. le PERSONNAGE (un portrait affichable existe) : medaillon 96 px, son
//      nom dessous (8 + 20 px) et l'air qui le detache de la suite
//      (12 px)                                            -> 136 px
//   2. sinon l'AVATAR DU VISAGE (PLface), s'il tourne et si sa TAILLE est
//      connue et s'il reste au moins une tache            -> 180 px
//   3. sinon rien du tout : AUCUNE place reservee          -> 0 px

/**
 * Hauteur du medaillon du personnage, en px. 96 px (remarque du proprietaire du
 * 2026-10-03 : « le portrait est trop petit ») — un medaillon plus large que
 * deux lignes de liste, il ne se lit donc plus comme un element de la liste.
 */
export const VOCAL_PORTRAIT_PX = 96;
/** Ecart entre le medaillon et son nom, en px. */
export const VOCAL_PORTRAIT_GAP_PX = 8;
/** Hauteur de la ligne du nom, en px (la meme que la pastille du bouton). */
export const VOCAL_PORTRAIT_NAME_PX = 20;
/**
 * L'AIR sous le nom, en px : c'est lui qui DETACHE le personnage de ce qui suit
 * (le titre « TACHES » et sa liste), et non un filet ou un cadre — l'ecran n'en
 * porte aucun (remarque du proprietaire du 2026-10-03).
 */
export const VOCAL_PORTRAIT_AIR_PX = 12;
/**
 * Le bloc du personnage quand il est la : le medaillon (96), son ecart (8), son
 * nom (20) et l'air qui le detache (12) = 136 px. Sans personnage, ces 136 px
 * reviennent a la liste.
 */
export const VOCAL_PORTRAIT_BLOCK_PX =
  VOCAL_PORTRAIT_PX +
  VOCAL_PORTRAIT_GAP_PX +
  VOCAL_PORTRAIT_NAME_PX +
  VOCAL_PORTRAIT_AIR_PX;
/** Largeur du plancher de la fenetre du visage (PLface), en px (§ 7bis.7). */
export const VOCAL_AVATAR_W_PX = 160;
/** Hauteur du plancher de la fenetre du visage (PLface), en px (§ 7bis.7). */
export const VOCAL_AVATAR_H_PX = 180;
/** Le cas 1 : le personnage occupe la zone (medaillon + son nom). */
export const VOCAL_IMAGE_PORTRAIT = "portrait";
/** Le cas 2 : la fenetre du visage occupe la zone, seule. */
export const VOCAL_IMAGE_AVATAR = "avatar";
/** La zone n'existe pas (aucune image, aucun cadre, aucune place). */
export const VOCAL_IMAGE_NONE = "none";
/** Rapport boite / disque : 336 + 2 x 88 = 512 px de boite pour 336 de disque. */
export const VOCAL_ORB_BOX_RATIO = 1 + (2 * VOCAL_CROWN_PX) / 336;

// ── LOT 2 : LE CONTENU DE LA COLONNE DE DROITE ──
// Source : CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md, § 2.2
// (ce qui entre dans la liste) et § 2.3 (le nombre de lignes). Aucune valeur
// choisie ici : toutes viennent de la conception.

/**
 * Nombre maximal de taches affichees : 8, ce que la place permet a la hauteur
 * maximale (`floor((440 - 2 x 20) / 46) = 8`). Plafond UNIQUE : le budget de
 * hauteur, lui, tient deja compte de la zone d'image (personnage ou visage),
 * donc la colonne n'a pas deux plafonds a connaitre.
 */
export const VOCAL_TASKS_MAX = 8;
/**
 * Sous cette hauteur de liste, les en-tetes de groupe ne tiennent plus : deux
 * en-tetes (2 x 20) et une tache (46) font 86 px. En dessous, la colonne affiche
 * les taches sans leurs titres plutot que de n'afficher qu'un titre.
 */
export const VOCAL_TASKS_MIN_HEADERS_PX =
  2 * VOCAL_TASK_HEADER_PX + VOCAL_TASK_PX;
/**
 * Rythme du tic qui recopie l'etat des missions dans la colonne. Le meme ordre
 * de grandeur que la sonde d'activite (2 s) mais plus court : une tache qui
 * demarre doit apparaitre dans la seconde, sans relire le moteur (la sonde
 * tourne deja, ce tic ne fait que repeindre).
 */
export const VOCAL_SIDES_TICK_MS = 900;
/** Le titre de la colonne, en haut (texte de la maquette du document). */
export const VOCAL_TASKS_TITLE = "T\u00c2CHES";
/** Colonne sans aucune mission : une phrase, jamais une liste vide trompeuse. */
export const VOCAL_TASKS_EMPTY_TEXT = "Aucune t\u00e2che en cours";
/** Libelles des deux groupes, ceux du panneau des missions (aucun nouveau mot). */
export const VOCAL_TASKS_GROUP_RUNNING = "En cours";
export const VOCAL_TASKS_GROUP_WAITING = "En attente";
/** Placement vertical du disque dans la scene (hors flux : couronnes comprises). */
export const VOCAL_ORB_RESERVED_PX = 289;

// ── LOT 3 : LE CONTENU DE LA COLONNE DE GAUCHE ──
// Source : CONCEPTION-ecran-vocal-portrait-et-colonnes.md, § 1.3 (ce que la
// colonne montre), § 4.2 (les deux mesures de texte) et § 4.3 (les noms).
// Meme regle que le lot 2 : aucune valeur choisie ici, toutes viennent du
// document de conception cite ci-dessus (§ 1.3, § 4.2, § 4.3).

/**
 * Ce que la colonne LIT du DOM : trois echanges au plus. Le plafond borne la
 * lecture, pas l'affichage (§ 4.2).
 */
export const VOCAL_DISCUSSION_MAX_MESSAGES = 6;
/** Hauteur d'une ligne d'apercu, en px (§ 4.2 : 23 px, soit 8 x 23 = 184 px). */
export const VOCAL_DISCUSSION_LINE_H = 23;
/** Ecart entre deux messages, en px (§ 4.2 : le meme 14 px que le budget). */
export const VOCAL_DISCUSSION_GAP = 14;
/**
 * Le haut de la colonne, en px, retire du budget d'unites : c'est le `14` de la
 * formule du § 4.2, `lignes = floor((H - 14) / 37)`.
 */
export const VOCAL_DISCUSSION_HEAD_PX = 14;
/** Une question tient sur DEUX lignes au plus (decision 3). */
export const VOCAL_DISCUSSION_QUESTION_LINES = 2;
/** Une reponse sur HUIT lignes au plus (decision 3). */
export const VOCAL_DISCUSSION_ANSWER_LINES = 8;
/**
 * Largeur moyenne d'un caractere, en px : c'est le `7,6` du § 4.2, qui donne 42
 * caracteres a 320 px et 52 a 400 px.
 */
export const VOCAL_DISCUSSION_CHAR_PX = 7.6;
/**
 * La place, en px, que prend la ligne « ... et N echange(s) plus haut » : sa
 * hauteur (15 px) et son ecart au premier message (14 px). Reservee d'avance,
 * elle ne peut donc pas pousser un message hors de la colonne.
 */
export const VOCAL_DISCUSSION_MORE_PX = 15 + VOCAL_DISCUSSION_GAP;
/** Le titre de la colonne, en haut (meme reglage que « TACHES »). */
export const VOCAL_DISCUSSION_TITLE = "DISCUSSION";

/**
 * La largeur des deux colonnes, et la hauteur dont elles disposent.
 *
 * @param {object} entrees
 * @param {number} entrees.width    largeur de la fenetre, en px
 * @param {number} entrees.height   hauteur de la fenetre, en px
 * @param {number} entrees.orbSize  diametre du disque, en px (`--vocal-orb-size`)
 * @param {boolean} [entrees.hasPortrait] un portrait de personnage affichable
 *   existe-t-il (voir `planVocalImageZone`)
 * @param {boolean} [entrees.hasAvatar] une fenetre de visage (PLface) de taille
 *   connue est-elle disponible (voir `planVocalImageZone`)
 * @returns {{track:number, taskTrack:number, shown:boolean, columnHeight:number,
 *   listHeight:number, hasPortrait:boolean, hasAvatar:boolean, imageZone:object}}
 *   `track` = largeur d'UNE colonne (0 = colonnes absentes), `taskTrack` =
 *   largeur de la COLONNE DES TACHES : elle s'arrete avant la couronne du
 *   disque, donc elle ne peut jamais passer sous le cercle, `shown` = les
 *   colonnes sont-elles affichees, `columnHeight` = hauteur de la colonne
 *   (`H`), `listHeight` = place laissee a la LISTE sous son haut fixe, sous le
 *   bloc du personnage et sous la zone d'image, `hasPortrait` = le cas 1
 *   (personnage) s'applique, `hasAvatar` = l'avatar du visage s'affiche
 *   REELLEMENT (il peut etre refuse faute de place), `imageZone` = la zone
 *   d'image decidee (voir `planVocalImageZone`) — la repeinture n'a donc pas a
 *   relire le personnage.
 */
export function planVocalSides({ width, height, orbSize, hasPortrait, hasAvatar } = {}) {
  const largeur = Number(width);
  const hauteur = Number(height);
  const disque = Number(orbSize);
  const w = Number.isFinite(largeur) ? largeur : 0;
  const h = Number.isFinite(hauteur) ? hauteur : 0;
  const orb = Number.isFinite(disque) && disque > 0 ? disque : 0;

  // Ce qui reste pour les deux colonnes : la fenetre, moins le disque, moins
  // le jour de chaque cote du disque, moins la marge de chaque cote de l'ecran.
  const avail = Math.floor((w - orb - 2 * VOCAL_SIDE_GAP_PX - 2 * VOCAL_SIDE_PAD_PX) / 2);
  // Largeur nominale : 320 px jusqu'a 1600, puis 0,25 px par pixel de fenetre
  // (la moitie de la largeur ajoutee va aux colonnes, l'autre moitie aux jours
  // et aux marges — c'est ce qui laisse le disque EXACTEMENT au centre).
  const nominal =
    w <= VOCAL_SIDE_WIDE_AT_PX
      ? VOCAL_SIDE_MAX_PX
      : Math.min(
          VOCAL_SIDE_WIDE_MAX_PX,
          VOCAL_SIDE_MAX_PX + Math.round((w - VOCAL_SIDE_WIDE_AT_PX) / 4),
        );
  // Sous 240 px une colonne ne tient pas une tache : elle n'existe pas du tout.
  const track = avail < VOCAL_SIDE_MIN_PX ? 0 : Math.min(nominal, avail);

  // La COLONNE DES TACHES s'arrete au bord de la couronne du disque : sa
  // largeur est celle de la colonne, MOINS la couronne (88 px) et PLUS le jour
  // de 24 px que la grille compte deja. C'est une SOUSTRACTION de largeur, pas
  // un `margin` ni un decalage : un titre long est donc coupe par la boite
  // elle-meme, il ne peut pas deborder sur le cercle.
  const taskTrack = track > 0 ? Math.max(0, track - VOCAL_SIDE_CLEARANCE_PX) : 0;

  // La hauteur des colonnes : la boite du disque, plafonnee par la place que la
  // fenetre offre reellement (jamais 512 px ecrases sur la ligne d'etat). Elle
  // ne depend NI de la largeur des colonnes NI du nombre de taches.
  const place = h - VOCAL_ORB_RESERVED_PX;
  const columnHeight = Math.max(0, Math.round(Math.min(orb * VOCAL_ORB_BOX_RATIO, place)));

  // La zone d'image, dans l'ordre : le personnage, sinon la fenetre du visage,
  // sinon rien. Une zone qui ne laisserait pas au moins UNE tache a la liste
  // n'est pas dessinee : c'est le seul refus possible de l'avatar (« une zone
  // qui ne dessine rien ne fait jamais un trou »).
  const imageZone = planVocalImageZone({ hasPortrait, hasAvatar, columnHeight });

  // Haut fixe de la colonne : le titre et l'air du bas (51 px), PLUS le bloc du
  // personnage quand il s'affiche (136 px), PLUS la place de la fenetre du
  // visage quand c'est elle qui occupe la zone (180 px). Le reste va a la liste.
  const fixe =
    VOCAL_SIDE_FIXED_PX +
    (imageZone.portrait ? VOCAL_PORTRAIT_BLOCK_PX : 0) +
    imageZone.height;
  const listHeight = Math.max(0, columnHeight - fixe);

  return {
    track,
    taskTrack,
    shown: track > 0,
    columnHeight,
    listHeight,
    hasPortrait: imageZone.portrait,
    hasAvatar: imageZone.avatar,
    imageZone,
  };
}

/**
 * LA ZONE D'IMAGE, A TROIS CAS (CONCEPTION-ecran-vocal-portrait-et-colonnes.md,
 * § 7bis.2 ; correction du 2026-10-31 : elle est EN HAUT A DROITE, la liste des
 * taches DESSOUS, le disque reste INTACT) — decision PURE, dans cet ordre :
 *
 *   1. le PERSONNAGE occupe la zone si et seulement si un portrait affichable
 *      existe (`hasPortrait`) : rien d'autre n'est lu, aucun reglage, aucun
 *      etat memorise. Il n'y a alors PAS de fenetre du visage : le personnage
 *      l'emporte, un seul cas a la fois ;
 *   2. SINON l'AVATAR DU VISAGE, s'il tourne ET si sa taille est connue
 *      (`hasAvatar`), et seulement s'il reste au moins UNE ligne de liste
 *      apres lui — sinon il n'est pas pose du tout et la liste garde la place ;
 *   3. SINON rien : la zone n'existe pas, la liste prend toute la hauteur.
 *
 * La HAUTEUR RENDUE ne compte que l'ESPACE VIDE que Pilot reserve a la fenetre
 * du visage : 0 px au cas 1 et au cas 3, 180 px au cas 2 (le medaillon du
 * personnage et son nom sont de VRAIS noeuds, ils prennent leur place eux-memes:
 * leurs 98 px sont comptes par `planVocalSides`, jamais deux fois).
 *
 * Les totaux du § 7bis.4 deviennent donc, avec H la hauteur de la colonne :
 *   cas 3 : liste = H - 51     cas 1 : liste = H - 187
 *   cas 2 : liste = H - 231
 *
 * @param {object} entrees
 * @param {boolean} [entrees.hasPortrait] un portrait affichable existe-t-il
 * @param {boolean} [entrees.hasAvatar] une fenetre de visage de taille connue
 *   est-elle disponible
 * @param {number} [entrees.columnHeight] hauteur de la colonne, en px (`H`)
 * @returns {{kind:string, height:number, avatar:boolean, portrait:boolean}}
 *   `kind` vaut "portrait", "avatar" ou "none" ; `height` est la place VIDE
 *   reservee a la fenetre du visage ; `avatar` et `portrait` disent lequel des
 *   deux blocs s'affiche.
 */
export function planVocalImageZone({ hasPortrait, hasAvatar, columnHeight } = {}) {
  const portrait = hasPortrait === true;
  const hauteur = Number(columnHeight);
  const H = Number.isFinite(hauteur) && hauteur > 0 ? hauteur : 0;
  // Le personnage d'abord : il occupe la zone seul, sans fenetre du visage.
  if (portrait) {
    return { kind: VOCAL_IMAGE_PORTRAIT, height: 0, avatar: false, portrait: true };
  }
  // Sinon la fenetre du visage, qui n'est posee que s'il reste UNE ligne de
  // liste apres elle : une zone qui ne dessine rien ne fait jamais un trou,
  // mais elle ne mange pas non plus la derniere tache.
  const avatar = hasAvatar === true && H - VOCAL_SIDE_FIXED_PX - VOCAL_AVATAR_H_PX >= VOCAL_TASK_PX;
  const height = avatar ? VOCAL_AVATAR_H_PX : 0;
  const kind = avatar ? VOCAL_IMAGE_AVATAR : VOCAL_IMAGE_NONE;
  return { kind, height, avatar, portrait: false };
}

/**
 * LA POSE DE LA FENETRE DU VISAGE, decidee en PIXELS PHYSIQUES (§ 7bis.5).
 *
 * Pilot raisonne en pixels CSS ; la fenetre du visage se deplace en pixels
 * PHYSIQUES depuis le coin superieur gauche de l'ECRAN. La conversion est donc
 * `position de la fenetre + coordonnee CSS x facteur d'echelle`, ARRONDIE : le
 * visage n'accepte que des entiers.
 *
 * Trois refus, et aucun n'invente une valeur :
 *   - la TAILLE du visage n'est pas confirmee (`avatar.width` / `height`) :
 *     sans elle on ne sait pas ou poser la fenetre, donc AUCUNE pose n'est
 *     demandee (cas 2 muet, § 7bis.6) ;
 *   - le rectangle de la zone est illisible ;
 *   - la zone d'image n'est pas celle de l'avatar (cas 1 ou cas 3).
 *
 * L'avatar est CENTRE dans la colonne, comme le medaillon du personnage :
 * jamais colle a gauche, jamais plus large que la colonne.
 *
 * Limite connue et assumee (§ 7bis.6) : un autre ecran avec un autre facteur
 * d'echelle donne une place fausse, corrigee au geste suivant, SANS message.
 *
 * @param {object} entrees
 * @param {{left:number, top:number, width:number}} [entrees.rect] rectangle de
 *   la zone d'image en pixels CSS (mesure du noeud, jamais un calcul theorique)
 * @param {{x:number, y:number, scaleFactor:number}} [entrees.windowOrigin]
 *   position PHYSIQUE de la fenetre Pilot et son facteur d'echelle
 * @param {{width:number, height:number}} [entrees.avatar] taille CONFIRMEE de
 *   la fenetre du visage, en pixels physiques
 * @returns {{x:number, y:number, width:number, height:number}|null} la pose a
 *   demander, ou null quand rien ne doit etre demande.
 */
export function planVocalAvatarPose({ rect, windowOrigin, avatar } = {}) {
  const largeur = Number(avatar && avatar.width);
  const hauteur = Number(avatar && avatar.height);
  if (!Number.isFinite(largeur) || !Number.isFinite(hauteur) || largeur <= 0 || hauteur <= 0) {
    return null;
  }
  const gauche = Number(rect && rect.left);
  const haut = Number(rect && rect.top);
  if (!Number.isFinite(gauche) || !Number.isFinite(haut)) return null;
  const largeurZone = Number(rect && rect.width);
  const colonne = Number.isFinite(largeurZone) && largeurZone > 0 ? largeurZone : largeur;
  const centrage = Math.max(0, (colonne - largeur) / 2);
  const origineX = Number(windowOrigin && windowOrigin.x);
  const origineY = Number(windowOrigin && windowOrigin.y);
  const facteur = Number(windowOrigin && windowOrigin.scaleFactor);
  const echelle = Number.isFinite(facteur) && facteur > 0 ? facteur : 1;
  const x0 = Number.isFinite(origineX) ? origineX : 0;
  const y0 = Number.isFinite(origineY) ? origineY : 0;
  return {
    x: Math.round(x0 + (gauche + centrage) * echelle),
    y: Math.round(y0 + haut * echelle),
    width: Math.round(largeur),
    height: Math.round(hauteur),
  };
}

/**
 * L'empreinte d'une pose : deux poses identiques ont la meme cle. Elle sert a
 * n'envoyer qu'UN appel par geste — une position qui ne change pas n'est pas
 * redemandee a chaque tic.
 *
 * @param {{x:number, y:number, width:number, height:number}|null} pose
 * @returns {string} la cle, vide quand il n'y a pas de pose
 */
export function vocalAvatarPoseKey(pose) {
  if (!pose) return "";
  return `${pose.x},${pose.y},${pose.width},${pose.height}`;
}

/**
 * FAUT-IL DEMANDER LA POSE, MAINTENANT ? (decision PURE : un seul appel par
 * geste)
 *
 * La pose n'est demandee que dans le cas ou la zone porte l'avatar, que si la
 * taille est connue (sinon `planVocalAvatarPose` rend null), et une seule fois
 * tant que la pose calculee ne change pas (`lastKey`).
 *
 * @param {object} entrees
 * @param {object} [entrees.imageZone] resultat de `planVocalImageZone`
 * @param {object} [entrees.rect] rectangle de la zone, en pixels CSS
 * @param {object} [entrees.windowOrigin] origine physique de la fenetre
 * @param {object} [entrees.avatar] taille confirmee du visage
 * @param {string} [entrees.lastKey] cle de la derniere pose REELLEMENT demandee
 * @returns {{pose:object|null, key:string, send:boolean}}
 */
export function planVocalAvatarPlacement({
  imageZone,
  rect,
  windowOrigin,
  avatar,
  lastKey,
} = {}) {
  const zone = imageZone;
  const cas = zone && zone.kind;
  if (cas !== VOCAL_IMAGE_AVATAR) {
    return { pose: null, key: "", send: false };
  }
  const pose = planVocalAvatarPose({ rect, windowOrigin, avatar });
  if (!pose) return { pose: null, key: "", send: false };
  const key = vocalAvatarPoseKey(pose);
  return { pose, key, send: key !== String(lastKey || "") };
}

/**
 * Combien de taches la liste peut-elle montrer : le nombre de lignes.
 *
 * Un seul plafond (8), parce que le BUDGET de hauteur tient deja compte de la
 * zone d'image (personnage ou visage) : la liste n'a qu'un cas a connaitre.
 * Le document compte `floor((440 - 40) / 46) = 8`.
 * Les en-tetes de groupe comptent leur hauteur : deux en-tetes (2 x 20) plus
 * une tache (46) font 86 px, sous lesquels ils disparaissent.
 *
 * Jamais zero : une colonne qui n'afficherait aucune tache alors que des
 * missions tournent serait un mensonge silencieux.
 *
 * @param {number} listHeight hauteur laissee a la liste, en px (`planVocalSides`)
 * @returns {{rows:number, headers:boolean, cap:number}}
 */
export function vocalTaskRows(listHeight) {
  const dispo = Number(listHeight);
  const h = Number.isFinite(dispo) ? Math.max(0, dispo) : 0;
  const cap = VOCAL_TASKS_MAX;
  const headers = h >= VOCAL_TASKS_MIN_HEADERS_PX;
  const enTetes = headers ? 2 * VOCAL_TASK_HEADER_PX : 0;
  const brut = Math.floor((h - enTetes) / VOCAL_TASK_PX);
  const rows = Math.max(1, Math.min(headers ? cap : 2, brut));
  return { rows, headers, cap };
}

/**
 * Ce que la colonne de droite affiche : les groupes, dans l'ordre, et le
 * surplus annonce. Fonction PURE : elle ne lit ni le DOM ni le disque.
 *
 * Ordre impose : les missions EN COURS d'abord, puis celles EN ATTENTE, l'ordre
 * d'origine etant conserve a l'interieur de chaque groupe (c'est celui de la
 * file, donc celui qu'attend l'utilisateur). Avec en-tetes, la place est
 * partagee par moitie haute (`ceil(rows / 2)` pour les missions en cours) ; le
 * reliquat va au groupe qui peut encore l'utiliser, jamais a un groupe vide.
 *
 * @param {Array<object>} missions liste rendue par `collectSuperMissions()`
 * @param {object} entrees
 * @param {number} entrees.listHeight hauteur de la liste, en px
 * @returns {{rows:number, headers:boolean, empty:boolean, groups:Array,
 *   shown:number, total:number, more:number}}
 */
export function planVocalTasks(missions, { listHeight } = {}) {
  const liste = Array.isArray(missions) ? missions.filter(Boolean) : [];
  const enCours = liste.filter((m) => m.waiting !== true);
  const attente = liste.filter((m) => m.waiting === true);
  const { rows, headers } = vocalTaskRows(listHeight);
  if (!liste.length) {
    return { rows, headers, empty: true, groups: [], shown: 0, total: 0, more: 0 };
  }
  let nEnCours;
  let nAttente;
  if (headers) {
    const moitie = Math.ceil(rows / 2);
    nEnCours = Math.min(enCours.length, moitie);
    nAttente = Math.min(attente.length, rows - nEnCours);
    // La place laissee par un groupe vide revient a l'autre : aucune ligne
    // perdue, aucun groupe affiche sans tache.
    if (nEnCours + nAttente < rows) {
      nEnCours = Math.min(enCours.length, rows - nAttente);
    }
  } else {
    nEnCours = Math.min(enCours.length, rows);
    nAttente = Math.min(attente.length, rows - nEnCours);
  }
  const groups = [];
  if (nEnCours > 0) {
    groups.push({
      key: "running",
      label: VOCAL_TASKS_GROUP_RUNNING,
      count: enCours.length,
      items: enCours.slice(0, nEnCours),
    });
  }
  if (nAttente > 0) {
    groups.push({
      key: "waiting",
      label: VOCAL_TASKS_GROUP_WAITING,
      count: attente.length,
      items: attente.slice(0, nAttente),
    });
  }
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  return { rows, headers, empty: false, groups, shown, total: liste.length, more: liste.length - shown };
}

/**
 * Combien de caracteres tiennent sur une ligne de la colonne :
 * `(track - cadre) / 7,6`.
 *
 * C'est ce chiffre qui FIXE le nombre de lignes coupees par `vocalExcerpt` :
 * aucune constante cachee ne vient doubler la largeur reelle. Le cadre des deux
 * colonnes (`VOCAL_SIDE_FRAME_PX`, 22 px : 1 px de bordure et 10 px de marge
 * interieure de chaque cote) est retire AVANT la division — la place qu'il
 * occupe n'est pas de la place pour du texte.
 *
 * @param {number} track largeur d'une colonne, en px (`planVocalSides`)
 * @returns {number} caracteres par ligne, au moins 1
 */
export function vocalCharsPerLine(track) {
  const largeur = Number(track);
  const px = Number.isFinite(largeur) && largeur > 0 ? largeur : 0;
  return Math.max(1, Math.floor(Math.max(0, px - VOCAL_SIDE_FRAME_PX) / VOCAL_DISCUSSION_CHAR_PX));
}

/**
 * Ce texte tient-il dans le budget de lignes ? (dit sans rien modifier)
 *
 * @param {string} text texte brut
 * @param {number} maxLines nombre de lignes autorise
 * @param {number} charsPerLine caracteres par ligne (`vocalCharsPerLine`)
 * @returns {boolean} vrai si le texte doit etre coupe
 */
export function vocalSideClipped(text, maxLines, charsPerLine) {
  const brut = normaliserApercu(text);
  const lignes = Math.max(1, Math.floor(Number(maxLines) || 0));
  const parLigne = Math.max(1, Math.floor(Number(charsPerLine) || 0));
  return brut.length > lignes * parLigne;
}

/**
 * Un texte ramene sur une seule ligne : l'apercu d'une colonne ne connait ni
 * saut de ligne ni suite d'espaces.
 *
 * @param {string} text texte lu dans le DOM
 * @returns {string} le meme texte, espaces reduits, sans bord
 */
function normaliserApercu(text) {
  return String(text == null ? "" : text)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Coupe un texte au budget de lignes, SUR UNE FRONTIERE DE MOT et jamais dans un
 * mot (meme regle que `cutTextAtBoundary` de `speech-text.js`, le precedent du
 * projet). Le texte rendu porte l'ellipse quand il a ete coupe : une coupe
 * muette serait un mensonge.
 *
 * @param {string} text texte brut
 * @param {number} maxLines lignes autorisees pour CE message (2 ou 8)
 * @param {number} charsPerLine caracteres par ligne (`vocalCharsPerLine`)
 * @returns {{text:string, lines:number, clipped:boolean}}
 */
export function vocalExcerpt(text, maxLines, charsPerLine) {
  const brut = normaliserApercu(text);
  const lignes = Math.max(1, Math.floor(Number(maxLines) || 0));
  const parLigne = Math.max(1, Math.floor(Number(charsPerLine) || 0));
  const budget = lignes * parLigne;
  if (brut.length <= budget) {
    return { text: brut, lines: Math.max(1, Math.ceil(brut.length / parLigne)), clipped: false };
  }
  // Une place est gardee pour l'ellipse DANS le budget : le texte rendu ne
  // depasse donc jamais le nombre de lignes annonce.
  let coupe = brut.slice(0, Math.max(1, budget - 1));
  const espace = coupe.lastIndexOf(" ");
  if (espace > 0) coupe = coupe.slice(0, espace);
  coupe = coupe.replace(/[\s,;:.!?\-\u2013\u2014]+$/, "");
  if (!coupe) coupe = brut.slice(0, Math.max(1, budget - 1));
  const texte = `${coupe}\u2026`;
  return { text: texte, lines: Math.max(1, Math.ceil(texte.length / parLigne)), clipped: true };
}

/**
 * Combien de lignes la colonne de gauche peut montrer : `floor((H - 14) / 37)`
 * (§ 4.2). Les six valeurs du document, rejouees par le test, en decoulent :
 * 13 a 512 et a 511, 12 a 479, 9 a 383, 8 a 331, 7 a 287, 5 a 231.
 *
 * @param {number} columnHeight hauteur de la colonne, en px (`planVocalSides`)
 * @param {number} track largeur d'une colonne, en px
 * @returns {{lines:number, charsPerLine:number}}
 */
export function planVocalDiscussion(columnHeight, track) {
  const hauteur = Number(columnHeight);
  const h = Number.isFinite(hauteur) ? Math.max(0, hauteur) : 0;
  const unite = VOCAL_DISCUSSION_LINE_H + VOCAL_DISCUSSION_GAP;
  const lines = Math.max(0, Math.floor((h - VOCAL_DISCUSSION_HEAD_PX) / unite));
  return { lines, charsPerLine: vocalCharsPerLine(track) };
}

/**
 * Ce que la colonne de gauche affiche : les derniers messages, du plus ancien
 * (haut) au plus recent (bas), chacun coupe a son budget de lignes.
 *
 * Le remplissage part du PLUS RECENT et remonte : la colonne est un apercu de
 * ce qui vient d'etre dit. Des qu'un message ne tient plus, les precedents non
 * plus (aucun trou : on ne saute jamais un message pour en montrer un plus
 * vieux). Jamais vide quand la conversation existe : a defaut de place pour un
 * message entier, le plus recent est montre sur les lignes disponibles.
 *
 * @param {Array<{role:string, text:string}>} messages lus par
 *   `collectVocalDiscussion()`
 * @param {object} entrees
 * @param {number} entrees.columnHeight hauteur de la colonne, en px
 * @param {number} entrees.track largeur d'une colonne, en px
 * @param {number} [entrees.total] nombre de messages que porte la conversation
 *   (les plus anciens ne sont pas lus : l'excedent doit quand meme etre dit)
 * @returns {{items:Array, lines:number, charsPerLine:number, total:number,
 *   hidden:number, more:number}}
 */
export function vocalDiscussionView(messages, { columnHeight, track, total } = {}) {
  const lues = Array.isArray(messages)
    ? messages.filter((m) => m && typeof m.text === "string" && m.text.trim())
    : [];
  const { lines, charsPerLine } = planVocalDiscussion(columnHeight, track);
  const totalLu = Number(total);
  const nombre = Number.isFinite(totalLu) && totalLu > lues.length ? Math.floor(totalLu) : lues.length;
  const budget = Math.max(0, lines * (VOCAL_DISCUSSION_LINE_H + VOCAL_DISCUSSION_GAP));
  // La ligne d'excedent est reservee d'avance : quand elle apparait, elle ne
  // prend la place d'aucun message deja accepte.
  const dispo = Math.max(0, budget - (lues.length ? VOCAL_DISCUSSION_MORE_PX : 0));

  const retenues = [];
  let consomme = 0;
  for (let i = lues.length - 1; i >= 0; i--) {
    const message = lues[i];
    const maxLines =
      message.role === "user"
        ? VOCAL_DISCUSSION_QUESTION_LINES
        : VOCAL_DISCUSSION_ANSWER_LINES;
    const extrait = vocalExcerpt(message.text, maxLines, charsPerLine);
    const cout = extrait.lines * VOCAL_DISCUSSION_LINE_H + (retenues.length ? VOCAL_DISCUSSION_GAP : 0);
    if (consomme + cout > dispo) break;
    consomme += cout;
    retenues.unshift({ role: message.role === "user" ? "user" : "assistant", text: extrait.text });
  }

  // Aucun message ne tenait : le plus recent est montre quand meme, coupe a la
  // place reellement disponible. Une colonne qui n'affiche rien alors que la
  // conversation existe serait un mensonge silencieux.
  if (!retenues.length && lues.length) {
    const derniere = lues[lues.length - 1];
    const plafond = derniere.role === "user"
      ? VOCAL_DISCUSSION_QUESTION_LINES
      : VOCAL_DISCUSSION_ANSWER_LINES;
    const lignesDispo = Math.min(plafond, Math.max(1, Math.floor(budget / VOCAL_DISCUSSION_LINE_H)));
    const extrait = vocalExcerpt(derniere.text, lignesDispo, charsPerLine);
    retenues.push({ role: derniere.role === "user" ? "user" : "assistant", text: extrait.text });
  }

  const affiches = retenues.length;
  return {
    items: retenues,
    lines,
    charsPerLine,
    total: nombre,
    hidden: Math.max(0, nombre - affiches),
    more: nombre - affiches > 0 ? Math.ceil((nombre - affiches) / 2) : 0,
  };
}

/**
 * La phrase du surplus : « ... et N echange(s) plus haut ». Un echange vaut une
 * question et sa reponse (deux messages) : c'est ce que compte la colonne.
 *
 * @param {number} n nombre d'echanges plus anciens que ce qui est affiche
 * @returns {string} la phrase, vide si le surplus est nul
 */
export function vocalDiscussionMoreText(n) {
  const nombre = Number(n);
  const compte = Number.isFinite(nombre) ? Math.max(0, Math.floor(nombre)) : 0;
  if (!compte) return "";
  return `\u2026 et ${compte} \u00e9change${compte >= 2 ? "s" : ""} plus haut`;
}
