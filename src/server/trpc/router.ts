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
import { milestonesRouter } from "./routers/milestones";
import { projectMembersRouter } from "./routers/project-members";
import { projectBudgetsRouter } from "./routers/project-budgets";
// Awards RECEIVED. `grantsRouter` above is the `grants` table — money given
// out. Two routers on purpose; see the header on grantAwards in schema.ts.
import { grantAwardsRouter } from "./routers/grant-awards";

export const appRouter = router({
  projectMembers: projectMembersRouter,
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
  milestones: milestonesRouter,
  projectBudgets: projectBudgetsRouter,
  grantAwards: grantAwardsRouter,
});

export type AppRouter = typeof appRouter;
