// Tests unitaires — mcp-secret-scope.js (périmètre de la clé du coffre MCP).
//
// Preuves exigées (tâche 399, incrément 2) : un serveur sans déclaration ne
// reçoit rien ; un serveur qui déclare reçoit sa clé (valeur INVENTÉE ici, le
// test ne touche à aucun coffre) ; un refus clair quand la clé manque ; le mode
// non strict rend l'ancien comportement. Les tests n'écrivent, n'affichent et
// ne journalisent JAMAIS une valeur réelle de clé.
import { describe, expect, it } from "vitest";
import {
  MCP_SECRET_BLOCK_VAR,
  MCP_SECRET_VAR,
  declaresSecret,
  parseSecretStrict,
  scopeMcpSecret,
  secretStatusLabel,
} from "./mcp-secret-scope.js";

const INVENTED = "cle-inventee-pour-le-test";

describe("declaresSecret", () => {
  it("vrai seulement si une référence non vide est déclarée", () => {
    expect(declaresSecret({ secret_ref: "vault:entree" })).toBe(true);
    expect(declaresSecret({ secret_ref: "  vault:x  " })).toBe(true);
    expect(declaresSecret({ secret_ref: "" })).toBe(false);
    expect(declaresSecret({ secret_ref: "   " })).toBe(false);
    expect(declaresSecret({ secret_ref: null })).toBe(false);
    expect(declaresSecret(null)).toBe(false);
  });
});

describe("parseSecretStrict", () => {
  it("défaut strict (true) si absent, invalide ou vide", () => {
    expect(parseSecretStrict('{"mcp_secret_strict":true}')).toBe(true);
    expect(parseSecretStrict('{"mcp_secret_strict":false}')).toBe(false);
    expect(parseSecretStrict("{}")).toBe(true);
    expect(parseSecretStrict("")).toBe(true);
    expect(parseSecretStrict("pas du json")).toBe(true);
  });
});

describe("scopeMcpSecret — un serveur qui ne demande rien ne reçoit rien", () => {
  it("mode strict : la clé héritée est RETIRÉE, sans refus ni avertissement", () => {
    const base = { PATH: "/bin", [MCP_SECRET_VAR]: INVENTED };
    const out = scopeMcpSecret(base, { declared: false, strict: true });
    expect(out.env[MCP_SECRET_VAR]).toBeUndefined();
    expect(out.env.PATH).toBe("/bin");
    expect(out.secret).toBe("");
    expect(out.blocked).toBe(false);
    expect(out.reason).toBe("");
    expect(out.notice).toBe("");
    expect(out.removedInherited).toBe(true);
    // La base n'est pas modifiée (fonction pure).
    expect(base[MCP_SECRET_VAR]).toBe(INVENTED);
  });

  it("serveur sans clé héritée : aucun message, aucun refus", () => {
    const out = scopeMcpSecret({ PATH: "/bin" }, { declared: false, strict: true });
    expect(out.env[MCP_SECRET_VAR]).toBeUndefined();
    expect(out.blocked).toBe(false);
    expect(out.notice).toBe("");
    expect(out.removedInherited).toBe(false);
  });
});

describe("scopeMcpSecret — un serveur qui déclare reçoit sa clé", () => {
  it("clé présente : conservée dans l'environnement transmis", () => {
    const out = scopeMcpSecret({ [MCP_SECRET_VAR]: INVENTED }, { declared: true, strict: true });
    expect(out.env[MCP_SECRET_VAR]).toBe(INVENTED);
    expect(out.secret).toBe(INVENTED);
    expect(out.blocked).toBe(false);
    expect(out.notice).toBe("");
  });
});

describe("scopeMcpSecret — refus clair quand la clé manque", () => {
  it("signal de refus de Rust : lancement refusé, référence nommée, jamais une valeur", () => {
    const out = scopeMcpSecret(
      { [MCP_SECRET_BLOCK_VAR]: "vault:entree-absente" },
      { declared: true, strict: true },
    );
    expect(out.blocked).toBe(true);
    expect(out.reason).toContain("vault:entree-absente");
    expect(out.reason).toContain("refusé");
    expect(out.env[MCP_SECRET_BLOCK_VAR]).toBeUndefined();
    expect(out.env[MCP_SECRET_VAR]).toBeUndefined();
    expect(out.notice).toBe("");
  });

  it("serveur qui déclare sans clé disponible : démarre sans clé + message lisible", () => {
    const out = scopeMcpSecret({ PATH: "/bin" }, { declared: true, strict: true });
    expect(out.blocked).toBe(false);
    expect(out.notice).toContain("SANS clé");
    expect(out.secret).toBe("");
  });
});

describe("scopeMcpSecret — le mode non strict rend l'ancien comportement", () => {
  it("serveur sans déclaration : la clé héritée reste transmise", () => {
    const out = scopeMcpSecret({ [MCP_SECRET_VAR]: INVENTED }, { declared: false, strict: false });
    expect(out.env[MCP_SECRET_VAR]).toBe(INVENTED);
    expect(out.secret).toBe(INVENTED);
    expect(out.blocked).toBe(false);
    expect(out.removedInherited).toBe(false);
  });

  it("le canal de contrôle n'est jamais transmis et décide seul du refus", () => {
    const out = scopeMcpSecret({ [MCP_SECRET_BLOCK_VAR]: "vault:x" }, { declared: false, strict: false });
    expect(out.env[MCP_SECRET_BLOCK_VAR]).toBeUndefined();
    expect(out.blocked).toBe(true);
  });
});

describe("secretStatusLabel", () => {
  it("traduit chaque état, sans jamais exposer de valeur", () => {
    expect(secretStatusLabel("ready")).toContain("transmise");
    expect(secretStatusLabel("not_requested")).toContain("aucune clé");
    expect(secretStatusLabel("empty_ref")).toContain("vide");
    expect(secretStatusLabel("unknown_ref")).toContain("introuvable");
    expect(secretStatusLabel("locked")).toContain("verrouillé");
    expect(secretStatusLabel("autre")).toContain("inconnu");
    expect(secretStatusLabel("")).toContain("inconnu");
  });
});
