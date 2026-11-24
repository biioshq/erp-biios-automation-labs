import type { LucideIcon } from "lucide-react";
import { CircleSlash, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** How a figure on the page is worked out, in a sentence or two. */
export function MethodNote({ children, className, icon: Icon = Info }: { children: React.ReactNode; className?: string; icon?: LucideIcon }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground", className)}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

/**
 * Something the client asked for that the ERP does not record. Shown instead of a number, so
 * nothing on these pages is made up.
 */
export function NotRecorded({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border border-dashed px-4 py-3 text-sm", className)}>
      <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">
          {title}: <span className="font-normal text-muted-foreground">not recorded</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

/** A plain list of the window and filters a page is showing. */
export function ScopeLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-xs text-muted-foreground", className)}>{children}</p>;
}
