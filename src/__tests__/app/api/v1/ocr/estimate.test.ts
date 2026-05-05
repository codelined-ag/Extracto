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
  enforceOcrSubmitRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/request-security", () => ({
  getClientIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/ocr/settings-store", () => ({
  getApiSettings: vi.fn().mockResolvedValue({
    provider: "mistral",
    apiEndpoint: "https://api.mistral.ai",
    apiKey: "",
  }),
}));

import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { POST } from "@/app/api/v1/ocr/estimate/route";

const mockedRateLimit = enforceOcrSubmitRateLimit as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/v1/ocr/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedRateLimit.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/v1/ocr/estimate", () => {
  it("rejects a non-array files field with 400", async () => {
    const res = await POST(makeRequest({ files: "nope", model: "mistral-ocr-latest" }));
    expect(res.status).toBe(400);
  });

  it("rejects an empty files array with 400", async () => {
    const res = await POST(makeRequest({ files: [], model: "mistral-ocr-latest" }));
    expect(res.status).toBe(400);
  });

  it("rejects more than 200 files with 400", async () => {
    const files = Array.from({ length: 201 }, () => ({ pageCount: 1 }));
    const res = await POST(makeRequest({ files, model: "mistral-ocr-latest" }));
    expect(res.status).toBe(400);
  });

  it("rejects a file with pageCount over the per-file ceiling", async () => {
    const res = await POST(makeRequest({ files: [{ pageCount: 5001 }], model: "mistral-ocr-latest" }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown provider with 400", async () => {
    const res = await POST(
      makeRequest({ files: [{ pageCount: 1 }], model: "mistral-ocr-latest", provider: "claude" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/provider must be one of/);
  });

  it("rejects a missing model with 400", async () => {
    const res = await POST(makeRequest({ files: [{ pageCount: 1 }] }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/model is required/);
  });

  it("returns a $0 ollama estimate with the local-source warning", async () => {
    const res = await POST(
      makeRequest({
        files: [{ pageCount: 10 }],
        model: "qwen2.5vl:7b",
        provider: "ollama",
        apiEndpoint: "http://127.0.0.1:11434",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      ocr: { pricing: { source: string; warnings: string[] } };
      warnings: string[];
    };
    expect(body.total).toBe(0);
    expect(body.ocr.pricing.source).toBe("ollama-local");
    expect(body.warnings.some((w) => /Local Ollama/.test(w))).toBe(true);
  });

  it("returns the static Mistral OCR per-page rate", async () => {
    const res = await POST(
      makeRequest({
        files: [{ pageCount: 100, fileName: "report.pdf" }],
        model: "mistral-ocr-latest",
        provider: "mistral",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalPages: number;
      total: number;
      ocr: { pricing: { source: string; inputCostPerPage: number } };
    };
    expect(body.totalPages).toBe(100);
    expect(body.total).toBe(0.1);
    expect(body.ocr.pricing.source).toBe("mistral-static");
    expect(body.ocr.pricing.inputCostPerPage).toBe(0.001);
  });

  it("includes a per-file breakdown sum that matches the OCR total", async () => {
    const res = await POST(
      makeRequest({
        files: [
          { pageCount: 7, fileName: "a.pdf" },
          { pageCount: 13, fileName: "b.pdf" },
        ],
        model: "mistral-ocr-latest",
        provider: "mistral",
      }),
    );
    const body = (await res.json()) as {
      ocr: { totalCost: number };
      files: Array<{ fileName?: string; pageCount: number; cost: { totalCost: number } }>;
      totalPages: number;
    };
    expect(body.totalPages).toBe(20);
    const sumPerFile = body.files.reduce((s, f) => s + f.cost.totalCost, 0);
    expect(Math.abs(sumPerFile - body.ocr.totalCost)).toBeLessThan(1e-6);
  });

  it("includes a postProcessing breakdown when enabled", async () => {
    const res = await POST(
      makeRequest({
        files: [{ pageCount: 5 }],
        model: "mistral-ocr-latest",
        provider: "mistral",
        postProcessing: { enabled: true, model: "mistral-ocr-latest", outputFormat: "markdown" },
      }),
    );
    const body = (await res.json()) as {
      total: number;
      ocr: { totalCost: number };
      postProcessing: { totalCost: number } | null;
    };
    expect(body.postProcessing).not.toBeNull();
    expect(body.total).toBeCloseTo(body.ocr.totalCost + (body.postProcessing?.totalCost ?? 0), 6);
  });

  it("propagates a 429 from the rate limiter without computing the estimate", async () => {
    mockedRateLimit.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await POST(
      makeRequest({ files: [{ pageCount: 1 }], model: "mistral-ocr-latest", provider: "mistral" }),
    );
    expect(res.status).toBe(429);
  });
});
