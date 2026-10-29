// Tests — LA DICTÉE DE L'ÉCRAN VOCAL SE RÉARME TOUJOURS (un silence n'est pas
// une panne)
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) — défaut signalé par le
// propriétaire : « En mode vocal, à un moment donné, le micro est coupé. […]
// quand je parle, ça détecte bien ma voix, mais ça dit "la dictée vocale n'a pas
// fonctionné". J'active le micro et ça refonctionne, mais le micro se désactive
// ensuite. »
//
// CAUSE (voir docs/rapports/RAPPORT-dictee-vocale-coupee.md) : le plafond des
// sessions vides comptait TOUTE fin d'écoute vide — donc aussi le SILENCE
// ordinaire, que le moteur de reconnaissance termine lui-même toutes les
// quelques secondes. Trois silences en 30 s suspendaient l'écoute pour de bon,
// et la ligne d'état annonçait alors un échec alors que le son était capté.
//
//   1. Une fin de SILENCE d'une durée réelle n'alimente plus le plafond : elle
//      se réarme, comme n'importe quelle fin de session.
//   2. Un silence ne produit AUCUN message d'échec (le message reste réservé aux
//      vraies pannes, une phrase par panne).
//   3. La boucle INSTANTANÉE (le moteur rend la main en moins d'une seconde, sans
//      rien transcrire) reste arrêtée par le plafond : correctif précédent
//      intact, non-régression.
//   4. Rien ne s'arme hors du mode Vocal, et jamais deux sessions ni deux
//      minuteries à la fois.
//   5. Le branchement est vérifié sur le source (durée MESURÉE à la fin
//      d'écoute, transmise au seul compteur, historique remis à zéro par une
//      vraie écoute) — fins de ligne normalisées (quality-gate 3.4).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";

import {
  VOICE_EMPTY_SESSION_INSTANT_MS,
  VOICE_END_EMPTY,
  VOICE_END_NO_SESSION,
  VOICE_END_SEND,
  VOICE_END_USER_TAKEOVER,
  isSilentEmptyVoiceEnd,
} from "./voice-auto-send.js";
import {
  VOCAL_ARM_DELAY_MS,
  VOCAL_DICTATION_ARM,
  VOCAL_DICTATION_DISARM,
  VOCAL_DICTATION_HOLD,
  VOCAL_EMPTY_SESSION_LIMIT,
  VOCAL_EMPTY_SESSION_WINDOW_MS,
  VOCAL_MESSAGE_DICTEE_ECHEC,
  VOCAL_MESSAGE_MIC_OCCUPE,
  VOCAL_MESSAGE_MIC_REFUSE,
  VOCAL_MESSAGE_RESEAU,
  VOCAL_MESSAGE_SANS_DICTEE,
  VOCAL_MESSAGE_SENSIBLE,
  decideVocalDictation,
  noteEmptyVocalSession,
  planVocalConversation,
  vocalDictationMessage,
} from "./vocal-conversation.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (nom) => readFileSync(join(ICI, nom), "utf8").replace(/\r\n/g, "\n");
// Les commentaires (ligne `//` ET blocs JSDoc) sont retirés : aucun verrou ne
// doit être satisfait par sa propre prose.
const sansCommentaires = (src) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*");
    })
    .join("\n");
const SUPER = sansCommentaires(lire("super-agent.js"));
const AUTO = sansCommentaires(lire("voice-auto-send.js"));

/** État de repos complet de l'écran Vocal (tout est ouvert, rien ne bloque). */
const REPOS = {
  modeOuvert: true,
  projetSensible: false,
  pilotParle: false,
  reflechit: false,
  occupe: false,
  dicteeOuverte: false,
  arretManuel: false,
  sessionsVides: false,
  erreur: "",
  transcription: true,
  apresLecture: false,
  sensibiliteConnue: true,
  sensibiliteIndisponible: false,
  mesureOuverte: true,
};

