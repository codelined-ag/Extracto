"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

interface Template {
  id: string;
  name: string;
  description: string | null;
  model: string;
  provider: string;
  preset: string;
  language: string;
  customPrompt: string;
  updatedAt: string;
}

const EMPTY = {
  name: "",
  description: "",
  model: "",
  provider: "ollama",
  preset: "generic",
  language: "auto",
  customPrompt: "",
};

export interface TemplatesSectionProps {
  t: Translator;
}

export function TemplatesSection({ t }: TemplatesSectionProps) {
  const { toast } = useToast();
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [draft, setDraft] = React.useState(EMPTY);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch("/api/templates", { cache: "no-store" });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      const data = (await r.json()) as { templates: Template[] };
      setTemplates(data.templates ?? []);
    } catch (err) {
      toast({
        title: t("Caricamento template non riuscito", "Templates load failed", "Échec", "Error", "Fehler"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [t, toast]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const save = async () => {
    if (!draft.name.trim() || !draft.model.trim()) {
      toast({
        title: t("Nome e modello richiesti", "Name and model required", "Nom et modèle requis", "Nombre y modelo requeridos", "Name und Modell erforderlich"),
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/templates", {
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
      toast({ title: t("Template salvato", "Template saved", "Modèle enregistré", "Plantilla guardada", "Vorlage gespeichert") });
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
      const r = await fetch(`/api/templates/${id}`, { method: "DELETE" });
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
          {t("Template di job", "Job templates", "Modèles de job", "Plantillas de job", "Job-Vorlagen")}
        </h3>
        <p className="text-xs text-muted-foreground/80">
          {t(
            "Salva combinazioni di provider + modello + preset per riutilizzarle.",
            "Save provider + model + preset combinations for re-use.",
            "Enregistre des combinaisons fournisseur + modèle + preset.",
            "Guarda combinaciones de proveedor + modelo + preset.",
            "Speichere Anbieter + Modell + Preset als Vorlage.",
          )}
        </p>
      </header>

      <div className="rounded-xl bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Nome", "Name", "Nom", "Nombre", "Name")}</Label>
            <Input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Mistral OCR — invoices" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Modello", "Model", "Modèle", "Modelo", "Modell")}</Label>
            <Input value={draft.model} onChange={(e) => setDraft((p) => ({ ...p, model: e.target.value }))} placeholder="mistral-ocr-latest" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Provider", "Provider", "Fournisseur", "Proveedor", "Anbieter")}</Label>
            <Input value={draft.provider} onChange={(e) => setDraft((p) => ({ ...p, provider: e.target.value }))} placeholder="ollama / mistral / openrouter / openai_compat" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Preset", "Preset", "Preset", "Preset", "Preset")}</Label>
            <Input value={draft.preset} onChange={(e) => setDraft((p) => ({ ...p, preset: e.target.value }))} placeholder="generic / academic / invoice / contract / form" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Lingua", "Language", "Langue", "Idioma", "Sprache")}</Label>
            <Input value={draft.language} onChange={(e) => setDraft((p) => ({ ...p, language: e.target.value }))} placeholder="auto / en / it / ..." />
          </div>
        </div>
        <Button onClick={save} disabled={busy}>{t("Salva template", "Save template", "Enregistrer", "Guardar", "Speichern")}</Button>
      </div>

      <ul className="space-y-2">
        {templates.map((tpl) => (
          <li key={tpl.id} className="rounded-xl bg-card p-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{tpl.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">{tpl.provider} · {tpl.model} · {tpl.preset}</div>
              {tpl.description ? <div className="text-[11px] text-muted-foreground/70 mt-1 truncate">{tpl.description}</div> : null}
            </div>
            <Button variant="ghost" size="icon" onClick={() => void remove(tpl.id)} aria-label={t("Elimina", "Delete", "Supprimer", "Eliminar", "Löschen")}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </li>
        ))}
        {templates.length === 0 ? (
          <li className="text-sm text-muted-foreground">{t("Nessun template salvato.", "No templates saved.", "Aucun modèle.", "Sin plantillas.", "Keine Vorlagen.")}</li>
        ) : null}
      </ul>
    </section>
  );
}
