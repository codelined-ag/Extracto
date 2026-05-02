import { NextRequest, NextResponse } from "next/server";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function isRequestSecure(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = (forwardedProto ? forwardedProto.split(",")[0].trim() : request.nextUrl.protocol)
    .replace(":", "");
  return protocol === "https";
}

export function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": `${retryAfterSeconds}`,
      },
    }
  );
}
