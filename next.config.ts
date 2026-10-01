import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
  // Server-side PDF (lib/pdf/render-pdf.ts): keep Chrome out of the bundler,
  // and make sure its compressed binaries ship with the function.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/report-pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};
export default nextConfig;
