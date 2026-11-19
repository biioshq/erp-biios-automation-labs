import "server-only";

import ExcelJS from "exceljs";
import { COMPANY } from "@/config/company";
import { formatDateTime } from "@/lib/format";
import type { ColumnType, ReportCell, ReportData, ReportSection, SummaryItem } from "../types";
import { sectionsOf } from "./build";

const NUMBER_FORMATS: Record<ColumnType, string | undefined> = {
  money: "#,##,##0.00",
  number: "#,##0.##",
  percent: "0.0%",
  date: "dd-mmm-yyyy",
  text: undefined,
};
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

  if (withSummary && report.summary.length) {
    for (const item of report.summary) {
      ws.getCell(r, 1).value = item.label;
      ws.getCell(r, 1).font = { color: { argb: "FF1C3450" } };
      const cell = ws.getCell(r, 2);
      cell.value = item.value;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "right" };
      const fmt = NUMBER_FORMATS[(item as SummaryItem).type ?? "text"];
      if (fmt && typeof item.value === "number") cell.numFmt = fmt;
      r += 1;
    }
    r += 1;
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
    cell.alignment = { horizontal: c.type === "text" || c.type === "date" ? "left" : "right", vertical: "middle" };
    ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width ?? 0, c.width);
  });
  ws.getRow(r).height = 22;
  r += 1;

  for (const row of section.rows) {
    section.columns.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = toCell(c.type, row[c.key]);
      const fmt = NUMBER_FORMATS[c.type];
      if (fmt) cell.numFmt = fmt;
      if (c.type !== "text" && c.type !== "date") cell.alignment = { horizontal: "right" };
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
      const fmt = NUMBER_FORMATS[c.type];
      if (fmt) cell.numFmt = fmt;
      cell.font = { bold: true };
      cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
      if (c.type !== "text" && c.type !== "date") cell.alignment = { horizontal: "right" };
    });
  }

  ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: 0 }];
  if (section.rows.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: section.columns.length } };
  ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 0, colCount > 0 ? 18 : 10);
  ws.pageSetup = { orientation: section.columns.length > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
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
