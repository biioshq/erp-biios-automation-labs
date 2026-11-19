import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // A conservative CSP that never blocks Next.js' own inline scripts: no framing by others,
  // no plugins, forms and base URLs locked to this origin.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  // The review server builds into its own folder so a local build never replaces files under it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Every screen is per-user, request-time data behind auth, so the app uses classic dynamic
  // rendering with loading.tsx skeletons instead of Cache Components.
  cacheComponents: false,
  poweredByHeader: false,
  // A self-contained server for Docker (the Dockerfile sets BUILD_STANDALONE=1 and copies .next/standalone).
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  // Native or worker-thread packages must stay outside the server bundle.
  serverExternalPackages: [
    "tesseract.js",
    "@napi-rs/canvas",
    "unpdf",
    "mongoose",
    "exceljs",
    "jspdf",
    "jspdf-autotable",
    "cloudinary",
    "@aws-sdk/client-s3",
  ],
  // The OCR route reads the bundled English model and Tesseract's worker files from disk.
  outputFileTracingIncludes: {
    "/api/ocr": [
      "./node_modules/@tesseract.js-data/eng/4.0.0/**/*",
      "./node_modules/tesseract.js/src/**/*",
      "./node_modules/tesseract.js-core/**/*",
    ],
  },
  // Source, docs, scripts and local uploads are never needed by the built server.
  outputFileTracingExcludes: {
    "*": ["./src/**", "./docs/**", "./scripts/**", "./storage/**", "./.next-review/**", "./.next-standalone/**"],
  },
  experimental: {
    // Forms may carry receipts and documents (storage enforces 15 MB per file).
    serverActions: { bodySizeLimit: "16mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
