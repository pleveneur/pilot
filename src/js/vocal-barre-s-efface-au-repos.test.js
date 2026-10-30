/**
 * Verrou de la remarque n° 5 du proprietaire (2026-11-03) : « la barre du bas ne
 * s'efface plus du tout, alors que c'etait le comportement attendu ».
 *
 * LE DEFAUT, et pourquoi il echoue ici s'il revient :
 *
 * Le mecanisme d'effacement n'a jamais ete casse — un seul minuteur, un seul
 * point d'ecriture de la classe, 2 500 ms. Ce qui bloquait le masquage, c'est la
 * REGLE 3 de `vocal-chrome.js` : l'etat « ecoute » ou « parole » interdit
 * l'effacement. Or, depuis le lot 3 (`9a8c2cf`), « ecoute » ne veut plus dire
 * « le micro est ouvert » mais « le micro CAPTE » — une MESURE de niveau ambiant.
 * La mesure est ouverte a l'entree du mode et jamais refermee
 * (`requestVocalMeasure("entree")`), sa descente d'hysteresis (0,03) est sous le
 * plancher de voix du projet (0,05) et le micro demande `autoGainControl` : le
 * plancher de bruit d'une piece silencieuse depasse donc le seuil de sortie,
 * l'etat ne revient jamais au repos, et la regle 3 retient le bas pendant toute
 * la session. Le decompte sonnait : il ne servait plus a rien.
 *
 * Le fait donne a la regle 3 est donc un FAIT D'USAGE (`vocalEtatQuiRetientLeBas`) :
 * « parole » retient toujours, « ecoute » seulement si la dictee ouverte a
 * reellement transcrit un mot, tout le reste vaut repos.
 *
 * Ce fichier echoue si :
 *  1. une mesure peut de nouveau retenir le bas (comportement de la fonction pure) ;
 *  2. `vocalSyncChrome` redonne l'etat BRUT au lieu du fait d'usage (mutation
 *     rejouee : `etat: vocalChromeEtat` fait echouer le test) ;
 *  3. un SECOND mecanisme apparait (deuxieme minuteur, deuxieme point d'ecriture
 *     de la classe, `localStorage`, nouveau reglage) ;
 *  4. les valeurs du mecanisme existant bougent (2 500 ms, 4 px, quatre gestes).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sliceSource } from "./source-slice.js";
import {
  VOCAL_CHROME_IDLE_MS,
  VOCAL_CHROME_MOVE_PX,
  VOCAL_CHROME_HIDDEN_CLASS,
  vocalChromeVisible,
  vocalEtatQuiRetientLeBas,
} from "./vocal-chrome.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUPER = readFileSync(resolve(ROOT, "src/js/super-agent.js"), "utf8").replace(/\r\n/g, "\n");

/** Le corps de `vocalSyncChrome`, decoupe VERIFIE (cf. `source-slice.js`). */
const SYNC = sliceSource(
  SUPER,
  "function vocalSyncChrome(state) {",
  "/**\n   * POINT D'ECRITURE UNIQUE de l'etat nu",
  400
);

