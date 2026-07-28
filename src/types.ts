import type { AccessKeyComponents, AccessKeyDocumentTypeForModel, AccessKeyModel } from "./validation/access-key";

/** A local path, HTTP(S) URL, or in-memory PDF byte source. */
export type PdfInput = string | ArrayBuffer | Uint8Array;

export type PerformanceProfile = "fast" | "balanced" | "accurate";

export type OcrMode = "never" | "fallback" | "always";

export type ExtractionStatus = "success" | "not_found" | "partial" | "error";

export type ExtractionSource = "pdf-text" | "pdf-text-reconstructed" | "code128" | "qr-code" | "ocr";

export type ExtractionErrorCode = "INVALID_INPUT" | "FILE_NOT_FOUND" | "FILE_TOO_LARGE" | "DOWNLOAD_ERROR" | "INVALID_OPTIONS" | "INVALID_PDF" | "PASSWORD_REQUIRED" | "TIMEOUT" | "ABORTED" | "RESOURCE_LIMIT" | "PROCESSING_ERROR";

export interface ExtractOptions {
  /** Processing/cost profile. Defaults to `balanced`. */
  performance?: PerformanceProfile;
  /** Distinct visual render attempts, from 1 through 5. */
  passes?: number;
  /** OCR policy. Profile defaults are `never`, `fallback`, and `fallback`. */
  ocr?: OcrMode;
  /** Maximum pages processed from the beginning of the PDF. */
  maxPages?: number;
  /** Maximum accepted input size. Defaults to 30 MiB. */
  maxFileSizeBytes?: number;
  /** Maximum render area per page, after scale and rotation. */
  maxPixelsPerPage?: number;
  /** Maximum decoded source-image area accepted from a PDF page. */
  maxSourceImagePixels?: number;
  /** Overall deadline in milliseconds. Network I/O aborts; CPU stages check cooperatively. */
  timeoutMs?: number;
  /** Stop after the first validated access key. */
  stopAfterFirst?: boolean;
  /** Optional request headers used only when the input is an HTTP(S) URL. */
  requestHeaders?: Readonly<Record<string, string>>;
  /** Standard cancellation signal, including an in-progress URL download. */
  signal?: AbortSignal;
}

export interface ExtractedAccessKey<TModel extends AccessKeyModel = AccessKeyModel> {
  accessKey: string;
  documentType: AccessKeyDocumentTypeForModel<TModel>;
  model: TModel;
  format: "numeric" | "alphanumeric";
  isValid: true;
  precisionScore: number;
  pages: number[];
  sources: ExtractionSource[];
  occurrences: number;
  components: AccessKeyComponents & {
    model: TModel;
    documentType: AccessKeyDocumentTypeForModel<TModel>;
  };
}

export interface ExtractionMetadata {
  performance: PerformanceProfile;
  ocrMode: OcrMode;
  passesRequested: number;
  passesUsed: number;
  pagesTotal: number;
  pagesProcessed: number;
  pagesRendered: number;
  ocrPages: number;
  fileSizeBytes: number;
  maxPixelsPerPage: number;
  maxSourceImagePixels: number;
  durationMs: number;
  complete: boolean;
  confidenceVersion: "1.0.0";
}

export interface ExtractionErrorInfo {
  code: ExtractionErrorCode;
  message: string;
}

export interface ExtractionResult<TModel extends AccessKeyModel = AccessKeyModel> {
  status: ExtractionStatus;
  success: boolean;
  precisionScore: number;
  bestMatch: ExtractedAccessKey<TModel> | null;
  results: ExtractedAccessKey<TModel>[];
  metadata: ExtractionMetadata;
  warnings: string[];
  error: ExtractionErrorInfo | null;
}
