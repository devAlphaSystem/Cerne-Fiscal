import { validateHeaderName, validateHeaderValue } from "node:http";
import { resolve as resolvePath } from "node:path";

import type { DocumentFormat, ExtractOptions, OcrMode, PerformanceProfile, StreamStorage } from "./types";

const MEBIBYTE = 1024 * 1024;

const BLOCKED_REQUEST_HEADERS = new Set(["accept-encoding", "connection", "content-length", "expect", "host", "if-range", "keep-alive", "proxy-connection", "range", "te", "trailer", "transfer-encoding", "upgrade"]);

/**
 * Keeps a streamed input in memory until it grows large enough to be worth a temporary file.
 *
 * A DANFE, whether native PDF or a photograph of one, sits far below this threshold, so the common case never
 * touches the disk while an unexpectedly large upload stops competing with the render surfaces that dominate
 * extraction memory.
 */
export const DEFAULT_STREAM_MEMORY_THRESHOLD_BYTES = 8 * MEBIBYTE;

/**
 * Selects the storage policy applied to stream inputs when the caller does not choose one.
 */
export const DEFAULT_STREAM_STORAGE: StreamStorage = "auto";

interface ProfileDefaults {
  passes: number;
  ocr: OcrMode;
  maxPages: number;
  maxPixelsPerPage: number;
  maxSourceImagePixels: number;
  timeoutMs: number;
}

const PROFILE_DEFAULTS: Record<PerformanceProfile, ProfileDefaults> = {
  fast: {
    passes: 1,
    ocr: "never",
    maxPages: 10,
    maxPixelsPerPage: 8_000_000,
    maxSourceImagePixels: 40_000_000,
    timeoutMs: 30_000,
  },
  balanced: {
    passes: 2,
    ocr: "fallback",
    maxPages: 30,
    maxPixelsPerPage: 12_000_000,
    maxSourceImagePixels: 60_000_000,
    timeoutMs: 120_000,
  },
  accurate: {
    passes: 3,
    ocr: "fallback",
    maxPages: 50,
    maxPixelsPerPage: 20_000_000,
    maxSourceImagePixels: 100_000_000,
    timeoutMs: 300_000,
  },
};

/**
 * Represents validated extraction settings with profile defaults applied.
 */
export interface ResolvedOptions {
  /**
   * Identifies the selected performance profile.
   */
  performance: PerformanceProfile;
  /**
   * Specifies the number of render and recognition passes to use.
   */
  passes: number;
  /**
   * Specifies when OCR participates in recognition.
   */
  ocr: OcrMode;
  /**
   * Limits the number of pages processed from the beginning of a document.
   */
  maxPages: number;
  /**
   * Limits accepted document size in bytes.
   */
  maxFileSizeBytes: number;
  /**
   * Selects where a stream input is held while it is consumed; path, URL, and in-memory inputs ignore it.
   */
  streamStorage: StreamStorage;
  /**
   * Sets the byte count an `auto` stream may hold in memory before migrating to a temporary file.
   */
  streamMemoryThresholdBytes: number;
  /**
   * Stores the resolved directory that receives extractor-owned temporary stream files, when the caller supplied one.
   */
  streamTempDirectory?: string;
  /**
   * Limits pixel allocation for an individual rendered page.
   */
  maxPixelsPerPage: number;
  /**
   * Limits the declared pixel area of a source image.
   */
  maxSourceImagePixels: number;
  /**
   * Limits total extraction time in milliseconds, with zero disabling the deadline.
   */
  timeoutMs: number;
  /**
   * Indicates whether recognition stops after the first valid key is found.
   */
  stopAfterFirst: boolean;
  /**
   * Provides normalized caller headers for an HTTP(S) document request.
   */
  requestHeaders?: Readonly<Record<string, string>>;
  /**
   * Provides the caller signal used to cancel extraction.
   */
  signal?: AbortSignal;
}

/**
 * Reports an invalid extraction option or an unsupported option combination.
 *
 * @class
 */
export class InvalidOptionsError extends Error {
  /**
   * Creates an invalid-options error with a safe caller-facing message.
   *
   * @param {string} message - Explains which extraction option is invalid.
   */
  public constructor(message: string) {
    super(message);
    this.name = "InvalidOptionsError";
  }
}

