export interface PdfTextItemLike {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export interface PdfViewportLike {
  width: number;
  height: number;
}

export interface PdfPageLike {
  pageNumber: number;
  rotate: number;
  getTextContent(): Promise<{ items: unknown[] }>;
  getViewport(options: { scale: number; rotation?: number }): PdfViewportLike;
  render(options: Record<string, unknown>): { promise: Promise<void> };
  cleanup(resetStats?: boolean): boolean;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

export interface PdfHandle {
  document: PdfDocumentLike;
  close(): Promise<void>;
}
