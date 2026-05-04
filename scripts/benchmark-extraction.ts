#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";

import { extractPdfAnchoring, assessTextLayerQuality } from "@/lib/ocr/pdf-anchoring";
import { extractMarkdownFromTextLayer } from "@/lib/ocr/text-layer-extraction";
import { buildAnchoredOcrPrompt } from "@/lib/ocr/anchoring-prompt";
import { applyDocumentPresetToPrompt } from "@/lib/ocr/document-presets";
import { runCompatOcr, OPENROUTER_CONFIG } from "@/lib/ocr/providers/compat";
import type { ApiProviderSettings } from "@/lib/api-types";

interface PageReport {
  pageNumber: number;
  textLayerChars: number;
  textLayerBlocks: number;
  textLayerColumns: number;
  textLayerHighConfidence: boolean;
  vlmCharsBaseline?: number;
  vlmCharsAnchored?: number;
  vlmCharsTextLayer?: number;
  baselineLatencyMs?: number;
  anchoredLatencyMs?: number;
  textLayerLatencyMs?: number;
  baselineExcerpt?: string;
  anchoredExcerpt?: string;
  textLayerExcerpt?: string;
  notes: string[];
}

interface CliArgs {
  pdfPath: string;
  model: string;
  pageLimit: number;
  outFile?: string;
  preset: "generic" | "academic" | "invoice" | "contract" | "form";
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: bun scripts/benchmark-extraction.ts <pdf> [--model NAME] [--limit N] [--out FILE] [--preset KIND]");
    process.exit(1);
  }
  const out: CliArgs = {
    pdfPath: args[0],
    model: "anthropic/claude-3.5-sonnet",
    pageLimit: 5,
    preset: "generic",
  };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--model") out.model = args[++i];
    else if (args[i] === "--limit") out.pageLimit = parseInt(args[++i], 10);
    else if (args[i] === "--out") out.outFile = args[++i];
    else if (args[i] === "--preset") out.preset = args[++i] as CliArgs["preset"];
  }
  return out;
}

async function renderPagePreviewImage(pdfPath: string, pageNumber: number): Promise<string> {
  const tmp = await import("node:fs/promises");
  const os = await import("node:os");
  const tmpDir = await tmp.mkdtemp(path.join(os.tmpdir(), "extracto-bench-"));
  const stem = path.join(tmpDir, "page");
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "pdftoppm",
        ["-singlefile", "-f", String(pageNumber), "-l", String(pageNumber), "-jpeg", "-r", "150", pdfPath, stem],
        (error) => (error ? reject(error) : resolve()),
      );
    });
    const jpg = await tmp.readFile(`${stem}.jpg`);
    return `data:image/jpeg;base64,${jpg.toString("base64")}`;
  } finally {
    await tmp.rm(tmpDir, { recursive: true, force: true });
  }
}

const BASE_PROMPT = `You are an OCR system. Extract all visible text from the page image as clean markdown.
Preserve heading hierarchy (#, ##, ###), tables (markdown table syntax), and reading order.
Return ONLY a JSON object: {"markdown": "..."}.`;

async function callOpenRouter(
  apiKey: string,
  model: string,
  prompt: string,
  preview: string,
): Promise<{ text: string; latencyMs: number }> {
  const settings: ApiProviderSettings = {
    provider: "openrouter",
    apiEndpoint: "https://openrouter.ai/api/v1",
    apiKey,
  };
  const t0 = Date.now();
  const result = await runCompatOcr(
    OPENROUTER_CONFIG,
    settings.apiEndpoint,
    model,
    apiKey,
    prompt,
    preview,
  );
  return { text: result.text, latencyMs: Date.now() - t0 };
}

