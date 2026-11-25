"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, Eraser, Moon, RotateCcw, Save, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { DEPARTMENTS, labelOf, type Department } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ATTENDANCE_STATUSES, TIMED_STATUSES, type AttendanceStatus, type HrRules } from "../../constants";
import { formatMinutes, isLate, leaveTypeOf, suggestStatus, toMinutes, workedMinutes } from "../../salary/calc";
import { setUnsavedChanges } from "../../components/unsaved-changes";
import { AttendanceBadge } from "../../components/attendance-badge";
import { clearDay, markDay } from "../actions";
import { FUTURE_STATUSES, allowedAhead, type DailyMark, type DailyRow, type DailySheet } from "../types";

/* The editable state of one row. */

type Draft = {
  status: AttendanceStatus | null;
  leaveType: string | null;
  inTime: string | null;
  outTime: string | null;
  notes: string;
};

const EMPTY: Draft = { status: null, leaveType: null, inTime: null, outTime: null, notes: "" };
const NO_LEAVE = "__none";
const ALL_DEPARTMENTS = "__all";

const isTimed = (s: AttendanceStatus | null) => s !== null && TIMED_STATUSES.includes(s);
const takesLeave = (s: AttendanceStatus | null) => s === "leave" || s === "half_day";

function fromMark(m: DailyMark | null): Draft {
  if (!m) return EMPTY;
  return { status: m.status, leaveType: m.leaveType, inTime: m.inTime, outTime: m.outTime, notes: m.notes ?? "" };
}

/** What would be saved for a draft, so two drafts that save the same compare equal. */
function saveKey(d: Draft): string {
  if (!d.status) return "";
  const timed = isTimed(d.status);
  return JSON.stringify([
    d.status,
    takesLeave(d.status) ? (d.leaveType ?? "") : "",
    timed ? (d.inTime ?? "") : "",
    timed && d.inTime ? (d.outTime ?? "") : "",
    d.notes.trim(),
  ]);
}

/** Problems that stop a row from saving. */
function rowError(d: Draft, future: boolean, rules: HrRules): string | null {
  if (!d.status) return null;
  if (d.status === "leave" && !d.leaveType) return "Pick the leave type";
  // A saved mark may carry a leave type that was later removed from the rules; the server refuses it.
  if (takesLeave(d.status) && d.leaveType && !leaveTypeOf(rules, d.leaveType)) return "Pick another leave type: this one is no longer in the rules";
  if (isTimed(d.status) && d.outTime && !d.inTime) return "Enter the in time too";
  if (future && !allowedAhead(d.status, d.leaveType)) {
    return d.status === "half_day" ? "A half day still to come needs a leave type" : "Only leave, holiday or weekly off on a day still to come";
  }
  if (d.notes.trim().length > 500) return "Notes: at most 500 characters";
  return null;
}

type RowView = {
  row: DailyRow;
  draft: Draft;
  changed: boolean;
  /** The saved mark will be removed on save. */
  clearing: boolean;
  /** Status, leave, times and notes can change. */
  editable: boolean;
  /** The saved mark may be cleared. */
  clearable: boolean;
  error: string | null;
  late: boolean;
  worked: number;
  nightShift: boolean;
};

