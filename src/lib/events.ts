/**
 * Tells always-mounted client widgets (notification bell) that data changed,
 * e.g. after a stock movement. Call after a successful mutation.
 */
export function emitDataChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("erp:data-changed"));
}
