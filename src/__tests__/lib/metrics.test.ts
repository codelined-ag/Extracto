import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The module-level `counters` Map is shared state. We use vi.resetModules() +
// dynamic import so each describe block (or test) gets a freshly-initialized
// module with an empty Map.

async function freshMetrics() {
  vi.resetModules();
  return import("@/lib/background/metrics");
}

afterEach(() => {
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// incrementCounter
// ---------------------------------------------------------------------------
describe("incrementCounter — basic accumulation", () => {
  it("creates a counter entry and sets total to 1 on first call", async () => {
    const { incrementCounter, getCounters } = await freshMetrics();
    incrementCounter("my_counter");
    const entry = getCounters().get("my_counter");
    expect(entry).toBeDefined();
    expect(entry!.total).toBe(1);
  });

  it("accumulates total across multiple calls", async () => {
    const { incrementCounter, getCounters } = await freshMetrics();
    incrementCounter("my_counter");
    incrementCounter("my_counter");
    incrementCounter("my_counter");
    expect(getCounters().get("my_counter")!.total).toBe(3);
  });

  it("custom delta is applied to total", async () => {
    const { incrementCounter, getCounters } = await freshMetrics();
    incrementCounter("my_counter", undefined, 5);
    expect(getCounters().get("my_counter")!.total).toBe(5);
  });

  it("custom delta accumulates correctly", async () => {
    const { incrementCounter, getCounters } = await freshMetrics();
    incrementCounter("my_counter", undefined, 3);
    incrementCounter("my_counter", undefined, 7);
    expect(getCounters().get("my_counter")!.total).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// incrementCounter — label handling
// ---------------------------------------------------------------------------
describe("incrementCounter — label handling", () => {
  it("increments the correct byLabel bucket", async () => {
    const { incrementCounter, getCounters } = await freshMetrics();
    incrementCounter("my_counter", { provider: "ollama" });
    const entry = getCounters().get("my_counter")!;
    // buildLabelKey produces `provider="ollama"`
    expect(entry.byLabel.get('provider="ollama"')).toBe(1);
  });

  it("labels sort alphabetically by key", async () => {
    const { incrementCounter, getCounters } = await freshMetrics();
    incrementCounter("my_counter", { z_key: "z", a_key: "a" });
    const entry = getCounters().get("my_counter")!;
    // sorted: a_key first, then z_key
    const labelKey = 'a_key="a",z_key="z"';
    expect(entry.byLabel.get(labelKey)).toBe(1);
  });

  it("different label combos produce distinct byLabel entries", async () => {
    const { incrementCounter, getCounters } = await freshMetrics();
    incrementCounter("my_counter", { status: "ok" });
    incrementCounter("my_counter", { status: "error" });
    const entry = getCounters().get("my_counter")!;
    expect(entry.total).toBe(2);
    expect(entry.byLabel.get('status="ok"')).toBe(1);
    expect(entry.byLabel.get('status="error"')).toBe(1);
  });

  it("no-label call uses empty string as byLabel key", async () => {
    const { incrementCounter, getCounters } = await freshMetrics();
    incrementCounter("my_counter");
    const entry = getCounters().get("my_counter")!;
    expect(entry.byLabel.get("")).toBe(1);
  });

  it("undefined/null/empty label values are filtered out", async () => {
    const { incrementCounter, getCounters } = await freshMetrics();
    incrementCounter("my_counter", { a: "", b: "keep" });
    const entry = getCounters().get("my_counter")!;
    // "a" is filtered; only b remains
    expect(entry.byLabel.has('b="keep"')).toBe(true);
    expect(entry.byLabel.has('a=""')).toBe(false);
  });

  it("byLabel accumulates with custom delta", async () => {
    const { incrementCounter, getCounters } = await freshMetrics();
    incrementCounter("my_counter", { x: "1" }, 4);
    incrementCounter("my_counter", { x: "1" }, 6);
    const entry = getCounters().get("my_counter")!;
    expect(entry.byLabel.get('x="1"')).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------
describe("recordProviderError", () => {
  it("emits extracto_provider_errors_total with provider label", async () => {
    const { recordProviderError, getCounters } = await freshMetrics();
    recordProviderError("ollama");
    const entry = getCounters().get("extracto_provider_errors_total");
    expect(entry).toBeDefined();
    expect(entry!.total).toBe(1);
    expect(entry!.byLabel.get('provider="ollama"')).toBe(1);
  });

  it("accumulates across multiple providers", async () => {
    const { recordProviderError, getCounters } = await freshMetrics();
    recordProviderError("ollama");
    recordProviderError("mistral");
    recordProviderError("ollama");
    const entry = getCounters().get("extracto_provider_errors_total")!;
    expect(entry.total).toBe(3);
    expect(entry.byLabel.get('provider="ollama"')).toBe(2);
    expect(entry.byLabel.get('provider="mistral"')).toBe(1);
  });
});

describe("recordCacheHit", () => {
  it("emits extracto_cache_hits_total with cache label", async () => {
    const { recordCacheHit, getCounters } = await freshMetrics();
    recordCacheHit("thumbnail");
    const entry = getCounters().get("extracto_cache_hits_total");
    expect(entry).toBeDefined();
    expect(entry!.total).toBe(1);
    expect(entry!.byLabel.get('cache="thumbnail"')).toBe(1);
  });
});

describe("recordCacheMiss", () => {
  it("emits extracto_cache_misses_total with cache label", async () => {
    const { recordCacheMiss, getCounters } = await freshMetrics();
    recordCacheMiss("thumbnail");
    const entry = getCounters().get("extracto_cache_misses_total");
    expect(entry).toBeDefined();
    expect(entry!.total).toBe(1);
    expect(entry!.byLabel.get('cache="thumbnail"')).toBe(1);
  });
});

describe("recordWebhookDelivery", () => {
  it("emits extracto_webhook_deliveries_total with status=success", async () => {
    const { recordWebhookDelivery, getCounters } = await freshMetrics();
    recordWebhookDelivery("success");
    const entry = getCounters().get("extracto_webhook_deliveries_total");
    expect(entry).toBeDefined();
    expect(entry!.total).toBe(1);
    expect(entry!.byLabel.get('status="success"')).toBe(1);
  });

  it("emits extracto_webhook_deliveries_total with status=failure", async () => {
    const { recordWebhookDelivery, getCounters } = await freshMetrics();
    recordWebhookDelivery("failure");
    const entry = getCounters().get("extracto_webhook_deliveries_total");
    expect(entry!.byLabel.get('status="failure"')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// formatPrometheus
// ---------------------------------------------------------------------------
describe("formatPrometheus", () => {
  it("emits # TYPE header and bare name line for a no-label counter", async () => {
    const { incrementCounter, getCounters, formatPrometheus } = await freshMetrics();
    incrementCounter("my_total", undefined, 7);
    const output = formatPrometheus(getCounters());
    expect(output).toContain("# TYPE my_total counter");
    expect(output).toContain("my_total 7");
  });

  it("emits name{label=value} N for a labelled counter", async () => {
    const { incrementCounter, getCounters, formatPrometheus } = await freshMetrics();
    incrementCounter("my_total", { provider: "ollama" }, 3);
    const output = formatPrometheus(getCounters());
    expect(output).toContain("# TYPE my_total counter");
    expect(output).toContain('my_total{provider="ollama"} 3');
  });

  it("output ends with a newline", async () => {
    const { incrementCounter, getCounters, formatPrometheus } = await freshMetrics();
    incrementCounter("x");
    const output = formatPrometheus(getCounters());
    expect(output.endsWith("\n")).toBe(true);
  });

  it("multiple label combinations each get their own line", async () => {
    const { incrementCounter, getCounters, formatPrometheus } = await freshMetrics();
    incrementCounter("my_total", { status: "ok" }, 2);
    incrementCounter("my_total", { status: "error" }, 1);
    const output = formatPrometheus(getCounters());
    expect(output).toContain('my_total{status="ok"} 2');
    expect(output).toContain('my_total{status="error"} 1');
  });

  it("multiple counters each get their own TYPE header", async () => {
    const { incrementCounter, getCounters, formatPrometheus } = await freshMetrics();
    incrementCounter("counter_a");
    incrementCounter("counter_b");
    const output = formatPrometheus(getCounters());
    expect(output).toContain("# TYPE counter_a counter");
    expect(output).toContain("# TYPE counter_b counter");
  });

  it("empty counters map produces only a trailing newline", async () => {
    const { formatPrometheus } = await freshMetrics();
    const output = formatPrometheus(new Map());
    expect(output).toBe("\n");
  });

  it("no-label counter emits bare name (no curly braces)", async () => {
    const { incrementCounter, getCounters, formatPrometheus } = await freshMetrics();
    incrementCounter("bare_counter");
    const output = formatPrometheus(getCounters());
    // Should NOT contain curly braces for this counter
    expect(output).not.toMatch(/bare_counter\{/);
    expect(output).toContain("bare_counter 1");
  });
});
