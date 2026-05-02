import { NextResponse } from "next/server";

// Helper for the common pattern of parsing a request body that may fail.
// Returns a Partial<T> so the call site narrows individual fields with
// typeof guards. Centralizing this in one place lets us swap the parsing
// strategy (e.g. add Zod validation) without touching every handler.
export async function parseJsonBody<T extends Record<string, unknown>>(
  request: { json: () => Promise<unknown> },
): Promise<Partial<T>> {
  try {
    const raw = await request.json();
    return (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Partial<T>;
  } catch {
    return {};
  }
}

export class ApiRouteError extends Error {
  public status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ApiRouteError";
    this.status = status;
  }
}

export function handleApiError(error: unknown): NextResponse {
  const status = error instanceof ApiRouteError ? error.status : 500;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Internal server error" },
    { status }
  );
}
