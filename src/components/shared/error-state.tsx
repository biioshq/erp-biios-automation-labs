"use client";

import { useEffect } from "react";
import { RotateCcw, ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Error panel. Used by error.tsx route boundaries:
 *   export default function Error(props) { return <ErrorState {...props} /> }
 */
export function ErrorState({
  error,
  reset,
  title = "Something went wrong",
  className,
}: {
  error?: Error & { digest?: string };
  reset?: () => void;
  title?: string;
  className?: string;
}) {
  useEffect(() => {
    if (error) console.error(error);
  }, [error]);

  const dbDown = error?.message?.includes("ECONNREFUSED") || error?.message?.includes("MONGODB_URI") || error?.message?.includes("Server selection");
  return (
    <div className={cn("flex flex-1 items-center justify-center px-4 py-16", className)}>
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl border border-danger/25 bg-danger/10">
          <ServerCrash className="size-5 text-danger" />
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {dbDown
            ? "The database is not reachable right now. Check that MongoDB is running, then try again."
            : "This part of the page could not load. Try again, and if it keeps happening, let an admin know."}
        </p>
        {error?.digest ? <p className="font-mono text-[11px] text-muted-foreground">Reference: {error.digest}</p> : null}
        {reset ? (
          <Button variant="outline" onClick={reset} className="mt-1">
            <RotateCcw /> Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
