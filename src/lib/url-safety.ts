const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00FFFFFF],
  [0x0A000000, 0x0AFFFFFF],
  [0x64400000, 0x647FFFFF],
  [0x7F000000, 0x7FFFFFFF],
  [0xA9FE0000, 0xA9FEFFFF],
  [0xAC100000, 0xAC1FFFFF],
  [0xC0000000, 0xC00000FF],
  [0xC0000200, 0xC00002FF],
  [0xC0586300, 0xC05863FF],
  [0xC0A80000, 0xC0A8FFFF],
  [0xC6120000, 0xC613FFFF],
  [0xC6336400, 0xC63364FF],
  [0xCB007100, 0xCB0071FF],
  [0xE0000000, 0xEFFFFFFF],
  [0xF0000000, 0xFFFFFFFE],
  [0xFFFFFFFF, 0xFFFFFFFF],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    total = (total << 8) + n;
  }
  return total >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return PRIVATE_IPV4_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!lower.includes(":")) return false;
  if (lower === "::" || lower === "::1") return true;
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  if (/^fec[0-9a-f]:/.test(lower)) return true;
  if (lower.startsWith("ff")) return true;
  if (lower.startsWith("::ffff:")) {
    const tail = lower.slice("::ffff:".length);
    return isPrivateIPv4(tail);
  }
  if (lower.startsWith("2002:")) {
    const parts = lower.split(":");
    if (parts.length >= 3) {
      const ipv4 = `${parseInt(parts[1].slice(0, 2) || "0", 16)}.${parseInt(parts[1].slice(2, 4) || "0", 16)}.${parseInt(parts[2].slice(0, 2) || "0", 16)}.${parseInt(parts[2].slice(2, 4) || "0", 16)}`;
      return isPrivateIPv4(ipv4);
    }
  }
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "localhost.localdomain") return true;
  if (lower.endsWith(".localhost") || lower.endsWith(".local") || lower.endsWith(".internal") || lower.endsWith(".lan")) {
    return true;
  }
  return false;
}

export function isPrivateOrLoopbackHost(host: string): boolean {
  if (!host) return true;
  const stripped = host.replace(/^\[|\]$/g, "");
  if (stripped.includes(":") && !/^\d+\.\d+\.\d+\.\d+$/.test(stripped)) {
    return isPrivateIPv6(stripped);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(stripped)) {
    return isPrivateIPv4(stripped);
  }
  return isPrivateHostname(stripped);
}

export interface UrlSafetyResult {
  ok: boolean;
  reason?: string;
}

export function isAllowedExternalUrl(rawUrl: string, allowlist: string[]): UrlSafetyResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL is not valid" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Only http(s) URLs are allowed" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(hostname)) {
    return { ok: false, reason: "Private, loopback, or link-local hosts are not allowed" };
  }
  if (allowlist.length === 0) return { ok: true };
  const matches = allowlist.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    if (e.startsWith(".")) return hostname === e.slice(1) || hostname.endsWith(e);
    return hostname === e || hostname.endsWith(`.${e}`);
  });
  if (!matches) {
    return { ok: false, reason: `Host ${hostname} is not in WEBHOOK_ALLOWED_HOSTS` };
  }
  return { ok: true };
}

export function parseAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function resolveAndCheckExternalUrl(rawUrl: string, allowlist: string[]): Promise<UrlSafetyResult> {
  const surface = isAllowedExternalUrl(rawUrl, allowlist);
  if (!surface.ok) return surface;
  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    return surface;
  }
  try {
    const dns = await import("node:dns/promises");
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records.length) {
      return { ok: false, reason: `${hostname} did not resolve to any address` };
    }
    for (const r of records) {
      if (isPrivateOrLoopbackHost(r.address)) {
        return { ok: false, reason: `${hostname} resolves to a private address (${r.address})` };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `DNS lookup failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
