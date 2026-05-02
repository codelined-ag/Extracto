// /api/models — UI-facing model discovery for the configured provider.
//
// Until 2026-05 this file owned its own discovery pipeline (~350 LOC of
// candidate-host loops, payload normalization, and timeout handling) that
// duplicated what pipeline.getModelCatalog already does for the same set of
// providers. Now this route is a thin shape-adapter over getModelCatalog so
// there's a single discovery code path.

import { NextRequest, NextResponse } from "next/server";

import { withAuth } from "@/lib/auth/request";
import { normalizeProvider, type ProviderKind } from "@/lib/ocr/endpoint-policy";
import { getModelCatalog } from "@/lib/ocr/pipeline";
import { getApiSettings } from "@/lib/ocr/settings-store";

interface NormalizedModel {
  id: string;
  name: string;
  provider: string;
}

export const GET = withAuth("ocr:read", async (request: NextRequest, { auth }) => {
  const settings = await getApiSettings(auth.userId);
  const query = new URL(request.url).searchParams;
  const providerHint: ProviderKind = normalizeProvider(query.get("provider") || settings.provider);

  // getModelCatalog already handles per-provider env-key fallbacks,
  // candidate hosts (via the runtime endpoint), cache, and degraded
  // empty-list returns when discovery fails. We just adapt to the
  // {id,name,provider} shape this route has historically returned.
  const catalog = await getModelCatalog(settings);
  const models: NormalizedModel[] = catalog[providerHint].map((id) => ({
    id,
    name: id,
    provider: providerHint,
  }));

  return NextResponse.json({
    provider: providerHint,
    endpoint: settings.apiEndpoint,
    models,
  });
});
