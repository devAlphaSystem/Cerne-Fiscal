import type { Readable } from "node:stream";

import type { AccessKeyComponents, AccessKeyDocumentTypeForModel, AccessKeyModel } from "./validation/access-key";

/**
 * Accepts a local path, an HTTP(S) URL, in-memory document bytes, a `Readable`, or an async byte iterable for extraction.
 *
 * @since 0.2.0
 */
export type DocumentInput = string | ArrayBuffer | Uint8Array | Readable | AsyncIterable<Uint8Array>;

/**
 * Selects where the bytes of a streamed input are held while the stream is consumed.
 *
 * `memory` accumulates the stream in process memory under `maxFileSizeBytes`. `file` writes every chunk to an
 * extractor-owned temporary file as it arrives. `auto` keeps the stream in memory until
 * `streamMemoryThresholdBytes` would be exceeded and then migrates the bytes already received to a temporary
 * file without restarting the read.
 *
 * The policy applies only to `Readable` and async-iterable inputs. Bytes supplied as `ArrayBuffer`,
 * `Uint8Array`, or `Buffer` are already resident in memory and are never written to disk.
 *
 * @since 0.6.0
 */
export type StreamStorage = "memory" | "file" | "auto";

/**
 * Preserves the original PDF-oriented input name as a compatibility alias.
 *
 * @since 0.1.0
 */
export type PdfInput = DocumentInput;

/**
 * Identifies a document format accepted by the extraction pipeline.
 *
 * @since 0.2.0
 */
export type DocumentFormat = "pdf" | "jpeg" | "png";

/**
 * Selects a predefined balance between processing speed and recognition depth.
 *
 * @since 0.1.0
 */
export type PerformanceProfile = "fast" | "balanced" | "accurate";

/**
 * Controls when optical character recognition participates in extraction.
 *
 * @since 0.1.0
 */
export type OcrMode = "never" | "fallback" | "always";

/**
 * Describes the outcome of an extraction attempt.
 *
 * @since 0.1.0
 */
export type ExtractionStatus = "success" | "not_found" | "partial" | "error";

/**
 * Identifies the recognition channel that produced access-key evidence.
 *
 * @since 0.1.0
 */
export type ExtractionSource = "pdf-text" | "pdf-text-reconstructed" | "code128" | "qr-code" | "ocr";

/**
 * Identifies a stable failure category returned by the extraction API.
 *
 * @since 0.1.0
 */
export type ExtractionErrorCode = "INVALID_INPUT" | "FILE_NOT_FOUND" | "FILE_TOO_LARGE" | "DOWNLOAD_ERROR" | "INVALID_OPTIONS" | "INVALID_PDF" | "UNSUPPORTED_FORMAT" | "INVALID_IMAGE" | "PASSWORD_REQUIRED" | "TIMEOUT" | "ABORTED" | "RESOURCE_LIMIT" | "PROCESSING_ERROR";

/**
 * Configures document loading, recognition depth, resource limits, and cancellation.
 *
 * @since 0.1.0
 */
export interface ExtractOptions {
  /**
   * Selects the processing profile whose limits and pass defaults are applied.
   */
  performance?: PerformanceProfile;
  /**
   * Overrides the number of render and recognition passes, from 1 through 5.
   */
  passes?: number;
  /**
   * Controls whether OCR is skipped, used as a fallback, or always attempted.
   */
  ocr?: OcrMode;
  /**
   * Limits the number of document pages processed from the beginning of the file.
   */
  maxPages?: number;
  /**
   * Limits the accepted local, remote, streamed, or in-memory document size in bytes.
   */
  maxFileSizeBytes?: number;
  /**
   * Selects where a `Readable` or async-iterable input is held while it is consumed, defaulting to `auto`.
   *
   * Path, URL, and in-memory inputs ignore this option.
   */
  streamStorage?: StreamStorage;
  /**
   * Sets the byte count an `auto` stream may hold in memory before it migrates to a temporary file, from one byte through 1 GiB and defaulting to 8 MiB.
   */
  streamMemoryThresholdBytes?: number;
  /**
   * Selects an existing directory for extractor-owned temporary stream files, defaulting to the system temporary directory.
   */
  streamTempDirectory?: string;
  /**
   * Limits the number of pixels allocated for each rendered page.
   */
  maxPixelsPerPage?: number;
  /**
   * Limits the declared pixel area of a source image before decoding.
   */
  maxSourceImagePixels?: number;
  /**
   * Limits total extraction time in milliseconds, with zero disabling the deadline.
   */
  timeoutMs?: number;
  /**
   * Stops additional recognition stages after the first valid access key is found.
   */
  stopAfterFirst?: boolean;
  /**
   * Supplies caller-owned headers for HTTP(S) requests and same-origin redirects.
   */
  requestHeaders?: Readonly<Record<string, string>>;
  /**
   * Cancels document loading and recognition when the signal is aborted.
   */
  signal?: AbortSignal;
}

