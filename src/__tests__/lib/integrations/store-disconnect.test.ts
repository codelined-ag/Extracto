import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    integrationConnection: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/integrations/crypto", () => ({
  decryptIntegrationTokens: vi.fn((s: string) => s),
  encryptIntegrationTokens: vi.fn((s: string) => s),
}));

vi.mock("@/lib/integrations/dropbox", () => ({
  revokeDropboxToken: vi.fn(),
}));

vi.mock("@/lib/integrations/google-drive", () => ({
  revokeGoogleToken: vi.fn(),
}));

import { db } from "@/lib/db";
import { revokeDropboxToken } from "@/lib/integrations/dropbox";
import { revokeGoogleToken } from "@/lib/integrations/google-drive";
import { deleteIntegrationConnection } from "@/lib/integrations/store";

const mFind = db.integrationConnection.findUnique as ReturnType<typeof vi.fn>;
const mDelete = db.integrationConnection.delete as ReturnType<typeof vi.fn>;
const mRevokeDropbox = revokeDropboxToken as ReturnType<typeof vi.fn>;
const mRevokeGoogle = revokeGoogleToken as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mFind.mockReset();
  mDelete.mockReset().mockResolvedValue({});
  mRevokeDropbox.mockReset().mockResolvedValue(undefined);
  mRevokeGoogle.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("deleteIntegrationConnection", () => {
  it("revokes the Dropbox token after deleting the local row", async () => {
    mFind.mockResolvedValueOnce({
      encryptedTokens: JSON.stringify({ accessToken: "drop-access" }),
    });

    const ok = await deleteIntegrationConnection("user-1", "dropbox");

    expect(ok).toBe(true);
    expect(mDelete).toHaveBeenCalled();
    expect(mRevokeDropbox).toHaveBeenCalledWith("drop-access");
  });

  it("revokes Google with the refresh token when present", async () => {
    mFind.mockResolvedValueOnce({
      encryptedTokens: JSON.stringify({
        accessToken: "g-access",
        refreshToken: "g-refresh",
      }),
    });

    await deleteIntegrationConnection("user-1", "google_drive");

    expect(mRevokeGoogle).toHaveBeenCalledWith("g-refresh");
  });

  it("falls back to access token if Google has no refresh token", async () => {
    mFind.mockResolvedValueOnce({
      encryptedTokens: JSON.stringify({ accessToken: "g-access" }),
    });

    await deleteIntegrationConnection("user-1", "google_drive");

    expect(mRevokeGoogle).toHaveBeenCalledWith("g-access");
  });

  it("does not call any revoke endpoint for OneDrive", async () => {
    mFind.mockResolvedValueOnce({
      encryptedTokens: JSON.stringify({ accessToken: "od-access" }),
    });

    await deleteIntegrationConnection("user-1", "onedrive");

    expect(mRevokeDropbox).not.toHaveBeenCalled();
    expect(mRevokeGoogle).not.toHaveBeenCalled();
  });

  it("swallows revoke errors and still reports success", async () => {
    mFind.mockResolvedValueOnce({
      encryptedTokens: JSON.stringify({ accessToken: "drop-access" }),
    });
    mRevokeDropbox.mockRejectedValueOnce(new Error("network"));

    const ok = await deleteIntegrationConnection("user-1", "dropbox");

    expect(ok).toBe(true);
  });

  it("returns false when the local delete fails", async () => {
    mFind.mockResolvedValueOnce({
      encryptedTokens: JSON.stringify({ accessToken: "x" }),
    });
    mDelete.mockRejectedValueOnce(new Error("not found"));

    const ok = await deleteIntegrationConnection("user-1", "dropbox");

    expect(ok).toBe(false);
    expect(mRevokeDropbox).not.toHaveBeenCalled();
  });
});
