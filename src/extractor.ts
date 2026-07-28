import { findCandidatesInDecodedValue, findCandidatesInText } from "./candidates/from-text";
import { findCandidatesInOcrText } from "./candidates/from-ocr";
import type { CandidateEvidence } from "./candidates/types";
import { WorkGuard } from "./deadline";
import { loadDocumentInput } from "./document/load-input";
import { openDocument } from "./document/open-document";
import type { DocumentHandle, DocumentPageLike, DocumentPageText } from "./document/types";
import { ExtractionFailure } from "./errors";
import { getBarcodeRenderVariants, getRenderRecipes, InvalidOptionsError, resolveOptions, type RenderRecipe, type ResolvedOptions } from "./options";
import type { OcrSession } from "./recognition/ocr-reader";
import { mergeEvidence } from "./scoring/merge-results";
import { elapsedMilliseconds, startTimer, type MonotonicTimestamp } from "./timing";
import type { DocumentFormat, DocumentInput, ExtractOptions, ExtractedAccessKey, ExtractionErrorInfo, ExtractionMetadata, ExtractionResult, ExtractionStatus } from "./types";
import type { AccessKeyModel } from "./validation/access-key";

interface MutableRunState {
  evidence: CandidateEvidence[];
  warnings: string[];
  inputFormat: DocumentFormat | null;
  pagesTotal: number;
  pagesProcessed: number;
  renderedPages: Set<number>;
  ocrPages: Set<number>;
  renderAttempts: number;
  passesUsed: number;
  fileSizeBytes: number;
  sourceImageWidth: number | null;
  sourceImageHeight: number | null;
  complete: boolean;
}

function emptyState(): MutableRunState {
  return {
    evidence: [],
    warnings: [],
    inputFormat: null,
    pagesTotal: 0,
    pagesProcessed: 0,
    renderedPages: new Set(),
    ocrPages: new Set(),
    renderAttempts: 0,
    passesUsed: 0,
    fileSizeBytes: 0,
    sourceImageWidth: null,
    sourceImageHeight: null,
    complete: true,
  };
}

