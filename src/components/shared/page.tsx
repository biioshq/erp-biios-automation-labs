import { cn } from "@/lib/utils";

/** Page body: consistent padding, width and spacing on every screen. */
export function Page({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <main className={cn("mx-auto flex w-full min-w-0 max-w-[1480px] flex-1 flex-col gap-5 px-4 py-4 sm:gap-6 sm:py-5 md:px-6 md:py-6 lg:px-8 lg:py-8", className)}>
      {children}
    </main>
  );
}

/** Title row: eyebrow, title, description on the left; actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:gap-4 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-balance [overflow-wrap:anywhere] sm:text-2xl md:text-[28px]">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-pretty text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? (
        // Phones: a full-width row under the title whose buttons grow, two per line at most. Each starts
        // at half the row and keeps the flex default minimum (its label's width; zero for a scrolling
        // strip), so a long label moves to a row of its own instead of being squeezed and clipped.
        <div className="flex w-full flex-wrap items-center gap-2 max-sm:[&>*]:flex-[1_1_calc(50%-0.25rem)] md:w-auto md:shrink-0 md:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** A titled panel for page sections (charts, lists, forms). */
export function Section({
  title,
  description,
  actions,
  className,
  contentClassName,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("min-w-0 max-w-full rounded-xl border bg-card text-card-foreground shadow-card", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b px-4 py-3.5 sm:px-5 sm:py-4">
          <div className="min-w-0 flex-1 basis-48">
            {title ? <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("min-w-0 p-4 sm:p-5", contentClassName)}>{children}</div>
    </section>
  );
}
