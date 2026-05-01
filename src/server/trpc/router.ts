import { router } from "./trpc";
import { projectsRouter } from "./routers/projects";
import { walletsRouter } from "./routers/wallets";
import { reportsRouter } from "./routers/reports";
import { investorsRouter } from "./routers/investors";
import { billingRouter } from "./routers/billing";

export const appRouter = router({
  projects: projectsRouter,
  wallets: walletsRouter,
  reports: reportsRouter,
  investors: investorsRouter,
  billing: billingRouter,
});

export type AppRouter = typeof appRouter;
