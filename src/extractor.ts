import { performance } from "node:perf_hooks";

import { findCandidatesInDecodedValue, findCandidatesInText } from "./candidates/from-text";
import { findCandidatesInOcrText } from "./candidates/from-ocr";
import type { CandidateEvidence } from "./candidates/types";
import { WorkGuard } from "./deadline";
import { ExtractionFailure, messageFromUnknown } from "./errors";
import { getRenderRecipes, InvalidOptionsError, resolveOptions, type RenderRecipe, type ResolvedOptions } from "./options";
import { extractPageText, type ExtractedPageText } from "./pdf/extract-text";
import { loadPdfInput } from "./pdf/load-input";
import { openPdfDocument } from "./pdf/open-document";
import type { PdfHandle, PdfPageLike } from "./pdf/types";
import type { OcrSession } from "./recognition/ocr-reader";
import { mergeEvidence } from "./scoring/merge-results";
import type { ExtractOptions, ExtractedAccessKey, ExtractionErrorInfo, ExtractionMetadata, ExtractionResult, ExtractionStatus, PdfInput } from "./types";
import type { AccessKeyModel } from "./validation/access-key";

interface MutableRunState {
  evidence: CandidateEvidence[];
  warnings: string[];
  pagesTotal: number;
  pagesProcessed: number;
  renderedPages: Set<number>;
  ocrPages: Set<number>;
  passesUsed: number;
  fileSizeBytes: number;
  complete: boolean;
}

function emptyState(): MutableRunState {
  return {
    evidence: [],
    warnings: [],
    pagesTotal: 0,
    pagesProcessed: 0,
    renderedPages: new Set(),
    ocrPages: new Set(),
    passesUsed: 0,
    fileSizeBytes: 0,
    complete: true,
  };
}

function textEvidence(pageText: ExtractedPageText, page: number, expectedModel: AccessKeyModel): CandidateEvidence[] {
  const candidates = [...findCandidatesInText(pageText.orderedText, page, expectedModel), ...findCandidatesInText(pageText.visualLines.join("\n"), page, expectedModel)];
  const unique = new Map<string, CandidateEvidence>();
  for (const candidate of candidates) {
    const signature = `${candidate.accessKey}:${candidate.source}`;
    const current = unique.get(signature);
    if (current === undefined || (!current.nearLabel && candidate.nearLabel)) {
      unique.set(signature, candidate);
    }
  }
  return [...unique.values()];
}

function hasPageEvidence(evidence: CandidateEvidence[], page: number): boolean {
  return evidence.some((candidate) => candidate.page === page);
}

function metadata(options: ResolvedOptions, state: MutableRunState, startedAt: number): ExtractionMetadata {
  return {
    performance: options.performance,
    ocrMode: options.ocr,
    passesRequested: options.passes,
    passesUsed: state.passesUsed,
    pagesTotal: state.pagesTotal,
    pagesProcessed: state.pagesProcessed,
    pagesRendered: state.renderedPages.size,
    ocrPages: state.ocrPages.size,
    fileSizeBytes: state.fileSizeBytes,
    maxPixelsPerPage: options.maxPixelsPerPage,
    maxSourceImagePixels: options.maxSourceImagePixels,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    complete: state.complete,
    confidenceVersion: "1.0.0",
  };
}

function resultFromState<TModel extends AccessKeyModel>(expectedModel: TModel, options: ResolvedOptions, state: MutableRunState, startedAt: number, error: ExtractionErrorInfo | null = null): ExtractionResult<TModel> {
  const results = mergeEvidence(state.evidence, expectedModel);
  let status: ExtractionStatus;
  if (error !== null) {
    status = results.length > 0 ? "partial" : "error";
  } else if (!state.complete) {
    status = "partial";
  } else {
    status = results.length > 0 ? "success" : "not_found";
  }
  const precisionScore = results.length === 0 ? 0 : Math.min(...results.map((candidate) => candidate.precisionScore));

  return {
    status,
    success: results.length > 0,
    precisionScore: Number(precisionScore.toFixed(3)),
    bestMatch: results[0] ?? null,
    results,
    metadata: metadata(options, state, startedAt),
    warnings: state.warnings,
    error,
  };
}