/** Joue N fins d'écoute comme le fait `onend`, en passant par le module pur. */
function jouerFins(fins, t0 = 1_700_000_000_000) {
  let historique = [];
  let suspendu = false;
  fins.forEach((fin, i) => {
    if (!isSilentEmptyVoiceEnd(fin.fin, fin.contexte)) return;
    const r = noteEmptyVocalSession(historique, t0 + i * fin.espaceMs);
    historique = r.sessions;
    suspendu = r.suspendu;
  });
  return { historique, suspendu };
}

// ── 1. Le silence n'alimente plus le plafond ────────────────────────────────
describe("1. une fin de SILENCE d'une durée réelle n'est pas une panne", () => {
  it("le seuil est une MESURE (une seconde), pas un réglage", () => {
    expect(VOICE_EMPTY_SESSION_INSTANT_MS).toBe(1000);
    // Aucun champ de configuration, aucun curseur : c'est une mesure interne.
    expect(AUTO).not.toMatch(/localStorage|invoke\(|get_config/);
  });

  it("une session qui a écouté plusieurs secondes ne compte jamais", () => {
    for (const dureeMs of [1000, 2500, 6000, 60_000]) {
      expect(
        isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "" }, { dureeMs }),
        `duree ${dureeMs}`,
      ).toBe(false);
      expect(
        isSilentEmptyVoiceEnd({ reason: VOICE_END_EMPTY, dictatedText: "" }, { dureeMs }),
        `duree ${dureeMs}`,
      ).toBe(false);
    }
  });

  it("un retour INSTANTANÉ du moteur compte toujours (la boucle à arrêter)", () => {
    for (const dureeMs of [0, 1, 200, 999]) {
      expect(
        isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "" }, { dureeMs }),
        `duree ${dureeMs}`,
      ).toBe(true);
    }
  });

  it("durée absente ou illisible : comportement historique (la fin compte)", () => {
    expect(isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "" })).toBe(true);
    expect(
      isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "" }, { dureeMs: "abc" }),
    ).toBe(true);
    expect(
      isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "" }, { dureeMs: NaN }),
    ).toBe(true);
    expect(
      isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "" }, null),
    ).toBe(true);
  });

  it("les autres refus restent intacts (erreur affichée, arrêt demandé, texte, reprise en main)", () => {
    // Une durée RÉELLE ne doit pas ressusciter une fin qui était déjà exclue.
    expect(
      isSilentEmptyVoiceEnd(
        { reason: VOICE_END_NO_SESSION, dictatedText: "" },
        { dureeMs: 100, erreurAffichee: true },
      ),
    ).toBe(false);
    expect(
      isSilentEmptyVoiceEnd(
        { reason: VOICE_END_NO_SESSION, dictatedText: "" },
        { dureeMs: 100, arretDemande: true },
      ),
    ).toBe(false);
    expect(
      isSilentEmptyVoiceEnd({ reason: VOICE_END_SEND, dictatedText: "bonjour" }, { dureeMs: 100 }),
    ).toBe(false);
    expect(
      isSilentEmptyVoiceEnd({ reason: VOICE_END_USER_TAKEOVER, dictatedText: "" }, { dureeMs: 100 }),
    ).toBe(false);
    expect(isSilentEmptyVoiceEnd(null, { dureeMs: 100 })).toBe(false);
  });
});

