export interface OcrRecognition {
  text: string;
  confidence: number;
}

export interface OcrSession {
  recognize(image: Buffer): Promise<OcrRecognition>;
  terminate(): Promise<void>;
}

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
