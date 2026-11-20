import type { Metadata } from "next";
import { TasksPage } from "@/features/tasks/components/tasks-page";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "My tasks" };

export default async function MyTasksPage({ searchParams }: PageProps<"/tasks/mine">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  return (
    <TasksPage
      searchParams={await searchParams}
      title="My tasks"
      description="Tasks assigned to you."
      fixed={{ assignee: "me" }}
    />
  );
}
