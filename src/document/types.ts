import type { RenderRecipe } from "../options";
import type { DocumentFormat } from "../types";

export interface DocumentPageText {
  orderedText: string;
  visualLines: string[];
  hasText: boolean;
}

export interface RenderedPage {
  width: number;
  height: number;
  appliedScale: number;
  rotation: number;
  getPixels(): Uint8ClampedArray;
  toPng(): Promise<Buffer>;
  releasePixels(): void;
  dispose(): void;
}

export interface DocumentPageLike {
  pageNumber: number;
  nativeText(): Promise<DocumentPageText> | null;
  renderKey?(recipe: RenderRecipe, maxPixels: number): string;
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
