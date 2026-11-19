import { getProjectTeam } from "../team-queries";
import { ProjectTeamView } from "./project-team-view";

/**
 * The Team tab of a project (?tab=team): who is on it, their role and share of time.
 * Mount inside the project page: <ProjectTeamTab projectId={project.id} />
 */
export async function ProjectTeamTab({ projectId }: { projectId: string }) {
  const team = await getProjectTeam(projectId);
  return <ProjectTeamView projectId={projectId} team={team} />;
}
