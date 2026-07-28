import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";

import { ExtractionFailure } from "../errors";
import { DEFAULT_STREAM_MEMORY_THRESHOLD_BYTES, DEFAULT_STREAM_STORAGE } from "../options";
import type { DocumentFormat, DocumentInput, StreamStorage } from "../types";
import { detectDocumentFormat } from "./detect-format";
import { captureStream, isAsyncByteSource } from "./read-stream";

const MAX_REDIRECTS = 5;
const INITIAL_DOWNLOAD_BUFFER_BYTES = 64 * 1024;
const MAX_INITIAL_CONTENT_LENGTH_ALLOCATION = 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const WINDOWS_DRIVE_PATH = /^[a-z]:/i;
const HTTP_URL = /^https?:\/\//i;
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

interface LoadedInputFields {
  /**
   * Reports the accepted document size in bytes.
   */
  size: number;
  /**
   * Identifies the format detected from the document signature.
   */
  format: DocumentFormat;
  /**
   * Releases the extractor-owned temporary file backing this input, if any. It never removes a caller-supplied path.
   */
  cleanup: () => Promise<void>;
}

/**
 * Represents validated document bytes resident in process memory.
 */
export interface LoadedBytes extends LoadedInputFields {
  /**
   * Provides an owned or safely copied view of the document bytes.
   */
  data: Uint8Array;
  /**
   * Marks the input as memory-resident.
   */
  path: null;
}

/**
 * Represents validated document bytes held in an extractor-owned temporary file.
 */
export interface LoadedFile extends LoadedInputFields {
  /**
   * Marks the input as file-backed.
   */
  data: null;
  /**
   * Locates the extractor-owned temporary file holding the validated bytes.
   */
  path: string;
}

/**
 * Represents validated document bytes together with their detected format, size, and storage.
 */
export type LoadedInput = LoadedBytes | LoadedFile;

/**
 * Defines request-specific controls used while loading a document input.
 */
export interface LoadDocumentInputControls {
  /**
   * Provides normalized headers for HTTP and HTTPS document requests.
   */
  requestHeaders?: Readonly<Record<string, string>>;
  /**
   * Provides cancellation for remote downloads, local file reads, and stream reads.
   */
  signal?: AbortSignal;
  /**
   * Selects where a `Readable` or async-iterable input is held while it is consumed, defaulting to `auto`.
   */
  streamStorage?: StreamStorage;
  /**
   * Sets the byte count an `auto` stream may hold in memory before migrating to a temporary file.
   */
  streamMemoryThresholdBytes?: number;
  /**
   * Selects the existing directory that receives extractor-owned temporary stream files.
   */
  streamTempDirectory?: string;
}

function noResources(): Promise<void> {
  return Promise.resolve();
}

function checkedFormat(data: Uint8Array): DocumentFormat {
  const format = detectDocumentFormat(data);
  if (format === null) {
    throw new ExtractionFailure("UNSUPPORTED_FORMAT", "The input bytes do not match a supported PDF, JPEG, or PNG signature.");
  }
  return format;
}

function validateDocumentBytes(header: Uint8Array, size: number, maxFileSizeBytes: number): DocumentFormat {
  if (size === 0) {
    throw new ExtractionFailure("INVALID_INPUT", "The document input is empty.");
  }
  if (size > maxFileSizeBytes) {
    throw new ExtractionFailure("FILE_TOO_LARGE", `The document exceeds the configured ${maxFileSizeBytes}-byte limit.`);
  }
  return checkedFormat(header);
}

function checkedBytes(data: Uint8Array, maxFileSizeBytes: number): LoadedInput {
  const format = validateDocumentBytes(data, data.byteLength, maxFileSizeBytes);
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  return { data: bytes, path: null, size: data.byteLength, format, cleanup: noResources };
}

