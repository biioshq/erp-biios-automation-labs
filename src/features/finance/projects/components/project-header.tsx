import Link from "next/link";
import { ArrowLeft, Boxes, FileUp, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import type { ProjectTab } from "../schemas";
import type { ProjectDetail } from "../types";

/** Name, code, client and quick actions. Links keep the page server-rendered. */
export function ProjectHeader({ project, tab }: { project: ProjectDetail; tab: ProjectTab }) {
  return (
    <div className="space-y-4">
      <Link href="/finance/projects" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All projects
      </Link>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <span className="mt-1 h-12 w-1.5 shrink-0 self-stretch rounded-full" style={{ background: project.color }} aria-hidden />
          <div className="min-w-0 space-y-1.5">
            <p className="eyebrow [overflow-wrap:anywhere]">
              <span className="font-mono tracking-normal normal-case">{project.code}</span>
              {project.client ? ` · ${project.client}` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="min-w-0 text-[22px] leading-tight font-semibold tracking-tight text-balance [overflow-wrap:anywhere] sm:text-2xl md:text-[28px]">{project.name}</h1>
              <ProjectStatusBadge status={project.status} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center xl:shrink-0 xl:justify-end">
          <Button asChild variant="outline">
            <Link href={`?tab=${tab}&edit=${project.id}`} scroll={false}>
              <Pencil /> Edit
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="?tab=documents" scroll={false}>
              <FileUp /> Upload document
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/inventory/assign?project=${project.id}`}>
              <Boxes /> Assign inventory
            </Link>
          </Button>
          <Button asChild>
            <Link href="?tab=expenses&expense=new" scroll={false}>
              <Plus /> Add expense
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
