import { relations } from "drizzle-orm";

import { users } from "./users.model.js";
import { projects } from "./projects.model.js";
import { projectMembers } from "./project-members.model.js";
import { tasks } from "./tasks.model.js";
import { sessions } from "./sessions.model.js";

export const usersRelations = relations(users, ({ many }) => ({
  createdProjects: many(projects),

  projectMemberships: many(projectMembers),

  assignedTasks: many(tasks, {
    relationName: "taskAssignee",
  }),

  createdTasks: many(tasks, {
    relationName: "taskCreator",
  }),

  sessions: many(sessions),
}));

export const projectsRelations = relations(
  projects,
  ({ one, many }) => ({
    creator: one(users, {
      fields: [projects.createdBy],
      references: [users.id],
    }),

    members: many(projectMembers),

    tasks: many(tasks),
  })
);

export const projectMembersRelations = relations(
  projectMembers,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectMembers.projectId],
      references: [projects.id],
    }),

    user: one(users, {
      fields: [projectMembers.userId],
      references: [users.id],
    }),
  })
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),

  assignee: one(users, {
    fields: [tasks.assignedTo],
    references: [users.id],
    relationName: "taskAssignee",
  }),

  creator: one(users, {
    fields: [tasks.createdBy],
    references: [users.id],
    relationName: "taskCreator",
  }),
}));