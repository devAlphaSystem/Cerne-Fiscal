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
 * Opens validated bytes behind the common page-oriented document interface.
 *
 * @param {LoadedInput} loaded - The validated bytes and detected source format.
 * @param {number} maxSourceImagePixels - The maximum source-image area accepted during decoding.
 * @param {number} maxCanvasPixels - The maximum pixel area allocated for one rendered page.
 * @returns {Promise<DocumentHandle>} Resolves with a PDF or single-page image document handle.
 * @throws {ExtractionFailure} If the document is malformed, encrypted, or exceeds resource limits.
 * @throws {Error} If a required PDF or canvas runtime cannot be loaded or initialized.
 */
export async function openDocument(loaded: LoadedInput, maxSourceImagePixels: number, maxCanvasPixels: number): Promise<DocumentHandle> {
  if (loaded.format === "pdf") {
    const handle = await openPdfDocument(loaded.data, maxSourceImagePixels, maxCanvasPixels);
    return {
      format: "pdf",
      numPages: handle.document.numPages,
      getPage: async (pageNumber) => pdfPageAdapter(await handle.document.getPage(pageNumber)),
      close: () => handle.close(),
    };
  }
  return openImageDocument(loaded.data, loaded.format, maxSourceImagePixels);
}
