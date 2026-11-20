import "server-only";

import type { ReportCell, ReportColumn, ReportData } from "../types";
import { sectionsOf } from "./build";

/**
 * Text that spreadsheets would run as a formula gets a leading apostrophe. A leading "-" counts too,
 * even before a digit ("-1+1" is a formula): only text columns come here, numbers are written separately.
 */
function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cellText(column: ReportColumn, value: ReportCell): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    if (column.type === "money") return value.toFixed(2);
    if (column.type === "percent") return `${(value * 100).toFixed(1)}%`;
    return String(value);
  }
  return column.type === "text" ? safeText(value) : value;
}

/** RFC 4180: quote fields with commas, quotes or line breaks; double embedded quotes. */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const line = (cells: string[]) => cells.map(field).join(",");

/** UTF-8 with a byte order mark so Excel reads rupee-free text and accents correctly. */
export function renderCsv(report: ReportData): Buffer {
  const all = sectionsOf(report);
  const sections = report.csvPrimaryOnly ? [{ title: report.title, columns: report.columns, rows: report.rows, totals: report.totals }] : all;
  const lines: string[] = [];
  sections.forEach((section, index) => {
    if (index > 0) lines.push("");
    if (sections.length > 1) lines.push(line([section.title]));
    lines.push(line(section.columns.map((c) => c.header)));
    // Data rows only: subtotal lines would be counted again by anyone summing a column (the totals line stays last).
    for (const row of section.rows) if (row._kind !== "subtotal") lines.push(line(section.columns.map((c) => cellText(c, row[c.key]))));
    if (section.totals) lines.push(line(section.columns.map((c) => cellText(c, section.totals![c.key]))));
  });
  return Buffer.concat([Buffer.from("﻿", "utf8"), Buffer.from(lines.join("\r\n") + "\r\n", "utf8")]);
}
