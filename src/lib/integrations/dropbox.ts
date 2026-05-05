import {
  getRedirectUri,
  readDropboxAppCredentials,
  type IntegrationAppCredentials,
  type IntegrationTokenBlob,
} from "@/lib/integrations/types";
import {
  loadIntegrationConnection,
  updateIntegrationTokens,
} from "@/lib/integrations/store";

const AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const API_URL = "https://api.dropboxapi.com/2";
const CONTENT_URL = "https://content.dropboxapi.com/2";

export const DROPBOX_SCOPES = [
  "files.content.read",
  "files.content.write",
  "files.metadata.read",
  "files.metadata.write",
  "account_info.read",
];

export function buildDropboxAuthUrl(input: {
  state: string;
  codeChallenge: string;
}): { url: string; clientId: string } {
  const creds = requireDropboxCredentials();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: getRedirectUri("dropbox"),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    scope: DROPBOX_SCOPES.join(" "),
  });
  return { url: `${AUTH_URL}?${params.toString()}`, clientId: creds.clientId };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
}): Promise<{ tokens: IntegrationTokenBlob; accountLabel: string; clientId: string }> {
  const creds = requireDropboxCredentials();
  const body = new URLSearchParams({
    code: input.code,
    grant_type: "authorization_code",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: getRedirectUri("dropbox"),
    code_verifier: input.codeVerifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox token exchange failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    account_id?: string;
  };
  const tokens: IntegrationTokenBlob = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + (json.expires_in - 60) * 1000 : undefined,
    scope: json.scope,
    accountId: json.account_id,
  };
  const accountLabel = await fetchAccountLabel(tokens.accessToken).catch(() => json.account_id ?? "Dropbox");
  return { tokens, accountLabel, clientId: creds.clientId };
}

async function fetchAccountLabel(accessToken: string): Promise<string> {
  const res = await fetch(`${API_URL}/users/get_current_account`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "null",
  });
  if (!res.ok) return "Dropbox";
  const json = (await res.json()) as { email?: string; name?: { display_name?: string } };
  return json.name?.display_name || json.email || "Dropbox";
}

export async function getValidAccessToken(userId: string): Promise<string> {
  const tokens = await loadIntegrationConnection(userId, "dropbox");
  if (!tokens) {
    throw new Error("Dropbox is not connected for this user");
  }
  if (!tokens.expiresAt || Date.now() < tokens.expiresAt) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new Error("Dropbox access token expired and no refresh token is available");
  }
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  await updateIntegrationTokens(userId, "dropbox", {
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt?: number }> {
  const creds = requireDropboxCredentials();
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
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox refresh failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  return {
    accessToken: json.access_token,
    expiresAt: json.expires_in ? Date.now() + (json.expires_in - 60) * 1000 : undefined,
  };
}

export interface DropboxEntry {
  ".tag": "file" | "folder";
  name: string;
  id: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
  client_modified?: string;
  server_modified?: string;
}

export async function listDropboxFolder(
  userId: string,
  path: string,
): Promise<DropboxEntry[]> {
  const accessToken = await getValidAccessToken(userId);
  const res = await fetch(`${API_URL}/files/list_folder`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: normalizeDropboxPath(path), recursive: false, include_non_downloadable_files: false }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox list_folder failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as { entries?: DropboxEntry[] };
  return json.entries ?? [];
}

export async function downloadDropboxFile(
  userId: string,
  path: string,
): Promise<{ bytes: Buffer; contentType: string; name: string }> {
  const accessToken = await getValidAccessToken(userId);
  const dropboxArg = JSON.stringify({ path: normalizeDropboxPath(path) });
  const res = await fetch(`${CONTENT_URL}/files/download`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": dropboxArg,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox download failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const apiResultHeader = res.headers.get("Dropbox-API-Result");
  let name = path.split("/").pop() ?? "file";
  if (apiResultHeader) {
    try {
      const meta = JSON.parse(apiResultHeader) as { name?: string };
      if (meta.name) name = meta.name;
    } catch {
      // ignore
    }
  }
  const arrayBuf = await res.arrayBuffer();
  const contentType = res.headers.get("Content-Type") ?? "application/octet-stream";
  return { bytes: Buffer.from(arrayBuf), contentType, name };
}

export async function uploadDropboxFile(
  userId: string,
  path: string,
  bytes: Buffer | Uint8Array,
  contentType = "application/octet-stream",
): Promise<{ pathDisplay: string; size: number }> {
  const accessToken = await getValidAccessToken(userId);
  const arg = JSON.stringify({
    path: normalizeDropboxPath(path),
    mode: "overwrite",
    autorename: false,
    mute: false,
  });
  const res = await fetch(`${CONTENT_URL}/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": arg,
    },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox upload failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as { path_display?: string; size?: number };
  void contentType;
  return {
    pathDisplay: json.path_display ?? path,
    size: json.size ?? bytes.byteLength,
  };
}

function requireDropboxCredentials(): IntegrationAppCredentials {
  const creds = readDropboxAppCredentials();
  if (!creds) {
    throw new Error(
      "DROPBOX_CLIENT_ID and DROPBOX_CLIENT_SECRET must be set in the environment to use the Dropbox integration.",
    );
  }
  return creds;
}

export function normalizeDropboxPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "" || trimmed === "/") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
