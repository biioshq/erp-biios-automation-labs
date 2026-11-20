"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: "size-8 rounded-md",
  sm: "size-10 rounded-lg",
  md: "size-12 rounded-lg",
  lg: "size-40 rounded-xl sm:size-48",
} as const;

const ICON = { xs: "size-3.5", sm: "size-4", md: "size-5", lg: "size-10" } as const;

/**
 * An item's photo at a fixed size, or a neutral placeholder. Photos come from the signed-in file
 * route; a plain <img> is used because the image optimizer fetches without the session cookie.
 * Lazy loading keeps long lists fast; a missing file falls back to the placeholder.
 */
export function ItemThumb({
  src,
  name,
  size = "sm",
  eager,
  className,
}: {
  src: string | null;
  name: string;
  size?: keyof typeof SIZES;
  eager?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = src && failed !== src;
  return (
    <span
      className={cn("relative flex shrink-0 items-center justify-center overflow-hidden border bg-muted/60 text-muted-foreground/70", SIZES[size], className)}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={size === "lg" ? `Photo of ${name}` : ""}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setFailed(src)}
          className="size-full object-cover"
        />
      ) : (
        <Package className={ICON[size]} aria-hidden />
      )}
    </span>
  );
}
