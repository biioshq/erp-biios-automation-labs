import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import autoTable, { type CellDef } from "jspdf-autotable";
import { COMPANY } from "@/config/company";
import { formatDateTime } from "@/lib/format";
import type { ColumnType, ReportCell, ReportColumn, ReportData, SummaryItem } from "../types";
import { sectionsOf } from "./build";

/**
 * FreeSans (GNU FreeFont, embedding allowed by its font exception): the PDF standard fonts have no
 * rupee sign and only Latin-1, so names in Hindi or with symbols (Ω, ₹, en dashes) would print as "?".
 * Read once per server instance; jsPDF embeds only the glyphs a report uses.
 */
// Shipped with the report route through outputFileTracingIncludes in next.config.ts.
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let fonts: { regular: string; bold: string } | null = null;
function loadFonts(doc: jsPDF) {
  fonts ??= {
    regular: readFileSync(path.join(FONT_DIR, "FreeSans.ttf")).toString("base64"),
    bold: readFileSync(path.join(FONT_DIR, "FreeSansBold.ttf")).toString("base64"),
  };
  doc.addFileToVFS("FreeSans.ttf", fonts.regular);
  doc.addFont("FreeSans.ttf", FONT, "normal");
  doc.addFileToVFS("FreeSansBold.ttf", fonts.bold);
  doc.addFont("FreeSansBold.ttf", FONT, "bold");
}
const FONT = "FreeSans";

/** Text as typed; only control characters (tabs, stray line breaks inside a cell) become spaces. */
function clean(text: string): string {
  return text.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ");
}

