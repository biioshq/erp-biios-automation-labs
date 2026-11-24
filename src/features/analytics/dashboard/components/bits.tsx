import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, CircleHelp, FileQuestion } from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Building blocks shared by the Analytics dashboard and the insights pages. Server-safe. */

type Tone = "default" | "brand" | "success" | "warning" | "danger" | "info";

/** A KPI tile that opens the page with the details behind it. */
export function InsightCard({
  href,
  label,
  value,
  hint,
  icon,
  tone,
  linkLabel = "Details",
}: {
  href: string;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  linkLabel?: string;
}) {
  return (
    <Link href={href} className="group/card block min-w-0 rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <StatCard
        label={label}
        value={value}
        hint={hint}
        icon={icon}
        tone={tone}
        className="h-full group-hover/card:border-foreground/20"
        footer={
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover/card:text-foreground">
            {linkLabel} <ArrowUpRight className="size-3" aria-hidden />
          </span>
        }
      />
    </Link>
  );
}

/** "How these figures are worked out": the rule behind each figure, folded away until asked for. */
export function RuleList({ rules, title = "How these figures are worked out", className }: { rules: { label: string; text: string }[]; title?: string; className?: string }) {
  return (
    <details className={cn("group rounded-xl border bg-card px-4 py-3 text-sm shadow-card sm:px-5", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
        <CircleHelp className="size-4 text-muted-foreground" aria-hidden />
        {title}
        <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
        <span className="ml-auto hidden text-xs font-normal text-muted-foreground group-open:inline">Hide</span>
      </summary>
      <dl className="mt-3 grid gap-3 text-[13px] sm:grid-cols-2">
        {rules.map((r) => (
          <div key={r.label} className="min-w-0">
            <dt className="font-medium">{r.label}</dt>
            <dd className="text-muted-foreground">{r.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** A figure the ERP does not record. Says so plainly instead of showing a number. */
export function NotRecorded({ title, description, className }: { title: string; description: React.ReactNode; className?: string }) {
  return <EmptyState icon={FileQuestion} compact title={title} description={description} className={className} />;
}

/** A "see details" button for section headers. */
export function DetailsLink({ href, children = "Details" }: { href: string; children?: React.ReactNode }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-my-1 text-muted-foreground hover:text-foreground">
      <Link href={href}>
        {children} <ArrowUpRight className="size-3.5" aria-hidden />
      </Link>
    </Button>
  );
}

/** A short line under a chart or table that states its rule. */
export function Footnote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-3 text-xs text-pretty text-muted-foreground", className)}>{children}</p>;
}
