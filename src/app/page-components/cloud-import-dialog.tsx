"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, FileText, Folder, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

type Provider = "dropbox" | "google_drive" | "onedrive";

const PROVIDERS: ReadonlyArray<{ id: Provider; label: string }> = [
  { id: "dropbox", label: "Dropbox" },
  { id: "google_drive", label: "Google Drive" },
  { id: "onedrive", label: "OneDrive" },
];

interface Entry {
  kind: "file" | "folder";
  id: string;
  name: string;
  path: string;
  size: number;
  modified: string | null;
}

export interface CloudImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultModel: string;
  connected: Record<Provider, boolean>;
  t: Translator;
}

export function CloudImportDialog({
  open,
  onOpenChange,
  defaultModel,
  connected,
  t,
}: CloudImportDialogProps) {
  const firstConnected = (PROVIDERS.find((p) => connected[p.id])?.id ?? "dropbox") as Provider;
  const [provider, setProvider] = React.useState<Provider>(firstConnected);
  const [path, setPath] = React.useState<Record<Provider, string>>({ dropbox: "", google_drive: "root", onedrive: "root" });
  const [entries, setEntries] = React.useState<Record<Provider, Entry[]>>({ dropbox: [], google_drive: [], onedrive: [] });
  const [loading, setLoading] = React.useState(false);
  const [stack, setStack] = React.useState<Record<Provider, Array<{ id: string; name: string }>>>({ dropbox: [], google_drive: [], onedrive: [] });
  const [model, setModel] = React.useState(defaultModel);
  const { toast } = useToast();

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setModel(defaultModel);
  }, [open, defaultModel]);

  const list = React.useCallback(async (p: Provider, target: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/integrations/${p}/list?path=${encodeURIComponent(target)}`);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { entries: Entry[] };
      setEntries((prev) => ({ ...prev, [p]: json.entries ?? [] }));
    } catch (err) {
      toast({
        title: t("Caricamento fallito", "Listing failed", "Échec du listing", "Error al listar", "Auflisten fehlgeschlagen"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  React.useEffect(() => {
    if (!open) return;
    if (!connected[provider]) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void list(provider, path[provider]);
  }, [open, provider, path, connected, list]);

  const enterFolder = (entry: Entry) => {
    const next = entry.kind === "folder" ? entry.id : path[provider];
    setStack((prev) => ({ ...prev, [provider]: [...prev[provider], { id: path[provider], name: entry.name }] }));
    setPath((prev) => ({ ...prev, [provider]: next }));
  };

  const popFolder = () => {
    const cur = stack[provider];
    if (cur.length === 0) return;
    const last = cur[cur.length - 1];
    setStack((prev) => ({ ...prev, [provider]: prev[provider].slice(0, -1) }));
    setPath((prev) => ({ ...prev, [provider]: last.id }));
  };

  const importFile = async (entry: Entry) => {
    if (!model.trim()) {
      toast({ title: t("Inserisci un modello", "Model is required"), variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/integrations/${provider}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remoteId: entry.id, model: model.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; jobId?: string; fileName?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast({
        title: t("Importato", "Imported", "Importé", "Importado", "Importiert"),
        description: json.fileName,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: t("Importazione fallita", "Import failed", "Échec de l'import", "Error al importar", "Import fehlgeschlagen"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t("Importa dal cloud", "Import from cloud", "Importer depuis le cloud", "Importar desde la nube", "Aus der Cloud importieren")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Scegli un file da Dropbox, Google Drive o OneDrive e mandalo direttamente all'OCR.",
              "Pick a file from Dropbox, Google Drive, or OneDrive and run OCR on it.",
              "Choisissez un fichier sur Dropbox, Google Drive ou OneDrive et lancez l'OCR.",
              "Elige un archivo de Dropbox, Google Drive u OneDrive y procésalo con OCR.",
              "Wähle eine Datei aus Dropbox, Google Drive oder OneDrive und starte OCR.",
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={provider} onValueChange={(v) => setProvider(v as Provider)}>
          <TabsList>
            {PROVIDERS.map((p) => (
              <TabsTrigger key={p.id} value={p.id} disabled={!connected[p.id]}>
                {p.label}
                {!connected[p.id] ? " · off" : ""}
              </TabsTrigger>
            ))}
          </TabsList>
          {PROVIDERS.map((p) => (
            <TabsContent key={p.id} value={p.id} className="space-y-3">
              {!connected[p.id] ? (
                <div className="space-y-3 p-4">
                  <p className="text-sm text-muted-foreground">
                    {t("Account non connesso.","Account not connected.","Compte non connecté.","Cuenta no conectada.","Konto nicht verbunden.")}
                  </p>
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/integrations/${p.id}/start`, { method: "POST" });
                        const json = (await res.json().catch(() => ({}))) as { authUrl?: string; error?: string };
                        if (!res.ok || !json.authUrl) {
                          alert(json.error || `Connect failed (${res.status})`);
                          return;
                        }
                        window.location.href = json.authUrl;
                      } catch (err) {
                        alert(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    {t(`Connetti ${p.label}`, `Connect ${p.label}`, `Connecter ${p.label}`, `Conectar ${p.label}`, `${p.label} verbinden`)}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={popFolder} disabled={stack[p.id].length === 0 || loading}>
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground truncate">
                      {stack[p.id].map((s) => s.name).join(" / ") || "/"}
                    </span>
                  </div>
                  <ScrollArea className="h-72 rounded border">
                    <div className="p-1">
                      {loading ? (
                        <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
                          <Loader2 className="size-3.5 mr-2 animate-spin" />
                          {t("Caricamento…", "Loading…", "Chargement…", "Cargando…", "Lädt…")}
                        </div>
                      ) : entries[p.id].length === 0 ? (
                        <div className="py-8 text-center text-xs text-muted-foreground">
                          {t("Cartella vuota", "Empty folder", "Dossier vide", "Carpeta vacía", "Leerer Ordner")}
                        </div>
                      ) : (
                        entries[p.id].map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => entry.kind === "folder" ? enterFolder(entry) : void importFile(entry)}
                            className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary/50 disabled:opacity-50"
                            disabled={loading}
                          >
                            {entry.kind === "folder" ? <Folder className="size-3.5 text-primary" /> : <FileText className="size-3.5" />}
                            <span className="flex-1 truncate">{entry.name}</span>
                            {entry.kind === "file" ? <ChevronRight className="size-3.5 text-muted-foreground" /> : null}
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>

        <div className="grid gap-1">
          <Label className="text-xs">
            {t("Modello", "Model", "Modèle", "Modelo", "Modell")}
          </Label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="mistral-ocr-latest" />
          <p className="text-xs text-muted-foreground">
            {t(
              "Il modello che verrà usato per l'OCR del file importato.",
              "The model used to OCR the imported file.",
              "Le modèle utilisé pour l'OCR du fichier importé.",
              "El modelo que se usará para procesar el archivo importado.",
              "Das Modell, mit dem die importierte Datei verarbeitet wird.",
            )}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
