"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

export const MARKDOWN_PROSE_CLASS = [
  "prose prose-sm dark:prose-invert max-w-none",
  "prose-headings:tracking-tight prose-headings:font-semibold",
  "prose-h1:mt-0 prose-h1:mb-3 prose-h2:mt-6 prose-h2:mb-2 prose-h3:mt-4 prose-h3:mb-2",
  "prose-p:my-2.5 prose-li:my-0.5",
  "prose-pre:bg-muted prose-pre:text-foreground prose-pre:rounded-xl prose-pre:p-3",
  "prose-code:before:hidden prose-code:after:hidden prose-code:bg-muted prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em]",
  "prose-blockquote:border-l-primary/40",
  "prose-table:my-3 prose-thead:border-b prose-thead:border-foreground/15 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-td:border-b prose-td:border-foreground/10",
  "break-words [overflow-wrap:anywhere]",
  "[&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:break-words",
].join(" ");

export interface MarkdownViewProps {
  source: string;
  className?: string;
}

export function MarkdownView({ source, className }: MarkdownViewProps) {
  return (
    <div className={cn(MARKDOWN_PROSE_CLASS, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}
