"use client";

import * as React from "react";
import { motion } from "motion/react";
import { FileUp, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

import type { Translator } from "@/app/page-components/types";

export interface UploadAreaProps {
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPickFiles: (files: FileList) => void;
  t: Translator;
}

export function UploadArea({
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onPickFiles,
  t,
}: UploadAreaProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <>
      <Card
        className={cn(
          "transition-all duration-300 cursor-pointer",
          isDragOver ? "bg-primary/5 scale-[1.02]" : "",
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <CardContent className="flex flex-col items-center justify-center py-8 px-4">
          <motion.div
            animate={isDragOver ? { scale: 1.1, y: -5 } : { scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300 }}
          >
            <div className="relative">
              <Upload className="h-10 w-10 text-muted-foreground mb-3" />
              <div className="absolute -top-1 -right-1">
                <FileUp className="h-4 w-4 text-primary" />
              </div>
            </div>
          </motion.div>
          <p className="text-sm font-medium mb-1">
            {isDragOver
              ? t(
                  "Rilascia qui i file",
                  "Drop files here",
                  "Déposez les fichiers ici",
                  "Suelta los archivos aquí",
                  "Dateien hier ablegen",
                )
              : t(
                  "Trascina i documenti o clicca per caricare",
                  "Drop documents or click to upload",
                  "Glissez-déposez des documents ou cliquez pour téléverser",
                  "Arrastra documentos o haz clic para subir",
                  "Dokumente hier ablegen oder klicken, um hochzuladen",
                )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              "Supporta immagini, PDF e documenti",
              "Supports images, PDFs, and documents",
              "Prend en charge images, PDF et documents",
              "Admite imágenes, PDF y documentos",
              "Unterstützt Bilder, PDFs und Dokumente",
            )}
          </p>
        </CardContent>
      </Card>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => e.target.files && onPickFiles(e.target.files)}
      />
    </>
  );
}
