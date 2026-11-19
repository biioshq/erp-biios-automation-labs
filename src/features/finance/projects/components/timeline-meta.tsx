import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, FileText, Flag, FolderPlus, ListTodo, PlayCircle, Receipt, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TimelineKind } from "../types";

export const TIMELINE_META: Record<TimelineKind, { icon: LucideIcon; tone: string }> = {
  created: { icon: FolderPlus, tone: "bg-muted text-foreground" },
  expense: { icon: Receipt, tone: "bg-brand/12 text-brand-ink" },
  income: { icon: Wallet, tone: "bg-success/12 text-success" },
  assigned: { icon: ArrowUpFromLine, tone: "bg-info/12 text-info" },
  returned: { icon: ArrowDownToLine, tone: "bg-info/12 text-info" },
  task_created: { icon: ListTodo, tone: "bg-chart-4/12 text-chart-4" },
  task_completed: { icon: CheckCircle2, tone: "bg-success/12 text-success" },
  document: { icon: FileText, tone: "bg-chart-3/12 text-chart-3" },
  start: { icon: PlayCircle, tone: "bg-muted text-muted-foreground" },
  end: { icon: Flag, tone: "bg-muted text-muted-foreground" },
};

