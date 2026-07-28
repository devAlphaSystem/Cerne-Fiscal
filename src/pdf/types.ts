/**
 * Represents the subset of a PDF.js text item required for text reconstruction.
 */
export interface PdfTextItemLike {
  /**
   * Provides the decoded text fragment.
   */
  str: string;
  /**
   * Provides the PDF transformation matrix when positional data is available.
   */
  transform?: number[];
  /**
   * Reports the fragment width in viewport units.
   */
  width?: number;
  /**
   * Reports the fragment height in viewport units.
   */
  height?: number;
  /**
   * Indicates whether the fragment terminates a source text line.
   */
  hasEOL?: boolean;
}

/**
 * Represents the dimensions of a PDF.js page viewport.
 */
export interface PdfViewportLike {
  /**
   * Reports the viewport width in pixels at the selected scale.
   */
  width: number;
  /**
   * Reports the viewport height in pixels at the selected scale.
   */
  height: number;
}

/**
 * Defines the PDF.js page operations used by extraction and rendering.
 */
export interface PdfPageLike {
  /**
   * Reports the 1-based page number.
   */
  pageNumber: number;
  /**
   * Reports the page's intrinsic clockwise rotation in degrees.
   */
  rotate: number;
  /**
   * Retrieves the page's native text-content items.
   *
   * @returns {Promise<{items: Array<unknown>}>} Resolves with the raw PDF.js text items.
   * @throws {Error} If PDF.js cannot extract the page content stream.
   */
  getTextContent(): Promise<{ items: unknown[] }>;
  /**
   * Creates a viewport for the requested scale and optional rotation.
   *
   * @param {Object} options - The viewport transformation settings.
   * @param {number} options.scale - The positive rendering scale.
   * @param {number} [options.rotation] - The clockwise rotation in degrees.
   * @returns {PdfViewportLike} The resulting viewport dimensions.
   * @throws {Error} If PDF.js rejects the viewport settings.
   */
  getViewport(options: { scale: number; rotation?: number }): PdfViewportLike;
  /**
   * Starts rendering the page with PDF.js-specific options.
   *
   * @param {Record<string, unknown>} options - The canvas, viewport, and rendering options.
   * @returns {{promise: Promise<void>}} The render task wrapper containing its completion promise.
   * @throws {Error} If PDF.js cannot create the render task.
   */
  render(options: Record<string, unknown>): { promise: Promise<void> };
  /**
   * Releases page-level PDF.js resources.
   *
   * @param {boolean} [resetStats] - Whether PDF.js should reset page statistics.
   * @returns {boolean} Whether cleanup completed immediately.
   */
  cleanup(resetStats?: boolean): boolean;
}

/**
 * Defines the PDF.js document operations used by the format-neutral adapter.
 */
export interface PdfDocumentLike {
  /**
   * Reports the total number of pages in the PDF.
   */
  numPages: number;
  /**
   * Retrieves a PDF page by its 1-based number.
   *
   * @param {number} pageNumber - The 1-based page number to load.
   * @returns {Promise<PdfPageLike>} Resolves with the requested PDF.js page.
   * @throws {Error} If PDF.js cannot load the requested page.
   */
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

/**
 * Represents an opened PDF together with its asynchronous close operation.
 */
export interface PdfHandle {
  /**
   * Provides the active PDF.js document proxy.
   */
  document: PdfDocumentLike;
  /**
   * Destroys the PDF loading task and releases document resources.
   *
   * @returns {Promise<void>} Resolves after the PDF resources have been released.
   * @throws {Error} If PDF.js cannot destroy the loading task cleanly.
   */
  close(): Promise<void>;
}
