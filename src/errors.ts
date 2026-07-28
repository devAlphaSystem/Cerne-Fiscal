import type { ExtractionErrorCode } from "./types";

/**
 * Carries a stable extraction error code with a safe caller-facing message.
 *
 * @class
 */
export class ExtractionFailure extends Error {
  /**
   * Identifies the structured failure category returned to callers.
   */
  public readonly code: ExtractionErrorCode;

  /**
   * Creates an extraction failure with an optional underlying cause.
   *
   * @param {ExtractionErrorCode} code - Identifies the stable failure category.
   * @param {string} message - Explains the failure without exposing sensitive details.
   * @param {ErrorOptions} [options] - Supplies the underlying error as a cause when available.
   */
  public constructor(code: ExtractionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExtractionFailure";
    this.code = code;
  }
}

/**
 * Converts an unknown thrown value into a human-readable message.
 *
 * @param {unknown} error - Supplies the value caught from an operation.
 * @returns {string} Returns the error message or a stable fallback for non-error values.
 */
export function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown processing error.";
}
