"use client";

import * as React from "react";

import type { ProcessingFile, Translator } from "@/app/page-components/types";

interface CostEstimateProps {
  pendingFiles: ProcessingFile[];
  model: string;
  postProcessingEnabled?: boolean;
  postProcessingModel?: string;
  postProcessingFormat?: "markdown" | "json";
  t: Translator;
}

interface EstimateResponse {
  currency: string;
  totalPages: number;
  total: number;
  perPage: number;
  ocr: { pricing: { source: string; warnings: string[]; lastVerified?: string } };
  postProcessing?: { totalCost: number } | null;
  warnings: string[];
}

const SOURCE_LABEL: Record<string, [string, string, string, string, string]> = {
  "openrouter-live": [
    "OpenRouter (live)",
    "OpenRouter (live)",
    "OpenRouter (en direct)",
    "OpenRouter (en vivo)",
    "OpenRouter (live)",
  ],
  "litellm-mirror": [
    "LiteLLM (community)",
    "LiteLLM (community)",
    "LiteLLM (communauté)",
    "LiteLLM (comunidad)",
    "LiteLLM (Community)",
  ],
  "mistral-static": [
    "Mistral (statico)",
    "Mistral (static)",
    "Mistral (statique)",
    "Mistral (estático)",
    "Mistral (statisch)",
  ],
  "ollama-local": [
    "Locale (gratis)",
    "Local (free)",
    "Local (gratuit)",
    "Local (gratis)",
    "Lokal (kostenlos)",
  ],
  unknown: ["Sconosciuto", "Unknown", "Inconnu", "Desconocido", "Unbekannt"],
};

function formatUsd(n: number): string {
  if (n <= 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function CostEstimate({
  pendingFiles,
  model,
  postProcessingEnabled,
  postProcessingModel,
  postProcessingFormat,
  t,
}: CostEstimateProps) {
  const [estimate, setEstimate] = React.useState<EstimateResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const filesPayload = React.useMemo(
    () =>
      pendingFiles
        .filter((f) => f.status === "pending" || f.status === "offline-queued")
        .map((f) => ({ pageCount: Math.max(1, f.pageCount ?? f.pagePreviews?.length ?? 1), fileName: f.name })),
    [pendingFiles],
  );

  const filesKey = React.useMemo(
    () => filesPayload.map((f) => `${f.fileName}:${f.pageCount}`).join("|"),
    [filesPayload],
  );

  React.useEffect(() => {
    if (!model.trim() || filesPayload.length === 0) return;
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const body: Record<string, unknown> = { files: filesPayload, model };
        if (postProcessingEnabled && postProcessingModel) {
          body.postProcessing = {
            enabled: true,
            model: postProcessingModel,
            outputFormat: postProcessingFormat,
          };
        }
        const res = await fetch("/api/v1/ocr/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!res.ok) {
          setEstimate(null);
          setError(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as EstimateResponse;
        setEstimate(data);
        setError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setEstimate(null);
        setError((err as Error).message || "Estimate failed");
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [filesKey, model, postProcessingEnabled, postProcessingModel, postProcessingFormat]);

  if (!model.trim() || filesPayload.length === 0) return null;

  const sourceKey = estimate?.ocr.pricing.source ?? "unknown";
  const sourceLabels = SOURCE_LABEL[sourceKey] ?? SOURCE_LABEL.unknown;
  const sourceLabel = t(...sourceLabels);

  return (
    <div
      data-testid="cost-estimate"
      className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="shrink-0">
          {t("Stima costo", "Estimated cost", "Coût estimé", "Costo estimado", "Geschätzte Kosten")}:
        </span>
        {loading ? (
          <span className="text-muted-foreground/70">…</span>
        ) : error ? (
          <span className="text-muted-foreground/70">{error}</span>
        ) : estimate ? (
          <span className="font-medium text-foreground/80">
            {formatUsd(estimate.total)}{" "}
            <span className="text-muted-foreground/70">
              ({estimate.totalPages}{" "}
              {t("pagine", "pages", "pages", "páginas", "Seiten")})
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground/70">-</span>
        )}
      </span>
      {estimate ? (
        <span className="text-muted-foreground/60 shrink-0" title={estimate.warnings.join("\n") || sourceLabel}>
          {sourceLabel}
          {estimate.warnings.length > 0 ? " ⚠" : ""}
        </span>
      ) : null}
    </div>
  );
}
