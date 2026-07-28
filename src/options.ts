import { validateHeaderName, validateHeaderValue } from "node:http";

import type { ExtractOptions, OcrMode, PerformanceProfile } from "./types";

const MEBIBYTE = 1024 * 1024;

const BLOCKED_REQUEST_HEADERS = new Set(["accept-encoding", "connection", "content-length", "expect", "host", "if-range", "keep-alive", "proxy-connection", "range", "te", "trailer", "transfer-encoding", "upgrade"]);

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

export interface ResolvedOptions {
  performance: PerformanceProfile;
  passes: number;
  ocr: OcrMode;
  maxPages: number;
  maxFileSizeBytes: number;
  maxPixelsPerPage: number;
  maxSourceImagePixels: number;
  timeoutMs: number;
  stopAfterFirst: boolean;
  requestHeaders?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export class InvalidOptionsError extends Error {
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

  const requestHeaders = normalizeRequestHeaders(options.requestHeaders);

  return {
    performance,
    passes: integerInRange("passes", options.passes, profile.passes, 1, 5),
    ocr,
    maxPages: integerInRange("maxPages", options.maxPages, profile.maxPages, 1, 10_000),
    maxFileSizeBytes: integerInRange("maxFileSizeBytes", options.maxFileSizeBytes, 30 * MEBIBYTE, 1, 1024 * MEBIBYTE),
    maxPixelsPerPage: integerInRange("maxPixelsPerPage", options.maxPixelsPerPage, profile.maxPixelsPerPage, 250_000, 100_000_000),
    maxSourceImagePixels: integerInRange("maxSourceImagePixels", options.maxSourceImagePixels, profile.maxSourceImagePixels, 250_000, 200_000_000),
    timeoutMs: integerInRange("timeoutMs", options.timeoutMs, profile.timeoutMs, 0, 3_600_000),
    stopAfterFirst: options.stopAfterFirst ?? false,
    ...(requestHeaders === undefined ? {} : { requestHeaders }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

export interface RenderRecipe {
  scale: number;
  rotation: 0 | 90 | 270;
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

export function getRenderRecipes(options: ResolvedOptions): RenderRecipe[] {
  return RECIPES[options.performance].slice(0, options.passes);
}
