import type { Metadata } from "next";
import { TasksPage } from "@/features/tasks/components/tasks-page";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";

export const metadata: Metadata = { title: "Task Calendar" };

export default async function TaskCalendarPage({ searchParams }: PageProps<"/tasks/calendar">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "tasks.tasks:view")) return <NoAccess eyebrow="Tasks" title="Calendar" />;
  return (
    <TasksPage
      searchParams={await searchParams}
      title="Calendar"
      description="Tasks on their due dates."
      forceView="calendar"
    />
  );
}
