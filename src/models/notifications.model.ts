import {
  pgTable,
  uuid,
  timestamp,
  index,
  unique,
  serial,
  varchar,
  text,
} from "drizzle-orm/pg-core";
import { users } from "./users.model.js";
import { projects } from "./projects.model.js";

export const notifications = pgTable("notifications", {
    id: serial("id").primaryKey(),
    fromUser: uuid("user_id")
          .notNull()
          .references(() => users.id, {
            onDelete: "cascade",
          }),
    message: text("message").notNull(),
    toUser: uuid("to_user_id").array().default([]).notNull(),
    projectId: uuid("project_id").notNull().references(() => projects.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;