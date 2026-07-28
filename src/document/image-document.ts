import type * as CanvasLibrary from "@napi-rs/canvas";

import { ExtractionFailure } from "../errors";
import type { RenderRecipe } from "../options";
import { probeImage, validateImageDimensions } from "./image-probe";
import type { DocumentHandle, DocumentPageLike, RenderedPage } from "./types";

const MAX_CANVAS_DIMENSION = 32_767;
const CROP_PROBE_MAX_PIXELS = 1_000_000;
const CROP_LUMINANCE_TOLERANCE = 24;
const CROP_MINIMUM_REMOVABLE_FRACTION = 0.2;
const CROP_MINIMUM_CONTENT_FRACTION = 0.25;
const CROP_PADDING_FRACTION = 0.025;
const SMALL_IMAGE_LONG_EDGE = 320;
const SMALL_IMAGE_MAX_BOOST = 2.5;
const CONTRAST_MINIMUM_RANGE = 16;
const CONTRAST_MAXIMUM_RANGE = 200;

type CanvasModule = typeof CanvasLibrary;
type DecodedImage = Awaited<ReturnType<CanvasModule["loadImage"]>>;
type RasterCanvas = InstanceType<CanvasModule["Canvas"]>;
type Context2D = ReturnType<ReturnType<CanvasModule["createCanvas"]>["getContext"]>;

interface SourceCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageRenderGeometry {
  source: SourceCrop;
  upright: Readonly<{ width: number; height: number }>;
  baseWidth: number;
  baseHeight: number;
  boost: number;
  scale: number;
  width: number;
  height: number;
}

function orientedSize(width: number, height: number, orientation: number): { width: number; height: number } {
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}

function applyExifTransform(context: Context2D, orientation: number, uw: number, uh: number): void {
  switch (orientation) {
    case 2:
      context.transform(-1, 0, 0, 1, uw, 0);
      break;
    case 3:
      context.transform(-1, 0, 0, -1, uw, uh);
      break;
    case 4:
      context.transform(1, 0, 0, -1, 0, uh);
      break;
    case 5:
      context.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.transform(0, 1, -1, 0, uw, 0);
      break;
    case 7:
      context.transform(0, -1, -1, 0, uw, uh);
      break;
    case 8:
      context.transform(0, -1, 1, 0, 0, uh);
      break;
    default:
      break;
  }
}

function applyRecipeRotation(context: Context2D, rotation: number, canvasWidth: number, canvasHeight: number): void {
  switch (rotation) {
    case 90:
      context.translate(canvasWidth, 0);
      context.rotate(Math.PI / 2);
      break;
    case 180:
      context.translate(canvasWidth, canvasHeight);
      context.rotate(Math.PI);
      break;
    case 270:
      context.translate(0, canvasHeight);
      context.rotate(-Math.PI / 2);
      break;
    default:
      break;
  }
}

