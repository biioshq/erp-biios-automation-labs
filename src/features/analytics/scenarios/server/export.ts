import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Report } from "@/server/models";
import { bumpChanges } from "@/server/changes";
import { SCENARIO_STATUSES, SCENARIO_TYPES, labelOf } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { toDateInput } from "@/lib/dates";
import type { ReportData, ReportRow, ReportSection, SummaryItem } from "@/features/reports/types";
import { formatCell } from "../format";
import type { CompareColumn, CompareRow } from "../compare";
import type { ScenarioDetail, ScenarioResults } from "../types";

/**
 * Scenario results as a ReportData, so the shared Excel and PDF renderers lay them out like every
 * other report. Mixed-type tables (current against scenario) are written as formatted text.
 */

// Scenario files are not built by buildReport, and /api/reports refuses this type; the export log
// uses it so "Download again" goes back to the scenario export (see listReportHistory).
const REPORT_TYPE = "scenario" as const;

const text = (title: string, rows: [string, string][], headers: [string, string] = ["Item", "Value"]): ReportSection => ({
  title,
  columns: [
    { key: "a", header: headers[0], type: "text", width: 36 },
    { key: "b", header: headers[1], type: "text", width: 70 },
  ],
  rows: rows.map(([a, b]) => ({ a, b })),
  totals: null,
});

function resultSections(r: ScenarioResults): ReportSection[] {
  const sections: ReportSection[] = [
    {
      title: "Current position vs scenario",
      columns: [
        { key: "parameter", header: "Parameter", type: "text", width: 40 },
        { key: "current", header: "Current", type: "text", width: 20 },
        { key: "scenario", header: "Scenario", type: "text", width: 20 },
        { key: "difference", header: "Difference", type: "text", width: 20 },
      ],
      rows: r.comparison.map((c) => ({
        parameter: c.parameter,
        current: formatCell(c.type, c.current, c.unit),
        scenario: formatCell(c.type, c.scenario, c.unit),
        difference: c.difference === null ? "" : formatCell(c.type, c.difference, c.unit, true),
      })),
      totals: null,
    },
  ];
  for (const t of r.tables) {
    sections.push({
      title: t.title,
      columns: t.columns.map((c) => ({ key: c.key, header: c.header, type: c.type, width: c.type === "text" ? 32 : 16 })),
      rows: t.rows.length ? t.rows.map((row) => ({ ...row.cells }) as ReportRow) : [{ [t.columns[0]?.key ?? "a"]: t.emptyText ?? "Nothing to show" }],
      totals: t.totals ?? null,
    });
  }
  const notes: [string, string][] = [...r.notes.map((n) => ["How it is worked out", n] as [string, string]), ...r.notRecorded.map((n) => [`Not recorded: ${n.label}`, n.detail] as [string, string])];
  if (notes.length) sections.push(text("Notes", notes, ["Topic", "Detail"]));
  return sections;
}

