import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/request", () => ({
  authenticateMutation: vi.fn(),
  authHasScope: vi.fn(),
}));

vi.mock("@/lib/ocr/rate-limit", () => ({
  enforceOcrSubmitRateLimit: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/request-security", () => ({
  getClientIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/db", () => ({
  db: {
    ocrJob: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ocr/result-store", () => ({
  readResultText: vi.fn(),
}));

vi.mock("@/lib/ocr/settings-store", () => ({
  getApiSettings: vi.fn().mockResolvedValue({
    provider: "ollama",
    apiEndpoint: "http://o",
    apiKey: "",
  }),
}));

vi.mock("@/lib/ocr/pipeline", () => ({
  buildPrompt: vi.fn().mockReturnValue("PROMPT"),
  sanitizePostProcessing: vi.fn().mockImplementation((v) => ({
    enabled: !!v,
    outputFormat: "markdown",
    instruction: v?.instruction ?? "",
    model: "",
  })),
  submitOcrJob: vi.fn(),
}));

vi.mock("@/lib/ocr/providers/mistral", () => ({
  resolveMistralOcrModel: (m: string) => m,
}));

import { authenticateMutation, authHasScope } from "@/lib/auth/request";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { db } from "@/lib/db";
import { readResultText } from "@/lib/ocr/result-store";
import { submitOcrJob } from "@/lib/ocr/pipeline";
import { POST } from "@/app/api/v1/openai/chat/completions/route";

const mockedAuth = authenticateMutation as ReturnType<typeof vi.fn>;
const mockedScope = authHasScope as ReturnType<typeof vi.fn>;
const mockedRateLimit = enforceOcrSubmitRateLimit as ReturnType<typeof vi.fn>;
const mockedFindUnique = db.ocrJob.findUnique as ReturnType<typeof vi.fn>;
const mockedReadText = readResultText as ReturnType<typeof vi.fn>;
const mockedSubmit = submitOcrJob as ReturnType<typeof vi.fn>;

const fakeAuth = {
  method: "api-key" as const,
  userId: "user-1",
  apiKeyId: "key-1",
  scopes: ["*"],
};

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/v1/openai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedAuth.mockReset().mockResolvedValue({ ok: true, auth: fakeAuth });
  mockedScope.mockReset().mockReturnValue(true);
  mockedRateLimit.mockReset().mockReturnValue(null);
  mockedFindUnique.mockReset();
  mockedReadText.mockReset().mockResolvedValue(null);
  mockedSubmit.mockReset().mockResolvedValue({ jobId: "job-stub", pageCount: 1 });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("POST /api/v1/openai/chat/completions", () => {
  it("returns authentication_error when authenticateMutation rejects", async () => {
    mockedAuth.mockResolvedValueOnce({ ok: false, error: "missing token", status: 401 });
    const res = await POST(makeRequest({ model: "x", messages: [] }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toEqual({ message: "missing token", type: "authentication_error" });
  });

  it("returns permission_error when the API key lacks the ocr:submit scope", async () => {
    mockedScope.mockReturnValueOnce(false);
    const res = await POST(makeRequest({ model: "x", messages: [] }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.type).toBe("permission_error");
  });

  it("returns rate_limit_error when the rate limiter trips", async () => {
    mockedRateLimit.mockReturnValueOnce(
      new Response(null, { status: 429 }),
    );
    const res = await POST(makeRequest({ model: "x", messages: [] }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.type).toBe("rate_limit_error");
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it("returns invalid_request_error when the body is not JSON", async () => {
    const res = await POST(makeRequest("not-json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("returns invalid_request_error when model is missing or empty", async () => {
    const res = await POST(makeRequest({ messages: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/model is required/);
  });

  it("rejects text-only messages (no image_url part)", async () => {
    const res = await POST(
      makeRequest({
        model: "claude",
        messages: [{ role: "user", content: "hello" }],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/image_url/);
  });

  it("submits the job and returns an OpenAI-shaped chat completion when the job completes", async () => {
    mockedFindUnique.mockResolvedValueOnce({
      status: "COMPLETED",
      extractedText: "extracted body",
      extractedTextLocation: null,
      errorMessage: null,
    });
    mockedReadText.mockResolvedValueOnce("extracted body");

    const res = await POST(
      makeRequest({
        model: "claude",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "tell me what's in this" },
              { type: "image_url", image_url: { url: "data:image/png;base64,xxx" } },
            ],
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("claude");
    expect(body.choices[0].message.content).toBe("extracted body");
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.extracto.jobId).toBe("job-stub");

    const submitArgs = mockedSubmit.mock.calls[0][0];
    expect(submitArgs.fileName).toBe("openai-adapter");
    expect(submitArgs.inputPreviews).toEqual(["data:image/png;base64,xxx"]);
    expect(submitArgs.userId).toBe("user-1");
  });

  it("returns 502 when the job ends in FAILED status", async () => {
    mockedFindUnique.mockResolvedValueOnce({
      status: "FAILED",
      extractedText: null,
      extractedTextLocation: null,
      errorMessage: "provider 500",
    });

    const res = await POST(
      makeRequest({
        model: "claude",
        messages: [
          { role: "user", content: [{ type: "image_url", image_url: { url: "data:img" } }] },
        ],
      }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.message).toBe("provider 500");
    expect(body.extracto.jobId).toBe("job-stub");
  });

  it("returns 502 when submitOcrJob throws (api_error)", async () => {
    mockedSubmit.mockRejectedValueOnce(new Error("queue full"));
    const res = await POST(
      makeRequest({
        model: "claude",
        messages: [
          { role: "user", content: [{ type: "image_url", image_url: { url: "data:img" } }] },
        ],
      }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.type).toBe("api_error");
  });
});
