import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "../config/db.config.js";
import { users } from "../models/users.model.js";

/** The signed-in user, when the client sends X-User-Id. */
export async function requestUser(req: Request) {
  const header = req.headers["x-user-id"];
  const id = (Array.isArray(header) ? header[0] : header)?.trim();
  if (!id) return null;
  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return user ?? null;
}
