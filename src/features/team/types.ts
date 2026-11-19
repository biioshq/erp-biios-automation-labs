import type { UserRole } from "@/lib/constants";

export type TeamRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: UserRole;
  openTasks: number;
  overdueTasks: number;
};
