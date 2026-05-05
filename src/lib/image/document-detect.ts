export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];

export interface DetectionInput {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface DetectionResult {
  quad: Quad;
  confidence: number;
}

const MIN_PAPER_RATIO = 0.05;
const MAX_PAPER_RATIO = 0.97;
const MIN_RECT_RATIO = 0.55;

export function otsuThreshold(histogram: ArrayLike<number>, totalPixels: number): number {
  if (totalPixels <= 0) return 128;
  let sumAll = 0;
  for (let i = 0; i < 256; i += 1) sumAll += i * histogram[i];
  let weightBg = 0;
  let sumBg = 0;
  let bestVariance = -1;
  let bestThreshold = 128;
  for (let t = 0; t < 256; t += 1) {
    weightBg += histogram[t];
    if (weightBg === 0) continue;
    const weightFg = totalPixels - weightBg;
    if (weightFg === 0) break;
    sumBg += t * histogram[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const variance = weightBg * weightFg * (meanBg - meanFg) * (meanBg - meanFg);
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = t;
    }
  }
  return bestThreshold;
}

export function detectDocumentQuad(input: DetectionInput): DetectionResult | null {
  const { width, height } = input;
  if (width < 16 || height < 16) return null;
  const totalPixels = width * height;
  const lum = new Uint8ClampedArray(totalPixels);
  const histogram = new Uint32Array(256);
  for (let i = 0, j = 0; i < input.data.length; i += 4, j += 1) {
    const v = Math.round(0.2126 * input.data[i] + 0.7152 * input.data[i + 1] + 0.0722 * input.data[i + 2]);
    lum[j] = v;
    histogram[v] += 1;
  }
  const threshold = otsuThreshold(histogram, totalPixels);

  let paperCount = 0;
  let cx = 0;
  let cy = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (lum[y * width + x] > threshold) {
        paperCount += 1;
        cx += x;
        cy += y;
      }
    }
  }
  if (paperCount === 0) return null;
  const paperRatio = paperCount / totalPixels;
  if (paperRatio < MIN_PAPER_RATIO || paperRatio > MAX_PAPER_RATIO) return null;
  cx /= paperCount;
  cy /= paperCount;

  let tlBest = -1;
  let trBest = -1;
  let brBest = -1;
  let blBest = -1;
  let tl: Point = [0, 0];
  let tr: Point = [width - 1, 0];
  let br: Point = [width - 1, height - 1];
  let bl: Point = [0, height - 1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (lum[y * width + x] <= threshold) continue;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (dx <= 0 && dy <= 0) {
        if (d2 > tlBest) { tlBest = d2; tl = [x, y]; }
      } else if (dx >= 0 && dy <= 0) {
        if (d2 > trBest) { trBest = d2; tr = [x, y]; }
      } else if (dx >= 0 && dy >= 0) {
        if (d2 > brBest) { brBest = d2; br = [x, y]; }
      } else {
        if (d2 > blBest) { blBest = d2; bl = [x, y]; }
      }
    }
  }
  if (tlBest < 0 || trBest < 0 || brBest < 0 || blBest < 0) return null;

  const quad: Quad = [tl, tr, br, bl];
  if (!isConvexQuad(quad)) return null;
  const conf = quadRectangularity(quad);
  if (conf < MIN_RECT_RATIO) return null;
  return { quad, confidence: Math.min(1, conf) };
}

export function isConvexQuad(quad: Quad): boolean {
  let signSum = 0;
  let signCount = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross === 0) return false;
    const sign = cross > 0 ? 1 : -1;
    if (signCount === 0) {
      signSum = sign;
    } else if (sign !== signSum) {
      return false;
    }
    signCount += 1;
  }
  return true;
}

function dist(a: Point, b: Point): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function quadRectangularity(quad: Quad): number {
  const [tl, tr, br, bl] = quad;
  const top = dist(tl, tr);
  const right = dist(tr, br);
  const bottom = dist(br, bl);
  const left = dist(bl, tl);
  if (top === 0 || right === 0 || bottom === 0 || left === 0) return 0;
  const horiz = Math.min(top, bottom) / Math.max(top, bottom);
  const vert = Math.min(left, right) / Math.max(left, right);
  return Math.min(horiz, vert);
}

export function quadOutputSize(quad: Quad): { width: number; height: number } {
  const [tl, tr, br, bl] = quad;
  const top = dist(tl, tr);
  const bottom = dist(br, bl);
  const left = dist(bl, tl);
  const right = dist(tr, br);
  return {
    width: Math.max(1, Math.round(Math.max(top, bottom))),
    height: Math.max(1, Math.round(Math.max(left, right))),
  };
}

export function scaleQuad(quad: Quad, scaleX: number, scaleY: number): Quad {
  return [
    [quad[0][0] * scaleX, quad[0][1] * scaleY],
    [quad[1][0] * scaleX, quad[1][1] * scaleY],
    [quad[2][0] * scaleX, quad[2][1] * scaleY],
    [quad[3][0] * scaleX, quad[3][1] * scaleY],
  ];
}
