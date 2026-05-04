import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Native-binary packages can't be bundled by webpack — they have to be
  // resolved at runtime from node_modules. @react-pdf/renderer is in the
  // Next.js 16 default list already; @resvg/resvg-js (used by chart-png.ts
  // for SVG → PNG rasterization in the email pipeline) needs an explicit
  // entry or the build fails with "Module not found: js-binding.js".
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
