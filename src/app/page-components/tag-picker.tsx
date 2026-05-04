"use client";

import * as React from "react";
import { Check, Pencil, Plus, Tag as TagIcon, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TAG_COLOR_OPTIONS, tagChipClass, tagSwatchClass } from "@/app/page-components/tag-utils";
import type {
  TagColor,
  TagListItem,
  TagSummary,
  Translator,
} from "@/app/page-components/types";

export interface TagPickerProps {
  t: Translator;
  available: TagListItem[];
  selected: TagSummary[];
  onChange: (tagIds: string[]) => void;
  onCreate: (name: string, color: TagColor) => Promise<TagListItem | null>;
  onUpdate?: (id: string, patch: { name?: string; color?: TagColor }) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  disabled?: boolean;
}

export function TagPicker({
  t,
  available,
  selected,
  onChange,
  onCreate,
  onUpdate,
  onDelete,
  disabled,
}: TagPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [draftName, setDraftName] = React.useState("");
  const [draftColor, setDraftColor] = React.useState<TagColor>("slate");
  const [busy, setBusy] = React.useState(false);
  const [renameId, setRenameId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");

  const selectedIds = React.useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

  const filtered = React.useMemo(() => {
    const q = draftName.trim().toLowerCase();
    if (!q) return available;
    return available.filter((tag) => tag.name.toLowerCase().includes(q));
  }, [available, draftName]);

  const exactMatch = React.useMemo(() => {
    const q = draftName.trim().toLowerCase();
    if (!q) return null;
    return available.find((tag) => tag.name.toLowerCase() === q) ?? null;
  }, [available, draftName]);

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  const handleCreate = async () => {
    const name = draftName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await onCreate(name, draftColor);
      if (created && !selectedIds.has(created.id)) {
        onChange([...Array.from(selectedIds), created.id]);
      }
      setDraftName("");
      setDraftColor("slate");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((tag) => (
        <span
          key={tag.id}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
            tagChipClass(tag.color),
          )}
        >
          {tag.name}
          {!disabled ? (
            <button
              type="button"
              onClick={() => toggle(tag.id)}
              className="rounded-full hover:bg-black/10 dark:hover:bg-white/10 p-0.5"
              aria-label={t("Rimuovi tag", "Remove tag", "Retirer le tag", "Quitar etiqueta", "Tag entfernen")}
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={disabled}
          >
            <TagIcon className="size-3 mr-1" />
            {t("Tag", "Tags", "Tags", "Etiquetas", "Tags")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="p-2 border-b">
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={t(
                "Cerca o crea tag",
                "Search or create tag",
                "Rechercher ou créer un tag",
                "Buscar o crear etiqueta",
                "Tag suchen oder erstellen",
              )}
              maxLength={32}
              className="h-8 text-xs"
            />
            {draftName.trim() && !exactMatch ? (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-center gap-1">
                  {TAG_COLOR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDraftColor(c)}
                      className={cn(
                        "size-4 rounded-full ring-offset-1",
                        tagSwatchClass(c),
                        draftColor === c ? "ring-2 ring-foreground" : "ring-0",
                      )}
                      aria-label={c}
                    />
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="ml-auto h-7"
                  disabled={busy}
                  onClick={handleCreate}
                >
                  <Plus className="size-3 mr-1" />
                  {t("Crea", "Create", "Créer", "Crear", "Erstellen")}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {available.length === 0
                  ? t(
                      "Nessun tag. Scrivi un nome e premi Crea.",
                      "No tags yet. Type a name and press Create.",
                      "Aucun tag. Tapez un nom et créez-le.",
                      "Sin etiquetas. Escribe un nombre y crea una.",
                      "Noch keine Tags. Namen eingeben und erstellen.",
                    )
                  : t("Nessun risultato", "No matches", "Aucun résultat", "Sin coincidencias", "Keine Treffer")}
              </div>
            ) : (
              filtered.map((tag) => {
                const isSelected = selectedIds.has(tag.id);
                const isRenaming = renameId === tag.id;
                const commitRename = async () => {
                  const next = renameDraft.trim();
                  if (!next || !onUpdate || next === tag.name) {
                    setRenameId(null);
                    return;
                  }
                  await onUpdate(tag.id, { name: next });
                  setRenameId(null);
                };
                return (
                  <div key={tag.id} className="flex items-center gap-1 px-2 py-0.5">
                    {isRenaming ? (
                      <div className="flex-1 flex items-center gap-2 px-2 py-1">
                        <span className={cn("size-2.5 rounded-full", tagSwatchClass(tag.color))} />
                        <Input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => void commitRename()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitRename();
                            if (e.key === "Escape") setRenameId(null);
                          }}
                          maxLength={32}
                          className="h-6 text-xs"
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggle(tag.id)}
                        className={cn(
                          "flex-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                          "hover:bg-accent",
                        )}
                      >
                        <span className={cn("size-2.5 rounded-full", tagSwatchClass(tag.color))} />
                        <span className="flex-1 text-left truncate">{tag.name}</span>
                        {typeof tag.jobCount === "number" ? (
                          <span className="text-[10px] text-muted-foreground tabular">{tag.jobCount}</span>
                        ) : null}
                        {isSelected ? <Check className="size-3" /> : null}
                      </button>
                    )}
                    {onUpdate && !isRenaming ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRenameId(tag.id);
                          setRenameDraft(tag.name);
                        }}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                        aria-label={t("Rinomina tag", "Rename tag", "Renommer le tag", "Renombrar etiqueta", "Tag umbenennen")}
                      >
                        <Pencil className="size-3" />
                      </button>
                    ) : null}
                    {onDelete && !isRenaming ? (
                      <button
                        type="button"
                        onClick={() => { void onDelete(tag.id); }}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        aria-label={t("Elimina tag", "Delete tag", "Supprimer le tag", "Eliminar etiqueta", "Tag löschen")}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

        </PopoverContent>
      </Popover>
    </div>
  );
}
