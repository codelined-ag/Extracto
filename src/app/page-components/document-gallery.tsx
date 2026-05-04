"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  LayoutGridIcon,
  ListIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import type { Translator } from "@/app/page-components/types";

export interface DocumentGalleryProps {
  pagePreviews: string[];
  selected: number[];
  onChange: (next: number[]) => void;
  t: Translator;
  fileName: string;
  isLoading?: boolean;
}

type ViewMode = "gallery" | "list";

export function DocumentGallery({
  pagePreviews,
  selected,
  onChange,
  t,
  fileName,
  isLoading,
}: DocumentGalleryProps) {
  const total = pagePreviews.length;
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const [viewMode, setViewMode] = React.useState<ViewMode>("gallery");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const thumbStripRef = React.useRef<HTMLDivElement | null>(null);

  const safeActiveIndex = activeIndex >= total ? Math.max(0, total - 1) : activeIndex;
  React.useEffect(() => {
    if (safeActiveIndex !== activeIndex) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveIndex(safeActiveIndex);
    }
  }, [activeIndex, safeActiveIndex]);

  React.useEffect(() => {
    if (viewMode !== "gallery") return;
    const strip = thumbStripRef.current;
    if (!strip) return;
    const target = strip.querySelector<HTMLElement>(`[data-thumb-index="${activeIndex}"]`);
    if (target) target.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeIndex, viewMode]);

  const togglePage = React.useCallback(
    (page: number) => {
      if (selectedSet.has(page)) {
        onChange(selected.filter((p) => p !== page));
      } else {
        onChange([...selected, page].sort((a, b) => a - b));
      }
    },
    [selected, selectedSet, onChange],
  );

  const selectAll = React.useCallback(
    () => onChange(Array.from({ length: total }, (_, i) => i + 1)),
    [onChange, total],
  );
  const selectNone = React.useCallback(() => onChange([]), [onChange]);

  const goPrev = React.useCallback(() => setActiveIndex((i) => Math.max(0, i - 1)), []);
  const goNext = React.useCallback(
    () => setActiveIndex((i) => Math.min(total - 1, i + 1)),
    [total],
  );

  const handleKey = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (viewMode !== "gallery") return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      } else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        togglePage(activeIndex + 1);
      }
    },
    [viewMode, goPrev, goNext, togglePage, activeIndex],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full p-8 text-muted-foreground">
        <div className="animate-pulse text-sm">
          {t(
            "Caricamento anteprime pagine...",
            "Loading page previews...",
            "Chargement des aperçus de pages...",
            "Cargando vistas previas de páginas...",
            "Seitenvorschauen werden geladen...",
          )}
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full p-8 text-muted-foreground">
        <div className="text-sm">
          {t(
            "Nessuna pagina disponibile",
            "No pages available",
            "Aucune page disponible",
            "No hay páginas disponibles",
            "Keine Seiten verfügbar",
          )}
        </div>
      </div>
    );
  }

  const allSelected = selected.length === total;
  const noneSelected = selected.length === 0;
  const activePage = activeIndex + 1;
  const activeIsSelected = selectedSet.has(activePage);

  return (
    <div
      className="flex flex-col h-full min-h-0 outline-none"
      tabIndex={0}
      onKeyDown={handleKey}
      aria-label={t(
        `Anteprima pagine di ${fileName}`,
        `Page preview for ${fileName}`,
        `Aperçu des pages de ${fileName}`,
        `Vista previa de páginas de ${fileName}`,
        `Seitenvorschau für ${fileName}`,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 hairline-b">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-xs text-muted-foreground truncate">{fileName}</div>
          <Badge variant="outline" className="text-[10px]">
            {selected.length}/{total}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={selectAll}
            disabled={allSelected}
          >
            {t("Tutte", "All", "Tout", "Todas", "Alle")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={selectNone}
            disabled={noneSelected}
          >
            {t("Nessuna", "None", "Aucune", "Ninguna", "Keine")}
          </Button>
          <div className="ml-1 inline-flex rounded-md border border-border/60 bg-secondary/50 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("gallery")}
              aria-pressed={viewMode === "gallery"}
              className={cn(
                "inline-flex items-center justify-center rounded-sm px-1.5 py-0.5 text-xs transition-colors",
                viewMode === "gallery"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={t(
                "Vista galleria",
                "Gallery view",
                "Vue galerie",
                "Vista galería",
                "Galerieansicht",
              )}
            >
              <LayoutGridIcon size={13} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              className={cn(
                "inline-flex items-center justify-center rounded-sm px-1.5 py-0.5 text-xs transition-colors",
                viewMode === "list"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={t(
                "Vista lista",
                "List view",
                "Vue liste",
                "Vista lista",
                "Listenansicht",
              )}
            >
              <ListIcon size={13} />
            </button>
          </div>
        </div>
      </div>

      {viewMode === "gallery" ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="relative flex-1 min-h-0 flex items-center justify-center bg-secondary/20 px-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-background/70 hover:bg-background"
              onClick={goPrev}
              disabled={activeIndex === 0}
              aria-label={t("Pagina precedente", "Previous page", "Page précédente", "Página anterior", "Vorherige Seite")}
            >
              <ChevronLeftIcon size={18} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-background/70 hover:bg-background"
              onClick={goNext}
              disabled={activeIndex >= total - 1}
              aria-label={t("Pagina successiva", "Next page", "Page suivante", "Página siguiente", "Nächste Seite")}
            >
              <ChevronRightIcon size={18} />
            </Button>
            <AnimatePresence mode="wait">
              <motion.img
                key={activeIndex}
                src={pagePreviews[activeIndex]}
                alt={`page ${activePage}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="max-h-full max-w-full object-contain rounded-md shadow-md cursor-pointer"
                onClick={() => togglePage(activePage)}
                draggable={false}
              />
            </AnimatePresence>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-background/80 backdrop-blur px-3 py-1 text-[11px]">
              <span className="font-medium">
                {activePage} / {total}
              </span>
              <span className="text-muted-foreground">·</span>
              <button
                type="button"
                onClick={() => togglePage(activePage)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors",
                  activeIsSelected
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/60 hover:bg-secondary",
                )}
              >
                {activeIsSelected ? (
                  <>
                    <CheckIcon size={11} />
                    {t("Selezionata", "Selected", "Sélectionnée", "Seleccionada", "Ausgewählt")}
                  </>
                ) : (
                  t("Seleziona", "Select", "Sélectionner", "Seleccionar", "Auswählen")
                )}
              </button>
            </div>
          </div>
          <div ref={thumbStripRef} className="hairline-t overflow-x-auto custom-scroll px-2 py-2">
            <div className="flex gap-2">
              {pagePreviews.map((preview, i) => {
                const pageNum = i + 1;
                const isActive = i === activeIndex;
                const isSelected = selectedSet.has(pageNum);
                return (
                  <button
                    key={i}
                    type="button"
                    data-thumb-index={i}
                    onClick={() => setActiveIndex(i)}
                    onDoubleClick={() => togglePage(pageNum)}
                    className={cn(
                      "relative shrink-0 rounded-md overflow-hidden transition-all",
                      "border-2",
                      isActive ? "border-primary shadow-md" : "border-transparent",
                      !isSelected && "opacity-55 hover:opacity-90",
                    )}
                    aria-label={t(
                      `Pagina ${pageNum}`,
                      `Page ${pageNum}`,
                      `Page ${pageNum}`,
                      `Página ${pageNum}`,
                      `Seite ${pageNum}`,
                    )}
                  >
                    <img
                      src={preview}
                      alt=""
                      className="h-20 w-auto object-contain bg-background"
                      draggable={false}
                    />
                    <span
                      className={cn(
                        "absolute top-1 right-1 inline-flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-semibold transition-colors",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "bg-background/80 text-muted-foreground border border-border/60",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePage(pageNum);
                      }}
                      role="checkbox"
                      aria-checked={isSelected}
                    >
                      {isSelected ? <CheckIcon size={10} /> : null}
                    </span>
                    <span className="absolute bottom-0 inset-x-0 bg-background/80 text-[9px] font-mono text-center py-0.5">
                      {pageNum}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <ul className="p-2 space-y-1.5">
            {pagePreviews.map((preview, i) => {
              const pageNum = i + 1;
              const isSelected = selectedSet.has(pageNum);
              return (
                <li
                  key={i}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-2 transition-colors",
                    isSelected ? "border-primary/40 bg-primary/5" : "border-border/40 bg-secondary/20",
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    onClick={() => togglePage(pageNum)}
                    className={cn(
                      "shrink-0 inline-flex h-5 w-5 items-center justify-center rounded transition-colors",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "border border-border/60 bg-background hover:bg-secondary",
                    )}
                    aria-label={
                      isSelected
                        ? t("Deseleziona", "Deselect", "Désélectionner", "Deseleccionar", "Abwählen")
                        : t("Seleziona", "Select", "Sélectionner", "Seleccionar", "Auswählen")
                    }
                  >
                    {isSelected ? <CheckIcon size={12} /> : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveIndex(i);
                      setViewMode("gallery");
                    }}
                    className="shrink-0 rounded-md overflow-hidden border border-border/40"
                    aria-label={t(
                      `Apri pagina ${pageNum}`,
                      `Open page ${pageNum}`,
                      `Ouvrir la page ${pageNum}`,
                      `Abrir página ${pageNum}`,
                      `Seite ${pageNum} öffnen`,
                    )}
                  >
                    <img src={preview} alt="" className="h-12 w-12 object-cover" draggable={false} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {t("Pagina", "Page", "Page", "Página", "Seite")} {pageNum}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {isSelected
                        ? t("Inclusa nell'OCR", "Included in OCR", "Incluse dans l'OCR", "Incluida en el OCR", "Im OCR enthalten")
                        : t("Esclusa", "Excluded", "Exclue", "Excluida", "Ausgeschlossen")}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
