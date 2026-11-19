import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TasksPage } from "@/features/tasks/components/tasks-page";
import { TASK_PAGE_STATUSES, type TaskPageStatus } from "@/features/tasks/schemas";
import { TASK_STATUSES, labelOf, type TaskStatus } from "@/lib/constants";
import { requireUser } from "@/server/auth/session";

const COPY: Record<TaskPageStatus, string> = {
  pending: "Tasks that have not been started.",
  in_progress: "Tasks someone is working on now.",
  review: "Tasks waiting for a check before they are done.",
  completed: "Tasks that are finished.",
  cancelled: "Tasks that were dropped.",
  overdue: "Open tasks whose due date has passed.",
};

const titleOf = (status: TaskPageStatus) => (status === "overdue" ? "Overdue" : labelOf(TASK_STATUSES, status));

export async function generateMetadata({ params }: PageProps<"/tasks/status/[status]">): Promise<Metadata> {
  const { status } = await params;
  return { title: (TASK_PAGE_STATUSES as readonly string[]).includes(status) ? `${titleOf(status as TaskPageStatus)} Tasks` : "Tasks" };
}

export default async function TasksByStatusPage({ params, searchParams }: PageProps<"/tasks/status/[status]">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const { status } = await params;
  if (!(TASK_PAGE_STATUSES as readonly string[]).includes(status)) notFound();
  const page = status as TaskPageStatus;
  return (
    <TasksPage
      searchParams={await searchParams}
      title={`${titleOf(page)} tasks`}
      description={COPY[page]}
      fixed={{ status: page }}
      newStatus={page === "overdue" ? undefined : (page as TaskStatus)}
    />
  );
}
