// Tests unitaires — image-viewer.js (zoom clavier : computeZoom borné)
import { describe, it, expect, vi } from "vitest";

// preview.js référence `window` au niveau module (non dispo en vitest) → mock
vi.mock("./preview.js", () => ({ imageToBase64: vi.fn() }));

import { computeZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "./image-viewer.js";

describe("computeZoom", () => {
  it("zoom avant depuis 100% → 125%", () => {
    expect(computeZoom(1, 1)).toBe(1.25);
  });

  it("zoom arrière depuis 100% → 75%", () => {
    expect(computeZoom(1, -1)).toBe(0.75);
  });

  it("est borné à la borne max (500%)", () => {
    expect(computeZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(computeZoom(ZOOM_MAX + 10, 1)).toBe(ZOOM_MAX);
  });

  it("est borné à la borne min (10%)", () => {
    expect(computeZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(computeZoom(ZOOM_MIN - 10, -1)).toBe(ZOOM_MIN);
  });

  it("respecte le pas de 0.25", () => {
    expect(computeZoom(1, 2)).toBe(1.5);
    expect(computeZoom(1, -2)).toBe(0.5);
  });

  it("plusieurs pas successifs restent dans les bornes", () => {
    let s = 1;
    for (let i = 0; i < 100; i++) s = computeZoom(s, 1);
    expect(s).toBe(ZOOM_MAX);
    for (let i = 0; i < 100; i++) s = computeZoom(s, -1);
    expect(s).toBe(ZOOM_MIN);
  });

  it("delta 0 ne change pas le zoom", () => {
    expect(computeZoom(1.5, 0)).toBe(1.5);
  });

  it("ZOOM_STEP est bien 0.25", () => {
    expect(ZOOM_STEP).toBe(0.25);
  });
});
