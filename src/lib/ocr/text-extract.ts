export function extractFirstBalancedJsonObject(input: string): string | null {
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let escapeNext = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && startIndex >= 0) {
          return input.slice(startIndex, index + 1);
        }
      }
    }
  }

  return null;
}

export function extractMarkdownFromJsonLikeText(raw: string): string | null {
  const normalized = raw
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/```$/u, "")
    .replace(/^json\s*/iu, "");

  const keyMatch = /"markdown"\s*:/iu.exec(normalized);
  if (!keyMatch) {
    return null;
  }

  const valueSlice = normalized.slice(keyMatch.index + keyMatch[0].length).trimStart();
  if (!valueSlice.startsWith("\"")) {
    return null;
  }

  const rawValue = scanJsonStringValue(valueSlice);
  if (rawValue === null) {
    return null;
  }

  const decoded = rawValue
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\")
    .trim();

  return decoded || null;
}

function scanJsonStringValue(input: string): string | null {
  if (input[0] !== "\"") return null;
  let escapeNext = false;
  for (let i = 1; i < input.length; i++) {
    const ch = input[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === "\"") {
      return input.slice(1, i);
    }
  }
  return null;
}
