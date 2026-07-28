import { findCandidatesInText, isNearAccessKeyLabel } from "./from-text";
import { isValidAccessKeyForModel, validateAccessKey, type AccessKeyModel } from "../validation/access-key";
import type { CandidateEvidence } from "./types";

const OCR_CLUSTER = /(?=([A-Z0-9](?:[\s.\-_/]*[A-Z0-9]){43}))/g;
const OCR_TO_DIGIT: Readonly<Record<string, string>> = {
  O: "0",
  Q: "0",
  D: "0",
  I: "1",
  L: "1",
  Z: "2",
  S: "5",
  G: "6",
  B: "8",
};
const DIGIT_TO_OCR_LETTERS: Readonly<Record<string, readonly string[]>> = {
  "0": ["O", "Q", "D"],
  "1": ["I", "L"],
  "2": ["Z"],
  "5": ["S"],
  "6": ["G"],
  "8": ["B"],
};

function correctedAlternatives(raw: string): Array<{ value: string; corrections: number }> {
  const characters = raw.match(/[A-Z0-9]/g);
  if (characters === null || characters.length !== 44) {
    return [];
  }

  let corrections = 0;
  const issuerAlternatives: Array<{ index: number; replacement: string }> = [];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === undefined) {
      continue;
    }
    const isAlphanumericIssuerPosition = index >= 6 && index < 18;
    if (/[0-9]/.test(character)) {
      if (isAlphanumericIssuerPosition) {
        for (const letter of DIGIT_TO_OCR_LETTERS[character] ?? []) {
          issuerAlternatives.push({ index, replacement: letter });
        }
      }
      continue;
    }
    if (isAlphanumericIssuerPosition) {
      const digit = OCR_TO_DIGIT[character];
      if (digit !== undefined) {
        issuerAlternatives.push({ index, replacement: digit });
      }
      continue;
    }
    const corrected = OCR_TO_DIGIT[character];
    if (corrected === undefined) {
      return [];
    }
    characters[index] = corrected;
    corrections += 1;
  }

  if (corrections > 1) {
    return [];
  }

  const uncorrectedValue = characters.join("");
  const alternatives = [{ value: uncorrectedValue, corrections }];
  if (corrections === 0 && !validateAccessKey(uncorrectedValue).isValid) {
    for (const { index, replacement } of issuerAlternatives) {
      const corrected = [...characters];
      corrected[index] = replacement;
      alternatives.push({ value: corrected.join(""), corrections: 1 });
    }
  }
  return alternatives;
}

function isBoundedCluster(text: string, start: number, length: number): boolean {
  let after = start + length;
  while (after < text.length && /[\s.\-_/]/.test(text[after] ?? "")) {
    after += 1;
  }
  return !/[A-Z0-9]/.test(text[start - 1] ?? "") && !/[A-Z0-9]/.test(text[after] ?? "");
}

/**
 * Finds valid model-specific access keys in OCR text, including safe single-character corrections.
 *
 * @param {string} text - Supplies OCR text to inspect.
 * @param {number} page - Identifies the 1-based source page for emitted evidence.
 * @param {number} pass - Identifies the 1-based render pass used for OCR.
 * @param {number} confidence - Supplies OCR engine confidence from 0 through 100.
 * @param {AccessKeyModel} expectedModel - Selects the fiscal model accepted in the output.
 * @returns {Array<CandidateEvidence>} Returns exact and unambiguous corrected evidence found in the text.
 */
export function findCandidatesInOcrText(text: string, page: number, pass: number, confidence: number, expectedModel: AccessKeyModel): CandidateEvidence[] {
  const normalized = text.normalize("NFKC").toUpperCase();
  const exact = findCandidatesInText(normalized, page, expectedModel).map((candidate) => ({
    ...candidate,
    source: "ocr" as const,
    pass,
    ocrConfidence: confidence,
  }));
  const output = [...exact];
  const seen = new Set(exact.map((candidate) => candidate.accessKey));

  for (const match of normalized.matchAll(OCR_CLUSTER)) {
    const raw = match[1];
    if (raw === undefined) {
      continue;
    }
    const start = match.index;
    if (!isBoundedCluster(normalized, start, raw.length)) {
      continue;
    }
    const validAlternatives = new Map<string, { value: string; corrections: number }>();
    for (const corrected of correctedAlternatives(raw)) {
      if (corrected.corrections > 0 && isValidAccessKeyForModel(corrected.value, expectedModel)) {
        validAlternatives.set(corrected.value, corrected);
      }
    }
    if (validAlternatives.size !== 1) {
      continue;
    }
    const corrected = validAlternatives.values().next().value;
    if (corrected === undefined || seen.has(corrected.value)) {
      continue;
    }
    seen.add(corrected.value);
    output.push({
      accessKey: corrected.value,
      page,
      source: "ocr",
      pass,
      nearLabel: isNearAccessKeyLabel(normalized, start),
      ocrConfidence: confidence,
      corrections: corrected.corrections,
    });
  }

  return output;
}
