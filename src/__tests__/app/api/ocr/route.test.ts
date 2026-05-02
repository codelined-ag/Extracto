import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/request", () => ({
  authenticateMutation: vi.fn(),
  requireScope: vi.fn().mockReturnValue(null),
  withAuth: vi.fn(),
}));

vi.mock("@/lib/ocr/rate-limit", () => ({
  enforceOcrSubmitRateLimit: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/request-security", () => ({
  getClientIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/ocr/settings-store", () => ({
  getApiSettings: vi.fn().mockResolvedValue({
    provider: "ollama",
    apiEndpoint: "http://o",
    apiKey: "",
  }),
}));

vi.mock("@/lib/ocr/endpoint-policy", () => ({
  enforceProviderEndpointPolicy: vi.fn().mockImplementation((_p: unknown, host: string) => host),
  normalizeProvider: (p: unknown) => p ?? "ollama",
  ProviderKind: undefined,
}));

vi.mock("@/lib/ocr/host-normalization", () => ({
  resolveOllamaHostEndpoint: (host: string) => host,
}));

vi.mock("@/lib/ocr/job-control", () => ({
  withOcrJobSlot: vi.fn().mockImplementation(async (_p: number, fn: () => Promise<unknown>) => {
    await fn();
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    ocrJob: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/ocr/pipeline", () => ({
  buildProgressMetadata: vi.fn().mockReturnValue({}),
  buildPrompt: vi.fn().mockReturnValue("PROMPT"),
  ocrStageProgressPct: vi.fn().mockReturnValue(0),
  getModelCatalog: vi.fn(),
  normalizePreviewForHistory: vi.fn().mockReturnValue("data:preview"),
  getOllamaDiscoveryFallbackHost: vi.fn().mockReturnValue("http://localhost:11434"),
  parseCheckpointPages: vi.fn().mockReturnValue([]),
  processOcrJobInBackground: vi.fn().mockResolvedValue(undefined),
  sanitizePostProcessing: vi.fn().mockReturnValue({
    enabled: false,
    outputFormat: "markdown",
    instruction: "",
    model: "",
  }),
  submitOcrJob: vi.fn(),
  toJsonValue: (v: unknown) => v,
}));

vi.mock("@/lib/ocr/job-seed", () => ({
  seedPostProcessingMeta: () => ({ enabled: false }),
}));

vi.mock("@/lib/ocr/providers/mistral", () => ({
  resolveMistralOcrModel: (m: string) => m,
  normalizeMistralApiBase: (host: string) => host,
}));

vi.mock("@/lib/ocr/providers/compat", () => ({
  normalizeOpenAICompatApiBase: (h: string) => h,
  normalizeOpenRouterApiBase: (h: string) => h,
}));

vi.mock("@/lib/ocr/provider-config", () => ({
  getDefaultMistralApiUrl: () => "http://m",
  getDefaultOpenAICompatApiUrl: () => "http://c",
  getDefaultOpenRouterApiUrl: () => "http://or",
}));

import { authenticateMutation, requireScope } from "@/lib/auth/request";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { db } from "@/lib/db";
import {
  parseCheckpointPages,
  processOcrJobInBackground,
  submitOcrJob,
} from "@/lib/ocr/pipeline";
import { POST } from "@/app/api/ocr/route";

const mockedAuth = authenticateMutation as ReturnType<typeof vi.fn>;
const mockedScope = requireScope as ReturnType<typeof vi.fn>;
const mockedRateLimit = enforceOcrSubmitRateLimit as ReturnType<typeof vi.fn>;
const mockedFindFirst = db.ocrJob.findFirst as ReturnType<typeof vi.fn>;
const mockedJobUpdate = db.ocrJob.update as ReturnType<typeof vi.fn>;
const mockedSubmit = submitOcrJob as ReturnType<typeof vi.fn>;
const mockedParseCheckpoints = parseCheckpointPages as ReturnType<typeof vi.fn>;
const mockedBackground = processOcrJobInBackground as ReturnType<typeof vi.fn>;

const fakeAuth = {
  method: "api-key" as const,
  userId: "user-1",
  apiKeyId: "key-1",
  scopes: ["*"],
};

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedAuth.mockReset().mockResolvedValue({ ok: true, auth: fakeAuth });
  mockedScope.mockReset().mockReturnValue(null);
  mockedRateLimit.mockReset().mockReturnValue(null);
  mockedFindFirst.mockReset();
  mockedJobUpdate.mockReset().mockResolvedValue({});
  mockedSubmit.mockReset().mockResolvedValue({ jobId: "job-stub", pageCount: 1 });
  mockedParseCheckpoints.mockReset().mockReturnValue([]);
  mockedBackground.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/ocr", () => {
  it("returns the auth error when authenticateMutation rejects", async () => {
    mockedAuth.mockResolvedValueOnce({ ok: false, error: "no session", status: 401 });
    const res = await POST(
      makeRequest({ model: "m", preview: "data:image/png;base64,x" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns the rate-limit response when the limiter trips", async () => {
    mockedRateLimit.mockReturnValueOnce(
      new Response(JSON.stringify({ error: "rate limit" }), { status: 429 }),
    );
    const res = await POST(
      makeRequest({ model: "m", preview: "data:image/png;base64,x" }),
    );
    expect(res.status).toBe(429);
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it("rejects a non-object body with 400", async () => {
    const res = await POST(makeRequest("not-json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid JSON/);
  });

  it("rejects a missing model with 400", async () => {
    const res = await POST(makeRequest({ preview: "data:image/png;base64,x" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Model is required/);
  });

  it("rejects a request with neither preview nor pages with 400", async () => {
    const res = await POST(makeRequest({ model: "m" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No image preview/);
  });

  it("submits a valid single-preview request and returns 202 + jobId + pageCount", async () => {
    mockedSubmit.mockResolvedValueOnce({ jobId: "job-42", pageCount: 1 });
    const res = await POST(
      makeRequest({
        model: "llama-vision",
        preview: "data:image/png;base64,abc",
        priority: 3,
      }),
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "PROCESSING",
      jobId: "job-42",
      pageCount: 1,
    });
    const args = mockedSubmit.mock.calls[0][0];
    expect(args.priority).toBe(3);
    expect(args.userId).toBe("user-1");
    expect(args.inputPreviews).toEqual(["data:image/png;base64,abc"]);
  });

  it("clamps priority into [-10, 10] and trims oversized batchId to 64 chars", async () => {
    await POST(
      makeRequest({
        model: "m",
        preview: "data:image/png;base64,x",
        priority: 999,
        batchId: "b".repeat(80),
      }),
    );
    const args = mockedSubmit.mock.calls[0][0];
    expect(args.priority).toBe(10);
    expect(args.batchId).toHaveLength(64);
  });

  it("prefers pages[] over preview when both are supplied, dropping empty entries", async () => {
    await POST(
      makeRequest({
        model: "m",
        preview: "data:image/png;base64,fallback",
        pages: ["data:image/png;base64,p1", "", "data:image/png;base64,p2"],
      }),
    );
    const args = mockedSubmit.mock.calls[0][0];
    expect(args.inputPreviews).toEqual([
      "data:image/png;base64,p1",
      "data:image/png;base64,p2",
    ]);
  });

  it("returns 404 when resume=true references a missing job", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest({
        model: "m",
        preview: "data:image/png;base64,x",
        resume: true,
        jobId: "missing",
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/Resume job not found/);
  });

  it("returns 409 when resuming a job that is already PROCESSING", async () => {
    mockedFindFirst.mockResolvedValueOnce({
      id: "job-x",
      status: "PROCESSING",
      result: null,
      metadata: null,
      priority: 0,
    });
    const res = await POST(
      makeRequest({
        model: "m",
        preview: "data:image/png;base64,x",
        resume: true,
        jobId: "job-x",
      }),
    );
    expect(res.status).toBe(409);
  });

  it("resumes a queued job, marks it PROCESSING in the DB and dispatches the background pipeline", async () => {
    mockedFindFirst.mockResolvedValueOnce({
      id: "job-resume",
      status: "QUEUED",
      result: null,
      metadata: null,
      priority: 5,
    });
    mockedParseCheckpoints.mockReturnValueOnce([
      {
        pageNumber: 1,
        text: "page1 text",
        structured: { markdown: "page1 text" },
        durationMs: 100,
        metadata: {},
      },
    ]);

    const res = await POST(
      makeRequest({
        model: "llama-vision",
        pages: ["data:p1", "data:p2", "data:p3"],
        resume: true,
        jobId: "job-resume",
      }),
    );

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.resumed).toBe(true);
    expect(body.pageRecords).toBe(1);
    expect(body.pageCount).toBe(3);

    expect(mockedJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-resume" },
        data: expect.objectContaining({ status: "PROCESSING" }),
      }),
    );
    expect(mockedBackground).toHaveBeenCalled();
    const bgArgs = mockedBackground.mock.calls[0][0];
    expect(bgArgs.jobId).toBe("job-resume");
    expect(bgArgs.startIndex).toBe(1);
    expect(bgArgs.resumed).toBe(true);
  });

  it("rejects resume when every page is already checkpointed", async () => {
    mockedFindFirst.mockResolvedValueOnce({
      id: "job-done",
      status: "QUEUED",
      result: null,
      metadata: null,
      priority: 0,
    });
    mockedParseCheckpoints.mockReturnValueOnce([
      { pageNumber: 1, text: "x", structured: { markdown: "x" }, durationMs: 0, metadata: {} },
      { pageNumber: 2, text: "y", structured: { markdown: "y" }, durationMs: 0, metadata: {} },
    ]);
    const res = await POST(
      makeRequest({
        model: "m",
        pages: ["p1", "p2"],
        resume: true,
        jobId: "job-done",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already checkpointed/);
    expect(mockedBackground).not.toHaveBeenCalled();
  });
});