describe("1. une MESURE ne peut plus retenir le bas (le defaut corrige)", () => {
  it("« ecoute » sans un seul mot transcrit vaut REPOS", () => {
    // Le cas exact du defaut : le micro mesure du bruit, aucun mot n'arrive.
    expect(
      vocalEtatQuiRetientLeBas({ etat: "listening", dicteeOuverte: true, motRecu: false })
    ).toBe("idle");
    // Dictee fermee et etat « ecoute » : incoherent, donc repos.
    expect(
      vocalEtatQuiRetientLeBas({ etat: "listening", dicteeOuverte: false, motRecu: true })
    ).toBe("idle");
    expect(vocalEtatQuiRetientLeBas({ etat: "listening" })).toBe("idle");
    expect(vocalEtatQuiRetientLeBas({})).toBe("idle");
  });

  it("« ecoute » AVEC un mot reellement transcrit retient le bas (usage reel)", () => {
    expect(
      vocalEtatQuiRetientLeBas({ etat: "listening", dicteeOuverte: true, motRecu: true })
    ).toBe("listening");
  });

  it("« parole » retient toujours : on doit pouvoir couper Pilot en pleine phrase", () => {
    expect(vocalEtatQuiRetientLeBas({ etat: "speaking" })).toBe("speaking");
    expect(vocalEtatQuiRetientLeBas({ etat: "speaking", motRecu: false })).toBe("speaking");
  });

  it("« reflexion » et « repos » ne retiennent rien", () => {
    expect(vocalEtatQuiRetientLeBas({ etat: "thinking" })).toBe("idle");
    expect(vocalEtatQuiRetientLeBas({ etat: "idle" })).toBe("idle");
  });

  it("un etat de repos laisse la decision pure effacer le bas", () => {
    // La regle 3 ne se declenche pas ; les quatre autres faits sont au repos.
    expect(
      vocalChromeVisible({
        etat: "idle",
        question: false,
        saisie: false,
        micFerme: "",
        pointeurActif: false,
        pointeurGeste: false,
      })
    ).toBe(false);
  });
});

describe("2. le fait donne a la regle 3 est le fait d'usage, jamais l'etat brut", () => {
  it("`vocalSyncChrome` passe par `vocalEtatQuiRetientLeBas`", () => {
    expect(SYNC).toContain("etat: vocalEtatQuiRetientLeBas({");
    expect(SYNC).toContain("dicteeOuverte: voiceActive === true");
    expect(SYNC).toContain("motRecu: vocalMotRecu === true");
  });

  it("l'etat de l'ecran n'est plus donne tel quel (c'est CE motif qui ramenait le defaut)", () => {
    // Le fait EXTERIEUR (indente de six espaces, au premier niveau de `faits`).
    const ligne = SYNC.match(/^ {6}etat: (.+)$/m);
    expect(ligne, "aucun fait `etat` au premier niveau de `faits`").not.toBeNull();
    // Mutation rejouee : `etat: vocalChromeEtat,` a la place du fait d'usage
    // => cette assertion echoue, et le defaut est signale.
    expect(ligne[1].trim()).toBe("vocalEtatQuiRetientLeBas({");
  });
});

describe("3. aucun second mecanisme d'effacement n'a ete ajoute", () => {
  it("un seul minuteur, un seul point d'ecriture de la classe", () => {
    expect(SUPER.match(/classList\.toggle\(VOCAL_CHROME_HIDDEN_CLASS/g) || []).toHaveLength(1);
    expect(SUPER).toContain("const classe = vocalChromeClass(visible);");
    // Un seul `setTimeout` arme le decompte du bas.
    expect(SUPER.match(/vocalChromeTimer = setTimeout\(/g) || []).toHaveLength(1);
  });

  it("aucune memoire locale, aucun nouveau reglage pour la barre", () => {
    expect(SYNC.toLowerCase()).not.toContain("localstorage");
    expect(SYNC.toLowerCase()).not.toContain("sessionstorage");
    expect(SYNC).not.toMatch(/set_config|get_config|pilot_/);
  });

  it("les valeurs du mecanisme existant n'ont pas bouge", () => {
    expect(VOCAL_CHROME_IDLE_MS).toBe(2500);
    expect(VOCAL_CHROME_MOVE_PX).toBe(4);
    expect(VOCAL_CHROME_HIDDEN_CLASS).toBe("vocal-chrome-hidden");
  });

  it("le defaut ne peut pas revenir par un `!vocalBare` dans l'expression de visibilite", () => {
    const expression = sliceSource(SYNC, "const visible = ", ";", 20);
    expect(expression).toContain("vocalChromeTimer !== 0");
    expect(expression).toContain("vocalChromeVisible(faits)");
    // La zone de saisie ne depend pas de l'etat nu (precision du 2026-11-01) et
    // l'etat nu ne peut pas ETENDRE une retenue : il l'ajoute, il ne la remplace pas.
    expect(expression).not.toMatch(/!\s*vocalBare/);
  });
});
