// Tests — project-memory.js : mémoire de projet (H3, PROJECT_MEMORY.md).
//
// Contrat vérifié : composition du chemin absolu, création idempotente depuis le
// template, bloc d'injection vide quand la mémoire est absente/vide, prompt
// d'extraction borné (résumé tronqué) avec repli de titre, lecture tolerante
// (null au lieu de lever).

import { describe, it, expect, vi, beforeEach } from "vitest";

let invokeImpl;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeImpl(...args),
}));

import {
  MEMORY_FILE,
  MEMORY_TEMPLATE,
  memoryAbsPath,
  readProjectMemory,
  buildMemoryBlock,
  initProjectMemory,
  buildMemoryExtractPrompt,
} from "./project-memory.js";

beforeEach(() => {
  invokeImpl = vi.fn(async () => undefined);
});

describe("memoryAbsPath", () => {
  it("joint le nom du fichier mémoire à la racine projet (séparateurs OS-agnostiques)", () => {
    expect(memoryAbsPath("C:\\proj\\A")).toBe("C:\\proj\\A/" + MEMORY_FILE);
    expect(memoryAbsPath("/home/x/proj")).toBe("/home/x/proj/" + MEMORY_FILE);
  });

  it("supprime les séparateurs de fin avant de joindre", () => {
    expect(memoryAbsPath("/home/x/proj/")).toBe("/home/x/proj/" + MEMORY_FILE);
    expect(memoryAbsPath("C:/proj/A///")).toBe("C:/proj/A/" + MEMORY_FILE);
  });

  it("tolère une racine vide (chemin relatif au fichier seul)", () => {
    expect(memoryAbsPath("")).toBe("/" + MEMORY_FILE);
    expect(memoryAbsPath(null)).toBe("/" + MEMORY_FILE);
  });
});

describe("readProjectMemory", () => {
  it("retourne null sans projet (aucun appel backend)", async () => {
    expect(await readProjectMemory("")).toBeNull();
    expect(invokeImpl).not.toHaveBeenCalled();
  });

  it("retourne null si le fichier n'existe pas", async () => {
    invokeImpl = vi.fn(async () => false);
    expect(await readProjectMemory("/p")).toBeNull();
  });

  it("retourne le contenu quand le fichier existe", async () => {
    invokeImpl = vi.fn(async (cmd) => (cmd === "file_exists" ? true : "# Mémoire\n- fait"));
    expect(await readProjectMemory("/p")).toBe("# Mémoire\n- fait");
  });

  it("retourne null en cas d'erreur backend (jamais d'exception)", async () => {
    invokeImpl = vi.fn(async () => {
      throw new Error("disque");
    });
    expect(await readProjectMemory("/p")).toBeNull();
  });
});

describe("buildMemoryBlock", () => {
  it("retourne \"\" quand la mémoire est absente ou vide", async () => {
    invokeImpl = vi.fn(async () => false);
    expect(await buildMemoryBlock("/p")).toBe("");

    invokeImpl = vi.fn(async (cmd) => (cmd === "file_exists" ? true : "   \n  "));
    expect(await buildMemoryBlock("/p")).toBe("");
  });

  it("encadre le contenu par les balises de mémoire projet", async () => {
    invokeImpl = vi.fn(async (cmd) => (cmd === "file_exists" ? true : "- piège : X"));
    const block = await buildMemoryBlock("/p");
    expect(block).toContain("=== MÉMOIRE DU PROJET");
    expect(block).toContain("- piège : X");
    expect(block).toContain("=== FIN MÉMOIRE ===");
  });
});

describe("initProjectMemory", () => {
  it("écrit le template quand le fichier est absent et retourne le chemin", async () => {
    const calls = [];
    invokeImpl = vi.fn(async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "file_exists") return false;
      return undefined;
    });

    const abs = await initProjectMemory("C:/proj");

    expect(abs).toBe("C:/proj/" + MEMORY_FILE);
    expect(calls.map((c) => c[0])).toEqual(["file_exists", "write_file_content"]);
    expect(calls[1][1].path).toBe("C:/proj/" + MEMORY_FILE);
    expect(calls[1][1].content).toBe(MEMORY_TEMPLATE);
  });

  it("n'écrase PAS un fichier existant (idempotent)", async () => {
    invokeImpl = vi.fn(async () => true);
    await initProjectMemory("C:/proj");
    expect(invokeImpl.mock.calls.some((c) => c[0] === "write_file_content")).toBe(false);
  });

  it("retourne null sans projet", async () => {
    expect(await initProjectMemory("")).toBeNull();
    expect(invokeImpl).not.toHaveBeenCalled();
  });

  it("retourne quand même le chemin si l'écriture échoue (fail-open)", async () => {
    invokeImpl = vi.fn(async (cmd) => {
      if (cmd === "file_exists") return false;
      throw new Error("lecture seule");
    });
    expect(await initProjectMemory("C:/proj")).toBe("C:/proj/" + MEMORY_FILE);
  });
});

describe("buildMemoryExtractPrompt", () => {
  it("nomme la tâche et le résumé", () => {
    const prompt = buildMemoryExtractPrompt({ title: "#3 Brancher le filtre" }, "J'ai branché X.");
    expect(prompt).toContain("« #3 Brancher le filtre »");
    expect(prompt).toContain("J'ai branché X.");
    expect(prompt).toContain("NO_NEW_MEMORY");
  });

  it("replie le titre manquant sur « (sans titre) »", () => {
    expect(buildMemoryExtractPrompt({}, "résumé")).toContain("« (sans titre) »");
    expect(buildMemoryExtractPrompt(null, "résumé")).toContain("« (sans titre) »");
  });

  it("tronque le résumé à 1500 caractères (prompt borné)", () => {
    const prompt = buildMemoryExtractPrompt({ title: "t" }, "x".repeat(5000));
    const idx = prompt.indexOf("Résumé de la tâche :");
    const summaryPart = prompt.slice(idx);
    expect(summaryPart.length).toBeLessThanOrEqual("Résumé de la tâche :\n".length + 1500 + 1);
  });
});
