"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

type ProviderKind = "ollama" | "mistral" | "openrouter" | "openai_compat";
type PresetKind = "generic" | "academic" | "invoice" | "contract" | "form";

interface DraftTemplate {
  name: string;
  description: string;
  model: string;
  provider: ProviderKind;
  preset: PresetKind;
  language: string;
  customPrompt: string;
}

const EMPTY: DraftTemplate = {
  name: "",
  description: "",
  model: "",
  provider: "ollama",
  preset: "generic",
  language: "auto",
  customPrompt: "",
};

const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "it", label: "Italiano" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "nl", label: "Nederlands" },
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文" },
  { value: "ar", label: "العربية" },
  { value: "ru", label: "Русский" },
];

export interface TemplatesSectionProps {
  t: Translator;
}

export function TemplatesSection({ t }: TemplatesSectionProps) {
  const { toast } = useToast();
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [draft, setDraft] = React.useState<DraftTemplate>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

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
      setEditingId(null);
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
      if (editingId === id) {
        setEditingId(null);
        setDraft(EMPTY);
      }
      await load();
    } catch (err) {
      toast({
        title: t("Eliminazione non riuscita", "Delete failed", "Échec", "Error", "Fehler"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const editExisting = (tpl: Template) => {
    setEditingId(tpl.id);
    setDraft({
      name: tpl.name,
      description: tpl.description ?? "",
      model: tpl.model,
      provider: (tpl.provider as ProviderKind) ?? "ollama",
      preset: (tpl.preset as PresetKind) ?? "generic",
      language: tpl.language || "auto",
      customPrompt: tpl.customPrompt ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(EMPTY);
  };

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h3 className="font-display text-lg font-semibold tracking-tight">
          {t("Template di job", "Job templates", "Modèles de job", "Plantillas de job", "Job-Vorlagen")}
        </h3>
        <p className="text-xs text-muted-foreground/80">
          {t(
            "Salva combinazioni di provider, modello e preset per riutilizzarle in un click.",
            "Save provider, model, and preset combinations to reuse in one click.",
            "Enregistre des combinaisons fournisseur, modèle et preset pour les réutiliser.",
            "Guarda combinaciones de proveedor, modelo y preset para reutilizar.",
            "Speichere Anbieter-, Modell- und Preset-Kombinationen zur Wiederverwendung.",
          )}
        </p>
      </header>

      <div className="rounded-2xl bg-card p-5 space-y-4 shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">
            {editingId
              ? t("Modifica template", "Edit template", "Modifier le modèle", "Editar plantilla", "Vorlage bearbeiten")
              : t("Nuovo template", "New template", "Nouveau modèle", "Nueva plantilla", "Neue Vorlage")}
          </h4>
          {editingId ? (
            <Button variant="ghost" size="sm" onClick={cancelEdit}>
              {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
              {t("Nome", "Name", "Nom", "Nombre", "Name")}
            </Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              placeholder={t("Mistral OCR per fatture", "Mistral OCR for invoices", "Mistral OCR pour factures", "Mistral OCR para facturas", "Mistral OCR für Rechnungen")}
              maxLength={80}
              disabled={editingId !== null}
              title={editingId !== null ? t("Il rinomina non è supportato. Elimina e ricrea per cambiare il nome.", "Rename is not supported. Delete and recreate to change the name.", "Le renommage n'est pas supporté. Supprimer et recréer pour changer le nom.", "El renombrado no está soportado. Elimina y recrea para cambiar el nombre.", "Umbenennen wird nicht unterstützt. Löschen und neu erstellen, um den Namen zu ändern.") : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
              {t("Modello", "Model", "Modèle", "Modelo", "Modell")}
            </Label>
            <Input
              value={draft.model}
              onChange={(e) => setDraft((p) => ({ ...p, model: e.target.value }))}
              placeholder="mistral-ocr-latest"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
              {t("Provider", "Provider", "Fournisseur", "Proveedor", "Anbieter")}
            </Label>
            <Select value={draft.provider} onValueChange={(v) => setDraft((p) => ({ ...p, provider: v as ProviderKind }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ollama">Ollama</SelectItem>
                <SelectItem value="mistral">Mistral</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem value="openai_compat">OpenAI-compatible</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
              {t("Preset", "Preset", "Preset", "Preset", "Preset")}
            </Label>
            <Select value={draft.preset} onValueChange={(v) => setDraft((p) => ({ ...p, preset: v as PresetKind }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="generic">{t("Generico", "Generic", "Générique", "Genérico", "Allgemein")}</SelectItem>
                <SelectItem value="academic">{t("Accademico", "Academic", "Académique", "Académico", "Akademisch")}</SelectItem>
                <SelectItem value="invoice">{t("Fattura", "Invoice", "Facture", "Factura", "Rechnung")}</SelectItem>
                <SelectItem value="contract">{t("Contratto", "Contract", "Contrat", "Contrato", "Vertrag")}</SelectItem>
                <SelectItem value="form">{t("Modulo", "Form", "Formulaire", "Formulario", "Formular")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
              {t("Lingua", "Language", "Langue", "Idioma", "Sprache")}
            </Label>
            <Select value={draft.language} onValueChange={(v) => setDraft((p) => ({ ...p, language: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
                {LANGUAGE_OPTIONS.every((opt) => opt.value !== draft.language) && draft.language ? (
                  <SelectItem value={draft.language}>{draft.language}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
            {t("Descrizione", "Description", "Description", "Descripción", "Beschreibung")}
            <span className="text-muted-foreground/60 normal-case"> ({t("opzionale", "optional", "facultatif", "opcional", "optional")})</span>
          </Label>
          <Input
            value={draft.description}
            onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
            placeholder={t("Quando usare questo template", "When to use this template", "Quand utiliser ce modèle", "Cuándo usar esta plantilla", "Wann diese Vorlage verwenden")}
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
            {t("Prompt personalizzato", "Custom prompt", "Prompt personnalisé", "Prompt personalizado", "Benutzerdefinierter Prompt")}
            <span className="text-muted-foreground/60 normal-case"> ({t("opzionale", "optional", "facultatif", "opcional", "optional")})</span>
          </Label>
          <Textarea
            value={draft.customPrompt}
            onChange={(e) => setDraft((p) => ({ ...p, customPrompt: e.target.value }))}
            placeholder={t(
              "Estendi le istruzioni inviate al modello per ogni pagina.",
              "Extra instructions appended to the per-page prompt.",
              "Instructions supplémentaires ajoutées au prompt par page.",
              "Instrucciones extra añadidas al prompt por página.",
              "Zusatzanweisungen zum Per-Seite-Prompt.",
            )}
            rows={3}
            maxLength={4000}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button onClick={save} disabled={busy}>
            {editingId
              ? t("Aggiorna", "Update", "Mettre à jour", "Actualizar", "Aktualisieren")
              : t("Salva template", "Save template", "Enregistrer", "Guardar", "Speichern")}
          </Button>
        </div>
      </div>

      <ul className="space-y-2">
        {templates.map((tpl) => {
          const isEditing = editingId === tpl.id;
          return (
            <li
              key={tpl.id}
              className={`rounded-2xl bg-card p-4 flex items-start justify-between gap-3 transition-colors ${isEditing ? "ring-1 ring-primary/40" : "hover:bg-card/80"}`}
            >
              <button
                type="button"
                onClick={() => editExisting(tpl)}
                className="text-left min-w-0 flex-1"
              >
                <div className="font-medium truncate">{tpl.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
                  {tpl.provider} · {tpl.model} · {tpl.preset}
                </div>
                {tpl.description ? (
                  <div className="text-[11px] text-muted-foreground/70 mt-1 line-clamp-2">{tpl.description}</div>
                ) : null}
              </button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void remove(tpl.id)}
                aria-label={t("Elimina", "Delete", "Supprimer", "Eliminar", "Löschen")}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </li>
          );
        })}
        {templates.length === 0 ? (
          <li className="text-sm text-muted-foreground text-center py-6">
            {t("Nessun template salvato.", "No templates saved yet.", "Aucun modèle enregistré.", "Sin plantillas guardadas.", "Noch keine Vorlagen gespeichert.")}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