export function scenarioReport(detail: ScenarioDetail, results: ScenarioResults, basis: "saved" | "today"): ReportData {
  // Numbers with a unit ("4 days") are written as text so the unit is kept.
  const summary: SummaryItem[] = results.stats.map((s) => {
    const asNumber = typeof s.value === "number" && s.type !== "date" && !s.unit;
    return { label: s.label, value: s.value === null ? "Not known" : asNumber ? (s.value as number) : formatCell(s.type, s.value, s.unit), type: asNumber ? s.type : "text" };
  });
  const inputs = text("Inputs and assumptions", [
    ["Scenario", `${detail.name} (${detail.code})`],
    ["Type", labelOf(SCENARIO_TYPES, detail.type)],
    ["Status", labelOf(SCENARIO_STATUSES, detail.status)],
    ["Created by", detail.createdBy ?? "Not recorded"],
    ["Figures", basis === "saved" ? `As saved on ${formatDateTime(results.computedAt)}` : `With data as of ${formatDateTime(results.computedAt)}`],
    ["Summary", results.headline],
    ...(detail.description ? [["Description", detail.description] as [string, string]] : []),
    ...(detail.assumptions ? [["Assumptions", detail.assumptions] as [string, string]] : []),
    ...detail.inputSummary.map((l) => [l.label, l.value] as [string, string]),
  ]);
  // Excel reserves the sheet name "History".
  const history = text(
    "Change history",
    detail.history.map((h) => [`${formatDateTime(h.at)}${h.byName ? `, ${h.byName}` : ""}`, [...h.changes, h.note ? `Note: ${h.note}` : ""].filter(Boolean).join("; ")]),
    ["When and who", "What changed"],
  );
  const sections = [inputs, ...resultSections(results), history];
  return {
    ...sections[0],
    type: REPORT_TYPE,
    title: `What-if scenario: ${detail.name}`,
    subtitle: `${detail.code} · ${labelOf(SCENARIO_TYPES, detail.type)} · ${basis === "saved" ? "as saved" : "with today's data"}`,
    summary,
    sections,
  };
}

export function comparisonReport(columns: CompareColumn[], rows: CompareRow[]): ReportData {
  const section: ReportSection = {
    title: "Scenario comparison",
    columns: [
      { key: "measure", header: "Measure", type: "text", width: 40 },
      { key: "current", header: "Current business position", type: "text", width: 22 },
      ...columns.map((c, i) => ({ key: `s${i}`, header: `${c.name} (${c.code})`, type: "text" as const, width: 24 })),
    ],
    rows: rows.map((r) => {
      const cell = (v: CompareRow["current"]) => (Array.isArray(v) ? (v.length ? v.join("; ") : "None") : r.type === "list" ? "" : v === null ? "-" : formatCell(r.type, v));
      return { measure: r.label, current: cell(r.current), ...Object.fromEntries(r.values.map((v, i) => [`s${i}`, cell(v)])) } as ReportRow;
    }),
    totals: null,
  };
  const legend = text("Legend", [
    ["-", "Does not apply to this type of scenario."],
    ["Impact rows", "Change from today, so the current position is zero."],
    ...columns.map((c) => [c.code, c.basis === "saved" && c.savedAt ? `As saved on ${formatDateTime(c.savedAt)}` : "With today's data"] as [string, string]),
  ]);
  return {
    ...section,
    type: REPORT_TYPE,
    title: "Scenario comparison",
    subtitle: `${columns.length} scenarios, ${toDateInput(new Date())}`,
    summary: [],
    sections: [section, legend],
  };
}

/**
 * What a scenario export logs as its filters: the scenario (one, or several for a comparison) and
 * whether the figures were as saved or with today's data. "Download again" rebuilds from these.
 */
export type ScenarioExportFilters = { scenarios: string[]; basis: "saved" | "today" };

/**
 * Logs a scenario or comparison export in the Report collection, as /api/reports does for reports, so it
 * shows in the export history. Never throws: the log must not block a download.
 */
export async function logScenarioExport(entry: {
  report: ReportData;
  format: "pdf" | "xlsx";
  fileName: string;
  userId: string;
  filters: ScenarioExportFilters;
}): Promise<void> {
  try {
    await connectDB();
    await Report.create({
      type: REPORT_TYPE,
      format: entry.format,
      title: entry.report.title,
      filters: { scenarios: entry.filters.scenarios.slice(0, 20), basis: entry.filters.basis },
      // A scenario file is a set of small tables; the comparison's rows are its measures.
      rowCount: (entry.report.sections ?? [entry.report]).reduce((n, sec) => n + sec.rows.length, 0),
      fileName: entry.fileName,
      generatedBy: Types.ObjectId.isValid(entry.userId) ? new Types.ObjectId(entry.userId) : undefined,
    });
    await bumpChanges();
  } catch (error) {
    console.error("Could not log scenario export", error);
  }
}
