"use client";

import * as React from "react";
import { Camera, RotateCcw, Check, X, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

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
  const streamRef = React.useRef<MediaStream | null>(null);
  const [status, setStatus] = React.useState<"starting" | "ready" | "preview" | "error">("starting");
  const [errorMessage, setErrorMessage] = React.useState("");
  const [snapshot, setSnapshot] = React.useState<string | null>(null);

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

  const takePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    setSnapshot(canvas.toDataURL("image/jpeg", 0.92));
    setStatus("preview");
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
