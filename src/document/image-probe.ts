import { ExtractionFailure } from "../errors";

export interface ImageProbe {
  width: number;
  height: number;
  orientation: number;
}

const PNG_IHDR_OFFSET = 12;
const PNG_IHDR_LENGTH = 13;
const MAX_CANVAS_DIMENSION = 32_767;
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const JPEG_STANDALONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);
const EXIF_ORIENTATION_TAG = 0x0112;

function readUInt16BE(data: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > data.byteLength) {
    return null;
  }
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

function readUInt32BE(data: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > data.byteLength) {
    return null;
  }
  return (data[offset] ?? 0) * 0x1_00_00_00 + ((data[offset + 1] ?? 0) << 16) + ((data[offset + 2] ?? 0) << 8) + (data[offset + 3] ?? 0);
}

function validatePngChunks(data: Uint8Array): void {
  let offset = 8;
  let sawIhdr = false;
  for (let chunkIndex = 0; chunkIndex < 100_000; chunkIndex += 1) {
    const length = readUInt32BE(data, offset);
    const type = data.subarray(offset + 4, offset + 8);
    if (length === null || type.byteLength < 4 || length > 0x7fffffff) {
      break;
    }
    const next = offset + 12 + length;
    if (next > data.byteLength) {
      break;
    }
    const chunkType = String.fromCharCode(...type);
    if (chunkIndex === 0) {
      if (chunkType !== "IHDR" || length !== PNG_IHDR_LENGTH) {
        break;
      }
      sawIhdr = true;
    } else if (chunkType === "IHDR") {
      break;
    }
    if (chunkType === "IEND") {
      if (!sawIhdr || length !== 0) {
        break;
      }
      return;
    }
    offset = next;
  }
  throw new ExtractionFailure("INVALID_IMAGE", "The PNG data is truncated or malformed.");
}

function probePng(data: Uint8Array): ImageProbe {
  const ihdrLength = readUInt32BE(data, 8);
  const marker = data.subarray(PNG_IHDR_OFFSET, PNG_IHDR_OFFSET + 4);
  const width = readUInt32BE(data, 16);
  const height = readUInt32BE(data, 20);
  const bitDepth = data[24];
  const colorType = data[25];
  const compressionMethod = data[26];
  const filterMethod = data[27];
  const interlaceMethod = data[28];
  const validBitDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (data.byteLength < 33 || ihdrLength !== PNG_IHDR_LENGTH || width === null || height === null || String.fromCharCode(...marker) !== "IHDR" || bitDepth === undefined || colorType === undefined || !Object.hasOwn(validBitDepths, colorType) || !validBitDepths[colorType]!.includes(bitDepth) || compressionMethod !== 0 || filterMethod !== 0 || (interlaceMethod !== 0 && interlaceMethod !== 1)) {
    throw new ExtractionFailure("INVALID_IMAGE", "The PNG header is truncated or malformed.");
  }
  validatePngChunks(data);
  return { width, height, orientation: 1 };
}

function exifOrientation(data: Uint8Array, start: number, end: number): number {
  const header = data.subarray(start, Math.min(end, start + 6));
  if (String.fromCharCode(...header) !== "Exif\0\0") {
    return 1;
  }
  const tiff = start + 6;
  const byteOrder = readUInt16BE(data, tiff);
  const littleEndian = byteOrder === 0x4949;
  if (!littleEndian && byteOrder !== 0x4d4d) {
    return 1;
  }
  const read16 = (offset: number): number | null => {
    const value = readUInt16BE(data, offset);
    return value === null || !littleEndian ? value : ((value & 0xff) << 8) | (value >> 8);
  };
  const read32 = (offset: number): number | null => {
    const value = readUInt32BE(data, offset);
    if (value === null || !littleEndian) {
      return value;
    }
    return (value >>> 24) + (((value >> 16) & 0xff) << 8) + (((value >> 8) & 0xff) << 16) + (value & 0xff) * 0x1_00_00_00;
  };

  const ifdOffset = read32(tiff + 4);
  if (ifdOffset === null) {
    return 1;
  }
  const ifd = tiff + ifdOffset;
  const entryCount = read16(ifd);
  if (entryCount === null) {
    return 1;
  }
  for (let index = 0; index < entryCount; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) {
      return 1;
    }
    if (read16(entry) === EXIF_ORIENTATION_TAG) {
      const value = read16(entry + 8);
      return value !== null && value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function probeJpeg(data: Uint8Array): ImageProbe {
  let offset = 2;
  let orientation: number | null = null;

  while (offset + 4 <= data.byteLength) {
    if (data[offset] !== 0xff) {
      break;
    }
    const marker = data[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (JPEG_STANDALONE_MARKERS.has(marker)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    const length = readUInt16BE(data, offset + 2);
    if (length === null || length < 2 || offset + 2 + length > data.byteLength) {
      break;
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      const height = readUInt16BE(data, offset + 5);
      const width = readUInt16BE(data, offset + 7);
      if (height === null || width === null) {
        break;
      }
      return { width, height, orientation: orientation ?? 1 };
    }
    if (marker === 0xe1 && orientation === null) {
      orientation = exifOrientation(data, offset + 4, offset + 2 + length);
    }
    offset += 2 + length;
  }

  throw new ExtractionFailure("INVALID_IMAGE", "The JPEG header is truncated or malformed.");
}

export function probeImage(data: Uint8Array, format: "jpeg" | "png"): ImageProbe {
  return format === "png" ? probePng(data) : probeJpeg(data);
}

export function validateImageDimensions(width: number, height: number, maxSourceImagePixels: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ExtractionFailure("INVALID_IMAGE", "The image declares invalid dimensions.");
  }
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION) {
    throw new ExtractionFailure("RESOURCE_LIMIT", `The image dimensions exceed the supported ${MAX_CANVAS_DIMENSION}-pixel canvas axis limit.`);
  }
  const area = width * height;
  if (!Number.isSafeInteger(area) || area > maxSourceImagePixels) {
    throw new ExtractionFailure("RESOURCE_LIMIT", `The image area exceeds the configured ${maxSourceImagePixels}-pixel limit.`);
  }
}
