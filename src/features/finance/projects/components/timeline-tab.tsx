import { History } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Section } from "@/components/shared/page";
import { formatDate } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { getProjectTimeline, groupByDay } from "../queries";
import type { ProjectDetail } from "../types";
import { TimelineItem } from "./timeline-item";

/** One feed of everything that happened on the project, newest first, grouped by day. */
export async function TimelineTab({ project }: { project: ProjectDetail }) {
  const events = await getProjectTimeline(project);
  const groups = groupByDay(events);

  if (events.length <= 1 && !project.startDate && !project.endDate) {
    return <EmptyState icon={History} title="Nothing has happened yet" description="Expenses, income, stock movements, tasks and documents for this project are collected here." />;
  }

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <Section
          key={g.day}
          title={formatDate(fromDateInput(g.day))}
          contentClassName="pt-5"
        >
          <ul>
            {g.events.map((e, i) => (
              <TimelineItem key={e.id} event={e} last={i === g.events.length - 1} />
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}
