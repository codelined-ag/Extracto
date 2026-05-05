import {
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  constants as cryptoConstants,
} from "node:crypto";

const AES_ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedEnvelope {
  algorithm: "aes-256-gcm+rsa-oaep-sha256";
  encryptedKey: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  publicKeyFingerprint: string;
}

export function encryptForUser(plaintext: Buffer, userPublicKeyPem: string): EncryptedEnvelope {
  const publicKey = createPublicKey(userPublicKeyPem);
  if (publicKey.asymmetricKeyType !== "rsa") {
    throw new Error("Only RSA public keys are supported in v1.0; user must register an RSA-OAEP key");
  }
  const dataKey = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGO, dataKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrappedKey = publicEncrypt(
    {
      key: publicKey,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    dataKey,
  );
  const fingerprint = computeFingerprint(userPublicKeyPem);
  return {
    algorithm: "aes-256-gcm+rsa-oaep-sha256",
    encryptedKey: wrappedKey.toString("base64"),
    iv: iv.toString("base64"),
    authTag: tag.toString("base64"),
    ciphertext: ct.toString("base64"),
    publicKeyFingerprint: fingerprint,
  };
}

export function computeFingerprint(publicKeyPem: string): string {
  const normalized = publicKeyPem.trim().replace(/\r\n/g, "\n");
  const der = createPublicKey(normalized).export({ type: "spki", format: "der" }) as Buffer;
  const hash = createHash("sha256").update(der).digest();
  return `sha256:${hash.subarray(0, 16).toString("base64url")}`;
}

export function isAuthTagSize(value: number): boolean {
  return value === TAG_BYTES;
}

export const E2E_ENCRYPTION_HANDS_OFF_NOTICE = [
  "Server-side scaffold only.",
  "The operator must register an RSA-2048+ public key for the user.",
  "Decryption happens client-side with the user's private key.",
  "Key escrow and rotation are out of scope for v1.0.",
].join(" ");
