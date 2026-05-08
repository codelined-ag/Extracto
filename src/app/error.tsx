"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            An unexpected error broke this view. Try again, or reload the page.
          </p>
        </div>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground/80">ref {error.digest}</p>
        ) : null}
        <div className="flex gap-2">
          <Button onClick={() => reset()} size="sm">Try again</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
          >
            Reload page
          </Button>
        </div>
      </div>
    </div>
  );
}
