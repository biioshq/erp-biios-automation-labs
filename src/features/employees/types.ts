import type { Department, EmployeeStatus, EmploymentType } from "@/lib/constants";

export type EmployeeProjectChip = { id: string; name: string; color: string; allocation: number };

/** A card / table row on the employees list. Salary is null for members. */
export type EmployeeRow = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  department: Department;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  joinDate: string | null;
  exitDate: string | null;
  monthlySalary: number | null;
  skills: string[];
  hasAccount: boolean;
  projects: EmployeeProjectChip[];
  allocationTotal: number;
};

/** What the edit form needs. */
export type EmployeeDetail = EmployeeRow & {
  notes: string | null;
  userId: string | null;
  salaryRecurringId: string | null;
  /** The salary schedule exists and is active. */
  paysSalary: boolean;
  updatedAt: string;
};

export type EmployeeSummary = {
  headcount: number;
  onLeave: number;
  onProjects: number;
  /** Null for members. */
  payroll: number | null;
  departments: number;
};

export type UserLinkOption = { value: string; label: string; description: string; linkedEmployeeId: string | null };

export type MembershipDTO = {
  id: string;
  project: { id: string; name: string; code: string; color: string; status: string };
  role: string;
  allocation: number;
  startDate: string | null;
  endDate: string | null;
};

export type SalaryPayment = { id: string; number: string; date: string; amount: number; description: string | null };

export type EmployeePageData = {
  employee: EmployeeDetail;
  current: MembershipDTO[];
  past: MembershipDTO[];
  /** Admins only. */
  salary: {
    monthlySalary: number;
    scheduleId: string | null;
    scheduleStatus: "active" | "paused" | "ended" | null;
    nextPayDate: string | null;
    payments: SalaryPayment[];
    paidThisYear: number;
    yearLabel: string;
  } | null;
  linkedUser: { id: string; name: string; email: string } | null;
  tasks: { open: number; total: number } | null;
};

/* Project team */

export type TeamMemberDTO = {
  id: string;
  employee: { id: string; name: string; code: string; designation: string | null; department: Department; status: EmployeeStatus };
  role: string;
  allocation: number;
  startDate: string | null;
  endDate: string | null;
};

export type TeamData = {
  current: TeamMemberDTO[];
  past: TeamMemberDTO[];
  totalAllocation: number;
  /** People who can still be added: not exited, not already on this project. */
  options: { value: string; label: string; description: string; department: Department; allocated: number }[];
};
