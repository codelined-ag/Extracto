const AUTH_COOKIE_NAME = "estracto_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const MIN_AUTH_SECRET_LENGTH = 32;

interface AuthSessionPayload {
  userId: string;
  email: string;
  name?: string | null;
  exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function getSecret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (!configured) {
    throw new Error("AUTH_SECRET is required");
  }

  if (configured.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(`AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters`);
  }

  return configured;
}

// Edge-compatible variant (TextEncoder/btoa). For Node-only callers using Buffer see api-key.ts.
function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    output[i] = binary.charCodeAt(i);
  }

  return output;
}

let cachedKeyPromise: Promise<CryptoKey> | null = null;
let cachedSecret: string | null = null;

function getSigningKey(): Promise<CryptoKey> {
  const secret = getSecret();
  if (!cachedKeyPromise || cachedSecret !== secret) {
    cachedSecret = secret;
    cachedKeyPromise = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }

  return cachedKeyPromise;
}

export async function createSessionToken(
  payload: Omit<AuthSessionPayload, "exp">
): Promise<string> {
  const claims: AuthSessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };

  const payloadJson = JSON.stringify(claims);
  const payloadEncoded = base64UrlEncode(payloadJson);

  const key = await getSigningKey();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payloadEncoded)
  );

  const signed = base64UrlEncode(new Uint8Array(signature));
  return `${payloadEncoded}.${signed}`;
}

export async function verifySessionToken(
  token: string | null | undefined
): Promise<AuthSessionPayload | null> {
  if (!token) {
    return null;
  }

  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) {
    return null;
  }

  try {
    const key = await getSigningKey();
    const signature = base64UrlDecode(signaturePart);
    const signatureBytes = new Uint8Array(signature.length);
    signatureBytes.set(signature);
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(payloadPart)
    );

    if (!isValid) {
      return null;
    }

    const decoded = decoder.decode(base64UrlDecode(payloadPart));
    const payload = JSON.parse(decoded) as AuthSessionPayload;

    if (!payload.userId || !payload.email || typeof payload.exp !== "number") {
      return null;
    }

    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getAuthCookieName(): string {
  return AUTH_COOKIE_NAME;
}

export function getSessionMaxAgeSeconds(): number {
  return SESSION_TTL_SECONDS;
}

export function shouldUseSecureCookie(shouldBeSecure: boolean): boolean {
  if (process.env.NODE_ENV !== "production") {
    return false;
  }

  const explicit = process.env.COOKIE_SECURE?.toLowerCase();

  if (explicit === "true") {
    return true;
  }

  if (explicit === "false") {
    return false;
  }

  return shouldBeSecure;
}
