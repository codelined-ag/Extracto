export interface JobSample {
  documentType: string;
  provider: string;
  model: string;
  status: "COMPLETED" | "FAILED" | "QUEUED" | "PROCESSING";
  processingMs: number | null;
}

export interface ModelStat {
  provider: string;
  model: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  meanMs: number | null;
}

export interface RecommendationEntry {
  documentType: string;
  best: ModelStat | null;
  alternatives: ModelStat[];
  insufficientData: boolean;
}

const MIN_SAMPLES_PER_MODEL = 3;

export function computeRecommendations(samples: JobSample[]): RecommendationEntry[] {
  const byType = new Map<string, JobSample[]>();
  for (const sample of samples) {
    const list = byType.get(sample.documentType) ?? [];
    list.push(sample);
    byType.set(sample.documentType, list);
  }

  const out: RecommendationEntry[] = [];
  for (const [documentType, group] of byType) {
    const stats = aggregateByModel(group);
    const qualifying = stats.filter((s) => s.attempts >= MIN_SAMPLES_PER_MODEL);
    const ranked = qualifying.length > 0 ? qualifying : stats;
    ranked.sort(rankCompare);
    const best = ranked.length > 0 ? ranked[0] : null;
    out.push({
      documentType,
      best,
      alternatives: ranked.slice(1, 4),
      insufficientData: qualifying.length === 0,
    });
  }
  out.sort((a, b) => a.documentType.localeCompare(b.documentType));
  return out;
}

function aggregateByModel(samples: JobSample[]): ModelStat[] {
  const map = new Map<string, ModelStat>();
  for (const s of samples) {
    const key = `${s.provider}::${s.model}`;
    const prev = map.get(key) ?? {
      provider: s.provider,
      model: s.model,
      attempts: 0,
      successes: 0,
      failures: 0,
      successRate: 0,
      meanMs: null as number | null,
    };
    prev.attempts += 1;
    if (s.status === "COMPLETED") prev.successes += 1;
    else if (s.status === "FAILED") prev.failures += 1;
    map.set(key, prev);
  }
  for (const stat of map.values()) {
    stat.successRate = stat.attempts > 0 ? Math.round((stat.successes / stat.attempts) * 1000) / 1000 : 0;
    const ms = samples
      .filter(
        (s) =>
          s.provider === stat.provider &&
          s.model === stat.model &&
          s.status === "COMPLETED" &&
          typeof s.processingMs === "number",
      )
      .map((s) => s.processingMs as number);
    stat.meanMs = ms.length > 0 ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
  }
  return [...map.values()];
}

function rankCompare(a: ModelStat, b: ModelStat): number {
  if (a.successRate !== b.successRate) return b.successRate - a.successRate;
  if (a.attempts !== b.attempts) return b.attempts - a.attempts;
  if (a.meanMs !== null && b.meanMs !== null && a.meanMs !== b.meanMs) return a.meanMs - b.meanMs;
  return 0;
}
