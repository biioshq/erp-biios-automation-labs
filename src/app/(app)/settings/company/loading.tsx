import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col gap-6 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-64 w-full max-w-3xl rounded-xl" />
      <Skeleton className="h-48 w-full max-w-3xl rounded-xl" />
    </div>
  );
}
