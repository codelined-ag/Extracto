"use client";

import * as React from "react";
import { Code } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { DeleteIcon } from "@/components/ui/delete";
import { DownloadIcon } from "@/components/ui/download";
import { FileTextIcon } from "@/components/ui/file-text";
import { HistoryIcon } from "@/components/ui/history";
import { LoaderCircleIcon } from "@/components/ui/loader-circle";
import { SearchIcon } from "@/components/ui/search";

import { formatTimestamp } from "@/app/page-components/page-utils";
import type {
  HistoryJobDetail,
  HistoryJobSummary,
  Translator,
} from "@/app/page-components/types";

type HistoryFilter = "all" | "completed" | "failed" | "running";

export interface HistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: Translator;
  jobs: HistoryJobSummary[];
  isLoadingJobs: boolean;
  selectedJobId: string | null;
  onSelectJobId: (id: string | null) => void;
  selectedJobDetail: HistoryJobDetail | null;
  isLoadingDetail: boolean;
  selectedMarkdown: string;
  selectedStructuredJson: unknown;
  isDeleting: boolean;
  onDelete: () => void;
  onDownload: (format: "md" | "json") => void;
}

export function HistoryDialog({
  open,
  onOpenChange,
  t,
  jobs,
  isLoadingJobs,
  selectedJobId,
  onSelectJobId,
  selectedJobDetail,
  isLoadingDetail,
  selectedMarkdown,
  selectedStructuredJson,
  isDeleting,
  onDelete,
  onDownload,
}: HistoryDialogProps) {
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<HistoryFilter>("all");

  const counts = {
    all: jobs.length,
    completed: jobs.filter((j) => j.status === "COMPLETED").length,
    failed: jobs.filter((j) => j.status === "FAILED").length,
    running: jobs.filter((j) => j.status === "PROCESSING" || j.status === "QUEUED").length,
  };

  const term = search.trim().toLowerCase();
  const filtered = jobs.filter((j) => {
    const matchesText =
      !term || j.fileName.toLowerCase().includes(term) || (j.model || "").toLowerCase().includes(term);
    const matchesFilter =
      filter === "all" ||
      (filter === "completed" && j.status === "COMPLETED") ||
      (filter === "failed" && j.status === "FAILED") ||
      (filter === "running" && (j.status === "PROCESSING" || j.status === "QUEUED"));
    return matchesText && matchesFilter;
  });

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setSearch("");
      setFilter("all");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[96vw] !max-w-6xl h-[92vh] flex flex-col overflow-hidden p-0">
        <header className="px-7 pt-7 pb-5 space-y-4">
          <div className="space-y-1">
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              {t("Cronologia", "History", "Historique", "Historial", "Verlauf")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {counts.all === 0
                ? t(
                    "Nessuna estrazione ancora.",
                    "No extractions yet.",
                    "Aucune extraction pour l'instant.",
                    "Aún no hay extracciones.",
                    "Noch keine Extraktionen.",
                  )
                : t(
                    `${counts.all} esecuzioni · ${counts.completed} completate · ${counts.failed} fallite`,
                    `${counts.all} runs · ${counts.completed} completed · ${counts.failed} failed`,
                    `${counts.all} exécutions · ${counts.completed} terminées · ${counts.failed} échouées`,
                    `${counts.all} ejecuciones · ${counts.completed} completadas · ${counts.failed} fallidas`,
                    `${counts.all} Läufe · ${counts.completed} abgeschlossen · ${counts.failed} fehlgeschlagen`,
                  )}
            </p>
          </div>
          {counts.all > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[14rem]">
                <SearchIcon
                  size={14}
                  className="inline-flex items-center justify-center absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t(
                    "Cerca per nome o modello",
                    "Search by file or model",
                    "Rechercher par fichier ou modèle",
                    "Buscar por archivo o modelo",
                    "Suche nach Datei oder Modell",
                  )}
                  className="pl-9"
                />
              </div>
              <div className="surface-soft rounded-xl p-1 flex items-center gap-0.5">
                {(
                  [
                    ["all", t("Tutto", "All", "Tout", "Todo", "Alle")],
                    ["completed", t("Completate", "Completed", "Terminées", "Completadas", "Abgeschlossen")],
                    ["failed", t("Fallite", "Failed", "Échouées", "Fallidas", "Fehlgeschlagen")],
                    ["running", t("In corso", "Running", "En cours", "En curso", "Läuft")],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={cn(
                      "px-3 py-1 rounded-lg text-xs font-medium transition-colors",
                      filter === key
                        ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                        : "text-muted-foreground/80 hover:text-foreground",
                    )}
                  >
                    {label}
                    <span className="ml-1.5 text-[10px] tabular text-muted-foreground/70">
                      {counts[key]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] flex-1 min-h-0 min-w-0 overflow-hidden hairline-t">
          <aside className="min-h-0 min-w-0 lg:hairline-b-0 surface-soft/50 border-r border-transparent">
            <ScrollArea className="h-full">
              {isLoadingJobs ? (
                <div className="h-32 flex items-center justify-center">
                  <LoaderCircleIcon
                    size={18}
                    className="inline-flex items-center justify-center text-muted-foreground"
                  />
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                  {counts.all === 0
                    ? t(
                        "Nessuna esecuzione salvata",
                        "Nothing saved yet",
                        "Rien enregistré",
                        "Nada guardado",
                        "Noch nichts",
                      )
                    : t("Nessun risultato", "No matches", "Aucun résultat", "Sin resultados", "Keine Treffer")}
                </div>
              ) : (
                <div className="px-3 py-3 space-y-1">
                  {filtered.map((job) => {
                    const active = selectedJobId === job.id;
                    const statusTone =
                      job.status === "FAILED"
                        ? "text-destructive"
                        : job.status === "COMPLETED"
                          ? "text-[oklch(0.55_0.13_150)]"
                          : "text-accent-foreground";
                    const statusLabel =
                      job.status === "FAILED"
                        ? t("fallito", "failed", "échoué", "fallido", "fehlgeschlagen")
                        : job.status === "COMPLETED"
                          ? t("completato", "completed", "terminé", "completado", "abgeschlossen")
                          : t("in corso", "running", "en cours", "en curso", "läuft");
                    return (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => onSelectJobId(job.id)}
                        className={cn(
                          "group relative w-full text-left rounded-xl px-3 py-3 transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
                          active
                            ? "bg-card shadow-[var(--shadow-soft)]"
                            : "hover:bg-card/60 hover:translate-x-0.5",
                        )}
                      >
                        {active ? (
                          <span className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-primary" />
                        ) : null}
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={cn(
                              "text-sm font-medium truncate",
                              active ? "text-foreground" : "text-foreground/85",
                            )}
                          >
                            {job.fileName}
                          </p>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px]">
                          <span className={cn("inline-flex items-center gap-1 font-medium", statusTone)}>
                            <span className="status-dot" />
                            {statusLabel}
                          </span>
                          <span className="text-muted-foreground/50">·</span>
                          <span className="font-mono text-[10px] text-muted-foreground/80 truncate">
                            {job.model}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground/70 tabular">
                          {formatTimestamp(job.createdAt)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </aside>

          <section className="min-h-0 min-w-0 flex flex-col overflow-hidden">
            {isLoadingDetail ? (
              <div className="flex-1 flex items-center justify-center">
                <LoaderCircleIcon
                  size={22}
                  className="inline-flex items-center justify-center text-muted-foreground"
                />
              </div>
            ) : !selectedJobDetail ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                <div className="grid place-items-center mb-4 text-muted-foreground">
                  <HistoryIcon size={32} className="inline-flex items-center justify-center" />
                </div>
                <p className="font-display text-xl font-semibold tracking-tight">
                  {t(
                    "Seleziona un'esecuzione",
                    "Pick a run",
                    "Choisissez une exécution",
                    "Selecciona una ejecución",
                    "Lauf auswählen",
                  )}
                </p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  {t(
                    "Apri qualsiasi voce a sinistra per vedere il risultato e scaricarlo.",
                    "Open any item on the left to see its output and download it.",
                    "Ouvrez un élément à gauche pour voir sa sortie et la télécharger.",
                    "Abre cualquier elemento de la izquierda para ver su salida y descargarla.",
                    "Wähle links einen Eintrag, um Ausgabe und Download zu sehen.",
                  )}
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 min-w-0">
                <div className="px-7 pt-6 pb-4 space-y-3">
                  <div className="space-y-1">
                    <h3 className="font-display text-2xl font-semibold tracking-tight truncate">
                      {selectedJobDetail.fileName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-medium",
                          selectedJobDetail.status === "FAILED"
                            ? "bg-destructive/15 text-destructive"
                            : selectedJobDetail.status === "COMPLETED"
                              ? "bg-[oklch(0.55_0.13_150)]/15 text-[oklch(0.55_0.13_150)]"
                              : "bg-accent text-accent-foreground",
                        )}
                      >
                        <span className="status-dot" />
                        {selectedJobDetail.status === "FAILED"
                          ? t("fallito", "failed", "échoué", "fallido", "fehlgeschlagen")
                          : selectedJobDetail.status === "COMPLETED"
                            ? t("completato", "completed", "terminé", "completado", "abgeschlossen")
                            : t("in corso", "running", "en cours", "en curso", "läuft")}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {selectedJobDetail.model}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground tabular">
                        {formatTimestamp(selectedJobDetail.createdAt)}
                      </span>
                      {selectedJobDetail.processingMs ? (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground tabular">
                            {(selectedJobDetail.processingMs / 1000).toFixed(1)}s
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {selectedJobDetail.sourcePreview ? (
                    <div className="surface-soft rounded-2xl p-3">
                      <img
                        src={selectedJobDetail.sourcePreview}
                        alt={selectedJobDetail.fileName}
                        className="max-h-[180px] mx-auto object-contain rounded-xl"
                      />
                    </div>
                  ) : null}
                </div>

                <Tabs
                  defaultValue="markdown"
                  className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden gap-0"
                >
                  <div className="px-7 pb-2">
                    <TabsList>
                      <TabsTrigger value="markdown" className="gap-1.5">
                        <FileTextIcon size={14} className="inline-flex items-center justify-center" />
                        Markdown
                      </TabsTrigger>
                      <TabsTrigger value="markdown-raw" className="gap-1.5">
                        <FileTextIcon size={14} className="inline-flex items-center justify-center" />
                        {t("Grezzo", "Raw", "Brut", "Sin procesar", "Roh")}
                      </TabsTrigger>
                      <TabsTrigger value="json" className="gap-1.5">
                        <Code className="size-3.5" />
                        JSON
                      </TabsTrigger>
                    </TabsList>
                  </div>
                  <div className="flex-1 min-h-0 min-w-0">
                    <TabsContent value="markdown" className="h-full m-0">
                      <ScrollArea className="h-full">
                        <div className="prose prose-sm dark:prose-invert max-w-none px-7 py-4 break-words [overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:break-words">
                          <ReactMarkdown>{selectedMarkdown}</ReactMarkdown>
                        </div>
                      </ScrollArea>
                    </TabsContent>
                    <TabsContent value="markdown-raw" className="h-full m-0">
                      <ScrollArea className="h-full">
                        <pre className="px-7 py-4 text-xs font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-foreground/90">
                          {selectedMarkdown}
                        </pre>
                      </ScrollArea>
                    </TabsContent>
                    <TabsContent value="json" className="h-full m-0">
                      <ScrollArea className="h-full">
                        <pre className="px-7 py-4 text-xs font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-foreground/90">
                          {JSON.stringify(selectedStructuredJson, null, 2)}
                        </pre>
                      </ScrollArea>
                    </TabsContent>
                  </div>
                </Tabs>
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="px-7 py-4 hairline-t flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {selectedJobDetail ? (
              <span className="font-mono truncate max-w-[20rem]">{selectedJobDetail.id}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {selectedJobDetail ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <DownloadIcon
                      size={14}
                      className="inline-flex items-center justify-center mr-1.5"
                    />
                    {t("Scarica", "Download", "Télécharger", "Descargar", "Herunterladen")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onDownload("md")}>
                    <DownloadIcon size={16} className="inline-flex" />
                    <span>Markdown</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onDownload("json")}>
                    <DownloadIcon size={16} className="inline-flex" />
                    <span>JSON</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={!selectedJobId || isDeleting}
            >
              {isDeleting ? (
                <LoaderCircleIcon
                  size={14}
                  className="inline-flex items-center justify-center mr-1.5"
                />
              ) : (
                <DeleteIcon size={14} className="inline-flex items-center justify-center mr-1.5" />
              )}
              {t("Elimina", "Delete", "Supprimer", "Eliminar", "Löschen")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
