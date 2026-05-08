import {
  getRedirectUri,
  type IntegrationAppCredentials,
  type IntegrationTokenBlob,
} from "@/lib/integrations/types";
import { resolveAppCredentials } from "@/lib/integrations/oauth-app-store";
import {
  loadIntegrationConnection,
  updateIntegrationTokens,
} from "@/lib/integrations/store";
import { withTokenLock } from "@/lib/integrations/token-lock";

const AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export const ONEDRIVE_SCOPES = [
  "Files.ReadWrite.AppFolder",
  "User.Read",
  "offline_access",
];

export async function buildOneDriveAuthUrl(input: {
  state: string;
  codeChallenge: string;
  userId: string;
}): Promise<{ url: string; clientId: string }> {
  const creds = await requireOneDriveCredentials(input.userId);
  const params = new URLSearchParams({
    client_id: creds.clientId,
    response_type: "code",
    redirect_uri: getRedirectUri("onedrive"),
    response_mode: "query",
    scope: ONEDRIVE_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return { url: `${AUTHORITY}/authorize?${params.toString()}`, clientId: creds.clientId };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  userId: string;
}): Promise<{ tokens: IntegrationTokenBlob; accountLabel: string; clientId: string }> {
  const creds = await requireOneDriveCredentials(input.userId);
  const body = new URLSearchParams({
    code: input.code,
    grant_type: "authorization_code",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: getRedirectUri("onedrive"),
    code_verifier: input.codeVerifier,
    scope: ONEDRIVE_SCOPES.join(" "),
  });
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OneDrive token exchange failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  const tokens: IntegrationTokenBlob = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + (json.expires_in - 60) * 1000 : undefined,
    scope: json.scope,
  };
  const accountLabel = await fetchAccountLabel(tokens.accessToken).catch(() => "OneDrive");
  return { tokens, accountLabel, clientId: creds.clientId };
}

async function fetchAccountLabel(accessToken: string): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "OneDrive";
  const json = (await res.json()) as { displayName?: string; userPrincipalName?: string };
  return json.displayName || json.userPrincipalName || "OneDrive";
}

export async function getValidAccessToken(userId: string): Promise<string> {
  return withTokenLock(userId, "onedrive", async () => {
    const tokens = await loadIntegrationConnection(userId, "onedrive");
    if (!tokens) {
      throw new Error("OneDrive is not connected for this user");
    }
    if (!tokens.expiresAt || Date.now() < tokens.expiresAt) {
      return tokens.accessToken;
    }
    if (!tokens.refreshToken) {
      throw new Error("OneDrive access token expired and no refresh token is available");
    }
    const refreshed = await refreshAccessToken(tokens.refreshToken, userId);
    await updateIntegrationTokens(userId, "onedrive", {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
      expiresAt: refreshed.expiresAt,
    });
    return refreshed.accessToken;
  });
}

async function refreshAccessToken(refreshToken: string, userId: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}> {
  const creds = await requireOneDriveCredentials(userId);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: ONEDRIVE_SCOPES.join(" "),
  });
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OneDrive refresh failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + (json.expires_in - 60) * 1000 : undefined,
  };
}

export interface OneDriveEntry {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
}

export async function listOneDriveFolder(
  userId: string,
  folderId: string,
): Promise<OneDriveEntry[]> {
  const accessToken = await getValidAccessToken(userId);
  const url = folderId
    ? `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(folderId)}/children?$top=200`
    : `${GRAPH_BASE}/me/drive/special/approot/children?$top=200`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OneDrive list failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as { value?: OneDriveEntry[] };
  return json.value ?? [];
}

export async function downloadOneDriveFile(
  userId: string,
  fileId: string,
): Promise<{ bytes: Buffer; contentType: string; name: string }> {
  const accessToken = await getValidAccessToken(userId);
  const metaRes = await fetch(`${GRAPH_BASE}/me/drive/items/${encodeURIComponent(fileId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaRes.ok) {
    const text = await metaRes.text();
    throw new Error(`OneDrive metadata failed: ${metaRes.status} ${text.slice(0, 240)}`);
  }
  const meta = (await metaRes.json()) as { name?: string; file?: { mimeType?: string } };
  const dataRes = await fetch(`${GRAPH_BASE}/me/drive/items/${encodeURIComponent(fileId)}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "follow",
  });
  if (!dataRes.ok) {
    const text = await dataRes.text();
    throw new Error(`OneDrive download failed: ${dataRes.status} ${text.slice(0, 240)}`);
  }
  const buf = Buffer.from(await dataRes.arrayBuffer());
  return {
    bytes: buf,
    contentType: dataRes.headers.get("Content-Type") ?? meta.file?.mimeType ?? "application/octet-stream",
    name: meta.name ?? "file",
  };
}

const ONEDRIVE_FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|]+/g;

function sanitizeOneDriveName(name: string): string {
  const cleaned = name.replace(ONEDRIVE_FORBIDDEN_NAME_CHARS, "_").trim();
  return cleaned.length > 0 ? cleaned : "extracto-job";
}

export async function uploadOneDriveFile(input: {
  userId: string;
  parentId: string | null;
  name: string;
  bytes: Buffer | Uint8Array;
  contentType: string;
}): Promise<{ id: string; name: string; size: number }> {
  const accessToken = await getValidAccessToken(input.userId);
  const sanitized = sanitizeOneDriveName(input.name);
  const safeName = encodeURIComponent(sanitized);
  const url = input.parentId
    ? `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(input.parentId)}:/${safeName}:/content`
    : `${GRAPH_BASE}/me/drive/special/approot:/${safeName}:/content`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": input.contentType,
    },
    body: new Uint8Array(input.bytes),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OneDrive upload failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as { id?: string; name?: string; size?: number };
  return {
    id: json.id ?? "",
    name: json.name ?? sanitized,
    size: json.size ?? input.bytes.byteLength,
  };
}

async function requireOneDriveCredentials(userId: string): Promise<IntegrationAppCredentials> {
  const creds = await resolveAppCredentials("onedrive", userId);
  if (!creds) {
    throw new Error(
      "OneDrive is not configured. Add OAuth credentials in Settings → Integrations or set ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET in docker.env.",
    );
  }
  return creds;
}
