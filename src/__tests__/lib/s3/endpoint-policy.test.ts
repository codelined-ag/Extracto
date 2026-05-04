import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { enforceS3EndpointPolicy } from "@/lib/ocr/endpoint-policy";

describe("enforceS3EndpointPolicy", () => {
  const originalAllow = process.env.S3_ALLOW_LOOPBACK;
  const originalAllowed = process.env.S3_ALLOWED_HOSTS;

  beforeEach(() => {
    delete process.env.S3_ALLOW_LOOPBACK;
    delete process.env.S3_ALLOWED_HOSTS;
  });
  afterEach(() => {
    if (originalAllow !== undefined) process.env.S3_ALLOW_LOOPBACK = originalAllow;
    else delete process.env.S3_ALLOW_LOOPBACK;
    if (originalAllowed !== undefined) process.env.S3_ALLOWED_HOSTS = originalAllowed;
    else delete process.env.S3_ALLOWED_HOSTS;
  });

  describe("accepts every S3-compatible host on the public internet", () => {
    it("AWS S3 (path-style + virtual-host)", () => {
      expect(enforceS3EndpointPolicy("https://s3.amazonaws.com")).toBe("https://s3.amazonaws.com");
      expect(enforceS3EndpointPolicy("https://s3.us-east-2.amazonaws.com")).toMatch(/s3\.us-east-2/);
      expect(enforceS3EndpointPolicy("https://my-bucket.s3.us-east-2.amazonaws.com")).toMatch(/my-bucket/);
      expect(enforceS3EndpointPolicy("https://internal-admin.amazonaws.com")).toMatch(/amazonaws/);
    });

    it("Cloudflare R2, Backblaze, DigitalOcean, Wasabi, Linode, GCS", () => {
      expect(enforceS3EndpointPolicy("https://abc123.r2.cloudflarestorage.com")).toMatch(/r2/);
      expect(enforceS3EndpointPolicy("https://s3.us-west-002.backblazeb2.com")).toMatch(/backblazeb2/);
      expect(enforceS3EndpointPolicy("https://nyc3.digitaloceanspaces.com")).toMatch(/digitaloceanspaces/);
      expect(enforceS3EndpointPolicy("https://s3.wasabisys.com")).toMatch(/wasabisys/);
      expect(enforceS3EndpointPolicy("https://us-east-1.linodeobjects.com")).toMatch(/linodeobjects/);
      expect(enforceS3EndpointPolicy("https://storage.googleapis.com")).toBe("https://storage.googleapis.com");
    });

    it("self-hosted MinIO/Garage/Ceph/SeaweedFS on a public hostname", () => {
      expect(enforceS3EndpointPolicy("https://minio.example.com:9000")).toMatch(/minio\.example/);
      expect(enforceS3EndpointPolicy("https://garage.tenant.io")).toMatch(/garage/);
      expect(enforceS3EndpointPolicy("https://ceph-rgw.corp.net")).toMatch(/ceph/);
      expect(enforceS3EndpointPolicy("https://seaweedfs.local.tld:8333")).toMatch(/seaweedfs/);
    });

    it("plain http on a public hostname (user accepts the cleartext risk)", () => {
      expect(enforceS3EndpointPolicy("http://minio.example.com:9000")).toMatch(/^http:\/\/minio/);
    });
  });

  describe("blocks SSRF-relevant private/metadata hosts by default", () => {
    it("AWS IMDS literal + link-local /16", () => {
      expect(() => enforceS3EndpointPolicy("http://169.254.169.254")).toThrow();
      expect(() => enforceS3EndpointPolicy("http://169.254.42.1")).toThrow();
    });

    it("GCP/Azure/Equinix metadata literals", () => {
      expect(() => enforceS3EndpointPolicy("http://metadata.google.internal")).toThrow();
      expect(() => enforceS3EndpointPolicy("http://metadata.azure.com")).toThrow();
      expect(() => enforceS3EndpointPolicy("http://metadata.platformequinix.com")).toThrow();
    });

    it("IPv6 link-local", () => {
      expect(() => enforceS3EndpointPolicy("http://[fe80::1]")).toThrow();
    });

    it("loopback (v4 + v6)", () => {
      expect(() => enforceS3EndpointPolicy("http://127.0.0.1:9000")).toThrow(/private\/loopback/);
      expect(() => enforceS3EndpointPolicy("http://localhost:9000")).toThrow(/private\/loopback/);
      expect(() => enforceS3EndpointPolicy("http://[::1]:9000")).toThrow(/private\/loopback/);
      expect(() => enforceS3EndpointPolicy("http://host.docker.internal:9000")).toThrow(/private\/loopback/);
    });

    it("RFC1918 / CGNAT / ULA-IPv6", () => {
      expect(() => enforceS3EndpointPolicy("http://10.0.0.1:9000")).toThrow(/private\/loopback/);
      expect(() => enforceS3EndpointPolicy("http://172.20.0.5:9000")).toThrow(/private\/loopback/);
      expect(() => enforceS3EndpointPolicy("http://192.168.1.5:9000")).toThrow(/private\/loopback/);
      expect(() => enforceS3EndpointPolicy("http://100.100.0.1:9000")).toThrow(/private\/loopback/);
      expect(() => enforceS3EndpointPolicy("http://[fd00::1]")).toThrow(/private\/loopback/);
    });

    it("rejects credentials in endpoint", () => {
      expect(() =>
        enforceS3EndpointPolicy("https://user:pass@my-bucket.s3.amazonaws.com"),
      ).toThrow(/credentials/);
    });

    it("rejects non-http(s) schemes", () => {
      expect(() => enforceS3EndpointPolicy("file:///etc/passwd")).toThrow(/http/);
    });
  });

  describe("opt-in private hosts", () => {
    it("S3_ALLOW_LOOPBACK=1 unlocks all loopback/RFC1918 (e.g. local MinIO sidecar)", () => {
      process.env.S3_ALLOW_LOOPBACK = "1";
      expect(enforceS3EndpointPolicy("http://127.0.0.1:9000")).toBe("http://127.0.0.1:9000");
      expect(enforceS3EndpointPolicy("http://localhost:9000")).toBe("http://localhost:9000");
      expect(enforceS3EndpointPolicy("http://10.0.0.1:9000")).toBe("http://10.0.0.1:9000");
    });

    it("still blocks IMDS even when S3_ALLOW_LOOPBACK=1", () => {
      process.env.S3_ALLOW_LOOPBACK = "1";
      expect(() => enforceS3EndpointPolicy("http://169.254.169.254")).toThrow();
      expect(() => enforceS3EndpointPolicy("http://metadata.google.internal")).toThrow();
    });

    it("S3_ALLOWED_HOSTS allows specific private hosts without flipping the global flag", () => {
      process.env.S3_ALLOWED_HOSTS = "minio.internal.corp,*.objects.internal";
      expect(enforceS3EndpointPolicy("https://minio.internal.corp")).toBe("https://minio.internal.corp");
      // Other RFC1918 hosts NOT in the list still rejected
      expect(() => enforceS3EndpointPolicy("http://10.0.0.1:9000")).toThrow(/private\/loopback/);
    });
  });
});
