import { router } from "./trpc";
import { projectsRouter } from "./routers/projects";
import { walletsRouter } from "./routers/wallets";
import { reportsRouter } from "./routers/reports";
import { investorsRouter } from "./routers/investors";
import { billingRouter } from "./routers/billing";
import { notificationsRouter } from "./routers/notifications";
import { usersRouter } from "./routers/users";
import { grantsRouter } from "./routers/grants";
import { governanceProposalsRouter } from "./routers/governance-proposals";
import { partnersRouter } from "./routers/partners";
import { asksRouter } from "./routers/asks";
import { qaHighlightsRouter } from "./routers/qa-highlights";

export const appRouter = router({
  projects: projectsRouter,
  wallets: walletsRouter,
  reports: reportsRouter,
  investors: investorsRouter,
  billing: billingRouter,
  notifications: notificationsRouter,
  users: usersRouter,
  grants: grantsRouter,
  governanceProposals: governanceProposalsRouter,
  partners: partnersRouter,
  asks: asksRouter,
  qaHighlights: qaHighlightsRouter,
});

export type AppRouter = typeof appRouter;
