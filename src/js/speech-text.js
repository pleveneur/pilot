// speech-text.js — texte destine a la SYNTHESE VOCALE : nettoyage unique.
//
// Ce module ne sert QU'A la voix. Il ne touche ni a l'affichage, ni au rendu
// Markdown, ni au fil de discussion : seul le chemin qui alimente
// `speechSynthesis` l'appelle (voir `read-aloud.js`).
//
// Constat corrige ici : le texte transmis au moteur de voix n'etait pas du
// texte pur. Il portait encore les EMOJIS et quelques marques de mise en forme
// (underscores d'italique, `#` sans espace, adresses nues), si bien que la voix
// les prononcait ou marquait des pauses absurdes.
//
// Regles tenues (une seule fonction pure les applique : `textForSpeech`) :
//   1. EMOJIS et pictogrammes retires (y compris drapeaux, carnations, ZWJ,
//      selecteurs de variation, touches encombrees). Les CHIFFRES sont
//      conserves : `1\uFE0F\u20E3` devient `1`, jamais rien.
//   2. Mise en forme retiree : `**`, `__`, `~~`, `*`, accents graves, `#`,
//      `>`, puces et numeros de liste, traits de separation.
//   3. BLOCS DE CODE supprimes (jamais lus) : la voix annonce seulement qu'il y
//      a du code a l'ecran. Le texte entre accents graves est GARDE, sans les
//      accents graves (un nom de fichier ou de fonction se lit).
//   4. TABLEAUX lus en TEXTE COURANT : les lignes de separation (`| --- |`)
//      disparaissent, les barres deviennent des espaces et chaque ligne reste
//      une ligne. Choix justifie : dans les reponses de l'assistant, un tableau
//      porte souvent une information (comparatif, liste de valeurs) ; la
//      supprimer ferait perdre du sens a l'oral, alors que la lire en texte
//      courant reste comprehensible. Les entetes ne sont pas repetes.
//   5. LIENS : le LIBELLE est garde, l'ADRESSE est retiree (y compris les
//      adresses nues et les autoliens `<https://...>`).
//   6. Balises HTML et entites (`&nbsp;`, `&amp;`, numeriques) traitees.
//   7. CONSERVE : accents, ponctuation, apostrophes, chiffres, majuscules.
//   8. Espaces et lignes vides doublees reduites.
//   9. La fonction est IDEMPOTENTE (elle est appelee deux fois sur le chemin de
//      la voix : une fois en construisant le texte du message, une fois au
//      moment de parler) et sans effet sur un texte deja propre.
//  10. Toute coupure de longueur (`cutTextAtBoundary`) tombe sur une FIN DE
//      PHRASE ou une FIN DE MOT, jamais au milieu d'un mot.
//
// Aucune dependance : testable directement sous Node.

/** Ce que la voix prononce a la place du CONTENU d'un bloc de code. */
export const CODE_BLOCK_NOTICE = "bloc de code affiche a l'ecran";

/**
 * Classe de caracteres des emojis et pictogrammes.
 *
 * On n'utilise SURTOUT pas `\p{Emoji}` : cette propriete inclut les CHIFFRES,
 * `#` et `*`. `\p{Extended_Pictographic}` est la bonne propriete (ES2018) ; si
 * le moteur ne la connait pas, on retombe sur des plages explicites.
 */
function buildEmojiRegex() {
  const explicit =
    "\\u{1F000}-\\u{1FAFF}" + // pictogrammes supplementaires (smileys, objets...)
    "\\u{1F1E6}-\\u{1F1FF}" + // indicateurs regionaux (drapeaux)
    "\\u{1F3FB}-\\u{1F3FF}" + // modificateurs de carnation
    "\\u{2600}-\\u{27BF}" + // symboles divers et dingbats
    "\\u{2B00}-\\u{2BFF}" + // symboles divers et fleches pictographiques
    "\\u{FE0E}\\u{FE0F}" + // selecteurs de variation (texte / emoji)
    "\\u{200D}" + // assembleur zero-largeur (sequences emoji)
    "\\u{20E3}" + // touche encombree
    "\\u{3030}\\u{303D}\\u{3297}\\u{3299}";
  try {
    return new RegExp("[\\p{Extended_Pictographic}" + explicit + "]", "gu");
  } catch (_) {
    return new RegExp("[" + explicit + "]", "gu");
  }
}

const EMOJI_RE = buildEmojiRegex();

/**
 * Retire emojis et pictogrammes (les chiffres et la ponctuation restent).
 * @param {string} text
 * @returns {string}
 */
export function stripEmojis(text) {
  return String(text == null ? "" : text).replace(EMOJI_RE, "");
}

