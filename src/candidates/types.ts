import type { ExtractionSource } from "../types";

export interface CandidateEvidence {
  accessKey: string;
  page: number;
  source: ExtractionSource;
  pass: number;
  nearLabel: boolean;
  ocrConfidence?: number;
  corrections?: number;
}