// ── 2. Réarmement après une fin normale ────────────────────────────────────
describe("2. après une fin normale, la dictée se réarme (le défaut corrigé)", () => {
  it("dix fins de silence d'affilée ne suspendent rien et la décision ARME", () => {
    const silence = { fin: { reason: VOICE_END_NO_SESSION, dictatedText: "" }, contexte: { dureeMs: 7000 }, espaceMs: 7000 };
    const { suspendu } = jouerFins(new Array(10).fill(silence));
    expect(suspendu).toBe(false);
    const d = decideVocalDictation({ ...REPOS, sessionsVides: suspendu });
    expect(d.action).toBe(VOCAL_DICTATION_ARM);
    // Les temporisations existantes sont respectées : rien de nouveau.
    expect(d.delai).toBe(VOCAL_ARM_DELAY_MS);
  });

  it("les fins NORMALES ET VIDES d'une vraie écoute ne suspendent rien non plus", () => {
    const normale = { fin: { reason: VOICE_END_EMPTY, dictatedText: "" }, contexte: { dureeMs: 3000 }, espaceMs: 3000 };
    const { suspendu } = jouerFins(new Array(6).fill(normale));
    expect(suspendu).toBe(false);
    expect(decideVocalDictation({ ...REPOS, sessionsVides: suspendu }).action).toBe(
      VOCAL_DICTATION_ARM,
    );
  });

  it("le plan d'application ne fait que programmer l'armement (rien à fermer)", () => {
    const plan = planVocalConversation(REPOS, { dicteeOuverte: false, minuteur: false });
    expect(plan.desarmer).toBe(false);
    expect(plan.couper).toBe(false);
    expect(plan.delai).toBe(VOCAL_ARM_DELAY_MS);
  });
});

// ── 3. Aucun message pour une fin normale ──────────────────────────────────
describe("3. un silence ne s'annonce jamais comme un échec", () => {
  it("`no-speech` et `aborted` ne disent rien", () => {
    expect(vocalDictationMessage("no-speech")).toBe("");
    expect(vocalDictationMessage("aborted")).toBe("");
    expect(vocalDictationMessage("")).toBe("");
    expect(vocalDictationMessage("no-speech")).not.toBe(VOCAL_MESSAGE_DICTEE_ECHEC);
  });

  it("la phrase d'échec n'est produite que par un vrai code d'échec", () => {
    // Une panne RÉELLE garde sa phrase (une seule, jamais deux).
    expect(vocalDictationMessage("not-allowed")).toBe(VOCAL_MESSAGE_MIC_REFUSE);
    expect(vocalDictationMessage("service-not-allowed")).toBe(VOCAL_MESSAGE_MIC_REFUSE);
    expect(vocalDictationMessage("audio-capture")).toBe(VOCAL_MESSAGE_MIC_OCCUPE);
    expect(vocalDictationMessage("network")).toBe(VOCAL_MESSAGE_RESEAU);
    expect(vocalDictationMessage("projet-sensible")).toBe(VOCAL_MESSAGE_SENSIBLE);
    expect(vocalDictationMessage("sans-transcription")).toBe(VOCAL_MESSAGE_SANS_DICTEE);
    expect(vocalDictationMessage("autre-chose")).toBe(VOCAL_MESSAGE_DICTEE_ECHEC);
  });

  it("une erreur qui n'a pas de phrase n'écrit rien dans la ligne d'état", () => {
    // `reportVoiceFailure` sort AVANT toute écriture quand il n'y a pas de texte :
    // une fin de silence (`no-speech`, `aborted` → "") ne peut donc pas allumer
    // « La dictée n'a pas fonctionné ».
    const corps = sliceSource(SUPER, "function reportVoiceFailure", "\n  }\n", 40);
    expect(corps).toMatch(/if \(!texte\) return;/);
    // Un seul point d'écriture de la ligne d'état (`.vocal-status`) : le
    // sélecteur n'est écrit qu'UNE fois dans tout le fichier, dans l'accesseur
    // `vocalStatusNode` (l'autre usage — la géométrie du bas — passe par lui).
    expect((SUPER.match(/\.vocal-status/g) || []).length).toBe(1);
    const accesseur = sliceSource(SUPER, "function vocalStatusNode", "\n  }\n", 40);
    expect(accesseur).toContain('querySelector(".vocal-status")');
    // Et le texte de cette ligne n'est affecté qu'à UN seul endroit.
    expect((SUPER.match(/ligne\.textContent\s*=/g) || []).length).toBe(1);
    // `reportVoiceFailure` n'écrit jamais le texte lui-même : il passe par l'état.
    expect(corps).not.toMatch(/textContent/);
  });

  it("le plafond ne peut plus être atteint par un silence (donc plus de message)", () => {
    // Trois silences d'une durée réelle, dans la fenêtre de 30 s : aucun verrou.
    const silence = { fin: { reason: VOICE_END_NO_SESSION, dictatedText: "" }, contexte: { dureeMs: 5000 }, espaceMs: 1000 };
    const { suspendu } = jouerFins(new Array(VOCAL_EMPTY_SESSION_LIMIT).fill(silence));
    expect(suspendu).toBe(false);
    const decision = decideVocalDictation({ ...REPOS, sessionsVides: suspendu });
    expect(decision.raison).not.toBe("sessions-vides");
    // La phrase d'échec reste celle du verrou INSTANTANÉ, pas du silence.
    expect(VOCAL_MESSAGE_DICTEE_ECHEC).toContain("écrivez votre demande");
  });
});