/**
 * Represents a validated access key together with its provenance and parsed fields.
 *
 * @template {AccessKeyModel} TModel - Identifies the fiscal model represented by the result.
 * @since 0.1.0
 */
export interface ExtractedAccessKey<TModel extends AccessKeyModel = AccessKeyModel> {
  /**
   * Contains the normalized 44-character access key.
   */
  accessKey: string;
  /**
   * Identifies the fiscal document type associated with the model.
   */
  documentType: AccessKeyDocumentTypeForModel<TModel>;
  /**
   * Identifies the two-digit fiscal document model.
   */
  model: TModel;
  /**
   * Identifies whether the issuer segment is numeric or alphanumeric.
   */
  format: "numeric" | "alphanumeric";
  /**
   * Indicates that the returned key passed every structural, semantic, and check-digit validation rule.
   */
  isValid: true;
  /**
   * Reports the normalized confidence score assigned to the evidence, from 0 through 1.
   */
  precisionScore: number;
  /**
   * Lists the 1-based document pages on which the key was found.
   */
  pages: number[];
  /**
   * Lists the distinct recognition channels that produced supporting evidence.
   */
  sources: ExtractionSource[];
  /**
   * Reports the number of distinct evidence occurrences retained for the key.
   */
  occurrences: number;
  /**
   * Provides the parsed access-key fields narrowed to the requested fiscal model.
   */
  components: AccessKeyComponents & {
    model: TModel;
    documentType: AccessKeyDocumentTypeForModel<TModel>;
  };
}

/**
 * Reports the configuration, resource usage, and completion state of extraction.
 *
 * @since 0.1.0
 */
export interface ExtractionMetadata {
  /**
   * Identifies the performance profile used for the run.
   */
  performance: PerformanceProfile;
  /**
   * Identifies the OCR policy used for the run.
   */
  ocrMode: OcrMode;
  /**
   * Identifies the detected input format when document loading succeeded.
   */
  inputFormat?: DocumentFormat;
  /**
   * Reports the configured number of recognition passes.
   */
  passesRequested: number;
  /**
   * Reports the deepest recognition pass reached during processing.
   */
  passesUsed: number;
  /**
   * Reports the total number of pages declared by the document.
   */
  pagesTotal: number;
  /**
   * Reports the number of pages visited for native-text extraction.
   */
  pagesProcessed: number;
  /**
   * Reports the number of distinct pages evaluated through rendered recognition.
   */
  pagesRendered: number;
  /**
   * Reports the number of render-based recognition attempts performed.
   */
  renderAttempts?: number;
  /**
   * Reports the number of distinct pages submitted to OCR.
   */
  ocrPages: number;
  /**
   * Reports the number of input bytes loaded for processing.
   */
  fileSizeBytes: number;
  /**
   * Reports the decoded source-image width when the input is JPEG or PNG.
   */
  sourceImageWidth?: number;
  /**
   * Reports the decoded source-image height when the input is JPEG or PNG.
   */
  sourceImageHeight?: number;
  /**
   * Reports the per-page pixel limit applied during rendering.
   */
  maxPixelsPerPage: number;
  /**
   * Reports the source-image pixel-area limit applied before decoding.
   */
  maxSourceImagePixels: number;
  /**
   * Reports total elapsed extraction time in milliseconds.
   */
  durationMs: number;
  /**
   * Indicates whether every eligible stage and page completed without truncation.
   */
  complete: boolean;
  /**
   * Identifies the scoring contract used to interpret precision values.
   */
  confidenceVersion: "1.0.0";
}

/**
 * Describes a structured failure returned instead of a successful extraction.
 *
 * @since 0.1.0
 */
export interface ExtractionErrorInfo {
  /**
   * Identifies the stable machine-readable failure category.
   */
  code: ExtractionErrorCode;
  /**
   * Explains the failure without exposing sensitive input or dependency details.
   */
  message: string;
}

/**
 * Represents the complete extraction response for a requested fiscal model.
 *
 * @template {AccessKeyModel} TModel - Identifies the fiscal model accepted in the result set.
 * @since 0.1.0
 */
export interface ExtractionResult<TModel extends AccessKeyModel = AccessKeyModel> {
  /**
   * Identifies whether extraction succeeded, found nothing, completed partially, or failed.
   */
  status: ExtractionStatus;
  /**
   * Indicates whether at least one validated access key was returned.
   */
  success: boolean;
  /**
   * Reports the lowest precision score among returned results, or zero when none exist.
   */
  precisionScore: number;
  /**
   * Provides the highest-ranked result, or `null` when no key was validated.
   */
  bestMatch: ExtractedAccessKey<TModel> | null;
  /**
   * Lists validated keys in descending precision order.
   */
  results: ExtractedAccessKey<TModel>[];
  /**
   * Provides processing metrics, effective limits, and completion state.
   */
  metadata: ExtractionMetadata;
  /**
   * Lists non-fatal conditions that reduced extraction scope or completeness.
   */
  warnings: string[];
  /**
   * Provides the terminal failure when one occurred, or `null` otherwise.
   */
  error: ExtractionErrorInfo | null;
}