function luminanceAt(pixels: Uint8ClampedArray, index: number): number {
  const offset = index * 4;
  return (pixels[offset]! + pixels[offset + 1]! * 2 + pixels[offset + 2]!) >> 2;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function computeContentCrop(canvasModule: CanvasModule, image: DecodedImage, width: number, height: number): SourceCrop | null {
  const probeScale = Math.min(1, Math.sqrt(CROP_PROBE_MAX_PIXELS / (width * height)));
  const probeWidth = Math.max(1, Math.floor(width * probeScale));
  const probeHeight = Math.max(1, Math.floor(height * probeScale));
  if (probeWidth < 16 || probeHeight < 16) {
    return null;
  }

  const canvas = canvasModule.createCanvas(probeWidth, probeHeight);
  const context = canvas.getContext("2d");
  try {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, probeWidth, probeHeight);
    context.drawImage(image, 0, 0, width, height, 0, 0, probeWidth, probeHeight);
    const pixels = context.getImageData(0, 0, probeWidth, probeHeight).data;

    const ringThickness = Math.max(1, Math.round(Math.min(probeWidth, probeHeight) * 0.02));
    const ringLuminance: number[] = [];
    for (let y = 0; y < probeHeight; y += 1) {
      const isEdgeRow = y < ringThickness || y >= probeHeight - ringThickness;
      for (let x = 0; x < probeWidth; x += 1) {
        if (isEdgeRow || x < ringThickness || x >= probeWidth - ringThickness) {
          ringLuminance.push(luminanceAt(pixels, y * probeWidth + x));
        }
      }
    }
    const background = median(ringLuminance);
    const ringOutliers = ringLuminance.filter((value) => Math.abs(value - background) > CROP_LUMINANCE_TOLERANCE).length;
    if (ringOutliers / Math.max(1, ringLuminance.length) > 0.05) {
      return null;
    }

    const rowContentThreshold = Math.max(2, Math.round(probeWidth * 0.005));
    const columnContentThreshold = Math.max(2, Math.round(probeHeight * 0.005));
    const columnCounts = new Uint32Array(probeWidth);
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < probeHeight; y += 1) {
      let rowCount = 0;
      for (let x = 0; x < probeWidth; x += 1) {
        if (Math.abs(luminanceAt(pixels, y * probeWidth + x) - background) > CROP_LUMINANCE_TOLERANCE) {
          rowCount += 1;
          columnCounts[x] = columnCounts[x]! + 1;
        }
      }
      if (rowCount >= rowContentThreshold) {
        top = top === -1 ? y : top;
        bottom = y;
      }
    }
    let left = -1;
    let right = -1;
    for (let x = 0; x < probeWidth; x += 1) {
      if (columnCounts[x]! >= columnContentThreshold) {
        left = left === -1 ? x : left;
        right = x;
      }
    }
    if (top === -1 || left === -1) {
      return null;
    }

    const contentWidth = right - left + 1;
    const contentHeight = bottom - top + 1;
    if (contentWidth < probeWidth * CROP_MINIMUM_CONTENT_FRACTION || contentHeight < probeHeight * CROP_MINIMUM_CONTENT_FRACTION) {
      return null;
    }
    const removableHorizontal = probeWidth - contentWidth;
    const removableVertical = probeHeight - contentHeight;
    if (removableHorizontal < probeWidth * CROP_MINIMUM_REMOVABLE_FRACTION && removableVertical < probeHeight * CROP_MINIMUM_REMOVABLE_FRACTION) {
      return null;
    }

    const padX = Math.round(probeWidth * CROP_PADDING_FRACTION);
    const padY = Math.round(probeHeight * CROP_PADDING_FRACTION);
    const probeLeft = Math.max(0, left - padX);
    const probeTop = Math.max(0, top - padY);
    const probeRight = Math.min(probeWidth - 1, right + padX);
    const probeBottom = Math.min(probeHeight - 1, bottom + padY);

    const x = Math.max(0, Math.floor(probeLeft / probeScale));
    const y = Math.max(0, Math.floor(probeTop / probeScale));
    const cropWidth = Math.min(width - x, Math.ceil((probeRight - probeLeft + 1) / probeScale));
    const cropHeight = Math.min(height - y, Math.ceil((probeBottom - probeTop + 1) / probeScale));
    if (cropWidth < 1 || cropHeight < 1) {
      return null;
    }
    return { x, y, width: cropWidth, height: cropHeight };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

function luminancePercentile(histogram: Uint32Array, total: number, fraction: number): number {
  const target = total * fraction;
  let accumulated = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    accumulated += histogram[value]!;
    if (accumulated >= target) {
      return value;
    }
  }
  return histogram.length - 1;
}

