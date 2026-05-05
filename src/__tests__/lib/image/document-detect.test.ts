import { describe, expect, it } from "vitest";

import {
  detectDocumentQuad,
  isConvexQuad,
  otsuThreshold,
  quadOutputSize,
  quadRectangularity,
  scaleQuad,
  type Quad,
} from "@/lib/image/document-detect";

function makeRgbaFrame(width: number, height: number, fill: (x: number, y: number) => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = fill(x, y);
      const i = (y * width + x) * 4;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

describe("detectDocumentQuad", () => {
  it("returns null for a uniform dark frame with no paper", () => {
    const data = makeRgbaFrame(64, 64, () => 30);
    expect(detectDocumentQuad({ data, width: 64, height: 64 })).toBeNull();
  });

  it("returns null when the bright region fills the entire frame", () => {
    const data = makeRgbaFrame(64, 64, () => 250);
    expect(detectDocumentQuad({ data, width: 64, height: 64 })).toBeNull();
  });

  it("locks onto an axis-aligned bright rectangle", () => {
    const data = makeRgbaFrame(80, 60, (x, y) => {
      const inside = x >= 16 && x < 64 && y >= 12 && y < 48;
      return inside ? 230 : 30;
    });
    const result = detectDocumentQuad({ data, width: 80, height: 60 });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.confidence).toBeGreaterThan(0.9);
    const [tl, tr, br, bl] = result.quad;
    expect(tl[0]).toBeLessThan(20);
    expect(tl[1]).toBeLessThan(16);
    expect(tr[0]).toBeGreaterThan(60);
    expect(br[1]).toBeGreaterThan(44);
    expect(bl[0]).toBeLessThan(20);
  });

  it("orders corners as TL, TR, BR, BL", () => {
    const data = makeRgbaFrame(80, 80, (x, y) => {
      const inside = x >= 12 && x < 68 && y >= 12 && y < 68;
      return inside ? 230 : 30;
    });
    const result = detectDocumentQuad({ data, width: 80, height: 80 });
    expect(result).not.toBeNull();
    if (!result) return;
    const [tl, tr, br, bl] = result.quad;
    expect(tl[0]).toBeLessThanOrEqual(tr[0]);
    expect(bl[0]).toBeLessThanOrEqual(br[0]);
    expect(tl[1]).toBeLessThanOrEqual(bl[1]);
    expect(tr[1]).toBeLessThanOrEqual(br[1]);
  });
});

describe("quadRectangularity", () => {
  it("scores a perfect square at 1", () => {
    const quad: Quad = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(quadRectangularity(quad)).toBeCloseTo(1, 5);
  });

  it("scores a long-thin shape low", () => {
    const quad: Quad = [[0, 0], [100, 0], [10, 10], [0, 10]];
    expect(quadRectangularity(quad)).toBeLessThan(0.2);
  });
});

describe("quadOutputSize", () => {
  it("uses the longest opposite-edge length per axis", () => {
    const quad: Quad = [[0, 0], [200, 0], [200, 100], [0, 100]];
    expect(quadOutputSize(quad)).toEqual({ width: 200, height: 100 });
  });
});

describe("scaleQuad", () => {
  it("scales each corner by the given factors", () => {
    const quad: Quad = [[1, 2], [3, 4], [5, 6], [7, 8]];
    expect(scaleQuad(quad, 2, 3)).toEqual([[2, 6], [6, 12], [10, 18], [14, 24]]);
  });
});

describe("otsuThreshold", () => {
  it("splits a clear bimodal histogram between the two modes", () => {
    const histogram = new Uint32Array(256);
    for (let i = 20; i < 60; i += 1) histogram[i] = 50;
    for (let i = 180; i < 220; i += 1) histogram[i] = 50;
    const total = 50 * 40 * 2;
    const t = otsuThreshold(histogram, total);
    expect(t).toBeGreaterThanOrEqual(59);
    expect(t).toBeLessThan(180);
  });

  it("survives a near-uniform histogram without throwing", () => {
    const histogram = new Uint32Array(256).fill(10);
    const total = 256 * 10;
    const t = otsuThreshold(histogram, total);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(255);
  });
});

describe("isConvexQuad", () => {
  it("accepts a clockwise rectangle in image coordinates", () => {
    const quad: Quad = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(isConvexQuad(quad)).toBe(true);
  });

  it("accepts a tilted convex quad", () => {
    const quad: Quad = [[2, 1], [9, 0], [10, 8], [0, 9]];
    expect(isConvexQuad(quad)).toBe(true);
  });

  it("rejects a self-intersecting bowtie", () => {
    const quad: Quad = [[0, 0], [10, 0], [0, 10], [10, 10]];
    expect(isConvexQuad(quad)).toBe(false);
  });

  it("rejects a concave quad whose third corner crosses inward", () => {
    const quad: Quad = [[0, 0], [10, 0], [5, 5], [0, 10]];
    expect(isConvexQuad(quad)).toBe(false);
  });

  it("rejects a degenerate quad where three points are collinear", () => {
    const quad: Quad = [[0, 0], [5, 0], [10, 0], [0, 10]];
    expect(isConvexQuad(quad)).toBe(false);
  });
});
