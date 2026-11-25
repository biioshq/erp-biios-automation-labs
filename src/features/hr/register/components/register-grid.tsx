import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ATTENDANCE_CELL } from "../../components/attendance-badge";
import { formatMinutes } from "../../salary/calc";
import { dayLabel, type Register, type RegisterCell, type RegisterTone, type RegisterTotals } from "../format";

const CELL_CLASS: Record<RegisterTone, string> = { ...ATTENDANCE_CELL, blank: "" };

const TOTALS: { key: keyof RegisterTotals; label: string; title: string }[] = [
  { key: "present", label: "Present", title: "Days present" },
  { key: "halfDays", label: "Half days", title: "Half days" },
  { key: "absent", label: "Absent", title: "Days absent" },
  { key: "leave", label: "Leave", title: "Leave days (a half day of leave counts half)" },
  { key: "late", label: "Late", title: "Late arrivals on working days" },
  { key: "unmarked", label: "Not marked", title: "Working days up to today with no mark" },
  { key: "workedMinutes", label: "Hours worked", title: "Hours worked, from the in and out times" },
];

function totalText(key: keyof RegisterTotals, value: number): string {
  if (key === "workedMinutes") return value ? formatMinutes(value) : "0h";
  return formatNumber(value);
}

/** The square in one day cell: the code, a dot for an unmarked day, a small corner mark for late. */
function CellMark({ cell }: { cell: RegisterCell }) {
  return (
    <>
      {cell.code ? cell.code : cell.tone === "unmarked" ? <span aria-hidden className="size-1 rounded-full bg-current" /> : null}
      {cell.late ? <span aria-hidden className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-warning ring-1 ring-card" /> : null}
    </>
  );
}

/**
 * The month as a grid: people down the side, days across, totals at the end. The first column and
 * the header row stay in place; the grid scrolls inside its own box so the page never scrolls sideways.
 * Each day links to the daily sheet for that day.
 */
export function RegisterGrid({ register }: { register: Register }) {
  const { days, rows } = register;
  return (
    <div
      role="region"
      aria-label={`Attendance register for ${register.label}`}
      tabIndex={0}
      className="max-h-[min(72vh,760px)] min-w-0 overflow-auto overscroll-x-contain rounded-b-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
        <caption className="sr-only">
          Attendance for {register.label}. One row per person, one column per day, then the month&apos;s totals.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 min-w-[116px] border-r border-b bg-card px-3 py-2 text-left text-[11px] font-medium text-muted-foreground sm:min-w-[200px]"
            >
              Employee
            </th>
            {days.map((d) => {
              const off = d.kind !== "working";
              return (
                <th
                  key={d.date}
                  scope="col"
                  title={`${d.weekdayName}, ${dayLabel(d.date)}${d.holidayName ? `: ${d.holidayName}` : d.kind === "week_off" ? ": weekly off" : ""}`}
                  className={cn("sticky top-0 z-20 w-8 min-w-8 border-b px-0 py-1.5 text-center font-medium", off ? "bg-muted" : "bg-card")}
                >
                  <span
                    className={cn(
                      "tabular mx-auto flex size-6 items-center justify-center rounded-full text-[11px]",
                      d.isToday && "bg-primary text-primary-foreground",
                    )}
                  >
                    {d.day}
                  </span>
                  <span className="block text-[10px] font-normal text-muted-foreground" aria-hidden>
                    {d.weekday}
                  </span>
                  <span className="sr-only">{d.weekdayName}</span>
                </th>
              );
            })}
            {TOTALS.map((t, i) => (
              <th
                key={t.key}
                scope="col"
                title={t.title}
                className={cn(
                  "sticky top-0 z-20 border-b bg-card px-2 py-2 text-right align-bottom text-[11px] font-medium whitespace-nowrap text-muted-foreground",
                  i === 0 && "border-l",
                )}
              >
                {t.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="group">
              <th scope="row" className="sticky left-0 z-10 border-r border-b bg-card px-3 py-1.5 text-left font-normal group-hover:bg-muted">
                <span className="block max-w-[100px] truncate text-[13px] font-medium sm:max-w-[200px]" title={row.name}>
                  {row.name}
                </span>
                <span className="block font-mono text-[10px] text-muted-foreground">{row.code}</span>
              </th>
              {row.cells.map((cell, i) => {
                const off = days[i]?.kind !== "working";
                const square = "relative mx-auto flex size-7 items-center justify-center rounded-md text-[10px] font-semibold leading-none";
                return (
                  <td key={cell.date} className={cn("border-b p-0.5 text-center", off && "bg-muted/50")}>
                    {cell.employed ? (
                      <Link
                        href={`/hr/attendance?date=${cell.date}`}
                        prefetch={false}
                        title={cell.label}
                        aria-label={cell.label}
                        className={cn(
                          square,
                          CELL_CLASS[cell.tone],
                          !cell.marked && cell.tone === "off" && "bg-transparent opacity-70",
                          "outline-none hover:ring-1 hover:ring-ring/60 focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <CellMark cell={cell} />
                      </Link>
                    ) : (
                      <span title={cell.label} className={cn(square, CELL_CLASS.not_employed)}>
                        <span className="sr-only">{cell.label}</span>
                      </span>
                    )}
                  </td>
                );
              })}
              {TOTALS.map((t, i) => {
                const value = row.totals[t.key];
                return (
                  <td
                    key={t.key}
                    className={cn(
                      "tabular border-b px-2 py-1.5 text-right whitespace-nowrap group-hover:bg-muted/40",
                      i === 0 && "border-l",
                      value ? "font-medium" : "text-muted-foreground/70",
                      t.key === "unmarked" && value ? "text-warning" : null,
                    )}
                  >
                    {totalText(t.key, value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
