import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { getKbDefaults } from "@/lib/kb/defaults-store";
import {
  testVectorStoreConnection,
  type VectorStoreKind,
} from "@/lib/kb/stores/test-connection";
import { enforceVectorStoreEndpointPolicy } from "@/lib/ocr/endpoint-policy";

const VALID_STORES = ["chroma", "qdrant", "weaviate", "milvus", "opensearch", "pinecone"] as const;

interface TestConnectionRequest extends Record<string, unknown> {
  kind?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

export async function handleKbTestConnection(
  request: NextRequest,
  userId: string,
): Promise<NextResponse> {
  const body = await parseJsonBody<TestConnectionRequest>(request);
  const kind = body.kind;
  if (typeof kind !== "string" || !(VALID_STORES as readonly string[]).includes(kind)) {
    throw new ApiRouteError(`kind must be one of: ${VALID_STORES.join(", ")}`, 400);
  }
  const baseUrlRaw = body.baseUrl;
  if (typeof baseUrlRaw !== "string" || !baseUrlRaw.trim()) {
    throw new ApiRouteError("baseUrl (string) is required", 400);
  }
  const baseUrl = enforceVectorStoreEndpointPolicy(baseUrlRaw);

  const apiKeyProvided = Object.prototype.hasOwnProperty.call(body, "apiKey")
    && typeof body.apiKey === "string";
  let apiKey: string | undefined;
  if (apiKeyProvided) {
    apiKey = (body.apiKey as string) || undefined;
  } else {
    const stored = await getKbDefaults(userId);
    if (
      stored.vectorStore.kind === kind &&
      trimTrailingSlash(stored.vectorStore.baseUrl) === trimTrailingSlash(baseUrl) &&
      stored.vectorStore.apiKey
    ) {
      apiKey = stored.vectorStore.apiKey;
    }
  }

  const result = await testVectorStoreConnection({
    kind: kind as VectorStoreKind,
    baseUrl,
    apiKey,
  });
  return NextResponse.json(result);
}
