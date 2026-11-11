import {
  pgTable,
  uuid,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";

import { users } from "./users.model.js";
import { projects } from "./projects.model.js";

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "cascade",
      }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    joinedAt: timestamp("joined_at", {
      withTimezone: true,
    }).defaultNow().notNull(),
  },
  (table) => [
    unique("project_members_project_user_unique").on(
      table.projectId,
      table.userId
    ),

    index("project_members_user_id_idx").on(table.userId),

    index("project_members_project_id_idx").on(table.projectId),
  ]
);

export type ProjectMember = typeof projectMembers.$inferSelect;
export type NewProjectMember = typeof projectMembers.$inferInsert;