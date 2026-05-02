import * as React from "react";
import { AnimatePresence } from "motion/react";
import { AlertCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

import { CircleCheckIcon } from "@/components/ui/circle-check";
import { DeleteIcon } from "@/components/ui/delete";
import { FileTextIcon } from "@/components/ui/file-text";

import { FileListItem } from "@/app/page-components/file-list-item";
import type {
  ProcessingFile,
  Translator,
  UiLanguage,
} from "@/app/page-components/types";

export interface FileListCardProps {
  files: ProcessingFile[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  onRemoveFile: (id: string) => void;
  onClearAll: () => void;
  completedCount: number;
  errorCount: number;
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
  t,
  uiLanguage,
  footer,
}: FileListCardProps) {
  return (
    <Card className="min-h-[220px] overflow-hidden">
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
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-destructive group"
              onClick={onClearAll}
            >
              <DeleteIcon
                size={12}
                className="inline-flex items-center justify-center mr-1 transition-transform duration-200 group-hover:scale-110"
              />
              {t("Pulisci", "Clear", "Effacer", "Limpiar", "Leeren")}
            </Button>
          )}
        </div>

        {files.length > 0 ? (
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
                    t={t}
                    uiLanguage={uiLanguage}
                  />
                ))}
              </AnimatePresence>
            </div>
          </ScrollArea>
        ) : (
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
        )}

        {footer}
      </CardContent>
    </Card>
  );
}
