import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connectDB } from "@/server/db";
import { ensureNewCollectionIndexes } from "@/server/new-indexes";
import { AppError, isDuplicateKeyError } from "@/server/errors";
import { assertUser, can, type SessionUser } from "@/server/auth/session";
import type { ActionResult } from "@/lib/action-result";
import { bumpChanges } from "@/server/changes";

type ActionOptions = {
  /**
   * Required. The permission the action needs, for example "finance.expenses:create". With a list,
   * any one of them is enough. null means any signed-in person, and must be written out.
   */
  permission: string | string[] | null;
  /** Paths to refresh after success. Use the layout form to refresh a whole section: ["/finance", "layout"]. */
  revalidate?: (string | [string, "layout" | "page"])[];
  /** Success message for the toast. */
  message?: string;
  /** True for actions that only read (suggestions): they do not refresh other people's pages. */
  readOnly?: boolean;
};

/**
 * Wraps a server action: checks the session and the permission, validates input with Zod,
 * connects to the database, maps errors to an ActionResult and refreshes the given paths.
 * Use in "use server" files:
 *
 *   export const createExpense = defineAction(expenseSchema, async (input, user) => { ... }, {
 *     permission: "finance.expenses:create", revalidate: [["/finance", "layout"]], message: "Expense added",
 *   });
 */
export function defineAction<S extends z.ZodType, R>(
  schema: S,
  handler: (input: z.output<S>, user: SessionUser) => Promise<R>,
  options: ActionOptions,
) {
  return async function action(raw: z.input<S>): Promise<ActionResult<R>> {
    try {
      const user = await assertUser();
      if (options.permission !== null) {
        const list = Array.isArray(options.permission) ? options.permission : [options.permission];
        if (!list.some((p) => can(user, p))) {
          return { ok: false, error: "You do not have permission to do this. Ask an admin if you need it." };
        }
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
      // The collections added with Finance, Roles and Analytics get their indexes before their first write.
      if (!options.readOnly) await ensureNewCollectionIndexes();
      const data = await handler(parsed.data, user);
      for (const path of options.revalidate ?? []) {
        if (Array.isArray(path)) revalidatePath(path[0], path[1]);
        else revalidatePath(path);
      }
      // Other people's open pages pick the change up through /api/live.
      if (!options.readOnly) await bumpChanges();
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
