/** Declares the English Tesseract language-data package shape used by OCR setup. */
declare module "@tesseract.js-data/eng" {
  /**
   * Provides the bundled English Tesseract language-data location and compression metadata.
   */
  const languageData: {
    /** Identifies the bundled OCR language by its Tesseract code. */
    code: "eng";
    /** Indicates that the bundled trained-data file is gzip-compressed. */
    gzip: true;
    /** Locates the directory containing the bundled trained-data file. */
    langPath: string;
  };

  export default languageData;
}
