"use client";

import * as React from "react";
import { GitCompare, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

import type { ProcessingFile, Translator } from "@/app/page-components/types";

interface ModelOption {
  id: string;
  name: string;
  provider?: string;
}

interface CompareJob {
  id: string;
  model: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  extractedText: string | null;
  processingMs: number | null;
  errorMessage: string | null;
  completedAt: string | null;
}

interface DiffSegment {
  op: "equal" | "insert" | "delete";
  text: string;
}

interface DiffSummary {
  equalChars: number;
  insertedChars: number;
  deletedChars: number;
  similarity: number;
}

interface DiffEntry {
  baselineJobId: string;
  candidateJobId: string;
  segments?: DiffSegment[];
  summary?: DiffSummary;
  truncated?: boolean;
}

interface CompareGetResponse {
  comparisonId: string;
  jobs: CompareJob[];
  diffs?: DiffEntry[];
}

export interface CompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedFile: ProcessingFile | null;
  models: ModelOption[];
  defaultModel: string;
  configuredProvider?: string;
  t: Translator;
}

export function CompareDialog({
  open,
  onOpenChange,
  selectedFile,
  models,
  defaultModel,
  configuredProvider,
  t,
}: CompareDialogProps) {
  const { toast } = useToast();
  const [picked, setPicked] = React.useState<string[]>([]);
  const [comparisonId, setComparisonId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<CompareGetResponse | null>(null);
  const [running, setRunning] = React.useState(false);

  const togglePicked = (id: string) => {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((m) => m !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setComparisonId(null);
    setData(null);
    setRunning(false);
    setPicked(defaultModel ? [defaultModel] : []);
  }, [open, defaultModel]);

  const startCompare = async () => {
    if (!selectedFile) return;
    if (picked.length < 2) {
      toast({ title: t("Scegli almeno 2 modelli", "Pick at least 2 models", "Choisis au moins 2 modèles", "Elige al menos 2 modelos", "Wähle mindestens 2 Modelle"), variant: "destructive" });
      return;
    }
    if (!selectedFile.preview) {
      toast({ title: t("Anteprima file mancante", "Missing file preview", "Aperçu manquant", "Vista previa faltante", "Vorschau fehlt"), variant: "destructive" });
      return;
    }
    setRunning(true);
    try {
      const body: Record<string, unknown> = {
        fileName: selectedFile.name,
        preview: selectedFile.preview,
        models: picked,
      };
      if (selectedFile.pagePreviews && selectedFile.pagePreviews.length > 0) {
        body.pages = selectedFile.pagePreviews;
      }
      const res = await fetch("/api/ocr/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { comparisonId?: string; error?: string };
      if (!res.ok || !json.comparisonId) {
        throw new Error(json.error || `Compare failed (${res.status})`);
      }
      setComparisonId(json.comparisonId);
    } catch (err) {
      toast({
        title: t("Compare failed", "Compare failed", "Échec de la comparaison", "Error al comparar", "Vergleich fehlgeschlagen"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      setRunning(false);
    }
  };

  React.useEffect(() => {
    if (!comparisonId) return;
    let cancelled = false;
    let delay = 2000;
    const startedAt = Date.now();
    const MAX_RUN_MS = 12 * 60 * 1000;
    const tick = async () => {
      try {
        const res = await fetch(`/api/ocr/compare?id=${encodeURIComponent(comparisonId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as CompareGetResponse;
        if (cancelled) return;
        setData(json);
        const allDone = json.jobs.every((j) => j.status === "COMPLETED" || j.status === "FAILED");
        if (allDone) {
          setRunning(false);
          return;
        }
      } catch { /* keep polling */ }
      if (cancelled) return;
      if (Date.now() - startedAt > MAX_RUN_MS) {
        setRunning(false);
        toast({
          title: t("Confronto interrotto", "Compare timed out", "Comparaison interrompue", "Comparación caducada", "Vergleich abgebrochen"),
          description: t("Le esecuzioni hanno superato il tempo massimo. Apri History per controllare i job rimasti in coda.", "Runs exceeded the time budget. Open History to check on the queued jobs.", "Les exécutions ont dépassé le budget de temps. Ouvre l'historique pour vérifier les jobs en file.", "Las ejecuciones superaron el límite. Abre el historial para revisar los trabajos pendientes.", "Die Läufe haben das Zeitbudget überschritten. Öffne den Verlauf, um die wartenden Jobs zu prüfen."),
          variant: "destructive",
        });
        return;
      }
      delay = Math.min(30_000, Math.round(delay * 1.4));
      setTimeout(tick, delay);
    };
    void tick();
    return () => { cancelled = true; };
  }, [comparisonId, t, toast]);

  const [explicitBaselineId, setExplicitBaselineId] = React.useState<string | null>(null);
  const knownBaseline = explicitBaselineId && data?.jobs.some((j) => j.id === explicitBaselineId)
    ? explicitBaselineId
    : null;
  const baselineId = knownBaseline ?? data?.jobs[0]?.id;
  React.useEffect(() => {
    if (!open || !comparisonId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExplicitBaselineId(null);
    }
  }, [open, comparisonId]);

  const findDiff = (baselineJobId: string | undefined, candidateJobId: string): DiffEntry | undefined => {
    if (!data?.diffs || !baselineJobId) return undefined;
    const direct = data.diffs.find((d) => d.baselineJobId === baselineJobId && d.candidateJobId === candidateJobId);
    if (direct) return direct;
    const reversed = data.diffs.find((d) => d.baselineJobId === candidateJobId && d.candidateJobId === baselineJobId);
    if (!reversed) return undefined;
    const flippedSegments = reversed.segments?.map((s) =>
      s.op === "equal" ? s : { op: s.op === "insert" ? "delete" : "insert", text: s.text } as const,
    );
    const summary = reversed.summary
      ? {
          equalChars: reversed.summary.equalChars,
          insertedChars: reversed.summary.deletedChars,
          deletedChars: reversed.summary.insertedChars,
          similarity: reversed.summary.similarity,
        }
      : undefined;
    return {
      baselineJobId,
      candidateJobId,
      segments: flippedSegments,
      summary,
      truncated: reversed.truncated,
    };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>
            {t("Confronta modelli OCR", "Compare OCR models", "Comparer les modèles OCR", "Comparar modelos OCR", "OCR-Modelle vergleichen")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Esegui lo stesso file con 2-4 modelli e confronta i risultati fianco a fianco.",
              "Run the same file with 2-4 models and compare the outputs side by side.",
              "Lance le même fichier sur 2-4 modèles et compare les sorties côte à côte.",
              "Procesa el mismo archivo con 2-4 modelos y compara los resultados uno al lado del otro.",
              "Verarbeite dieselbe Datei mit 2-4 Modellen und vergleiche die Ergebnisse Seite an Seite.",
            )}
          </DialogDescription>
        </DialogHeader>

        {!comparisonId ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">
                {t("Modelli (2-4)", "Models (2-4)", "Modèles (2-4)", "Modelos (2-4)", "Modelle (2-4)")}
                <span className="ml-2 text-muted-foreground">{picked.length}/4</span>
              </Label>
              <ScrollArea className="h-72 rounded border mt-1">
                <div className="p-1">
                  {(() => {
                    const provider = configuredProvider?.trim() || "";
                    const visible = provider
                      ? models.filter((m) => !m.provider || m.provider === provider)
                      : models;
                    if (visible.length === 0) {
                      return (
                        <p className="text-xs text-muted-foreground italic p-3">
                          {t(
                            "Nessun modello disponibile per il provider configurato.",
                            "No models available for the configured provider.",
                            "Aucun modèle disponible pour le fournisseur configuré.",
                            "No hay modelos disponibles para el proveedor configurado.",
                            "Keine Modelle für den konfigurierten Anbieter verfügbar.",
                          )}
                        </p>
                      );
                    }
                    return visible.map((m) => {
                      const isPicked = picked.includes(m.id);
                      const disabled = !isPicked && picked.length >= 4;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => togglePicked(m.id)}
                          disabled={disabled}
                          className={`w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary/50 ${isPicked ? "bg-primary/10" : ""} ${disabled ? "opacity-50" : ""}`}
                        >
                          <span className="truncate">{m.name}</span>
                          <span className="text-[10px] text-muted-foreground">{m.provider}</span>
                        </button>
                      );
                    });
                  })()}
                </div>
              </ScrollArea>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
              </Button>
              <Button size="sm" onClick={() => void startCompare()} disabled={running || picked.length < 2}>
                <GitCompare className="size-3.5 mr-1.5" />
                {t("Avvia confronto", "Start compare", "Lancer la comparaison", "Iniciar comparación", "Vergleich starten")}
              </Button>
            </div>
          </div>
        ) : (
          <ScrollArea className="max-h-[65vh]">
            {!data ? (
              <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("Avvio…", "Starting…", "Démarrage…", "Iniciando…", "Wird gestartet…")}
              </div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${data.jobs.length}, minmax(0, 1fr))` }}>
                {data.jobs.map((job) => {
                  const isBaseline = job.id === baselineId;
                  const diff = isBaseline ? undefined : findDiff(baselineId, job.id);
                  return (
                    <div key={job.id} className="border rounded-md flex flex-col min-h-0">
                      <div className="p-2 border-b bg-secondary/30 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setExplicitBaselineId(job.id)}
                            className="text-xs font-medium truncate hover:underline text-left"
                            title={isBaseline
                              ? t("base attuale", "current base", "base actuelle", "base actual", "aktuelle Basis")
                              : t("imposta come base", "set as base", "définir comme base", "establecer como base", "als Basis festlegen")}
                          >
                            {job.model}
                          </button>
                          {isBaseline ? <Badge variant="outline" className="text-[10px] py-0 px-1">{t("base", "base", "base", "base", "base")}</Badge> : null}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Badge variant={job.status === "COMPLETED" ? "secondary" : job.status === "FAILED" ? "destructive" : "outline"} className="text-[10px] py-0 px-1">
                            {job.status.toLowerCase()}
                          </Badge>
                          {job.processingMs ? <span>{(job.processingMs / 1000).toFixed(1)}s</span> : null}
                          {diff?.summary ? (
                            <span title={`+${diff.summary.insertedChars} / -${diff.summary.deletedChars}`}>
                              {Math.round(diff.summary.similarity * 100)}% match
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex-1 p-2 text-[11px] font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-h-[55vh] overflow-y-auto">
                        {job.status === "FAILED" ? (
                          <span className="text-destructive">{job.errorMessage || "failed"}</span>
                        ) : job.status !== "COMPLETED" ? (
                          <span className="text-muted-foreground italic">…</span>
                        ) : isBaseline || !diff?.segments ? (
                          job.extractedText || ""
                        ) : (
                          diff.segments.map((seg, i) =>
                            seg.op === "equal" ? (
                              <span key={i}>{seg.text}</span>
                            ) : seg.op === "insert" ? (
                              <span key={i} className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">{seg.text}</span>
                            ) : (
                              <span key={i} className="bg-rose-500/20 text-rose-700 dark:text-rose-300 line-through">{seg.text}</span>
                            ),
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
