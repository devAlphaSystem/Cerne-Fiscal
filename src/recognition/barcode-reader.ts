import type * as ZxingLibrary from "@zxing/library";

import type { RenderedPage } from "../document/types";

export interface DecodedBarcode {
  text: string;
  source: "code128" | "qr-code";
}

interface BarcodeRuntime {
  zxing: typeof ZxingLibrary;
  hints: Map<ZxingLibrary.DecodeHintType, unknown>;
}

let barcodeRuntimePromise: Promise<BarcodeRuntime> | undefined;

function loadBarcodeRuntime(): Promise<BarcodeRuntime> {
  barcodeRuntimePromise ??= import("@zxing/library").then((imported) => {
    const zxing = (imported as unknown as { default?: typeof imported }).default ?? imported;
    const { BarcodeFormat, DecodeHintType } = zxing;
    const hints = new Map<ZxingLibrary.DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    return { zxing, hints };
  }).catch((error: unknown) => {
    barcodeRuntimePromise = undefined;
    throw error;
  });
  return barcodeRuntimePromise;
}

function boxBlurLuminance(source: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const length = width * height;
  const horizontal = new Uint16Array(length);
  const output = new Uint8ClampedArray(length);
  const lastColumn = width - 1;
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x;
      const left = source[x === 0 ? index : index - 1]!;
      const center = source[index]!;
      const right = source[x === lastColumn ? index : index + 1]!;
      horizontal[index] = left + center + right;
    }
  }

  const lastRow = height - 1;
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    const topOffset = y === 0 ? rowOffset : rowOffset - width;
    const bottomOffset = y === lastRow ? rowOffset : rowOffset + width;
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x;
      const top = horizontal[topOffset + x]!;
      const center = horizontal[index]!;
      const bottom = horizontal[bottomOffset + x]!;
      output[index] = (top + center + bottom) / 9;
    }
  }
  return output;
}

function scanRegions(source: ZxingLibrary.RGBLuminanceSource, width: number, height: number): ZxingLibrary.LuminanceSource[] {
  const regions: ZxingLibrary.LuminanceSource[] = [source];
  const lowerRegionTop = Math.floor(height * 0.45);
  const rightRegionLeft = Math.floor(width * 0.45);
  const crops = [
    [0, 0, width, Math.min(height, Math.ceil(height * 0.55))],
    [0, lowerRegionTop, width, height - lowerRegionTop],
    [0, 0, Math.min(width, Math.ceil(width * 0.55)), height],
    [rightRegionLeft, 0, width - rightRegionLeft, height],
  ] as const;
  for (const [left, top, cropWidth, cropHeight] of crops) {
    if (cropWidth >= 32 && cropHeight >= 32) {
      regions.push(source.crop(left, top, cropWidth, cropHeight));
    }
  }
  return regions;
}

function decodeBitmap(reader: ZxingLibrary.Reader, bitmap: ZxingLibrary.BinaryBitmap, hints: Map<ZxingLibrary.DecodeHintType, unknown>, source: DecodedBarcode["source"]): DecodedBarcode | null {
  const stackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  try {
    const result = reader.decode(bitmap, hints);
    return {
      text: result.getText(),
      source,
    };
  } catch {
    return null;
  } finally {
    Error.stackTraceLimit = stackTraceLimit;
    reader.reset();
  }
}

export async function readBarcodes(rendered: RenderedPage, photographicEnhancements = false, checkpoint?: () => void): Promise<DecodedBarcode[]> {
  const { zxing, hints } = await loadBarcodeRuntime();
  const { BinaryBitmap, Code128Reader, GlobalHistogramBinarizer, HybridBinarizer, InvertedLuminanceSource, QRCodeReader, RGBLuminanceSource } = zxing;

  checkpoint?.();
  const pixels = rendered.getPixels();
  const pixelCount = rendered.width * rendered.height;
  const luminance = new Uint8ClampedArray(pixelCount);
  for (let pixel = 0, rgba = 0; pixel < pixelCount; pixel += 1, rgba += 4) {
    luminance[pixel] = (pixels[rgba]! + pixels[rgba + 1]! * 2 + pixels[rgba + 2]!) / 4;
  }
  const source = new RGBLuminanceSource(luminance, rendered.width, rendered.height);
  const attempts: Array<{
    reader: ZxingLibrary.Reader;
    source: DecodedBarcode["source"];
  }> = [
    { reader: new Code128Reader(), source: "code128" },
    { reader: new QRCodeReader(), source: "qr-code" },
  ];

  const unique = new Map<string, DecodedBarcode>();
  const regions = scanRegions(source, rendered.width, rendered.height);
  let blurredSource: ZxingLibrary.RGBLuminanceSource | null = null;
  for (const [regionIndex, region] of regions.entries()) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    checkpoint?.();
    const candidateSources: ZxingLibrary.LuminanceSource[] = [region];
    if (photographicEnhancements && regionIndex === 0) {
      blurredSource ??= new RGBLuminanceSource(boxBlurLuminance(luminance, rendered.width, rendered.height), rendered.width, rendered.height);
      candidateSources.push(new InvertedLuminanceSource(region), blurredSource);
    }
    const bitmapsBySource = candidateSources.map((candidateSource) => ({
      hybrid: new BinaryBitmap(new HybridBinarizer(candidateSource)),
      global: photographicEnhancements ? new BinaryBitmap(new GlobalHistogramBinarizer(candidateSource)) : null,
    }));
    for (const attempt of attempts) {
      for (const bitmapSet of bitmapsBySource) {
        const bitmaps = attempt.source === "code128" || bitmapSet.global === null ? [bitmapSet.hybrid] : [bitmapSet.hybrid, bitmapSet.global];
        for (const bitmap of bitmaps) {
          const result = decodeBitmap(attempt.reader, bitmap, hints, attempt.source);
          if (result !== null) {
            unique.set(`${result.source}:${result.text}`, result);
          }
        }
      }
    }
  }
  return [...unique.values()];
}
