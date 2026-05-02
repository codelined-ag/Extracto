import { NextResponse } from "next/server";

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