function textEvidence(pageText: DocumentPageText, page: number, expectedModel: AccessKeyModel): CandidateEvidence[] {
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

function metadata(options: ResolvedOptions, state: MutableRunState, startedAt: MonotonicTimestamp): ExtractionMetadata {
  return {
    performance: options.performance,
    ocrMode: options.ocr,
    ...(state.inputFormat === null ? {} : { inputFormat: state.inputFormat }),
    passesRequested: options.passes,
    passesUsed: state.passesUsed,
    pagesTotal: state.pagesTotal,
    pagesProcessed: state.pagesProcessed,
    pagesRendered: state.renderedPages.size,
    renderAttempts: state.renderAttempts,
    ocrPages: state.ocrPages.size,
    fileSizeBytes: state.fileSizeBytes,
    ...(state.sourceImageWidth === null ? {} : { sourceImageWidth: state.sourceImageWidth }),
    ...(state.sourceImageHeight === null ? {} : { sourceImageHeight: state.sourceImageHeight }),
    maxPixelsPerPage: options.maxPixelsPerPage,
    maxSourceImagePixels: options.maxSourceImagePixels,
    durationMs: elapsedMilliseconds(startedAt),
    complete: state.complete,
    confidenceVersion: "1.0.0",
  };
}

function resultFromState<TModel extends AccessKeyModel>(expectedModel: TModel, options: ResolvedOptions, state: MutableRunState, startedAt: MonotonicTimestamp, error: ExtractionErrorInfo | null = null): ExtractionResult<TModel> {
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

function finalizeResultDuration<TModel extends AccessKeyModel>(result: ExtractionResult<TModel>, startedAt: MonotonicTimestamp): ExtractionResult<TModel> {
  result.metadata.durationMs = elapsedMilliseconds(startedAt);
  return result;
}

function invalidOptionsResult<TModel extends AccessKeyModel>(expectedModel: TModel, error: InvalidOptionsError, startedAt: MonotonicTimestamp): ExtractionResult<TModel> {
  const options = resolveOptions();
  const state = emptyState();
  state.complete = false;
  return resultFromState(expectedModel, options, state, startedAt, {
    code: "INVALID_OPTIONS",
    message: error.message,
  });
}

async function withPage<T>(handle: DocumentHandle, pageNumber: number, work: (page: DocumentPageLike) => Promise<T>): Promise<T> {
  const page = await handle.getPage(pageNumber);
  try {
    return await work(page);
  } finally {
    page.cleanup();
  }
}

function ocrRecipes(recipes: RenderRecipe[], options: ResolvedOptions, format: DocumentFormat): RenderRecipe[] {
  if (format !== "pdf") {
    return recipes;
  }
  const unrotated = recipes.filter((recipe) => recipe.rotation === 0).sort((left, right) => right.scale - left.scale)[0];
  const selected = unrotated === undefined ? [] : [unrotated];
  if (options.performance === "accurate") {
    selected.push(...recipes.filter((recipe) => recipe.rotation !== 0));
  }
  return selected;
}

async function collectTextEvidence(handle: DocumentHandle, state: MutableRunState, pageLimit: number, options: ResolvedOptions, expectedModel: AccessKeyModel, guard: WorkGuard): Promise<number[]> {
  const processedPages: number[] = [];
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    guard.check();
    const candidates = await withPage(handle, pageNumber, async (page) => {
      const nativeText = page.nativeText();
      return nativeText === null ? [] : textEvidence(await nativeText, pageNumber, expectedModel);
    });
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

async function collectBarcodeEvidence(handle: DocumentHandle, state: MutableRunState, pages: number[], recipes: RenderRecipe[], options: ResolvedOptions, expectedModel: AccessKeyModel, guard: WorkGuard): Promise<void> {
  const exhaustive = options.ocr === "always" || options.performance === "accurate";
  let pending = exhaustive ? [...pages] : pages.filter((page) => !hasPageEvidence(state.evidence, page));

  if (pending.length === 0) {
    return;
  }

  const { readBarcodes } = await import("./recognition/barcode-reader");

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
        const collected: CandidateEvidence[] = [];
        const attemptedRenderKeys = new Set<string>();
        const attemptedSizes = new Set<string>();
        for (const variant of getBarcodeRenderVariants(recipe, handle.format)) {
          guard.check();
          const renderKey = page.renderKey?.(variant, options.maxPixelsPerPage);
          if (renderKey !== undefined && attemptedRenderKeys.has(renderKey)) {
            continue;
          }
          const rendered = await page.render(variant, options.maxPixelsPerPage);
          state.renderAttempts += 1;
          try {
            if (renderKey !== undefined) {
              attemptedRenderKeys.add(renderKey);
            }
            const sizeKey = `${rendered.width}x${rendered.height}`;
            if (attemptedSizes.has(sizeKey)) {
              continue;
            }
            attemptedSizes.add(sizeKey);
            state.renderedPages.add(pageNumber);
            collected.push(...(await readBarcodes(rendered, handle.format !== "pdf", () => guard.check())).flatMap((barcode) => findCandidatesInDecodedValue(barcode.text, pageNumber, barcode.source, passIndex + 1, expectedModel)));
            if (collected.length > 0) {
              break;
            }
          } finally {
            rendered.dispose();
          }
        }
        return collected;
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

async function collectOcrEvidence(handle: DocumentHandle, state: MutableRunState, pages: number[], recipes: RenderRecipe[], options: ResolvedOptions, expectedModel: AccessKeyModel, guard: WorkGuard): Promise<OcrSession | null> {
  if (options.ocr === "never") {
    return null;
  }
  const pending = options.ocr === "always" ? pages : pages.filter((page) => !hasPageEvidence(state.evidence, page));
  if (pending.length === 0) {
    return null;
  }

  const selectedRecipes = ocrRecipes(recipes, options, handle.format);
  if (selectedRecipes.length === 0) {
    return null;
  }

  const { createOcrSession } = await import("./recognition/ocr-reader");
  const session = await createOcrSession();
  try {
    for (const pageNumber of pending) {
      for (const recipe of selectedRecipes) {
        guard.check();
        const candidates = await withPage(handle, pageNumber, async (page) => {
          const rendered = await page.render(recipe, options.maxPixelsPerPage);
          state.renderAttempts += 1;
          try {
            state.renderedPages.add(pageNumber);
            state.ocrPages.add(pageNumber);
            const png = await rendered.toPng();
            guard.check();
            const recognized = await session.recognize(png);
            return findCandidatesInOcrText(recognized.text, pageNumber, recipes.indexOf(recipe) + 1, recognized.confidence, expectedModel);
          } finally {
            rendered.dispose();
          }
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

async function extractAccessKeysForModel<TModel extends AccessKeyModel>(input: DocumentInput, expectedModel: TModel, optionsInput: ExtractOptions, startedAt: MonotonicTimestamp): Promise<ExtractionResult<TModel>> {
  let options: ResolvedOptions;
  try {
    options = resolveOptions(optionsInput);
  } catch (error) {
    if (error instanceof InvalidOptionsError) {
      return finalizeResultDuration(invalidOptionsResult(expectedModel, error, startedAt), startedAt);
    }
    return finalizeResultDuration(invalidOptionsResult(expectedModel, new InvalidOptionsError("Extraction options are invalid."), startedAt), startedAt);
  }

  const state = emptyState();
  const guard = new WorkGuard(options, startedAt);
  let handle: DocumentHandle | null = null;
  let ocrSession: OcrSession | null = null;
  let result: ExtractionResult<TModel>;
  try {
    guard.check();
    const loaded = await loadDocumentInput(input, options.maxFileSizeBytes, {
      ...(options.requestHeaders === undefined ? {} : { requestHeaders: options.requestHeaders }),
      signal: guard.signal,
    });
    guard.check();
    state.fileSizeBytes = loaded.size;
    state.inputFormat = loaded.format;
    handle = await openDocument(loaded, options.maxSourceImagePixels, options.maxPixelsPerPage);
    guard.check();
    state.pagesTotal = handle.numPages;
    state.sourceImageWidth = handle.sourceImageDimensions?.width ?? null;
    state.sourceImageHeight = handle.sourceImageDimensions?.height ?? null;
    const pageLimit = Math.min(state.pagesTotal, options.maxPages);
    if (pageLimit < state.pagesTotal) {
      state.complete = false;
      state.warnings.push(`Only the first ${pageLimit} of ${state.pagesTotal} pages were processed because of maxPages.`);
    }

    const processedPages = await collectTextEvidence(handle, state, pageLimit, options, expectedModel, guard);
    if (!(options.stopAfterFirst && state.evidence.length > 0)) {
      const recipes = getRenderRecipes(options, handle.format);
      await collectBarcodeEvidence(handle, state, processedPages, recipes, options, expectedModel, guard);
      if (!(options.stopAfterFirst && state.evidence.length > 0)) {
        ocrSession = await collectOcrEvidence(handle, state, processedPages, recipes, options, expectedModel, guard);
      }
    }

    guard.check();
    if (options.stopAfterFirst && state.evidence.length > 0) {
      state.complete = true;
    }
    result = resultFromState(expectedModel, options, state, startedAt);
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
        : new ExtractionFailure("PROCESSING_ERROR", "The document could not be processed.", {
            cause: resolvedError,
          });
    result = resultFromState(expectedModel, options, state, startedAt, {
      code: failure.code,
      message: failure.message,
    });
  } finally {
    guard.dispose();
    await Promise.all([ocrSession?.terminate().catch(() => undefined), handle?.close().catch(() => undefined)]);
  }
  return finalizeResultDuration(result, startedAt);
}

/**
 * Extracts validated NF-e (model 55) access keys from a local path, HTTP(S)
 * URL, or in-memory PDF, JPEG, or PNG document.
 * This function resolves to a JSON-safe result for expected input and processing errors.
 */
export function extractNFeAccessKeys(input: DocumentInput, optionsInput: ExtractOptions = {}): Promise<ExtractionResult<"55">> {
  const startedAt = startTimer();
  return extractAccessKeysForModel(input, "55", optionsInput, startedAt);
}

/**
 * Extracts validated NFC-e (model 65) access keys from a local path, HTTP(S)
 * URL, or in-memory PDF, JPEG, or PNG document.
 * This function resolves to a JSON-safe result for expected input and processing errors.
 */
export function extractNFCeAccessKeys(input: DocumentInput, optionsInput: ExtractOptions = {}): Promise<ExtractionResult<"65">> {
  const startedAt = startTimer();
  return extractAccessKeysForModel(input, "65", optionsInput, startedAt);
}

export type { ExtractedAccessKey };
