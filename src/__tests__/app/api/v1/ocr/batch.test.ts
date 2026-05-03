import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/request", () => ({
  withMutationAuth: <P,>(_scope: string, handler: (req: NextRequest, ctx: { auth: unknown; params: Promise<P> }) => Promise<Response>) => {
    return async (req: NextRequest) => {
      try {
        return await handler(req, {
          auth: { method: "api-key", userId: "user-1", apiKeyId: "key-1", scopes: ["*"] },
          params: Promise.resolve({} as P),
        });
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
}));

vi.mock("@/lib/ocr/providers/mistral", () => ({
  resolveMistralOcrModel: (m: string) => m,
}));

import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { submitOcrJob } from "@/lib/ocr/job-submit";
import { POST } from "@/app/api/v1/ocr/batch/route";

const mockedRateLimit = enforceOcrSubmitRateLimit as ReturnType<typeof vi.fn>;
const mockedSubmit = submitOcrJob as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/v1/ocr/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedRateLimit.mockReset().mockReturnValue(null);
  mockedSubmit.mockReset().mockResolvedValue({ jobId: "job-stub", pageCount: 1 });
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/v1/ocr/batch", () => {
  it("rejects a missing or non-object body with a 400", async () => {
    const res = await POST(makeRequest("not-an-object" as unknown as object));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid JSON payload/);
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it("rejects a body without a files array", async () => {
    const res = await POST(makeRequest({ wrong: "shape" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/files must be an array/);
  });

  it("rejects an empty files array", async () => {
    const res = await POST(makeRequest({ files: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/files array is empty/);
  });

  it("rejects batches over the 50-file cap", async () => {
    const files = Array.from({ length: 51 }, (_, i) => ({
      fileName: `f${i}.png`,
      preview: "data:image/png;base64,xx",
      model: "llama-vision",
    }));
    const res = await POST(makeRequest({ files }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Maximum of 50/);
  });

  it("rejects file entries missing fileName / preview / model", async () => {
    const res = await POST(
      makeRequest({
        files: [{ fileName: "doc.png" }],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/fileName, preview, and model/);
  });

  it("returns the 429 response from the rate limiter without calling submitOcrJob", async () => {
    mockedRateLimit.mockReturnValueOnce(
      new Response(JSON.stringify({ error: "rate limit" }), { status: 429 }),
    );
    const res = await POST(
      makeRequest({
        files: [{ fileName: "a.png", preview: "data:image/png;base64,x", model: "m" }],
      }),
    );
    expect(res.status).toBe(429);
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it("submits each valid file and returns jobIds keyed by filename", async () => {
    mockedSubmit
      .mockResolvedValueOnce({ jobId: "job-1", pageCount: 1 })
      .mockResolvedValueOnce({ jobId: "job-2", pageCount: 3 });

    const res = await POST(
      makeRequest({
        files: [
          { fileName: "a.png", preview: "data:image/png;base64,a", model: "m" },
          {
            fileName: "b.pdf",
            preview: "data:application/pdf;base64,b",
            pages: ["p1", "p2", "p3"],
            model: "m",
            priority: 5,
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batchId).toMatch(/^batch_/);
    expect(body.submissions).toHaveLength(2);
    expect(body.submissions[0]).toEqual({ fileName: "a.png", jobId: "job-1" });
    expect(body.submissions[1]).toEqual({ fileName: "b.pdf", jobId: "job-2" });

    expect(mockedSubmit).toHaveBeenCalledTimes(2);
    const firstCall = mockedSubmit.mock.calls[0][0];
    expect(firstCall.userId).toBe("user-1");
    expect(firstCall.apiKeyId).toBe("key-1");
    expect(firstCall.fileName).toBe("a.png");
    expect(firstCall.priority).toBe(0);
    expect(firstCall.batchId).toBe(body.batchId);

    const secondCall = mockedSubmit.mock.calls[1][0];
    expect(secondCall.priority).toBe(5);
    expect(secondCall.inputPreviews).toEqual(["p1", "p2", "p3"]);
  });

  it("clamps file.priority into [-10, 10] and floors fractional values", async () => {
    await POST(
      makeRequest({
        files: [
          { fileName: "a.png", preview: "data:image/png;base64,x", model: "m", priority: 99 },
          { fileName: "b.png", preview: "data:image/png;base64,x", model: "m", priority: -50 },
          { fileName: "c.png", preview: "data:image/png;base64,x", model: "m", priority: 3.7 },
        ],
      }),
    );

    expect(mockedSubmit.mock.calls[0][0].priority).toBe(10);
    expect(mockedSubmit.mock.calls[1][0].priority).toBe(-10);
    expect(mockedSubmit.mock.calls[2][0].priority).toBe(3);
  });

  it("captures per-file submitOcrJob errors as inline submissions[].error and continues the batch", async () => {
    mockedSubmit
      .mockResolvedValueOnce({ jobId: "job-good", pageCount: 1 })
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce({ jobId: "job-good-2", pageCount: 1 });

    const res = await POST(
      makeRequest({
        files: [
          { fileName: "a.png", preview: "data:image/png;base64,a", model: "m" },
          { fileName: "b.png", preview: "data:image/png;base64,b", model: "m" },
          { fileName: "c.png", preview: "data:image/png;base64,c", model: "m" },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submissions).toEqual([
      { fileName: "a.png", jobId: "job-good" },
      { fileName: "b.png", error: "provider down" },
      { fileName: "c.png", jobId: "job-good-2" },
    ]);
  });
});
