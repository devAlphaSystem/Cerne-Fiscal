import { findCandidatesInText } from "./from-text";
import { isValidAccessKeyForModel, validateAccessKey, type AccessKeyModel } from "../validation/access-key";
import type { CandidateEvidence } from "./types";

const OCR_CLUSTER = /[A-Z0-9](?:[\s.\-_/]*[A-Z0-9]){43}/g;
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
    for (const corrected of correctedAlternatives(match[0])) {
      if (corrected.corrections === 0 || seen.has(corrected.value) || !isValidAccessKeyForModel(corrected.value, expectedModel)) {
        continue;
      }
      seen.add(corrected.value);
      output.push({
        accessKey: corrected.value,
        page,
        source: "ocr",
        pass,
        nearLabel: false,
        ocrConfidence: confidence,
        corrections: corrected.corrections,
      });
    }
  }

  return output;
}
