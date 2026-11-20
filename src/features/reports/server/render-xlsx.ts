import "server-only";

import ExcelJS from "exceljs";
import { COMPANY } from "@/config/company";
import { formatDateTime } from "@/lib/format";
import type { ColumnType, ReportCell, ReportData, ReportSection, SummaryItem } from "../types";
import { sectionsOf } from "./build";

/**
 * Indian digit grouping (1,23,45,678.90) as a fixed pattern for this value's size. Excel's own
 * "#,##0" groups by thousands unless the computer is set to Indian grouping, so the pattern spells
 * the commas out. One section only, so Excel adds the minus sign to negative amounts itself.
 */
export function indianFormat(value: number, decimals: number): string {
  const dec = decimals ? `.${"0".repeat(decimals)}` : "";
  const intDigits = String(Math.floor(Math.abs(Number(value.toFixed(decimals))))).length;
  if (intDigits <= 5) return `#,##0${dec}`;
  let pattern = "##0";
  for (let i = 0; i < Math.ceil((intDigits - 3) / 2); i++) pattern = `##\\,${pattern}`;
  return `${pattern}${dec}`;
}

/** The format for one cell: money to the paisa, counts without a trailing dot, quantities to 3 decimals. */
function numFmtFor(type: ColumnType, value: unknown): string | undefined {
  if (type === "date") return "dd-mmm-yyyy";
  if (type === "percent") return "0.0%";
  if (typeof value !== "number") return undefined;
  if (type === "money") return indianFormat(value, 2);
  if (type === "number") return Number.isInteger(value) ? indianFormat(value, 0) : "#,##0.###";
  return undefined;
}

/** How wide a value shows, in characters, to size its column. */
const grouped = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function shownLength(type: ColumnType, value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return type === "money" ? grouped.format(value).length : type === "percent" ? 7 : String(value).length + 2;
  if (type === "date") return 11;
  return String(value).length;
}
const HEADER_FILL = "FF0B1929";
const BAND_FILL = "FFF4EDE3";

function toCell(type: ColumnType, value: ReportCell): string | number | Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (type === "date" && typeof value === "string") {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  return value;
}

function sheetName(title: string, taken: Set<string>): string {
  const base = title.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Sheet";
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}

function writeSection(ws: ExcelJS.Worksheet, report: ReportData, section: ReportSection, withSummary: boolean) {
  const colCount = Math.max(section.columns.length, 4);
  let r = 1;
  ws.getCell(r, 1).value = COMPANY.name;
  ws.getCell(r, 1).font = { bold: true, size: 15 };
  r += 1;
  ws.getCell(r, 1).value = section === sectionsOf(report)[0] || !report.sections ? report.title : `${report.title}: ${section.title}`;
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  r += 1;
  if (report.subtitle) {
    ws.getCell(r, 1).value = report.subtitle;
    ws.getCell(r, 1).font = { color: { argb: "FF1C3450" } };
    r += 1;
  }
  ws.getCell(r, 1).value = `Generated ${formatDateTime(new Date())} (IST)`;
  ws.getCell(r, 1).font = { size: 9, color: { argb: "FF8A93A3" } };
  r += 2;

  // Headline figures two to a row (label, value, label, value), so the block above the table stays short.
  const summaryWidths: number[] = [];
  if (withSummary && report.summary.length) {
    report.summary.forEach((item: SummaryItem, i) => {
      const row = r + Math.floor(i / 2);
      const colIndex = (i % 2) * 2 + 1;
      ws.getCell(row, colIndex).value = item.label;
      ws.getCell(row, colIndex).font = { color: { argb: "FF1C3450" } };
      const cell = ws.getCell(row, colIndex + 1);
      cell.value = item.value;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "right" };
      const fmt = numFmtFor(item.type ?? "text", item.value);
      if (fmt) cell.numFmt = fmt;
      summaryWidths[colIndex] = Math.max(summaryWidths[colIndex] ?? 0, item.label.length + 2);
      summaryWidths[colIndex + 1] = Math.max(summaryWidths[colIndex + 1] ?? 0, shownLength(item.type ?? "text", item.value) + 3);
    });
    r += Math.ceil(report.summary.length / 2) + 1;
  }

  if (section.title && report.sections) {
    ws.getCell(r, 1).value = section.title;
    ws.getCell(r, 1).font = { bold: true, size: 12 };
    r += 1;
  }

  const headerRow = r;
  section.columns.forEach((c, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: c.type === "text" || c.type === "date" ? "left" : "right", vertical: "middle", wrapText: true };
    // Wide enough for the longest value (names are not cut off), within reason; longer text wraps.
    let longest = c.header.length + 2;
    for (const row of [...section.rows, ...(section.totals ? [section.totals] : [])]) longest = Math.max(longest, shownLength(c.type, row[c.key]) + 2);
    const cap = c.type === "text" ? 60 : 22;
    ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width ?? 0, c.width, Math.min(longest, cap), summaryWidths[i + 1] ?? 0);
  });
  ws.getRow(r).height = 22;
  r += 1;

  for (const row of section.rows) {
    section.columns.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = toCell(c.type, row[c.key]);
      const fmt = numFmtFor(c.type, row[c.key]);
      if (fmt) cell.numFmt = fmt;
      if (c.type !== "text" && c.type !== "date") cell.alignment = { horizontal: "right" };
      else if (c.type === "text" && String(row[c.key] ?? "").length > 60) cell.alignment = { wrapText: true, vertical: "top" };
      if (row._kind === "subtotal") {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL } };
      }
    });
    r += 1;
  }

  if (section.totals) {
    section.columns.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = toCell(c.type, section.totals![c.key]);
      const fmt = numFmtFor(c.type, section.totals![c.key]);
      if (fmt) cell.numFmt = fmt;
      cell.font = { bold: true };
      cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
      if (c.type !== "text" && c.type !== "date") cell.alignment = { horizontal: "right" };
    });
  }

  ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: 0 }];
  // Filters suit registers; on statements (a few columns) and tables with subtotal lines a sort would scramble them.
  const statement = section.columns.length <= 3 || section.rows.some((row) => row._kind === "subtotal");
  if (section.rows.length && !statement) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: section.columns.length } };
  }
  ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 0, colCount > 0 ? 18 : 10, summaryWidths[1] ?? 0);
  ws.pageSetup = {
    orientation: section.columns.length > 7 ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    // Printed pages repeat the column headings, as the PDF does.
    printTitlesRow: `${headerRow}:${headerRow}`,
  };
}

export async function renderXlsx(report: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY.name;
  wb.created = new Date();
  wb.title = report.title;
  const taken = new Set<string>();
  const sections = sectionsOf(report);
  sections.forEach((section, i) => {
    const ws = wb.addWorksheet(sheetName(report.sections ? section.title : report.title, taken));
    // A multi-table report puts its headline numbers on the first sheet only.
    writeSection(ws, report, section, i === 0 && !report.hideSummaryBlock);
  });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
