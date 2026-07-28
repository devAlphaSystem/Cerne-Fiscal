import type { RenderRecipe } from "../options";
import type { DocumentFormat } from "../types";

export interface DocumentPageText {
  orderedText: string;
  visualLines: string[];
  hasText: boolean;
}

/**
 * A rendered visual page shared by every recognition stage. PDF pages produce
 * it through pdfjs rendering; standalone images produce it directly from the
 * decoded pixels without pretending to be PDFs.
 */
export interface RenderedPage {
  width: number;
  height: number;
  appliedScale: number;
  rotation: number;
  getPixels(): Uint8ClampedArray;
  toPng(): Buffer;
  dispose(): void;
}

export interface DocumentPageLike {
  pageNumber: number;
  /** Structured native text, or null for formats without a text layer. */
  nativeText(): Promise<DocumentPageText> | null;
  render(recipe: RenderRecipe, maxPixels: number): Promise<RenderedPage>;
  cleanup(): void;
}

export interface DocumentHandle {
  format: DocumentFormat;
  numPages: number;
  sourceImageDimensions?: Readonly<{
    width: number;
    height: number;
  }>;
  getPage(pageNumber: number): Promise<DocumentPageLike>;
  close(): Promise<void>;
}
