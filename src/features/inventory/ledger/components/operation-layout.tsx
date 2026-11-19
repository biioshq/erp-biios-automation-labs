import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Two columns on desktop: the form card on the left, a live context panel on the
 * right (sticky), recent operations of the same type below. Below lg everything
 * stacks, and the submit bar sits after the context panel so people see the
 * impact of the operation right before they confirm it.
 */
export function OperationLayout({
  form,
  context,
  submit,
  recent,
}: {
  form: React.ReactNode;
  context: React.ReactNode;
  /** A SubmitBar for phones and tablets. The desktop one lives inside the form card. */
  submit: React.ReactNode;
  recent: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">{form}</div>
        <aside className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:sticky lg:top-20 lg:grid-cols-1" aria-label="Stock context">
          {context}
        </aside>
      </div>
      {submit}
      {recent}
    </div>
  );
}

/** The form card shared by Purchase, Assign and Return. The submit bar is wired to it by id. */
export function OperationForm({
  id,
  onSubmit,
  children,
}: {
  id: string;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  children: React.ReactNode;
}) {
  return (
    <form id={id} onSubmit={onSubmit} noValidate className="space-y-5 rounded-xl border bg-card p-4 shadow-card sm:p-6">
      {children}
    </form>
  );
}

/**
 * Note on the left, submit on the right (full width on phones). Render it twice:
 * inside the form card with `hidden lg:flex border-t pt-5`, and after the
 * context panel with `lg:hidden`. Both submit the same form by id.
 */
export function SubmitBar({
  formId,
  note,
  label,
  icon,
  pending,
  disabled,
  className,
}: {
  formId: string;
  note: React.ReactNode;
  label: string;
  icon: React.ReactNode;
  pending: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <p className="min-w-0 text-sm text-muted-foreground sm:max-w-[60%]">{note}</p>
      <Button type="submit" form={formId} disabled={pending || disabled} className="w-full sm:w-auto sm:min-w-40">
        {pending ? <Spinner /> : icon}
        {label}
      </Button>
    </div>
  );
}

/** A labelled number that changes: "Available  180 → 160". */
export function ImpactRow({
  label,
  before,
  after,
  format = (n) => String(n),
  tone,
  className,
}: {
  label: string;
  before: number;
  after: number;
  format?: (n: number) => React.ReactNode;
  tone?: "good" | "bad" | "neutral";
  className?: string;
}) {
  const changed = before !== after;
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-2 text-sm", className)}>
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className="tabular flex items-baseline gap-2 whitespace-nowrap">
        {changed ? <span className="text-muted-foreground">{format(before)}</span> : null}
        {changed ? <span aria-hidden className="text-muted-foreground/60">→</span> : null}
        <span className={cn("font-semibold", tone === "good" && "text-success", tone === "bad" && "text-danger")}>{format(after)}</span>
      </span>
    </div>
  );
}

export function ContextPlaceholder({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="hidden rounded-xl border border-dashed bg-card/50 p-6 text-center lg:block">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
