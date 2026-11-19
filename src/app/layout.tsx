import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { DM_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

/* Satoshi, the company's type (Indian Type Foundry, licence in app/fonts). DM Mono for codes and figures. */
const satoshi = localFont({
  src: "./fonts/Satoshi-Variable.woff2",
  weight: "300 900",
  variable: "--font-satoshi",
  display: "swap",
  adjustFontFallback: "Arial",
});
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dm-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Biios Project Manager", template: "%s · Biios Project Manager" },
  description: "Finance, inventory and tasks for Biios Automation Labs.",
  applicationName: "Biios Project Manager",
  appleWebApp: { capable: true, title: "Biios PM", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b1929" },
    { media: "(prefers-color-scheme: light)", color: "#f4ede3" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${satoshi.variable} ${dmMono.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
