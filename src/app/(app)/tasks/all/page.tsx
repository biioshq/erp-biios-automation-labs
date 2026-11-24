import type { Metadata } from "next";
import { TasksPage } from "@/features/tasks/components/tasks-page";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";

export const metadata: Metadata = { title: "All tasks" };

export default async function AllTasksPage({ searchParams }: PageProps<"/tasks/all">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "tasks.tasks:view")) return <NoAccess eyebrow="Tasks" title="All tasks" />;
  return (
    <TasksPage
      searchParams={await searchParams}
      title="All tasks"
      description="Every task across the team. Switch between table, board and calendar."
    />
  );
}
