import type { Metadata } from "next";
import { TasksPage } from "@/features/tasks/components/tasks-page";

export const metadata: Metadata = { title: "My Tasks" };

export default async function MyTasksPage({ searchParams }: PageProps<"/tasks/mine">) {
  return (
    <TasksPage
      searchParams={await searchParams}
      title="My tasks"
      description="Tasks assigned to you."
      fixed={{ assignee: "me" }}
    />
  );
}
