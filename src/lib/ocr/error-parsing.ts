// Helpers for parsing service error payloads from upstream provider responses.
// Extracted from src/app/api/ocr/route.ts so they can be unit-tested without
// importing the full OCR pipeline.

export function getStringField(obj: unknown, key: string): string | null {
  if (
    obj &&
    typeof obj === "object" &&
    key in obj &&
    typeof (obj as Record<string, unknown>)[key] === "string"
  ) {
    return (obj as Record<string, unknown>)[key] as string;
  }
  return null;
}

export function parseServiceError(response: { statusText: string }, payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const nestedError = (payload as { error?: unknown }).error;
    if (nestedError && typeof nestedError === "object") {
      const msg =
        getStringField(nestedError, "message") ?? getStringField(nestedError, "detail");
      if (msg) return msg;
      const nestedErrors = (nestedError as Record<string, unknown>).errors as
        | unknown[]
        | undefined;
      if (
        Array.isArray(nestedErrors) &&
        nestedErrors.length > 0 &&
        typeof nestedErrors[0] === "string"
      ) {
        return nestedErrors[0] as string;
      }
    }
    const errStr = getStringField(payload, "error");
    if (errStr) return errStr;
  }
  return (
    getStringField(payload, "message") ??
    getStringField(payload, "detail") ??
    (response.statusText || "Request failed")
  );
}

export interface PreviewImageData {
  mimeType: string;
  base64: string;
  dataUrl: string;
}

export function parsePreviewImageData(preview: string): PreviewImageData {
  if (!preview) {
    return {
      mimeType: "image/jpeg",
      base64: "",
      dataUrl: "",
    };
  }

  const match = preview.match(/^data:([^;]+);base64,(.*)$/i);
  if (match) {
    const mimeType = match[1]?.trim() || "image/jpeg";
    const base64 = match[2] || "";
    return {
      mimeType,
      base64,
      dataUrl: `data:${mimeType};base64,${base64}`,
    };
  }

  if (preview.startsWith("data:") && preview.includes(",")) {
    const base64 = preview.slice(preview.indexOf(",") + 1);
    const mimeMatch = preview.match(/^data:([^;,]+)/i);
    const mimeType = mimeMatch?.[1]?.trim() || "image/jpeg";
    return {
      mimeType,
      base64,
      dataUrl: `data:${mimeType};base64,${base64}`,
    };
  }

  const base64 = preview.trim();
  return {
    mimeType: "image/jpeg",
    base64,
    dataUrl: `data:image/jpeg;base64,${base64}`,
  };
}
