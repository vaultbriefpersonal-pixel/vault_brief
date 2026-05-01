import { relations } from "drizzle-orm";
import {
  users,
  projects,
  wallets,
  treasurySnapshots,
  reports,
  investors,
  milestones,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  wallets: many(wallets),
  snapshots: many(treasurySnapshots),
  reports: many(reports),
  investors: many(investors),
  milestones: many(milestones),
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
