import { OcrJobStatus } from "@prisma/client";

export interface SavedSearchFilters {
  q?: string;
  status?: OcrJobStatus;
  from?: string;
  to?: string;
  tagIds?: string[];
  model?: string;
}

const VALID_STATUSES = new Set<string>(Object.values(OcrJobStatus));

const trimmedString = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (!t) return undefined;
  return t.slice(0, max);
};

export const normalizeSavedSearchFilters = (input: unknown): SavedSearchFilters => {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const filters: SavedSearchFilters = {};
  const q = trimmedString(raw.q, 200);
  if (q) filters.q = q;
  if (typeof raw.status === "string" && VALID_STATUSES.has(raw.status)) {
    filters.status = raw.status as OcrJobStatus;
  }
  const from = trimmedString(raw.from, 64);
  if (from) filters.from = from;
  const to = trimmedString(raw.to, 64);
  if (to) filters.to = to;
  const model = trimmedString(raw.model, 200);
  if (model) filters.model = model;
  if (Array.isArray(raw.tagIds)) {
    const tagIds = Array.from(
      new Set(raw.tagIds.filter((v): v is string => typeof v === "string" && v.length > 0)),
    );
    if (tagIds.length > 0) filters.tagIds = tagIds;
  }
  return filters;
};

export const normalizeSavedSearchName = (raw: unknown): string => {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, 64);
};
