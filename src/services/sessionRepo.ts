import { models } from "../models/index.js";

export async function createSession(): Promise<string> {
  const row = await models.Session.create({});
  const id = row.get("id") as string;
  if (!id) throw new Error("Failed to create session");
  return id;
}

export async function requireSession(sessionId: string): Promise<void> {
  const row = await models.Session.findByPk(sessionId, { attributes: ["id"] });
  if (!row) {
    const e = new Error("Session not found");
    (e as Error & { status?: number }).status = 404;
    throw e;
  }
}
