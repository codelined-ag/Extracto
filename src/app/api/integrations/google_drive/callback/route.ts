import { NextResponse, type NextRequest } from "next/server";

import { getAuthCookieName } from "@/lib/auth/token";
import { verifyActiveSession } from "@/lib/auth/session";
import { exchangeAuthorizationCode } from "@/lib/integrations/google-drive";
import {
  oauthStateCookieName,
  timingSafeStateCompare,
  unpackOAuthState,
} from "@/lib/integrations/oauth-state";
import { saveIntegrationConnection } from "@/lib/integrations/store";

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieState = request.cookies.get(oauthStateCookieName("google_drive"))?.value;

  const errorPage = (message: string, status: number) =>
    new NextResponse(`<!doctype html><meta charset="utf-8"><title>Google Drive connect</title><pre>${escapeHtml(message)}</pre>`, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  if (error) return errorPage(`Google returned an error: ${error}`, 400);
  if (!code || !stateRaw || !cookieState || !timingSafeStateCompare(stateRaw, cookieState)) {
    return errorPage("Invalid OAuth state. Please retry from Settings.", 400);
  }
  const payload = unpackOAuthState(cookieState);
  if (!payload || payload.provider !== "google_drive") {
    return errorPage("OAuth state expired or tampered with. Please retry from Settings.", 400);
  }
  const session = await verifyActiveSession(request.cookies.get(getAuthCookieName())?.value);
  if (!session || session.userId !== payload.userId) {
    return errorPage("Sign in as the user who started the Google Drive connect flow, then retry.", 401);
  }

  try {
    const { tokens, accountLabel, clientId } = await exchangeAuthorizationCode({
      code,
      codeVerifier: payload.codeVerifier,
      userId: payload.userId,
    });
    await saveIntegrationConnection({
      userId: payload.userId,
      provider: "google_drive",
      accountLabel,
      tokens,
      clientId,
    });
  } catch (err) {
    return errorPage(`Failed to connect Google Drive: ${(err as Error).message}`, 500);
  }

  const redirectTo = "/?integration=google_drive&status=connected";
  const res = NextResponse.redirect(new URL(redirectTo, request.url));
  res.cookies.set(oauthStateCookieName("google_drive"), "", { path: "/", maxAge: 0 });
  return res;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
