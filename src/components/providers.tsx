"use client";

import { useEffect } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

/**
 * Where the theme choice is kept in the browser. Renamed from next-themes' default "theme" so a
 * "dark" saved by an earlier version or an old visit no longer wins: everyone starts on light,
 * and a choice made with the toggle from now on is remembered.
 */
const THEME_STORAGE_KEY = "biios-pm-theme";

/** Keeps the browser bar colour (meta theme-color) in step with the chosen theme. */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", resolvedTheme === "dark" ? "#0b1929" : "#f4ede3");
  }, [resolvedTheme]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey={THEME_STORAGE_KEY} disableTransitionOnChange>
      <ThemeColorSync />
      <MotionConfig reducedMotion="user" transition={{ type: "spring", bounce: 0, duration: 0.35 }}>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
