// vocal-sides.js — LOT 1 de l'ecran Vocal : la LARGEUR des deux colonnes
// laterales, en une seule formule PURE ; LOT 2 : le contenu de la colonne de
// droite ; COMPLEMENT DU 2026-10-29 : la ZONE D'IMAGE a trois cas (§ 7bis) et
// la POSE de la fenetre du visage.
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
//   240 px   seuil de presence, LE MEME DANS LES DEUX SENS : 72 (portrait) +
//            6 + 20 (nom) + 14 + 14 (titre) + 14 + 20 (en-tete de groupe) +
//            46 (une tache) + 12 + 18 (ligne d'activite) = 236, arrondis a 240 ;
//   24 px    jour de chaque cote du disque (le `column-gap` de la grille) ;
//   16 px    marge de chaque cote de l'ecran (le `padding` de la scene) ;
//   289 px   ce que le reste de l'ecran prend en hauteur (36 onglets + 44 barre
//            + 80 ligne d'etat + 60 saisie + 69 respirations) — le meme nombre
//            que `--vocal-orb-size` dans la feuille de style ;
//   88 / 336 la couronne du halo, en fraction du disque (jeton `--vocal-crown`).
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
/** Hauteur du medaillon du personnage, en px. */
export const VOCAL_PORTRAIT_PX = 72;
/** Hauteur d'une tache dans la liste, en px (lot 2). */
export const VOCAL_TASK_PX = 46;
/** Hauteur d'un en-tete de groupe de la liste, en px (lot 2). */
export const VOCAL_TASK_HEADER_PX = 20;
/**
 * Hauteur du bloc du personnage quand il est la : le medaillon (72) + son
 * ecart (6) + la pastille de son nom (20) = 98 px. C'est le bloc rendu a la
 * LISTE quand il n'y a pas de personnage (decision du 2026-10-29 : aucun nom
 * sous l'image, donc plus rien a reserver pour un nom).
 */
export const VOCAL_PORTRAIT_BLOCK_PX = VOCAL_PORTRAIT_PX + 6 + 20;
/**
 * Total fixe du haut de la colonne QUAND un personnage est affiche :
 * 14 + 14 + 14 (titre et marges) + 72 (portrait) + 6 (ecart du nom) +
 * 20 (nom) + 12 + 18 (ligne d'activite) = 170 px. C'est ce total qui garantit
 * qu'un personnage actif ne coute pas un pixel de plus a la colonne.
 */
export const VOCAL_SIDE_FIXED_PX = 72 + VOCAL_PORTRAIT_BLOCK_PX;

// ── LA ZONE D'IMAGE, A TROIS CAS ──
// Source : CONCEPTION-ecran-vocal-portrait-et-colonnes.md, complement du
// 2026-10-29, § 7bis (la zone d'image a trois cas). Decision du proprietaire :
// la zone est EN HAUT de la colonne de droite, la liste des taches passe
// DESSOUS. Aucun nombre du § 7bis.4 ne change : les totaux de hauteur sont les
// memes, seule l'ancre du bloc remonte.
//
//   1. le PERSONNAGE (un portrait affichable existe)      -> 98 px
//   2. sinon l'AVATAR DU VISAGE (PLface), s'il tourne et si
//      sa TAILLE est connue                               -> 180 px
//   3. sinon rien du tout : AUCUNE place reservee          -> 0 px

