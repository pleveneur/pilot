// Pilot Chrome tools bridge — rend les outils navigateur (pi-chrome) utilisables
// dans les sessions d'agents lancées par Pilot.
//
// PROBLÈME (diagnostiqué, cf. ~/.pilot/assistant/rapport-navigateur-agents.md et
// rapport-navigateur-agents-phase2.md) : le paquet pi-chrome est bien chargé dans
// les sessions d'agents (il vient des `packages` de ~/.pi/agent/settings.json, pas
// de `--extension`), mais ses outils `chrome_*` ne sont enregistrés/appelables que
// si la session est *autorisée*. Cette autorisation vit uniquement EN MÉMOIRE, sur
// `globalThis`, sous la clé `__piChromeProfileBridgeAuth__` de forme
// `{ until: number | "indefinite" }` (pi-chrome `index.ts:61` et `:674`), et elle
// est lue par pi-chrome au CHARGEMENT de son module (`index.ts:692-697`). Un
// process `pi` neuf (toute session d'agent) est donc « chargé mais non autorisé »
// → outils `chrome_*` absents.
//
// CORRECTIF (additif) : ce fichier pose la clé d'autorisation au chargement de
// l'extension — donc AVANT que le module pi-chrome ne soit évalué. L'ordre est
// garanti côté pi : les extensions CLI (`--extension`, dont celle-ci) sont
// chargées avant les extensions des paquets npm (`dist/core/resource-loader.js` :
// `mergePaths(cliEnabledExtensions, enabledExtensions)`, puis chargement
// séquentiel `await loadExtension(...)` dans `dist/core/extensions/loader.js`).
// C'est également vrai de la passe « pré-trust » (même `loadCurrentExtensionSet`).
//
// PORTÉE ET SÛRETÉ :
// - la clé vit uniquement en mémoire du process (jamais écrite sur disque) ;
// - elle n'affecte que les process pi où cette extension est chargée, c'est-à-dire
//   les sessions d'agents lancées par Pilot — jamais les sessions `pi`
//   interactives de l'utilisateur ;
// - si pi-chrome n'est pas installé, ou change de clé, l'écriture est sans effet
//   (aucune erreur, aucun comportement modifié) ;
// - aucun outil n'est enregistré ici : pi-chrome reste seul propriétaire de ses
//   outils, de sa logique et de son courtier.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PI_CHROME_AUTH_KEY = "__piChromeProfileBridgeAuth__";
const PI_CHROME_LOADED_KEY = "__piChromeProfileBridgeLoaded__";
const CHROME_TOOL_PREFIX = "chrome_";

export default function (pi: ExtensionAPI): void {
  // Autorisation posée au chargement, avant l'évaluation du module pi-chrome.
  try {
    (globalThis as Record<string, unknown>)[PI_CHROME_AUTH_KEY] = { until: "indefinite" };
  } catch {
    // fail-open : ne jamais faire échouer le chargement d'une extension Pilot.
  }

  // Diagnostic inerte (aucun effet sur le comportement) : si pi-chrome est chargé
  // dans ce process mais que ses outils restent inactifs, le signaler dans le
  // stderr du process (récupéré par Pilot dans `last_stderr`), pour rendre le
  // problème visible au lieu de le laisser silencieux.
  pi.on("session_start", () => {
    try {
      const g = globalThis as Record<string, unknown>;
      if (!g[PI_CHROME_LOADED_KEY]) return; // pi-chrome absent → rien à signaler
      const active = pi.getActiveTools();
      if (!active.some((name) => name.startsWith(CHROME_TOOL_PREFIX))) {
        console.warn(
          "[pilot-chrome] pi-chrome est chargé mais les outils chrome_* restent inactifs (clé d'autorisation non prise en compte).",
        );
      }
    } catch {
      // fail-open : simple diagnostic.
    }
  });
}