function checkedOwnedBytes(data: Uint8Array, maxFileSizeBytes: number): LoadedInput {
  const format = validateDocumentBytes(data, data.byteLength, maxFileSizeBytes);
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return { data: bytes, path: null, size: data.byteLength, format, cleanup: noResources };
}

function checkedRemoteUrl(url: URL): URL {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExtractionFailure("INVALID_INPUT", "Only HTTP and HTTPS remote URLs are accepted.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ExtractionFailure("INVALID_INPUT", "URL credentials are not accepted; use requestHeaders instead.");
  }
  return url;
}

function remoteUrlFromInput(input: string): URL | null {
  const value = input.trim();
  if (value === "") {
    throw new ExtractionFailure("INVALID_INPUT", "A non-empty document path or HTTP(S) URL is required.");
  }
  if (WINDOWS_DRIVE_PATH.test(value)) {
    return null;
  }
  if (!HTTP_URL.test(value)) {
    if (URI_SCHEME.test(value)) {
      throw new ExtractionFailure("INVALID_INPUT", "Only complete HTTP and HTTPS remote URLs are accepted.");
    }
    return null;
  }

  try {
    return checkedRemoteUrl(new URL(value));
  } catch (error) {
    if (error instanceof ExtractionFailure) {
      throw error;
    }
    throw new ExtractionFailure("INVALID_INPUT", "The remote URL is invalid.", {
      cause: error,
    });
  }
}

function remoteHeaders(requestHeaders: Readonly<Record<string, string>> | undefined): Headers {
  try {
    const headers = new Headers(requestHeaders === undefined ? undefined : Object.entries(requestHeaders));
    headers.set("accept-encoding", "identity");
    return headers;
  } catch (error) {
    throw new ExtractionFailure("INVALID_OPTIONS", "requestHeaders contains an invalid header.", { cause: error });
  }
}

function stripCallerHeaders(headers: Headers, requestHeaders: Readonly<Record<string, string>> | undefined): void {
  for (const name of Object.keys(requestHeaders ?? {})) {
    headers.delete(name);
  }
}

function cancelResponse(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => undefined);
}

function advertisedSize(response: Response): bigint | null {
  const value = response.headers.get("content-length")?.trim();
  if (value === undefined || !/^\d+$/.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

async function readRemoteBody(response: Response, maxFileSizeBytes: number, signal: AbortSignal | undefined): Promise<LoadedInput> {
  const size = advertisedSize(response);
  if (size !== null && size > BigInt(maxFileSizeBytes)) {
    cancelResponse(response);
    throw new ExtractionFailure("FILE_TOO_LARGE", `The document exceeds the configured ${maxFileSizeBytes}-byte limit.`);
  }
  if (response.body === null) {
    throw new ExtractionFailure("DOWNLOAD_ERROR", "The remote document response did not contain a body.");
  }

  const advertisedInitialSize = size === null ? INITIAL_DOWNLOAD_BUFFER_BYTES : Math.min(Number(size), MAX_INITIAL_CONTENT_LENGTH_ALLOCATION);
  let data: Uint8Array<ArrayBuffer>;
  try {
    data = new Uint8Array(Math.min(maxFileSizeBytes, advertisedInitialSize));
  } catch (error) {
    await cancelResponse(response);
    throw new ExtractionFailure("RESOURCE_LIMIT", "The remote document could not be buffered within available memory.", { cause: error });
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (error) {
    throw new ExtractionFailure("DOWNLOAD_ERROR", "The remote document response could not be read.", { cause: error });
  }
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      if (chunk.value === undefined) {
        continue;
      }
      const requiredSize = total + chunk.value.byteLength;
      if (requiredSize > maxFileSizeBytes) {
        cancelReader(reader);
        throw new ExtractionFailure("FILE_TOO_LARGE", `The document exceeds the configured ${maxFileSizeBytes}-byte limit.`);
      }
      if (requiredSize > data.byteLength) {
        const doubledSize = data.byteLength === 0 ? INITIAL_DOWNLOAD_BUFFER_BYTES : data.byteLength * 2;
        const expanded = new Uint8Array(Math.min(maxFileSizeBytes, Math.max(requiredSize, doubledSize)));
        expanded.set(data.subarray(0, total));
        data = expanded;
      }
      data.set(chunk.value, total);
      total = requiredSize;
    }
  } catch (error) {
    if (error instanceof ExtractionFailure || signal?.aborted === true) {
      throw error;
    }
    if (error instanceof RangeError) {
      cancelReader(reader);
      throw new ExtractionFailure("RESOURCE_LIMIT", "The remote document could not be buffered within available memory.", { cause: error });
    }
    throw new ExtractionFailure("DOWNLOAD_ERROR", "The remote document response could not be read.", { cause: error });
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cleanup failure must not replace the download result or its primary error.
    }
  }

  const bytes = data.subarray(0, total);
  const format = validateDocumentBytes(bytes, total, maxFileSizeBytes);
  return { data: bytes, path: null, size: total, format, cleanup: noResources };
}

