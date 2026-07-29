import { relations } from "drizzle-orm";
import {
  users,
  projects,
  projectMembers,
  wallets,
  treasurySnapshots,
  reports,
  investors,
  milestones,
  grants,
  governanceProposals,
  partners,
  asks,
  qaHighlights,
  projectBudgets,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  projectMemberships: many(projectMembers),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  members: many(projectMembers),
  wallets: many(wallets),
  snapshots: many(treasurySnapshots),
  reports: many(reports),
  investors: many(investors),
  milestones: many(milestones),
  grants: many(grants),
  governanceProposals: many(governanceProposals),
  partners: many(partners),
  asks: many(asks),
  qaHighlights: many(qaHighlights),
  budgets: many(projectBudgets),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id],
  }),
}));

export const walletsRelations = relations(wallets, ({ one }) => ({
  project: one(projects, {
    fields: [wallets.projectId],
    references: [projects.id],
  }),
}));

export const snapshotsRelations = relations(treasurySnapshots, ({ one }) => ({
  project: one(projects, {
    fields: [treasurySnapshots.projectId],
    references: [projects.id],
  }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  project: one(projects, {
    fields: [reports.projectId],
    references: [projects.id],
  }),
  snapshot: one(treasurySnapshots, {
    fields: [reports.snapshotId],
    references: [treasurySnapshots.id],
  }),
}));

export const investorsRelations = relations(investors, ({ one }) => ({
  project: one(projects, {
    fields: [investors.projectId],
    references: [projects.id],
  }),
}));

export const milestonesRelations = relations(milestones, ({ one }) => ({
  project: one(projects, {
    fields: [milestones.projectId],
    references: [projects.id],
  }),
}));

export const grantsRelations = relations(grants, ({ one }) => ({
  project: one(projects, {
    fields: [grants.projectId],
    references: [projects.id],
  }),
}));

export const governanceProposalsRelations = relations(
  governanceProposals,
  ({ one }) => ({
    project: one(projects, {
      fields: [governanceProposals.projectId],
      references: [projects.id],
    }),
  })
);

export const partnersRelations = relations(partners, ({ one }) => ({
  project: one(projects, {
    fields: [partners.projectId],
    references: [projects.id],
  }),
}));

export const asksRelations = relations(asks, ({ one }) => ({
  project: one(projects, {
    fields: [asks.projectId],
    references: [projects.id],
  }),
}));

export const qaHighlightsRelations = relations(qaHighlights, ({ one }) => ({
  project: one(projects, {
    fields: [qaHighlights.projectId],
    references: [projects.id],
  }),
}));

export const projectBudgetsRelations = relations(projectBudgets, ({ one }) => ({
  project: one(projects, {
    fields: [projectBudgets.projectId],
    references: [projects.id],
  }),
}));
