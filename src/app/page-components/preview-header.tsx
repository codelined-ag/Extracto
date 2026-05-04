"use client";

import { Columns, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { CheckIcon } from "@/components/ui/check";
import { CircleCheckIcon } from "@/components/ui/circle-check";
import { CopyIcon } from "@/components/ui/copy";
import { DatabaseBackupIcon } from "@/components/ui/database-backup";
import { DownloadIcon } from "@/components/ui/download";
import { EyeIcon } from "@/components/ui/eye";
import { FileTextIcon } from "@/components/ui/file-text";
import { LoaderCircleIcon } from "@/components/ui/loader-circle";
import { PauseIcon } from "@/components/ui/pause";

import type {
  ProcessingFile,
  ResultFormat,
  ResultViewMode,
  Translator,
} from "@/app/page-components/types";

export interface PreviewHeaderProps {
  selectedFile: ProcessingFile;
  viewMode: ResultViewMode;
  onViewModeChange: (mode: ResultViewMode) => void;
  copied: ResultFormat | null;
  onCopy: (format: ResultFormat) => void;
  onDownload: (format: ResultFormat) => void;
  onExportToKb: (file: ProcessingFile) => void;
  t: Translator;
}

export function PreviewHeader({
  selectedFile,
  viewMode,
  onViewModeChange,
  copied,
  onCopy,
  onDownload,
  onExportToKb,
  t,
}: PreviewHeaderProps) {
  const viewModes: Array<{
    mode: ResultViewMode;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      mode: "preview",
      label: t("Anteprima", "Preview", "Aperçu", "Vista previa", "Vorschau"),
      icon: <EyeIcon size={14} className="inline-flex items-center justify-center" />,
    },
    {
      mode: "split",
      label: t("Doppia colonna", "Split view", "Vue partagée", "Vista dividida", "Geteilte Ansicht"),
      icon: <Columns className="h-3.5 w-3.5" />,
    },
    {
      mode: "result",
      label: t("Risultato", "Result only", "Résultat", "Resultado", "Ergebnis"),
      icon: <FileTextIcon size={14} className="inline-flex items-center justify-center" />,
    },
  ];

  return (
    <div className="flex items-center justify-between p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium truncate max-w-[180px]">{selectedFile.name}</span>
        {selectedFile.status === "completed" && (
          <Badge variant="outline" className="text-xs">
            <CircleCheckIcon
              size={12}
              className="inline-flex items-center justify-center mr-1 text-[oklch(0.55_0.13_150)]"
            />
            {t("Completato", "Completed", "Terminé", "Completado", "Abgeschlossen")}
          </Badge>
        )}
        {selectedFile.status === "paused" && (
          <Badge variant="outline" className="text-xs">
            <PauseIcon
              size={12}
              className="inline-flex items-center justify-center mr-1 text-accent-foreground"
            />
            {t("In pausa", "Paused", "En pause", "En pausa", "Pausiert")}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1">
        {selectedFile.result && (
          <>
            <div className="surface-soft rounded-xl p-0.5 flex items-center gap-0.5">
              {viewModes.map(({ mode, label, icon }) => (
                <Tooltip key={mode}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onViewModeChange(mode)}
                      className={cn(
                        "inline-flex items-center justify-center size-7 rounded-lg transition-colors",
                        viewMode === mode
                          ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                          : "text-muted-foreground/80 hover:text-foreground",
                      )}
                    >
                      {icon}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{label}</TooltipContent>
                </Tooltip>
              ))}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1 group">
                  <span className="text-xs">
                    {t("Azioni", "Actions", "Actions", "Acciones", "Aktionen")}
                  </span>
                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/80 transition-transform duration-200 group-hover:scale-110" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[14rem]">
                <DropdownMenuLabel>
                  {t("Copia", "Copy", "Copier", "Copiar", "Kopieren")}
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onCopy("md")}>
                  {copied === "md" ? (
                    <CheckIcon size={16} className="inline-flex text-primary" />
                  ) : (
                    <CopyIcon size={16} className="inline-flex" />
                  )}
                  <span>
                    {t("Copia Markdown", "Copy Markdown", "Copier Markdown", "Copiar Markdown", "Markdown kopieren")}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCopy("json")}>
                  {copied === "json" ? (
                    <CheckIcon size={16} className="inline-flex text-primary" />
                  ) : (
                    <CopyIcon size={16} className="inline-flex" />
                  )}
                  <span>
                    {t("Copia JSON", "Copy JSON", "Copier JSON", "Copiar JSON", "JSON kopieren")}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  {t("Scarica", "Download", "Télécharger", "Descargar", "Herunterladen")}
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onDownload("md")}>
                  <DownloadIcon size={16} className="inline-flex" />
                  <span>
                    {t(
                      "Scarica Markdown",
                      "Download Markdown",
                      "Télécharger Markdown",
                      "Descargar Markdown",
                      "Markdown herunterladen",
                    )}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onDownload("json")}>
                  <DownloadIcon size={16} className="inline-flex" />
                  <span>
                    {t(
                      "Scarica JSON",
                      "Download JSON",
                      "Télécharger JSON",
                      "Descargar JSON",
                      "JSON herunterladen",
                    )}
                  </span>
                </DropdownMenuItem>
                {selectedFile.status === "completed" && selectedFile.jobId ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => onExportToKb(selectedFile)}
                      disabled={selectedFile.kbExport?.status === "pending"}
                    >
                      {selectedFile.kbExport?.status === "pending" ? (
                        <LoaderCircleIcon size={16} className="inline-flex animate-spin text-primary" />
                      ) : selectedFile.kbExport?.status === "success" ? (
                        <DatabaseBackupIcon size={16} className="inline-flex text-primary" />
                      ) : (
                        <DatabaseBackupIcon size={16} className="inline-flex" />
                      )}
                      <span>
                        {selectedFile.kbExport?.status === "pending"
                          ? (() => {
                              const k = selectedFile.kbExport;
                              if (k?.phase === "embedding" && (k.embeddingTotal ?? 0) > 0) {
                                const d = k.embeddingDone ?? 0;
                                const tot = k.embeddingTotal ?? 0;
                                return t(
                                  `Incorporamento ${d}/${tot}`,
                                  `Embedding ${d}/${tot}`,
                                  `Vectorisation ${d}/${tot}`,
                                  `Generando ${d}/${tot}`,
                                  `Einbettung ${d}/${tot}`,
                                );
                              }
                              if (k?.phase === "upserting") {
                                return t("Caricamento nel vector store...", "Upserting to vector store...", "Téléversement vers le vector store...", "Subiendo al vector store...", "In Vektor-Store laden...");
                              }
                              return t("In coda...", "Queued...", "En attente...", "En cola...", "In der Warteschlange...");
                            })()
                          : selectedFile.kbExport?.status === "success"
                          ? t(
                              "Riesporta verso KB",
                              "Re-export to KB",
                              "Réexporter vers KB",
                              "Reexportar a KB",
                              "Erneut in KB exportieren",
                            )
                          : t(
                              "Invia al vector store",
                              "Send to vector store",
                              "Envoyer au vector store",
                              "Enviar al vector store",
                              "An Vektor-Store senden",
                            )}
                      </span>
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  );
}
