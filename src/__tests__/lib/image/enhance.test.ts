import { describe, expect, it } from "vitest";

import {
  applyContrastStretch,
  computePercentilePoints,
} from "@/lib/image/enhance";

describe("computePercentilePoints", () => {
  it("collapses to a single value when the histogram has one bin", () => {
    const luminance = new Uint8ClampedArray(100).fill(120);
    const { blackPoint, whitePoint } = computePercentilePoints(luminance, 0.05, 0.95);
    expect(blackPoint).toBe(120);
    expect(whitePoint).toBeGreaterThan(blackPoint);
  });

  it("clips a sparse outlier tail and keeps the dominant tone as the white point", () => {
    const luminance = new Uint8ClampedArray(1000);
    for (let i = 0; i < 950; i += 1) luminance[i] = 200;
    for (let i = 950; i < 980; i += 1) luminance[i] = 60;
    for (let i = 980; i < 1000; i += 1) luminance[i] = 250;
    const { blackPoint, whitePoint } = computePercentilePoints(luminance, 0.05, 0.95);
    expect(blackPoint).toBeGreaterThan(60);
    expect(whitePoint).toBeLessThan(250);
    expect(whitePoint).toBeGreaterThanOrEqual(200);
  });

  it("keeps a representative outlier band visible when it exceeds the clip percentile", () => {
    const luminance = new Uint8ClampedArray(1000);
    for (let i = 0; i < 850; i += 1) luminance[i] = 200;
    for (let i = 850; i < 950; i += 1) luminance[i] = 60;
    for (let i = 950; i < 1000; i += 1) luminance[i] = 250;
    const { blackPoint } = computePercentilePoints(luminance, 0.05, 0.95);
    expect(blackPoint).toBe(60);
  });

  it("returns sensible defaults when the histogram is uniform", () => {
    const luminance = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i += 1) luminance[i] = i;
    const { blackPoint, whitePoint } = computePercentilePoints(luminance, 0.05, 0.95);
    expect(blackPoint).toBeGreaterThanOrEqual(10);
    expect(blackPoint).toBeLessThanOrEqual(20);
    expect(whitePoint).toBeGreaterThanOrEqual(240);
    expect(whitePoint).toBeLessThanOrEqual(245);
  });
});

describe("applyContrastStretch", () => {
  it("stretches luminance values across the 0-255 range", () => {
    const luminance = new Uint8ClampedArray([100, 130, 160]);
    const output = { data: new Uint8ClampedArray(12) };
    applyContrastStretch(luminance, output, 100, 160, 240);
    expect(output.data[0]).toBe(0);
    expect(output.data[1]).toBe(0);
    expect(output.data[2]).toBe(0);
    expect(output.data[4]).toBeGreaterThan(120);
    expect(output.data[4]).toBeLessThan(135);
    expect(output.data[8]).toBe(255);
  });

  it("snaps near-white pixels to pure white via whiteCutoff", () => {
    const luminance = new Uint8ClampedArray([240, 250]);
    const output = { data: new Uint8ClampedArray(8) };
    applyContrastStretch(luminance, output, 0, 255, 200);
    expect(output.data[0]).toBe(255);
    expect(output.data[4]).toBe(255);
  });

  it("clamps below-black pixels to zero", () => {
    const luminance = new Uint8ClampedArray([50]);
    const output = { data: new Uint8ClampedArray(4) };
    applyContrastStretch(luminance, output, 100, 200, 240);
    expect(output.data[0]).toBe(0);
  });

  it("passes pixels through untouched when the dynamic range collapses", () => {
    const luminance = new Uint8ClampedArray([180, 180, 180]);
    const output = { data: new Uint8ClampedArray(12) };
    applyContrastStretch(luminance, output, 180, 181, 240);
    expect(output.data[0]).toBe(180);
    expect(output.data[4]).toBe(180);
    expect(output.data[8]).toBe(180);
  });
});
