import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "@/components/shared/page";
import { getEmployeePage, getUserLinkOptions } from "@/features/employees/queries";
import { EmployeeProfile } from "@/features/employees/components/employee-profile";
import { EmployeeSheet } from "@/features/employees/components/employee-sheet";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({ params, searchParams }: PageProps<"/finance/employees/[id]">) {
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
