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

  const fieldMatch = /^"([\s\S]*?)"\s*(?:,\s*"[\w$-]+"\s*:|\}\s*$)/u.exec(valueSlice);
  if (!fieldMatch?.[1]) {
    return null;
  }

  const decoded = fieldMatch[1]
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\")
    .trim();

  return decoded || null;
}