const grouped = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** "₹3,50,000.00" with lakh grouping. */
export function pdfMoney(value: number): string {
  return `${value < 0 ? "-" : ""}₹${grouped.format(Math.abs(value))}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "05 Sep 2026": a fixed spelling (Intl writes "Sept"), matching the month labels of the reports. */
function pdfDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return clean(ymd);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

/** Table cells: amounts without the currency sign (the column header carries "(₹)"), so columns stay narrow. */
function pdfValue(type: ColumnType, value: ReportCell, inTable = true): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return type === "date" ? pdfDate(value) : clean(value);
  if (type === "money") return inTable ? `${value < 0 ? "-" : ""}${grouped.format(Math.abs(value))}` : pdfMoney(value);
  if (type === "percent") return `${(value * 100).toFixed(1)}%`;
  return plain.format(value);
}

const summaryText = (item: SummaryItem) => (typeof item.value === "number" ? pdfValue(item.type ?? "number", item.value, false) : clean(item.value));

const NAVY: [number, number, number] = [11, 25, 41];
const ORANGE: [number, number, number] = [255, 136, 0];
const MUTED: [number, number, number] = [28, 52, 80];

export function renderPdf(report: ReportData): Buffer {
  const sections = sectionsOf(report);
  const widest = Math.max(...sections.map((s) => s.columns.length));
  const landscape = widest > 7;
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4", compress: true });
  loadFonts(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const bodyTop = 52;

  // First-page masthead.
  doc.setFillColor(...ORANGE);
  doc.rect(margin, 34, 4, 38, "F");
  doc.setFont(FONT, "bold").setFontSize(10).setTextColor(...NAVY);
  doc.text(clean(COMPANY.name).toUpperCase(), margin + 12, 44);
  doc.setFontSize(18).setTextColor(...NAVY);
  doc.text(clean(report.title), margin + 12, 64);
  doc.setFont(FONT, "normal").setFontSize(8).setTextColor(...MUTED);
  doc.text(`Generated ${formatDateTime(new Date())} IST`, pageW - margin, 44, { align: "right" });
  let y = 82;
  if (report.subtitle) {
    // Measured at the size it prints in, so a long subtitle wraps inside the margins.
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(clean(report.subtitle), pageW - margin * 2) as string[];
    doc.text(lines, margin, y);
    y += lines.length * 11 + 4;
  }

  // Summary block: label above value, up to four per row.
  if (report.summary.length && !report.hideSummaryBlock) {
    const perRow = Math.min(report.summary.length, landscape ? 6 : 4);
    const cellW = (pageW - margin * 2) / perRow;
    y += 6;
    report.summary.forEach((item, i) => {
      const x = margin + (i % perRow) * cellW;
      const rowY = y + Math.floor(i / perRow) * 34;
      doc.setFont(FONT, "normal").setFontSize(7.5).setTextColor(...MUTED);
      doc.text(clean(item.label).toUpperCase(), x, rowY);
      doc.setFont(FONT, "bold").setFontSize(11).setTextColor(...NAVY);
      doc.text(summaryText(item), x, rowY + 14);
    });
    y += Math.ceil(report.summary.length / perRow) * 34;
    doc.setDrawColor(220, 224, 232).line(margin, y - 6, pageW - margin, y - 6);
    y += 8;
  }

  sections.forEach((section, index) => {
    if (!section.columns.length) return;
    if (report.sections) {
      // Start a table section on a new page when little room is left for its heading and first rows.
      if (y > pageH - 120) {
        doc.addPage();
        y = bodyTop;
      }
      doc.setFont(FONT, "bold").setFontSize(11).setTextColor(...NAVY);
      doc.text(clean(section.title), margin, y + 4);
      y += 12;
    }
    const kinds = section.rows.map((r) => r._kind);
    const body: CellDef[][] = section.rows.map((row) => section.columns.map((c) => ({ content: pdfValue(c.type, row[c.key]) })));
    const foot: CellDef[][] | undefined = section.totals
      ? [
          section.columns.map((c) => ({
            content: pdfValue(c.type, section.totals![c.key]),
            styles: { halign: c.type === "text" || c.type === "date" ? "left" : "right" },
          })),
        ]
      : undefined;
    const headerText = (c: ReportColumn) => clean(c.type === "money" ? `${c.header} (₹)` : c.header);
    // Nothing breaks inside a word: dates and amounts keep their whole value on one line, text and
    // headings at least their longest word (bold for headings and totals). Text then wraps between
    // words in the room left. A table too wide for that at its size steps the font down.
    const padX = 6.5;
    const words = (text: string) => text.split(/\s+/).filter(Boolean);
    const minWidths = (size: number) =>
      section.columns.map((c, i) => {
        let w = 0;
        doc.setFont(FONT, "normal").setFontSize(size);
        for (const cellRow of body) {
          const text = String(cellRow[i]?.content ?? "");
          for (const part of c.type === "text" ? words(text) : [text]) w = Math.max(w, doc.getTextWidth(part));
        }
        doc.setFont(FONT, "bold");
        for (const part of words(headerText(c))) w = Math.max(w, doc.getTextWidth(part));
        if (foot) for (const part of c.type === "text" ? words(String(foot[0]![i]?.content ?? "")) : [String(foot[0]![i]?.content ?? "")]) w = Math.max(w, doc.getTextWidth(part));
        return Math.ceil(w + padX + 1);
      });
    const room = pageW - margin * 2;
    let fontSize = section.columns.length > 12 ? 6.5 : section.columns.length > 9 ? 7 : 8;
    let mins = minWidths(fontSize);
    while (mins.reduce((s, w) => s + w, 0) > room && fontSize > 5) {
      fontSize = Math.round((fontSize - 0.25) * 100) / 100;
      mins = minWidths(fontSize);
    }
    const columnStyles = Object.fromEntries(
      section.columns.map((c: ReportColumn, i) => [i, { halign: c.type === "text" || c.type === "date" ? "left" : "right", minCellWidth: mins[i] } as const]),
    );
    autoTable(doc, {
      startY: y,
      head: [section.columns.map((c, i) => ({ content: headerText(c), styles: { halign: columnStyles[i].halign } }))],
      body: body.length ? body : [[{ content: "No entries in this period.", colSpan: section.columns.length, styles: { halign: "center", textColor: MUTED } }]],
      foot,
      showFoot: "lastPage",
      // A row never splits across pages (a date's year alone at the top of the next page).
      rowPageBreak: "avoid",
      margin: { top: bodyTop, left: margin, right: margin, bottom: 40 },
      theme: "plain",
      styles: { font: FONT, fontSize, cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 }, textColor: [30, 37, 52], overflow: "linebreak", lineColor: [222, 214, 203], lineWidth: { bottom: 0.4 } },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", lineWidth: 0 },
      footStyles: { fontStyle: "bold", fillColor: [244, 237, 227], textColor: NAVY, lineWidth: { top: 0.8 }, lineColor: NAVY },
      alternateRowStyles: { fillColor: [250, 251, 253] },
      columnStyles,
      didParseCell: (data) => {
        if (data.section === "body" && kinds[data.row.index] === "subtotal") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [241, 244, 249];
        }
      },
      didDrawPage: (data) => {
        y = data.cursor?.y ?? y;
      },
    });
    y += index < sections.length - 1 ? 22 : 0;
  });

  // Running header (pages after the first) and page numbers.
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont(FONT, "normal").setFontSize(8).setTextColor(...MUTED);
    if (page > 1) {
      doc.text(clean(`${COMPANY.name}  |  ${report.title}`), margin, 32);
      doc.setDrawColor(226, 230, 238).line(margin, 38, pageW - margin, 38);
    }
    doc.text(clean(COMPANY.name), margin, pageH - 22);
    doc.text(`Page ${page} of ${total}`, pageW - margin, pageH - 22, { align: "right" });
  }

  return Buffer.from(doc.output("arraybuffer"));
}
