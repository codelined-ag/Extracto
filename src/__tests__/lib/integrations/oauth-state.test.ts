import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createCodeVerifier,
  deriveCodeChallenge,
  packOAuthState,
  unpackOAuthState,
} from "@/lib/integrations/oauth-state";

const FIXTURE_SECRET = "a".repeat(64);

beforeEach(() => {
  process.env.AUTH_SECRET = FIXTURE_SECRET;
});
afterEach(() => {
  process.env.AUTH_SECRET = FIXTURE_SECRET;
});

describe("createCodeVerifier and deriveCodeChallenge", () => {
  it("produces a 43+ char verifier and a 43-char SHA-256 challenge", () => {
    const verifier = createCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const challenge = deriveCodeChallenge(verifier);
    expect(challenge.length).toBe(43);
  });
});

describe("packOAuthState / unpackOAuthState", () => {
  it("round-trips userId, provider, codeVerifier", () => {
    const state = packOAuthState({
      userId: "user-1",
      provider: "dropbox",
      codeVerifier: "abc123",
    });
    const back = unpackOAuthState(state);
    expect(back).not.toBeNull();
    expect(back?.userId).toBe("user-1");
    expect(back?.provider).toBe("dropbox");
    expect(back?.codeVerifier).toBe("abc123");
  });

  it("rejects a tampered signature", () => {
    const state = packOAuthState({ userId: "u", provider: "dropbox", codeVerifier: "v" });
    const tampered = state.slice(0, -2) + (state.slice(-2) === "AA" ? "BB" : "AA");
    expect(unpackOAuthState(tampered)).toBeNull();
  });

  it("rejects state signed by a different secret", () => {
    const state = packOAuthState({ userId: "u", provider: "dropbox", codeVerifier: "v" });
    process.env.AUTH_SECRET = "z".repeat(64);
    expect(unpackOAuthState(state)).toBeNull();
  });

  it("returns null on missing or malformed input", () => {
    expect(unpackOAuthState(undefined)).toBeNull();
    expect(unpackOAuthState("")).toBeNull();
    expect(unpackOAuthState("nodot")).toBeNull();
  });
});
