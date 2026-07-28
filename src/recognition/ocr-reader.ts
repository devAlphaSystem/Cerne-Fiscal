/**
 * Represents the aggregate text and confidence returned by one OCR request.
 */
export interface OcrRecognition {
  /**
   * Provides the complete text returned by the OCR engine.
   */
  text: string;
  /**
   * Reports the OCR engine confidence on a zero-to-one-hundred scale.
   */
  confidence: number;
}

/**
 * Defines an initialized OCR worker used for document recognition.
 */
export interface OcrSession {
  /**
   * Recognizes access-key characters in an image buffer.
   *
   * @param {Buffer} image - The image bytes to recognize.
   * @returns {Promise<OcrRecognition>} Resolves with aggregate recognized text and confidence.
   * @throws {Error} If the OCR worker cannot process the image.
   */
  recognize(image: Buffer): Promise<OcrRecognition>;
  /**
   * Terminates the underlying OCR worker.
   *
   * @returns {Promise<void>} Resolves after the worker has released its resources.
   * @throws {Error} If the OCR worker cannot terminate cleanly.
   */
  terminate(): Promise<void>;
}

/**
 * Creates an English OCR session restricted to fiscal access-key characters.
 *
 * @returns {Promise<OcrSession>} Resolves with an initialized OCR session.
 * @throws {Error} If language data, the OCR runtime, or worker initialization fails.
 */
export async function createOcrSession(): Promise<OcrSession> {
  const [{ createWorker, OEM, PSM }, languageData] = await Promise.all([import("tesseract.js"), import("@tesseract.js-data/eng")]);
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    langPath: languageData.default.langPath,
    cacheMethod: "none",
    gzip: true,
  });
  try {
    await worker.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
      debug_file: "/dev/null",
    });
  } catch (error) {
    await worker.terminate().catch(() => undefined);
    throw error;
  }

  return {
    async recognize(image: Buffer): Promise<OcrRecognition> {
      const result = await worker.recognize(image);
      return {
        text: result.data.text,
        confidence: result.data.confidence,
      };
    },
    async terminate(): Promise<void> {
      await worker.terminate();
    },
  };
}
