"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

interface UsagePayload {
  jobs: { total: number; completed: number; failed: number; running: number };
  resources: {
    apiKeys: number;
    outputPresets: number;
    webhooks: number;
    jobTemplates: number;
    watchedS3Sources: number;
    pushSubscriptions: number;
  };
  aggregate: { totalProcessingMs: number };
  recentJobs: Array<{ id: string; fileName: string; status: string; model: string; createdAt: string }>;
}

function formatDuration(ms: number): string {
  if (!ms) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export interface UsageSectionProps {
  t: Translator;
}

export function UsageSection({ t }: UsageSectionProps) {
  const { toast } = useToast();
  const [data, setData] = React.useState<UsagePayload | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/usage", { cache: "no-store" });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      setData((await r.json()) as UsagePayload);
    } catch (err) {
      toast({
        title: t("Caricamento utilizzo non riuscito", "Usage load failed", "Échec du chargement", "Error al cargar", "Laden fehlgeschlagen"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!data) {
    return <div className="text-sm text-muted-foreground">{loading ? t("Caricamento...", "Loading...", "Chargement...", "Cargando...", "Lade...") : null}</div>;
  }

  const cards: Array<{ label: string; value: string | number }> = [
    { label: t("Job totali", "Total jobs", "Jobs totaux", "Jobs totales", "Jobs gesamt"), value: data.jobs.total },
    { label: t("Completati", "Completed", "Terminés", "Completados", "Abgeschlossen"), value: data.jobs.completed },
    { label: t("Falliti", "Failed", "Échoués", "Fallidos", "Fehlgeschlagen"), value: data.jobs.failed },
    { label: t("In corso", "Running", "En cours", "En curso", "Läuft"), value: data.jobs.running },
    { label: t("Tempo OCR totale", "Total OCR time", "Temps OCR total", "Tiempo OCR total", "OCR-Zeit gesamt"), value: formatDuration(data.aggregate.totalProcessingMs) },
    { label: t("Chiavi API", "API keys", "Clés API", "Claves API", "API-Schlüssel"), value: data.resources.apiKeys },
    { label: t("Webhook", "Webhooks", "Webhooks", "Webhooks", "Webhooks"), value: data.resources.webhooks },
    { label: t("Template", "Templates", "Modèles", "Plantillas", "Vorlagen"), value: data.resources.jobTemplates },
    { label: t("Watcher S3", "S3 watchers", "Watchers S3", "Watchers S3", "S3-Watcher"), value: data.resources.watchedS3Sources },
    { label: t("Sottoscrizioni push", "Push subscriptions", "Abonnements push", "Suscripciones push", "Push-Abos"), value: data.resources.pushSubscriptions },
  ];

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h3 className="font-display text-lg font-semibold tracking-tight">
          {t("Utilizzo", "Usage", "Utilisation", "Uso", "Nutzung")}
        </h3>
        <p className="text-xs text-muted-foreground/80">
          {t(
            "Conteggi correnti per il tuo account.",
            "Current counts for your account.",
            "Compteurs actuels pour votre compte.",
            "Recuentos actuales para tu cuenta.",
            "Aktuelle Zahlen für dein Konto.",
          )}
        </p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {cards.map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-card p-3 shadow-[var(--shadow-soft)]">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-xl font-semibold tabular tracking-tight">{value}</div>
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
        {t("Ricarica", "Reload", "Recharger", "Recargar", "Neu laden")}
      </Button>
    </section>
  );
}