async function main() {
  const args = parseArgs();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY not set in env");
    process.exit(2);
  }

  console.log(`reading ${args.pdfPath}...`);
  const pdfBytes = await readFile(args.pdfPath);
  console.log(`extracting text-layer anchoring...`);
  const anchor = await extractPdfAnchoring(new Uint8Array(pdfBytes));
  if (!anchor) {
    console.error("could not extract anchoring (not a PDF?)");
    process.exit(3);
  }
  console.log(`pages=${anchor.pageCount}, benchmarking first ${Math.min(args.pageLimit, anchor.pageCount)}...`);

  const reports: PageReport[] = [];
  for (let i = 0; i < Math.min(args.pageLimit, anchor.pageCount); i++) {
    const page = anchor.pages[i];
    const quality = assessTextLayerQuality(page);
    const textLayerExtraction = extractMarkdownFromTextLayer(page);
    const report: PageReport = {
      pageNumber: page.pageNumber,
      textLayerChars: page.characterCount,
      textLayerBlocks: page.blocks.length,
      textLayerColumns: textLayerExtraction.columnCount,
      textLayerHighConfidence: quality.isHighConfidence,
      notes: [],
    };

    console.log(`\n=== page ${page.pageNumber} ===`);
    console.log(`  text-layer: ${page.characterCount} chars, ${page.blocks.length} blocks, ${textLayerExtraction.columnCount} columns`);

    let preview: string;
    try {
      preview = await renderPagePreviewImage(args.pdfPath, page.pageNumber);
    } catch (e) {
      report.notes.push(`pdftoppm failed: ${(e as Error).message}; skipping VLM tests on this page`);
      reports.push(report);
      continue;
    }

    const presetPrompt = applyDocumentPresetToPrompt(BASE_PROMPT, args.preset);

    try {
      console.log(`  baseline VLM (${args.model})...`);
      const baseline = await callOpenRouter(apiKey, args.model, presetPrompt, preview);
      report.vlmCharsBaseline = baseline.text.length;
      report.baselineLatencyMs = baseline.latencyMs;
      report.baselineExcerpt = baseline.text.slice(0, 240);
    } catch (e) {
      report.notes.push(`baseline failed: ${(e as Error).message}`);
    }

    try {
      const anchoredPrompt = buildAnchoredOcrPrompt(presetPrompt, page);
      console.log(`  anchored VLM (${args.model})...`);
      const anchored = await callOpenRouter(apiKey, args.model, anchoredPrompt, preview);
      report.vlmCharsAnchored = anchored.text.length;
      report.anchoredLatencyMs = anchored.latencyMs;
      report.anchoredExcerpt = anchored.text.slice(0, 240);
    } catch (e) {
      report.notes.push(`anchored failed: ${(e as Error).message}`);
    }

    if (quality.isHighConfidence) {
      const t0 = Date.now();
      report.vlmCharsTextLayer = textLayerExtraction.markdown.length;
      report.textLayerLatencyMs = Date.now() - t0;
      report.textLayerExcerpt = textLayerExtraction.markdown.slice(0, 240);
    } else {
      report.notes.push("text-layer quality below threshold; fast-path skipped");
    }
    reports.push(report);
  }

  console.log("\n=== SUMMARY ===");
  console.table(
    reports.map((r) => ({
      page: r.pageNumber,
      chars_textlayer: r.vlmCharsTextLayer ?? "-",
      chars_baseline: r.vlmCharsBaseline ?? "-",
      chars_anchored: r.vlmCharsAnchored ?? "-",
      ms_textlayer: r.textLayerLatencyMs ?? "-",
      ms_baseline: r.baselineLatencyMs ?? "-",
      ms_anchored: r.anchoredLatencyMs ?? "-",
      cols: r.textLayerColumns,
      anchor_blocks: r.textLayerBlocks,
    })),
  );

  if (args.outFile) {
    await writeFile(args.outFile, JSON.stringify({ pdfPath: args.pdfPath, model: args.model, preset: args.preset, reports }, null, 2));
    console.log(`\nwrote detailed report to ${args.outFile}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
