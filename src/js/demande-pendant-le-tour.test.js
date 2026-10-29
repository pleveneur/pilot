// Tests — UNE DEMANDE ARRIVÉE PENDANT UN TRAVAIL N'EST JAMAIS PERDUE
// (correctif « le mode vocal ne répond plus quand l'assistante travaille »)
//
// DÉFAUT SIGNALÉ PAR LE PROPRIÉTAIRE : « quand l'assistante travaille, le mode
// vocal ne fonctionne plus ; j'ai dû relancer mon onglet ».
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. La décision (PURE) : une demande n'est JAMAIS refusée parce qu'un travail
//      est en cours — elle est ENFILÉE, avec un accusé immédiat. L'ordre des
//      règles est testé tel quel (texte vide, moteur libre, moteur occupé, file
//      pleine).
//   2. L'ACCUSÉ est IMMÉDIAT et il est écrit aux deux endroits qui existent :
//      la conversation et l'UNIQUE ligne d'état de l'écran Vocal. En mode Vocal,
//      la conversation n'est pas affichée : sans la ligne d'état, l'utilisateur
//      parlerait devant un écran muet (c'était le symptôme).
//   3. La file est BORNÉE et FIFO : `prendreDemandeEnAttente` rend toujours la
//      plus ancienne, ne rend rien tant que le moteur travaille, et ne perd
//      jamais une demande.
//   4. Le BRANCHEMENT (sur le source, fins de ligne normalisées) : `send` ne
//      refuse plus pendant un tour, la fin de tour VIDE la file, l'arrêt du
//      micro n'est plus refusé pendant un tour, et le blocage définitif
//      (`isStreaming` resté collé) est dénoué par l'état du MOTEUR — jamais par
//      un délai choisi.
//   5. Aucun second envoi : la file repart par le chemin d'envoi EXISTANT
//      (`send`), et par lui seul.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";

import {
  DEMANDE_ENFILER,
  DEMANDE_ENVOYER,
  DEMANDE_REFUSEE,
  DEMANDES_EN_ATTENTE_MAX,
  MESSAGE_DEMANDE_ACCUSEE,
  MESSAGE_DEMANDE_FILE_PLEINE,
  VOCAL_MESSAGE_DEMANDE_ACCUSEE,
  decideDemandePendantLeTour,
  prendreDemandeEnAttente,
} from "./demande-pendant-le-tour.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
// Le source peut arriver en CRLF (runner Windows) : `lire` normalise AVANT toute
// recherche d'ancre multi-lignes (quality-gate 3.4).
const SUPER = lire("src/js/super-agent.js");
const MODULE = lire("src/js/demande-pendant-le-tour.js");
const VOCAL = lire("src/js/vocal-conversation.js");

/** Corps d'une fonction (ancre de fin : la fermeture en colonne 2). */
function corpsFonction(src, entete) {
  return sliceSource(src, entete, "\n  }\n", 40);
}

// ── 1. La décision : accusé immédiat puis file, jamais un refus muet ──────
describe("1. la décision pure : moteur occupé ⇒ ENFILER, jamais refuser", () => {
  it("moteur LIBRE : la demande part par le chemin d'envoi existant", () => {
    const d = decideDemandePendantLeTour({ texte: "fais ceci", occupe: false, enAttente: 0 });
    expect(d.action).toBe(DEMANDE_ENVOYER);
    expect(d.raison).toBe("moteur-libre");
  });

  it("moteur OCCUPÉ : la demande est ENFILÉE (c'était le refus muet)", () => {
    for (const enAttente of [0, 1, DEMANDES_EN_ATTENTE_MAX - 1]) {
      const d = decideDemandePendantLeTour({ texte: "fais ceci", occupe: true, enAttente });
      expect(d.action, String(enAttente)).toBe(DEMANDE_ENFILER);
      expect(d.raison).toBe("tour-en-cours");
      // Le rang est celui de la file AVANT ajout : premier arrivé, premier servi.
      expect(d.place).toBe(enAttente);
    }
  });

  it("texte vide : rien à envoyer, rien à accuser", () => {
    for (const texte of ["", "   ", "\n\t", undefined, null, 42]) {
      const d = decideDemandePendantLeTour({ texte, occupe: true });
      expect(d.action, String(texte)).toBe(DEMANDE_REFUSEE);
      expect(d.raison).toBe("sans-texte");
    }
  });

  it("file PLEINE : refus EXPLICITE (jamais muet), le texte reste dans la zone", () => {
    const d = decideDemandePendantLeTour({
      texte: "encore une",
      occupe: true,
      enAttente: DEMANDES_EN_ATTENTE_MAX,
    });
    expect(d.action).toBe(DEMANDE_REFUSEE);
    expect(d.raison).toBe("file-pleine");
    expect(MESSAGE_DEMANDE_FILE_PLEINE).toContain(String(DEMANDES_EN_ATTENTE_MAX));
  });

  it("entrées absentes ou invalides : jamais une exception", () => {
    expect(decideDemandePendantLeTour().action).toBe(DEMANDE_REFUSEE);
    expect(decideDemandePendantLeTour(undefined).raison).toBe("sans-texte");
    expect(decideDemandePendantLeTour({ texte: "ok", occupe: true, enAttente: "2" }).place).toBe(2);
    expect(decideDemandePendantLeTour({ texte: "ok", occupe: true, enAttente: -3 }).place).toBe(0);
    expect(decideDemandePendantLeTour({ texte: "ok", occupe: true, enAttente: NaN }).place).toBe(0);
  });

  it("la file est BORNÉE et positive", () => {
    expect(DEMANDES_EN_ATTENTE_MAX).toBeGreaterThan(0);
    expect(Number.isInteger(DEMANDES_EN_ATTENTE_MAX)).toBe(true);
  });
});

