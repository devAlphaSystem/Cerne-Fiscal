import { ExtractionFailure } from "./errors";
import type { ResolvedOptions } from "./options";
import { elapsedMilliseconds, startTimer, type MonotonicTimestamp } from "./timing";

/**
 * Converts an aborted signal into the categorized failure that stopped the work.
 *
 * A deadline reached inside {@link WorkGuard} is re-derived by the caller's own `check`, so this helper only
 * needs to report the generic cancellation unless the reason already carries a category.
 *
 * @param {AbortSignal} [signal] - Supplies the signal to inspect, which may be absent.
 * @returns {ExtractionFailure|null} Returns the failure to raise, or `null` when the signal is absent or still active.
 */
export function failureFromSignal(signal: AbortSignal | undefined): ExtractionFailure | null {
  if (signal?.aborted !== true) {
    return null;
  }
  return signal.reason instanceof ExtractionFailure ? signal.reason : new ExtractionFailure("ABORTED", "Extraction was aborted.", { cause: signal.reason });
}

/**
 * Coordinates caller cancellation and elapsed-time limits across extraction stages.
 *
 * @class
 */
export class WorkGuard {
  readonly #startedAt: MonotonicTimestamp;
  readonly #options: ResolvedOptions;
  readonly #controller = new AbortController();
  readonly #abortListener?: () => void;
  readonly #timeout?: NodeJS.Timeout;
  #stopReason: "aborted" | "timeout" | null = null;

  /**
   * Creates a work guard for one extraction run.
   *
   * @param {ResolvedOptions} options - Supplies the resolved timeout and optional caller signal.
   * @param {MonotonicTimestamp} [startedAt=startTimer()] - Supplies the run's monotonic start time.
   */
  public constructor(options: ResolvedOptions, startedAt = startTimer()) {
    this.#options = options;
    this.#startedAt = startedAt;

    if (options.signal?.aborted === true) {
      this.#stop("aborted");
    } else if (options.signal !== undefined) {
      this.#abortListener = (): void => {
        this.#stop("aborted");
      };
      options.signal.addEventListener("abort", this.#abortListener, { once: true });
    }

    if (options.timeoutMs > 0 && this.#stopReason === null) {
      const elapsed = elapsedMilliseconds(this.#startedAt);
      this.#timeout = setTimeout(
        () => {
          this.#stop("timeout");
        },
        Math.max(0, options.timeoutMs - elapsed),
      );
      this.#timeout.unref();
    }
  }

  public get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /**
   * Verifies that extraction may continue under the configured cancellation constraints.
   *
   * @throws {ExtractionFailure} Throws when the caller aborts or the configured deadline expires.
   */
  public check(): void {
    if (this.#options.signal?.aborted === true || this.#stopReason === "aborted") {
      this.#stop("aborted");
      throw new ExtractionFailure("ABORTED", "Extraction was aborted.");
    }
    if (this.#stopReason === "timeout" || (this.#options.timeoutMs > 0 && elapsedMilliseconds(this.#startedAt) >= this.#options.timeoutMs)) {
      this.#stop("timeout");
      throw new ExtractionFailure("TIMEOUT", "Extraction exceeded its configured deadline.");
    }
  }

  /**
   * Releases the timeout and caller-signal listener owned by this guard.
   */
  public dispose(): void {
    if (this.#timeout !== undefined) {
      clearTimeout(this.#timeout);
    }
    if (this.#abortListener !== undefined && this.#options.signal !== undefined) {
      this.#options.signal.removeEventListener("abort", this.#abortListener);
    }
  }

  #stop(reason: "aborted" | "timeout"): void {
    if (this.#stopReason !== null) {
      return;
    }
    this.#stopReason = reason;
    this.#controller.abort();
  }
}
