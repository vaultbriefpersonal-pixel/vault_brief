import { schedules } from "@trigger.dev/sdk/v3";
import { syncAllProjects } from "@/server/services/data-sync";

export const monthlySyncJob = schedules.task({
  id: "monthly-data-sync",
  cron: "0 6 1 * *", // 1st of every month at 06:00 UTC
  run: async () => {
    const result = await syncAllProjects();
    console.log(
      `Monthly sync complete: ${result.succeeded}/${result.total} projects synced, ${result.failed} failed`
    );
    return result;
  },
});
