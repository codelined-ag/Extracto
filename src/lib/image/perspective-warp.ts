import type { Quad } from "@/lib/image/document-detect";

export type Matrix3x3 = [number, number, number, number, number, number, number, number, number];

export function computePerspectiveMatrix(src: Quad, dst: Quad): Matrix3x3 | null {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    a.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    a.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dx);
    b.push(dy);
  }
  const solved = gaussianSolve(a, b);
  if (!solved) return null;
  return [solved[0], solved[1], solved[2], solved[3], solved[4], solved[5], solved[6], solved[7], 1];
}

export function invertMatrix3x3(m: Matrix3x3): Matrix3x3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  return [
    (e * i - f * h) * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    (f * g - d * i) * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
}

export function applyMatrix(m: Matrix3x3, x: number, y: number): [number, number] | null {
  const w = m[6] * x + m[7] * y + m[8];
  if (w === 0) return null;
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

function gaussianSolve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m: number[][] = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k += 1) {
        m[row][k] -= factor * m[col][k];
      }
    }
  }
  const out: number[] = [];
  for (let row = 0; row < n; row += 1) {
    out.push(m[row][n] / m[row][row]);
  }
  return out;
}

export function warpPerspective(
  source: HTMLCanvasElement | HTMLVideoElement | ImageBitmap,
  sourceWidth: number,
  sourceHeight: number,
  srcQuad: Quad,
  outWidth: number,
  outHeight: number,
): HTMLCanvasElement | null {
  const dstQuad: Quad = [
    [0, 0],
    [outWidth - 1, 0],
    [outWidth - 1, outHeight - 1],
    [0, outHeight - 1],
  ];
  const forward = computePerspectiveMatrix(srcQuad, dstQuad);
  if (!forward) return null;
  const inverse = invertMatrix3x3(forward);
  if (!inverse) return null;

  const reader = document.createElement("canvas");
  reader.width = sourceWidth;
  reader.height = sourceHeight;
  const readerCtx = reader.getContext("2d");
  if (!readerCtx) return null;
  readerCtx.drawImage(source as CanvasImageSource, 0, 0, sourceWidth, sourceHeight);
  const srcImage = readerCtx.getImageData(0, 0, sourceWidth, sourceHeight);
  const srcData = srcImage.data;

  const out = document.createElement("canvas");
  out.width = outWidth;
  out.height = outHeight;
  const outCtx = out.getContext("2d");
  if (!outCtx) return null;
  const outImage = outCtx.createImageData(outWidth, outHeight);
  const outData = outImage.data;

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const mapped = applyMatrix(inverse, x, y);
      if (!mapped) continue;
      const sx = mapped[0];
      const sy = mapped[1];
      if (sx < 0 || sy < 0 || sx >= sourceWidth - 1 || sy >= sourceHeight - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const dx = sx - x0;
      const dy = sy - y0;
      const i00 = (y0 * sourceWidth + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sourceWidth * 4;
      const i11 = i01 + 4;
      const w00 = (1 - dx) * (1 - dy);
      const w10 = dx * (1 - dy);
      const w01 = (1 - dx) * dy;
      const w11 = dx * dy;
      const outIdx = (y * outWidth + x) * 4;
      outData[outIdx] = srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11;
      outData[outIdx + 1] = srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11;
      outData[outIdx + 2] = srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11;
      outData[outIdx + 3] = 255;
    }
  }
  outCtx.putImageData(outImage, 0, 0);
  return out;
}
