"use client";

import * as React from "react";

import { useToast } from "@/hooks/use-toast";
import { getMarkdownFromJsonPayload, getStructuredJsonPayload } from "@/app/page-utils";
import type {
  HistoryJobDetail,
  HistoryJobSummary,
  Translator,
} from "@/app/page-components/types";

export interface HistoryState {
  jobs: HistoryJobSummary[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedJob: HistoryJobDetail | null;
  selectedMarkdown: string;
  selectedStructuredJson: unknown;
  isLoadingJobs: boolean;
  isLoadingDetail: boolean;
  isDeleting: boolean;
  loadJobs: () => Promise<void>;
  loadDetail: (jobId: string) => Promise<void>;
  deleteSelected: () => Promise<void>;
  resetSelection: () => void;
}

/**
 * Owns the history dialog's data fetching + selection state. Lifts the
 * 4 useState slots, 4 callbacks, and 2 derived selectors out of the
 * page.tsx workspace component into a single typed surface.
 */
export function useHistory(t: Translator): HistoryState {
  const { toast } = useToast();

  const [jobs, setJobs] = React.useState<HistoryJobSummary[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedJob, setSelectedJob] = React.useState<HistoryJobDetail | null>(null);
  const [isLoadingJobs, setIsLoadingJobs] = React.useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const loadJobs = React.useCallback(async () => {
    setIsLoadingJobs(true);
    try {
      const response = await fetch("/api/jobs?limit=100", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Failed to load history (${response.status})`);
      }

      const payload = (await response.json()) as { jobs?: HistoryJobSummary[] };
      const next = Array.isArray(payload.jobs) ? payload.jobs : [];
      setJobs(next);
      if (next.length > 0) {
        setSelectedId((current) =>
          current && next.some((job) => job.id === current) ? current : next[0].id,
        );
      } else {
        setSelectedId(null);
        setSelectedJob(null);
      }
    } catch (error) {
      toast({
        title: t(
          "Caricamento cronologia non riuscito",
          "History load failed",
          "Échec du chargement de l'historique",
          "Error al cargar historial",
          "Verlauf laden fehlgeschlagen",
        ),
        description:
          error instanceof Error
            ? error.message
            : t(
                "Impossibile caricare la cronologia OCR",
                "Unable to load OCR history",
                "Impossible de charger l'historique OCR",
                "No se pudo cargar el historial de OCR",
                "OCR-Verlauf konnte nicht geladen werden",
              ),
        variant: "destructive",
      });
    } finally {
      setIsLoadingJobs(false);
    }
  }, [t, toast]);

  const loadDetail = React.useCallback(
    async (jobId: string) => {
      setIsLoadingDetail(true);
      try {
        const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || `Failed to load run (${response.status})`);
        }
        const payload = (await response.json()) as { job?: HistoryJobDetail };
        if (!payload.job) {
          throw new Error("Run not found");
        }
        setSelectedJob(payload.job);
      } catch (error) {
        setSelectedJob(null);
        toast({
          title: t(
            "Caricamento esecuzione non riuscito",
            "Run load failed",
            "Échec du chargement de l'exécution",
            "Error al cargar la ejecución",
            "Lauf laden fehlgeschlagen",
          ),
          description:
            error instanceof Error
              ? error.message
              : t(
                  "Impossibile caricare l'esecuzione OCR",
                  "Unable to load OCR run",
                  "Impossible de charger l'exécution OCR",
                  "No se pudo cargar la ejecución OCR",
                  "OCR-Lauf konnte nicht geladen werden",
                ),
          variant: "destructive",
        });
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [t, toast],
  );

  const deleteSelected = React.useCallback(async () => {
    if (!selectedId) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/jobs/${selectedId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Delete failed (${response.status})`);
      }

      setSelectedJob(null);
      await loadJobs();

      toast({
        title: t(
          "Esecuzione eliminata",
          "Run deleted",
          "Exécution supprimée",
          "Ejecución eliminada",
          "Lauf gelöscht",
        ),
        description: t(
          "Esecuzione OCR rimossa dalla cronologia",
          "Past OCR run removed from history",
          "Exécution OCR retirée de l'historique",
          "Ejecución de OCR eliminada del historial",
          "OCR-Lauf aus Verlauf entfernt",
        ),
      });
    } catch (error) {
      toast({
        title: t(
          "Eliminazione non riuscita",
          "Delete failed",
          "Échec de la suppression",
          "Error al eliminar",
          "Löschen fehlgeschlagen",
        ),
        description:
          error instanceof Error
            ? error.message
            : t(
                "Impossibile eliminare l'esecuzione OCR",
                "Unable to delete OCR run",
                "Impossible de supprimer l'exécution OCR",
                "No se pudo eliminar la ejecución OCR",
                "OCR-Lauf konnte nicht gelöscht werden",
              ),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  }, [selectedId, loadJobs, t, toast]);

  const resetSelection = React.useCallback(() => {
    setSelectedId(null);
    setSelectedJob(null);
  }, []);

  const selectedMarkdown = selectedJob
    ? getMarkdownFromJsonPayload(selectedJob.result, selectedJob.extractedText || "")
    : "";
  const selectedStructuredJson = selectedJob ? getStructuredJsonPayload(selectedJob.result) : null;

  return {
    jobs,
    selectedId,
    setSelectedId,
    selectedJob,
    selectedMarkdown,
    selectedStructuredJson,
    isLoadingJobs,
    isLoadingDetail,
    isDeleting,
    loadJobs,
    loadDetail,
    deleteSelected,
    resetSelection,
  };
}