// ── 4. La boucle instantanée reste arrêtée (non-régression) ────────────────
describe("4. la boucle INSTANTANÉE reste arrêtée (correctif précédent intact)", () => {
  it("trois retours instantanés en 30 s suspendent encore l'armement", () => {
    const instant = { fin: { reason: VOICE_END_NO_SESSION, dictatedText: "" }, contexte: { dureeMs: 120 }, espaceMs: 500 };
    const { suspendu, historique } = jouerFins(
      new Array(VOCAL_EMPTY_SESSION_LIMIT).fill(instant),
    );
    expect(suspendu).toBe(true);
    expect(historique).toHaveLength(VOCAL_EMPTY_SESSION_LIMIT);
    const d = decideVocalDictation({ ...REPOS, sessionsVides: true });
    expect(d.action).toBe(VOCAL_DICTATION_HOLD);
    expect(d.raison).toBe("sessions-vides");
  });

  it("les seuils existants ne bougent pas", () => {
    expect(VOCAL_EMPTY_SESSION_LIMIT).toBe(3);
    expect(VOCAL_EMPTY_SESSION_WINDOW_MS).toBe(30_000);
  });

  it("un geste 🎙️ lève le verrou (seul chemin de reprise, comportement inchangé)", () => {
    const geste = sliceSource(SUPER, "function toggleVoiceInput", "\n  }\n", 40);
    expect(geste).toMatch(/vocalSessionsVides = \[\];/);
    expect(geste).toMatch(/vocalDicteeSuspendue = false;/);
  });
});

