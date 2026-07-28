import { ExtractionFailure } from "./errors";
import type { ResolvedOptions } from "./options";
import { elapsedMilliseconds, startTimer, type MonotonicTimestamp } from "./timing";

export class WorkGuard {
  readonly #startedAt: MonotonicTimestamp;
  readonly #options: ResolvedOptions;
  readonly #controller = new AbortController();
  readonly #abortListener?: () => void;
  readonly #timeout?: NodeJS.Timeout;
  #stopReason: "aborted" | "timeout" | null = null;

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
