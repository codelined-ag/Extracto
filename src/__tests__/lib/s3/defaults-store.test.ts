import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let workdir = "";
const TEST_AUTH_SECRET = "0".repeat(64);

beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "s3-defaults-"));
  vi.stubEnv("DATABASE_URL", `file:${path.join(workdir, "test.db")}`);
  vi.stubEnv("AUTH_SECRET", TEST_AUTH_SECRET);
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(workdir, { recursive: true, force: true });
});

async function loadModule() {
  return import("@/lib/s3/defaults-store");
}

describe("saveS3Defaults", () => {
  it("stores S3 credentials with private file and directory modes", async () => {
    const m = await loadModule();

    await m.saveS3Defaults("user1", {
      bucket: "extracto-bucket",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      replaceSecretAccessKey: true,
    });

    const dir = path.join(workdir, "s3-defaults");
    const file = path.join(dir, "user1.json");
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("preserves the stored secret unless replaceSecretAccessKey is true", async () => {
    const m = await loadModule();

    await m.saveS3Defaults("user1", {
      secretAccessKey: "first-secret",
      replaceSecretAccessKey: true,
    });
    await m.saveS3Defaults("user1", {
      secretAccessKey: "ignored",
    });

    const loaded = await m.getS3Defaults("user1");
    expect(loaded.secretAccessKey).toBe("first-secret");
  });
});
