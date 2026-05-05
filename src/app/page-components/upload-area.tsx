"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Camera, FileUp, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CameraCaptureDialog } from "@/app/page-components/camera-capture-dialog";

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
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const [hasCamera, setHasCamera] = React.useState(false);
  const [supportsLivePreview, setSupportsLivePreview] = React.useState(false);
  const [cameraDialogOpen, setCameraDialogOpen] = React.useState(false);

  React.useEffect(() => {
    const live =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices !== "undefined" &&
      typeof navigator.mediaDevices.getUserMedia === "function";
    const coarse = window.matchMedia?.("(any-pointer: coarse)").matches === true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasCamera(Boolean(live || coarse));
    setSupportsLivePreview(Boolean(live));
  }, []);

  const handleTakePhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (supportsLivePreview) {
      setCameraDialogOpen(true);
    } else {
      cameraRef.current?.click();
    }
  };

  const acceptCapturedFiles = (files: File[]) => {
    if (files.length === 0) return;
    const dt = new DataTransfer();
    files.forEach((file) => dt.items.add(file));
    onPickFiles(dt.files);
  };

  return (
    <>
      <Card
        data-tour="upload-zone"
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

      {hasCamera ? (
        <>
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground/60">
            <span className="h-px flex-1 bg-foreground/10" />
            {t("oppure", "or", "ou", "o", "oder")}
            <span className="h-px flex-1 bg-foreground/10" />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTakePhoto}
            className="self-center"
            data-tour="capture-camera"
          >
            <Camera className="size-3.5 mr-1.5" />
            {t("Scatta una foto", "Take a photo", "Prendre une photo", "Hacer una foto", "Foto aufnehmen")}
          </Button>
        </>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => e.target.files && onPickFiles(e.target.files)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => e.target.files && onPickFiles(e.target.files)}
      />
      <CameraCaptureDialog
        open={cameraDialogOpen}
        onOpenChange={setCameraDialogOpen}
        onCapture={acceptCapturedFiles}
        t={t}
      />
    </>
  );
}
