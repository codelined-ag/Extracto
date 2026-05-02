"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { CheckIcon } from "@/components/ui/check"
import { ChevronDownIcon } from "@/components/ui/chevron-down"
import { LoaderCircleIcon } from "@/components/ui/loader-circle"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  value: string
  label: string
  hint?: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  triggerClassName?: string
  contentClassName?: string
  disabled?: boolean
  loading?: boolean
  onRefresh?: () => void
  refreshLabel?: string
  allowCustom?: boolean
  ariaLabel?: string
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Select",
  searchPlaceholder = "Search…",
  emptyText = "No results",
  triggerClassName,
  contentClassName,
  disabled,
  loading,
  onRefresh,
  refreshLabel,
  allowCustom = false,
  ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const selected = options.find((o) => o.value === value)
  const display = selected?.label ?? (value && allowCustom ? value : "")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm",
            "bg-secondary text-foreground data-[placeholder]:text-muted-foreground/80",
            "shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--foreground),transparent_92%)]",
            "transition-[box-shadow,background-color,color] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
            "outline-none hover:bg-[color-mix(in_oklab,var(--secondary),var(--accent)_18%)]",
            "focus-visible:shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--primary),transparent_75%),inset_0_1px_0_0_color-mix(in_oklab,var(--foreground),transparent_92%)]",
            "h-10 disabled:opacity-50 disabled:cursor-not-allowed",
            triggerClassName,
          )}
        >
          <span className={cn("truncate text-left", !display && "text-muted-foreground/80")}>
            {display || placeholder}
          </span>
          <ChevronDownIcon size={16} className={cn("inline-flex items-center justify-center text-muted-foreground/70 transition-transform duration-200", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn("p-0 w-[min(28rem,calc(100vw-2rem))]", contentClassName)}
      >
        <CommandPrimitive
          shouldFilter
          className="overflow-hidden rounded-2xl"
        >
          <div className="flex items-center gap-2 px-3 py-2 hairline-b">
            <LoaderCircleIcon size={14} className={cn("inline-flex items-center justify-center text-muted-foreground/60", loading ? "opacity-100" : "opacity-0 size-0")} />
            <CommandPrimitive.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/70 outline-none border-none"
            />
            {onRefresh ? (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); onRefresh(); }}
                disabled={loading}
                className="text-[11px] uppercase tracking-wider text-muted-foreground/70 hover:text-primary transition-colors disabled:opacity-50"
              >
                {refreshLabel ?? "Refresh"}
              </button>
            ) : null}
          </div>
          <CommandPrimitive.List className="max-h-72 overflow-y-auto p-1.5">
            <CommandPrimitive.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              {emptyText}
              {allowCustom && search.trim() ? (
                <button
                  type="button"
                  onClick={() => { onValueChange(search.trim()); setOpen(false); setSearch(""); }}
                  className="block w-full mt-2 text-xs text-primary hover:underline"
                >
                  Use &quot;{search.trim()}&quot;
                </button>
              ) : null}
            </CommandPrimitive.Empty>
            {options.map((option) => {
              const isSelected = option.value === value
              return (
                <CommandPrimitive.Item
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  onSelect={() => {
                    onValueChange(option.value)
                    setOpen(false)
                    setSearch("")
                  }}
                  className={cn(
                    "relative flex cursor-default items-start gap-2 rounded-lg px-2.5 py-2 text-sm",
                    "outline-hidden select-none transition-colors duration-150",
                    "data-[selected=true]:bg-[color-mix(in_oklab,var(--secondary),var(--primary)_18%)] data-[selected=true]:text-foreground",
                    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                  )}
                >
                  <span className="size-4 shrink-0 mt-0.5 inline-flex items-center justify-center text-primary">
                    {isSelected ? <CheckIcon size={16} className="inline-flex" /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{option.label}</div>
                    {option.hint ? <div className="truncate text-[11px] text-muted-foreground/80 mt-0.5">{option.hint}</div> : null}
                  </div>
                </CommandPrimitive.Item>
              )
            })}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  )
}
