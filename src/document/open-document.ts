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
