// Politique d'admission des missions d'agents (lecture partagée / modification
// exclusive). Module PUR, sans I/O ni état : la décision est calculée à partir
// de la nature de la mission et de ce qui tourne déjà SUR LE MÊME PROJET.
//
// Règles (spécifiées par le propriétaire, non réinterprétées) :
//   - des projets différents ne se bloquent jamais (le cadrage par projet est
//     fait par l'appelant : `runningNatures` ne porte que les runs du projet
//     visé) ;
//   - sur un même projet : lecture + lecture = autorisé (missions de lecture
//     partagées) ;
//   - toute mission qui MODIFIE est exclusive : elle ne démarre pas tant que
//     quelque chose tourne sur le projet ;
//   - rien ne démarre tant qu'une mission qui MODIFIE tourne sur le projet.

/** Nature d'une mission d'après le drapeau `readonly` du registre des agents. */
export function missionNature(readonly) {
  return readonly === true ? "read" : "write";
}

/**
 * Décide si une mission peut démarrer.
 * @param {"read"|"write"} nature - nature de la mission à admettre
 * @param {Array<"read"|"write">} runningNatures - natures des runs déjà en
 *   cours SUR LE MÊME PROJET (vide = rien ne tourne)
 * @returns {boolean} true si la mission peut démarrer immédiatement
 */
export function canStartMission(nature, runningNatures) {
  const running = Array.isArray(runningNatures) ? runningNatures : [];
  if (running.length === 0) return true;
  // Une modification est exclusive : jamais en parallèle de quoi que ce soit.
  if (nature === "write") return false;
  // Une lecture cohabite uniquement avec d'autres lectures.
  return running.every((n) => n === "read");
}
