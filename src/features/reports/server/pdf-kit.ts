import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import type { jsPDF } from "jspdf";

/**
 * What every PDF the app makes shares: the fonts, the brand colours, rupee formatting and the logo.
 * The files are read from disk and shipped with each PDF route through outputFileTracingIncludes
 * in next.config.ts ("./assets/fonts/**" and "./assets/brand/**").
 */

export const FONT = "FreeSans";

export const NAVY: [number, number, number] = [11, 25, 41];
export const ORANGE: [number, number, number] = [255, 136, 0];
export const MUTED: [number, number, number] = [28, 52, 80];

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let fonts: { regular: string; bold: string } | null = null;

/**
 * FreeSans (GNU FreeFont, embedding allowed by its font exception): the PDF standard fonts have no
 * rupee sign and only Latin-1, so names in Hindi or with symbols would print as "?". Read once per
 * server instance; jsPDF embeds only the glyphs a document uses.
 */
export function loadFonts(doc: jsPDF) {
  fonts ??= {
    regular: readFileSync(path.join(FONT_DIR, "FreeSans.ttf")).toString("base64"),
    bold: readFileSync(path.join(FONT_DIR, "FreeSansBold.ttf")).toString("base64"),
  };
  doc.addFileToVFS("FreeSans.ttf", fonts.regular);
  doc.addFont("FreeSans.ttf", FONT, "normal");
  doc.addFileToVFS("FreeSansBold.ttf", fonts.bold);
  doc.addFont("FreeSansBold.ttf", FONT, "bold");
}

/** Text as typed; only control characters (tabs, stray line breaks inside a cell) become spaces. */
export function clean(text: string): string {
  return text.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ");
}

const grouped = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "₹3,50,000.00" with lakh grouping. */
export function pdfMoney(value: number): string {
  return `${value < 0 ? "-" : ""}₹${grouped.format(Math.abs(value))}`;
}

/** The amount with lakh grouping and no sign, for table cells whose header carries "(₹)". */
export function pdfAmount(value: number): string {
  return `${value < 0 ? "-" : ""}${grouped.format(Math.abs(value))}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "05 Sep 2026" from a "yyyy-mm-dd" IST day: a fixed spelling (Intl writes "Sept"). */
export function pdfDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return clean(ymd);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

/** The horizontal lockup rasterised from public/brand (see scripts/rasterise-logo.ts). Proportions are fixed. */
export const LOGO_RATIO = 774.41 / 74.1;
const LOGO_FILE = path.join(process.cwd(), "assets", "brand", "lockup-horizontal-color-on-light.png");
let logo: { data: string } | null | undefined;

/**
 * The logo as base64 PNG, or null when the file is missing (a deployment that did not ship it):
 * a document then prints the company name as text instead of failing.
 */
export function loadLogo(): string | null {
  if (logo === undefined) {
    try {
      logo = { data: readFileSync(LOGO_FILE).toString("base64") };
    } catch (error) {
      console.error("[pdf] the logo file could not be read; documents print the name as text", error);
      logo = null;
    }
  }
  return logo?.data ?? null;
}

/**
 * Draws the logo with its left edge at x and its top at y, `height` pt tall (never stretched).
 * Returns its width, or 0 when there is no logo file. Brand rule: at least 28 px tall, and keep
 * clear space of two lit-disc widths (about 7% of the logo's width) on every side: callers leave that.
 */
export function drawLogo(doc: jsPDF, x: number, y: number, height: number): number {
  const data = loadLogo();
  if (!data) return 0;
  const width = height * LOGO_RATIO;
  doc.addImage(`data:image/png;base64,${data}`, "PNG", x, y, width, height, "lockup", "FAST");
  return width;
}

/** Clear space around the logo for a given logo height, in pt (two lit-disc widths). */
export const logoClearSpace = (height: number) => Math.ceil(height * 0.5);
