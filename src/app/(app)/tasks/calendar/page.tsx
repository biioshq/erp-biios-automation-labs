import type { Metadata } from "next";
import { TasksPage } from "@/features/tasks/components/tasks-page";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Task Calendar" };

export default async function TaskCalendarPage({ searchParams }: PageProps<"/tasks/calendar">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  return (
    <TasksPage
      searchParams={await searchParams}
      title="Calendar"
      description="Tasks on their due dates."
      forceView="calendar"
    />
  );
}
