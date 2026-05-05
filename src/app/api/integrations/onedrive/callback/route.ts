import { NextResponse, type NextRequest } from "next/server";

import { getAuthCookieName } from "@/lib/auth/token";
import { verifyActiveSession } from "@/lib/auth/session";
import { exchangeAuthorizationCode } from "@/lib/integrations/onedrive";
import {
  OAUTH_STATE_COOKIE,
  unpackOAuthState,
} from "@/lib/integrations/oauth-state";
import { saveIntegrationConnection } from "@/lib/integrations/store";

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  const errorPage = (message: string, status: number) =>
    new NextResponse(`<!doctype html><meta charset="utf-8"><title>OneDrive connect</title><pre>${escapeHtml(message)}</pre>`, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  if (error) return errorPage(`Microsoft returned an error: ${error}`, 400);
  if (!code || !stateRaw || !cookieState || stateRaw !== cookieState) {
    return errorPage("Invalid OAuth state. Please retry from Settings.", 400);
  }
  const payload = unpackOAuthState(cookieState);
  if (!payload || payload.provider !== "onedrive") {
    return errorPage("OAuth state expired or tampered with. Please retry from Settings.", 400);
  }
  const session = await verifyActiveSession(request.cookies.get(getAuthCookieName())?.value);
  if (!session || session.userId !== payload.userId) {
    return errorPage("Sign in as the user who started the OneDrive connect flow, then retry.", 401);
  }

  try {
    const { tokens, accountLabel, clientId } = await exchangeAuthorizationCode({
      code,
      codeVerifier: payload.codeVerifier,
    });
    await saveIntegrationConnection({
      userId: payload.userId,
      provider: "onedrive",
      accountLabel,
      tokens,
      clientId,
    });
  } catch (err) {
    return errorPage(`Failed to connect OneDrive: ${(err as Error).message}`, 500);
  }

  const redirectTo = "/?integration=onedrive&status=connected";
  const res = NextResponse.redirect(new URL(redirectTo, request.url));
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
