import { extractNFCeAccessKeys, extractNFeAccessKeys } from "../extractor";
import type { ExtractOptions, ExtractionResult } from "../types";

export interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
}

interface ParsedCliArguments {
  source: string;
  documentType: "nfe" | "nfce";
  options: ExtractOptions;
  pretty: boolean;
}

const HELP = {
  name: "Cerne Fiscal",
  usage: "cerne-fiscal <document-path-or-url> --document-type nfe|nfce [--performance fast|balanced|accurate] [--passes 1..5]",
  inputFormats: ["pdf", "jpeg", "png"],
  examples: ["cerne-fiscal ./nota.pdf --document-type nfe --pretty", "cerne-fiscal ./cupom.jpg --document-type nfce --performance balanced", "cerne-fiscal https://documents.example/cupom.png --document-type nfce --pretty"],
  options: ["--document-type <nfe|nfce>", "--performance <profile>", "--passes <number>", "--ocr <never|fallback|always>", "--max-pages <number>", "--max-file-size <bytes>", "--max-pixels <number>", "--max-source-pixels <number>", "--timeout-ms <number>", "--first", "--pretty", "--help"],
} as const;

class CliArgumentError extends Error {}

function integer(value: string | undefined, option: string): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new CliArgumentError(`${option} requires a non-negative integer.`);
  }
  return Number(value);
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new CliArgumentError(`${option} requires a value.`);
  }
  return value;
}

export function parseCliArguments(args: string[]): ParsedCliArguments | typeof HELP {
  if (args.includes("--help")) {
    return HELP;
  }

  const options: ExtractOptions = {};
  const sources: string[] = [];
  let documentType: ParsedCliArguments["documentType"] | undefined;
  let pretty = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith("--")) {
      sources.push(argument);
      continue;
    }
    switch (argument) {
      case "--document-type": {
        const value = requiredValue(args, index, argument);
        if (value !== "nfe" && value !== "nfce") {
          throw new CliArgumentError("--document-type must be nfe or nfce.");
        }
        documentType = value;
        index += 1;
        break;
      }
      case "--performance":
        options.performance = requiredValue(args, index, argument) as ExtractOptions["performance"];
        index += 1;
        break;
      case "--passes":
        options.passes = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--ocr":
        options.ocr = requiredValue(args, index, argument) as ExtractOptions["ocr"];
        index += 1;
        break;
      case "--max-pages":
        options.maxPages = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--max-file-size":
        options.maxFileSizeBytes = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--max-pixels":
        options.maxPixelsPerPage = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--max-source-pixels":
        options.maxSourceImagePixels = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--first":
        options.stopAfterFirst = true;
        break;
      case "--pretty":
        pretty = true;
        break;
      default:
        throw new CliArgumentError(`Unknown option: ${argument}.`);
    }
  }
  if (sources.length !== 1) {
    throw new CliArgumentError("Exactly one document path or HTTP(S) URL (PDF, JPEG, or PNG) is required.");
  }
  if (documentType === undefined) {
    throw new CliArgumentError("--document-type is required and must be nfe or nfce.");
  }
  return { source: sources[0]!, documentType, options, pretty };
}

function cliError(message: string): ExtractionResult {
  return {
    status: "error",
    success: false,
    precisionScore: 0,
    bestMatch: null,
    results: [],
    metadata: {
      performance: "balanced",
      ocrMode: "fallback",
      passesRequested: 2,
      passesUsed: 0,
      pagesTotal: 0,
      pagesProcessed: 0,
      pagesRendered: 0,
      renderAttempts: 0,
      ocrPages: 0,
      fileSizeBytes: 0,
      maxPixelsPerPage: 12_000_000,
      maxSourceImagePixels: 60_000_000,
      durationMs: 0,
      complete: false,
      confidenceVersion: "1.0.0",
    },
    warnings: [],
    error: { code: "INVALID_INPUT", message },
  };
}

export async function runCli(args: string[], io: CliIo = { stdout: process.stdout }): Promise<number> {
  try {
    const parsed = parseCliArguments(args);
    if ("name" in parsed) {
      io.stdout.write(`${JSON.stringify(HELP, null, 2)}\n`);
      return 0;
    }
    const result = await (parsed.documentType === "nfe" ? extractNFeAccessKeys : extractNFCeAccessKeys)(parsed.source, parsed.options);
    io.stdout.write(`${JSON.stringify(result, null, parsed.pretty ? 2 : undefined)}\n`);
    if (result.success) {
      return 0;
    }
    return result.status === "not_found" ? 2 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid CLI arguments.";
    io.stdout.write(`${JSON.stringify(cliError(message))}\n`);
    return 1;
  }
}
