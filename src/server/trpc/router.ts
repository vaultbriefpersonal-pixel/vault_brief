import { router } from "./trpc";
import { projectsRouter } from "./routers/projects";
import { walletsRouter } from "./routers/wallets";
import { reportsRouter } from "./routers/reports";
import { investorsRouter } from "./routers/investors";
import { billingRouter } from "./routers/billing";
import { notificationsRouter } from "./routers/notifications";
import { usersRouter } from "./routers/users";

export const appRouter = router({
  projects: projectsRouter,
  wallets: walletsRouter,
  reports: reportsRouter,
  investors: investorsRouter,
  billing: billingRouter,
  notifications: notificationsRouter,
  users: usersRouter,
});

export type AppRouter = typeof appRouter;
