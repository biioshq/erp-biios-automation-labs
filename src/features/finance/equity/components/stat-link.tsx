import Link from "next/link";
import { StatCard } from "@/components/shared/stat-card";

/** A KPI tile that opens the page behind its figure. */
export function StatLink({ href, ...props }: React.ComponentProps<typeof StatCard> & { href: string }) {
  return (
    <Link href={href} className="block min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <StatCard {...props} className="h-full" />
    </Link>
  );
}
