import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withSessionAuth } from "@/lib/auth/request";
import { buildGoogleDriveAuthUrl } from "@/lib/integrations/google-drive";
import {
  createCodeVerifier,
  deriveCodeChallenge,
  OAUTH_STATE_COOKIE,
  packOAuthState,
} from "@/lib/integrations/oauth-state";
import { readGoogleDriveAppCredentials } from "@/lib/integrations/types";

export const POST = withSessionAuth("mutation", "Google Drive connect", async (_request: NextRequest, { auth }) => {
  if (!readGoogleDriveAppCredentials()) {
    throw new ApiRouteError(
      "Google Drive is not configured on this server. Operator must set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in docker.env.",
      503,
    );
  }
  const codeVerifier = createCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  const state = packOAuthState({ userId: auth.userId, provider: "google_drive", codeVerifier });
  const { url } = buildGoogleDriveAuthUrl({ state, codeChallenge });

  const res = NextResponse.json({ authUrl: url });
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
});
