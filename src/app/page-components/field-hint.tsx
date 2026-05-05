"use client";

import * as React from "react";
import { InfoIcon } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function HintLabel({
  children,
  hint,
  className,
  htmlFor,
}: {
  children: React.ReactNode;
  hint: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <Label htmlFor={htmlFor} className={cn("text-xs uppercase tracking-wider text-muted-foreground/80 inline-flex items-center gap-1", className)}>
      <span>{children}</span>
      <FieldHint>{hint}</FieldHint>
    </Label>
  );
}

export function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label="More information"
          className="ml-1 inline-flex items-center text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-help align-middle"
          onClick={(e) => e.stopPropagation()}
        >
          <InfoIcon size={11} aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-xs text-[12px] leading-relaxed normal-case">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
