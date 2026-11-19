import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connectDB } from "@/server/db";
import { AppError, isDuplicateKeyError } from "@/server/errors";
import { assertUser, type SessionUser } from "@/server/auth/session";
import type { ActionResult } from "@/lib/action-result";

type ActionOptions = {
  /** Paths to refresh after success. Use the layout form to refresh a whole section: ["/finance", "layout"]. */
  revalidate?: (string | [string, "layout" | "page"])[];
  /** Success message for the toast. */
  message?: string;
  /** "admin" limits the action to admins (deletes, team, salaries). */
  role?: "admin";
};

/**
 * Wraps a server action: checks the session, validates input with Zod,
 * connects to the database, maps errors to an ActionResult and refreshes
 * the given paths. Use in "use server" files:
 *
 *   export const createExpense = defineAction(expenseSchema, async (input, user) => { ... }, {
 *     revalidate: [["/finance", "layout"]], message: "Expense added",
 *   });
 */
export function defineAction<S extends z.ZodType, R>(
  schema: S,
  handler: (input: z.output<S>, user: SessionUser) => Promise<R>,
  options: ActionOptions = {},
) {
  return async function action(raw: z.input<S>): Promise<ActionResult<R>> {
    try {
      const user = await assertUser();
      if (options.role === "admin" && user.role !== "admin") {
        return { ok: false, error: "Only an admin can do this. Ask an admin on your team." };
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const flat = z.flattenError(parsed.error);
        return {
          ok: false,
          error: flat.formErrors[0] ?? "Some fields need attention.",
          fieldErrors: flat.fieldErrors as Record<string, string[]>,
        };
      }
      await connectDB();
      const data = await handler(parsed.data, user);
      for (const path of options.revalidate ?? []) {
        if (Array.isArray(path)) revalidatePath(path[0], path[1]);
        else revalidatePath(path);
      }
      return { ok: true, data, message: options.message };
    } catch (error) {
      return toActionError(error);
    }
  };
}

export function toActionError(error: unknown): { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  if (error instanceof AppError) return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
  if (isDuplicateKeyError(error)) {
    const field = Object.keys(error.keyValue ?? {})[0];
    return {
      ok: false,
      error: field ? `That ${field} is already in use.` : "This record already exists.",
      fieldErrors: field ? { [field]: ["Already in use"] } : undefined,
    };
  }
  // Next.js redirects/notFound are control flow, not failures.
  if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_")) {
    throw error;
  }
  console.error("[action] unexpected error", error);
  return { ok: false, error: "Something went wrong. Please try again." };
}
