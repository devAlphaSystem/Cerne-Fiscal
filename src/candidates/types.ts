import type { ExtractionSource } from "../types";

/**
 * Represents one validated observation of an access key from a document page.
 */
export interface CandidateEvidence {
  /**
   * Contains the normalized access key supported by this evidence.
   */
  accessKey: string;
  /**
   * Identifies the 1-based page on which the evidence was observed.
   */
  page: number;
  /**
   * Identifies the recognition channel that produced the evidence.
   */
  source: ExtractionSource;
  /**
   * Identifies the 1-based render pass, or zero for native PDF text.
   */
  pass: number;
  /**
   * Records whether the extraction channel marked the evidence as having nearby label context.
   */
  nearLabel: boolean;
  /**
   * Reports OCR engine confidence from 0 through 100 when OCR produced the evidence.
   */
  ocrConfidence?: number;
  /**
   * Reports the number of OCR character substitutions applied to recover the key.
   */
  corrections?: number;
}
