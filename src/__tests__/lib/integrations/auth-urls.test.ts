import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildDropboxAuthUrl, DROPBOX_SCOPES } from "@/lib/integrations/dropbox";
import { buildGoogleDriveAuthUrl, GOOGLE_DRIVE_SCOPES } from "@/lib/integrations/google-drive";
import { buildOneDriveAuthUrl, ONEDRIVE_SCOPES } from "@/lib/integrations/onedrive";

const FIXTURE_AUTH_SECRET = "f".repeat(64);

beforeEach(() => {
  process.env.AUTH_SECRET = FIXTURE_AUTH_SECRET;
  process.env.PUBLIC_BASE_URL = "https://extracto.example.com";
});

afterEach(() => {
  delete process.env.DROPBOX_CLIENT_ID;
  delete process.env.DROPBOX_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.ONEDRIVE_CLIENT_ID;
  delete process.env.ONEDRIVE_CLIENT_SECRET;
});

describe("Dropbox", () => {
  it("does not request files.metadata.write", () => {
    expect(DROPBOX_SCOPES).not.toContain("files.metadata.write");
    expect(DROPBOX_SCOPES).toEqual(
      expect.arrayContaining(["files.content.read", "files.content.write", "files.metadata.read", "account_info.read"]),
    );
  });

  it("buildDropboxAuthUrl emits PKCE + offline-token and the configured redirect", () => {
    process.env.DROPBOX_CLIENT_ID = "dx-client";
    process.env.DROPBOX_CLIENT_SECRET = "dx-secret";
    const { url } = buildDropboxAuthUrl({ state: "S", codeChallenge: "C" });
    const parsed = new URL(url);
    expect(parsed.host).toBe("www.dropbox.com");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("dx-client");
    expect(parsed.searchParams.get("code_challenge")).toBe("C");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("token_access_type")).toBe("offline");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://extracto.example.com/api/integrations/dropbox/callback",
    );
    expect(parsed.searchParams.get("state")).toBe("S");
  });

  it("throws when client credentials are not configured", () => {
    expect(() => buildDropboxAuthUrl({ state: "S", codeChallenge: "C" })).toThrow(/DROPBOX_CLIENT_ID/);
  });
});

describe("Google Drive", () => {
  it("requests least-privilege drive.file scope and not the broad drive scope", () => {
    expect(GOOGLE_DRIVE_SCOPES).toContain("https://www.googleapis.com/auth/drive.file");
    expect(GOOGLE_DRIVE_SCOPES).not.toContain("https://www.googleapis.com/auth/drive");
  });

  it("buildGoogleDriveAuthUrl forces refresh-token issuance via prompt=consent + access_type=offline", () => {
    process.env.GOOGLE_CLIENT_ID = "gd-client";
    process.env.GOOGLE_CLIENT_SECRET = "gd-secret";
    const { url } = buildGoogleDriveAuthUrl({ state: "S", codeChallenge: "C" });
    const parsed = new URL(url);
    expect(parsed.host).toBe("accounts.google.com");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://extracto.example.com/api/integrations/google_drive/callback",
    );
  });

  it("throws when client credentials are not configured", () => {
    expect(() => buildGoogleDriveAuthUrl({ state: "S", codeChallenge: "C" })).toThrow(/GOOGLE_CLIENT_ID/);
  });
});

describe("OneDrive", () => {
  it("requests least-privilege Files.ReadWrite.AppFolder + offline_access", () => {
    expect(ONEDRIVE_SCOPES).toContain("Files.ReadWrite.AppFolder");
    expect(ONEDRIVE_SCOPES).toContain("offline_access");
    expect(ONEDRIVE_SCOPES).not.toContain("Files.ReadWrite.All");
  });

  it("buildOneDriveAuthUrl uses the consumers authority and S256 PKCE", () => {
    process.env.ONEDRIVE_CLIENT_ID = "od-client";
    process.env.ONEDRIVE_CLIENT_SECRET = "od-secret";
    const { url } = buildOneDriveAuthUrl({ state: "S", codeChallenge: "C" });
    const parsed = new URL(url);
    expect(parsed.host).toBe("login.microsoftonline.com");
    expect(parsed.pathname).toContain("/consumers/");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://extracto.example.com/api/integrations/onedrive/callback",
    );
  });

  it("throws when client credentials are not configured", () => {
    expect(() => buildOneDriveAuthUrl({ state: "S", codeChallenge: "C" })).toThrow(/ONEDRIVE_CLIENT_ID/);
  });
});