// ── 2. L'accusé : une phrase, aux deux endroits qui existent déjà ─────────
describe("2. l'accusé est immédiat et visible dans l'écran Vocal", () => {
  it("deux phrases distinctes, aucune vide, aucune ne promet un délai", () => {
    for (const m of [MESSAGE_DEMANDE_ACCUSEE, VOCAL_MESSAGE_DEMANDE_ACCUSEE]) {
      expect(typeof m).toBe("string");
      expect(m.trim().length).toBeGreaterThan(10);
      // Aucune promesse chiffrée : la demande part à la FIN DU TOUR, pas « dans
      // N secondes » (aucun délai ne doit être annoncé, donc aucun n'est subi).
      expect(m).not.toMatch(/\bsecondes?\b|\bminutes?\b|\bms\b/i);
    }
    expect(MESSAGE_DEMANDE_ACCUSEE).not.toBe(VOCAL_MESSAGE_DEMANDE_ACCUSEE);
  });

  it("la ligne d'état du mode Vocal dit l'accusé AVANT tout le reste", () => {
    const ligne = corpsFonction(SUPER, "function vocalStatusLine(state)");
    const iAccuse = ligne.indexOf("VOCAL_MESSAGE_DEMANDE_ACCUSEE");
    const iEtat = ligne.indexOf("vocalStatusText(state)");
    expect(iAccuse).toBeGreaterThan(-1);
    expect(iEtat).toBeGreaterThan(-1);
    // L'accusé passe AVANT les quatre phrases d'état : c'est la seule chose que
    // l'utilisateur doit savoir à cet instant.
    expect(iAccuse).toBeLessThan(iEtat);
    expect(ligne).toMatch(/demandesEnAttente\.length > 0/);
  });

  it("l'accusé est écrit dans la conversation ET rafraîchit l'écran Vocal", () => {
    const enfiler = corpsFonction(SUPER, "function enfilerDemande(text)");
    expect(enfiler).toContain("MESSAGE_DEMANDE_ACCUSEE");
    expect(enfiler).toContain("applyVocalState();");
    // Une seule fois, et dans l'ordre reçu.
    expect((enfiler.match(/appendSystemMessage\(/g) || [])).toHaveLength(1);
    expect(enfiler).toContain("...demandesEnAttente");
  });
});

// ── 3. La file : FIFO, bornée, jamais perdue ──────────────────────────────
describe("3. la file : premier arrivé, premier servi, jamais une demande perdue", () => {
  it("rend la PLUS ANCIENNE et laisse le reste dans l'ordre", () => {
    const r = prendreDemandeEnAttente(["a", "b", "c"], false);
    expect(r.texte).toBe("a");
    expect(r.reste).toEqual(["b", "c"]);
  });

  it("ne rend RIEN tant que le moteur travaille", () => {
    const file = ["a", "b"];
    const r = prendreDemandeEnAttente(file, true);
    expect(r.texte).toBeNull();
    expect(r.reste).toEqual(file);
  });

  it("file vide, entrées invalides : rien à envoyer, jamais une exception", () => {
    expect(prendreDemandeEnAttente([], false).texte).toBeNull();
    expect(prendreDemandeEnAttente().texte).toBeNull();
    expect(prendreDemandeEnAttente(null, false).texte).toBeNull();
    expect(prendreDemandeEnAttente(["", null, "ok"], false)).toEqual({ texte: "ok", reste: [] });
  });

  it("le module reste PUR : aucune horloge, aucun envoi, aucun DOM", () => {
    expect(MODULE).not.toMatch(/setTimeout|setInterval|Date\.now|requestAnimationFrame/);
    expect(MODULE).not.toMatch(/document\.|window\.|invoke\(/);
    expect(MODULE).not.toMatch(/^\s+(?:void\s+)?send\(/m);
  });
});

// ── 4. Le branchement réel (source) ────────────────────────────────────────
describe("4. le branchement : plus aucun refus muet pendant un tour", () => {
  it("`send` ne refuse plus une demande pendant un tour : elle est ENFILÉE", () => {
    const send = corpsFonction(SUPER, "async function send()");
    expect(send).toContain("decideDemandePendantLeTour(");
    expect(send).toContain("enfilerDemande(text);");
    // L'ancienne garde muette a disparu du chemin d'envoi.
    expect(send).not.toContain('statusEl.textContent = "⏳ Occupé…"');
    // Rien n'est effacé : l'accusé part et la demande est prise en charge.
    expect(send).toContain("if (decisionDemande.action === DEMANDE_ENFILER)");
  });

  it("la fin de tour VIDE la file (et n'envoie pas deux voix à la fois)", () => {
    const onEnd = sliceSource(
      SUPER,
      "        superLoopBuffer = \"\";",
      "        const demandePartie = flushDemandesEnAttente();",
      200
    );
    expect(onEnd).toContain("flushPendingSuperAgentReports()");
    // La lecture à voix haute est SAUTÉE si une demande vient de partir : deux
    // voix ne doivent pas se chevaucher.
    expect(SUPER).toContain("if (!demandePartie) autoReadVocalReply();");
  });

  it("la file est vidée par le SEUL chemin d'envoi existant", () => {
    const flush = corpsFonction(SUPER, "function flushDemandesEnAttente(forcer = false)");
    expect(flush).toContain("prendreDemandeEnAttente(");
    // Un seul envoi, et c'est `send` — aucun second mécanisme.
    expect((flush.match(/send\(\)/g) || [])).toHaveLength(1);
    expect(flush).toContain("void send();");
    expect(flush).not.toMatch(/invoke\(/);
    // Le texte repart par la ZONE DE SAISIE : `send` y lit la demande.
    expect(flush).toContain("inputEl.value = texte;");
    // Le brouillon de l'utilisateur n'est jamais écrasé.
    expect(flush).toContain("const brouillon = inputEl.value;");
    expect(flush).toContain("inputEl.value = brouillon;");
  });

  it("le micro n'est plus refusé pendant un tour (« patiente la fin »)", () => {
    const toggle = corpsFonction(SUPER, "function toggleVoiceInput()");
    expect(toggle).not.toContain("patiente la fin pour dicter");
    expect(toggle).not.toContain("if (isStreaming)");
  });

  it("un blocage définitif est dénoué par l'état du MOTEUR, jamais par un délai", () => {
    const sonde = sliceSource(
      SUPER,
      "      const processing = alive",
      "      // Filet périodique",
      2000
    );
    expect(sonde).toContain("if (isStreaming && tourEnCoursVu && demandesEnAttente.length > 0)");
    expect(sonde).toContain("flushDemandesEnAttente(true)");
    // `tourEnCoursVu` n'est armé QUE si la sonde a vu le moteur en traitement :
    // une simple latence juste après un envoi ne peut pas faire partir une
    // seconde demande par-dessus la première.
    expect(sonde).toContain("if (demandesEnAttente.length > 0) tourEnCoursVu = true;");
    // Aucun minuteur n'est introduit pour « laisser le temps ».
    expect(flushTimeoutAbsent()).toBe(true);
  });

  function flushTimeoutAbsent() {
    const flush = corpsFonction(SUPER, "function flushDemandesEnAttente(forcer = false)");
    return !/setTimeout|setInterval/.test(flush);
  }
});

// ── 5. Le mode vocal ne se ferme plus pendant un tour ─────────────────────
describe("5. l'écran Vocal reste ouvert pendant une tâche longue", () => {
  it("la règle « le tour en cours prime » a disparu de la décision de dictée", () => {
    // Le désarmement « tour-en-cours » n'existe plus nulle part dans le module :
    // ce n'est pas une règle assouplie, c'est une règle REMPLACÉE (accusé + file).
    expect(VOCAL).not.toMatch(/raison: "tour-en-cours", delai: 0/);
    expect(VOCAL).not.toMatch(/return annuler\("tour-en-cours"\)/);
  });

  it("l'écran affiche l'accusé là où l'utilisateur regarde", () => {
    // En mode Vocal, la conversation n'est pas affichée : si l'accusé n'était que
    // dans la conversation, l'écran resterait muet — le symptôme exact.
    const applique = corpsFonction(SUPER, "function applyVocalState()");
    expect(applique).toContain("vocalStatusLine(");
    expect(corpsFonction(SUPER, "function vocalStatusLine(state)")).toContain(
      "VOCAL_MESSAGE_DEMANDE_ACCUSEE"
    );
  });
});
