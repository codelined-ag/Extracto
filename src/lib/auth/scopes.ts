export const ALL_SCOPES = [
  "ocr:submit",
  "ocr:read",
  "ocr:control",
  "settings:read",
  "settings:write",
  "webhooks:read",
  "webhooks:write",
  "presets:read",
  "presets:write",
  "search:read",
] as const;

export type Scope = (typeof ALL_SCOPES)[number];

export const WILDCARD_SCOPE = "*";

export function parseScopeList(raw: unknown): string[] {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === "string");
  }
  return [];
}

export function serializeScopeList(scopes: string[]): string {
  return JSON.stringify(scopes);
}

export function normalizeRequestedScopes(input: unknown): string[] {
  const list = parseScopeList(input);
  const normalized = new Set<string>();
  for (const entry of list) {
    const trimmed = entry.trim().toLowerCase();
    if (!trimmed) continue;
    if (trimmed === WILDCARD_SCOPE) {
      return [WILDCARD_SCOPE];
    }
    if (ALL_SCOPES.includes(trimmed as Scope)) {
      normalized.add(trimmed);
    }
  }
  if (normalized.size === 0) {
    return [WILDCARD_SCOPE];
  }
  return Array.from(normalized);
}

export function scopeListGrants(scopes: string[], required: Scope): boolean {
  if (scopes.includes(WILDCARD_SCOPE)) return true;
  return scopes.includes(required);
}
