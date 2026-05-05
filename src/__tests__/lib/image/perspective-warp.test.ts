import { describe, expect, it } from "vitest";

import type { Quad } from "@/lib/image/document-detect";
import {
  applyMatrix,
  computePerspectiveMatrix,
  invertMatrix3x3,
} from "@/lib/image/perspective-warp";

describe("computePerspectiveMatrix", () => {
  it("maps each source corner to its target corner", () => {
    const src: Quad = [[10, 20], [110, 30], [120, 220], [0, 200]];
    const dst: Quad = [[0, 0], [100, 0], [100, 200], [0, 200]];
    const m = computePerspectiveMatrix(src, dst);
    expect(m).not.toBeNull();
    if (!m) return;
    for (let i = 0; i < 4; i += 1) {
      const out = applyMatrix(m, src[i][0], src[i][1]);
      expect(out).not.toBeNull();
      if (!out) return;
      expect(out[0]).toBeCloseTo(dst[i][0], 4);
      expect(out[1]).toBeCloseTo(dst[i][1], 4);
    }
  });

  it("is invertible for a generic forward map", () => {
    const src: Quad = [[5, 5], [120, 10], [130, 200], [0, 195]];
    const dst: Quad = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const forward = computePerspectiveMatrix(src, dst);
    expect(forward).not.toBeNull();
    if (!forward) return;
    const inverse = invertMatrix3x3(forward);
    expect(inverse).not.toBeNull();
    if (!inverse) return;
    const round = applyMatrix(inverse, 50, 50);
    const back = round && applyMatrix(forward, round[0], round[1]);
    expect(back).not.toBeNull();
    if (!back) return;
    expect(back[0]).toBeCloseTo(50, 4);
    expect(back[1]).toBeCloseTo(50, 4);
  });
});

describe("invertMatrix3x3", () => {
  it("returns null for a singular matrix", () => {
    expect(invertMatrix3x3([1, 2, 3, 2, 4, 6, 3, 6, 9])).toBeNull();
  });

  it("inverts the identity to itself", () => {
    const inv = invertMatrix3x3([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(inv).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});
