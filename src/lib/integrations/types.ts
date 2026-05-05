export const INTEGRATION_PROVIDERS = ["dropbox", "google_drive", "onedrive"] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export function isIntegrationProvider(value: unknown): value is IntegrationProvider {
  return typeof value === "string" && (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

export interface IntegrationTokenBlob {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  accountId?: string;
}

export interface IntegrationAppCredentials {
  clientId: string;
  clientSecret: string;
}

export function readDropboxAppCredentials(): IntegrationAppCredentials | null {
  const clientId = process.env.DROPBOX_CLIENT_ID?.trim();
  const clientSecret = process.env.DROPBOX_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function readGoogleDriveAppCredentials(): IntegrationAppCredentials | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function readOneDriveAppCredentials(): IntegrationAppCredentials | null {
  const clientId = process.env.ONEDRIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function getRedirectUri(provider: IntegrationProvider): string {
  const base = (process.env.PUBLIC_BASE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/integrations/${provider}/callback`;
}
