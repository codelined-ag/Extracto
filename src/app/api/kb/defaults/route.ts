// /api/kb/defaults — browser-UI-internal CRUD for per-user KB export
// defaults (embedding provider/model, chunking strategy + sizes, vector
// store baseUrl + key, collection-name template). Session-cookie auth.
//
// Sibling /api/v1/export/kb is the headless bearer-auth surface that
// actually performs an export — it is intentionally NOT changed by edits
// here. UI defaults live next to OCR settings on disk; the headless
// caller may or may not consult them.

import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import {
  getKbDefaults,
  saveKbDefaults,
  toClientKbDefaults,
  type SaveKbDefaultsInput,
} from "@/lib/kb/defaults-store";

export const GET = withAuth("settings:read", async (_request: NextRequest, { auth }) => {
  const defaults = await getKbDefaults(auth.userId);
  return NextResponse.json(toClientKbDefaults(defaults));
});

export const PUT = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<SaveKbDefaultsInput>(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiRouteError("Invalid JSON payload", 400);
  }
  const saved = await saveKbDefaults(auth.userId, body);
  return NextResponse.json(toClientKbDefaults(saved));
});