export function DailySheetView({ sheet, canViewEmployees = false }: { sheet: DailySheet; canViewEmployees?: boolean }) {
  const { date, rules, kind, holidayName, locked, future, rows } = sheet;
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState<string>(ALL_DEPARTMENTS);
  const [pending, startTransition] = useTransition();

  const offDay = kind !== "working";
  const offHint = kind === "holiday" ? `Holiday${holidayName ? `: ${holidayName}` : ""}` : kind === "week_off" ? "Weekly off" : null;

  const views = useMemo<RowView[]>(
    () =>
      rows.map((row) => {
        const original = fromMark(row.mark);
        const draft = edits[row.employeeId] ?? original;
        const changed = saveKey(draft) !== saveKey(original);
        const editable = !locked && (row.mark ? sheet.can.edit : sheet.can.create);
        const timedNow = isTimed(draft.status);
        return {
          row,
          draft,
          changed,
          clearing: changed && !draft.status && row.mark !== null,
          editable,
          clearable: !locked && row.mark !== null && sheet.can.delete,
          error: changed ? rowError(draft, future, rules) : null,
          // As calcSalary counts it: only a full day at work on a working day can be late.
          late: draft.status === "present" && kind === "working" && isLate(draft.inTime, rules),
          worked: timedNow ? workedMinutes(draft.inTime, draft.outTime) : 0,
          nightShift: timedNow && draft.inTime !== null && draft.outTime !== null && (toMinutes(draft.outTime) ?? 0) < (toMinutes(draft.inTime) ?? 0),
        };
      }),
    [rows, edits, locked, sheet.can, future, rules, kind],
  );

  const changedViews = views.filter((v) => v.changed);
  const errors = changedViews.filter((v) => v.error);
  const changes = changedViews.length;

  // Warn before leaving the page with unsaved marks, and before PeriodNav moves to another day.
  useEffect(() => {
    setUnsavedChanges(changes);
    return () => setUnsavedChanges(0);
  }, [changes]);
  useEffect(() => {
    if (!changes) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [changes]);

  const departments = useMemo(() => {
    const values = [...new Set(rows.map((r) => r.department))];
    return values
      .map((value) => ({ value, label: labelOf(DEPARTMENTS, value as Department) || value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const query = search.trim().toLowerCase();
  const shown = views.filter((v) => {
    if (department !== ALL_DEPARTMENTS && v.row.department !== department) return false;
    if (!query) return true;
    return [v.row.name, v.row.code, v.row.designation ?? ""].some((s) => s.toLowerCase().includes(query));
  });

  /* Editing */

  const update = (row: DailyRow, change: (d: Draft) => Draft) => {
    setEdits((prev) => {
      const current = prev[row.employeeId] ?? fromMark(row.mark);
      const next = change(current);
      const copy = { ...prev };
      if (saveKey(next) === saveKey(fromMark(row.mark))) delete copy[row.employeeId];
      else copy[row.employeeId] = next;
      return copy;
    });
  };

  const setStatus = (row: DailyRow, status: AttendanceStatus) =>
    update(row, (d) => ({
      ...d,
      status,
      inTime: isTimed(status) ? d.inTime : null,
      outTime: isTimed(status) ? d.outTime : null,
      leaveType: takesLeave(status) ? d.leaveType : null,
    }));

  const setTime = (row: DailyRow, field: "inTime" | "outTime", value: string) =>
    update(row, (d) => {
      const next: Draft = { ...d, [field]: value || null };
      // Someone with a time came in: an unmarked row becomes present, then the hours refine it.
      if (!next.status && (next.inTime || next.outTime)) next.status = "present";
      if ((next.status === "present" || next.status === "half_day") && next.inTime && next.outTime) {
        const suggested = suggestStatus(next.inTime, next.outTime, rules);
        if (suggested) next.status = suggested;
      }
      return next;
    });

  const revert = (row: DailyRow) =>
    setEdits((prev) => {
      const copy = { ...prev };
      delete copy[row.employeeId];
      return copy;
    });

  const markClear = (row: DailyRow) => update(row, () => EMPTY);

  const bulkTargets = views.filter((v) => !v.row.mark && !v.draft.status && v.editable);
  const markAllPresent = () =>
    setEdits((prev) => {
      const copy = { ...prev };
      for (const v of bulkTargets) copy[v.row.employeeId] = { ...v.draft, status: "present" };
      return copy;
    });

  /* Saving */

  const save = () => {
    if (errors.length) {
      toast.error(`Fix ${errors.length === 1 ? "1 row" : `${errors.length} rows`} before saving: ${errors[0].row.name}, ${errors[0].error?.toLowerCase()}.`);
      return;
    }
    const toMark = changedViews.filter((v) => v.draft.status);
    const toClear = changedViews.filter((v) => v.clearing);
    startTransition(async () => {
      const done: string[] = [];
      let saved = 0;
      let cleared = 0;
      if (toMark.length) {
        const result = await markDay({
          date,
          entries: toMark.map(({ row, draft }) => ({
            employeeId: row.employeeId,
            status: draft.status!,
            leaveType: takesLeave(draft.status) ? draft.leaveType : null,
            inTime: isTimed(draft.status) ? draft.inTime : null,
            outTime: isTimed(draft.status) && draft.inTime ? draft.outTime : null,
            notes: draft.notes.trim() || undefined,
          })),
        });
        if (result.ok) {
          saved = result.data.saved;
          done.push(...toMark.map((v) => v.row.employeeId));
        } else {
          toast.error(result.error);
        }
      }
      if (toClear.length) {
        const result = await clearDay({ date, employeeIds: toClear.map((v) => v.row.employeeId) });
        if (result.ok) {
          cleared = result.data.cleared;
          done.push(...toClear.map((v) => v.row.employeeId));
        } else {
          toast.error(result.error);
        }
      }
      if (done.length) {
        const parts = [saved ? `${formatNumber(saved)} ${saved === 1 ? "mark" : "marks"} saved` : null, cleared ? `${formatNumber(cleared)} cleared` : null].filter(Boolean);
        toast.success(parts.length ? `Attendance updated: ${parts.join(", ")}` : "Attendance updated");
        emitDataChanged();
      }
      startTransition(() => {
        if (done.length) {
          setEdits((prev) => {
            const copy = { ...prev };
            for (const id of done) delete copy[id];
            return copy;
          });
        }
        router.refresh();
      });
    });
  };

  /* Rendering */

  if (!rows.length) {
    return (
      <EmptyState
        icon={Users}
        title="Nobody was employed on this day"
        description="Only employees whose join and exit dates cover this day show here. Add people or set their join dates on the Employees page."
        action={
          canViewEmployees ? (
            <Button asChild variant="outline">
              <Link href="/finance/employees">Open employees</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const controls = { rules, future, offHint, pending, setStatus, setTime, update, revert, markClear };
  const canBulk = !locked && !offDay && !future && sheet.can.create;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code" aria-label="Search employees" />
        </InputGroup>
        {departments.length > 1 ? (
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="w-full sm:w-52" aria-label="Filter by department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DEPARTMENTS}>All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {canBulk ? (
          <Button type="button" variant="outline" className="w-full max-sm:h-auto max-sm:min-h-10 max-sm:py-2 max-sm:whitespace-normal sm:ml-auto sm:w-auto" onClick={markAllPresent} disabled={!bulkTargets.length || pending}>
            <CheckCheck /> Mark everyone not marked as present
            {bulkTargets.length ? <span className="tabular text-muted-foreground">({formatNumber(bulkTargets.length)})</span> : null}
          </Button>
        ) : null}
      </div>

      {!shown.length ? (
        <EmptyState compact icon={Search} title="No one matches" description="Try another name, code or department." />
      ) : (
        <>
          {/* Phones and small tablets: one card per person. */}
          <div className="flex flex-col gap-2 md:hidden">
            {shown.map((v) => (
              <RowCard key={v.row.employeeId} view={v} {...controls} />
            ))}
          </div>

          {/* Wider screens: the sheet. It scrolls inside its own box when narrow. */}
          <div className="hidden min-w-0 overflow-hidden rounded-xl border bg-card shadow-card md:block">
            <Table className="min-w-[1040px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[220px]">Employee</TableHead>
                  <TableHead className="w-[170px]">Status</TableHead>
                  <TableHead className="w-[160px]">Leave type</TableHead>
                  <TableHead className="w-[120px]">In time</TableHead>
                  <TableHead className="w-[120px]">Out time</TableHead>
                  <TableHead className="w-[110px]">Hours</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-[84px] text-right">
                    <span className="sr-only">Row actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((v) => (
                  <TableRow
                    key={v.row.employeeId}
                    data-changed={v.changed || undefined}
                    className={cn("align-top", v.changed && "bg-brand/5 shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand/8", v.error && "bg-danger/5 shadow-[inset_3px_0_0_var(--color-danger)]")}
                  >
                    <TableCell className="py-2.5">
                      <EmployeeCell row={v.row} />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <StatusCell view={v} {...controls} />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <LeaveCell view={v} {...controls} />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <TimeCell view={v} field="inTime" {...controls} />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <TimeCell view={v} field="outTime" {...controls} />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <HoursCell view={v} />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <NotesCell view={v} {...controls} />
                      {v.error ? <p className="mt-1 text-xs text-danger">{v.error}</p> : null}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <RowActions view={v} {...controls} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        {formatNumber(shown.length)} of {formatNumber(rows.length)} {rows.length === 1 ? "person" : "people"} shown. Late means an in time after {rules.workStart} plus{" "}
        {rules.graceMinutes} minutes of grace. An out time before the in time is a night shift that ended the next day.
      </p>

      {changes ? (
        <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
          <p className="mr-auto text-sm" aria-live="polite">
            <span className="font-medium">
              {formatNumber(changes)} {changes === 1 ? "change" : "changes"}
            </span>
            {errors.length ? <span className="text-danger"> · {errors.length === 1 ? "1 row needs attention" : `${errors.length} rows need attention`}</span> : null}
          </p>
          <Button type="button" variant="outline" onClick={() => setEdits({})} disabled={pending} className="max-sm:flex-1">
            Discard
          </Button>
          <Button type="button" onClick={save} disabled={pending || errors.length > 0} className="min-w-28 max-sm:flex-1">
            {pending ? <Spinner /> : <Save />}
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* Cells, shared by the table and the phone cards. */

type Controls = {
  rules: HrRules;
  future: boolean;
  offHint: string | null;
  pending: boolean;
  setStatus: (row: DailyRow, status: AttendanceStatus) => void;
  setTime: (row: DailyRow, field: "inTime" | "outTime", value: string) => void;
  update: (row: DailyRow, change: (d: Draft) => Draft) => void;
  revert: (row: DailyRow) => void;
  markClear: (row: DailyRow) => void;
};

function EmployeeCell({ row }: { row: DailyRow }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{row.name}</p>
      <p className="truncate text-xs text-muted-foreground">
        <span className="font-mono text-[11px]">{row.code}</span>
        {row.designation ? ` · ${row.designation}` : ""}
      </p>
    </div>
  );
}

function StatusCell({ view, future, offHint, pending, setStatus }: { view: RowView } & Controls) {
  const { row, draft, editable, clearing } = view;
  if (!editable) {
    return (
      <div className="flex flex-col items-start gap-1">
        {clearing ? <StatusBadge tone="danger">Will be cleared</StatusBadge> : <AttendanceBadge status={draft.status} leaveType={draft.leaveType} />}
        {!draft.status && offHint ? <span className="text-xs text-muted-foreground">{offHint}</span> : null}
        {row.mark?.leaveBatch && draft.status === row.mark.status ? <span className="text-xs text-muted-foreground">From a leave record</span> : null}
      </div>
    );
  }
  // Ahead of the day: leave, holidays and weekly offs, and a half day of leave (it then needs a leave type).
  const options = ATTENDANCE_STATUSES.filter((s) => !future || FUTURE_STATUSES.includes(s.value) || s.value === "half_day" || s.value === draft.status);
  return (
    <div className="flex flex-col items-start gap-1">
      <Select value={draft.status ?? ""} onValueChange={(v) => setStatus(row, v as AttendanceStatus)} disabled={pending}>
        <SelectTrigger className="w-full" aria-label={`Status for ${row.name}`}>
          <SelectValue placeholder={clearing ? "Will be cleared" : "Not marked"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {clearing ? (
        <StatusBadge tone="danger">Will be cleared</StatusBadge>
      ) : !draft.status ? (
        offHint ? (
          <span className="text-xs text-muted-foreground">{offHint}</span>
        ) : (
          <AttendanceBadge status={null} />
        )
      ) : null}
      {row.mark?.leaveBatch && draft.status === row.mark.status ? <span className="text-xs text-muted-foreground">From a leave record</span> : null}
    </div>
  );
}

function leaveOptions(rules: HrRules, current: string | null) {
  const options = rules.leaveTypes.map((t) => ({ value: t.code, label: `${t.name} (${t.code})` }));
  if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: `${current} (not in the rules)` });
  return options;
}

function LeaveCell({ view, rules, future, offHint, pending, update }: { view: RowView } & Controls) {
  const { row, draft, editable } = view;
  if (!takesLeave(draft.status)) return <span className="sr-only">No leave</span>;
  const name = rules.leaveTypes.find((t) => t.code === draft.leaveType)?.name;
  if (!editable) {
    return draft.leaveType ? (
      <span className="text-sm">{name ? `${name} (${draft.leaveType})` : draft.leaveType}</span>
    ) : (
      <span className="text-xs text-muted-foreground">{draft.status === "half_day" ? (offHint ? "Other half is the day off" : "Other half not paid") : "Not set"}</span>
    );
  }
  const halfDay = draft.status === "half_day";
  // A half day still to come is a half day of leave, so it always needs a leave type.
  const noLeaveOption = halfDay && !future;
  return (
    <Select
      value={draft.leaveType ?? (noLeaveOption ? NO_LEAVE : "")}
      onValueChange={(v) => update(row, (d) => ({ ...d, leaveType: v === NO_LEAVE ? null : v }))}
      disabled={pending}
    >
      <SelectTrigger
        className="w-full"
        aria-label={halfDay ? `Leave for the other half day, ${row.name}` : `Leave type for ${row.name}`}
        aria-invalid={(draft.status === "leave" || (halfDay && future)) && !draft.leaveType ? true : undefined}
      >
        <SelectValue placeholder="Pick leave type" />
      </SelectTrigger>
      <SelectContent>
        {noLeaveOption ? <SelectItem value={NO_LEAVE}>No leave for the other half</SelectItem> : null}
        {leaveOptions(rules, draft.leaveType).map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TimeCell({ view, field, future, pending, setTime }: { view: RowView; field: "inTime" | "outTime" } & Controls) {
  const { row, draft, editable } = view;
  const label = field === "inTime" ? "In time" : "Out time";
  const value = draft[field];
  const timesAllowed = !future && (draft.status === null || isTimed(draft.status));
  if (!editable || !timesAllowed) {
    return value ? <span className="tabular text-sm">{value}</span> : <span className="sr-only">No {label.toLowerCase()}</span>;
  }
  return (
    <Input
      type="time"
      value={value ?? ""}
      onChange={(e) => setTime(row, field, e.target.value)}
      disabled={pending}
      aria-label={`${label} for ${row.name}`}
      aria-invalid={field === "inTime" && view.error === "Enter the in time too" ? true : undefined}
      className="tabular w-full min-w-0"
    />
  );
}

function HoursCell({ view }: { view: RowView }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {view.worked ? <span className="tabular text-sm">{formatMinutes(view.worked)}</span> : <span className="sr-only">No hours</span>}
      {view.nightShift ? (
        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" title="Out time is on the next day">
          <Moon className="size-3" aria-hidden /> Night
        </span>
      ) : null}
      {view.late ? <StatusBadge tone="warning">Late</StatusBadge> : null}
    </div>
  );
}

function NotesCell({ view, pending, update }: { view: RowView } & Controls) {
  const { row, draft, editable } = view;
  if (!editable) return draft.notes ? <p className="text-sm text-pretty [overflow-wrap:anywhere]">{draft.notes}</p> : <span className="sr-only">No notes</span>;
  return (
    <Input
      value={draft.notes}
      onChange={(e) => {
        const notes = e.target.value;
        update(row, (d) => ({ ...d, notes }));
      }}
      maxLength={500}
      disabled={pending || !draft.status}
      placeholder={draft.status ? "Notes" : "Pick a status first"}
      aria-label={`Notes for ${row.name}`}
      className="w-full min-w-0"
    />
  );
}

function RowActions({ view, pending, revert, markClear }: { view: RowView } & Controls) {
  const { row, changed, clearable, clearing } = view;
  return (
    <div className="flex items-center justify-end gap-1">
      {changed ? (
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => revert(row)} disabled={pending} aria-label={`Undo changes for ${row.name}`} title="Undo changes">
          <RotateCcw />
        </Button>
      ) : null}
      {clearable && !clearing ? (
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => markClear(row)} disabled={pending} aria-label={`Clear the mark for ${row.name}`} title="Clear back to not marked">
          <Eraser />
        </Button>
      ) : null}
    </div>
  );
}

function RowCard({ view, ...controls }: { view: RowView } & Controls) {
  const { draft, changed, error } = view;
  const showLeave = takesLeave(draft.status);
  const showTimes = !controls.future && (draft.status === null || isTimed(draft.status));
  return (
    <div
      data-changed={changed || undefined}
      className={cn(
        "min-w-0 rounded-xl border bg-card p-3 shadow-card",
        changed && "border-brand/50 bg-brand/5",
        error && "border-danger/50 bg-danger/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <EmployeeCell row={view.row} />
        <div className="flex shrink-0 items-center gap-1">
          {view.late ? <StatusBadge tone="warning">Late</StatusBadge> : null}
          <RowActions view={view} {...controls} />
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2">
        <StatusCell view={view} {...controls} />
        {showLeave ? <LeaveCell view={view} {...controls} /> : null}
        {showTimes && (view.editable || draft.inTime || draft.outTime) ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-muted-foreground">In time</span>
              <TimeCell view={view} field="inTime" {...controls} />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-muted-foreground">Out time</span>
              <TimeCell view={view} field="outTime" {...controls} />
            </label>
          </div>
        ) : null}
        {view.worked ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Worked</span>
            <HoursCell view={{ ...view, late: false }} />
          </div>
        ) : null}
        {view.editable || draft.notes ? <NotesCell view={view} {...controls} /> : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
