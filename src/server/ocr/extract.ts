import "server-only";

import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createWorker, OEM, type Worker } from "tesseract.js";

import {
  overallConfidence,
  parseInvoiceText,
  type InvoiceExtraction,
  type TextLine,
} from "./parse-invoice";

export type OcrSource = "image-ocr" | "pdf-text" | "pdf-ocr";

export type OcrResult = {
  fields: InvoiceExtraction;
  overallConfidence: number;
  source: OcrSource;
  /** Raw text, kept for audit and for fixing a misread field by eye. */
  text: string;
  durationMs: number;
};

const LANG_PATH = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules/@tesseract.js-data/eng/4.0.0");

const globalForOcr = globalThis as unknown as { __ocrWorker?: Promise<Worker> };

/** One long-lived worker per server process: loading the model takes a second or two. */
function getWorker(): Promise<Worker> {
  if (!globalForOcr.__ocrWorker) {
    globalForOcr.__ocrWorker = (async () => {
      // A writable scratch folder everywhere, including serverless functions (only /tmp is writable there).
      const cachePath = path.join(os.tmpdir(), "biios-tesseract");
      await mkdir(cachePath, { recursive: true });
      return createWorker("eng", OEM.LSTM_ONLY, { langPath: LANG_PATH, cachePath, gzip: true });
    })().catch((error) => {
      globalForOcr.__ocrWorker = undefined;
      throw error;
    });
  }
  return globalForOcr.__ocrWorker;
}

async function ocrImage(image: Buffer): Promise<{ text: string; lines: TextLine[] }> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
  const lines: TextLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        lines.push({ text: line.text, confidence: line.confidence / 100 });
      }
    }
  }
  if (!lines.length) {
    for (const text of data.text.split("\n")) lines.push({ text, confidence: data.confidence / 100 });
  }
  return { text: data.text, lines };
}

async function readPdf(file: Buffer): Promise<{ text: string; lines: TextLine[]; source: OcrSource }> {
  const { getDocumentProxy, extractText, renderPageAsImage } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(file));
  const { text } = await extractText(pdf, { mergePages: true });
  // A digital PDF has a text layer; a scan does not, so it is rendered and read like an image.
  if (text.replace(/\s/g, "").length >= 40) {
    return {
      text,
      lines: text.split("\n").map((t) => ({ text: t, confidence: 1 })),
      source: "pdf-text",
    };
  }
  const png = await renderPageAsImage(pdf, 1, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale: 2.5,
  });
  const result = await ocrImage(Buffer.from(png as Uint8Array));
  return { ...result, source: "pdf-ocr" };
}

export const OCR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;

export async function extractInvoice(file: Buffer, mimeType: string): Promise<OcrResult> {
  const started = performance.now();
  let text: string;
  let lines: TextLine[];
  let source: OcrSource;

  if (mimeType === "application/pdf") {
    ({ text, lines, source } = await readPdf(file));
  } else if (mimeType.startsWith("image/")) {
    ({ text, lines } = await ocrImage(file));
    source = "image-ocr";
  } else {
    throw new Error(`Unsupported file type for OCR: ${mimeType}`);
  }

  const fields = parseInvoiceText(lines);
  return {
    fields,
    overallConfidence: overallConfidence(fields),
    source,
    text,
    durationMs: Math.round(performance.now() - started),
  };
}
