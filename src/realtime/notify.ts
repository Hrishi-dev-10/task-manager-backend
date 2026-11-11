import { eq } from "drizzle-orm";
import { db } from "../config/db.config.js";
import { projectMembers } from "../models/project-members.model.js";
import { projects } from "../models/projects.model.js";
import { users } from "../models/users.model.js";
import { notifyUsers } from "./socket.js";
import { notifications } from "../models/notifications.model.js";

const statusLabels: Record<string, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  IN_REVIEW: "In review",
  COMPLETED: "Completed",
};

export function taskChangeDetail(input: {
  name?: unknown;
  description?: unknown;
  assignedTo?: unknown;
  status?: unknown;
  projectId?: unknown;
}) {
  const parts: string[] = [];
  if (input.name) parts.push("name");
  if (input.description) parts.push("description");
  if (input.assignedTo) parts.push("assignee");
  if (typeof input.status === "string" && input.status) {
    parts.push(`status to ${statusLabels[input.status] ?? input.status}`);
  }
  if (input.projectId) parts.push("project");
  if (parts.length === 0) return "";
  return `Changed ${parts.join(", ")}.`;
}

export async function notifyTaskChange(input: {
  projectId: string;
  taskTitle: string;
  actorId: string | null;
  kind: "created" | "updated";
  detail?: string;
}) {
  try {
    const recipients = await memberIds(input.projectId, input.actorId);
    if (recipients.length === 0) return;
    const [actor, projectName] = await Promise.all([
      personName(input.actorId),
      projectNameOf(input.projectId),
    ]);
    const action = input.kind === "created" ? "created" : "updated";
    const detail = input.detail ? ` ${input.detail}` : "";
    const message = `${actor} ${action} “${input.taskTitle}” in ${projectName}.${detail}`;
    await db.insert(notifications).values({
      projectId:input.projectId??"",
      fromUser:input.actorId??"",
      message,
      toUser:recipients,
    });
    notifyUsers(recipients, {
      title: input.kind === "created" ? "Task created" : "Task updated",
      message,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Task notification failed", error);
  }
}

export async function notifyAddedToProject(projectId: string, userIds: string[], actorId: string | null) {
  try {
    const recipients = [...new Set(userIds.filter((userId) => userId && userId !== actorId))];
    if (recipients.length === 0) return;
    const [actor, projectName] = await Promise.all([personName(actorId), projectNameOf(projectId)]);
    const message = `${actor} added you to ${projectName}.`;
    await db.insert(notifications).values({
      projectId:projectId??"",
      fromUser:actorId??"",
      message,
      toUser:recipients,
    });
    notifyUsers(recipients, {
      title: "Added to a project",
      message,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Membership notification failed", error);
  }
}

async function memberIds(projectId: string, exceptUserId: string | null) {
  const rows = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  return rows.map((row) => row.userId).filter((userId) => userId !== exceptUserId);
}

async function projectNameOf(projectId: string) {
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project?.name ?? "a project";
}

async function personName(userId: string | null) {
  if (!userId) return "Someone";
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.name ?? "Someone";
}
