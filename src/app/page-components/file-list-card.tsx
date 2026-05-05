"use client";

import * as React from "react";
import { AnimatePresence } from "motion/react";
import { AlertCircle, LayoutGridIcon, ListIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { CircleCheckIcon } from "@/components/ui/circle-check";
import { DeleteIcon } from "@/components/ui/delete";
import { FileTextIcon } from "@/components/ui/file-text";

import { FileListItem } from "@/app/page-components/file-list-item";
import type {
  ProcessingFile,
  Translator,
  UiLanguage,
} from "@/app/page-components/types";

type QueueView = "list" | "gallery";

export interface FileListCardProps {
  files: ProcessingFile[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  onRemoveFile: (id: string) => void;
  onClearAll: () => void;
  completedCount: number;
  errorCount: number;
  bulkSelectedIds: Set<string>;
  onToggleBulk: (id: string) => void;
  onClearBulk: () => void;
  onBulkRemove: () => void;
  onBulkRun: () => void;
  bulkRunReady: boolean;
  bulkRunPendingCount: number;
  t: Translator;
  uiLanguage: UiLanguage;
  footer?: React.ReactNode;
}

export function FileListCard({
  files,
  selectedFileId,
  onSelectFile,
  onRemoveFile,
  onClearAll,
  completedCount,
  errorCount,
  bulkSelectedIds,
  onToggleBulk,
  onClearBulk,
  onBulkRemove,
  onBulkRun,
  bulkRunReady,
  bulkRunPendingCount,
  t,
  uiLanguage,
  footer,
}: FileListCardProps) {
  const [queueView, setQueueView] = React.useState<QueueView>("list");
  return (
    <Card data-tour="file-queue" className="min-h-[220px] overflow-hidden">
      <CardContent className="p-0 flex flex-col">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <FileTextIcon
              size={16}
              className="inline-flex items-center justify-center text-primary"
            />
            <span className="text-sm font-medium">
              {files.length}{" "}
              {files.length === 1
                ? t("file", "file", "fichier", "archivo", "Datei")
                : t("file", "files", "fichiers", "archivos", "Dateien")}
            </span>
            {completedCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                <CircleCheckIcon size={12} className="inline-flex items-center justify-center mr-1" />
                {t(
                  `${completedCount} completati`,
                  `${completedCount} done`,
                  `${completedCount} terminés`,
                  `${completedCount} listos`,
                  `${completedCount} fertig`,
                )}
              </Badge>
            )}
            {errorCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                <AlertCircle className="h-3 w-3 mr-1" />
                {t(
                  `${errorCount} falliti`,
                  `${errorCount} failed`,
                  `${errorCount} échoués`,
                  `${errorCount} fallidos`,
                  `${errorCount} fehlgeschlagen`,
                )}
              </Badge>
            )}
          </div>
          {files.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="inline-flex rounded-md border border-border/60 bg-secondary/50 p-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setQueueView(queueView === "list" ? "gallery" : "list")}
                      className="inline-flex items-center justify-center rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={
                        queueView === "list"
                          ? t("Passa alla galleria", "Switch to gallery", "Passer en galerie", "Cambiar a galería", "Zur Galerie wechseln")
                          : t("Passa alla lista", "Switch to list", "Passer en liste", "Cambiar a lista", "Zur Liste wechseln")
                      }
                    >
                      {queueView === "list" ? <LayoutGridIcon size={13} /> : <ListIcon size={13} />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {queueView === "list"
                      ? t("Galleria", "Gallery", "Galerie", "Galería", "Galerie")
                      : t("Lista", "List", "Liste", "Lista", "Liste")}
                  </TooltipContent>
                </Tooltip>
              </div>
              {bulkSelectedIds.size === 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={onClearAll}
                  aria-label={t("Svuota la coda", "Clear queue", "Vider la file", "Vaciar la cola", "Warteschlange leeren")}
                >
                  <DeleteIcon size={12} className="inline-flex items-center justify-center mr-1" />
                  {t("Svuota", "Clear", "Vider", "Vaciar", "Leeren")}
                </Button>
              ) : null}
            </div>
          )}
        </div>

        {bulkSelectedIds.size > 0 ? (
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-primary/5 hairline-t hairline-b">
            <span className="text-xs font-medium">
              {t(
                `${bulkSelectedIds.size} selezionati`,
                `${bulkSelectedIds.size} selected`,
                `${bulkSelectedIds.size} sélectionnés`,
                `${bulkSelectedIds.size} seleccionados`,
                `${bulkSelectedIds.size} ausgewählt`,
              )}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={onClearBulk}
              >
                {t("Deseleziona", "Deselect", "Désélectionner", "Deseleccionar", "Auswahl aufheben")}
              </Button>
              {bulkRunPendingCount > 0 ? (
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={onBulkRun}
                  disabled={!bulkRunReady}
                  title={
                    bulkRunReady
                      ? undefined
                      : t(
                          "Seleziona un modello prima di avviare l'OCR",
                          "Select a model before running OCR",
                          "Sélectionne un modèle avant de lancer l'OCR",
                          "Selecciona un modelo antes de iniciar OCR",
                          "Wähle ein Modell, bevor du OCR startest",
                        )
                  }
                >
                  {t(
                    `Avvia (${bulkRunPendingCount})`,
                    `Run (${bulkRunPendingCount})`,
                    `Lancer (${bulkRunPendingCount})`,
                    `Iniciar (${bulkRunPendingCount})`,
                    `Starten (${bulkRunPendingCount})`,
                  )}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={onBulkRemove}
              >
                {t("Rimuovi", "Remove", "Supprimer", "Eliminar", "Entfernen")}
              </Button>
            </div>
          </div>
        ) : null}

        {files.length > 0 && queueView === "gallery" ? (
          <div className="overflow-x-auto custom-scroll px-2 py-2 hairline-t">
            <div className="flex gap-2">
              {files.map((file) => {
                const isActive = selectedFileId === file.id;
                const isBulk = bulkSelectedIds.has(file.id);
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => onSelectFile(file.id)}
                    onDoubleClick={() => onToggleBulk(file.id)}
                    aria-current={isActive}
                    title={file.name}
                    className={cn(
                      "relative shrink-0 w-[88px] rounded-md overflow-hidden transition-all border-2",
                      isActive ? "border-primary shadow-md" : "border-transparent opacity-80 hover:opacity-100",
                      isBulk && "ring-2 ring-primary/40 ring-offset-1 ring-offset-background",
                    )}
                  >
                    {file.preview ? (
                      <img src={file.preview} alt="" loading="lazy" decoding="async" className="h-24 w-full object-cover bg-background" draggable={false} />
                    ) : (
                      <div className="h-24 w-full bg-secondary/40 flex items-center justify-center">
                        <FileTextIcon size={20} className="inline-flex items-center justify-center text-muted-foreground" />
                      </div>
                    )}
                    <span className="absolute bottom-0 inset-x-0 bg-background/85 text-[10px] truncate text-center py-0.5 px-1">
                      {file.name}
                    </span>
                    {file.status === "completed" ? (
                      <CircleCheckIcon size={12} className="absolute top-1 left-1 text-[oklch(0.55_0.13_150)]" />
                    ) : null}
                    {file.status === "error" ? (
                      <AlertCircle className="absolute top-1 left-1 h-3 w-3 text-destructive" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {files.length > 0 && queueView === "list" ? (
          <ScrollArea className="max-h-[220px]">
            <div className="p-2 space-y-1">
              <AnimatePresence initial={false}>
                {files.map((file, index) => (
                  <FileListItem
                    key={file.id}
                    file={file}
                    index={index}
                    isSelected={selectedFileId === file.id}
                    onSelect={onSelectFile}
                    onRemove={onRemoveFile}
                    bulkChecked={bulkSelectedIds.has(file.id)}
                    onToggleBulk={onToggleBulk}
                    t={t}
                    uiLanguage={uiLanguage}
                  />
                ))}
              </AnimatePresence>
            </div>
          </ScrollArea>
        ) : null}

        {files.length === 0 ? (
          <div className="flex items-center justify-center py-8 min-h-[120px]">
            <div className="text-center">
              <div className="mx-auto mb-3 flex items-center justify-center text-muted-foreground/70">
                <FileTextIcon size={32} className="inline-flex items-center justify-center" />
              </div>
              <p className="text-sm font-medium">
                {t(
                  "Nessun file",
                  "No files yet",
                  "Aucun fichier",
                  "Sin archivos aún",
                  "Noch keine Dateien",
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Carica documenti per iniziare",
                  "Upload documents to start",
                  "Téléversez des documents pour commencer",
                  "Sube documentos para empezar",
                  "Dokumente hochladen, um zu starten",
                )}
              </p>
            </div>
          </div>
        ) : null}

        {footer}
      </CardContent>
    </Card>
  );
}