function invalidOptionsResult<TModel extends AccessKeyModel>(expectedModel: TModel, error: InvalidOptionsError, startedAt: number): ExtractionResult<TModel> {
  const options = resolveOptions();
  const state = emptyState();
  state.complete = false;
  return resultFromState(expectedModel, options, state, startedAt, {
    code: "INVALID_OPTIONS",
    message: error.message,
  });
}

async function withPage<T>(handle: PdfHandle, pageNumber: number, work: (page: PdfPageLike) => Promise<T>): Promise<T> {
  const page = await handle.document.getPage(pageNumber);
  try {
    return await work(page);
  } finally {
    page.cleanup();
  }
}

function ocrRecipes(recipes: RenderRecipe[], options: ResolvedOptions): RenderRecipe[] {
  const unrotated = recipes.filter((recipe) => recipe.rotation === 0).sort((left, right) => right.scale - left.scale)[0];
  const selected = unrotated === undefined ? [] : [unrotated];
  if (options.performance === "accurate") {
    selected.push(...recipes.filter((recipe) => recipe.rotation !== 0));
  }
  return selected;
}

async function collectTextEvidence(handle: PdfHandle, state: MutableRunState, pageLimit: number, options: ResolvedOptions, expectedModel: AccessKeyModel, guard: WorkGuard): Promise<number[]> {
  const processedPages: number[] = [];
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    guard.check();
    const candidates = await withPage(handle, pageNumber, async (page) => textEvidence(await extractPageText(page), pageNumber, expectedModel));
    guard.check();
    state.evidence.push(...candidates);
    state.pagesProcessed += 1;
    processedPages.push(pageNumber);
    if (options.stopAfterFirst && candidates.length > 0) {
      break;
    }
  }
  return processedPages;
}

async function collectBarcodeEvidence(handle: PdfHandle, state: MutableRunState, pages: number[], recipes: RenderRecipe[], options: ResolvedOptions, expectedModel: AccessKeyModel, guard: WorkGuard): Promise<void> {
  const exhaustive = options.ocr === "always" || options.performance === "accurate";
  let pending = exhaustive ? [...pages] : pages.filter((page) => !hasPageEvidence(state.evidence, page));

  if (pending.length === 0) {
    return;
  }

  const [{ renderPage }, { readBarcodes }] = await Promise.all([import("./pdf/render-page"), import("./recognition/barcode-reader")]);

  for (let passIndex = 0; passIndex < recipes.length && pending.length > 0; passIndex += 1) {
    const recipe = recipes[passIndex];
    if (recipe === undefined) {
      break;
    }
    state.passesUsed = Math.max(state.passesUsed, passIndex + 1);
    const unresolved: number[] = [];
    for (const pageNumber of pending) {
      guard.check();
      const candidates = await withPage(handle, pageNumber, async (page) => {
        const rendered = await renderPage(page, recipe, options.maxPixelsPerPage);
        state.renderedPages.add(pageNumber);
        return (await readBarcodes(rendered)).flatMap((barcode) => findCandidatesInDecodedValue(barcode.text, pageNumber, barcode.source, passIndex + 1, expectedModel));
      });
      guard.check();
      state.evidence.push(...candidates);
      if (candidates.length === 0 || exhaustive) {
        unresolved.push(pageNumber);
      }
      if (options.stopAfterFirst && candidates.length > 0) {
        return;
      }
    }
    pending = unresolved;
  }
}

async function collectOcrEvidence(handle: PdfHandle, state: MutableRunState, pages: number[], recipes: RenderRecipe[], options: ResolvedOptions, expectedModel: AccessKeyModel, guard: WorkGuard): Promise<OcrSession | null> {
  if (options.ocr === "never") {
    return null;
  }
  const pending = options.ocr === "always" ? pages : pages.filter((page) => !hasPageEvidence(state.evidence, page));
  if (pending.length === 0) {
    return null;
  }

  const selectedRecipes = ocrRecipes(recipes, options);
  if (selectedRecipes.length === 0) {
    return null;
  }

  const [{ renderPage }, { createOcrSession }] = await Promise.all([import("./pdf/render-page"), import("./recognition/ocr-reader")]);
  const session = await createOcrSession();
  try {
    for (const pageNumber of pending) {
      for (const recipe of selectedRecipes) {
        guard.check();
        const candidates = await withPage(handle, pageNumber, async (page) => {
          const rendered = await renderPage(page, recipe, options.maxPixelsPerPage);
          state.renderedPages.add(pageNumber);
          state.ocrPages.add(pageNumber);
          const recognized = await session.recognize(rendered.toPng());
          return findCandidatesInOcrText(recognized.text, pageNumber, recipes.indexOf(recipe) + 1, recognized.confidence, expectedModel);
        });
        guard.check();
        state.evidence.push(...candidates);
        if (options.stopAfterFirst && candidates.length > 0) {
          return session;
        }
      }
    }
    return session;
  } catch (error) {
    await session.terminate().catch(() => undefined);
    throw error;
  }
}

