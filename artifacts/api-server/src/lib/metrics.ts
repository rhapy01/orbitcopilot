type CounterMap = Record<string, number>;

const counters: CounterMap = {};
const timings: Record<string, number[]> = {};

export function incMetric(name: string, by = 1): void {
  counters[name] = (counters[name] ?? 0) + by;
}

export function recordTiming(name: string, ms: number): void {
  if (!timings[name]) timings[name] = [];
  timings[name].push(ms);
  if (timings[name].length > 100) timings[name].shift();
}

export function getMetricsSnapshot() {
  const timingSummary: Record<string, { count: number; avgMs: number }> = {};
  for (const [name, samples] of Object.entries(timings)) {
    const avg = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
    timingSummary[name] = { count: samples.length, avgMs: Math.round(avg) };
  }
  return { counters: { ...counters }, timings: timingSummary, at: new Date().toISOString() };
}

export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    incMetric(`${name}.ok`);
    return result;
  } catch (err) {
    incMetric(`${name}.err`);
    throw err;
  } finally {
    recordTiming(name, Date.now() - start);
  }
}
