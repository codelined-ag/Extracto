"use client";

import * as React from "react";

import { useToast } from "@/hooks/use-toast";
import type { TagColor, TagListItem, Translator } from "@/app/page-components/types";

export interface TagsState {
  tags: TagListItem[];
  isLoading: boolean;
  loadTags: () => Promise<void>;
  createTag: (name: string, color?: TagColor) => Promise<TagListItem | null>;
  updateTag: (id: string, patch: { name?: string; color?: TagColor }) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  setJobTags: (jobId: string, tagIds: string[]) => Promise<TagListItem[] | null>;
}

export function useTags(t: Translator): TagsState {
  const { toast } = useToast();
  const [tags, setTags] = React.useState<TagListItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const failureToast = React.useCallback(
    (error: unknown, fallback: string) => {
      toast({
        title: t("Operazione tag non riuscita", "Tag operation failed", "Échec de l'opération sur les tags", "Error en operación de etiquetas", "Tag-Aktion fehlgeschlagen"),
        description: error instanceof Error ? error.message : fallback,
        variant: "destructive",
      });
    },
    [t, toast],
  );

  const loadTags = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/tags", { cache: "no-store" });
      if (!res.ok) throw new Error(`Load tags failed (${res.status})`);
      const payload = (await res.json()) as { tags?: TagListItem[] };
      setTags(Array.isArray(payload.tags) ? payload.tags : []);
    } catch (error) {
      failureToast(error, "load failed");
    } finally {
      setIsLoading(false);
    }
  }, [failureToast]);

  const createTag = React.useCallback(
    async (name: string, color: TagColor = "slate"): Promise<TagListItem | null> => {
      try {
        const res = await fetch("/api/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, color }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Create failed (${res.status})`);
        }
        const payload = (await res.json()) as { tag?: TagListItem };
        if (!payload.tag) throw new Error("create returned no tag");
        await loadTags();
        return payload.tag;
      } catch (error) {
        failureToast(error, "create failed");
        return null;
      }
    },
    [failureToast, loadTags],
  );

  const updateTag = React.useCallback(
    async (id: string, patch: { name?: string; color?: TagColor }) => {
      try {
        const res = await fetch(`/api/tags/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Update failed (${res.status})`);
        }
        await loadTags();
      } catch (error) {
        failureToast(error, "update failed");
      }
    },
    [failureToast, loadTags],
  );

  const deleteTag = React.useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Delete failed (${res.status})`);
        }
        await loadTags();
      } catch (error) {
        failureToast(error, "delete failed");
      }
    },
    [failureToast, loadTags],
  );

  const setJobTags = React.useCallback(
    async (jobId: string, tagIds: string[]): Promise<TagListItem[] | null> => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/tags`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tagIds }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Tagging failed (${res.status})`);
        }
        const payload = (await res.json()) as { tags?: TagListItem[] };
        return Array.isArray(payload.tags) ? payload.tags : [];
      } catch (error) {
        failureToast(error, "tagging failed");
        return null;
      }
    },
    [failureToast],
  );

  return {
    tags,
    isLoading,
    loadTags,
    createTag,
    updateTag,
    deleteTag,
    setJobTags,
  };
}
