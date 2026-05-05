import { mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listLocalFolder } from "@/lib/integrations/local";

let root: string;
const userId = "user-test";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "extracto-localwatch-"));
  process.env.LOCAL_WATCH_ROOT = root;
});

afterEach(async () => {
  delete process.env.LOCAL_WATCH_ROOT;
  await rm(root, { recursive: true, force: true });
});

async function writeAged(file: string, content: string, ageMs: number): Promise<void> {
  await writeFile(file, content);
  const t = new Date(Date.now() - ageMs);
  await utimes(file, t, t);
}

describe("listLocalFolder min-age guard", () => {
  it("excludes files younger than 5 seconds", async () => {
    const userRoot = path.join(root, userId);
    await mkdir(userRoot, { recursive: true });
    const fresh = path.join(userRoot, "fresh.pdf");
    const old = path.join(userRoot, "old.pdf");
    await writeAged(fresh, "x", 1_000);
    await writeAged(old, "y", 10_000);

    const entries = await listLocalFolder(userId, "");
    const names = entries.filter((e) => e.kind === "file").map((e) => e.name);

    expect(names).toContain("old.pdf");
    expect(names).not.toContain("fresh.pdf");
  });
});