async function extractAccessKeysForModel<TModel extends AccessKeyModel>(input: PdfInput, expectedModel: TModel, optionsInput: ExtractOptions = {}): Promise<ExtractionResult<TModel>> {
  const startedAt = performance.now();
  let options: ResolvedOptions;
  try {
    options = resolveOptions(optionsInput);
  } catch (error) {
    if (error instanceof InvalidOptionsError) {
      return invalidOptionsResult(expectedModel, error, startedAt);
    }
    return invalidOptionsResult(expectedModel, new InvalidOptionsError("Extraction options are invalid."), startedAt);
  }

  const state = emptyState();
  const guard = new WorkGuard(options, startedAt);
  let handle: PdfHandle | null = null;
  let ocrSession: OcrSession | null = null;
  try {
    guard.check();
    const loaded = await loadPdfInput(input, options.maxFileSizeBytes, {
      ...(options.requestHeaders === undefined ? {} : { requestHeaders: options.requestHeaders }),
      signal: guard.signal,
    });
    guard.check();
    state.fileSizeBytes = loaded.size;
    handle = await openPdfDocument(loaded.data, options.maxSourceImagePixels, options.maxPixelsPerPage);
    guard.check();
    state.pagesTotal = handle.document.numPages;
    const pageLimit = Math.min(state.pagesTotal, options.maxPages);
    if (pageLimit < state.pagesTotal) {
      state.complete = false;
      state.warnings.push(`Only the first ${pageLimit} of ${state.pagesTotal} pages were processed because of maxPages.`);
    }

    const processedPages = await collectTextEvidence(handle, state, pageLimit, options, expectedModel, guard);
    if (!(options.stopAfterFirst && state.evidence.length > 0)) {
      const recipes = getRenderRecipes(options);
      await collectBarcodeEvidence(handle, state, processedPages, recipes, options, expectedModel, guard);
      if (!(options.stopAfterFirst && state.evidence.length > 0)) {
        ocrSession = await collectOcrEvidence(handle, state, processedPages, recipes, options, expectedModel, guard);
      }
    }

    guard.check();
    if (options.stopAfterFirst && state.evidence.length > 0) {
      state.complete = true;
    }
    return resultFromState(expectedModel, options, state, startedAt);
  } catch (error) {
    state.complete = false;
    let resolvedError: unknown = error;
    try {
      guard.check();
    } catch (guardError) {
      resolvedError = guardError;
    }
    const failure =
      resolvedError instanceof ExtractionFailure
        ? resolvedError
        : new ExtractionFailure("PROCESSING_ERROR", "The PDF could not be processed.", {
            cause: resolvedError,
          });
    if (!(resolvedError instanceof ExtractionFailure)) {
      state.warnings.push(`Internal detail: ${messageFromUnknown(resolvedError)}`);
    }
    return resultFromState(expectedModel, options, state, startedAt, {
      code: failure.code,
      message: failure.message,
    });
  } finally {
    guard.dispose();
    await ocrSession?.terminate().catch(() => undefined);
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Extracts validated NF-e (model 55) access keys from a local path, HTTP(S)
 * URL, or in-memory PDF.
 * This function resolves to a JSON-safe result for expected input and processing errors.
 */
export function extractNFeAccessKeys(input: PdfInput, optionsInput: ExtractOptions = {}): Promise<ExtractionResult<"55">> {
  return extractAccessKeysForModel(input, "55", optionsInput);
}

/**
 * Extracts validated NFC-e (model 65) access keys from a local path, HTTP(S)
 * URL, or in-memory PDF.
 * This function resolves to a JSON-safe result for expected input and processing errors.
 */
export function extractNFCeAccessKeys(input: PdfInput, optionsInput: ExtractOptions = {}): Promise<ExtractionResult<"65">> {
  return extractAccessKeysForModel(input, "65", optionsInput);
}

export type { ExtractedAccessKey };
