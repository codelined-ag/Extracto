import { db } from "@/lib/db";
import {
  decryptIntegrationTokens,
  encryptIntegrationTokens,
} from "@/lib/integrations/crypto";
import type { IntegrationProvider, IntegrationTokenBlob } from "@/lib/integrations/types";

export async function saveIntegrationConnection(input: {
  userId: string;
  provider: IntegrationProvider;
  accountLabel: string;
  tokens: IntegrationTokenBlob;
  clientId: string;
}): Promise<void> {
  const encryptedTokens = encryptIntegrationTokens(JSON.stringify(input.tokens));
  const clientIdLast4 = input.clientId.slice(-4);
  await db.integrationConnection.upsert({
    where: { userId_provider: { userId: input.userId, provider: input.provider } },
    create: {
      userId: input.userId,
      provider: input.provider,
      accountLabel: input.accountLabel,
      encryptedTokens,
      clientIdLast4,
    },
    update: {
      accountLabel: input.accountLabel,
      encryptedTokens,
      clientIdLast4,
    },
  });
}

export async function loadIntegrationConnection(
  userId: string,
  provider: IntegrationProvider,
): Promise<IntegrationTokenBlob | null> {
  const row = await db.integrationConnection.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!row) return null;
  try {
    const json = decryptIntegrationTokens(row.encryptedTokens);
    return JSON.parse(json) as IntegrationTokenBlob;
  } catch {
    return null;
  }
}

export async function listIntegrationConnections(userId: string) {
  const rows = await db.integrationConnection.findMany({
    where: { userId },
    select: {
      provider: true,
      accountLabel: true,
      clientIdLast4: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { provider: "asc" },
  });
  return rows;
}

export async function deleteIntegrationConnection(
  userId: string,
  provider: IntegrationProvider,
): Promise<boolean> {
  try {
    await db.integrationConnection.delete({
      where: { userId_provider: { userId, provider } },
    });
    return true;
  } catch {
    return false;
  }
}

export async function updateIntegrationTokens(
  userId: string,
  provider: IntegrationProvider,
  patch: Partial<IntegrationTokenBlob>,
): Promise<void> {
  const existing = await loadIntegrationConnection(userId, provider);
  if (!existing) {
    throw new Error(`No ${provider} connection for user ${userId}`);
  }
  const merged = { ...existing, ...patch };
  await db.integrationConnection.update({
    where: { userId_provider: { userId, provider } },
    data: { encryptedTokens: encryptIntegrationTokens(JSON.stringify(merged)) },
  });
}
