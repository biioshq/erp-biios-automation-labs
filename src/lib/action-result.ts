/** What every server action returns. Client-safe. */
export type ActionResult<T = void> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Puts server-side field errors onto a react-hook-form instance. */
export function applyFieldErrors(
  result: ActionResult<unknown>,
  setError: (name: never, error: { type: string; message: string }) => void,
) {
  if (result.ok || !result.fieldErrors) return;
  for (const [name, messages] of Object.entries(result.fieldErrors)) {
    if (messages?.[0]) setError(name as never, { type: "server", message: messages[0] });
  }
}