function integerInRange(name: string, value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new InvalidOptionsError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function normalizeRequestHeaders(requestHeaders: ExtractOptions["requestHeaders"]): Readonly<Record<string, string>> | undefined {
  if (requestHeaders === undefined) {
    return undefined;
  }
  if (typeof requestHeaders !== "object" || requestHeaders === null || Array.isArray(requestHeaders)) {
    throw new InvalidOptionsError("requestHeaders must be a record of strings.");
  }

  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(requestHeaders) as object | null;
  } catch {
    throw new InvalidOptionsError("requestHeaders could not be read.");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidOptionsError("requestHeaders must be a record of strings.");
  }

  const normalized = Object.create(null) as Record<string, string>;
  let entries: [string, unknown][];
  try {
    entries = Object.entries(requestHeaders);
  } catch {
    throw new InvalidOptionsError("requestHeaders could not be read.");
  }

  for (const [name, value] of entries) {
    const normalizedName = name.toLowerCase();
    if (typeof value !== "string") {
      throw new InvalidOptionsError("Every requestHeaders value must be a string.");
    }
    try {
      validateHeaderName(name);
      validateHeaderValue(name, value);
    } catch {
      throw new InvalidOptionsError("requestHeaders contains an invalid header.");
    }
    if (BLOCKED_REQUEST_HEADERS.has(normalizedName)) {
      throw new InvalidOptionsError("requestHeaders contains a header that cannot be overridden.");
    }
    if (Object.hasOwn(normalized, normalizedName)) {
      throw new InvalidOptionsError("requestHeaders contains duplicate case-insensitive names.");
    }
    normalized[normalizedName] = value;
  }
  return Object.freeze(normalized);
}

function validateSignal(signal: ExtractOptions["signal"]): void {
  if (signal === undefined) {
    return;
  }
  if (typeof signal !== "object" || signal === null || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function") {
    throw new InvalidOptionsError("signal must be an AbortSignal.");
  }
}

function normalizeTempDirectory(directory: ExtractOptions["streamTempDirectory"]): string | undefined {
  if (directory === undefined) {
    return undefined;
  }
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new InvalidOptionsError("streamTempDirectory must be a non-empty path to an existing directory.");
  }
  return resolvePath(directory);
}

function booleanOrDefault(name: string, value: boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new InvalidOptionsError(`${name} must be a boolean.`);
  }
  return value;
}

/**
 * Validates extraction options and applies defaults from the selected performance profile.
 *
 * @param {ExtractOptions} [options={}] - Supplies caller overrides for extraction behavior and limits.
 * @returns {ResolvedOptions} Returns normalized settings ready for the extraction pipeline.
 * @throws {InvalidOptionsError} Throws when an option is outside its supported range, headers are invalid, the cancellation signal is not an AbortSignal, or a flag is not a boolean.
 *
 * @example
 * const options = resolveOptions({ performance: "fast", passes: 1, timeoutMs: 15_000 });
 */
