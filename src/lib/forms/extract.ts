export interface FormFieldEntry {
  field: string;
  value: string | number | boolean | null;
  page?: number;
}

export interface FormFieldsResult {
  fields: FormFieldEntry[];
  byField: Record<string, FormFieldEntry["value"]>;
  source: "result.structured.fields.form" | "page-fields" | "absent";
}

export function extractFormFields(result: unknown): FormFieldsResult {
  const flat: FormFieldEntry[] = [];
  const seen = new Set<string>();
  const byField: Record<string, FormFieldEntry["value"]> = {};

  if (result && typeof result === "object") {
    const r = result as { structured?: unknown };
    const structured = r.structured;
    if (structured && typeof structured === "object") {
      const formObj = readFormObject((structured as { fields?: unknown }).fields);
      if (formObj) {
        flatten(formObj, flat, byField, seen);
        if (flat.length > 0) {
          return { fields: flat, byField, source: "result.structured.fields.form" };
        }
      }
      const pages = (structured as { pages?: unknown }).pages;
      if (Array.isArray(pages)) {
        for (const page of pages) {
          if (!page || typeof page !== "object") continue;
          const pn = (page as { pageNumber?: unknown }).pageNumber;
          const pageNumber = typeof pn === "number" ? pn : undefined;
          const pageForm = readFormObject((page as { fields?: unknown }).fields);
          if (pageForm) flatten(pageForm, flat, byField, seen, pageNumber);
        }
        if (flat.length > 0) {
          return { fields: flat, byField, source: "page-fields" };
        }
      }
    }
  }

  return { fields: [], byField: {}, source: "absent" };
}

function readFormObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.form && typeof v.form === "object" && !Array.isArray(v.form)) {
    return v.form as Record<string, unknown>;
  }
  return null;
}

function flatten(
  source: Record<string, unknown>,
  out: FormFieldEntry[],
  byField: Record<string, FormFieldEntry["value"]>,
  seen: Set<string>,
  pageNumber?: number,
  prefix = "",
): void {
  for (const [rawKey, raw] of Object.entries(source)) {
    const key = prefix ? `${prefix}.${rawKey}` : rawKey;
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      const value = typeof raw === "string" ? raw.trim() : raw;
      if (value === "") continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ field: key, value, ...(pageNumber !== undefined ? { page: pageNumber } : {}) });
      byField[key] = value;
      continue;
    }
    if (Array.isArray(raw)) {
      const flatArray = raw.filter(
        (v): v is string | number | boolean => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
      );
      if (flatArray.length === raw.length && flatArray.length > 0 && !seen.has(key)) {
        seen.add(key);
        const arrValue = flatArray.join(", ");
        out.push({ field: key, value: arrValue, ...(pageNumber !== undefined ? { page: pageNumber } : {}) });
        byField[key] = arrValue;
      }
      continue;
    }
    if (typeof raw === "object") {
      flatten(raw as Record<string, unknown>, out, byField, seen, pageNumber, key);
    }
  }
}
