import type { UserRole } from "@/lib/constants";

export type TeamRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  /** Role key: "admin", "member" or a custom role's key. */
  role: UserRole;
  openTasks: number;
  overdueTasks: number;
};

/** A role a person can be given, as the team dialogs list it. */
export type RoleOption = { value: string; label: string; description?: string; disabled?: boolean };
