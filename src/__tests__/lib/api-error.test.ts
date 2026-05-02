import { describe, it, expect } from "vitest";
import { ApiRouteError } from "@/lib/api-error";

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
