"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarCheck, CalendarClock, CalendarDays, CircleCheck, CreditCard, FolderKanban, Pause, Percent, Pencil, Play, Repeat, Square, Trash2, User, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS, PROJECT_STAGES, labelOf } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import { dueInfo, rhythmLabel } from "../format";
import type { PostedResult, RecurringDetail } from "../types";
import { RecurringStatusBadge, CategoryBadge } from "./badges";

function Row({ icon: Icon, label, children }: { icon: typeof CalendarDays; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="w-28 shrink-0 text-sm text-muted-foreground sm:w-32">{label}</span>
      <div className="min-w-0 flex-1 text-sm break-words">{children}</div>
    </div>
  );
}

export function RecurringDetailSkeleton() {
  return (
    <FormSheetBody className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64 max-w-full" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </FormSheetBody>
  );
}

/** Read-only view of a schedule with its upcoming dates, posted history and the actions the viewer's role allows. */
export function RecurringDetailView({
  schedule,
  canEdit,
  canRemove,
  justPosted,
  onEdit,
  onPostNext,
  onSetStatus,
  onDelete,
}: {
  schedule: RecurringDetail;
  /** Edit, pause, resume, end and post now. */
  canEdit: boolean;
  /** Delete a schedule that never posted. */
  canRemove: boolean;
  justPosted: PostedResult | null;
  onEdit: () => void;
  onPostNext: () => Promise<boolean>;
  onSetStatus: (action: "pause" | "resume" | "end") => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const due = dueInfo(schedule.nextRunDate, schedule.status);
  const active = schedule.status === "active";
  const deletable = schedule.postedCount === 0 && schedule.occurrences === 0;
  const following = schedule.upcoming[1];

  return (
    <>
      <FormSheetBody className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{schedule.code}</span>
            <CategoryBadge label={schedule.categoryLabel} />
            <RecurringStatusBadge status={schedule.status} />
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Money value={schedule.amount} exact className="text-3xl font-semibold tracking-tight" />
            <span className="text-sm text-muted-foreground">{rhythmLabel(schedule.frequency, schedule.dayOfMonth, schedule.startDate).toLowerCase()}</span>
          </div>
          {schedule.description ? <p className="max-w-prose text-sm text-muted-foreground">{schedule.description}</p> : null}
        </div>

        {justPosted ? (
          <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm" role="status">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                Posted {justPosted.number} for <Money value={justPosted.amount} exact />, dated {formatDate(justPosted.date)}.
              </p>
              <Link href={`/finance/expenses?view=${justPosted.expenseId}`} className="inline-flex min-h-8 items-center gap-1 font-medium underline-offset-4 hover:underline">
                Open the expense <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          </div>
        ) : null}

        <div className="divide-y rounded-xl border px-4">
          <Row icon={CalendarClock} label="Next due">
            {schedule.status === "ended" ? (
              <span className="text-muted-foreground">Ended. No more expenses will post.</span>
            ) : (
              <>
                <p className={cn("font-medium", due.tone === "today" && "text-brand-ink", due.tone === "overdue" && "text-warning")}>
                  {schedule.status === "paused" ? "Paused" : due.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(schedule.nextRunDate)}
                  {schedule.status === "paused" ? ". Resume to keep posting." : ""}
                </p>
              </>
            )}
          </Row>
          <Row icon={Repeat} label="Per month">
            <Money value={schedule.monthly} exact /> <span className="text-xs text-muted-foreground">monthly equivalent</span>
          </Row>
          <Row icon={Wallet} label="Posted so far">
            <Money value={schedule.postedTotal} exact className="font-medium" />{" "}
            <span className="text-xs text-muted-foreground">
              in {schedule.postedCount} expense{schedule.postedCount === 1 ? "" : "s"}
            </span>
          </Row>
          <Row icon={User} label="Vendor">
            <p className="font-medium">{schedule.vendor}</p>
          </Row>
          <Row icon={FolderKanban} label="Project">
            {schedule.project ? (
              <Link href={`/finance/projects/${schedule.project.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                <span className="size-2 shrink-0 rounded-full" style={{ background: schedule.project.color }} />
                {schedule.project.name}
                {schedule.stage ? <span className="font-normal text-muted-foreground">· {labelOf(PROJECT_STAGES, schedule.stage)}</span> : null}
              </Link>
            ) : (
              <span className="text-muted-foreground">Company overhead</span>
            )}
          </Row>
          {schedule.employee ? (
            <Row icon={User} label="Employee">
              <Link href={`/finance/employees/${schedule.employee.id}`} className="font-medium hover:underline">
                {schedule.employee.name}
              </Link>
            </Row>
          ) : null}
          <Row icon={CreditCard} label="Payment">
            {schedule.paymentMethod === "credit" ? "Posted as unpaid" : labelOf(PAYMENT_METHODS, schedule.paymentMethod)}
            <p className="text-xs text-muted-foreground">
              {schedule.category === "salaries" && schedule.paymentMethod !== "credit"
                ? "Recorded as paid on each date."
                : "Each bill waits in Outstanding payments until paid."}
            </p>
          </Row>
          <Row icon={Percent} label="GST">
            {schedule.gstRate > 0 ? (
              <>
                {schedule.gstRate}% included
                {schedule.gstin || schedule.hsnSac ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    {[schedule.gstin, schedule.hsnSac ? `HSN/SAC ${schedule.hsnSac}` : null].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">No GST</span>
            )}
          </Row>
          <Row icon={CalendarDays} label="Runs">
            {formatDate(schedule.startDate)} to {schedule.endDate ? formatDate(schedule.endDate) : "no end date"}
          </Row>
        </div>

        {schedule.status !== "ended" ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Upcoming dates</h3>
            {schedule.upcoming.length ? (
              <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {schedule.upcoming.map((d, i) => (
                  <li
                    key={d}
                    className={cn(
                      "tabular rounded-lg border px-3 py-2 text-sm",
                      i === 0 && schedule.status === "active" ? "border-brand/50 bg-brand/10 font-medium" : "text-muted-foreground",
                    )}
                  >
                    {formatDate(d)}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">No dates left before the end date.</p>
            )}
          </section>
        ) : null}

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Posted expenses</h3>
            {schedule.postedCount > schedule.posted.length ? (
              <Link href={`/finance/expenses?source=recurring&q=${encodeURIComponent(schedule.name)}`} className="inline-flex min-h-8 items-center text-xs font-medium hover:underline">
                Showing latest {schedule.posted.length} of {schedule.postedCount}
              </Link>
            ) : null}
          </div>
          {schedule.posted.length ? (
            <ul className="divide-y rounded-xl border">
              {schedule.posted.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/finance/expenses?view=${e.id}`}
                    className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{formatDate(e.date)}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{e.number}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Money value={e.amount} exact />
                      <ArrowUpRight className="size-3.5 text-muted-foreground" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              <CalendarCheck className="size-4 shrink-0" /> Nothing posted yet. The first expense posts on {formatDate(schedule.nextRunDate)}.
            </p>
          )}
        </section>

        {schedule.notes ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Notes</h3>
            <p className="max-w-prose text-sm whitespace-pre-wrap text-muted-foreground">{schedule.notes}</p>
          </section>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Created {formatDateTime(schedule.createdAt)}
          {schedule.createdBy ? ` by ${schedule.createdBy.name}` : ""}
          {schedule.updatedAt !== schedule.createdAt ? ` · updated ${formatDateTime(schedule.updatedAt)}` : ""}
        </p>
      </FormSheetBody>

      <FormSheetFooter className="flex-wrap justify-start sm:justify-end">
        {!canEdit && !canRemove ? (
          <p className="mr-auto text-xs text-muted-foreground">Your role cannot change schedules.</p>
        ) : (
          <>
            {deletable ? (
              canRemove ? (
                <ConfirmDialog
                  title="Delete this schedule?"
                  description={`${schedule.code} (${schedule.name}) has not posted anything, so it can be removed completely.`}
                  onConfirm={onDelete}
                  trigger={
                    <Button variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger sm:mr-auto">
                      <Trash2 /> Delete
                    </Button>
                  }
                />
              ) : null
            ) : schedule.status !== "ended" ? (
              canEdit ? (
                <ConfirmDialog
                  title="End this schedule?"
                  description={`${schedule.name} stops posting for good. The ${schedule.postedCount} expense${schedule.postedCount === 1 ? "" : "s"} already posted stay in Expenses. This cannot be undone.`}
                  confirmLabel="End schedule"
                  onConfirm={() => onSetStatus("end")}
                  trigger={
                    <Button variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger sm:mr-auto">
                      <Square /> End schedule
                    </Button>
                  }
                />
              ) : null
            ) : (
              <p className="text-xs text-muted-foreground sm:mr-auto">Ended schedules with history cannot be deleted.</p>
            )}
            {canEdit && active ? (
              <>
                <Button variant="outline" onClick={() => void onSetStatus("pause")}>
                  <Pause /> Pause
                </Button>
                <ConfirmDialog
                  title="Post the next expense now?"
                  description={
                    <>
                      This adds an expense of <Money value={schedule.amount} exact /> dated {formatDate(schedule.nextRunDate)} to Expenses
                      {following ? `, and the schedule moves on to ${formatDate(following)}` : ""}.
                    </>
                  }
                  confirmLabel="Post now"
                  destructive={false}
                  onConfirm={onPostNext}
                  trigger={
                    <Button variant="outline">
                      <CalendarCheck /> Post next now
                    </Button>
                  }
                />
              </>
            ) : null}
            {canEdit && schedule.status === "paused" ? (
              <Button variant="outline" onClick={() => void onSetStatus("resume")}>
                <Play /> Resume
              </Button>
            ) : null}
            {canEdit ? (
              <Button onClick={onEdit}>
                <Pencil /> Edit
              </Button>
            ) : null}
          </>
        )}
      </FormSheetFooter>
    </>
  );
}
