"use client";

import * as React from "react";
import { Camera, RotateCcw, Check, X, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { enhanceForOcr } from "@/lib/image/enhance";

import type { Translator } from "@/app/page-components/types";

export interface CameraCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
  t: Translator;
}

export function CameraCaptureDialog({
  open,
  onOpenChange,
  onCapture,
  t,
}: CameraCaptureDialogProps) {
  const { toast } = useToast();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const rawCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [status, setStatus] = React.useState<"starting" | "ready" | "preview" | "error">("starting");
  const [errorMessage, setErrorMessage] = React.useState("");
  const [snapshot, setSnapshot] = React.useState<string | null>(null);
  const [enhance, setEnhance] = React.useState(true);

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startStream = React.useCallback(async () => {
    setStatus("starting");
    setErrorMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setStatus("ready");
    } catch (error) {
      stopStream();
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Camera unavailable");
    }
  }, [stopStream]);

  React.useEffect(() => {
    if (!open) {
      stopStream();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnapshot(null);
      setStatus("starting");
      return;
    }
    void startStream();
    return () => stopStream();
  }, [open, startStream, stopStream]);

  const renderFromRaw = React.useCallback((useEnhance: boolean) => {
    const raw = rawCanvasRef.current;
    const out = canvasRef.current;
    if (!raw || !out) return null;
    out.width = raw.width;
    out.height = raw.height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    if (useEnhance) {
      const enhanced = enhanceForOcr(raw, raw.width, raw.height);
      ctx.drawImage(enhanced, 0, 0);
    } else {
      ctx.drawImage(raw, 0, 0);
    }
    return out;
  }, []);

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const raw = document.createElement("canvas");
    raw.width = w;
    raw.height = h;
    const rawCtx = raw.getContext("2d");
    if (!rawCtx) return;
    rawCtx.drawImage(video, 0, 0, w, h);
    rawCanvasRef.current = raw;
    const canvas = renderFromRaw(enhance);
    if (!canvas) return;
    setSnapshot(canvas.toDataURL("image/jpeg", 0.92));
    setStatus("preview");
  };

  const toggleEnhance = (next: boolean) => {
    setEnhance(next);
    if (status === "preview") {
      const canvas = renderFromRaw(next);
      if (canvas) setSnapshot(canvas.toDataURL("image/jpeg", 0.92));
    }
  };

  const retake = () => {
    setSnapshot(null);
    if (streamRef.current) {
      setStatus("ready");
    } else {
      void startStream();
    }
  };

  const accept = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const filename = `capture-${Date.now()}.jpg`;
        const file = new File([blob], filename, { type: "image/jpeg" });
        onCapture(file);
        onOpenChange(false);
      },
      "image/jpeg",
      0.92,
    );
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      stopStream();
      setSnapshot(null);
      setStatus("starting");
    }
    onOpenChange(next);
  };

  React.useEffect(() => {
    if (status === "error") {
      toast({
        title: t("Fotocamera non disponibile", "Camera unavailable", "Caméra indisponible", "Cámara no disponible", "Kamera nicht verfügbar"),
        description: errorMessage,
        variant: "destructive",
      });
    }
  }, [status, errorMessage, t, toast]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="!max-w-2xl p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <DialogTitle>
            {t("Scatta una foto", "Take a photo", "Prendre une photo", "Hacer una foto", "Foto aufnehmen")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t(
              "Inquadra il documento. Si userà la fotocamera posteriore quando disponibile.",
              "Frame the document. The rear camera is used when available.",
              "Cadrez le document. La caméra arrière est utilisée si disponible.",
              "Encuadra el documento. Se usará la cámara trasera cuando esté disponible.",
              "Dokument einrahmen. Die Rückkamera wird genutzt, wenn vorhanden.",
            )}
          </DialogDescription>
        </div>
        <div className="relative bg-black aspect-[4/3] overflow-hidden">
          {snapshot ? (
            <img src={snapshot} alt="capture preview" className="w-full h-full object-contain" />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-contain"
            />
          )}
          {status === "starting" ? (
            <div className="absolute inset-0 grid place-items-center text-white">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : null}
          {status === "error" ? (
            <div className="absolute inset-0 grid place-items-center text-white p-6 text-sm text-center">
              {t(
                "Impossibile accedere alla fotocamera. Concedi il permesso o usa il caricamento file.",
                "Couldn't access the camera. Grant permission or use file upload.",
                "Impossible d'accéder à la caméra. Accorde la permission ou utilise le téléversement.",
                "No se pudo acceder a la cámara. Concede permiso o usa la subida de archivos.",
                "Kein Kamerazugriff. Berechtigung erteilen oder die Datei-Upload-Option nutzen.",
              )}
            </div>
          ) : null}
          <canvas ref={canvasRef} className="hidden" />
        </div>
        <div className="px-6 pt-3 pb-1 flex items-center gap-2">
          <Button
            type="button"
            variant={enhance ? "default" : "outline"}
            size="sm"
            onClick={() => toggleEnhance(!enhance)}
            data-testid="enhance-toggle"
          >
            <Sparkles className="size-3.5 mr-1.5" />
            {enhance
              ? t("Migliora attivo", "Enhance on", "Amélioration activée", "Mejora activada", "Verbesserung aktiv")
              : t("Migliora disattivo", "Enhance off", "Amélioration désactivée", "Mejora desactivada", "Verbesserung aus")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t(
              "Bilanciamento e contrasto automatico per documenti.",
              "Auto-contrast and shadow flattening for documents.",
              "Contraste auto et atténuation des ombres pour les documents.",
              "Contraste automático y reducción de sombras para documentos.",
              "Auto-Kontrast und Schatten-Glättung für Dokumente.",
            )}
          </span>
        </div>
        <DialogFooter className="px-6 py-4 flex flex-row sm:flex-row sm:justify-between gap-2">
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            <X className="size-4 mr-1.5" />
            {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
          </Button>
          {status === "preview" ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={retake}>
                <RotateCcw className="size-4 mr-1.5" />
                {t("Rifai", "Retake", "Reprendre", "Volver a tomar", "Erneut")}
              </Button>
              <Button onClick={accept}>
                <Check className="size-4 mr-1.5" />
                {t("Usa questa foto", "Use this photo", "Utiliser cette photo", "Usar esta foto", "Foto übernehmen")}
              </Button>
            </div>
          ) : (
            <Button onClick={takePhoto} disabled={status !== "ready"}>
              <Camera className="size-4 mr-1.5" />
              {t("Cattura", "Capture", "Capturer", "Capturar", "Aufnehmen")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
