import { describe, it, expect, vi } from "vitest";

// watched-folder.ts imports db at module load. Mock it so we can import the
// pure helper without requiring a real Prisma client.
vi.mock("@/lib/db", () => ({ db: {} }));
// resolveInternalOcrEndpoint reads PORT — leave it real, it's pure.

import { isSupportedFile } from "@/lib/background/watched-folder";

describe("isSupportedFile", () => {
  it("accepts .pdf", () => {
    expect(isSupportedFile("scan.pdf")).toBe(true);
  });

  it("accepts .png, .jpg, .jpeg, .webp", () => {
    expect(isSupportedFile("photo.png")).toBe(true);
    expect(isSupportedFile("image.jpg")).toBe(true);
    expect(isSupportedFile("frame.jpeg")).toBe(true);
    expect(isSupportedFile("snap.webp")).toBe(true);
  });

  it("is case-insensitive on extension", () => {
    expect(isSupportedFile("DOC.PDF")).toBe(true);
    expect(isSupportedFile("Image.JPG")).toBe(true);
  });

  it("rejects dotfiles", () => {
    expect(isSupportedFile(".hidden.pdf")).toBe(false);
    expect(isSupportedFile(".DS_Store")).toBe(false);
  });

  it("rejects .extracto.json result markers", () => {
    expect(isSupportedFile("scan.pdf.extracto.json")).toBe(false);
  });

  it("rejects .extracto.done markers", () => {
    expect(isSupportedFile("scan.pdf.extracto.done")).toBe(false);
  });

  it("rejects unsupported extensions", () => {
    expect(isSupportedFile("doc.txt")).toBe(false);
    expect(isSupportedFile("video.mp4")).toBe(false);
    expect(isSupportedFile("notes.docx")).toBe(false);
  });

  it("rejects files with no extension", () => {
    expect(isSupportedFile("README")).toBe(false);
    expect(isSupportedFile("Makefile")).toBe(false);
  });

  it("accepts files with multiple dots in the name", () => {
    expect(isSupportedFile("my.scan.v2.pdf")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isSupportedFile("")).toBe(false);
  });
});
