/**
 * LangChain tool wrapper for Extracto's batch OCR endpoint.
 *
 * Setup:
 *   bun add @langchain/core zod
 *   export EXTRACTO_URL=http://localhost:3000
 *   export EXTRACTO_TOKEN=extr_...
 *
 * Use it in your agent:
 *   import { extractoOcrTool } from "./langchain_tool";
 *   const result = await extractoOcrTool.invoke({
 *     fileName: "page.png",
 *     model: "anthropic/claude-haiku-4.5",
 *     dataUrl: "data:image/png;base64,iVBORw0K...",
 *   });
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const EXTRACTO_URL = (process.env.EXTRACTO_URL ?? "http://localhost:3000").replace(/\/+$/u, "");
const EXTRACTO_TOKEN = process.env.EXTRACTO_TOKEN ?? "";

if (!EXTRACTO_TOKEN) {
  throw new Error("EXTRACTO_TOKEN is required");
}

async function pollUntilDone(jobId: string, timeoutMs = 5 * 60_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${EXTRACTO_URL}/api/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${EXTRACTO_TOKEN}` },
    });
    const payload = (await res.json()) as { job?: { status?: string; extractedText?: string; errorMessage?: string } };
    const job = payload.job ?? {};
    if (job.status === "COMPLETED") return job.extractedText ?? "";
    if (job.status === "FAILED") throw new Error(job.errorMessage ?? "Extracto OCR failed");
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Extracto OCR timed out after ${timeoutMs}ms`);
}

export const extractoOcrTool = tool(
  async ({ fileName, model, dataUrl }: { fileName: string; model: string; dataUrl: string }) => {
    const submit = await fetch(`${EXTRACTO_URL}/api/v1/ocr/batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${EXTRACTO_TOKEN}`,
        "Content-Type": "application/json",
        Origin: EXTRACTO_URL,
      },
      body: JSON.stringify({ files: [{ fileName, model, preview: dataUrl }] }),
    });
    if (!submit.ok) {
      throw new Error(`Submit failed: ${submit.status} ${await submit.text()}`);
    }
    const { submissions } = (await submit.json()) as { submissions: Array<{ jobId: string }> };
    return await pollUntilDone(submissions[0].jobId);
  },
  {
    name: "extracto_ocr",
    description:
      "Run OCR on a document (PDF or image) and return the extracted text. Pass the bytes as a data: URL.",
    schema: z.object({
      fileName: z.string().describe("Display name for the file (used in history)."),
      model: z.string().describe("Provider model id (e.g. 'anthropic/claude-haiku-4.5')."),
      dataUrl: z.string().describe("data:image/* or data:application/pdf;base64,... URL."),
    }),
  },
);
