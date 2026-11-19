import Link from "next/link";
import { ArrowUpRight, CalendarClock, CheckSquare, Mail, Pencil, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { Section } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { RECURRING_STATUSES, labelOf, type RecurringStatus } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { dateOrNotSet } from "../format";
import type { EmployeePageData, MembershipDTO } from "../types";
import { AllocationBar, DepartmentBadge, EmployeeAvatar, EmployeeStatusBadge, employmentLabel } from "./employee-bits";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="eyebrow">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

function MembershipRow({ m, past }: { m: MembershipDTO; past?: boolean }) {
  return (
    <li>
      <Link
        href={`/finance/projects/${m.project.id}?tab=team`}
        className="flex min-h-14 flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4 sm:px-5"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: m.project.color }} aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-medium">{m.project.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono text-[11px]">{m.project.code}</span> · {m.role}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 pl-5.5 sm:pl-0">
          {past ? null : <AllocationBar value={m.allocation} className="w-28" />}
          <p className="tabular text-xs whitespace-nowrap text-muted-foreground">
            {past ? `${m.allocation}% · ${dateOrNotSet(m.startDate, "Start not set")} to ${dateOrNotSet(m.endDate)}` : `Since ${dateOrNotSet(m.startDate, "start date not set")}${m.endDate ? `, until ${dateOrNotSet(m.endDate)}` : ""}`}
          </p>
          <ArrowUpRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
        </div>
      </Link>
    </li>
  );
}

