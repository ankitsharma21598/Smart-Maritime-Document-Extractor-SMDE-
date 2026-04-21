import type { Request, Response } from "express";
import { models } from "../models/index.js";
import { routeParamId } from "../utils/routeParams.js";
import { isUuid } from "../utils/uuid.js";

export function getJobHandler() {
  return async (req: Request, res: Response) => {
    const id = routeParamId(req.params["id"]);
    if (id === undefined || !isUuid(id)) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const row = await models.Job.findByPk(id);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const p = row.get({ plain: true }) as {
      id: string;
      kind: string;
      status: string;
      fileHash: string | null;
      documentId: string | null;
      sessionId: string | null;
      result: unknown;
      errorMessage: string | null;
      createdAt: Date;
      startedAt: Date | null;
      completedAt: Date | null;
    };
    res.json({
      id: p.id,
      kind: p.kind,
      status: p.status,
      file_hash: p.fileHash,
      document_id: p.documentId,
      session_id: p.sessionId,
      result: p.result,
      error_message: p.errorMessage,
      created_at: p.createdAt,
      started_at: p.startedAt,
      completed_at: p.completedAt,
    });
  };
}
