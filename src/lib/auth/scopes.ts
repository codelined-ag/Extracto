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

export type ScopeEntry = Scope | typeof WILDCARD_SCOPE;

const VALID_SCOPE_ENTRIES: ReadonlySet<string> = new Set([...ALL_SCOPES, WILDCARD_SCOPE]);

function isScopeEntryString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Parse a stored or user-supplied scope list into a strongly-typed
 * ScopeEntry[]. Strings that don't match a known scope (after
 * case-folding + trim) are dropped — callers should NOT assume that
 * arbitrary strings round-trip; this is the validation barrier.
 */
export function parseScopeList(raw: unknown): ScopeEntry[] {
  let candidates: string[] = [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        candidates = parsed.filter(isScopeEntryString);
      }
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    candidates = raw.filter(isScopeEntryString);
  }
  const normalized: ScopeEntry[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate.trim().toLowerCase();
    if (VALID_SCOPE_ENTRIES.has(trimmed)) {
      normalized.push(trimmed as ScopeEntry);
    }
  }
  return normalized;
}

export function serializeScopeList(scopes: string[]): string {
  return JSON.stringify(scopes);
}

export function normalizeRequestedScopes(input: unknown): string[] {
  const list = parseScopeList(input);
  if (list.includes(WILDCARD_SCOPE)) return [WILDCARD_SCOPE];
  const filtered = Array.from(new Set(list.filter((s): s is Scope => s !== WILDCARD_SCOPE)));
  if (filtered.length === 0) return [...ALL_SCOPES];
  return filtered;
}

export function scopeListGrants(scopes: string[], required: Scope): boolean {
  if (scopes.includes(WILDCARD_SCOPE)) return true;
  return scopes.includes(required);
}