/** The employee detail page body: header, projects, salary (admins), profile facts and tasks. */
export function EmployeeProfile({ data }: { data: EmployeePageData }) {
  const { employee: e, current, past, salary, linkedUser, tasks } = data;
  const total = current.reduce((sum, m) => sum + m.allocation, 0);

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <EmployeeAvatar name={e.name} department={e.department} size="lg" />
          <div className="min-w-0 space-y-2">
            <div className="space-y-1">
              <p className="eyebrow font-mono">{e.code}</p>
              <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-balance sm:text-2xl md:text-[28px]">{e.name}</h1>
              <p className="text-sm text-muted-foreground">{e.designation ?? employmentLabel(e.employmentType)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <DepartmentBadge department={e.department} />
              <EmployeeStatusBadge status={e.status} />
              <StatusBadge tone="neutral" dot={false}>
                {employmentLabel(e.employmentType)}
              </StatusBadge>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {e.phone ? (
                <a href={`tel:${e.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-10 items-center gap-1.5 hover:underline sm:min-h-6">
                  <Phone className="size-3.5 text-muted-foreground" /> {e.phone}
                </a>
              ) : null}
              {e.email ? (
                <a href={`mailto:${e.email}`} className="inline-flex min-h-10 min-w-0 items-center gap-1.5 hover:underline sm:min-h-6">
                  <Mail className="size-3.5 shrink-0 text-muted-foreground" /> <span className="truncate">{e.email}</span>
                </a>
              ) : null}
              {!e.phone && !e.email ? <span className="text-muted-foreground">No contact details yet</span> : null}
            </div>
          </div>
        </div>
        <Button asChild variant="outline" className="h-10 w-full sm:h-9 sm:w-auto">
          <Link href={`?edit=${e.id}`} scroll={false}>
            <Pencil /> Edit
          </Link>
        </Button>
      </header>

      <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
        <div className="min-w-0 space-y-5 lg:col-span-2 lg:space-y-6">
          <Section
            title="Current projects"
            description={current.length ? `${total}% of their time is allocated` : undefined}
            contentClassName="p-0"
          >
            {current.length ? (
              <ul className="divide-y">
                {current.map((m) => (
                  <MembershipRow key={m.id} m={m} />
                ))}
              </ul>
            ) : (
              <div className="p-4 sm:p-5">
                <EmptyState
                  compact
                  title="Not on a project"
                  description={
                    e.status === "exited"
                      ? "Memberships ended when this person left."
                      : "Add them from a project's Team tab."
                  }
                  action={
                    <Button asChild variant="outline" size="sm">
                      <Link href="/finance/projects">Open projects</Link>
                    </Button>
                  }
                />
              </div>
            )}
          </Section>

          {past.length ? (
            <Section title="Past projects" description={`${past.length} finished`} contentClassName="p-0">
              <ul className="divide-y">
                {past.map((m) => (
                  <MembershipRow key={m.id} m={m} past />
                ))}
              </ul>
            </Section>
          ) : null}

          {salary ? (
            <Section
              title="Salary"
              description="Visible to admins only."
              actions={
                salary.scheduleId ? (
                  <Button asChild variant="outline" size="sm" className="h-10 sm:h-8">
                    <Link href={`/finance/recurring?view=${salary.scheduleId}`}>
                      Open schedule <ArrowUpRight />
                    </Link>
                  </Button>
                ) : null
              }
            >
              <div className="space-y-5">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
                  <Fact label="Monthly salary">
                    <Money value={salary.monthlySalary} className="text-base font-semibold" />
                  </Fact>
                  <Fact label="Next pay date">
                    {salary.nextPayDate ? (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="size-3.5 text-muted-foreground" /> {formatDate(salary.nextPayDate)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not scheduled</span>
                    )}
                  </Fact>
                  <Fact label="Schedule">
                    {salary.scheduleStatus ? (
                      <StatusBadge tone={salary.scheduleStatus === "active" ? "success" : salary.scheduleStatus === "paused" ? "warning" : "neutral"}>
                        {labelOf(RECURRING_STATUSES, salary.scheduleStatus as RecurringStatus)}
                      </StatusBadge>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </Fact>
                  <Fact label={`Paid in ${salary.yearLabel}`}>
                    <Money value={salary.paidThisYear} className="font-semibold" />
                  </Fact>
                </dl>

                {!salary.scheduleId ? (
                  <p className="rounded-lg border border-dashed px-3.5 py-3 text-sm text-muted-foreground">
                    No salary schedule yet. Edit this employee and switch on Pay salary monthly to post it each month.
                  </p>
                ) : null}

                <div>
                  <p className="eyebrow mb-2">Salary paid, latest 12</p>
                  {salary.payments.length ? (
                    <ul className="divide-y rounded-lg border">
                      {salary.payments.map((p) => (
                        <li key={p.id}>
                          <Link
                            href={`/finance/expenses?view=${p.id}`}
                            className="flex min-h-12 items-center justify-between gap-3 px-3.5 py-2.5 text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                          >
                            <span className="min-w-0">
                              <span className="block truncate">{p.description ?? "Salary"}</span>
                              <span className="block text-xs text-muted-foreground">
                                {formatDate(p.date)} · <span className="font-mono text-[11px]">{p.number}</span>
                              </span>
                            </span>
                            <Money value={p.amount} className="font-medium" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No salary has been paid yet.</p>
                  )}
                </div>
              </div>
            </Section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-5 lg:space-y-6">
          <Section title="Profile">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Fact label="Joined">{dateOrNotSet(e.joinDate)}</Fact>
              {e.exitDate ? <Fact label="Left">{dateOrNotSet(e.exitDate)}</Fact> : <Fact label="Type">{employmentLabel(e.employmentType)}</Fact>}
              <Fact label="Sign-in account">
                {linkedUser ? (
                  <span className="block min-w-0">
                    <span className="block truncate">{linkedUser.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{linkedUser.email}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not linked</span>
                )}
              </Fact>
              <Fact label="Allocation">
                <AllocationBar value={total} />
              </Fact>
            </dl>
            {e.skills.length ? (
              <div className="mt-4 space-y-1.5">
                <p className="eyebrow">Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {e.skills.map((s) => (
                    <span key={s} className="inline-flex h-6 items-center rounded-md border bg-surface px-2 text-xs">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {e.notes ? (
              <div className="mt-4 space-y-1.5">
                <p className="eyebrow">Notes</p>
                <p className="max-w-prose text-sm whitespace-pre-line text-muted-foreground">{e.notes}</p>
              </div>
            ) : null}
          </Section>

          <Section title="Tasks" description={linkedUser ? `Assigned to ${linkedUser.name}` : undefined}>
            {tasks && linkedUser ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-brand/12 text-brand-ink">
                    <CheckSquare className="size-4" />
                  </span>
                  <div>
                    <p className="tabular text-xl leading-none font-semibold">{tasks.open}</p>
                    <p className="mt-1 text-xs text-muted-foreground">open of {tasks.total} total</p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="h-10 sm:h-8">
                  <Link href={`/tasks/all?assignee=${linkedUser.id}`}>
                    View tasks <ArrowUpRight />
                  </Link>
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Link a sign-in account to this employee to see the tasks assigned to them.</p>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
