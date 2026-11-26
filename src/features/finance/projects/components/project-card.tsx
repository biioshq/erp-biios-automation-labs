"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { CalendarDays, Eye, MoreHorizontal, Pencil, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Money } from "@/components/shared/money";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import { formatDateShort, formatNumber, formatPercent } from "@/lib/format";
import { BUDGET_TEXT_CLASS, budgetTone, deadlineLabel } from "../utils";
import type { ProjectFinanceRow } from "../types";
import { BudgetBar } from "./project-budget-bar";

export function ProjectCard({
  project,
  index,
  onEdit,
  onDelete,
}: {
  project: ProjectFinanceRow;
  index: number;
  /** Omit without the projects edit permission: the edit item is then hidden. */
  onEdit?: () => void;
  /** Omit without the projects delete permission: the delete item is then hidden. */
  onDelete?: () => void;
}) {
  const tone = budgetTone(project.usage, project.budget);
  const deadline = deadlineLabel(project.endDate, project.status);
  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.03 }}
      className="group relative overflow-hidden rounded-xl border bg-card shadow-card transition-colors hover:border-foreground/20"
    >
      <div className="h-1 w-full" style={{ background: project.color }} aria-hidden />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 className="truncate text-[15px] font-semibold tracking-tight">
              <Link href={`/finance/projects/${project.id}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50">
                {project.name}
              </Link>
            </h3>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{project.code}</span>
              {project.client ? <span> · {project.client}</span> : null}
            </p>
          </div>
          <div className="relative z-10 -mr-1.5 flex shrink-0 items-center gap-1">
            <ProjectStatusBadge status={project.status} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${project.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem asChild>
                  <Link href={`/finance/projects/${project.id}`}>
                    <Eye /> Open
                  </Link>
                </DropdownMenuItem>
                {onEdit ? (
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                ) : null}
                {onDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="tabular text-sm">
              <Money value={project.spent} compact className="text-lg font-semibold tracking-tight" />
              <span className="text-muted-foreground"> of </span>
              <Money value={project.budget} compact className="text-muted-foreground" />
            </p>
            <span className={cn("tabular text-xs font-medium", BUDGET_TEXT_CLASS[tone])}>
              {project.budget > 0 ? formatPercent(project.usage) : "No budget"}
            </span>
          </div>
          <BudgetBar spent={project.spent} budget={project.budget} paid={project.finance.payables.paid} />
          <p className="text-xs text-muted-foreground">
            {project.remaining < 0 ? (
              <span className="text-danger">
                <Money value={Math.abs(project.remaining)} compact /> over budget
              </span>
            ) : (
              <>
                <Money value={project.remaining} compact className="font-medium text-foreground" /> remaining
              </>
            )}
            {project.originalBudget !== project.budget ? (
              <>
                {" · "}original budget <Money value={project.originalBudget} compact />
              </>
            ) : null}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div className="min-w-0">
            <dt className="text-muted-foreground">Paid to vendors</dt>
            <dd className="mt-0.5 font-medium">
              <Money value={project.finance.payables.paid} compact />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Outstanding payables</dt>
            <dd className={cn("mt-0.5 font-medium", project.finance.payables.overdue > 0 && "text-danger")}>
              <Money value={project.finance.payables.outstanding} compact />
              {project.finance.payables.overdue > 0 ? <span className="font-normal"> · overdue</span> : null}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Project value</dt>
            <dd className="mt-0.5 font-medium">{project.contractValue === null ? <span className="font-normal text-muted-foreground">Not set</span> : <Money value={project.contractValue} compact />}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Received</dt>
            <dd className="mt-0.5 font-medium">
              <Money value={project.finance.revenue.received} compact />
              {project.finance.revenue.outstanding > 0 ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · <Money value={project.finance.revenue.outstanding} compact /> to receive
                </span>
              ) : null}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5" />
            {project.startDate || project.endDate
              ? `${project.startDate ? formatDateShort(project.startDate) : "?"} to ${project.endDate ? formatDateShort(project.endDate) : "?"}`
              : "No dates set"}
            {deadline ? <span className={cn("font-medium", deadline.late ? "text-danger" : "text-foreground/80")}>· {deadline.text}</span> : null}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Receipt className="size-3.5" />
            <span className="tabular">{formatNumber(project.expenseCount)}</span> expense{project.expenseCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </motion.article>
  );
}
