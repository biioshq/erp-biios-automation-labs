import "server-only";

import ExcelJS from "exceljs";
import { COMPANY } from "@/config/company";
import { formatDateTime, round2 } from "@/lib/format";
import { unknownLeaveCodes, type Register, type RegisterTone } from "./format";

/**
 * The monthly register as a file: one row per person, one column per day with the code, then the
 * month's totals. Built from getRegister, like the page, so the two always match. No salary amounts.
 */

export type RegisterFormat = "xlsx" | "csv";

export const REGISTER_CONTENT_TYPES: Record<RegisterFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
};

export const registerFileName = (month: string, format: RegisterFormat) => `attendance-${month}.${format}`;

const TOTAL_HEADERS = ["Present", "Half days", "Absent", "Leave", "Late", "Not marked", "Hours worked"];

const totalsOf = (row: Register["rows"][number]) => [
  row.totals.present,
  row.totals.halfDays,
  row.totals.absent,
  row.totals.leave,
  row.totals.late,
  row.totals.unmarked,
  round2(row.totals.workedMinutes / 60),
];

/* CSV */

/** Text a spreadsheet would run as a formula gets a leading apostrophe. */
const safeText = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
const field = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
const line = (cells: (string | number)[]) => cells.map((c) => field(typeof c === "number" ? String(c) : c)).join(",");

function renderCsv(register: Register): Buffer {
  const lines = [
    line(["Name", "Code", ...register.days.map((d) => `${d.day} ${d.weekdayName.slice(0, 3)}`), ...TOTAL_HEADERS]),
    ...register.rows.map((row) => line([safeText(row.name), safeText(row.code), ...row.cells.map((c) => safeText(c.code)), ...totalsOf(row)])),
  ];
  // A byte order mark so Excel reads names with accents correctly.
  return Buffer.concat([Buffer.from("﻿", "utf8"), Buffer.from(lines.join("\r\n") + "\r\n", "utf8")]);
}

/* Excel */

const HEADER_FILL = "FF0B1929";
const OFF_FILL = "FFEEF0F3";
/** Light fills and dark text per code, close to the page's colours. */
const TONE_STYLE: Partial<Record<RegisterTone, { fill: string; font: string }>> = {
  present: { fill: "FFE3F4EA", font: "FF17663A" },
  half_day: { fill: "FFFDF0D5", font: "FF8A5A00" },
  absent: { fill: "FFFBE2E2", font: "FFA61B1B" },
  leave: { fill: "FFE0EDFB", font: "FF1D4F91" },
  holiday: { fill: "FFEDE6FB", font: "FF5B3A9E" },
  week_off: { fill: "FFE6E8EC", font: "FF4A5361" },
  off: { fill: OFF_FILL, font: "FF8A93A3" },
};
const LATE_FONT = "FFC2410C";

const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

