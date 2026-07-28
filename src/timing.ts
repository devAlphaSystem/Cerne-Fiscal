/**
 * Represents a monotonic high-resolution timestamp from the current process.
 */
export type MonotonicTimestamp = bigint;

/**
 * Captures the current monotonic timestamp for elapsed-time measurement.
 *
 * @returns {MonotonicTimestamp} Returns the current high-resolution process timestamp.
 */
export function startTimer(): MonotonicTimestamp {
  return process.hrtime.bigint();
}

/**
 * Calculates elapsed milliseconds since a monotonic start timestamp.
 *
 * @param {MonotonicTimestamp} startedAt - Supplies the previously captured start timestamp.
 * @returns {number} Returns elapsed time in fractional milliseconds.
 */
export function elapsedMilliseconds(startedAt: MonotonicTimestamp): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