async function downloadDocument(initialUrl: URL, maxFileSizeBytes: number, controls: LoadDocumentInputControls): Promise<LoadedInput> {
  let currentUrl = initialUrl;
  const headers = remoteHeaders(controls.requestHeaders);
  let redirects = 0;

  while (true) {
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        headers,
        redirect: "manual",
        ...(controls.signal === undefined ? {} : { signal: controls.signal }),
      });
    } catch (error) {
      if (controls.signal?.aborted === true) {
        throw error;
      }
      throw new ExtractionFailure("DOWNLOAD_ERROR", "The remote document could not be downloaded.", { cause: error });
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      cancelResponse(response);
      if (redirects >= MAX_REDIRECTS) {
        throw new ExtractionFailure("DOWNLOAD_ERROR", `The remote document exceeded the ${MAX_REDIRECTS}-redirect limit.`);
      }
      if (location === null) {
        throw new ExtractionFailure("DOWNLOAD_ERROR", "The remote document returned a redirect without a destination.");
      }

      let nextUrl: URL;
      try {
        nextUrl = checkedRemoteUrl(new URL(location, currentUrl));
      } catch (error) {
        throw new ExtractionFailure("DOWNLOAD_ERROR", "The remote document returned an invalid redirect destination.", { cause: error });
      }

      if (nextUrl.origin !== currentUrl.origin) {
        stripCallerHeaders(headers, controls.requestHeaders);
      }
      currentUrl = nextUrl;
      redirects += 1;
      continue;
    }

    if (!response.ok) {
      const status = response.status;
      cancelResponse(response);
      throw new ExtractionFailure("DOWNLOAD_ERROR", `The remote document request returned HTTP status ${status}.`);
    }
    return readRemoteBody(response, maxFileSizeBytes, controls.signal);
  }
}

/**
 * Loads a `Readable` or async byte iterable under the configured storage policy and validates the result.
 *
 * A temporary file created here is removed before the failure is rethrown, so a rejected load never leaves one
 * behind; a successful load transfers that responsibility to the returned `cleanup`.
 *
 * @param {AsyncIterable<Uint8Array>} input - Supplies the stream to consume.
 * @param {number} maxFileSizeBytes - Supplies the maximum accepted document size in bytes.
 * @param {LoadDocumentInputControls} controls - Supplies the storage policy, temporary directory, and cancellation signal.
 * @returns {Promise<LoadedInput>} Resolves with the received bytes or their temporary file, size, and detected format.
 * @throws {ExtractionFailure} Throws when the stream is cancelled, exceeds the size limit, is empty, yields a non-byte chunk, or carries an unsupported signature.
 */
