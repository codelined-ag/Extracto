export interface EnhanceOptions {
  blackPercentile?: number;
  whitePercentile?: number;
  whiteCutoff?: number;
}

const DEFAULTS: Required<EnhanceOptions> = {
  blackPercentile: 0.05,
  whitePercentile: 0.95,
  whiteCutoff: 240,
};

export type CaptureMode = "document" | "receipt" | "whiteboard";

export const CAPTURE_MODE_PRESETS: Record<CaptureMode, Required<EnhanceOptions>> = {
  document: { blackPercentile: 0.05, whitePercentile: 0.95, whiteCutoff: 240 },
  receipt: { blackPercentile: 0.02, whitePercentile: 0.92, whiteCutoff: 230 },
  whiteboard: { blackPercentile: 0.05, whitePercentile: 0.9, whiteCutoff: 215 },
};

export interface PercentilePoints {
  blackPoint: number;
  whitePoint: number;
}

export function computePercentilePoints(
  luminance: ArrayLike<number>,
  blackPercentile: number,
  whitePercentile: number,
): PercentilePoints {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < luminance.length; i += 1) {
    histogram[luminance[i] | 0] += 1;
  }
  const totalPixels = luminance.length;
  const blackTarget = Math.floor(totalPixels * blackPercentile);
  const whiteTarget = Math.floor(totalPixels * whitePercentile);
  let cumulative = 0;
  let blackPoint = 0;
  let whitePoint = 255;
  let blackResolved = false;
  for (let v = 0; v < 256; v += 1) {
    cumulative += histogram[v];
    if (!blackResolved && cumulative >= blackTarget) {
      blackPoint = v;
      blackResolved = true;
    }
    if (cumulative >= whiteTarget) {
      whitePoint = v;
      break;
    }
  }
  if (whitePoint <= blackPoint) whitePoint = Math.min(255, blackPoint + 1);
  return { blackPoint, whitePoint };
}

export function applyContrastStretch(
  luminance: ArrayLike<number>,
  output: { data: Uint8ClampedArray | Uint8Array | number[] },
  blackPoint: number,
  whitePoint: number,
  whiteCutoff: number,
): void {
  const range = whitePoint - blackPoint;
  if (range <= 1) {
    for (let i = 0, j = 0; i < output.data.length; i += 4, j += 1) {
      const v = luminance[j];
      output.data[i] = v;
      output.data[i + 1] = v;
      output.data[i + 2] = v;
    }
    return;
  }
  for (let i = 0, j = 0; i < output.data.length; i += 4, j += 1) {
    let stretched = ((luminance[j] - blackPoint) / range) * 255;
    if (stretched < 0) stretched = 0;
    else if (stretched > 255) stretched = 255;
    if (stretched >= whiteCutoff) stretched = 255;
    output.data[i] = stretched;
    output.data[i + 1] = stretched;
    output.data[i + 2] = stretched;
  }
}

export function enhanceForOcr(
  source: HTMLCanvasElement | HTMLVideoElement | ImageBitmap,
  width: number,
  height: number,
  options: EnhanceOptions = {},
): HTMLCanvasElement {
  const opts = { ...DEFAULTS, ...options };
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const luminance = new Uint8ClampedArray(image.data.length / 4);
  for (let i = 0, j = 0; i < image.data.length; i += 4, j += 1) {
    luminance[j] = Math.round(
      0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2],
    );
  }
  const { blackPoint, whitePoint } = computePercentilePoints(
    luminance,
    opts.blackPercentile,
    opts.whitePercentile,
  );
  applyContrastStretch(luminance, image, blackPoint, whitePoint, opts.whiteCutoff);
  ctx.putImageData(image, 0, 0);
  return canvas;
}
