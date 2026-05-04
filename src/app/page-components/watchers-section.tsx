"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

interface Watcher {
  id: string;
  name: string;
  prefix: string;
  intervalSeconds: number;
  active: boolean;
  model: string;
  autoKbExport: boolean;
  autoS3Export: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
}

const EMPTY = {
  name: "",
  prefix: "",
  intervalSeconds: 60,
  active: true,
  model: "",
  autoKbExport: false,
  autoS3Export: false,
};

export interface WatchersSectionProps {
  t: Translator;
}

export function WatchersSection({ t }: WatchersSectionProps) {
  const { toast } = useToast();
  const [watchers, setWatchers] = React.useState<Watcher[]>([]);
  const [draft, setDraft] = React.useState(EMPTY);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch("/api/s3/watchers", { cache: "no-store" });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      const data = (await r.json()) as { watchers: Watcher[] };
      setWatchers(data.watchers ?? []);
    } catch (err) {
      toast({
        title: t("Caricamento watcher non riuscito", "Watcher load failed", "Échec", "Error", "Fehler"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [t, toast]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const create = async () => {
    if (!draft.name.trim() || !draft.model.trim()) {
      toast({
        title: t("Nome e modello richiesti", "Name and model required", "Nom et modèle requis", "Nombre y modelo requeridos", "Name und Modell erforderlich"),
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/s3/watchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Save failed (${r.status})`);
      }
      setDraft(EMPTY);
      await load();
      toast({ title: t("Watcher salvato", "Watcher saved", "Watcher enregistré", "Watcher guardado", "Watcher gespeichert") });
    } catch (err) {
      toast({
        title: t("Salvataggio non riuscito", "Save failed", "Échec", "Error", "Fehler"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const r = await fetch(`/api/s3/watchers/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`Delete failed (${r.status})`);
      await load();
    } catch (err) {
      toast({
        title: t("Eliminazione non riuscita", "Delete failed", "Échec", "Error", "Fehler"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h3 className="font-display text-lg font-semibold tracking-tight">
          {t("Watcher S3", "S3 watchers", "Watchers S3", "Watchers S3", "S3-Watcher")}
        </h3>
        <p className="text-xs text-muted-foreground/80">
          {t(
            "Sondaggi periodici di un prefisso S3 per ingerire automaticamente nuovi documenti.",
            "Periodically poll an S3 prefix and auto-ingest new documents.",
            "Sonde un préfixe S3 et ingère les nouveaux documents.",
            "Sondea un prefijo de S3 e ingiere documentos nuevos.",
            "Pollt ein S3-Präfix und nimmt neue Dokumente auf.",
          )}
        </p>
      </header>

      <div className="rounded-xl bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Nome", "Name", "Nom", "Nombre", "Name")}</Label>
            <Input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} placeholder="invoices-monthly" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Prefisso S3 (opzionale)", "S3 prefix (optional)", "Préfixe S3", "Prefijo S3", "S3-Präfix")}</Label>
            <Input value={draft.prefix} onChange={(e) => setDraft((p) => ({ ...p, prefix: e.target.value }))} placeholder="invoices/2026" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Modello OCR", "OCR model", "Modèle OCR", "Modelo OCR", "OCR-Modell")}</Label>
            <Input value={draft.model} onChange={(e) => setDraft((p) => ({ ...p, model: e.target.value }))} placeholder="mistral-ocr-latest" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Intervallo (s)", "Interval (s)", "Intervalle (s)", "Intervalo (s)", "Intervall (s)")}</Label>
            <Input type="number" min={30} max={86400} value={draft.intervalSeconds} onChange={(e) => setDraft((p) => ({ ...p, intervalSeconds: Number(e.target.value) || 60 }))} />
          </div>
        </div>
        <Button onClick={create} disabled={busy}>{t("Aggiungi watcher", "Add watcher", "Ajouter", "Añadir", "Hinzufügen")}</Button>
      </div>

      <ul className="space-y-2">
        {watchers.map((w) => (
          <li key={w.id} className="rounded-xl bg-card p-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{w.name}</span>
                <Switch checked={w.active} disabled />
              </div>
              <div className="text-xs text-muted-foreground mt-1 truncate">
                {w.prefix || "(no prefix)"} · {w.model} · {w.intervalSeconds}s
              </div>
              {w.lastError ? <div className="text-[11px] text-destructive mt-1 truncate">{w.lastError}</div> : null}
              {w.lastPolledAt ? (
                <div className="text-[11px] text-muted-foreground/70 mt-0.5">
                  {t("Ultimo poll", "Last polled", "Dernier sondage", "Último sondeo", "Zuletzt gepollt")}: {new Date(w.lastPolledAt).toLocaleString()}
                </div>
              ) : null}
            </div>
            <Button variant="ghost" size="icon" onClick={() => void remove(w.id)} aria-label={t("Elimina", "Delete", "Supprimer", "Eliminar", "Löschen")}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </li>
        ))}
        {watchers.length === 0 ? (
          <li className="text-sm text-muted-foreground">{t("Nessun watcher configurato.", "No watchers configured.", "Aucun watcher.", "Sin watchers.", "Keine Watcher.")}</li>
        ) : null}
      </ul>
    </section>
  );
}