export function resolveOptions(options: ExtractOptions = {}): ResolvedOptions {
  const performance = options.performance ?? "balanced";
  if (!Object.hasOwn(PROFILE_DEFAULTS, performance)) {
    throw new InvalidOptionsError("performance must be fast, balanced, or accurate.");
  }

  const profile = PROFILE_DEFAULTS[performance];
  const ocr = options.ocr ?? profile.ocr;
  if (!["never", "fallback", "always"].includes(ocr)) {
    throw new InvalidOptionsError("ocr must be never, fallback, or always.");
  }

  const streamStorage = options.streamStorage ?? DEFAULT_STREAM_STORAGE;
  if (!["memory", "file", "auto"].includes(streamStorage)) {
    throw new InvalidOptionsError("streamStorage must be memory, file, or auto.");
  }

  const requestHeaders = normalizeRequestHeaders(options.requestHeaders);
  const streamTempDirectory = normalizeTempDirectory(options.streamTempDirectory);
  validateSignal(options.signal);

  return {
    performance,
    passes: integerInRange("passes", options.passes, profile.passes, 1, 5),
    ocr,
    maxPages: integerInRange("maxPages", options.maxPages, profile.maxPages, 1, 10_000),
    maxFileSizeBytes: integerInRange("maxFileSizeBytes", options.maxFileSizeBytes, 30 * MEBIBYTE, 1, 1024 * MEBIBYTE),
    streamStorage,
    streamMemoryThresholdBytes: integerInRange("streamMemoryThresholdBytes", options.streamMemoryThresholdBytes, DEFAULT_STREAM_MEMORY_THRESHOLD_BYTES, 1, 1024 * MEBIBYTE),
    ...(streamTempDirectory === undefined ? {} : { streamTempDirectory }),
    maxPixelsPerPage: integerInRange("maxPixelsPerPage", options.maxPixelsPerPage, profile.maxPixelsPerPage, 250_000, 100_000_000),
    maxSourceImagePixels: integerInRange("maxSourceImagePixels", options.maxSourceImagePixels, profile.maxSourceImagePixels, 250_000, 200_000_000),
    timeoutMs: integerInRange("timeoutMs", options.timeoutMs, profile.timeoutMs, 0, 3_600_000),
    stopAfterFirst: booleanOrDefault("stopAfterFirst", options.stopAfterFirst, false),
    ...(requestHeaders === undefined ? {} : { requestHeaders }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

/**
 * Describes one page-rendering transformation used by barcode recognition or OCR.
 */
export interface RenderRecipe {
  /**
   * Scales the source page before recognition.
   */
  scale: number;
  /**
   * Rotates the rendered page clockwise by a supported right angle.
   */
  rotation: 0 | 90 | 180 | 270;
  /**
   * Enables contrast stretching when the source has a narrow luminance range.
   */
  contrast?: boolean;
  /**
   * Converts rendered pixels to grayscale before recognition.
   */
  grayscale?: boolean;
  /**
   * Crops uniform outer margins when a safe content boundary is detected.
   */
  crop?: boolean;
  /**
   * Enlarges small source images before recognition.
   */
  upscaleSmall?: boolean;
  /**
   * Targets a maximum output pixel area for this recipe.
   */
  targetPixels?: number;
}

const RECIPES: Record<PerformanceProfile, readonly RenderRecipe[]> = {
  fast: [
    { scale: 1.25, rotation: 0 },
    { scale: 1.6, rotation: 0 },
    { scale: 2, rotation: 0 },
    { scale: 1.6, rotation: 90 },
    { scale: 1.6, rotation: 270 },
  ],
  balanced: [
    { scale: 1.5, rotation: 0 },
    { scale: 2, rotation: 0 },
    { scale: 2.5, rotation: 0 },
    { scale: 2, rotation: 90 },
    { scale: 2, rotation: 270 },
  ],
  accurate: [
    { scale: 1.75, rotation: 0 },
    { scale: 2.25, rotation: 0 },
    { scale: 3, rotation: 0 },
    { scale: 2.25, rotation: 90 },
    { scale: 2.25, rotation: 270 },
  ],
};

const IMAGE_DOWNSCALE_TARGET_PIXELS = 1_200_000;

const IMAGE_RECIPES: Record<PerformanceProfile, readonly RenderRecipe[]> = {
  fast: [
    { scale: 1, rotation: 0 },
    { scale: 1, rotation: 0, targetPixels: IMAGE_DOWNSCALE_TARGET_PIXELS, contrast: true, grayscale: true, crop: true, upscaleSmall: true },
    { scale: 1, rotation: 90, crop: true },
    { scale: 1, rotation: 270, crop: true },
    { scale: 1, rotation: 180, crop: true },
  ],
  balanced: [
    { scale: 1, rotation: 0 },
    { scale: 1, rotation: 0, targetPixels: IMAGE_DOWNSCALE_TARGET_PIXELS, contrast: true, grayscale: true, crop: true, upscaleSmall: true },
    { scale: 1, rotation: 90, crop: true },
    { scale: 1, rotation: 270, crop: true },
    { scale: 1, rotation: 180, crop: true },
  ],
  accurate: [
    { scale: 1, rotation: 0 },
    { scale: 1, rotation: 0, targetPixels: IMAGE_DOWNSCALE_TARGET_PIXELS, contrast: true, grayscale: true, crop: true, upscaleSmall: true },
    { scale: 1, rotation: 90, crop: true },
    { scale: 1, rotation: 270, crop: true },
    { scale: 1, rotation: 180, crop: true },
  ],
};

/**
 * Selects the ordered render recipes enabled by resolved options and document format.
 *
 * @param {ResolvedOptions} options - Supplies the validated profile and pass count.
 * @param {DocumentFormat} [format="pdf"] - Identifies the input format whose recipes are required.
 * @returns {Array<RenderRecipe>} Returns a mutable copy containing at most the requested number of passes.
 */
export function getRenderRecipes(options: ResolvedOptions, format: DocumentFormat = "pdf"): RenderRecipe[] {
  const recipes = format === "pdf" ? RECIPES[options.performance] : IMAGE_RECIPES[options.performance];
  return recipes.slice(0, options.passes);
}

const IMAGE_BARCODE_TARGET_LADDER = [4_500_000, 2_200_000, 1_450_000, 950_000] as const;

/**
 * Expands an image barcode recipe into descending pixel targets for resilient decoding.
 *
 * @param {RenderRecipe} recipe - Supplies the base render transformation.
 * @param {DocumentFormat} format - Identifies whether PDF or image rendering is being configured.
 * @returns {Array<RenderRecipe>} Returns the original recipe when no expansion applies, otherwise target-specific image variants.
 */
export function getBarcodeRenderVariants(recipe: RenderRecipe, format: DocumentFormat): RenderRecipe[] {
  if (format === "pdf" || recipe.targetPixels === undefined) {
    return [recipe];
  }
  return IMAGE_BARCODE_TARGET_LADDER.map((targetPixels) => ({ ...recipe, targetPixels }));
}