async function renderXlsx(register: Register): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY.name;
  wb.created = new Date();
  wb.title = `Attendance register, ${register.label}`;
  const ws = wb.addWorksheet(register.label.slice(0, 28) || "Register");

  const firstDayCol = 3;
  const firstTotalCol = firstDayCol + register.days.length;
  const lastCol = firstTotalCol + TOTAL_HEADERS.length - 1;

  ws.getCell(1, 1).value = COMPANY.name;
  ws.getCell(1, 1).font = { bold: true, size: 15 };
  ws.getCell(2, 1).value = `Attendance register, ${register.label}`;
  ws.getCell(2, 1).font = { bold: true, size: 12 };
  ws.getCell(3, 1).value = `${register.rows.length} ${register.rows.length === 1 ? "person" : "people"}, ${register.workingDays} working days${register.locked ? ". Salary finalised, attendance locked." : ""}`;
  ws.getCell(3, 1).font = { color: { argb: "FF1C3450" } };
  ws.getCell(4, 1).value = `Generated ${formatDateTime(new Date())} (IST)`;
  ws.getCell(4, 1).font = { size: 9, color: { argb: "FF8A93A3" } };

  const headerRow = 6;
  const header = ws.getRow(headerRow);
  header.height = 30;
  const headerCell = (col: number, value: string, align: "left" | "center" | "right") => {
    const cell = header.getCell(col);
    cell.value = value;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = solid(HEADER_FILL);
    cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
  };
  headerCell(1, "Name", "left");
  headerCell(2, "Code", "left");
  register.days.forEach((d, i) => headerCell(firstDayCol + i, `${d.day}\n${d.weekdayName.slice(0, 3)}`, "center"));
  TOTAL_HEADERS.forEach((h, i) => headerCell(firstTotalCol + i, h, "right"));

  register.rows.forEach((row, r) => {
    const excelRow = ws.getRow(headerRow + 1 + r);
    excelRow.getCell(1).value = row.name;
    excelRow.getCell(2).value = row.code;
    row.cells.forEach((c, i) => {
      const cell = excelRow.getCell(firstDayCol + i);
      cell.value = c.code || null;
      cell.alignment = { horizontal: "center" };
      const style = TONE_STYLE[c.tone];
      const off = register.days[i]?.kind !== "working";
      if (style) cell.fill = solid(style.fill);
      else if (off) cell.fill = solid(OFF_FILL);
      if (style || c.late) cell.font = { bold: c.tone !== "off", color: { argb: c.late ? LATE_FONT : (style?.font ?? "FF000000") } };
      if (c.late) cell.note = "Late arrival";
    });
    totalsOf(row).forEach((v, i) => {
      const cell = excelRow.getCell(firstTotalCol + i);
      cell.value = v;
      cell.numFmt = i === TOTAL_HEADERS.length - 1 ? "0.00" : Number.isInteger(v) ? "0" : "0.0";
      cell.alignment = { horizontal: "right" };
    });
  });

  // The legend under the table.
  let r = headerRow + register.rows.length + 2;
  const legend = [
    "P Present, HD Half day, A Absent, H Holiday, WO Weekly off, L Leave (type not given).",
    register.leaveTypes.length ? `Leave codes: ${register.leaveTypes.map((t) => `${t.code} ${t.name}`).join(", ")}.` : "No leave types are set in the attendance rules.",
    "Orange text with a note: late arrival. Blank: not marked, still to come, or not employed on that day.",
    "Leave counts a half day of leave as half a day. Hours worked come from the in and out times.",
  ];
  const otherCodes = unknownLeaveCodes(register);
  if (otherCodes.length) legend.splice(2, 0, `Leave codes no longer in the attendance rules: ${otherCodes.join(", ")}.`);
  if (register.holidays.length) legend.push(`Holidays: ${register.holidays.map((h) => `${Number(h.date.slice(8, 10))} ${h.name}`).join(", ")}.`);
  for (const text of legend) {
    ws.getCell(r, 1).value = text;
    ws.getCell(r, 1).font = { size: 9, color: { argb: "FF4A5361" } };
    r += 1;
  }

  let nameWidth = 12;
  for (const row of register.rows) nameWidth = Math.max(nameWidth, Math.min(40, row.name.length + 2));
  ws.getColumn(1).width = nameWidth;
  ws.getColumn(2).width = 10;
  for (let c = firstDayCol; c < firstTotalCol; c++) ws.getColumn(c).width = 5;
  TOTAL_HEADERS.forEach((h, i) => (ws.getColumn(firstTotalCol + i).width = Math.max(8, h.length + 2)));

  ws.views = [{ state: "frozen", xSplit: 2, ySplit: headerRow }];
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${headerRow}:${headerRow}`,
    printArea: `A1:${ws.getColumn(lastCol).letter}${Math.max(r - 1, headerRow)}`,
  };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export async function renderRegister(register: Register, format: RegisterFormat): Promise<Buffer> {
  return format === "csv" ? renderCsv(register) : renderXlsx(register);
}
