/**
 * Pure progress-reporting module for JSONL indexing: shared between host (progress emission)
 * and webview (display). No vscode or React dependencies, so it's testable in Node.
 */

/** Progress snapshot: bytes loaded and total. */
export interface IndexProgress {
  loaded: number;
  total: number;
}

/** Compute clamped percentage (0-99, never 100 until truly complete). */
export function indexPercent(loaded: number, total: number): number {
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0 || loaded < 0) {
    return 0;
  }
  const clamped = Math.max(0, Math.min(loaded, total));
  // Cap at 99 so "100%" is reserved for the completion signal (jsonlInfo), not mid-stream.
  const raw = Math.floor((clamped / total) * 100);
  return Math.min(raw, 99);
}

/** Throttled progress reporter: delays first emission, then rate-limits by time and percent. */
export interface ProgressReporter {
  report(loaded: number, total: number): void;
  stop(): void;
  readonly stopped: boolean;
}

export interface ProgressReporterOptions {
  /** Callback fired on each throttled update. */
  onProgress: (progress: IndexProgress) => void;
  /** Delay before first emission (ms). Files finishing faster never trigger progress UI. */
  showAfterMs?: number;
  /** Minimum interval between emissions (ms). */
  minIntervalMs?: number;
  /** Injectable time source for testing. */
  now?: () => number;
}

/**
 * Create a throttled progress reporter. Suppresses all output until `showAfterMs` has elapsed
 * since creation, then only emits when the interval has passed and the percentage increased.
 */
export function createProgressReporter(options: ProgressReporterOptions): ProgressReporter {
  const {
    onProgress,
    showAfterMs = 300,
    minIntervalMs = 100,
    now = () => performance.now(),
  } = options;

  const createdAt = now();
  let lastEmitAt = createdAt;
  let lastPercent = -1;
  let isStopped = false;

  return {
    report(loaded, total) {
      if (isStopped) return;
      if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return;

      const elapsed = now() - createdAt;
      if (elapsed < showAfterMs) return; // Still in the silent threshold window.

      const percent = indexPercent(loaded, total);
      const sinceLastEmit = now() - lastEmitAt;

      // First emission (lastPercent < 0) only needs to pass showAfterMs threshold.
      // Subsequent emissions need both interval and percent-increase checks.
      const isFirstEmit = lastPercent < 0;
      if ((isFirstEmit || sinceLastEmit >= minIntervalMs) && percent > lastPercent) {
        lastPercent = percent;
        lastEmitAt = now();
        onProgress({ loaded: Math.min(loaded, total), total });
      }
    },

    stop() {
      isStopped = true;
    },

    get stopped() {
      return isStopped;
    },
  };
}
