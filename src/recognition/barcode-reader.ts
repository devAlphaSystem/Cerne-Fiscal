import type { BinaryBitmap, DecodeHintType, LuminanceSource, Reader, RGBLuminanceSource } from "@zxing/library";

import type { RenderedPage } from "../pdf/render-page";

export interface DecodedBarcode {
  text: string;
  source: "code128" | "qr-code";
}

function scanRegions(source: RGBLuminanceSource, width: number, height: number): LuminanceSource[] {
  const regions: LuminanceSource[] = [source];
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

function decodeBitmap(reader: Reader, bitmap: BinaryBitmap, hints: Map<DecodeHintType, unknown>, source: DecodedBarcode["source"]): DecodedBarcode | null {
  try {
    const result = reader.decode(bitmap, hints);
    return {
      text: result.getText(),
      source,
    };
  } catch {
    return null;
  } finally {
    reader.reset();
  }
}

export async function readBarcodes(rendered: RenderedPage): Promise<DecodedBarcode[]> {
  const { BarcodeFormat, BinaryBitmap, Code128Reader, DecodeHintType, HybridBinarizer, InvertedLuminanceSource, QRCodeReader, RGBLuminanceSource } = await import("@zxing/library");
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  const pixels = rendered.getPixels();
  const luminance = new Uint8ClampedArray(rendered.width * rendered.height);
  for (let pixel = 0, rgba = 0; pixel < luminance.length; pixel += 1, rgba += 4) {
    const red = pixels[rgba] ?? 255;
    const green = pixels[rgba + 1] ?? 255;
    const blue = pixels[rgba + 2] ?? 255;
    luminance[pixel] = (red + green * 2 + blue) / 4;
  }
  const source = new RGBLuminanceSource(luminance, rendered.width, rendered.height);
  const attempts: Array<{
    reader: Reader;
    source: DecodedBarcode["source"];
  }> = [
    { reader: new Code128Reader(), source: "code128" },
    { reader: new QRCodeReader(), source: "qr-code" },
  ];

  const unique = new Map<string, DecodedBarcode>();
  const regions = scanRegions(source, rendered.width, rendered.height);
  for (const [regionIndex, region] of regions.entries()) {
    const candidateSources: LuminanceSource[] = [region];
    if (regionIndex === 0) {
      candidateSources.push(new InvertedLuminanceSource(region));
    }
    for (const attempt of attempts) {
      for (const candidateSource of candidateSources) {
        const result = decodeBitmap(attempt.reader, new BinaryBitmap(new HybridBinarizer(candidateSource)), hints, attempt.source);
        if (result !== null) {
          unique.set(`${result.source}:${result.text}`, result);
        }
      }
    }
  }
  return [...unique.values()];
}
