import type { Metadata } from "next";
import { TasksPage } from "@/features/tasks/components/tasks-page";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "All tasks" };

export default async function AllTasksPage({ searchParams }: PageProps<"/tasks/all">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  return (
    <TasksPage
      searchParams={await searchParams}
      title="All tasks"
      description="Every task across the team. Switch between table, board and calendar."
    />
  );
}
