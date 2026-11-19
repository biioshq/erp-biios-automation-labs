import "server-only";

/**
 * An expected, user-facing failure (validation beyond Zod, business rules,
 * not found). Its message is shown to the user as is. Anything else thrown
 * is logged and reported as a generic error.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "conflict" | "invalid" | "forbidden" | "unauthorized" = "invalid",
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError(`${what} was not found. It may have been deleted.`, "not_found");

/** Mongo duplicate-key error (E11000). */
export function isDuplicateKeyError(error: unknown): error is { code: 11000; keyValue?: Record<string, unknown> } {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}
