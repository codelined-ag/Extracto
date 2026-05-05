import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withSessionAuth } from "@/lib/auth/request";
import { buildOneDriveAuthUrl } from "@/lib/integrations/onedrive";
import {
  createCodeVerifier,
  deriveCodeChallenge,
  OAUTH_STATE_COOKIE,
  packOAuthState,
} from "@/lib/integrations/oauth-state";
import { resolveAppCredentials } from "@/lib/integrations/oauth-app-store";

export const POST = withSessionAuth("mutation", "OneDrive connect", async (_request: NextRequest, { auth }) => {
  if (!(await resolveAppCredentials("onedrive", auth.userId))) {
    throw new ApiRouteError(
      "OneDrive is not configured. Add OAuth credentials in Settings → Integrations or set ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET on the server.",
      503,
    );
  }
  const codeVerifier = createCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  const state = packOAuthState({ userId: auth.userId, provider: "onedrive", codeVerifier });
  const { url } = await buildOneDriveAuthUrl({ state, codeChallenge, userId: auth.userId });

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
