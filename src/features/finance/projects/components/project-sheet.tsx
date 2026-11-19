"use client";

import { FormSheet } from "@/components/shared/form-sheet";
import type { ProjectRow } from "../types";
import { ProjectForm } from "./project-form";

/** The create / edit drawer for a project. `project` null means create. */
export function ProjectSheet({
  open,
  project,
  clients,
  onClose,
  onDone,
}: {
  open: boolean;
  project: ProjectRow | null;
  clients: string[];
  onClose: () => void;
  onDone: (id: string, created: boolean) => void;
}) {
  return (
    <FormSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={project ? "Edit project" : "New project"}
      description={project ? `${project.code} · ${project.name}` : "Set the budget now. Expenses and stock count against it from day one."}
    >
      {open ? (
        <ProjectForm
          key={project ? `${project.id}-${project.createdAt}-${project.budget}-${project.status}` : "new"}
          project={project}
          clients={clients}
          onCancel={onClose}
          onDone={(id) => onDone(id, !project)}
        />
      ) : null}
    </FormSheet>
  );
}
