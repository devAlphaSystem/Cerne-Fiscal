import type { DocumentPageText } from "../document/types";
import { ExtractionFailure } from "../errors";
import type { PdfPageLike, PdfTextItemLike } from "./types";

const MAX_TEXT_ITEMS_PER_PAGE = 50_000;
const MAX_TEXT_CHARACTERS_PER_PAGE = 250_000;

interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
}

interface TextLine {
  y: number;
  height: number;
  items: PositionedTextItem[];
}

function isTextItem(value: unknown): value is PdfTextItemLike {
  return typeof value === "object" && value !== null && "str" in value && typeof value.str === "string";
}

function positionedItem(item: PdfTextItemLike): PositionedTextItem {
  const transform = item.transform ?? [];
  return {
    str: item.str,
    x: transform[4] ?? 0,
    y: transform[5] ?? 0,
    width: item.width ?? 0,
    height: Math.abs(item.height ?? transform[3] ?? 10),
    hasEOL: item.hasEOL ?? false,
  };
}

function reconstructLines(items: PositionedTextItem[]): string[] {
  const sorted = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: TextLine[] = [];

  for (const item of sorted) {
    const line = lines.at(-1);
    if (line === undefined || Math.abs(line.y - item.y) > Math.max(2, item.height * 0.45)) {
      lines.push({ y: item.y, height: item.height, items: [item] });
    } else {
      line.items.push(item);
      line.height = Math.max(line.height, item.height);
    }
  }

  return lines.sort((left, right) => right.y - left.y).map((line) => {
    const lineItems = line.items.sort((left, right) => left.x - right.x);
    let text = "";
    let rightEdge: number | null = null;
    for (const item of lineItems) {
      if (rightEdge !== null && item.x - rightEdge > Math.max(0.75, line.height * 0.08)) {
        text += " ";
      }
      text += item.str;
      rightEdge = item.x + item.width;
    }
    return text.trim();
  }).filter((line) => line.length > 0);
}

export async function extractPageText(page: PdfPageLike): Promise<DocumentPageText> {
  const content = await page.getTextContent();
  if (content.items.length > MAX_TEXT_ITEMS_PER_PAGE) {
    throw new ExtractionFailure("RESOURCE_LIMIT", "A PDF page contains too many text items to process safely.");
  }

  const items: PositionedTextItem[] = [];
  let characterCount = 0;
  for (const value of content.items) {
    if (!isTextItem(value)) {
      continue;
    }
    characterCount += value.str.length;
    if (characterCount > MAX_TEXT_CHARACTERS_PER_PAGE) {
      throw new ExtractionFailure("RESOURCE_LIMIT", "A PDF page contains too much text to process safely.");
    }
    items.push(positionedItem(value));
  }

  const orderedText = items.map((item) => `${item.str}${item.hasEOL ? "\n" : " "}`).join("").trim();
  const visualLines = reconstructLines(items);
  return {
    orderedText,
    visualLines,
    hasText: items.some((item) => item.str.trim().length > 0),
  };
}
