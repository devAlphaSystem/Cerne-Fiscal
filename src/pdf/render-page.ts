import { ExtractionFailure } from "../errors";
import type { RenderRecipe } from "../options";
import type { PdfPageLike } from "./types";

const MAX_CANVAS_DIMENSION = 32_767;

export interface RenderedPage {
  width: number;
  height: number;
  appliedScale: number;
  rotation: number;
  getPixels(): Uint8ClampedArray;
  toPng(): Buffer;
}

export async function renderPage(page: PdfPageLike, recipe: RenderRecipe, maxPixels: number): Promise<RenderedPage> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const rotation = (((page.rotate + recipe.rotation) % 360) + 360) % 360;
  let scale = recipe.scale;
  let viewport = page.getViewport({ scale, rotation });
  let width = 0;
  let height = 0;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
      throw new ExtractionFailure("INVALID_PDF", "A PDF page has invalid dimensions.");
    }

    width = Math.max(1, Math.ceil(viewport.width));
    height = Math.max(1, Math.ceil(viewport.height));
    const allocatedPixels = width * height;
    if (width <= MAX_CANVAS_DIMENSION && height <= MAX_CANVAS_DIMENSION && allocatedPixels <= maxPixels) {
      break;
    }

    const hasSubpixelAxis = viewport.width < 1 || viewport.height < 1;
    const pixelFactor = hasSubpixelAxis ? maxPixels / allocatedPixels : Math.sqrt(maxPixels / allocatedPixels);
    const reduction = Math.min(pixelFactor, MAX_CANVAS_DIMENSION / width, MAX_CANVAS_DIMENSION / height) * 0.999;
    if (!Number.isFinite(reduction) || reduction <= 0 || reduction >= 1) {
      throw new ExtractionFailure("INVALID_PDF", "A PDF page exceeds the supported render dimensions.");
    }
    scale *= reduction;
    viewport = page.getViewport({ scale, rotation });
  }

  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION || width * height > maxPixels) {
    throw new ExtractionFailure("INVALID_PDF", "A PDF page exceeds the supported render dimensions.");
  }
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    intent: "display",
    background: "#ffffff",
  }).promise;
  let pixels: Uint8ClampedArray | null = null;

  return {
    width,
    height,
    appliedScale: scale,
    rotation,
    getPixels(): Uint8ClampedArray {
      pixels ??= context.getImageData(0, 0, width, height).data;
      return pixels;
    },
    toPng(): Buffer {
      return canvas.toBuffer("image/png");
    },
  };
}
