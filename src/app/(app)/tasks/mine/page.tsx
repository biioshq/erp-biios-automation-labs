import type { Metadata } from "next";
import { TasksPage } from "@/features/tasks/components/tasks-page";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";

export const metadata: Metadata = { title: "My tasks" };

export default async function MyTasksPage({ searchParams }: PageProps<"/tasks/mine">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "tasks.tasks:view")) return <NoAccess eyebrow="Tasks" title="My tasks" />;
  return (
    <TasksPage
      searchParams={await searchParams}
      title="My tasks"
      description="Tasks assigned to you."
      fixed={{ assignee: "me" }}
    />
  );
}
