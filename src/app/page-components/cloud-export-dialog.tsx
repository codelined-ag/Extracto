"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Translator } from "@/app/page-components/types";

type CloudProvider = "dropbox" | "google_drive" | "onedrive";

const FORMAT_OPTIONS = ["md", "json", "txt", "html", "docx", "rtf", "csv", "xlsx", "obsidian", "zip"] as const;
type ExportFormat = (typeof FORMAT_OPTIONS)[number];

const PROVIDER_LABEL: Record<CloudProvider, string> = {
  dropbox: "Dropbox",
  google_drive: "Google Drive",
  onedrive: "OneDrive",
};

const FOLDER_PLACEHOLDER: Record<CloudProvider, string> = {
  dropbox: "/Extracto",
  google_drive: "root",
  onedrive: "root",
};

const FOLDER_HELP: Record<CloudProvider, { it: string; en: string; fr: string; es: string; de: string }> = {
  dropbox: {
    it: "Percorso (es. /Extracto). Se vuoto verrà usata la root.",
    en: "Path (e.g. /Extracto). Defaults to the account root if blank.",
    fr: "Chemin (ex. /Extracto). Racine du compte si vide.",
    es: "Ruta (p. ej. /Extracto). Raíz de la cuenta si está vacío.",
    de: "Pfad (z. B. /Extracto). Konto-Wurzel, wenn leer.",
  },
  google_drive: {
    it: "ID cartella (root o un id specifico).",
    en: "Folder id (root or a specific id).",
    fr: "ID du dossier (root ou un id spécifique).",
    es: "ID de carpeta (root o un id específico).",
    de: "Ordner-ID (root oder eine bestimmte ID).",
  },
  onedrive: {
    it: "ID cartella (root o un id specifico).",
    en: "Folder id (root or a specific id).",
    fr: "ID du dossier (root ou un id spécifique).",
    es: "ID de carpeta (root o un id específico).",
    de: "Ordner-ID (root oder eine bestimmte ID).",
  },
};

export interface CloudExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: CloudProvider;
  fileName?: string;
  t: Translator;
  onSubmit: (folder: string, format: ExportFormat) => Promise<void> | void;
}

export function CloudExportDialog({
  open,
  onOpenChange,
  provider,
  fileName,
  t,
  onSubmit,
}: CloudExportDialogProps) {
  const [folder, setFolder] = React.useState(FOLDER_PLACEHOLDER[provider]);
  const [format, setFormat] = React.useState<ExportFormat>("md");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFolder(FOLDER_PLACEHOLDER[provider]);
    setFormat("md");
    setBusy(false);
  }, [open, provider]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(folder.trim() || FOLDER_PLACEHOLDER[provider], format);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const help = FOLDER_HELP[provider];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {t(
                `Invia a ${PROVIDER_LABEL[provider]}`,
                `Send to ${PROVIDER_LABEL[provider]}`,
                `Envoyer vers ${PROVIDER_LABEL[provider]}`,
                `Enviar a ${PROVIDER_LABEL[provider]}`,
                `An ${PROVIDER_LABEL[provider]} senden`,
              )}
            </DialogTitle>
            <DialogDescription>
              {fileName ? fileName : t("Esporta il risultato OCR.", "Export the OCR result.", "Exporter le résultat OCR.", "Exportar el resultado OCR.", "OCR-Ergebnis exportieren.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cloud-export-folder">
                {t("Cartella", "Folder", "Dossier", "Carpeta", "Ordner")}
              </Label>
              <Input
                id="cloud-export-folder"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder={FOLDER_PLACEHOLDER[provider]}
                spellCheck={false}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">{t(help.it, help.en, help.fr, help.es, help.de)}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cloud-export-format">{t("Formato", "Format", "Format", "Formato", "Format")}</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
                <SelectTrigger id="cloud-export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAT_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy
                ? t("Invio in corso...", "Sending...", "Envoi en cours...", "Enviando...", "Wird gesendet...")
                : t("Invia", "Send", "Envoyer", "Enviar", "Senden")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
