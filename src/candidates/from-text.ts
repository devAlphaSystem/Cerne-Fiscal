import { isValidAccessKeyForModel, type AccessKeyModel } from "../validation/access-key";
import type { CandidateEvidence } from "./types";
import type { ExtractionSource } from "../types";

const ACCESS_KEY_PATTERN = /[0-9]{6}[A-Z0-9]{12}[0-9]{26}/g;
const SEPARATOR_PATTERN = /[\s.\-_/]/;
const ALPHANUMERIC_PATTERN = /[A-Z0-9]/;
const LABEL_PATTERN = /CHAVE\s+DE\s+ACESSO|ACCESS\s+KEY/;

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\u00a0/g, " ").toUpperCase();
}

/**
 * Checks whether a character offset appears near an access-key label.
 *
 * @param {string} text - Supplies normalized document text to inspect.
 * @param {number} start - Supplies the zero-based start offset of the candidate key.
 * @returns {boolean} Returns `true` when the preceding context contains a recognized label.
 */
export function isNearAccessKeyLabel(text: string, start: number): boolean {
  const context = text.slice(Math.max(0, start - 120), start + 12);
  return LABEL_PATTERN.test(context);
}

function addIfValid(output: CandidateEvidence[], seen: Set<string>, accessKey: string, page: number, source: ExtractionSource, pass: number, nearLabel: boolean, expectedModel: AccessKeyModel): void {
  const signature = `${accessKey}:${source}:${pass}:${nearLabel}`;
  if (!isValidAccessKeyForModel(accessKey, expectedModel) || seen.has(signature)) {
    return;
  }
  seen.add(signature);
  output.push({ accessKey, page, source, pass, nearLabel });
}

/**
 * Finds valid model-specific access keys in native or reconstructed document text.
 *
 * @param {string} text - Supplies document text that may contain contiguous or separated keys.
 * @param {number} page - Identifies the 1-based source page for emitted evidence.
 * @param {AccessKeyModel} expectedModel - Selects the fiscal model accepted in the output.
 * @returns {Array<CandidateEvidence>} Returns unique validated evidence found in the text.
 */
export function findCandidatesInText(text: string, page: number, expectedModel: AccessKeyModel): CandidateEvidence[] {
  const normalized = normalizedText(text);
  const output: CandidateEvidence[] = [];
  const seen = new Set<string>();

  for (const match of normalized.matchAll(ACCESS_KEY_PATTERN)) {
    const accessKey = match[0];
    const start = match.index;
    const before = start > 0 ? normalized[start - 1] : undefined;
    const after = normalized[start + accessKey.length];
    if ((before !== undefined && ALPHANUMERIC_PATTERN.test(before)) || (after !== undefined && ALPHANUMERIC_PATTERN.test(after))) {
      continue;
    }
    addIfValid(output, seen, accessKey, page, "pdf-text", 0, isNearAccessKeyLabel(normalized, start), expectedModel);
  }

  for (let start = 0; start < normalized.length; start += 1) {
    const first = normalized[start];
    if (first === undefined || !/[0-9]/.test(first)) {
      continue;
    }

    let accessKey = "";
    let cursor = start;
    let hadSeparator = false;
    while (cursor < normalized.length && cursor - start <= 100) {
      const character = normalized[cursor];
      if (character === undefined) {
        break;
      }
      if (ALPHANUMERIC_PATTERN.test(character)) {
        accessKey += character;
      } else if (SEPARATOR_PATTERN.test(character)) {
        hadSeparator = true;
      } else {
        break;
      }

      cursor += 1;
      if (accessKey.length === 44) {
        const nearLabel = isNearAccessKeyLabel(normalized, start);
        const rawSpan = normalized.slice(start, cursor);
        let lookahead = cursor;
        while (SEPARATOR_PATTERN.test(normalized[lookahead] ?? "")) {
          lookahead += 1;
        }
        const likelyLongerNumericCluster = /[0-9]/.test(normalized[lookahead] ?? "") && !nearLabel;
        const crossesLinesWithoutContext = rawSpan.includes("\n") && !nearLabel;
        if (hadSeparator && !likelyLongerNumericCluster && !crossesLinesWithoutContext) {
          addIfValid(output, seen, accessKey, page, "pdf-text-reconstructed", 0, nearLabel, expectedModel);
        }
        break;
      }
      if (accessKey.length > 44) {
        break;
      }
    }
  }

  return output;
}

/**
 * Finds valid model-specific access keys inside a decoded barcode payload.
 *
 * @param {string} value - Supplies the decoded barcode payload to inspect.
 * @param {number} page - Identifies the 1-based source page for emitted evidence.
 * @param {"code128"|"qr-code"} source - Identifies the barcode format that produced the payload.
 * @param {number} pass - Identifies the 1-based render pass that produced the payload.
 * @param {AccessKeyModel} expectedModel - Selects the fiscal model accepted in the output.
 * @returns {Array<CandidateEvidence>} Returns unique validated evidence found in the payload.
 */
export function findCandidatesInDecodedValue(value: string, page: number, source: Extract<"code128" | "qr-code", ExtractionSource>, pass: number, expectedModel: AccessKeyModel): CandidateEvidence[] {
  let decoded = normalizedText(value);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Barcode payloads may contain literal percent signs; keep the normalized value.
  }

  const output: CandidateEvidence[] = [];
  const seen = new Set<string>();
  for (const match of decoded.matchAll(ACCESS_KEY_PATTERN)) {
    addIfValid(output, seen, match[0], page, source, pass, true, expectedModel);
  }
  return output;
}
