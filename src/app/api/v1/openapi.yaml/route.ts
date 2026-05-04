import { readFileSync } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

const SPEC = readFileSync(path.join(process.cwd(), "openapi.yaml"), "utf8");

export function GET() {
  return new NextResponse(SPEC, {
    status: 200,
    headers: {
      "content-type": "application/yaml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
