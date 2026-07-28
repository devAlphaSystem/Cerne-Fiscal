import type { RenderRecipe } from "../options";
import type { DocumentFormat } from "../types";

/**
 * Represents native PDF text in source order and reconstructed visual lines.
 */
export interface DocumentPageText {
  /**
   * Provides text in the order returned by the PDF content stream.
   */
  orderedText: string;
  /**
   * Provides text reconstructed into visually ordered lines.
   */
  visualLines: string[];
  /**
   * Indicates whether the page contains any non-whitespace native text.
   */
  hasText: boolean;
}

/**
 * Defines a rendered page surface with explicit pixel and lifecycle controls.
 */
export interface RenderedPage {
  /**
   * Reports the rendered width in pixels.
   */
  width: number;
  /**
   * Reports the rendered height in pixels.
   */
  height: number;
  /**
   * Reports the scale actually used after resource-limit adjustments.
   */
  appliedScale: number;
  /**
   * Reports the clockwise rotation applied to the rendered surface.
   */
  rotation: number;
  /**
   * Returns the rendered RGBA pixels, caching them until released.
   *
   * @returns {Uint8ClampedArray} The rendered RGBA pixel buffer.
   * @throws {ExtractionFailure} If the rendered surface has already been disposed.
   * @throws {Error} If the graphics runtime cannot read the surface pixels.
   */
  getPixels(): Uint8ClampedArray;
  /**
   * Encodes the rendered surface as PNG bytes.
   *
   * @returns {Promise<Buffer>} Resolves with the encoded PNG bytes.
   * @throws {ExtractionFailure} If the rendered surface has already been disposed.
   * @throws {Error} If the graphics runtime cannot encode the surface.
   */
  toPng(): Promise<Buffer>;
  /**
   * Releases any cached pixel copy while keeping the render surface usable.
   */
  releasePixels(): void;
  /**
   * Releases the render surface and prevents subsequent pixel or PNG access.
   */
  dispose(): void;
}

/**
 * Defines the common operations available for one PDF or image page.
 */
export interface DocumentPageLike {
  /**
   * Reports the 1-based page number within the document.
   */
  pageNumber: number;
  /**
   * Returns lazily extracted native text when the source format supports it.
   *
   * @returns {Promise<DocumentPageText>|null} The pending page text, or `null` for image-only pages.
   * @throws {ExtractionFailure} If native PDF text exceeds configured safety limits.
   * @throws {Error} If the backing document runtime cannot extract the text.
   */
  nativeText(): Promise<DocumentPageText> | null;
  /**
   * Returns a cache key when a render request can be identified without rendering.
   *
   * @param {RenderRecipe} recipe - The rendering transformation to identify.
   * @param {number} maxPixels - The maximum permitted output pixel area.
   * @returns {string} The deterministic render identity.
   * @throws {ExtractionFailure} If the document is closed or the render geometry is invalid.
   * @throws {Error} If the graphics runtime cannot create or inspect the content-crop probe surface.
   */
  renderKey?(recipe: RenderRecipe, maxPixels: number): string;
  /**
   * Renders the page according to a bounded recognition recipe.
   *
   * @param {RenderRecipe} recipe - The scale, rotation, and optional image enhancements to apply.
   * @param {number} maxPixels - The maximum permitted output pixel area.
   * @returns {Promise<RenderedPage>} Resolves with a disposable rendered page surface.
   * @throws {ExtractionFailure} If the page cannot be rendered within resource or lifecycle constraints.
   * @throws {Error} If the backing graphics or document runtime fails.
   */
  render(recipe: RenderRecipe, maxPixels: number): Promise<RenderedPage>;
  /**
   * Releases transient resources retained by the backing page implementation.
   */
  cleanup(): void;
}

/**
 * Defines a format-neutral handle for an opened PDF or image document.
 */
export interface DocumentHandle {
  /**
   * Identifies the detected source format.
   */
  format: DocumentFormat;
  /**
   * Reports the number of addressable pages.
   */
  numPages: number;
  /**
   * Reports decoded source-image dimensions when the document originated as an image.
   */
  sourceImageDimensions?: Readonly<{
    /** Reports the decoded source-image width in pixels. */
    width: number;
    /** Reports the decoded source-image height in pixels. */
    height: number;
  }>;
  /**
   * Retrieves one page by its 1-based number.
   *
   * @param {number} pageNumber - The 1-based page number to retrieve.
   * @returns {Promise<DocumentPageLike>} Resolves with the requested page adapter.
   * @throws {ExtractionFailure} If a page other than one is requested from an image document.
   * @throws {Error} If the backing PDF runtime cannot load the requested page.
   */
  getPage(pageNumber: number): Promise<DocumentPageLike>;
  /**
   * Closes the document and releases all backing runtime resources.
   *
   * @returns {Promise<void>} Resolves after the document resources have been released.
   * @throws {Error} If the backing runtime cannot close cleanly.
   */
  close(): Promise<void>;
}
