import {
  createPrivateKey,
  generateKeyPairSync,
  privateDecrypt,
  createDecipheriv,
  constants as cryptoConstants,
} from "node:crypto";
import { describe, expect, it } from "vitest";

import { computeFingerprint, encryptForUser, validateE2ePublicKey } from "@/lib/e2e/envelope";

const FIXTURE_KEYPAIR = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("encryptForUser + decrypt round-trip", () => {
  it("produces a sealed envelope that the holder of the matching private key can decrypt", () => {
    const plaintext = Buffer.from("super secret OCR result", "utf-8");
    const env = encryptForUser(plaintext, FIXTURE_KEYPAIR.publicKey);

    const dataKey = privateDecrypt(
      {
        key: createPrivateKey(FIXTURE_KEYPAIR.privateKey),
        padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(env.encryptedKey, "base64"),
    );
    const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(env.iv, "base64"));
    decipher.setAuthTag(Buffer.from(env.authTag, "base64"));
    const recovered = Buffer.concat([
      decipher.update(Buffer.from(env.ciphertext, "base64")),
      decipher.final(),
    ]);
    expect(recovered.toString("utf-8")).toBe("super secret OCR result");
  });

  it("emits a stable fingerprint for the public key", () => {
    const fp1 = computeFingerprint(FIXTURE_KEYPAIR.publicKey);
    const fp2 = computeFingerprint(FIXTURE_KEYPAIR.publicKey);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^sha256:/);
  });

  it("rejects non-RSA public keys", () => {
    const ed25519 = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    expect(() => encryptForUser(Buffer.from("x"), ed25519.publicKey)).toThrow(/RSA/);
  });

  it("two different keypairs yield distinct fingerprints", () => {
    const other = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    expect(computeFingerprint(FIXTURE_KEYPAIR.publicKey)).not.toBe(computeFingerprint(other.publicKey));
  });
});

describe("validateE2ePublicKey", () => {
  it("accepts a 2048-bit RSA SPKI key and returns its fingerprint and modulus size", () => {
    const result = validateE2ePublicKey(FIXTURE_KEYPAIR.publicKey);
    expect(result.fingerprint).toMatch(/^sha256:/);
    expect(result.modulusBits).toBe(2048);
  });

  it("rejects a 1024-bit RSA key as too small", () => {
    const weak = generateKeyPairSync("rsa", {
      modulusLength: 1024,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    expect(() => validateE2ePublicKey(weak.publicKey)).toThrow(/modulus too small/);
  });

  it("rejects an Ed25519 SPKI key", () => {
    const ed = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    expect(() => validateE2ePublicKey(ed.publicKey)).toThrow(/RSA/);
  });
});
