import type { CandidateEvidence } from "../candidates/types";
import type { ExtractedAccessKey, ExtractionSource } from "../types";
import { validateAccessKey, type AccessKeyComponents, type AccessKeyDocumentTypeForModel, type AccessKeyModel } from "../validation/access-key";

const SOURCE_BASE_SCORE: Record<ExtractionSource, number> = {
  "qr-code": 0.995,
  code128: 0.995,
  "pdf-text": 0.985,
  "pdf-text-reconstructed": 0.97,
  ocr: 0.82,
};

const SOURCE_ORDER: ExtractionSource[] = ["qr-code", "code128", "pdf-text", "pdf-text-reconstructed", "ocr"];

function evidenceScore(evidence: CandidateEvidence): number {
  let score = SOURCE_BASE_SCORE[evidence.source];
  if (evidence.source === "ocr") {
    const ocrConfidence = Math.max(0, Math.min(100, evidence.ocrConfidence ?? 0));
    score = Math.max(0.75, 0.72 + (ocrConfidence / 100) * 0.2);
    if (evidence.nearLabel) {
      score += 0.04;
    }
    score -= (evidence.corrections ?? 0) * 0.1;
  }
  if (evidence.nearLabel && evidence.source.startsWith("pdf-text")) {
    score += 0.005;
  }
  return Math.max(0, Math.min(0.995, score));
}

function independentFamilies(sources: Set<ExtractionSource>): number {
  let families = 0;
  if ([...sources].some((source) => source.startsWith("pdf-text"))) {
    families += 1;
  }
  if (sources.has("code128") || sources.has("qr-code")) {
    families += 1;
  }
  if (sources.has("ocr")) {
    families += 1;
  }
  return families;
}

function componentsMatchModel<TModel extends AccessKeyModel>(
  components: AccessKeyComponents | null,
  expectedModel: TModel,
): components is AccessKeyComponents & {
  model: TModel;
  documentType: AccessKeyDocumentTypeForModel<TModel>;
} {
  return components !== null && components.model === expectedModel && components.documentType !== null;
}

function deduplicateDerivedEvidence(items: CandidateEvidence[]): CandidateEvidence[] {
  const unique = new Map<string, CandidateEvidence>();
  for (const item of items) {
    const signature = `${item.page}:${item.source}`;
    const current = unique.get(signature);
    if (current === undefined || evidenceScore(item) > evidenceScore(current)) {
      unique.set(signature, item);
    }
  }
  return [...unique.values()];
}

export function mergeEvidence<TModel extends AccessKeyModel>(evidence: CandidateEvidence[], expectedModel: TModel): ExtractedAccessKey<TModel>[] {
  const grouped = new Map<string, CandidateEvidence[]>();
  for (const item of evidence) {
    const current = grouped.get(item.accessKey) ?? [];
    current.push(item);
    grouped.set(item.accessKey, current);
  }

  const results: ExtractedAccessKey<TModel>[] = [];
  for (const [accessKey, groupedItems] of grouped) {
    const validation = validateAccessKey(accessKey);
    const components = validation.components;
    if (!validation.isValid || !componentsMatchModel(components, expectedModel)) {
      continue;
    }

    const items = deduplicateDerivedEvidence(groupedItems);
    const sources = new Set(items.map((item) => item.source));
    const pages = [...new Set(items.map((item) => item.page))].sort((a, b) => a - b);
    let precisionScore = Math.max(...items.map(evidenceScore));
    if (independentFamilies(sources) > 1) {
      precisionScore = Math.min(0.999, precisionScore + 0.004);
    }

    results.push({
      accessKey,
      documentType: components.documentType,
      model: components.model,
      format: components.format,
      isValid: true,
      precisionScore: Number(precisionScore.toFixed(3)),
      pages,
      sources: SOURCE_ORDER.filter((source) => sources.has(source)),
      occurrences: items.length,
      components,
    });
  }

  return results.sort((left, right) => {
    if (right.precisionScore !== left.precisionScore) {
      return right.precisionScore - left.precisionScore;
    }
    return left.pages[0]! - right.pages[0]!;
  });
}
