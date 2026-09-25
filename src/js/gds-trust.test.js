// Tests — refus de confiance Git du dossier des dépôts (src/js/gds.js).
//
// Constat : le refus RÉELLEMENT observé
// « fatal: detected dubious ownership in repository at 'C:\GDS\repos\Kodali.git' »
// était affiché brut, incompréhensible pour un non-technicien. Il doit devenir
// une phrase simple ; les autres erreurs (authentification) gardent leur message.
import { describe, it, expect, vi } from "vitest";
import { friendlyGdsError, isTrustRefusal, TRUST_REFUSAL_MESSAGE } from "./gds.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));

const REAL_DUBIOUS =
  "git push a échoué (remote gds) — fatal: detected dubious ownership in repository " +
  "at 'C:\\GDS\\repos\\Kodali.git' — To add an exception for this directory, call: " +
  "git config --global --add safe.directory C:/GDS/repos/Kodali.git";
const REAL_AUTH =
  "git push a échoué (remote gds) — fatal: Authentication failed for " +
  "'git@gds.example:repos/pilot.git'";

describe("refus de confiance Git — phrase simple", () => {
  it("le refus réel est reconnu et traduit en langage simple", () => {
    expect(isTrustRefusal(REAL_DUBIOUS)).toBe(true);
    expect(friendlyGdsError(REAL_DUBIOUS)).toBe(TRUST_REFUSAL_MESSAGE);
  });

  it("un échec d'authentification garde EXACTEMENT son message", () => {
    expect(isTrustRefusal(REAL_AUTH)).toBe(false);
    expect(friendlyGdsError(REAL_AUTH)).toBe(REAL_AUTH);
  });
});
