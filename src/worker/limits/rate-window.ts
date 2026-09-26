export interface WindowResult {
  allowed: boolean;
  hits: number[];
}

/** Pure sliding-window limiter: keeps timestamps of accepted hits inside the window. */
export function slidingWindow(hits: readonly number[], now: number, limit: number, windowMs: number): WindowResult {
  const recent = hits.filter((t) => now - t < windowMs);
  if (recent.length >= limit) return { allowed: false, hits: recent.length === hits.length ? [...hits] : recent };
  return { allowed: true, hits: [...recent, now] };
}
