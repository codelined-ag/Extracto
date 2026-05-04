"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type AccordionContextValue = {
  open: string | null;
  setOpen: (next: string | null) => void;
};

const AccordionContext = React.createContext<AccordionContextValue | null>(null);

export interface SettingsAccordionProps {
  defaultOpen?: string | null;
  value?: string | null;
  onValueChange?: (next: string | null) => void;
  className?: string;
  children: React.ReactNode;
}

export function SettingsAccordion({ defaultOpen = null, value, onValueChange, className, children }: SettingsAccordionProps) {
  const [internal, setInternal] = React.useState<string | null>(defaultOpen);
  const isControlled = value !== undefined;
  const open = isControlled ? value : internal;
  const setOpen = React.useCallback(
    (next: string | null) => {
      if (!isControlled) setInternal(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );
  const ctx = React.useMemo<AccordionContextValue>(() => ({ open, setOpen }), [open, setOpen]);
  return (
    <AccordionContext.Provider value={ctx}>
      <div className={className ?? "space-y-2"}>{children}</div>
    </AccordionContext.Provider>
  );
}

export interface SettingsAccordionItemProps {
  value: string;
  title: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}

export function SettingsAccordionItem({ value, title, hint, right, children }: SettingsAccordionItemProps) {
  const ctx = React.useContext(AccordionContext);
  if (!ctx) throw new Error("SettingsAccordionItem must be used inside SettingsAccordion");
  const isOpen = ctx.open === value;
  return (
    <Collapsible
      open={isOpen}
      onOpenChange={(next) => ctx.setOpen(next ? value : null)}
      className="rounded-xl border border-foreground/10 overflow-hidden bg-card/30 data-[state=open]:bg-card/60 transition-colors"
    >
      <div className="flex items-center gap-2 pr-3">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group flex-1 flex items-center justify-between gap-3 px-4 py-3 text-left rounded-xl hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <div className="min-w-0">
              <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
              {hint ? (
                <p className="text-[12px] text-muted-foreground/90 leading-relaxed mt-0.5 line-clamp-2">{hint}</p>
              ) : null}
            </div>
            <ChevronDownIcon
              size={14}
              className="shrink-0 text-muted-foreground/70 transition-transform duration-200 group-data-[state=open]:rotate-180"
            />
          </button>
        </CollapsibleTrigger>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
        <div className="px-4 pb-4 pt-3 space-y-3 hairline-t">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
