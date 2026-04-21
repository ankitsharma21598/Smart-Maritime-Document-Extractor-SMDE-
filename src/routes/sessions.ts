import type { Request, Response } from "express";
import { models } from "../models/index.js";
import { requireSession } from "../services/sessionRepo.js";
import { enqueueSessionValidation } from "../services/sessionValidationEnqueue.js";
import { routeParamId } from "../utils/routeParams.js";
import { isUuid } from "../utils/uuid.js";

export function getSessionHandler() {
  return async (req: Request, res: Response) => {
    const id = routeParamId(req.params["id"]);
    if (id === undefined || !isUuid(id)) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }
    try {
      await requireSession(id);
    } catch (e) {
      const err = e as Error & { status?: number };
      res.status(err.status ?? 500).json({ error: err.message });
      return;
    }

    const docs = await models.Document.findAll({
      where: { sessionId: id },
      include: [
        {
          model: models.ExtractionCache,
          as: "cache",
          required: true,
        },
      ],
      order: [["createdAt", "ASC"]],
    });

    const documents = docs.map((d) => {
      const plain = d.get({ plain: true }) as {
        id: string;
        fileHash: string;
        originalFilename: string;
        mimeType: string;
        byteSize: number;
        createdAt: Date;
        cache: {
          status: string;
          documentType: string | null;
          extraction: unknown;
          complianceIssues: unknown;
          errorMessage: string | null;
        };
      };
      return {
        id: plain.id,
        file_hash: plain.fileHash,
        original_filename: plain.originalFilename,
        mime_type: plain.mimeType,
        byte_size: plain.byteSize,
        created_at: plain.createdAt,
        cache_status: plain.cache.status,
        document_type: plain.cache.documentType,
        extraction: plain.cache.extraction,
        compliance_issues: plain.cache.complianceIssues,
        cache_error: plain.cache.errorMessage,
      };
    });

    res.json({ sessionId: id, documents });
  };
}

export function postSessionValidateHandler() {
  return async (req: Request, res: Response) => {
    const id = routeParamId(req.params["id"]);
    if (id === undefined || !isUuid(id)) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }
    try {
      await requireSession(id);
    } catch (e) {
      const err = e as Error & { status?: number };
      res.status(err.status ?? 500).json({ error: err.message });
      return;
    }

    const sync = req.query.sync === "true";
    try {
      const { jobId } = await enqueueSessionValidation({ sessionId: id, sync });
      if (sync) {
        const job = await models.Job.findByPk(jobId);
        const p = job?.get({ plain: true });
        res.json({ jobId, job: p });
        return;
      }
      res.status(202).json({ jobId });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  };
}

export function getSessionReportHandler() {
  return async (req: Request, res: Response) => {
    const id = routeParamId(req.params["id"]);
    if (id === undefined || !isUuid(id)) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }
    try {
      await requireSession(id);
    } catch (e) {
      const err = e as Error & { status?: number };
      res.status(err.status ?? 500).json({ error: err.message });
      return;
    }

    const docs = await models.Document.findAll({
      where: { sessionId: id },
      include: [
        {
          model: models.ExtractionCache,
          as: "cache",
          required: true,
          attributes: [
            "documentType",
            "extraction",
            "complianceIssues",
            "status",
            "errorMessage",
          ],
        },
      ],
      order: [["createdAt", "ASC"]],
    });

    const documents = docs.map((d) => {
      const plain = d.get({ plain: true }) as {
        id: string;
        originalFilename: string;
        mimeType: string;
        cache: {
          documentType: string | null;
          extraction: unknown;
          complianceIssues: unknown;
          status: string;
          errorMessage: string | null;
        };
      };
      return {
        id: plain.id,
        original_filename: plain.originalFilename,
        mime_type: plain.mimeType,
        document_type: plain.cache.documentType,
        extraction: plain.cache.extraction,
        compliance_issues: plain.cache.complianceIssues,
        cache_status: plain.cache.status,
        error_message: plain.cache.errorMessage,
      };
    });

    const val = await models.SessionValidation.findOne({
      where: { sessionId: id },
      order: [["createdAt", "DESC"]],
    });

    const vPlain = val?.get({ plain: true }) as
      | {
          id: string;
          result: unknown;
          errorMessage: string | null;
          createdAt: Date;
        }
      | undefined;

    res.json({
      sessionId: id,
      generatedAt: new Date().toISOString(),
      documents,
      latestValidation: vPlain
        ? {
            id: vPlain.id,
            result: vPlain.result,
            error_message: vPlain.errorMessage,
            created_at: vPlain.createdAt,
          }
        : null,
    });
  };
}
