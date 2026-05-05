"use client";

import * as React from "react";
import { ChevronRight, Folder, FolderOpen, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

type CloudProvider = "dropbox" | "google_drive" | "onedrive";

interface CloudEntry {
  kind: "file" | "folder";
  id: string;
  name: string;
  path?: string;
  size?: number;
  modified?: string | null;
}

interface Crumb {
  id: string;
  name: string;
}

const PROVIDER_ROOT_ID: Record<CloudProvider, string> = {
  dropbox: "",
  google_drive: "root",
  onedrive: "",
};

const PROVIDER_ROOT_LABEL: Record<CloudProvider, string> = {
  dropbox: "/",
  google_drive: "My Drive",
  onedrive: "App folder",
};

export interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: CloudProvider;
  initialPath?: string;
  onSelect: (path: string) => void;
  t: Translator;
}

export function FolderPickerDialog({ open, onOpenChange, provider, initialPath, onSelect, t }: FolderPickerDialogProps) {
  const { toast } = useToast();
  const [crumbs, setCrumbs] = React.useState<Crumb[]>([]);
  const [entries, setEntries] = React.useState<CloudEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const requestIdRef = React.useRef(0);
  const tRef = React.useRef(t);
  const toastRef = React.useRef(toast);
  React.useEffect(() => {
    tRef.current = t;
    toastRef.current = toast;
  }, [t, toast]);

  const currentId = crumbs.length === 0 ? PROVIDER_ROOT_ID[provider] : crumbs[crumbs.length - 1].id;
  const rootLabel = PROVIDER_ROOT_LABEL[provider];

  const fetchFolder = React.useCallback(
    async (path: string) => {
      const myId = requestIdRef.current + 1;
      requestIdRef.current = myId;
      setLoading(true);
      try {
        const res = await fetch(`/api/integrations/${provider}/list?path=${encodeURIComponent(path)}`);
        if (requestIdRef.current !== myId) return;
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { entries: CloudEntry[] };
        if (requestIdRef.current !== myId) return;
        setEntries(json.entries ?? []);
      } catch (err) {
        if (requestIdRef.current !== myId) return;
        toastRef.current({
          title: tRef.current("Caricamento cartelle fallito", "Failed to load folders", "Échec du chargement des dossiers", "Error al cargar carpetas", "Ordner laden fehlgeschlagen"),
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        setEntries([]);
      } finally {
        if (requestIdRef.current === myId) setLoading(false);
      }
    },
    [provider],
  );

  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCrumbs([]);
    setEntries([]);
    void fetchFolder(initialPath ?? PROVIDER_ROOT_ID[provider]);
  }, [open, provider, initialPath, fetchFolder]);

  const enterFolder = (entry: CloudEntry) => {
    if (entry.kind !== "folder") return;
    setCrumbs((prev) => [...prev, { id: entry.id, name: entry.name }]);
    void fetchFolder(entry.id);
  };

  const goToCrumb = (index: number) => {
    if (index < 0) {
      setCrumbs([]);
      void fetchFolder(PROVIDER_ROOT_ID[provider]);
      return;
    }
    const next = crumbs.slice(0, index + 1);
    setCrumbs(next);
    void fetchFolder(next[next.length - 1].id);
  };

  const pickCurrent = () => {
    onSelect(currentId);
    onOpenChange(false);
  };

  const folders = entries.filter((e) => e.kind === "folder");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("Scegli una cartella", "Pick a folder", "Choisir un dossier", "Elige una carpeta", "Ordner auswählen")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Naviga la struttura del provider e conferma per usare l'ID della cartella corrente.",
              "Browse the provider's tree and confirm to use the current folder's ID.",
              "Navigue dans l'arborescence du fournisseur et confirme pour utiliser l'ID du dossier actuel.",
              "Navega el árbol del proveedor y confirma para usar el ID de la carpeta actual.",
              "Durchsuche die Struktur des Anbieters und bestätige, um die aktuelle Ordner-ID zu übernehmen.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
          <button type="button" onClick={() => goToCrumb(-1)} className="hover:underline" aria-label={t("Torna alla radice", "Go to root", "Aller à la racine", "Ir a raíz", "Zur Wurzel")}>{rootLabel}</button>
          {crumbs.map((c, i) => (
            <React.Fragment key={`${c.id}-${i}`}>
              <ChevronRight className="size-3" />
              <button type="button" onClick={() => goToCrumb(i)} className="hover:underline truncate max-w-[140px]" title={c.name}>{c.name}</button>
            </React.Fragment>
          ))}
        </div>

        <ScrollArea className="h-72 rounded border">
          <div className="p-1">
            {loading ? (
              <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t("Caricamento…", "Loading…", "Chargement…", "Cargando…", "Wird geladen…")}
              </div>
            ) : folders.length === 0 ? (
              <p className="text-xs text-muted-foreground italic p-3">
                {t("Nessuna sotto-cartella.", "No sub-folders.", "Aucun sous-dossier.", "Sin subcarpetas.", "Keine Unterordner.")}
              </p>
            ) : (
              folders.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => enterFolder(entry)}
                  disabled={loading}
                  className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary/50 focus-visible:bg-secondary/70 focus-visible:outline-none disabled:opacity-50"
                >
                  <Folder className="size-3.5 text-primary shrink-0" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
          </Button>
          <Button onClick={pickCurrent} disabled={loading}>
            <FolderOpen className="size-3.5 mr-1.5" />
            {t("Usa questa cartella", "Use this folder", "Utiliser ce dossier", "Usar esta carpeta", "Diesen Ordner verwenden")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
