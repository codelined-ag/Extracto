"use client";

import { motion } from "motion/react";
import { AlertCircle, CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import { CircleCheckIcon } from "@/components/ui/circle-check";
import { FileTextIcon } from "@/components/ui/file-text";
import { LoaderCircleIcon } from "@/components/ui/loader-circle";
import { PauseIcon } from "@/components/ui/pause";
import { XIcon } from "@/components/ui/x";

import { formatEta, formatFileSize, translatePipelineMessage } from "@/app/page-components/page-utils";
import type { ProcessingFile, Translator, UiLanguage } from "@/app/page-components/types";

export interface FileListItemProps {
  file: ProcessingFile;
  index: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  bulkChecked: boolean;
  onToggleBulk: (id: string) => void;
  t: Translator;
  uiLanguage: UiLanguage;
}

export function FileListItem({
  file,
  index,
  isSelected,
  onSelect,
  onRemove,
  bulkChecked,
  onToggleBulk,
  t,
  uiLanguage,
}: FileListItemProps) {
  return (
    <motion.div
      key={file.id}
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      className={cn(
        "group/item flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors",
        isSelected ? "bg-primary/10" : "hover:bg-muted/50",
        bulkChecked && "ring-1 ring-primary/40",
      )}
      onClick={() => onSelect(file.id)}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={bulkChecked}
        aria-label={
          bulkChecked
            ? t("Deseleziona", "Deselect", "Désélectionner", "Deseleccionar", "Abwählen")
            : t("Seleziona", "Select", "Sélectionner", "Seleccionar", "Auswählen")
        }
        onClick={(e) => {
          e.stopPropagation();
          onToggleBulk(file.id);
        }}
        className={cn(
          "shrink-0 inline-flex h-4 w-4 items-center justify-center rounded transition-colors",
          bulkChecked
            ? "bg-primary text-primary-foreground"
            : "border border-border/60 bg-background opacity-0 group-hover/item:opacity-100 hover:bg-secondary",
        )}
      >
        {bulkChecked ? <CheckIcon size={11} /> : null}
      </button>
      <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
        {file.preview ? (
          <img src={file.preview} alt={file.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : (
          <FileTextIcon size={20} className="inline-flex items-center justify-center text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium break-words leading-tight" title={file.name}>{file.name}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
          {typeof file.pageCount === "number" ? (
            <span className="text-[11px] text-muted-foreground">
              {file.pageCount}{" "}
              {file.pageCount === 1
                ? t("pagina", "page", "page", "página", "Seite")
                : t("pagine", "pages", "pages", "páginas", "Seiten")}
            </span>
          ) : null}
          {file.status === "processing" && (
            <div className="flex items-center gap-1">
              <LoaderCircleIcon
                size={12}
                className="inline-flex items-center justify-center animate-spin text-primary"
              />
              <span className="text-xs text-primary">{file.progress}%</span>
            </div>
          )}
          {file.status === "pending" && file.isPreprocessing ? (
            <div className="flex items-center gap-1">
              <LoaderCircleIcon
                size={11}
                className="inline-flex items-center justify-center animate-spin text-muted-foreground"
              />
              <span className="text-[11px] text-muted-foreground">
                {t("Preparazione...", "Preparing...", "Préparation...", "Preparando...", "Vorbereitung...")}
              </span>
            </div>
          ) : null}
          {file.status === "paused" ? (
            <div className="flex items-center gap-1">
              <PauseIcon
                size={12}
                className="inline-flex items-center justify-center text-accent-foreground"
              />
              <span className="text-xs text-accent-foreground">
                {t("in pausa", "paused", "en pause", "en pausa", "pausiert")}
              </span>
            </div>
          ) : null}
        </div>
        {(file.status === "processing" || file.status === "paused") && (
          <>
            <Progress value={file.progress} className="h-1 mt-1" />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">
                {translatePipelineMessage(file.stageMessage, uiLanguage) ||
                  (file.status === "paused"
                    ? t("In pausa", "Paused", "En pause", "En pausa", "Pausiert")
                    : t("In lavorazione", "Working", "En cours", "Trabajando", "In Arbeit"))}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {t("ETA", "ETA", "ETA", "ETA", "ETA")} {formatEta(file.etaSeconds)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="flex-shrink-0">
        {file.status === "completed" && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400 }}
          >
            <CircleCheckIcon
              size={16}
              className="inline-flex items-center justify-center text-[oklch(0.55_0.13_150)]"
            />
          </motion.div>
        )}
        {file.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
        {file.status === "paused" && (
          <PauseIcon
            size={16}
            className="inline-flex items-center justify-center text-accent-foreground"
          />
        )}
        {file.status === "pending" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(file.id);
            }}
          >
            <XIcon size={12} className="inline-flex items-center justify-center" />
          </Button>
        )}
      </div>
    </motion.div>
  );
}
