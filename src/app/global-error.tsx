"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          padding: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fbf7f0",
          color: "#1d1813",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            padding: 24,
            borderRadius: 12,
            border: "1px solid #d6cdbe",
            backgroundColor: "#fff",
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>The app crashed</h2>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "#6b6356" }}>
            A render error broke the root. Try recovering, or reload.
          </p>
          {error.digest ? (
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "#6b6356", fontFamily: "monospace" }}>
              ref {error.digest}
            </p>
          ) : null}
          <button
            onClick={() => reset()}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #1d1813",
              background: "#1d1813",
              color: "#fbf7f0",
              cursor: "pointer",
              fontSize: 14,
              marginRight: 8,
            }}
          >
            Try again
          </button>
          <button
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #d6cdbe",
              background: "transparent",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Reload page
          </button>
        </div>
      </body>
    </html>
  );
}
