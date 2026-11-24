import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Landmark, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { getBankAccountOptions } from "@/server/lookups";
import { listStatements, statementOfLine } from "@/features/finance/bank-statements/queries";
import { StatementImport } from "@/features/finance/bank-statements/components/statement-import";
import { AccountFilter, PastStatements } from "@/features/finance/bank-statements/components/past-statements";

// Adding a statement runs in batches as this page's server actions.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Bank statements" };

export default async function BankStatementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  // A statement turns into expenses, income, capital, loans and transfers, so the page has its own permission.
  if (!can(user, "finance.bank_statements:view")) return <NoAccess title="Bank statements" />;
  const canUpload = can(user, "finance.bank_statements:create");
  const params = await searchParams;
  // ?line=<BankTransaction id>: open the statement holding that line, with the line in view.
  const line = typeof params.line === "string" ? params.line : null;
  const lineStatement = line ? await statementOfLine(line) : null;
  if (line && lineStatement) redirect(`/finance/bank-statements/${lineStatement}?line=${encodeURIComponent(line)}`);
  const account = typeof params.account === "string" ? params.account : null;
  const accounts = await getBankAccountOptions();
  const current = account && accounts.some((a) => a.value === account) ? account : null;
  const statements = await listStatements(current);

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Bank statements"
        description="Upload a statement from your bank. Every deposit and withdrawal is read, checked against the running balance and against what is already in the books. Nothing is saved until you press Add."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/finance/expenses">
                <Receipt /> Expenses
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/finance/income">
                <Wallet /> Income
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/finance/assets/cash">
                <Landmark /> Cash &amp; bank
              </Link>
            </Button>
          </>
        }
      />
      {line ? (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm" role="status">
          The statement line you followed a link to was not found. It may belong to an upload that was never finished.
        </p>
      ) : null}
      {canUpload ? (
        <Section
          title="Upload a statement"
          description="Withdrawals become expenses and deposits become income, unless they match a record already in the books or you choose another action."
        >
          {accounts.length ? (
            <StatementImport accounts={accounts} />
          ) : (
            <EmptyState
              icon={Landmark}
              title="Set up the bank account first"
              description="A statement belongs to one bank account, and every record it adds is tied to that account so its balance stays right. Add the account with its opening balance on Cash & bank, then come back here."
              action={
                <Button asChild>
                  <Link href="/finance/assets/cash">Go to Cash &amp; bank</Link>
                </Button>
              }
            />
          )}
        </Section>
      ) : null}
      <Section title="Past statements" description="Open one to see each line and the record it became." actions={<AccountFilter accounts={accounts} current={current} />}>
        <PastStatements rows={statements} />
      </Section>
    </Page>
  );
}
