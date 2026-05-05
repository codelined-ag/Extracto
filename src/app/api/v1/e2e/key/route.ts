import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth, withSessionAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { validateE2ePublicKey } from "@/lib/e2e/envelope";

export const GET = withAuth("ocr:read", async (_request: NextRequest, { auth }) => {
  const row = await db.authUser.findUnique({
    where: { id: auth.userId },
    select: {
      e2ePublicKeyFingerprint: true,
      e2ePublicKeyRegisteredAt: true,
    },
  });
  return NextResponse.json({
    enabled: Boolean(row?.e2ePublicKeyFingerprint),
    fingerprint: row?.e2ePublicKeyFingerprint ?? null,
    registeredAt: row?.e2ePublicKeyRegisteredAt?.toISOString() ?? null,
  });
});

export const PUT = withSessionAuth("mutation", "E2E key", async (request: NextRequest, { auth }) => {
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    throw new ApiRouteError("Invalid JSON payload", 400);
  }
  const body = raw as Record<string, unknown>;
  const pem = typeof body.publicKeyPem === "string" ? body.publicKeyPem.trim() : "";
  if (!pem.startsWith("-----BEGIN PUBLIC KEY-----")) {
    throw new ApiRouteError("publicKeyPem must be an SPKI PEM-encoded RSA public key", 400);
  }
  let fingerprint: string;
  try {
    fingerprint = validateE2ePublicKey(pem).fingerprint;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const safe = /^(Only RSA|RSA modulus too small)/.test(message)
      ? message
      : "publicKeyPem could not be parsed as a valid RSA SPKI public key";
    throw new ApiRouteError(safe, 400);
  }
  await db.authUser.update({
    where: { id: auth.userId },
    data: {
      e2ePublicKeyPem: pem,
      e2ePublicKeyFingerprint: fingerprint,
      e2ePublicKeyRegisteredAt: new Date(),
    },
  });
  return NextResponse.json({ enabled: true, fingerprint });
});

export const DELETE = withSessionAuth("mutation", "E2E key", async (_request: NextRequest, { auth }) => {
  await db.authUser.update({
    where: { id: auth.userId },
    data: { e2ePublicKeyPem: null, e2ePublicKeyFingerprint: null, e2ePublicKeyRegisteredAt: null },
  });
  return NextResponse.json({ enabled: false });
});
