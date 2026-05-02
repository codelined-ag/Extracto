import { describe, it, expect } from "vitest";
import { ApiRouteError, handleApiError, parseJsonBody } from "@/lib/api-error";

describe("ApiRouteError", () => {
  it("is an instance of Error", () => {
    const err = new ApiRouteError("something went wrong");
    expect(err).toBeInstanceOf(Error);
  });

  it("is an instance of ApiRouteError", () => {
    const err = new ApiRouteError("something went wrong");
    expect(err).toBeInstanceOf(ApiRouteError);
  });

  it("name is ApiRouteError", () => {
    const err = new ApiRouteError("something went wrong");
    expect(err.name).toBe("ApiRouteError");
  });

  it("message is preserved", () => {
    const err = new ApiRouteError("not found");
    expect(err.message).toBe("not found");
  });

  it("default status is 500", () => {
    const err = new ApiRouteError("internal error");
    expect(err.status).toBe(500);
  });

  it("custom status is used when provided", () => {
    const err = new ApiRouteError("not found", 404);
    expect(err.status).toBe(404);
  });

  it("custom status 400 is preserved", () => {
    const err = new ApiRouteError("bad request", 400);
    expect(err.status).toBe(400);
  });

  it("custom status 401 is preserved", () => {
    const err = new ApiRouteError("unauthorized", 401);
    expect(err.status).toBe(401);
  });

  it("custom status 403 is preserved", () => {
    const err = new ApiRouteError("forbidden", 403);
    expect(err.status).toBe(403);
  });

  it("can be thrown and caught as Error", () => {
    expect(() => {
      throw new ApiRouteError("boom", 422);
    }).toThrow(Error);
  });

  it("can be thrown and caught as ApiRouteError", () => {
    expect(() => {
      throw new ApiRouteError("boom", 422);
    }).toThrow(ApiRouteError);
  });

  it("thrown error retains status", () => {
    try {
      throw new ApiRouteError("conflict", 409);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiRouteError);
      expect((e as ApiRouteError).status).toBe(409);
    }
  });

  it("thrown error retains message", () => {
    try {
      throw new ApiRouteError("teapot", 418);
    } catch (e) {
      expect((e as ApiRouteError).message).toBe("teapot");
    }
  });

  it("stack trace is defined", () => {
    const err = new ApiRouteError("error with stack");
    expect(err.stack).toBeDefined();
  });
});

describe("handleApiError", () => {
  it("returns a NextResponse with status 500 for unknown errors", async () => {
    const response = handleApiError("not an error");
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Internal server error");
  });

  it("returns 500 with the error message for a generic Error", async () => {
    const response = handleApiError(new Error("boom"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("boom");
  });

  it("uses the ApiRouteError status code", async () => {
    const response = handleApiError(new ApiRouteError("not found", 404));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("not found");
  });

  it("uses ApiRouteError status 400", async () => {
    const response = handleApiError(new ApiRouteError("bad request", 400));
    expect(response.status).toBe(400);
  });

  it("uses ApiRouteError status 422", async () => {
    const response = handleApiError(new ApiRouteError("unprocessable", 422));
    expect(response.status).toBe(422);
  });

  it("returns 500 for a thrown string", async () => {
    const response = handleApiError("string error");
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Internal server error");
  });

  it("returns 500 for a thrown null", async () => {
    const response = handleApiError(null);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Internal server error");
  });

  it("returns 500 for a thrown undefined", async () => {
    const response = handleApiError(undefined);
    expect(response.status).toBe(500);
  });

  it("returns 500 for a thrown plain object", async () => {
    const response = handleApiError({ message: "oops" });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Internal server error");
  });

  it("preserves Error subclass messages (e.g. TypeError)", async () => {
    const response = handleApiError(new TypeError("wrong type"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("wrong type");
  });

  it("returns content-type application/json", async () => {
    const response = handleApiError(new ApiRouteError("test", 400));
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
  });
});

describe("parseJsonBody", () => {
  const mkRequest = (json: () => Promise<unknown>) => ({ json }) as { json: () => Promise<unknown> };

  it("returns parsed object when valid JSON", async () => {
    const body = await parseJsonBody<{ foo: string }>(mkRequest(async () => ({ foo: "bar" })));
    expect(body).toEqual({ foo: "bar" });
  });

  it("returns empty object when json() throws", async () => {
    const body = await parseJsonBody(mkRequest(async () => { throw new Error("invalid json"); }));
    expect(body).toEqual({});
  });

  it("returns empty object when json() resolves to null", async () => {
    const body = await parseJsonBody(mkRequest(async () => null));
    expect(body).toEqual({});
  });

  it("returns empty object when json() resolves to a primitive", async () => {
    const body = await parseJsonBody(mkRequest(async () => "not an object"));
    expect(body).toEqual({});
  });

  it("returns empty object when json() resolves to an array", async () => {
    const body = await parseJsonBody(mkRequest(async () => [1, 2, 3]));
    expect(body).toEqual({});
  });

  it("preserves all fields from the parsed object", async () => {
    const body = await parseJsonBody<{ a: number; b: boolean; c: string }>(
      mkRequest(async () => ({ a: 1, b: true, c: "x" }))
    );
    expect(body).toEqual({ a: 1, b: true, c: "x" });
  });

  it("returns Partial<T> typing — undefined fields are allowed", async () => {
    const body = await parseJsonBody<{ required: string }>(mkRequest(async () => ({})));
    expect(body.required).toBeUndefined();
  });

  it("returns empty object when json() resolves to undefined", async () => {
    const body = await parseJsonBody(mkRequest(async () => undefined));
    expect(body).toEqual({});
  });

  it("returns empty object for number primitives (0)", async () => {
    expect(await parseJsonBody(mkRequest(async () => 0))).toEqual({});
  });

  it("returns empty object for boolean primitives (false)", async () => {
    expect(await parseJsonBody(mkRequest(async () => false))).toEqual({});
  });

  it("returns empty object for NaN", async () => {
    expect(await parseJsonBody(mkRequest(async () => NaN))).toEqual({});
  });

  it("preserves valid empty object as-is", async () => {
    // distinguishes 'parse failed' from 'parsed but empty' — both end up as {}
    // but the distinction is preserved by returning the parsed value when it's
    // a plain object.
    const body = await parseJsonBody(mkRequest(async () => ({})));
    expect(body).toEqual({});
  });

  it("returns empty object when json() rejects with a non-Error value", async () => {
    expect(await parseJsonBody(mkRequest(async () => { throw "string-not-error"; }))).toEqual({});
  });

  it("preserves nested objects verbatim", async () => {
    const nested = { a: { b: { c: 1 } } };
    const body = await parseJsonBody<{ a: unknown }>(mkRequest(async () => nested));
    expect(body.a).toEqual({ b: { c: 1 } });
  });

  it("does NOT sanitize __proto__ / constructor keys (callers must validate)", async () => {
    const body = await parseJsonBody<Record<string, unknown>>(
      mkRequest(async () => ({ __proto__: { polluted: true }, constructor: "x" })),
    );
    // The helper preserves keys verbatim; downstream code is responsible for
    // not blindly merging them into trusted objects.
    expect("constructor" in body).toBe(true);
  });
});
