import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

import { projects } from "./projects.model.js";
import { users } from "./users.model.js";

export const taskStatusEnum = pgEnum("task_status", [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "BLOCKED",
  "IN_REVIEW",
]);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "cascade",
      }),

    title: varchar("title", { length: 255 }).notNull(),

    description: text("description"),

    assignedTo: uuid("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),

    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
      }),

    status: taskStatusEnum("status")
      .default("PENDING")
      .notNull(),

    position: integer("position").default(0).notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    }).defaultNow().notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    }).defaultNow().notNull(),
  },
  (table) => [
    index("tasks_project_id_idx").on(table.projectId),

    index("tasks_assigned_to_idx").on(table.assignedTo),

    index("tasks_project_position_idx").on(
      table.projectId,
      table.position
    ),

    index("tasks_project_status_idx").on(
      table.projectId,
      table.status
    ),
  ]
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;