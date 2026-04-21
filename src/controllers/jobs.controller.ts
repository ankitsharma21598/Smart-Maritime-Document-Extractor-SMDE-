import type { Request, Response } from "express";
import { Op } from "sequelize";
import { models } from "../models/index.js";
import { routeParamId } from "../utils/routeParams.js";
import { isUuid } from "../utils/uuid.js";
import { sendApiError } from "../utils/apiError.js";

const DEFAULT_JOB_ESTIMATE_MS = 6000;

function mapFailedErrorCode(
  message: string | null,
): "LLM_JSON_PARSE_FAIL" | "INTERNAL_ERROR" {
  if (message?.includes("LLM returned invalid JSON")) {
    return "LLM_JSON_PARSE_FAIL";
  }
  return "INTERNAL_ERROR";
}

function isTimeoutFailure(message: string | null): boolean {
  const normalized = String(message ?? "").toLowerCase();
  return normalized.includes("timed out") || normalized.includes("abort");
}

export function getJobByIdController() {
  return async (req: Request, res: Response) => {
    const id = routeParamId(req.params["id"]);
    if (id === undefined || !isUuid(id)) {
      sendApiError(res, 404, "JOB_NOT_FOUND", "Job not found.");
      return;
    }
    const row = await models.Job.findByPk(id);
    if (!row) {
      sendApiError(res, 404, "JOB_NOT_FOUND", "Job not found.");
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

    if (p.status === "queued") {
      const ahead = await models.Job.count({
        where: {
          status: "queued",
          createdAt: { [Op.lt]: p.createdAt },
        },
      });
      res.status(200).json({
        jobId: p.id,
        status: "QUEUED",
        queuePosition: ahead + 1,
        startedAt: null,
        estimatedCompleteMs: Math.max(DEFAULT_JOB_ESTIMATE_MS, DEFAULT_JOB_ESTIMATE_MS * (ahead + 1)),
      });
      return;
    }

    if (p.status === "running") {
      const elapsed = p.startedAt ? Date.now() - new Date(p.startedAt).getTime() : 0;
      const remaining = Math.max(0, DEFAULT_JOB_ESTIMATE_MS - elapsed);
      res.status(200).json({
        jobId: p.id,
        status: "PROCESSING",
        queuePosition: 0,
        startedAt: p.startedAt ? new Date(p.startedAt).toISOString() : null,
        estimatedCompleteMs: remaining,
      });
      return;
    }

    if (p.status === "completed") {
      const payload =
        p.result && typeof p.result === "object" && "extraction" in (p.result as Record<string, unknown>)
          ? ((p.result as Record<string, unknown>).extraction ?? p.result)
          : p.result;

      res.status(200).json({
        jobId: p.id,
        status: "COMPLETE",
        extractionId: p.documentId,
        result: payload,
        completedAt: p.completedAt ? new Date(p.completedAt).toISOString() : null,
      });
      return;
    }

    const errorCode = mapFailedErrorCode(p.errorMessage);
    const retryable = errorCode === "LLM_JSON_PARSE_FAIL" || isTimeoutFailure(p.errorMessage);
    res.status(200).json({
      jobId: p.id,
      status: "FAILED",
      error: errorCode,
      message: p.errorMessage ?? "Job failed.",
      failedAt: p.completedAt ? new Date(p.completedAt).toISOString() : null,
      retryable,
    });
  };
}
