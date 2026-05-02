import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the AWS SDK so the tests never touch the network and never need
// the real client constructor. We dynamically import the result-store
// inside each test so vi.resetModules() can give us a fresh module
// instance with a fresh getStore() singleton.
vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    public sendImpl: ((cmd: unknown) => Promise<unknown>) | null = null;
    async send(cmd: unknown) {
      if (this.sendImpl) return this.sendImpl(cmd);
      throw new Error("S3 client not configured for this test");
    }
  }
  class PutObjectCommand {
    constructor(public input: unknown) {}
  }
  class GetObjectCommand {
    constructor(public input: unknown) {}
  }
  class DeleteObjectCommand {
    constructor(public input: unknown) {}
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  // Default: local store mode
  process.env.RESULT_STORAGE = "local";
  delete process.env.S3_BUCKET;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

describe("isRemoteResultStore", () => {
  it("is false when RESULT_STORAGE is unset", async () => {
    delete process.env.RESULT_STORAGE;
    const mod = await import("@/lib/result-store");
    expect(mod.isRemoteResultStore()).toBe(false);
  });

  it("is false when RESULT_STORAGE=local", async () => {
    process.env.RESULT_STORAGE = "local";
    const mod = await import("@/lib/result-store");
    expect(mod.isRemoteResultStore()).toBe(false);
  });

  it("is true when RESULT_STORAGE=s3", async () => {
    process.env.RESULT_STORAGE = "s3";
    const mod = await import("@/lib/result-store");
    expect(mod.isRemoteResultStore()).toBe(true);
  });

  it("is case-insensitive and trims whitespace", async () => {
    process.env.RESULT_STORAGE = "  S3  ";
    const mod = await import("@/lib/result-store");
    expect(mod.isRemoteResultStore()).toBe(true);
  });
});

describe("maybeUploadResultText (local mode)", () => {
  it("returns inline=text and location=null in local mode", async () => {
    process.env.RESULT_STORAGE = "local";
    const mod = await import("@/lib/result-store");
    const result = await mod.maybeUploadResultText("job-1", "hello world");
    expect(result).toEqual({ inline: "hello world", location: null });
  });

  it("returns inline=null and location=null when text is empty", async () => {
    process.env.RESULT_STORAGE = "local";
    const mod = await import("@/lib/result-store");
    const result = await mod.maybeUploadResultText("job-1", "");
    expect(result).toEqual({ inline: null, location: null });
  });
});

describe("maybeUploadResultJson (local mode)", () => {
  it("returns the value inline in local mode", async () => {
    process.env.RESULT_STORAGE = "local";
    const mod = await import("@/lib/result-store");
    const result = await mod.maybeUploadResultJson("job-1", { foo: 1 });
    expect(result).toEqual({ inline: { foo: 1 }, location: null });
  });

  it("returns null inline when value is undefined in local mode", async () => {
    process.env.RESULT_STORAGE = "local";
    const mod = await import("@/lib/result-store");
    const result = await mod.maybeUploadResultJson("job-1", undefined);
    expect(result).toEqual({ inline: null, location: null });
  });
});

describe("readResultText", () => {
  it("returns inline value when location is null", async () => {
    const mod = await import("@/lib/result-store");
    expect(await mod.readResultText(null, "inline-text")).toBe("inline-text");
  });

  it("returns null when both inputs are null", async () => {
    const mod = await import("@/lib/result-store");
    expect(await mod.readResultText(null, null)).toBe(null);
  });

  it("returns null when both inputs are undefined", async () => {
    const mod = await import("@/lib/result-store");
    expect(await mod.readResultText(undefined, undefined)).toBe(null);
  });

  it("returns null in local mode (LocalResultStore.get returns null)", async () => {
    process.env.RESULT_STORAGE = "local";
    const mod = await import("@/lib/result-store");
    expect(await mod.readResultText("s3://bucket/key", null)).toBe(null);
  });
});

describe("readResultJson", () => {
  it("returns inline value when location is null", async () => {
    const mod = await import("@/lib/result-store");
    expect(await mod.readResultJson(null, { ok: true })).toEqual({ ok: true });
  });

  it("returns null when both inputs are null", async () => {
    const mod = await import("@/lib/result-store");
    expect(await mod.readResultJson(null, null)).toBe(null);
  });

  it("returns null in local mode", async () => {
    process.env.RESULT_STORAGE = "local";
    const mod = await import("@/lib/result-store");
    expect(await mod.readResultJson("s3://bucket/key", null)).toBe(null);
  });
});

describe("readResultText error handling (S3 mode)", () => {
  it("rethrows non-NoSuchKey errors", async () => {
    process.env.RESULT_STORAGE = "s3";
    process.env.S3_BUCKET = "test-bucket";
    const aws = await import("@aws-sdk/client-s3");
    const ClientCtor = aws.S3Client as unknown as new (...args: unknown[]) => {
      sendImpl: ((cmd: unknown) => Promise<unknown>) | null;
    };
    // Pre-create the singleton client and inject sendImpl
    const realClient = new ClientCtor();
    realClient.sendImpl = async () => {
      const err = new Error("Access Denied");
      (err as Error & { name: string }).name = "AccessDenied";
      throw err;
    };
    // Intercept the dynamic import inside getS3Client to return our pre-built client
    vi.doMock("@aws-sdk/client-s3", () => ({
      S3Client: function () { return realClient; },
      PutObjectCommand: class {},
      GetObjectCommand: class {},
      DeleteObjectCommand: class {},
    }));
    const mod = await import("@/lib/result-store");

    await expect(mod.readResultText("s3://test-bucket/key", null)).rejects.toThrow("Access Denied");
  });

  it("returns null on NoSuchKey errors (legitimate 'not found')", async () => {
    process.env.RESULT_STORAGE = "s3";
    process.env.S3_BUCKET = "test-bucket";
    const aws = await import("@aws-sdk/client-s3");
    const ClientCtor = aws.S3Client as unknown as new (...args: unknown[]) => {
      sendImpl: ((cmd: unknown) => Promise<unknown>) | null;
    };
    const realClient = new ClientCtor();
    realClient.sendImpl = async () => {
      const err = new Error("The specified key does not exist.");
      (err as Error & { name: string }).name = "NoSuchKey";
      throw err;
    };
    vi.doMock("@aws-sdk/client-s3", () => ({
      S3Client: function () { return realClient; },
      PutObjectCommand: class {},
      GetObjectCommand: class {},
      DeleteObjectCommand: class {},
    }));
    const mod = await import("@/lib/result-store");

    expect(await mod.readResultText("s3://test-bucket/key", null)).toBe(null);
  });

  it("returns null on NoSuchKey errors via Code field (legacy SDK)", async () => {
    process.env.RESULT_STORAGE = "s3";
    process.env.S3_BUCKET = "test-bucket";
    const aws = await import("@aws-sdk/client-s3");
    const ClientCtor = aws.S3Client as unknown as new (...args: unknown[]) => {
      sendImpl: ((cmd: unknown) => Promise<unknown>) | null;
    };
    const realClient = new ClientCtor();
    realClient.sendImpl = async () => {
      const err = Object.assign(new Error("not found"), { Code: "NoSuchKey" });
      throw err;
    };
    vi.doMock("@aws-sdk/client-s3", () => ({
      S3Client: function () { return realClient; },
      PutObjectCommand: class {},
      GetObjectCommand: class {},
      DeleteObjectCommand: class {},
    }));
    const mod = await import("@/lib/result-store");

    expect(await mod.readResultText("s3://test-bucket/key", null)).toBe(null);
  });
});

describe("readResultJson error handling (S3 mode)", () => {
  it("rethrows non-NoSuchKey errors", async () => {
    process.env.RESULT_STORAGE = "s3";
    process.env.S3_BUCKET = "test-bucket";
    const aws = await import("@aws-sdk/client-s3");
    const ClientCtor = aws.S3Client as unknown as new (...args: unknown[]) => {
      sendImpl: ((cmd: unknown) => Promise<unknown>) | null;
    };
    const realClient = new ClientCtor();
    realClient.sendImpl = async () => {
      const err = new Error("Network unreachable");
      (err as Error & { name: string }).name = "NetworkingError";
      throw err;
    };
    vi.doMock("@aws-sdk/client-s3", () => ({
      S3Client: function () { return realClient; },
      PutObjectCommand: class {},
      GetObjectCommand: class {},
      DeleteObjectCommand: class {},
    }));
    const mod = await import("@/lib/result-store");

    await expect(mod.readResultJson("s3://test-bucket/key", null)).rejects.toThrow("Network unreachable");
  });

  it("returns null on NoSuchKey", async () => {
    process.env.RESULT_STORAGE = "s3";
    process.env.S3_BUCKET = "test-bucket";
    const aws = await import("@aws-sdk/client-s3");
    const ClientCtor = aws.S3Client as unknown as new (...args: unknown[]) => {
      sendImpl: ((cmd: unknown) => Promise<unknown>) | null;
    };
    const realClient = new ClientCtor();
    realClient.sendImpl = async () => {
      const err = new Error("not found");
      (err as Error & { name: string }).name = "NoSuchKey";
      throw err;
    };
    vi.doMock("@aws-sdk/client-s3", () => ({
      S3Client: function () { return realClient; },
      PutObjectCommand: class {},
      GetObjectCommand: class {},
      DeleteObjectCommand: class {},
    }));
    const mod = await import("@/lib/result-store");

    expect(await mod.readResultJson("s3://test-bucket/key", null)).toBe(null);
  });
});

describe("deleteResultArtifacts", () => {
  it("is a no-op in local mode regardless of locations", async () => {
    process.env.RESULT_STORAGE = "local";
    const mod = await import("@/lib/result-store");
    await expect(
      mod.deleteResultArtifacts(["s3://b/k1", "s3://b/k2", null, undefined])
    ).resolves.toBeUndefined();
  });
});