/** Largeur du plancher de la fenetre du visage (PLface), en px (§ 7bis.7). */
export const VOCAL_AVATAR_W_PX = 160;
/** Hauteur du plancher de la fenetre du visage (PLface), en px (§ 7bis.7). */
export const VOCAL_AVATAR_H_PX = 180;
/** Ecart entre la fenetre du visage et le medaillon pose dessous, en px. */
export const VOCAL_IMAGE_GAP_PX = 6;
/** Le cas 1 : le personnage occupe la zone. */
export const VOCAL_IMAGE_PORTRAIT = "portrait";
/** Le cas 2 : l'avatar du visage occupe la zone, seul. */
export const VOCAL_IMAGE_AVATAR = "avatar";
/** Les cas 1 et 2 : l'avatar, puis le medaillon du personnage dessous. */
export const VOCAL_IMAGE_AVATAR_PORTRAIT = "avatar+portrait";
/** Le cas 3 : la zone n'existe pas (aucune image, aucun cadre, aucune place). */
export const VOCAL_IMAGE_NONE = "none";
/** Rapport boite / disque : 336 + 2 x 88 = 512 px de boite pour 336 de disque. */
export const VOCAL_ORB_BOX_RATIO = 1 + (2 * 88) / 336;

// ── LOT 2 : LE CONTENU DE LA COLONNE DE DROITE ──
// Source : CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md, § 2.2
// (ce qui entre dans la liste), § 2.3 (le nombre de lignes) et § 2.4 (la ligne
// d'activite). Aucune valeur choisie ici : toutes viennent de la conception.

/** Nombre maximal de taches quand un personnage occupe le pied de la colonne. */
export const VOCAL_TASKS_MAX = 6;
/** Nombre maximal de taches quand la colonne est libre (aucun portrait). */
export const VOCAL_TASKS_MAX_BARE = 8;
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
 * @param {boolean} [entrees.hasPortrait] un portrait affichable existe-t-il
 * @param {boolean} [entrees.hasAvatar] une fenetre de visage (PLface) de taille
 *   connue est-elle disponible (voir `planVocalImageZone`)
 * @returns {{track:number, shown:boolean, columnHeight:number, listHeight:number,
 *   hasPortrait:boolean, hasAvatar:boolean, imageZone:object}}
 *   `track` = largeur d'UNE colonne (0 = colonnes absentes), `shown` = les
 *   colonnes sont-elles affichees, `columnHeight` = hauteur de la colonne
 *   (`H`), `listHeight` = place laissee a la LISTE sous son haut fixe et sous
 *   la zone d'image, `hasPortrait` = le cas 1 (personnage) s'applique,
 *   `hasAvatar` = le cas 2 (avatar du visage) s'affiche REELLEMENT (il peut
 *   etre refuse faute de place), `imageZone` = la zone d'image decidee (voir
 *   `planVocalImageZone`) — la repeinture n'a donc pas a relire le personnage.
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

  // La hauteur des colonnes : la boite du disque, plafonnee par la place que la
  // fenetre offre reellement (jamais 512 px ecrases sur la ligne d'etat). Elle
  // ne depend NI de la largeur des colonnes NI du nombre de taches.
  const place = h - VOCAL_ORB_RESERVED_PX;
  const columnHeight = Math.max(0, Math.round(Math.min(orb * VOCAL_ORB_BOX_RATIO, place)));

  // Les trois cas de la zone d'image, dans l'ordre : le personnage, sinon
  // l'avatar du visage, sinon rien. Une zone qui ne laisserait pas au moins UNE
  // tache a la liste n'est pas dessinee : c'est le seul refus possible de
  // l'avatar ("une zone qui ne dessine rien ne fait jamais un trou").
  const imageZone = planVocalImageZone({ hasPortrait, hasAvatar, columnHeight });

  // Haut fixe de la colonne : 170 px avec un personnage, 72 px sans (il n'y a
  // alors ni portrait ni nom, et la liste prend toute la hauteur), plus la
  // place de la fenetre du visage quand elle s'affiche.
  const fixe = (hasPortrait ? VOCAL_SIDE_FIXED_PX : VOCAL_PORTRAIT_PX) + imageZone.height;
  const listHeight = Math.max(0, columnHeight - fixe);

  return {
    track,
    shown: track > 0,
    columnHeight,
    listHeight,
    hasPortrait: !!hasPortrait,
    hasAvatar: imageZone.avatar,
    imageZone,
  };
}

