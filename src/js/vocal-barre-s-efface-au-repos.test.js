/**
 * Verrou de la remarque n° 5 du proprietaire (2026-11-03) : « la barre du bas ne
 * s'efface plus du tout, alors que c'etait le comportement attendu » — et de sa
 * decision ferme du 2026-11-13 : « elle doit s'effacer apres 2,5 s de repos, QUOI
 * QU'IL ARRIVE ; seules deux raisons la retiennent : du texte dans le champ, le
 * pointeur sur la zone du bas ».
 *
 * LES DEUX DEFAUTS EMPILES, et pourquoi ils echouent ici s'ils reviennent :
 *
 * 1. Le mecanisme d'effacement n'a jamais ete casse — un seul minuteur, un seul
 *    point d'ecriture de la classe, 2 500 ms. Ce qui bloquait le masquage, c'est la
 *    REGLE 3 de `vocal-chrome.js` : l'etat « ecoute » ou « parole » interdisait
 *    l'effacement. Or, depuis le lot 3 (`9a8c2cf`), « ecoute » ne veut plus dire
 *    « le micro est ouvert » mais « le micro CAPTE » — une MESURE de niveau
 *    ambiant. La mesure est ouverte a l'entree du mode et jamais refermee
 *    (`requestVocalMeasure("entree")`), sa descente d'hysteresis (0,03) est sous
 *    le plancher de voix du projet (0,05) et le micro demande `autoGainControl` :
 *    le plancher de bruit d'une piece silencieuse depasse donc le seuil de
 *    sortie, l'etat ne revient jamais au repos, et la regle 3 retenait le bas
 *    pendant toute la session. Le premier correctif a remplace la mesure par un
 *    fait d'usage (`vocalEtatQuiRetientLeBas`) ; la decision du 2026-11-13 est
 *    allee au bout : la regle 3 est SUPPRIMEE, avec son fait d'usage.
 * 2. Pendant que Pilot lit une reponse — cas nominal et long —, la barre restait
 *    de nouveau allumee « parce qu'il parle ». Meme cause, meme remede : la
 *    parole n'est pas une raison.
 *
 * Ce fichier echoue si :
 *  1. un etat de conversation ou une MESURE peut retenir le bas (decision pure) ;
 *  2. `vocalSyncChrome` redonne un etat a la decision (mutation rejouee :
 *     `etat: vocalChromeEtat` fait echouer le test) ;
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

describe("1. NI une MESURE ni un etat de conversation ne retiennent le bas", () => {
  it("« ecoute » ne retient plus le bas, MEME quand la dictee a transcrit un mot", () => {
    // Le cas exact du premier defaut : le micro mesure du bruit, aucun mot
    // n'arrive. Puis le cas extreme : la dictee fonctionne vraiment. Dans les
    // deux cas la barre doit s'effacer — la decision ne lit plus aucun etat.
    const repos = { saisie: false, micFerme: "", pointeurActif: false, pointeurGeste: false, question: false };
    expect(vocalChromeVisible({ ...repos, etat: "listening" })).toBe(false);
    expect(
      vocalChromeVisible({ ...repos, etat: "listening", dicteeOuverte: true, motRecu: false })
    ).toBe(false);
    expect(
      vocalChromeVisible({ ...repos, etat: "listening", dicteeOuverte: true, motRecu: true })
    ).toBe(false);
  });

  it("« parole » ne retient plus le bas : on peut lire sans que la barre reste a l'ecran", () => {
    // Deuxieme defaut : une lecture longue laissait la barre allumee sans fin.
    expect(vocalChromeVisible({ etat: "speaking" })).toBe(false);
    expect(vocalChromeVisible({ etat: "speaking", saisie: false, micFerme: "", pointeurActif: false })).toBe(
      false
    );
  });

  it("la fonction `vocalEtatQuiRetientLeBas` n'existe plus (elle ne servait qu'a la regle 3)", () => {
    // La garder aurait laisse un chemin par lequel un etat peut revenir dans la
    // decision « pour la lisibilite ». Le module ne l'exporte plus.
    const module = readFileSync(resolve(ROOT, "src/js/vocal-chrome.js"), "utf8");
    expect(module).not.toContain("vocalEtatQuiRetientLeBas");
  });

  it("le repos, champ vide et pointeur ailleurs : la decision pure efface le bas", () => {
    // Aucune des deux raisons d'usage n'est la : le masquage est permis.
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

describe("2. `vocalSyncChrome` ne donne plus AUCUN etat a la decision", () => {
  it("aucun fait `etat` n'est transmis (c'est CE motif qui ramenait le defaut)", () => {
    // Mutation rejouee : rajouter `etat: vocalChromeEtat,` (ou le fait d'usage
    // `vocalEtatQuiRetientLeBas(...)`) fait echouer cette assertion.
    expect(SYNC).not.toMatch(/\betat:/);
    expect(SYNC).not.toContain("vocalEtatQuiRetientLeBas");
    // `vocalChromeEtat` reste la MEMOIRE du dernier etat applique (l'appel
    // `vocalSyncChrome(state)` vient de `applyVocalState`, et d'autres appels le
    // font sans argument) : ce n'est pas un probleme tant qu'il n'entre pas dans
    // `faits` — c'est exactement ce que verifie la premiere assertion.
  });

  it("les deux raisons d'usage, elles, sont bien transmises", () => {
    expect(SYNC).toMatch(/saisie:\s*texte\.trim\(\) !== ""/);
    expect(SYNC).toMatch(/pointeurActif:\s*vocalChromePointeurSurLeBas\(\)/);
    expect(SYNC).toMatch(/pointeurGeste:\s*vocalChromeGestePointeur === true/);
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