function stretchContrast(pixels: Uint8ClampedArray): boolean {
  const histogram = new Uint32Array(256);
  const pixelCount = Math.floor(pixels.length / 4);
  for (let index = 0; index < pixelCount; index += 1) {
    const luminance = luminanceAt(pixels, index);
    histogram[luminance] = histogram[luminance]! + 1;
  }
  const low = luminancePercentile(histogram, pixelCount, 0.02);
  const high = luminancePercentile(histogram, pixelCount, 0.98);
  const range = high - low;
  if (range < CONTRAST_MINIMUM_RANGE || range >= CONTRAST_MAXIMUM_RANGE) {
    return false;
  }

  const lookup = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value += 1) {
    lookup[value] = ((value - low) * 255) / range;
  }
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = lookup[pixels[offset]!]!;
    pixels[offset + 1] = lookup[pixels[offset + 1]!]!;
    pixels[offset + 2] = lookup[pixels[offset + 2]!]!;
  }
  return true;
}

function convertToGrayscale(pixels: Uint8ClampedArray): void {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const luminance = (pixels[offset]! + pixels[offset + 1]! * 2 + pixels[offset + 2]!) >> 2;
    pixels[offset] = luminance;
    pixels[offset + 1] = luminance;
    pixels[offset + 2] = luminance;
  }
}

function resolveImageRenderGeometry(fullSource: SourceCrop, contentCrop: SourceCrop | null, orientation: number, recipe: RenderRecipe, maxPixels: number): ImageRenderGeometry {
  const source = recipe.crop === true && contentCrop !== null ? contentCrop : fullSource;
  const upright = orientedSize(source.width, source.height, orientation);
  const baseWidth = recipe.rotation % 180 === 0 ? upright.width : upright.height;
  const baseHeight = recipe.rotation % 180 === 0 ? upright.height : upright.width;
  const longEdge = Math.max(source.width, source.height);
  const boost = recipe.upscaleSmall === true && longEdge < SMALL_IMAGE_LONG_EDGE ? Math.min(SMALL_IMAGE_MAX_BOOST, SMALL_IMAGE_LONG_EDGE / longEdge) : 1;
  let scale = recipe.scale * boost;
  if (recipe.targetPixels !== undefined) {
    scale = Math.min(scale, Math.sqrt(recipe.targetPixels / (baseWidth * baseHeight)));
  }
  scale = Math.min(scale, Math.sqrt(maxPixels / (baseWidth * baseHeight)), MAX_CANVAS_DIMENSION / baseWidth, MAX_CANVAS_DIMENSION / baseHeight);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new ExtractionFailure("RESOURCE_LIMIT", "The image exceeds the supported render dimensions.");
  }

  let width = 0;
  let height = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    width = Math.max(1, Math.ceil(baseWidth * scale));
    height = Math.max(1, Math.ceil(baseHeight * scale));
    if (width <= MAX_CANVAS_DIMENSION && height <= MAX_CANVAS_DIMENSION && width * height <= maxPixels) {
      break;
    }
    scale *= 0.995;
  }
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION || width * height > maxPixels) {
    throw new ExtractionFailure("RESOURCE_LIMIT", "The image exceeds the supported render dimensions.");
  }

  return { source, upright, baseWidth, baseHeight, boost, scale, width, height };
}

function imageRenderKey(fullSource: SourceCrop, contentCrop: SourceCrop | null, orientation: number, recipe: RenderRecipe, maxPixels: number): string {
  const geometry = resolveImageRenderGeometry(fullSource, contentCrop, orientation, recipe, maxPixels);
  return JSON.stringify(["image", geometry.source.x, geometry.source.y, geometry.source.width, geometry.source.height, geometry.upright.width, geometry.upright.height, geometry.baseWidth, geometry.baseHeight, geometry.boost, geometry.scale, geometry.width, geometry.height, orientation, recipe.rotation, recipe.grayscale === true, recipe.contrast === true]);
}

