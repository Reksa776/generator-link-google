import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The application is no longer a pure static export: resolving
   * `maps.app.goo.gl` share links requires one server side request, because
   * browsers cannot read the redirect (no CORS headers / opaque redirect).
   *
   * Every page is still prerendered; only `/api/resolve` runs dynamically.
   */
  images: {
    unoptimized: true,
  },

  /**
   * Playwright drives a real Chromium process and must never be bundled.
   * It is loaded with a dynamic import only when the experimental resolver is
   * enabled (`PLAYWRIGHT_RESOLVER_ENABLED=1`).
   */
  serverExternalPackages: ["playwright", "playwright-core"],

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
