"use client";

import * as React from "react";

export interface SettingsSectionProps {
  title: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}

export function SettingsSection({ title, hint, right, children }: SettingsSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {hint ? (
            <p className="text-[12px] text-muted-foreground/90 leading-relaxed mt-0.5">{hint}</p>
          ) : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}
