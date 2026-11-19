import type { Metadata } from "next";
import { TasksPage } from "@/features/tasks/components/tasks-page";

export const metadata: Metadata = { title: "Task Calendar" };

export default async function TaskCalendarPage({ searchParams }: PageProps<"/tasks/calendar">) {
  return (
    <TasksPage
      searchParams={await searchParams}
      title="Calendar"
      description="Tasks on their due dates."
      forceView="calendar"
    />
  );
}
