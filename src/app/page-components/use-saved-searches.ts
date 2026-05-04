"use client";

import * as React from "react";

import { useToast } from "@/hooks/use-toast";
import type { Translator } from "@/app/page-components/types";

export interface SavedSearchFiltersDTO {
  q?: string;
  status?: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  from?: string;
  to?: string;
  tagIds?: string[];
  model?: string;
}

export interface SavedSearchItem {
  id: string;
  name: string;
  filters: SavedSearchFiltersDTO;
  createdAt: string;
  updatedAt: string;
}

export interface SavedSearchesState {
  items: SavedSearchItem[];
  isLoading: boolean;
  load: () => Promise<void>;
  save: (name: string, filters: SavedSearchFiltersDTO) => Promise<SavedSearchItem | null>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useSavedSearches(t: Translator): SavedSearchesState {
  const { toast } = useToast();
  const [items, setItems] = React.useState<SavedSearchItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const failureToast = React.useCallback(
    (error: unknown, fallback: string) => {
      toast({
        title: t(
          "Operazione su ricerca salvata fallita",
          "Saved search operation failed",
          "Échec de l'opération sur la recherche enregistrée",
          "Error en la búsqueda guardada",
          "Aktion an gespeicherter Suche fehlgeschlagen",
        ),
        description: error instanceof Error ? error.message : fallback,
        variant: "destructive",
      });
    },
    [t, toast],
  );

  const load = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/saved-searches", { cache: "no-store" });
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const payload = (await res.json()) as { savedSearches?: SavedSearchItem[] };
      setItems(Array.isArray(payload.savedSearches) ? payload.savedSearches : []);
    } catch (error) {
      failureToast(error, "load failed");
    } finally {
      setIsLoading(false);
    }
  }, [failureToast]);

  const save = React.useCallback(
    async (name: string, filters: SavedSearchFiltersDTO): Promise<SavedSearchItem | null> => {
      try {
        const res = await fetch("/api/saved-searches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, filters }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Save failed (${res.status})`);
        }
        const payload = (await res.json()) as { savedSearch?: SavedSearchItem };
        await load();
        return payload.savedSearch ?? null;
      } catch (error) {
        failureToast(error, "save failed");
        return null;
      }
    },
    [failureToast, load],
  );

  const rename = React.useCallback(
    async (id: string, name: string) => {
      try {
        const res = await fetch(`/api/saved-searches/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Rename failed (${res.status})`);
        }
        await load();
      } catch (error) {
        failureToast(error, "rename failed");
      }
    },
    [failureToast, load],
  );

  const remove = React.useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Delete failed (${res.status})`);
        await load();
      } catch (error) {
        failureToast(error, "delete failed");
      }
    },
    [failureToast, load],
  );

  return { items, isLoading, load, save, rename, remove };
}
