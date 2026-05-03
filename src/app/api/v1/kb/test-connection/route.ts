import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { getKbDefaults } from "@/lib/kb/defaults-store";
import {
  testVectorStoreConnection,
  type VectorStoreKind,
} from "@/lib/kb/stores/test-connection";

const VALID_STORES = ["chroma", "qdrant", "weaviate"] as const;

interface TestConnectionRequest extends Record<string, unknown> {
  kind?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
}

export const POST = withMutationAuth("kb:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<TestConnectionRequest>(request);
  const kind = body.kind;
  if (typeof kind !== "string" || !(VALID_STORES as readonly string[]).includes(kind)) {
    throw new ApiRouteError(
      `kind must be one of: ${VALID_STORES.join(", ")}`,
      400,
    );
  }
  const baseUrl = body.baseUrl;
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new ApiRouteError("baseUrl (string) is required", 400);
  }
  let apiKey = typeof body.apiKey === "string" && body.apiKey.length > 0 ? body.apiKey : undefined;
  if (!apiKey) {
    const stored = await getKbDefaults(auth.userId);
    if (stored.vectorStore.kind === kind && stored.vectorStore.apiKey) {
      apiKey = stored.vectorStore.apiKey;
    }
  }

  const result = await testVectorStoreConnection({
    kind: kind as VectorStoreKind,
    baseUrl,
    apiKey,
  });
  return NextResponse.json(result);
});
