import { Page, PageHeader } from "@/components/shared/page";
import { toDateInput } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { getProjectOptions } from "@/server/lookups";
import { requireUser } from "@/server/auth/session";
import { listTeamMembers } from "@/server/services/users";
import { listBoardTasks, listCalendarTasks, listTasks } from "../queries";
import { TASK_FILTER_KEYS, TASK_SORT_KEYS, TASK_VIEWS, type TaskView } from "../schemas";
import { NewTaskButton } from "./new-task-button";
import { TasksView } from "./tasks-view";
import type { TaskStatus } from "@/lib/constants";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Shared server wrapper for /tasks/all, /tasks/mine, /tasks/status/[status] and /tasks/calendar:
 * parses the URL, loads what the chosen view needs and renders the header and TasksView.
 */
export async function TasksPage({
  searchParams,
  eyebrow = "Tasks",
  title,
  description,
  fixed,
  forceView,
  newStatus,
}: {
  searchParams: SearchParams;
  eyebrow?: string;
  title: string;
  description: string;
  /** Filters the page owns (My Tasks fixes the assignee, status pages fix the status). */
  fixed?: { assignee?: "me"; status?: string };
  forceView?: TaskView;
  /** Status a new task starts in on a status page. */
  newStatus?: TaskStatus;
}) {
  const user = await requireUser();
  const params = parseListParams(searchParams, { filterKeys: TASK_FILTER_KEYS, sortable: TASK_SORT_KEYS, defaultSort: { id: "dueDate", desc: false } });
  if (fixed?.assignee) params.filters.assignee = [user.id];
  if (fixed?.status) params.filters.status = [fixed.status];

  const requested = first(searchParams.view);
  const view: TaskView = forceView ?? ((TASK_VIEWS as readonly string[]).includes(requested) ? (requested as TaskView) : "table");
  const today = toDateInput(new Date());
  const rawMonth = first(searchParams.month);
  const month = MONTH.test(rawMonth) ? rawMonth : today.slice(0, 7);

  const [people, projects, table, board, calendar] = await Promise.all([
    listTeamMembers(),
    getProjectOptions(),
    view === "table" ? listTasks(params) : null,
    view === "board" ? listBoardTasks(params) : null,
    view === "calendar" ? listCalendarTasks(params, month) : null,
  ]);

  const total = table?.total ?? board?.total ?? calendar?.total ?? 0;
  const projectFilter = params.filters.project?.length === 1 && params.filters.project[0] !== "none" ? params.filters.project[0] : undefined;
  // "Completed in" only matters for finished tasks: offer it on the Completed page or when a link set it.
  const showCompleted = fixed?.status === "completed" || Boolean(params.filters.completed);
  const hidden = [...(fixed?.assignee ? ["assignee"] : []), ...(fixed?.status ? ["status"] : []), ...(showCompleted ? [] : ["completed"])];
  const filtered = Boolean(params.q || params.from || params.to || Object.keys(params.filters).some((k) => !hidden.includes(k)));

  return (
    <Page>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={
          <>
            {description} <span className="tabular">{formatNumber(total)}</span> {total === 1 ? "task" : "tasks"}
            {view === "calendar" ? " due in view" : ""}
            {filtered ? " (filtered)" : ""}.
          </>
        }
        actions={<NewTaskButton />}
      />
      <TasksView
        view={view}
        lockedView={Boolean(forceView)}
        table={table ?? undefined}
        board={board ?? undefined}
        calendar={calendar ? { ...calendar, month } : undefined}
        people={people}
        projects={projects}
        currentUser={{ id: user.id, name: user.name, image: user.image }}
        hiddenFilters={hidden}
        defaults={{ projectId: projectFilter, assigneeId: fixed?.assignee ? user.id : undefined, status: newStatus }}
        today={today}
        filtered={filtered}
      />
    </Page>
  );
}
