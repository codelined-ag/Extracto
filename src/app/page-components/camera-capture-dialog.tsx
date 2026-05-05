"use client";

import * as React from "react";
import { Camera, RotateCcw, Check, X, Loader2, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  CAPTURE_MODE_PRESETS,
  enhanceForOcr,
  type CaptureMode,
} from "@/lib/image/enhance";

import type { Translator } from "@/app/page-components/types";

export interface CameraCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (files: File[]) => void;
  t: Translator;
}

interface BatchShot {
  id: string;
  file: File;
  thumb: string;
}

const MODES = Object.keys(CAPTURE_MODE_PRESETS) as CaptureMode[];
const THUMB_MAX_EDGE = 96;

function makeThumbDataUrl(source: HTMLCanvasElement): string {
  const ratio = source.width / source.height;
  const w = ratio >= 1 ? THUMB_MAX_EDGE : Math.round(THUMB_MAX_EDGE * ratio);
  const h = ratio >= 1 ? Math.round(THUMB_MAX_EDGE / ratio) : THUMB_MAX_EDGE;
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(1, w);
  thumb.height = Math.max(1, h);
  const ctx = thumb.getContext("2d");
  if (!ctx) return source.toDataURL("image/jpeg", 0.6);
  ctx.drawImage(source, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL("image/jpeg", 0.7);
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
  const [mode, setMode] = React.useState<CaptureMode>("document");
  const [shots, setShots] = React.useState<BatchShot[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const shotsRef = React.useRef<BatchShot[]>([]);
  React.useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

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
      setShots([]);
      setMode("document");
      setEnhance(true);
      return;
    }
    void startStream();
    return () => stopStream();
  }, [open, startStream, stopStream]);

  const renderFromRaw = React.useCallback(
    (useEnhance: boolean, captureMode: CaptureMode) => {
      const raw = rawCanvasRef.current;
      const out = canvasRef.current;
      if (!raw || !out) return null;
      out.width = raw.width;
      out.height = raw.height;
      const ctx = out.getContext("2d");
      if (!ctx) return null;
      if (useEnhance) {
        const enhanced = enhanceForOcr(raw, raw.width, raw.height, CAPTURE_MODE_PRESETS[captureMode]);
        ctx.drawImage(enhanced, 0, 0);
      } else {
        ctx.drawImage(raw, 0, 0);
      }
      return out;
    },
    [],
  );

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
    const canvas = renderFromRaw(enhance, mode);
    if (!canvas) return;
    setSnapshot(canvas.toDataURL("image/jpeg", 0.92));
    setStatus("preview");
  };

  const toggleEnhance = (next: boolean) => {
    setEnhance(next);
    if (status === "preview") {
      const canvas = renderFromRaw(next, mode);
      if (canvas) setSnapshot(canvas.toDataURL("image/jpeg", 0.92));
    }
  };

  const switchMode = (next: CaptureMode) => {
    setMode(next);
    if (status === "preview") {
      const canvas = renderFromRaw(enhance, next);
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

  const addToBatch = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const thumb = makeThumbDataUrl(canvas);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const filename = `capture-${id}.jpg`;
        const file = new File([blob], filename, { type: "image/jpeg" });
        setShots((prev) => [...prev, { id, file, thumb }]);
        rawCanvasRef.current = null;
        setSnapshot(null);
        setStatus(streamRef.current ? "ready" : "starting");
        if (!streamRef.current) void startStream();
      },
      "image/jpeg",
      0.92,
    );
  };

  const removeShot = (id: string) => {
    setShots((prev) => prev.filter((shot) => shot.id !== id));
  };

  const finishBatch = () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    const finalize = (extra?: BatchShot) => {
      const base = shotsRef.current;
      const all = extra ? [...base, extra] : base;
      if (all.length > 0) onCapture(all.map((shot) => shot.file));
      submittingRef.current = false;
      setSubmitting(false);
      onOpenChange(false);
    };
    if (status === "preview") {
      const canvas = canvasRef.current;
      if (!canvas) {
        finalize();
        return;
      }
      const thumb = makeThumbDataUrl(canvas);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            finalize();
            return;
          }
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const filename = `capture-${id}.jpg`;
          const file = new File([blob], filename, { type: "image/jpeg" });
          finalize({ id, file, thumb });
        },
        "image/jpeg",
        0.92,
      );
      return;
    }
    finalize();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      stopStream();
      setSnapshot(null);
      setStatus("starting");
      setShots([]);
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

  const modeLabel = (m: CaptureMode) => {
    if (m === "document") return t("Documento", "Document", "Document", "Documento", "Dokument");
    if (m === "receipt") return t("Scontrino", "Receipt", "Reçu", "Recibo", "Beleg");
    return t("Lavagna", "Whiteboard", "Tableau", "Pizarra", "Whiteboard");
  };

  const finishLabel = () => {
    const total = shots.length + (status === "preview" ? 1 : 0);
    if (total <= 1) {
      return t("Usa questa foto", "Use this photo", "Utiliser cette photo", "Usar esta foto", "Foto übernehmen");
    }
    return t(
      `Usa ${total} foto`,
      `Use ${total} photos`,
      `Utiliser ${total} photos`,
      `Usar ${total} fotos`,
      `${total} Fotos übernehmen`,
    );
  };

  const canFinish = shots.length > 0 || status === "preview";

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
        <div className="px-6 pb-2 flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={mode === m ? "default" : "outline"}
              onClick={() => switchMode(m)}
              data-testid={`mode-${m}`}
            >
              {modeLabel(m)}
            </Button>
          ))}
        </div>
        <div className="relative bg-black aspect-[4/3] overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`w-full h-full object-contain ${snapshot ? "invisible" : ""}`}
          />
          {snapshot ? (
            <img
              src={snapshot}
              alt="capture preview"
              className="absolute inset-0 w-full h-full object-contain"
            />
          ) : null}
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
        <div className="px-6 pt-3 pb-1 flex items-center gap-2 flex-wrap">
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
        {shots.length > 0 ? (
          <div className="px-6 pt-2 pb-1 flex gap-2 overflow-x-auto" data-testid="shot-tray">
            {shots.map((shot, idx) => (
              <div key={shot.id} className="relative shrink-0">
                <img
                  src={shot.thumb}
                  alt={`shot ${idx + 1}`}
                  className="h-16 w-16 object-cover rounded border"
                />
                <button
                  type="button"
                  aria-label={t("Rimuovi", "Remove", "Retirer", "Quitar", "Entfernen")}
                  onClick={() => removeShot(shot.id)}
                  className="absolute -top-1.5 -right-1.5 bg-background border rounded-full size-5 grid place-items-center text-muted-foreground hover:text-destructive"
                  data-testid={`remove-shot-${idx}`}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <DialogFooter className="px-6 py-4 flex flex-row sm:flex-row sm:justify-between gap-2">
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            <X className="size-4 mr-1.5" />
            {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
          </Button>
          <div className="flex gap-2 flex-wrap justify-end">
            {status === "preview" ? (
              <>
                <Button variant="outline" onClick={retake}>
                  <RotateCcw className="size-4 mr-1.5" />
                  {t("Rifai", "Retake", "Reprendre", "Volver a tomar", "Erneut")}
                </Button>
                <Button variant="outline" onClick={addToBatch} data-testid="add-to-batch">
                  <Camera className="size-4 mr-1.5" />
                  {t("Aggiungi e continua", "Add and keep shooting", "Ajouter et continuer", "Añadir y seguir", "Hinzufügen und weiter")}
                </Button>
                <Button onClick={finishBatch} disabled={submitting} data-testid="finish-batch">
                  <Check className="size-4 mr-1.5" />
                  {finishLabel()}
                </Button>
              </>
            ) : (
              <>
                {canFinish ? (
                  <Button variant="outline" onClick={finishBatch} disabled={submitting} data-testid="finish-batch">
                    <Check className="size-4 mr-1.5" />
                    {finishLabel()}
                  </Button>
                ) : null}
                <Button onClick={takePhoto} disabled={status !== "ready"}>
                  <Camera className="size-4 mr-1.5" />
                  {t("Cattura", "Capture", "Capturer", "Capturar", "Aufnehmen")}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
