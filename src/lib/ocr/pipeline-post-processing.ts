import type { PostProcessingSettings, PostProcessOutputFormat } from "@/lib/ocr/settings";

export function buildPostProcessingPrompt(
  postProcessing: PostProcessingSettings,
): { systemPrompt: string; userPrompt: string } {
  const outputInstruction =
    postProcessing.outputFormat === "json"
      ? "Return only valid JSON (no markdown code fences)."
      : "Return markdown only.";

  return {
    systemPrompt:
      "You are a precise post-processing assistant for OCR results. " +
      "Follow the user instruction exactly. Do not invent missing facts. " +
      "If data is missing, set fields to null or explicitly note missing values.",
    userPrompt: [
      "User instruction:",
      postProcessing.instruction,
      "",
      "Output format requirement:",
      outputInstruction,
    ].join("\n"),
  };
}

export function formatPageScopedText(
  pages: Array<{ pageNumber: number; text: string }>,
): string {
  return pages
    .map((page) => [`[PAGE ${page.pageNumber}]`, page.text.trim(), `[END PAGE ${page.pageNumber}]`].join("\n"))
    .join("\n\n");
}

export function computeTextStats(text: string) {
  const trimmed = text.trim();
  return {
    characterCount: trimmed.length,
    wordCount: trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0,
    lineCount: trimmed ? trimmed.split("\n").filter(Boolean).length : 0,
  };
}

export function normalizePostProcessedText(
  text: string,
  outputFormat: PostProcessOutputFormat,
): { text: string; parsedJson?: unknown } {
  if (outputFormat !== "json") {
    return { text: text.trim() };
  }

  const trimmed = text.trim();
  const codeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  const jsonCandidate = (codeFenceMatch?.[1] || trimmed).trim();
  try {
    const parsed = JSON.parse(jsonCandidate);
    return {
      text: JSON.stringify(parsed, null, 2),
      parsedJson: parsed,
    };
  } catch {
    return { text: trimmed };
  }
}
