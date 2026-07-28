import { readFile } from "node:fs/promises";

import { ExtractionFailure } from "../errors";
import { extractPageText } from "../pdf/extract-text";
import { openPdfDocument } from "../pdf/open-document";
import type { PdfPageLike } from "../pdf/types";
import { openImageDocument } from "./image-document";
import type { LoadedInput } from "./load-input";
import type { DocumentHandle, DocumentPageLike } from "./types";

function pdfPageAdapter(page: PdfPageLike): DocumentPageLike {
  return {
    pageNumber: page.pageNumber,
    nativeText: () => extractPageText(page),
    render: async (recipe, maxPixels) => {
      const { renderPage } = await import("../pdf/render-page");
      return renderPage(page, recipe, maxPixels);
    },
    cleanup: () => {
      page.cleanup();
    },
  };
}

/**
 * Resolves a loaded input into the contiguous bytes the parsers require.
 *
 * PDF.js and the canvas image decoder both need the complete document in one buffer, so a stream spooled to a
 * temporary file is read back here, in a single exactly sized allocation, at the moment parsing begins. The
 * spool still pays off: the bytes were never held while the producer was slowly delivering them, and the
 * allocation is exact instead of the doubling overshoot a growing in-memory buffer would leave behind.
 *
 * @param {LoadedInput} loaded - Supplies the validated bytes or their temporary file.
 * @returns {Promise<Uint8Array>} Resolves with the complete document bytes.
 * @throws {ExtractionFailure} Throws when buffered bytes cannot be read back from temporary storage.
 */
async function documentBytes(loaded: LoadedInput): Promise<Uint8Array> {
  if (loaded.data !== null) {
    return loaded.data;
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(loaded.path);
  } catch (error) {
    throw new ExtractionFailure("PROCESSING_ERROR", "The buffered document could not be read back from temporary storage.", { cause: error });
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Opens validated bytes behind the common page-oriented document interface.
 *
 * @param {LoadedInput} loaded - The validated bytes and detected source format.
 * @param {number} maxSourceImagePixels - The maximum source-image area accepted during decoding.
 * @param {number} maxCanvasPixels - The maximum pixel area allocated for one rendered page.
 * @returns {Promise<DocumentHandle>} Resolves with a PDF or single-page image document handle.
 * @throws {ExtractionFailure} If the document is malformed, encrypted, exceeds resource limits, or cannot be read back from temporary storage.
 * @throws {Error} If a required PDF or canvas runtime cannot be loaded or initialized.
 */
export async function openDocument(loaded: LoadedInput, maxSourceImagePixels: number, maxCanvasPixels: number): Promise<DocumentHandle> {
  const data = await documentBytes(loaded);
  if (loaded.format === "pdf") {
    const handle = await openPdfDocument(data, maxSourceImagePixels, maxCanvasPixels);
    return {
      format: "pdf",
      numPages: handle.document.numPages,
      getPage: async (pageNumber) => pdfPageAdapter(await handle.document.getPage(pageNumber)),
      close: () => handle.close(),
    };
  }
  return openImageDocument(data, loaded.format, maxSourceImagePixels);
}
