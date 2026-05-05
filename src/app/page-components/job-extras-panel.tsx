"use client";

import * as React from "react";
import { ClipboardList, Sigma } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

import type { Translator } from "@/app/page-components/types";

interface FormFieldEntry {
  field: string;
  value: string | number | boolean | null;
  page?: number;
}

interface FormFieldsResponse {
  jobId: string;
  documentType: string | null;
  source: "result.structured.fields.form" | "page-fields" | "absent";
  fields: FormFieldEntry[];
  byField: Record<string, FormFieldEntry["value"]>;
}

interface EquationEntry {
  kind: "display" | "inline";
  latex: string;
  startOffset: number;
  endOffset: number;
}

interface EquationsResponse {
  jobId: string;
  display: EquationEntry[];
  inline: EquationEntry[];
  count: number;
}

export interface JobExtrasPanelProps {
  jobId: string;
  documentPreset: string | undefined;
  t: Translator;
}

export function JobExtrasPanel({ jobId, documentPreset, t }: JobExtrasPanelProps) {
  const [fields, setFields] = React.useState<FormFieldsResponse | null>(null);
  const [equations, setEquations] = React.useState<EquationsResponse | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [fr, er] = await Promise.all([
          fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}/form-fields`),
          fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}/equations`),
        ]);
        if (cancelled) return;
        if (fr.ok) setFields((await fr.json()) as FormFieldsResponse);
        if (er.ok) setEquations((await er.json()) as EquationsResponse);
      } catch { /* extras are best-effort; silently skip */ }
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  const showFields = fields && fields.fields.length > 0;
  const showEqs = equations && equations.count > 0;

  if (!showFields && !showEqs) return null;

  return (
    <div className="space-y-3">
      {showFields ? (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="size-3.5 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider">
                {t("Campi modulo", "Form fields", "Champs de formulaire", "Campos del formulario", "Formularfelder")}
              </h4>
              <Badge variant="outline" className="text-[10px] py-0 px-1">{fields.fields.length}</Badge>
              {documentPreset && documentPreset !== "form" ? (
                <Badge variant="outline" className="text-[10px] py-0 px-1 text-muted-foreground">
                  {t("preset diverso", "different preset", "preset différent", "preset diferente", "anderes Preset")}
                </Badge>
              ) : null}
            </div>
            <div className="space-y-1 text-xs max-h-60 overflow-y-auto">
              {fields.fields.map((f, i) => (
                <div key={`${f.field}-${i}`} className="flex items-baseline justify-between gap-3 hairline-t pt-1 first:pt-0 first:hairline-none">
                  <span className="font-medium truncate">{f.field}</span>
                  <span className="text-muted-foreground text-right truncate" title={String(f.value ?? "")}>
                    {f.value === null ? "(empty)" : String(f.value)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showEqs ? (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Sigma className="size-3.5 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider">
                {t("Equazioni LaTeX", "LaTeX equations", "Équations LaTeX", "Ecuaciones LaTeX", "LaTeX-Gleichungen")}
              </h4>
              <Badge variant="outline" className="text-[10px] py-0 px-1">{equations.count}</Badge>
              <span className="text-[10px] text-muted-foreground">
                {equations.display.length} display · {equations.inline.length} inline
              </span>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {[...equations.display, ...equations.inline].slice(0, 50).map((eq, i) => (
                <div key={`${eq.startOffset}-${i}`} className="space-y-0.5">
                  <Badge variant="outline" className="text-[10px] py-0 px-1">{eq.kind}</Badge>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-secondary/30 rounded p-1.5">
                    {eq.latex}
                  </pre>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