/** Decode les entites HTML rencontrees dans un rendu (`&nbsp;`, `&#128512;`...). */
function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) =>
      safeFromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#0?39|rsquo);/gi, "'")
    .replace(/&(?:hellip|mldr|#8230);/gi, "\u2026")
    .replace(/&(?:ndash|#8211);/gi, "\u2013")
    .replace(/&(?:mdash|#8212);/gi, "\u2014");
}

/** `String.fromCodePoint` tolerant (point de code invalide -> chaine vide). */
function safeFromCodePoint(code) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch (_) {
    return "";
  }
}

/**
 * Prepare un texte pour la SYNTHESE VOCALE : plus d'emojis, plus de balisage,
 * un phrase naturelle. Fonction PURE : meme entree, meme sortie, aucun effet de
 * bord, aucune dependance au DOM.
 * @param {string} raw texte brut (Markdown, HTML rendu, ou melange des deux)
 * @returns {string} texte a prononcer
 */
export function textForSpeech(raw) {
  let t = String(raw == null ? "" : raw);
  if (!t.trim()) return "";

  // 0. Entites HTML d'abord : une entite numerique peut cacher un emoji.
  t = decodeEntities(t);

  // 1. Blocs de code : le CONTENU n'est jamais lu, seulement annonce.
  const notice = ` ${CODE_BLOCK_NOTICE}. `;
  t = t.replace(/```[\s\S]*?```/g, notice);
  t = t.replace(/~~~[\s\S]*?~~~/g, notice);
  t = t.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, notice);

  // 2. Images et liens : le LIBELLE seul, jamais l'adresse.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  t = t.replace(/<\s*(?:https?:\/\/|mailto:)[^>]*>/gi, " "); // autoliens
  // Adresses nues : jamais lues. La classe exclut `"`, `'`, `<` et `>` pour ne
  // pas avaler la fin d'un attribut (ex. `<a href="https://…">libelle</a>` :
  // seule l'adresse part, le LIBELLE reste).
  t = t.replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, " ");

  // 3. Balisage HTML structurel -> pauses et sauts de ligne.
  t = t.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  t = t.replace(/<\s*li\b[^>]*>/gi, "\n");
  t = t.replace(
    /<\s*\/\s*(?:p|div|li|tr|h[1-6]|section|article|blockquote|ul|ol|table|thead|tbody|dd|dt)\s*>/gi,
    ". ",
  );
  t = t.replace(/<[^>]*>/g, " ");

  // 4. Tableaux Markdown : lignes de separation retirees, barres -> espaces.
  t = t.replace(/^[ \t]*\|?[\s:|-]*-[\s:|-]*\|[ \t]*$/gm, "");
  t = t.replace(/[ \t]*\|[ \t]*/g, " ");

  // 5. Titres, citations, listes, traits de separation.
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, "");
  t = t.replace(/^[ \t]{0,3}(?:>[ \t]?)+/gm, "");
  t = t.replace(/^[ \t]*(?:[-*_=][ \t]*){3,}$/gm, ""); // regles horizontales
  t = t.replace(/^[ \t]*[-*+\u2022\u00b7\u25aa\u25e6\u2023\u2043][ \t]+/gm, ""); // puces
  t = t.replace(/^[ \t]*\(?\d{1,3}[.)][ \t]+/gm, ""); // numeros de liste

  // 6. Emphase, raye, code inline, underscores d'emphase isoles.
  t = t.replace(/\*\*|__|~~/g, "");
  t = t.replace(/[*`]+/g, "");
  t = t.replace(/(^|[^\p{L}\p{N}_])_+/gu, "$1"); // underscores ouvrants
  t = t.replace(/_+(?=$|[^\p{L}\p{N}_])/gu, ""); // underscores fermants
  t = t.replace(/\[\^\d+\]/g, ""); // appels de note de bas de page

  // 7. Emojis et pictogrammes (apres le balisage : rien ne les protege plus).
  t = stripEmojis(t);

  // 8. Espaces, ponctuation et lignes vides : une phrase propre.
  t = t.replace(/\u00a0/g, " ");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/[ \t]*\n[ \t]*/g, "\n");
  t = t.replace(/([.!?\u2026])[ \t]*\./g, "$1");
  // Espace avant une virgule ou un point = faute de frappe : on la retire. En
  // revanche l'espace avant « ! », « ? », « ; » et « : » est la typographie
  // francaise : elle est CONSERVEE (la mission demande de garder la ponctuation).
  t = t.replace(/[ \t]+([.,])/g, "$1");
  t = t.replace(/\n{2,}/g, "\n");
  t = t
    .split("\n")
    .map((line) => line.trim().replace(/^[.,;:!?]+[ \t]*/, ""))
    .filter(Boolean)
    .join("\n");
  t = t.replace(/[ \t]{2,}/g, " ");
  return t.trim();
}

/**
 * Coupe un texte trop long en respectant la langue parlee :
 *   1. sur une FIN DE PHRASE (`. `, `! `, `? `, `... `),
 *   2. sinon sur une FIN DE MOT (derniere espace dans la limite),
 *   3. en dernier recours seulement, a la limite exacte (mot insécable plus long
 *      que la limite : aucune frontiere n'existe).
 * Ne perd aucun caractere : `head + tail` reconstitue le texte (aux espaces de
 * bord pres).
 * @param {string} text
 * @param {number} maxLen longueur maximale de `head`
 * @returns {[string, string]} [debut, reste]
 */
export function cutTextAtBoundary(text, maxLen) {
  const src = String(text == null ? "" : text);
  const limit = Math.max(1, Math.floor(Number(maxLen) || 0));
  if (src.length <= limit) return [src, ""];
  const window = src.slice(0, limit);

  // 1. Fin de phrase.
  let cut = -1;
  for (const mark of [". ", "! ", "? ", "\u2026 ", ".", "!", "?", "\u2026"]) {
    const idx = window.lastIndexOf(mark);
    if (idx < 0) continue;
    const end = idx + mark.length;
    if (end <= limit) cut = Math.max(cut, end);
  }
  if (cut > 0) return [src.slice(0, cut).trim(), src.slice(cut).trim()];

  // 2. Fin de mot (jamais au milieu d'un mot).
  const space = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\t"));
  if (space > 0) return [src.slice(0, space).trim(), src.slice(space).trim()];

  // 3. Aucune frontiere : mot insécable plus long que la limite.
  return [src.slice(0, limit), src.slice(limit)];
}