async function loadStreamInput(input: AsyncIterable<Uint8Array>, maxFileSizeBytes: number, controls: LoadDocumentInputControls): Promise<LoadedInput> {
  const captured = await captureStream(input, {
    storage: controls.streamStorage ?? DEFAULT_STREAM_STORAGE,
    memoryThresholdBytes: controls.streamMemoryThresholdBytes ?? DEFAULT_STREAM_MEMORY_THRESHOLD_BYTES,
    temporaryDirectory: controls.streamTempDirectory ?? tmpdir(),
    maxFileSizeBytes,
    ...(controls.signal === undefined ? {} : { signal: controls.signal }),
  });
  try {
    const format = validateDocumentBytes(captured.header, captured.size, maxFileSizeBytes);
    if (captured.data !== null) {
      return { data: captured.data, path: null, size: captured.size, format, cleanup: noResources };
    }
    return { data: null, path: captured.path, size: captured.size, format, cleanup: captured.cleanup };
  } catch (error) {
    await captured.cleanup();
    throw error;
  }
}

/**
 * Loads a local, remote, streamed, or in-memory document into validated bytes with a detected format.
 *
 * @param {DocumentInput} input - The file path, HTTP(S) URL, `ArrayBuffer`, byte array, `Readable`, or async byte iterable to load.
 * @param {number} maxFileSizeBytes - The maximum accepted document size in bytes.
 * @param {LoadDocumentInputControls} [controls={}] - Optional remote headers, stream storage settings, and cancellation signal.
 * @returns {Promise<LoadedInput>} Resolves with bounded document bytes or an extractor-owned temporary file, the size, and the detected format.
 * @throws {ExtractionFailure} If the input, path, response, stream, format, headers, or resource limits are invalid.
 * @throws {Error} If a remote operation is aborted by the supplied signal.
 * @throws {TypeError} If the supplied `ArrayBuffer` has been detached.
 * @throws {RangeError} If an in-memory input cannot be copied within available memory.
 */
export async function loadDocumentInput(input: DocumentInput, maxFileSizeBytes: number, controls: LoadDocumentInputControls = {}): Promise<LoadedInput> {
  if (typeof input === "string") {
    const remoteUrl = remoteUrlFromInput(input);
    if (remoteUrl !== null) {
      return downloadDocument(remoteUrl, maxFileSizeBytes, controls);
    }
    if (controls.requestHeaders !== undefined) {
      throw new ExtractionFailure("INVALID_OPTIONS", "requestHeaders can only be used with an HTTP(S) URL input.");
    }
    try {
      const file = await stat(input);
      if (!file.isFile()) {
        throw new ExtractionFailure("INVALID_INPUT", "The supplied path is not a file.");
      }
      if (file.size > maxFileSizeBytes) {
        throw new ExtractionFailure("FILE_TOO_LARGE", `The document exceeds the configured ${maxFileSizeBytes}-byte limit.`);
      }
      return checkedOwnedBytes(await readFile(input, { signal: controls.signal }), maxFileSizeBytes);
    } catch (error) {
      if (error instanceof ExtractionFailure) {
        throw error;
      }
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (code === "ENOENT") {
        throw new ExtractionFailure("FILE_NOT_FOUND", "The document file was not found.", {
          cause: error,
        });
      }
      throw new ExtractionFailure("INVALID_INPUT", "The document file could not be read.", {
        cause: error,
      });
    }
  }

  if (controls.requestHeaders !== undefined) {
    throw new ExtractionFailure("INVALID_OPTIONS", "requestHeaders can only be used with an HTTP(S) URL input.");
  }

  if (input instanceof Uint8Array) {
    return checkedBytes(input, maxFileSizeBytes);
  }
  if (input instanceof ArrayBuffer) {
    return checkedBytes(new Uint8Array(input), maxFileSizeBytes);
  }
  if (isAsyncByteSource(input)) {
    return loadStreamInput(input, maxFileSizeBytes, controls);
  }
  throw new ExtractionFailure("INVALID_INPUT", "Input must be a local path, HTTP(S) URL, ArrayBuffer, Buffer, Uint8Array, Readable, or async iterable of byte chunks.");
}
