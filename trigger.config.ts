import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_fnozcjjpshtbvpunwacb",
  dirs: ["./src/server/jobs"],
  maxDuration: 300,
  build: {
    // `@resvg/resvg-js` ships per-platform native binaries via
    // optionalDependencies. The Trigger.dev build image (glibc) bails
    // on the musl variant during `npm i`. We keep resvg as an external
    // — it isn't reachable from any task code path (chart-png is only
    // invoked by the investor-share email which is sent from a Next.js
    // server action, not a Trigger task) so the worker never needs it.
    // chart-png.ts also imports it dynamically so the bundler doesn't
    // pull it into the task chunk in the first place.
    external: ["@resvg/resvg-js"],
  },
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
});
