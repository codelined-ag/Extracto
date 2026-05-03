import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/request", () => ({
  withAuth: vi.fn(),
  withMutationAuth: <P,>(_scope: string, handler: (req: NextRequest, ctx: { auth: unknown; params: Promise<P> }) => Promise<Response>) => {
    return async (req: NextRequest) => {
      const auth = currentAuthOverride ?? {
        method: "api-key",
        userId: "user-1",
        apiKeyId: "key-1",
        scopes: ["*"],
      };
      if (auth instanceof Response) return auth;
      try {
        return await handler(req, { auth, params: Promise.resolve({} as P) });
      } catch (error) {
        if (error instanceof Error && "status" in error) {
          const status = (error as { status?: number }).status ?? 500;
          return new Response(JSON.stringify({ error: error.message }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    };
  },
}));

let currentAuthOverride: unknown = null;

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

vi.mock("@/lib/api-types", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-types")>("@/lib/api-types");
  return {
    ...actual,
    normalizeProvider: (p: unknown) => p ?? "ollama",
  };
});

vi.mock("@/lib/ocr/endpoint-policy", () => ({
  enforceProviderEndpointPolicy: vi.fn().mockImplementation((_p: unknown, host: string) => host),
}));

vi.mock("@/lib/ocr/host-normalization", () => ({
  resolveOllamaHostEndpoint: (host: string) => host,
  getFallbackOllamaHost: () => "http://localhost:11434",
}));

vi.mock("@/lib/ocr/job-input-helpers", () => ({
  buildPrompt: vi.fn().mockReturnValue("PROMPT"),
  normalizePreviewForHistory: vi.fn().mockReturnValue("data:preview"),
  sanitizePostProcessing: vi.fn().mockReturnValue({
    enabled: false,
    outputFormat: "markdown",
    instruction: "",
    model: "",
  }),
}));

vi.mock("@/lib/ocr/job-submit", () => ({
  submitOcrJob: vi.fn(),
  resumeOcrJob: vi.fn(),
}));

vi.mock("@/lib/ocr/model-catalog", () => ({
  getModelCatalog: vi.fn(),
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

import { ApiRouteError } from "@/lib/api-error";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { resumeOcrJob, submitOcrJob } from "@/lib/ocr/job-submit";
import { POST } from "@/app/api/ocr/route";

const mockedRateLimit = enforceOcrSubmitRateLimit as ReturnType<typeof vi.fn>;
const mockedSubmit = submitOcrJob as ReturnType<typeof vi.fn>;
const mockedResume = resumeOcrJob as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  currentAuthOverride = null;
  mockedRateLimit.mockReset().mockReturnValue(null);
  mockedSubmit.mockReset().mockResolvedValue({ jobId: "job-stub", pageCount: 1 });
  mockedResume.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/ocr", () => {
  it("returns the auth error when authentication fails (wrapper short-circuits)", async () => {
    currentAuthOverride = new Response(JSON.stringify({ error: "no session" }), { status: 401 });
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

  it("returns 404 when resumeOcrJob throws not-found ApiRouteError", async () => {
    mockedResume.mockRejectedValueOnce(new ApiRouteError("Resume job not found", 404));
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

  it("returns 409 when resumeOcrJob throws already-processing ApiRouteError", async () => {
    mockedResume.mockRejectedValueOnce(new ApiRouteError("Job is already processing", 409));
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

  it("returns 202 with resumed=true + pageRecords from resumeOcrJob", async () => {
    mockedResume.mockResolvedValueOnce({ jobId: "job-resume", pageCount: 3, pageRecords: 1 });
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
    expect(body.jobId).toBe("job-resume");

    expect(mockedResume).toHaveBeenCalledTimes(1);
    const args = mockedResume.mock.calls[0][0];
    expect(args.jobId).toBe("job-resume");
    expect(args.userId).toBe("user-1");
    expect(args.inputPreviews).toEqual(["data:p1", "data:p2", "data:p3"]);
  });

  it("surfaces the all-checkpointed ApiRouteError from resumeOcrJob as 400", async () => {
    mockedResume.mockRejectedValueOnce(
      new ApiRouteError("All pages were already checkpointed for this job", 400),
    );
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
  });

  it("rejects resume=true with no jobId", async () => {
    const res = await POST(
      makeRequest({
        model: "m",
        preview: "data:image/png;base64,x",
        resume: true,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/jobId is required/);
    expect(mockedResume).not.toHaveBeenCalled();
  });
});
