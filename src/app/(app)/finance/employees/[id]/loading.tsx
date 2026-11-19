import { Skeleton } from "@/components/ui/skeleton";
import { Page } from "@/components/shared/page";

export default function Loading() {
  return (
    <Page>
      <div className="flex items-center gap-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="size-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </Page>
  );
}
