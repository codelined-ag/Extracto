"use client";

import * as React from "react";
import { Loader2, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

interface ModelStat {
  provider: string;
  model: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  meanMs: number | null;
}

interface RecommendationEntry {
  documentType: string;
  best: ModelStat | null;
  alternatives: ModelStat[];
  insufficientData: boolean;
}

interface RecommendationsResponse {
  lookbackDays: number;
  sampleCount: number;
  totalScannedJobs: number;
  recommendations: RecommendationEntry[];
}

export interface RecommendationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: Translator;
}

export function RecommendationsDialog({ open, onOpenChange, t }: RecommendationsDialogProps) {
  const { toast } = useToast();
  const [data, setData] = React.useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setData(null);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/v1/recommendations");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as RecommendationsResponse;
        if (cancelled) return;
        setData(json);
      } catch (err) {
        if (cancelled) return;
        toast({
          title: t("Caricamento fallito", "Failed to load", "Échec du chargement", "Error al cargar", "Laden fehlgeschlagen"),
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, toast, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" />
            {t("Modelli consigliati per te", "Models recommended for you", "Modèles recommandés pour vous", "Modelos recomendados para ti", "Für dich empfohlene Modelle")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Classificati per percentuale di successo (e tempo medio come spareggio) sui tuoi job recenti, raggruppati per tipo di documento.",
              "Ranked by success rate (mean time as tiebreaker) over your recent jobs, grouped by document type.",
              "Classés par taux de succès (temps moyen en départage) sur tes jobs récents, regroupés par type de document.",
              "Ordenados por tasa de éxito (tiempo medio como desempate) sobre tus trabajos recientes, agrupados por tipo de documento.",
              "Sortiert nach Erfolgsrate (mittlere Zeit als Tiebreaker) über deine letzten Jobs, gruppiert nach Dokumenttyp.",
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("Calcolo…", "Computing…", "Calcul…", "Calculando…", "Wird berechnet…")}
          </div>
        ) : !data ? null : data.sampleCount === 0 ? (
          <p className="text-sm text-muted-foreground p-4">
            {t(
              "Non hai abbastanza job recenti per calcolare consigli. Prova qualche modello e torna qui.",
              "Not enough recent jobs to compute recommendations. Try a few models and come back.",
              "Pas assez de jobs récents pour calculer des recommandations. Essaie quelques modèles et reviens.",
              "No hay suficientes trabajos recientes para calcular recomendaciones. Prueba algunos modelos y vuelve.",
              "Nicht genug aktuelle Jobs, um Empfehlungen zu berechnen. Probiere ein paar Modelle und komm zurück.",
            )}
          </p>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {t(
                  `${data.sampleCount} job analizzati negli ultimi ${data.lookbackDays} giorni (${data.totalScannedJobs} totali).`,
                  `${data.sampleCount} jobs analyzed in the last ${data.lookbackDays} days (${data.totalScannedJobs} total).`,
                  `${data.sampleCount} jobs analysés sur les ${data.lookbackDays} derniers jours (${data.totalScannedJobs} au total).`,
                  `${data.sampleCount} trabajos analizados en los últimos ${data.lookbackDays} días (${data.totalScannedJobs} total).`,
                  `${data.sampleCount} Jobs in den letzten ${data.lookbackDays} Tagen analysiert (${data.totalScannedJobs} insgesamt).`,
                )}
              </p>
              {data.recommendations.map((rec) => (
                <div key={rec.documentType} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium capitalize">{rec.documentType}</h4>
                    {rec.insufficientData ? (
                      <Badge variant="outline" className="text-[10px]">
                        {t("dati insufficienti", "insufficient data", "données insuffisantes", "datos insuficientes", "zu wenige Daten")}
                      </Badge>
                    ) : null}
                  </div>
                  {rec.best ? (
                    <div className="flex items-center gap-2 text-sm flex-wrap">
                      <Badge variant="secondary">{rec.best.model}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(rec.best.successRate * 100)}% · {rec.best.attempts} runs
                        {rec.best.meanMs ? ` · avg ${(rec.best.meanMs / 1000).toFixed(1)}s` : ""}
                      </span>
                      {rec.best.attempts < 10 ? (
                        <Badge variant="outline" className="text-[10px] py-0 px-1">
                          {t("bassa fiducia", "low confidence", "faible confiance", "baja confianza", "geringe Sicherheit")}
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                  {rec.alternatives.length > 0 ? (
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>{t("alternative", "alternatives", "alternatives", "alternativas", "Alternativen")}:</div>
                      <ul className="space-y-0.5">
                        {rec.alternatives.slice(0, 3).map((alt) => (
                          <li key={alt.model} className="flex items-center gap-2">
                            <span className="font-mono text-[11px] truncate">{alt.model}</span>
                            <span>· {Math.round(alt.successRate * 100)}%</span>
                            <span>· {alt.attempts} runs</span>
                            {alt.meanMs ? <span>· {(alt.meanMs / 1000).toFixed(1)}s</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
