"use client";

import * as React from "react";
import { Check, History as HistoryIconSmall, Pencil, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

export interface PageEditorPage {
  pageNumber: number;
  text: string;
}

export interface PageEditEntryView {
  text: string;
  editedAt: string;
  characterCount: number;
}

export interface PageEditorProps {
  t: Translator;
  jobId: string;
  pages: PageEditorPage[];
  onSaved: () => Promise<void> | void;
  jumpToPage?: number | null;
  onJumpHandled?: () => void;
}

export function PageEditor({ t, jobId, pages, onSaved, jumpToPage, onJumpHandled }: PageEditorProps) {
  const { toast } = useToast();
  const [openHistoryFor, setOpenHistoryFor] = React.useState<number | null>(null);
  const [flashFor, setFlashFor] = React.useState<number | null>(null);
  const tileRefs = React.useRef<Map<number, HTMLDivElement | null>>(new Map());

  React.useEffect(() => {
    if (jumpToPage == null) return;
    const el = tileRefs.current.get(jumpToPage);
    if (!el) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    setFlashFor(jumpToPage);
    onJumpHandled?.();
    const id = window.setTimeout(() => setFlashFor(null), 1800);
    return () => window.clearTimeout(id);
  }, [jumpToPage, onJumpHandled]);
  const [historyByPage, setHistoryByPage] = React.useState<Record<number, PageEditEntryView[]>>({});
  const [editingFor, setEditingFor] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);

  const startEditing = (page: PageEditorPage) => {
    setEditingFor(page.pageNumber);
    setDraft(page.text);
    setOpenHistoryFor(null);
  };

  const cancelEditing = () => {
    setEditingFor(null);
    setDraft("");
  };

  const save = async (pageNumber: number) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/pages/${pageNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      setEditingFor(null);
      setDraft("");
      setHistoryByPage((prev) => {
        if (!(pageNumber in prev)) return prev;
        const next = { ...prev };
        delete next[pageNumber];
        return next;
      });
      await onSaved();
      toast({
        title: t("Pagina aggiornata", "Page saved", "Page enregistrée", "Página guardada", "Seite gespeichert"),
      });
    } catch (error) {
      toast({
        title: t("Salvataggio non riuscito", "Save failed", "Échec de l'enregistrement", "Error al guardar", "Speichern fehlgeschlagen"),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const toggleHistory = async (pageNumber: number) => {
    if (openHistoryFor === pageNumber) {
      setOpenHistoryFor(null);
      return;
    }
    setOpenHistoryFor(pageNumber);
    if (!historyByPage[pageNumber]) {
      try {
        const res = await fetch(`/api/jobs/${jobId}/pages/${pageNumber}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const payload = (await res.json()) as { history?: PageEditEntryView[] };
        setHistoryByPage((prev) => ({ ...prev, [pageNumber]: payload.history ?? [] }));
      } catch (error) {
        toast({
          title: t("Cronologia non caricata", "History load failed", "Échec du chargement", "Error al cargar historial", "Verlauf-Laden fehlgeschlagen"),
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      }
    }
  };

  if (pages.length === 0) {
    return (
      <div className="px-7 py-8 text-center text-sm text-muted-foreground">
        {t("Nessuna pagina disponibile", "No pages available", "Aucune page disponible", "Sin páginas disponibles", "Keine Seiten verfügbar")}
      </div>
    );
  }

  return (
    <div className="px-7 py-4 space-y-4">
      {pages.map((page) => {
        const isEditing = editingFor === page.pageNumber;
        const isHistoryOpen = openHistoryFor === page.pageNumber;
        const history = historyByPage[page.pageNumber] ?? [];
        const isFlashing = flashFor === page.pageNumber;
        return (
          <div
            key={page.pageNumber}
            ref={(node) => {
              tileRefs.current.set(page.pageNumber, node);
            }}
            className={cn(
              "surface-soft rounded-xl p-3 space-y-2 transition-shadow duration-700",
              isFlashing ? "ring-2 ring-primary shadow-[var(--shadow-strong)]" : "",
            )}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium tabular text-muted-foreground">
                {t("Pagina", "Page", "Page", "Página", "Seite")} {page.pageNumber}
              </span>
              <div className="flex items-center gap-1">
                {!isEditing ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={() => toggleHistory(page.pageNumber)}
                      aria-pressed={isHistoryOpen}
                    >
                      <HistoryIconSmall className="size-3 mr-1" />
                      {t("Cronologia", "History", "Historique", "Historial", "Verlauf")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={() => startEditing(page)}
                    >
                      <Pencil className="size-3 mr-1" />
                      {t("Modifica", "Edit", "Modifier", "Editar", "Bearbeiten")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={cancelEditing}
                      disabled={busy}
                    >
                      <X className="size-3 mr-1" />
                      {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7"
                      onClick={() => save(page.pageNumber)}
                      disabled={busy || draft === page.text}
                    >
                      <Check className="size-3 mr-1" />
                      {t("Salva", "Save", "Enregistrer", "Guardar", "Speichern")}
                    </Button>
                  </>
                )}
              </div>
            </div>
            {isEditing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(20, Math.max(6, draft.split("\n").length + 1))}
                className={cn(
                  "w-full font-mono text-xs whitespace-pre-wrap rounded-md border border-border bg-background p-3",
                  "focus:outline-none focus:ring-1 focus:ring-primary",
                )}
              />
            ) : (
              <pre className="font-mono text-xs whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-foreground/90 max-h-64 overflow-y-auto">
                {page.text}
              </pre>
            )}
            {isHistoryOpen ? (
              <div className="border-t border-border pt-2 space-y-2">
                {history.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {t("Nessuna modifica precedente", "No prior edits", "Aucune modification précédente", "Sin ediciones previas", "Keine früheren Bearbeitungen")}
                  </p>
                ) : (
                  history.map((entry, idx) => (
                    <div key={`${page.pageNumber}-${idx}`} className="text-[11px]">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="tabular">
                          {new Date(entry.editedAt).toLocaleString()}
                        </span>
                        <span>{entry.characterCount} chars</span>
                      </div>
                      <pre className="mt-1 font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-foreground/70 max-h-32 overflow-y-auto bg-muted/40 rounded p-2">
                        {entry.text}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
