import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban, MapPin } from "lucide-react";
import { Page, PageHeader } from "@/components/shared/page";
import { cn } from "@/lib/utils";
import type { SearchParams } from "@/lib/list-params";
import { requireUser } from "@/server/auth/session";
import { getLedgerProjects } from "@/features/inventory/ledger/queries";
import { getStorageLocations } from "@/features/inventory/wastage/queries";
import { getLocatedItems, getRecentProjectMoves, getRecentRelocations } from "@/features/inventory/transfer/queries";
import { TRANSFER_MODES, type TransferMode } from "@/features/inventory/transfer/schemas";
import { ProjectMoveForm } from "@/features/inventory/transfer/components/project-move-form";
import { RelocationForm } from "@/features/inventory/transfer/components/relocation-form";
import { RecentProjectMoves, RecentRelocations } from "@/features/inventory/transfer/components/recent-transfers";

export const metadata: Metadata = { title: "Stock transfer" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Typed by hand: the generated route types only list routes that existed at the last build.
export default async function TransferPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  const mode: TransferMode = one(sp.mode) === "location" ? "location" : "project";

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Stock transfer"
        description={
          mode === "project"
            ? "Move stock a project has in use to another project. The cost goes with it: the first project is credited what the second is charged."
            : "Move an item to another storage location. Stock levels and value stay the same."
        }
      />
      <nav aria-label="Kind of transfer" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        {TRANSFER_MODES.map((m) => {
          const active = m.value === mode;
          const Icon = m.value === "project" ? FolderKanban : MapPin;
          return (
            <Link
              key={m.value}
              href={m.value === "project" ? "/inventory/transfer" : "/inventory/transfer?mode=location"}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors max-md:h-10",
                active ? "border-brand/40 bg-brand/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {m.label}
            </Link>
          );
        })}
      </nav>
      {mode === "project" ? <ProjectMoves sp={sp} /> : <LocationMoves sp={sp} />}
    </Page>
  );
}

async function ProjectMoves({ sp }: { sp: SearchParams }) {
  const [projects, moves] = await Promise.all([getLedgerProjects(), getRecentProjectMoves()]);
  return (
    <ProjectMoveForm
      key={`${one(sp.item) ?? ""}:${one(sp.project) ?? ""}`}
      projects={projects}
      defaultFromProjectId={one(sp.project)}
      defaultItemId={one(sp.item)}
      recent={<RecentProjectMoves moves={moves} />}
    />
  );
}

async function LocationMoves({ sp }: { sp: SearchParams }) {
  const [items, locations, rows] = await Promise.all([getLocatedItems(), getStorageLocations(), getRecentRelocations()]);
  return <RelocationForm key={one(sp.item) ?? ""} items={items} locations={locations} defaultItemId={one(sp.item)} recent={<RecentRelocations rows={rows} />} />;
}
