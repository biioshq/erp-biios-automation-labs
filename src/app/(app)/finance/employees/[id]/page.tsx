import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "@/components/shared/page";
import { getEmployeePage, getUserLinkOptions } from "@/features/employees/queries";
import { EmployeeProfile } from "@/features/employees/components/employee-profile";
import { EmployeeSheet } from "@/features/employees/components/employee-sheet";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({ params, searchParams }: PageProps<"/finance/employees/[id]">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const data = await getEmployeePage(id);
  if (!data) notFound();
  const users = sp.edit ? await getUserLinkOptions() : [];

  return (
    <Page>
      <EmployeeProfile data={data} />
      <EmployeeSheet users={users} />
    </Page>
  );
}
