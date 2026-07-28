import { ExtractionFailure, messageFromUnknown } from "../errors";
import type { PdfDocumentLike, PdfHandle } from "./types";

async function installCanvasGlobals(): Promise<void> {
  const canvas = await import("@napi-rs/canvas");
  const target = globalThis as unknown as Record<string, unknown>;
  target["DOMMatrix"] ??= canvas.DOMMatrix;
  target["ImageData"] ??= canvas.ImageData;
  target["Path2D"] ??= canvas.Path2D;
}

export async function openPdfDocument(data: Uint8Array, maxSourceImagePixels: number, maxCanvasPixels: number): Promise<PdfHandle> {
  await installCanvasGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data,
    maxImageSize: maxSourceImagePixels,
    canvasMaxAreaInBytes: maxCanvasPixels * 4,
    useSystemFonts: true,
    stopAtErrors: false,
    verbosity: 0,
  });

  try {
    const document = (await loadingTask.promise) as unknown as PdfDocumentLike;
    return {
      document,
      async close(): Promise<void> {
        await loadingTask.destroy();
      },
    };
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined);
    const name = error instanceof Error ? error.name : "";
    const message = messageFromUnknown(error);
    if (name === "PasswordException" || /password/i.test(message)) {
      throw new ExtractionFailure("PASSWORD_REQUIRED", "The PDF is encrypted and requires a password.", { cause: error });
    }
    throw new ExtractionFailure("INVALID_PDF", "The PDF could not be parsed.", {
      cause: error,
    });
  }
}
