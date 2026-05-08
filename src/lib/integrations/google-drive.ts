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

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "openid",
  "email",
];

export async function buildGoogleDriveAuthUrl(input: {
  state: string;
  codeChallenge: string;
  userId: string;
}): Promise<{ url: string; clientId: string }> {
  const creds = await requireGoogleDriveCredentials(input.userId);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: getRedirectUri("google_drive"),
    scope: GOOGLE_DRIVE_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return { url: `${AUTH_URL}?${params.toString()}`, clientId: creds.clientId };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  userId: string;
}): Promise<{ tokens: IntegrationTokenBlob; accountLabel: string; clientId: string }> {
  const creds = await requireGoogleDriveCredentials(input.userId);
  const body = new URLSearchParams({
    code: input.code,
    grant_type: "authorization_code",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: getRedirectUri("google_drive"),
    code_verifier: input.codeVerifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text.slice(0, 240)}`);
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
  const accountLabel = await fetchAccountLabel(tokens.accessToken).catch(() => "Google Drive");
  return { tokens, accountLabel, clientId: creds.clientId };
}

async function fetchAccountLabel(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "Google Drive";
  const json = (await res.json()) as { email?: string; name?: string };
  return json.name || json.email || "Google Drive";
}

export async function getValidAccessToken(userId: string): Promise<string> {
  return withTokenLock(userId, "google_drive", async () => {
    const tokens = await loadIntegrationConnection(userId, "google_drive");
    if (!tokens) {
      throw new Error("Google Drive is not connected for this user");
    }
    if (!tokens.expiresAt || Date.now() < tokens.expiresAt) {
      return tokens.accessToken;
    }
    if (!tokens.refreshToken) {
      throw new Error("Google Drive access token expired and no refresh token is available");
    }
    const refreshed = await refreshAccessToken(tokens.refreshToken, userId);
    await updateIntegrationTokens(userId, "google_drive", {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    });
    return refreshed.accessToken;
  });
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const body = new URLSearchParams({ token });
  const res = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    console.warn(`[google-drive] token revoke returned ${res.status}`);
  }
}

async function refreshAccessToken(refreshToken: string, userId: string): Promise<{ accessToken: string; expiresAt?: number }> {
  const creds = await requireGoogleDriveCredentials(userId);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google refresh failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  return {
    accessToken: json.access_token,
    expiresAt: json.expires_in ? Date.now() + (json.expires_in - 60) * 1000 : undefined,
  };
}

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  modifiedTime?: string;
}

const DRIVE_FOLDER_ID_RE = /^[A-Za-z0-9_-]{10,}$|^root$/;

export async function listGoogleDriveFolder(
  userId: string,
  folderId: string,
): Promise<DriveEntry[]> {
  const accessToken = await getValidAccessToken(userId);
  const target = folderId.trim() || "root";
  if (!DRIVE_FOLDER_ID_RE.test(target)) {
    throw new Error("Invalid Google Drive folder id");
  }
  const params = new URLSearchParams({
    q: `'${target}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, parents, size, modifiedTime)",
    pageSize: "100",
    spaces: "drive",
  });
  const res = await fetch(`${API_BASE}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive list failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as { files?: DriveEntry[] };
  return json.files ?? [];
}

export async function downloadGoogleDriveFile(
  userId: string,
  fileId: string,
): Promise<{ bytes: Buffer; contentType: string; name: string }> {
  const accessToken = await getValidAccessToken(userId);
  const metaRes = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}?fields=name,mimeType`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaRes.ok) {
    const text = await metaRes.text();
    throw new Error(`Google Drive metadata failed: ${metaRes.status} ${text.slice(0, 240)}`);
  }
  const meta = (await metaRes.json()) as { name?: string; mimeType?: string };
  const dataRes = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!dataRes.ok) {
    const text = await dataRes.text();
    throw new Error(`Google Drive download failed: ${dataRes.status} ${text.slice(0, 240)}`);
  }
  const buf = Buffer.from(await dataRes.arrayBuffer());
  return {
    bytes: buf,
    contentType: dataRes.headers.get("Content-Type") ?? meta.mimeType ?? "application/octet-stream",
    name: meta.name ?? "file",
  };
}

export async function uploadGoogleDriveFile(input: {
  userId: string;
  parentId: string | null;
  name: string;
  bytes: Buffer | Uint8Array;
  contentType: string;
}): Promise<{ id: string; name: string; size: number }> {
  const accessToken = await getValidAccessToken(input.userId);
  const metadata: Record<string, unknown> = { name: input.name };
  if (input.parentId) metadata.parents = [input.parentId];
  const boundary = `extr-${Math.random().toString(36).slice(2)}`;
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${input.contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([
    Buffer.from(head, "utf-8"),
    Buffer.from(input.bytes),
    Buffer.from(tail, "utf-8"),
  ]);
  const res = await fetch(`${UPLOAD_BASE}/files?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.byteLength),
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive upload failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as { id?: string; name?: string; size?: string };
  return {
    id: json.id ?? "",
    name: json.name ?? input.name,
    size: typeof json.size === "string" ? Number(json.size) : input.bytes.byteLength,
  };
}

async function requireGoogleDriveCredentials(userId: string): Promise<IntegrationAppCredentials> {
  const creds = await resolveAppCredentials("google_drive", userId);
  if (!creds) {
    throw new Error(
      "Google Drive is not configured. Add OAuth credentials in Settings → Integrations or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in docker.env.",
    );
  }
  return creds;
}
