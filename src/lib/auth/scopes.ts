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
  "kb:write",
  "s3:read",
  "s3:write",
] as const;

export type Scope = (typeof ALL_SCOPES)[number];

export const WILDCARD_SCOPE = "*";

export type ScopeEntry = Scope | typeof WILDCARD_SCOPE;

const VALID_SCOPE_ENTRIES: ReadonlySet<string> = new Set([...ALL_SCOPES, WILDCARD_SCOPE]);

export class ScopeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeValidationError";
  }
}

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

function parseRequestedScopeCandidates(input: unknown): string[] {
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (!Array.isArray(parsed)) {
        throw new ScopeValidationError("scopes must be an array of scope strings");
      }
      return parsed.map((entry) => {
        if (typeof entry !== "string") {
          throw new ScopeValidationError("scopes must contain only strings");
        }
        return entry;
      });
    } catch (error) {
      if (error instanceof ScopeValidationError) throw error;
      throw new ScopeValidationError("scopes must be a JSON array of scope strings");
    }
  }

  if (!Array.isArray(input)) {
    throw new ScopeValidationError("scopes must be an array of scope strings");
  }

  return input.map((entry) => {
    if (typeof entry !== "string") {
      throw new ScopeValidationError("scopes must contain only strings");
    }
    return entry;
  });
}

export function normalizeRequestedScopes(input: unknown): string[] {
  if (input === undefined) return [...ALL_SCOPES];

  const candidates = parseRequestedScopeCandidates(input);
  if (candidates.length === 0) {
    throw new ScopeValidationError("At least one scope is required");
  }

  const invalidScopes: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate.trim().toLowerCase();
    if (!trimmed || !VALID_SCOPE_ENTRIES.has(trimmed)) {
      invalidScopes.push(candidate);
    }
  }
  if (invalidScopes.length > 0) {
    throw new ScopeValidationError(`Invalid scope: ${invalidScopes[0]}`);
  }

  const list = parseScopeList(candidates);
  if (list.includes(WILDCARD_SCOPE)) return [WILDCARD_SCOPE];
  const filtered = Array.from(new Set(list.filter((s): s is Scope => s !== WILDCARD_SCOPE)));
  if (filtered.length === 0) {
    throw new ScopeValidationError("At least one scope is required");
  }
  return filtered;
}

export function scopeListGrants(scopes: string[], required: Scope): boolean {
  if (scopes.includes(WILDCARD_SCOPE)) return true;
  return scopes.includes(required);
}