/**
 * LA ZONE D'IMAGE, A TROIS CAS (CONCEPTION-ecran-vocal-portrait-et-colonnes.md,
 * complement du 2026-10-29, § 7bis.2) — decision PURE, dans cet ordre :
 *
 *   1. le PERSONNAGE occupe la zone si et seulement si un portrait affichable
 *      existe (`hasPortrait`) : rien d'autre n'est lu, aucun reglage, aucun
 *      etat memorise ;
 *   2. SINON l'AVATAR DU VISAGE, s'il tourne ET si sa taille est connue
 *      (`hasAvatar`), et seulement s'il reste au moins UNE ligne de liste
 *      apres lui — sinon il n'est pas pose du tout et la liste garde la place ;
 *   3. SINON rien : la zone n'existe pas, la liste prend toute la hauteur.
 *
 * La HAUTEUR de la zone ne compte que l'ESPACE VIDE que Pilot reserve a la
 * fenetre du visage : 0 px au cas 1 et au cas 3 (le medaillon du personnage est
 * un vrai noeud, il prend sa place lui-meme), 180 px au cas 2, et 180 + 6 px
 * au-dessus du medaillon quand les deux s'affichent. Les totaux du § 7bis.4
 * sont donc exactement ceux du document :
 *   cas 3 : liste = H - 72     cas 1 : liste = H - 170
 *   cas 2 : liste = H - 252    cas 1+2 : liste = H - 356
 *
 * @param {object} entrees
 * @param {boolean} [entrees.hasPortrait] un portrait affichable existe-t-il
 * @param {boolean} [entrees.hasAvatar] une fenetre de visage de taille connue
 *   est-elle disponible
 * @param {number} [entrees.columnHeight] hauteur de la colonne, en px (`H`)
 * @returns {{kind:string, height:number, avatar:boolean, portrait:boolean}}
 *   `kind` vaut "portrait", "avatar", "avatar+portrait" ou "none" ; `height`
 *   est la place VIDE reservee a la fenetre du visage ; `avatar` et `portrait`
 *   disent quels blocs s'affichent.
 */
