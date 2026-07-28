import type { ExtractionErrorCode } from "./types";

export class ExtractionFailure extends Error {
  public readonly code: ExtractionErrorCode;

  public constructor(code: ExtractionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExtractionFailure";
    this.code = code;
  }
}

export function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown processing error.";
}
