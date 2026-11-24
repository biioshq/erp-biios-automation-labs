import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShieldCheck } from "lucide-react";
import { reportGroupsFor, reportPermissions, type ReportMeta } from "../meta";
import type { ReportType } from "@/lib/constants";
import { MEMBER_DEFAULT_PERMISSIONS } from "@/lib/permissions";

/** Reports the built-in member role cannot open by default. Admins see a mark on them. */
const memberDefaults = new Set(MEMBER_DEFAULT_PERMISSIONS);
const restricted = (type: ReportType) => !(reportPermissions(type) ?? []).every((p) => memberDefaults.has(p));

/**
 * The report picker, grouped by what each report covers. Each card is a link, so it works without
 * client JavaScript. Only the reports the viewer may build are shown (`allowed`).
 */
export function ReportCards({
  selected,
  hrefFor,
  allowed,
  markRestricted = false,
}: {
  selected?: ReportType;
  hrefFor: (meta: ReportMeta) => string;
  allowed: ReadonlySet<ReportType>;
  /** Marks the cards the member role does not get by default (for people who manage roles). */
  markRestricted?: boolean;
}) {
  return (
    <div className="space-y-5">
      {reportGroupsFor(allowed).map((g) => (
        <section key={g.key} aria-labelledby={`report-group-${g.key}`} className="space-y-2.5">
          <h2 id={`report-group-${g.key}`} className="eyebrow">
            {g.label}
          </h2>
          <CardGrid reports={g.reports} selected={selected} hrefFor={hrefFor} markRestricted={markRestricted} />
        </section>
      ))}
    </div>
  );
}

function CardGrid({
  reports,
  selected,
  hrefFor,
  markRestricted,
}: {
  reports: ReportMeta[];
  selected?: ReportType;
  hrefFor: (meta: ReportMeta) => string;
  markRestricted: boolean;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
      {reports.map((m) => {
        const active = m.type === selected;
        return (
          <Link
            key={m.type}
            href={hrefFor(m)}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={cn(
              "group relative flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-card transition-all outline-none hover:border-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50",
              active && "border-brand-ink/50 ring-1 ring-brand-ink/20",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span className={cn("flex size-9 items-center justify-center rounded-lg bg-muted text-foreground transition-colors", active && "bg-brand/12 text-brand-ink")}>
                <m.icon className="size-[18px]" />
              </span>
              {active ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-brand text-primary-foreground">
                  <Check className="size-3" />
                </span>
              ) : markRestricted && restricted(m.type) ? (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title="The member role does not see this report by default">
                  <ShieldCheck className="size-3.5" /> Restricted
                </span>
              ) : null}
            </div>
            <div className="space-y-1">
              <p className="text-[15px] font-semibold tracking-tight">{m.label}</p>
              <p className="text-[13px] text-muted-foreground">{m.description}</p>
            </div>
            <ul className="mt-auto hidden space-y-1 border-t pt-3 text-xs text-muted-foreground sm:block">
              {m.contains.map((c) => (
                <li key={c} className="flex gap-1.5">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  {c}
                </li>
              ))}
            </ul>
          </Link>
        );
      })}
    </div>
  );
}