export function planVocalImageZone({ hasPortrait, hasAvatar, columnHeight } = {}) {
  const portrait = hasPortrait === true;
  const hauteur = Number(columnHeight);
  const H = Number.isFinite(hauteur) && hauteur > 0 ? hauteur : 0;
  // Ce qui reste a la liste quand la fenetre du visage n'est pas posee.
  const sansAvatar = VOCAL_PORTRAIT_PX + (portrait ? VOCAL_PORTRAIT_BLOCK_PX : 0);
  const reserve = VOCAL_AVATAR_H_PX + (portrait ? VOCAL_IMAGE_GAP_PX : 0);
  // L'avatar n'est pose que s'il reste UNE ligne de liste apres lui : une zone
  // qui ne dessine rien ne fait jamais un trou, mais elle ne mange pas non plus
  // la derniere tache.
  const avatar = hasAvatar === true && H - sansAvatar - reserve >= VOCAL_TASK_PX;
  const height = avatar ? reserve : 0;
  let kind = VOCAL_IMAGE_NONE;
  if (avatar) kind = portrait ? VOCAL_IMAGE_AVATAR_PORTRAIT : VOCAL_IMAGE_AVATAR;
  else if (portrait) kind = VOCAL_IMAGE_PORTRAIT;
  return { kind, height, avatar, portrait };
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
 * La pose n'est demandee que dans les deux cas ou la zone porte l'avatar, que
 * si la taille est connue (sinon `planVocalAvatarPose` rend null), et une seule
 * fois tant que la pose calculee ne change pas (`lastKey`).
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
  if (cas !== VOCAL_IMAGE_AVATAR && cas !== VOCAL_IMAGE_AVATAR_PORTRAIT) {
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
 * Deux cas, et un seul critere (le personnage) :
 *   - cas A, un personnage occupe le pied : 6 taches au plus ;
 *   - cas B, la colonne est libre : 8 taches au plus (le document compte
 *     `floor((440 - 40) / 46) = 8`).
 * Les en-tetes de groupe comptent leur hauteur : deux en-tetes (2 x 20) plus
 * une tache (46) font 86 px, sous lesquels ils disparaissent.
 *
 * Jamais zero : une colonne qui n'afficherait aucune tache alors que des
 * missions tournent serait un mensonge silencieux.
 *
 * @param {number} listHeight hauteur laissee a la liste, en px (`planVocalSides`)
 * @param {boolean} hasPortrait un personnage occupe-t-il le pied de la colonne
 * @returns {{rows:number, headers:boolean, cap:number}}
 */
export function vocalTaskRows(listHeight, hasPortrait) {
  const dispo = Number(listHeight);
  const h = Number.isFinite(dispo) ? Math.max(0, dispo) : 0;
  const cap = hasPortrait ? VOCAL_TASKS_MAX : VOCAL_TASKS_MAX_BARE;
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
 * @param {boolean} [entrees.hasPortrait] un personnage occupe-t-il le pied
 * @returns {{rows:number, headers:boolean, empty:boolean, groups:Array,
 *   shown:number, total:number, more:number}}
 */
export function planVocalTasks(missions, { listHeight, hasPortrait } = {}) {
  const liste = Array.isArray(missions) ? missions.filter(Boolean) : [];
  const enCours = liste.filter((m) => m.waiting !== true);
  const attente = liste.filter((m) => m.waiting === true);
  const { rows, headers } = vocalTaskRows(listHeight, hasPortrait);
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
 * La ligne d'activite du bas de la colonne : UNE phrase, jamais deux.
 *
 * Elle ne redit pas la liste (les taches sont au-dessus) : elle dit ce qui se
 * passe MAINTENANT. Ses phrases sont une famille a part, distincte de la ligne
 * d'etat du bas de l'ecran : aucune des deux ne peut voler le texte de l'autre.
 *
 * @param {Array<object>} missions liste rendue par `collectSuperMissions()`
 * @returns {string} une phrase, jamais vide
 */
export function vocalNowLine(missions) {
  const liste = Array.isArray(missions) ? missions.filter(Boolean) : [];
  const enCours = liste.filter((m) => m.waiting !== true);
  const attente = liste.filter((m) => m.waiting === true);
  const qui = (m) => (m && (m.agent || m.project)) || "L'assistant";
  const quoi = (m) => (m && m.toolInProgress === true ? "ex\u00e9cute une op\u00e9ration" : "r\u00e9fl\u00e9chit");
  if (enCours.length === 1) return `${qui(enCours[0])} ${quoi(enCours[0])}`;
  if (enCours.length > 1) {
    return `${enCours.length} agents travaillent \u2014 ${qui(enCours[0])} ${quoi(enCours[0])}`;
  }
  const demarrage = attente.filter((m) => m.starting === true).length;
  if (demarrage > 0) {
    return demarrage === 1 ? "D\u00e9marrage de 1 mission" : `D\u00e9marrage de ${demarrage} missions`;
  }
  if (attente.length > 0) {
    return attente.length === 1 ? "1 mission en attente" : `${attente.length} missions en attente`;
  }
  return "Tout est au repos";
}

/**
 * Combien de caracteres tiennent sur une ligne de la colonne : `track / 7,6`.
 *
 * C'est ce chiffre qui FIXE le nombre de lignes coupees par `vocalExcerpt` :
 * aucune constante cachee ne vient doubler la largeur reelle.
 *
 * @param {number} track largeur d'une colonne, en px (`planVocalSides`)
 * @returns {number} caracteres par ligne, au moins 1
 */
export function vocalCharsPerLine(track) {
  const largeur = Number(track);
  const px = Number.isFinite(largeur) && largeur > 0 ? largeur : 0;
  return Math.max(1, Math.floor(px / VOCAL_DISCUSSION_CHAR_PX));
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
