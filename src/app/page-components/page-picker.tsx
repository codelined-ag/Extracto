"use client";

import * as React from "react";

import type { Translator } from "@/app/page-components/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";

export interface PagePickerProps {
  pagePreviews: string[];
  selected: number[];
  onChange: (next: number[]) => void;
  t: Translator;
  fileName: string;
  isLoading?: boolean;
}

function parseRangeExpression(expr: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of expr.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const range = piece.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Math.max(1, Math.min(max, parseInt(range[1], 10)));
      const end = Math.max(1, Math.min(max, parseInt(range[2], 10)));
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      for (let i = lo; i <= hi; i++) out.add(i);
      continue;
    }
    const single = parseInt(piece, 10);
    if (Number.isInteger(single) && single >= 1 && single <= max) {
      out.add(single);
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

export function PagePicker({
  pagePreviews,
  selected,
  onChange,
  t,
  fileName,
  isLoading,
}: PagePickerProps) {
  const total = pagePreviews.length;
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const allSelected = total > 0 && selected.length === total;
  const noneSelected = selected.length === 0;
  const [rangeInput, setRangeInput] = React.useState("");
  const [enlarged, setEnlarged] = React.useState<number | null>(null);

  const selectAll = () => onChange(Array.from({ length: total }, (_, i) => i + 1));
  const selectNone = () => onChange([]);
  const togglePage = (page: number) => {
    if (selectedSet.has(page)) {
      onChange(selected.filter((p) => p !== page));
    } else {
      onChange([...selected, page].sort((a, b) => a - b));
    }
  };
  const applyRange = () => {
    const parsed = parseRangeExpression(rangeInput, total);
    if (parsed.length > 0) onChange(parsed);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full p-8 text-muted-foreground">
        <div className="animate-pulse text-sm">
          {t("Caricamento anteprime pagine...","Loading page previews...","Chargement des aperçus de pages...","Cargando vistas previas de páginas...","Seitenvorschauen werden geladen...")}
        </div>
      </div>
    );
  }

  if (total <= 1) {
    return (
      <div className="flex flex-col items-center justify-center w-full p-6">
        {pagePreviews[0] ? (
          <img
            src={pagePreviews[0]}
            alt={fileName}
            className="max-w-full max-h-[78vh] object-contain rounded-md shadow-sm"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("Anteprima non disponibile","No preview available","Aucun aperçu disponible","Vista previa no disponible","Keine Vorschau verfügbar")}
          </p>
        )}
      </div>
    );
  }

  if (enlarged !== null) {
    const pageNum = enlarged;
    const idx = pageNum - 1;
    return (
      <div className="flex flex-col w-full h-full min-h-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/40">
          <Button variant="ghost" size="sm" onClick={() => setEnlarged(null)}>
            ← {t("Indietro","Back","Retour","Atrás","Zurück")}
          </Button>
          <div className="text-sm font-medium">
            {t("Pagina","Page","Page","Página","Seite")} {pageNum} / {total}
          </div>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selectedSet.has(pageNum)}
              onChange={() => togglePage(pageNum)}
              className="h-4 w-4 accent-primary"
            />
            {selectedSet.has(pageNum)
              ? t("Selezionata","Selected","Sélectionnée","Seleccionada","Ausgewählt")
              : t("Selezionare","Select","Sélectionner","Seleccionar","Auswählen")}
          </label>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 flex items-center justify-center">
            {pagePreviews[idx] ? (
              <img
                src={pagePreviews[idx]}
                alt={`${fileName} page ${pageNum}`}
                className="max-w-full max-h-[80vh] object-contain rounded-md shadow"
              />
            ) : null}
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/40">
        <span className="text-xs text-muted-foreground mr-1">
          {t("Pagine","Pages","Pages","Páginas","Seiten")}: {selected.length} / {total}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={selectAll}
          disabled={allSelected}
        >
          {t("Tutte","All","Toutes","Todas","Alle")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={selectNone}
          disabled={noneSelected}
        >
          {t("Nessuna","None","Aucune","Ninguna","Keine")}
        </Button>
        <div className="flex items-center gap-1 ml-auto">
          <Input
            value={rangeInput}
            onChange={(e) => setRangeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyRange();
              }
            }}
            placeholder="1-5,7,10"
            className="h-7 text-xs w-32"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={applyRange}
            disabled={!rangeInput.trim()}
          >
            {t("Applica","Apply","Appliquer","Aplicar","Anwenden")}
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-3">
          {pagePreviews.map((src, i) => {
            const pageNum = i + 1;
            const isSelected = selectedSet.has(pageNum);
            return (
              <button
                key={pageNum}
                type="button"
                onClick={() => togglePage(pageNum)}
                onDoubleClick={() => setEnlarged(pageNum)}
                className={`relative group rounded-md overflow-hidden border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isSelected
                    ? "border-primary shadow-sm"
                    : "border-transparent hover:border-muted-foreground/40 opacity-70 hover:opacity-100"
                }`}
                aria-pressed={isSelected}
                aria-label={`${t("Pagina","Page","Page","Página","Seite")} ${pageNum}`}
              >
                <img
                  src={src}
                  alt={`${fileName} page ${pageNum}`}
                  className="w-full h-full object-cover bg-muted aspect-[1/1.4]"
                />
                <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-background/80 text-[10px] font-medium">
                  {pageNum}
                </div>
                <div
                  className={`absolute top-1 right-1 h-5 w-5 rounded border-2 flex items-center justify-center ${
                    isSelected
                      ? "bg-primary border-primary text-primary-foreground"
                      : "bg-background/80 border-muted-foreground/40"
                  }`}
                >
                  {isSelected ? (
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M2 6 L5 9 L10 3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </div>
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnlarged(pageNum);
                  }}
                  className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-background/80 text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity cursor-zoom-in"
                >
                  ⤢
                </span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
