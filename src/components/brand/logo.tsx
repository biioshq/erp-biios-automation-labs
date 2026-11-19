/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

/**
 * Biios Automation Labs logos, from the approved logo kit (brand guide, 26 October 2026).
 * The files are fixed-colour SVGs in public/brand; never recolour, stretch or attach text to them.
 *
 * Minimum sizes: horizontal lockup 28px tall, stacked lockup 72px tall, symbol 28px.
 * Keep clear space of two lit-disc widths around every logo.
 */

type Ground = "dark" | "light";

/** Symbol, then the name on one line. On lamp white under 40px tall, use the light-small state. */
export function BiiosLockup({ ground = "dark", height = 32, className }: { ground?: Ground; height?: number; className?: string }) {
  const file =
    ground === "dark"
      ? "lockup-horizontal-color-on-dark"
      : height < 40
        ? "lockup-horizontal-color-on-light-small"
        : "lockup-horizontal-color-on-light";
  const h = Math.max(28, height);
  return (
    <img
      src={`/brand/${file}.svg`}
      alt="Biios Automation Labs"
      height={h}
      width={Math.round((h * 774.41) / 74.1)}
      className={cn("block max-w-full shrink-0 object-contain object-left", className)}
      style={{ height: h, width: "auto" }}
    />
  );
}

/** Symbol above the name, flush left. For narrow spaces such as the sidebar. */
export function BiiosStacked({ ground = "dark", height = 72, className }: { ground?: Ground; height?: number; className?: string }) {
  const h = Math.max(72, height);
  return (
    <img
      src={`/brand/lockup-stacked-color-on-${ground}.svg`}
      alt="Biios Automation Labs"
      height={h}
      width={Math.round((h * 301.27) / 238.954)}
      className={cn("block shrink-0", className)}
      style={{ height: h, width: "auto" }}
    />
  );
}

/** The switch plate with the chip behind it, for icons and small square spaces. */
export function BiiosSymbol({ ground = "dark", size = 28, className }: { ground?: Ground; size?: number; className?: string }) {
  const s = Math.max(28, size);
  return (
    <img
      src={`/brand/symbol-color-on-${ground}.svg`}
      alt="Biios Automation Labs"
      width={s}
      height={s}
      className={cn("block shrink-0", className)}
      style={{ width: s, height: s }}
    />
  );
}

/** The product name, set apart from the logo (the guide does not allow a descriptor on the logo itself). */
export const PRODUCT_NAME = "Project Manager";
export const PRODUCT_FULL_NAME = "Biios Project Manager";
