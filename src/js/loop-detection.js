// loop-detection.js — Détection de boucle dans la réflexion du modèle (issue #37).
//
// Un modèle IA peut tourner en boucle : un bloc de texte se répète à l'identique
// (sur une ou plusieurs lignes), gaspillant tokens et temps. Cette détection est
// pure (aucune dépendance DOM/navigateur) pour être testable en isolation et
// branchée à la fois sur le chat standard (agent-pi.js) et sur les sous-agents /
// multi-codeurs H2 (agents-bus.js). Le Mode Orchestration est explicitement
// exclu (cycle Réfléchir/Faire/Contrôler inchangé).
//
// Principe : on analyse les N dernières lignes du flux de réflexion streamé par
// le modèle. On recherche un bloc de lignes (normalisées) qui se répète à
// l'identique au moins `minRepeat` fois consécutivement et qui est suffisamment
// substantiel (`minBlockChars`) pour être un vrai bouclage plutôt qu'un artefact
// de mise en forme.

/**
 * Normalise une ligne pour la comparaison : trim + collapse des espaces
 * multiples. Insensible aux variations mineures de mise en forme (espaces
 * multiples, indentations incohérentes) tout en restant fidèle au contenu.
 * @param {string} line
 * @returns {string}
 */
export function normalizeLoopLine(line) {
  if (typeof line !== "string") return "";
  return line.trim().replace(/\s+/g, " ");
}

/**
 * Détecte si le texte fourni (réflexion streamée) contient un bloc répété à
 * l'identique au moins `minRepeat` fois consécutivement, sur les `maxLines`
 * dernières lignes.
 *
 * @param {string} text - texte brut de la réflexion / streaming du modèle
 * @param {object} [options]
 * @param {number} [options.maxLines=40] - fenêtre : dernières lignes analysées
 * @param {number} [options.minBlockLines=1] - taille minimale d'un bloc (en lignes)
 * @param {number} [options.minBlockChars=150] - taille minimale du bloc répété (caractères)
 * @param {number} [options.minRepeat=3] - nb de répétitions identiques consécutives déclenchant la boucle
 * @returns {boolean} true si un bloc répété est détecté
 */
export function detectRepeatedBlock(text, options = {}) {
  const maxLines = options.maxLines ?? 40;
  const minBlockLines = options.minBlockLines ?? 1;
  const minBlockChars = options.minBlockChars ?? 150;
  const minRepeat = options.minRepeat ?? 3;

  if (!text || typeof text !== "string") return false;

  const lines = text.split("\n");
  const window = lines.slice(-maxLines);
  const norm = window.map(normalizeLoopLine);

  // Un bloc de `blockLines` lignes doit tenir `minRepeat` fois dans la fenêtre.
  const maxBlockLines = Math.floor(norm.length / minRepeat);
  if (maxBlockLines < minBlockLines) return false;

  for (let blockLines = minBlockLines; blockLines <= maxBlockLines; blockLines++) {
    for (let start = 0; start + blockLines * minRepeat <= norm.length; start++) {
      const block = norm.slice(start, start + blockLines);
      const key = block.join("\n").trim();
      if (key.length < minBlockChars) continue;

      // Compter les répétitions identiques CONSÉCUTIVES à partir de `start`.
      let count = 1;
      for (let i = start + blockLines; i + blockLines <= norm.length; i += blockLines) {
        if (norm.slice(i, i + blockLines).join("\n").trim() === key) {
          count++;
          if (count >= minRepeat) return true;
        } else {
          break;
        }
      }
    }
  }
  return false;
}
