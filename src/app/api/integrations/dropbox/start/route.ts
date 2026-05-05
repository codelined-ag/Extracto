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
import { readDropboxAppCredentials } from "@/lib/integrations/types";

export const POST = withSessionAuth("mutation", "Dropbox connect", async (_request: NextRequest, { auth }) => {
  if (!readDropboxAppCredentials()) {
    throw new ApiRouteError(
      "Dropbox is not configured on this server. Operator must set DROPBOX_CLIENT_ID and DROPBOX_CLIENT_SECRET in docker.env.",
      503,
    );
  }
  const codeVerifier = createCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  const state = packOAuthState({ userId: auth.userId, provider: "dropbox", codeVerifier });
  const { url } = buildDropboxAuthUrl({ state, codeChallenge });

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
