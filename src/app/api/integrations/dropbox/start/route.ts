import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withSessionAuth } from "@/lib/auth/request";
import { buildDropboxAuthUrl } from "@/lib/integrations/dropbox";
import {
  createCodeVerifier,
  deriveCodeChallenge,
  OAUTH_STATE_COOKIE,
  packOAuthState,
} from "@/lib/integrations/oauth-state";
import { resolveAppCredentials } from "@/lib/integrations/oauth-app-store";

export const POST = withSessionAuth("mutation", "Dropbox connect", async (_request: NextRequest, { auth }) => {
  if (!(await resolveAppCredentials("dropbox", auth.userId))) {
    throw new ApiRouteError(
      "Dropbox is not configured. Add OAuth credentials in Settings → Integrations or set DROPBOX_CLIENT_ID and DROPBOX_CLIENT_SECRET on the server.",
      503,
    );
  }
  const codeVerifier = createCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  const state = packOAuthState({ userId: auth.userId, provider: "dropbox", codeVerifier });
  const { url } = await buildDropboxAuthUrl({ state, codeChallenge, userId: auth.userId });

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
