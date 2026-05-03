"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}

export function ToggleRow({ label, hint, checked, onCheckedChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 surface-soft rounded-xl px-3.5 py-2.5">
      <div className="min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        {hint ? (
          <p className="text-[11px] text-muted-foreground/80 leading-snug mt-0.5">{hint}</p>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
