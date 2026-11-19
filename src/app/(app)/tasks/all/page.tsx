import type { Metadata } from "next";
import { TasksPage } from "@/features/tasks/components/tasks-page";

export const metadata: Metadata = { title: "All Tasks" };

export default async function AllTasksPage({ searchParams }: PageProps<"/tasks/all">) {
  return (
    <TasksPage
      searchParams={await searchParams}
      title="All tasks"
      description="Every task across the team. Switch between table, board and calendar."
    />
  );
}
