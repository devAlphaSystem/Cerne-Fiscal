import type { DocumentFormat } from "../types";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function hasPngSignature(data: Uint8Array): boolean {
  return data.byteLength >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => data[index] === byte);
}

function hasJpegSignature(data: Uint8Array): boolean {
  return data.byteLength >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

function hasPdfSignature(data: Uint8Array): boolean {
  const prefix = Buffer.from(data.buffer, data.byteOffset, Math.min(data.byteLength, 1024));
  return prefix.indexOf("%PDF-") >= 0;
}

export function detectDocumentFormat(data: Uint8Array): DocumentFormat | null {
  if (hasPngSignature(data)) {
    return "png";
  }
  if (hasJpegSignature(data)) {
    return "jpeg";
  }
  if (hasPdfSignature(data)) {
    return "pdf";
  }
  return null;
}
