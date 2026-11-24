/** A statement file that cannot be read, with a message the admin can act on. */
export class StatementReadError extends Error {
  override name = "StatementReadError";
}
