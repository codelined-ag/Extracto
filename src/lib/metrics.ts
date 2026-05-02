interface CounterEntry {
  total: number;
  byLabel: Map<string, number>;
}

const counters = new Map<string, CounterEntry>();

function getOrCreateCounter(name: string): CounterEntry {
  let entry = counters.get(name);
  if (!entry) {
    entry = { total: 0, byLabel: new Map() };
    counters.set(name, entry);
  }
  return entry;
}

function buildLabelKey(labels?: Record<string, string>): string {
  if (!labels) return "";
  const entries = Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(",");
}

export function incrCounter(
  name: string,
  labels?: Record<string, string>,
  delta = 1
): void {
  const entry = getOrCreateCounter(name);
  entry.total += delta;
  const labelKey = buildLabelKey(labels);
  entry.byLabel.set(labelKey, (entry.byLabel.get(labelKey) ?? 0) + delta);
}

export function getCounters(): ReadonlyMap<string, CounterEntry> {
  return counters;
}

export function recordProviderError(provider: string): void {
  incrCounter("extracto_provider_errors_total", { provider });
}

export function recordCacheHit(cache: string): void {
  incrCounter("extracto_cache_hits_total", { cache });
}

export function recordCacheMiss(cache: string): void {
  incrCounter("extracto_cache_misses_total", { cache });
}

export function recordWebhookDelivery(status: "success" | "failure"): void {
  incrCounter("extracto_webhook_deliveries_total", { status });
}

export function formatPrometheus(counterEntries: ReadonlyMap<string, CounterEntry>): string {
  const lines: string[] = [];
  for (const [name, entry] of counterEntries) {
    lines.push(`# TYPE ${name} counter`);
    if (entry.byLabel.size === 0) {
      lines.push(`${name} ${entry.total}`);
      continue;
    }
    for (const [labelKey, value] of entry.byLabel) {
      const labels = labelKey ? `{${labelKey}}` : "";
      lines.push(`${name}${labels} ${value}`);
    }
  }
  return lines.join("\n") + "\n";
}
