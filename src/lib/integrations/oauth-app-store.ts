import { db } from "@/lib/db";
import {
  decryptIntegrationTokens,
  encryptIntegrationTokens,
} from "@/lib/integrations/crypto";
import {
  readDropboxAppCredentialsFromEnv,
  readGoogleDriveAppCredentialsFromEnv,
  readOneDriveAppCredentialsFromEnv,
  type IntegrationAppCredentials,
  type IntegrationProvider,
} from "@/lib/integrations/types";

const ENV_READERS: Record<IntegrationProvider, () => IntegrationAppCredentials | null> = {
  dropbox: readDropboxAppCredentialsFromEnv,
  google_drive: readGoogleDriveAppCredentialsFromEnv,
  onedrive: readOneDriveAppCredentialsFromEnv,
};

export async function resolveAppCredentials(
  provider: IntegrationProvider,
  userId: string,
): Promise<IntegrationAppCredentials | null> {
  const row = await db.integrationAppCredential.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (row) {
    try {
      const clientSecret = decryptIntegrationTokens(row.encryptedClientSecret);
      return { clientId: row.clientId, clientSecret };
    } catch {
      // Fall through to env on decrypt failure (most likely AUTH_SECRET rotation).
    }
  }
  return ENV_READERS[provider]();
}

export async function setAppCredentials(input: {
  userId: string;
  provider: IntegrationProvider;
  clientId: string;
  clientSecret: string;
}): Promise<void> {
  const encryptedClientSecret = encryptIntegrationTokens(input.clientSecret);
  await db.integrationAppCredential.upsert({
    where: { userId_provider: { userId: input.userId, provider: input.provider } },
    create: {
      userId: input.userId,
      provider: input.provider,
      clientId: input.clientId,
      encryptedClientSecret,
    },
    update: {
      clientId: input.clientId,
      encryptedClientSecret,
    },
  });
}

export async function deleteAppCredentials(
  userId: string,
  provider: IntegrationProvider,
): Promise<boolean> {
  try {
    await db.integrationAppCredential.delete({
      where: { userId_provider: { userId, provider } },
    });
    return true;
  } catch {
    return false;
  }
}

export async function getAppCredentialStatus(
  userId: string,
  provider: IntegrationProvider,
): Promise<{ source: "user" | "server" | "none"; clientIdLast4: string | null }> {
  const row = await db.integrationAppCredential.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { clientId: true },
  });
  if (row) return { source: "user", clientIdLast4: row.clientId.slice(-4) };
  const env = ENV_READERS[provider]();
  if (env) return { source: "server", clientIdLast4: env.clientId.slice(-4) };
  return { source: "none", clientIdLast4: null };
}