function renderImage(canvasModule: CanvasModule, image: DecodedImage, fullSource: SourceCrop, contentCrop: SourceCrop | null, orientation: number, recipe: RenderRecipe, maxPixels: number): RenderedPage {
  const { source, upright, scale, width, height } = resolveImageRenderGeometry(fullSource, contentCrop, orientation, recipe, maxPixels);

  let canvas: RasterCanvas | null = canvasModule.createCanvas(width, height);
  let context: Context2D | null = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.save();
  applyRecipeRotation(context, recipe.rotation, width, height);
  applyExifTransform(context, orientation, upright.width * scale, upright.height * scale);
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, source.width * scale, source.height * scale);
  context.restore();

  let pixels: Uint8ClampedArray | null = null;
  if (recipe.grayscale === true || recipe.contrast === true) {
    const imageData = context.getImageData(0, 0, width, height);
    if (recipe.grayscale === true) {
      convertToGrayscale(imageData.data);
    }
    if (recipe.contrast === true) {
      stretchContrast(imageData.data);
    }
    if (recipe.grayscale === true || recipe.contrast === true) {
      context.putImageData(imageData, 0, 0);
    }
    pixels = imageData.data;
  }

  return {
    width,
    height,
    appliedScale: scale,
    rotation: recipe.rotation,
    getPixels(): Uint8ClampedArray {
      if (context === null) {
        throw new ExtractionFailure("PROCESSING_ERROR", "The rendered image surface is already released.");
      }
      pixels ??= context.getImageData(0, 0, width, height).data;
      return pixels;
    },
    toPng(): Promise<Buffer> {
      if (canvas === null) {
        throw new ExtractionFailure("PROCESSING_ERROR", "The rendered image surface is already released.");
      }
      return canvas.encode("png");
    },
    releasePixels(): void {
      pixels = null;
    },
    dispose(): void {
      pixels = null;
      context = null;
      if (canvas !== null) {
        canvas.width = 1;
        canvas.height = 1;
        canvas = null;
      }
    },
  };
}

export async function openImageDocument(data: Uint8Array, format: "jpeg" | "png", maxSourceImagePixels: number): Promise<DocumentHandle> {
  const probe = probeImage(data, format);
  validateImageDimensions(probe.width, probe.height, maxSourceImagePixels);

  const canvasModule = await import("@napi-rs/canvas");
  let image: DecodedImage | null;
  try {
    image = await canvasModule.loadImage(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  } catch (error) {
    throw new ExtractionFailure("INVALID_IMAGE", "The image data could not be decoded.", { cause: error });
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ExtractionFailure("INVALID_IMAGE", "The image data could not be decoded.");
  }
  validateImageDimensions(width, height, maxSourceImagePixels);

  const fullSource = { x: 0, y: 0, width, height };
  let contentCrop: SourceCrop | null | undefined;
  const currentImage = (): DecodedImage => {
    if (image === null) {
      throw new ExtractionFailure("PROCESSING_ERROR", "The image document is already closed.");
    }
    return image;
  };
  const cropForRecipe = (recipe: RenderRecipe, decodedImage: DecodedImage): SourceCrop | null => {
    if (recipe.crop !== true) {
      return null;
    }
    if (contentCrop === undefined) {
      contentCrop = computeContentCrop(canvasModule, decodedImage, width, height);
    }
    return contentCrop;
  };
  const page: DocumentPageLike = {
    pageNumber: 1,
    nativeText: () => null,
    renderKey: (recipe, maxPixels) => {
      const decodedImage = currentImage();
      return imageRenderKey(fullSource, cropForRecipe(recipe, decodedImage), probe.orientation, recipe, maxPixels);
    },
    render: (recipe, maxPixels) => {
      const decodedImage = currentImage();
      return Promise.resolve(renderImage(canvasModule, decodedImage, fullSource, cropForRecipe(recipe, decodedImage), probe.orientation, recipe, maxPixels));
    },
    cleanup: () => undefined,
  };

  return {
    format,
    numPages: 1,
    sourceImageDimensions: {
      width,
      height,
    },
    getPage: (pageNumber) => {
      if (pageNumber !== 1) {
        return Promise.reject(new ExtractionFailure("PROCESSING_ERROR", "An image document has a single page."));
      }
      return Promise.resolve(page);
    },
    close: () => {
      image = null;
      return Promise.resolve();
    },
  };
}
