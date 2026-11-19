"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ProjectRow } from "../types";
import { ProjectSheet } from "./project-sheet";

/** Opens the edit drawer when the URL has ?edit=<projectId>. */
export function ProjectEditSheet({ project, clients }: { project: ProjectRow; clients: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = searchParams.get("edit") === project.id;

  const close = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("edit");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return <ProjectSheet open={open} project={project} clients={clients} onClose={close} onDone={close} />;
}