// ── 5. Aucun réarmement hors du mode, jamais deux sessions ─────────────────
describe("5. hors du mode Vocal rien ne s'arme, et jamais deux sessions", () => {
  it("hors du mode : la décision refuse et le compteur ne compte rien", () => {
    const d = decideVocalDictation({ ...REPOS, modeOuvert: false });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("hors-mode");
    const compte = sliceSource(SUPER, "function vocalNoteEmptySession", "\n  }\n", 40);
    expect(compte).toMatch(/if \(!vocalOverlay\) return;/);
  });

  it("une dictée déjà ouverte n'est jamais rouverte (idempotence)", () => {
    const d = decideVocalDictation({ ...REPOS, dicteeOuverte: true });
    expect(d.action).toBe(VOCAL_DICTATION_HOLD);
    expect(d.raison).toBe("deja-ouverte");
    const plan = planVocalConversation({ ...REPOS, dicteeOuverte: true }, { dicteeOuverte: true, minuteur: false });
    expect(plan.desarmer).toBe(false);
    expect(plan.delai).toBe(0);
  });

  it("une seule voie de démarrage, une seule session, un seul minuteur d'armement", () => {
    // `new SR()` n'existe qu'une fois, et une session ouverte n'est pas rouverte.
    expect((SUPER.match(/new SR\(\)/g) || []).length).toBe(1);
    const demarrage = sliceSource(SUPER, "function startVoiceInput", "\n  }\n", 40);
    expect(demarrage).toMatch(/if \(voiceActive\) return true;/);
    // Un seul minuteur d'armement dans tout l'écran.
    expect((SUPER.match(/vocalArmTimer = setTimeout\(/g) || []).length).toBe(1);
  });
});

// ── 6. Le branchement de la durée (source vérifiée) ────────────────────────
describe("6. la durée est MESURÉE à la fin d'écoute et transmise au seul compteur", () => {
  it("la session note son début, une seule fois", () => {
    expect((SUPER.match(/const debutSession = Date\.now\(\);/g) || []).length).toBe(1);
  });

  it("`onend` passe la durée MESURÉE au compteur, avec le contexte existant", () => {
    const fin = sliceSource(SUPER, "const fin = applyVoiceEnd({", "applyVocalState();", 80);
    expect(fin).toMatch(/vocalNoteEmptySession\(fin, \{/);
    expect(fin).toMatch(/erreurAffichee,/);
    expect(fin).toMatch(/arretDemande,/);
    expect(fin).toMatch(/dureeMs: Date\.now\(\) - debutSession,/);
    // Un seul passage par `applyVoiceEnd` et un seul comptage.
    expect((SUPER.match(/applyVoiceEnd\(\{/g) || []).length).toBe(1);
    expect((SUPER.match(/vocalNoteEmptySession\(fin, \{/g) || []).length).toBe(1);
  });

  it("le compteur transmet le contexte au module pur et remet l'historique à zéro", () => {
    const compte = sliceSource(SUPER, "function vocalNoteEmptySession", "\n  }\n", 40);
    // Le seuil vient du module pur : aucune valeur recopiée dans l'écran.
    expect(compte).toMatch(/isSilentEmptyVoiceEnd\(fin, contexte\)/);
    expect(compte).toMatch(/Number\(contexte\.dureeMs\) >= VOICE_EMPTY_SESSION_INSTANT_MS/);
    expect(compte).toMatch(/vocalSessionsVides = \[\];/);
    expect(compte).toMatch(/noteEmptyVocalSession\(vocalSessionsVides, Date\.now\(\)\)/);
    // Aucune seconde détection du vide, aucune durée inventée ailleurs.
    expect(compte).not.toMatch(/dictatedText|\.trim\(\)|finalText|\b1000\b/);
  });

  it("le seuil est importé du module partagé (aucune copie locale)", () => {
    expect(SUPER).toMatch(
      /import \{\s*applyVoiceEnd,\s*isSilentEmptyVoiceEnd,\s*VOICE_EMPTY_SESSION_INSTANT_MS,\s*\} from "\.\/voice-auto-send\.js";/,
    );
    expect((SUPER.match(/VOICE_EMPTY_SESSION_INSTANT_MS/g) || []).length).toBe(2);
  });

  it("une vraie écoute remet le compteur d'instantanés à zéro", () => {
    // Simulation : 2 retours instantanés, une vraie écoute (qui remet à zéro),
    // 2 retours instantanés → le plafond n'est jamais atteint.
    const instant = { fin: { reason: VOICE_END_NO_SESSION, dictatedText: "" }, contexte: { dureeMs: 90 }, espaceMs: 300 };
    const vraie = { fin: { reason: VOICE_END_NO_SESSION, dictatedText: "" }, contexte: { dureeMs: 4000 }, espaceMs: 4000 };
    let historique = [];
    let suspendu = false;
    for (const etape of [instant, instant, vraie, instant, instant]) {
      if (!isSilentEmptyVoiceEnd(etape.fin, etape.contexte)) {
        // Règle de l'écran : une session qui a REELLEMENT ecoute remet a zero.
        if (etape.contexte.dureeMs >= VOICE_EMPTY_SESSION_INSTANT_MS) historique = [];
        continue;
      }
      const r = noteEmptyVocalSession(historique, 1_700_000_000_000 + historique.length);
      historique = r.sessions;
      suspendu = r.suspendu;
    }
    expect(suspendu).toBe(false);
    expect(decideVocalDictation({ ...REPOS, sessionsVides: suspendu }).action).toBe(
      VOCAL_DICTATION_ARM,
    );
  });
});
