import type { AccessKeyComponents, AccessKeyDocumentTypeForModel, AccessKeyModel } from "./validation/access-key";

export type DocumentInput = string | ArrayBuffer | Uint8Array;

export type PdfInput = DocumentInput;

export type DocumentFormat = "pdf" | "jpeg" | "png";

export type PerformanceProfile = "fast" | "balanced" | "accurate";

export type OcrMode = "never" | "fallback" | "always";

export type ExtractionStatus = "success" | "not_found" | "partial" | "error";

export type ExtractionSource = "pdf-text" | "pdf-text-reconstructed" | "code128" | "qr-code" | "ocr";

export type ExtractionErrorCode = "INVALID_INPUT" | "FILE_NOT_FOUND" | "FILE_TOO_LARGE" | "DOWNLOAD_ERROR" | "INVALID_OPTIONS" | "INVALID_PDF" | "UNSUPPORTED_FORMAT" | "INVALID_IMAGE" | "PASSWORD_REQUIRED" | "TIMEOUT" | "ABORTED" | "RESOURCE_LIMIT" | "PROCESSING_ERROR";

export interface ExtractOptions {
  performance?: PerformanceProfile;
  passes?: number;
  ocr?: OcrMode;
  maxPages?: number;
  maxFileSizeBytes?: number;
  maxPixelsPerPage?: number;
  maxSourceImagePixels?: number;
  timeoutMs?: number;
  stopAfterFirst?: boolean;
  requestHeaders?: Readonly<Record<string, string>>;
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
  inputFormat?: DocumentFormat;
  passesRequested: number;
  passesUsed: number;
  pagesTotal: number;
  pagesProcessed: number;
  pagesRendered: number;
  renderAttempts?: number;
  ocrPages: number;
  fileSizeBytes: number;
  sourceImageWidth?: number;
  sourceImageHeight?: number;
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
