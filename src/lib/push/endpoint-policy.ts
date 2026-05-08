import { isAllowedExternalUrl, parseAllowlist } from "@/lib/url-safety";

export const DEFAULT_PUSH_ALLOWED_HOSTS: string[] = [
  "fcm.googleapis.com",
  ".push.services.mozilla.com",
  "web.push.apple.com",
  ".push.apple.com",
  ".notify.windows.com",
  ".windows.com",
];

export function resolvePushHostAllowlist(): string[] {
  const override = parseAllowlist(process.env.PUSH_ALLOWED_HOSTS);
  return override.length > 0 ? override : DEFAULT_PUSH_ALLOWED_HOSTS;
}

export function validatePushEndpoint(rawUrl: string, allowlist: string[]): { ok: boolean; reason?: string } {
  return isAllowedExternalUrl(rawUrl, allowlist);
}
