import type { Request, Response } from "express";
import { ingestExtract } from "../services/ingestExtract.js";
import { createSession, requireSession } from "../services/sessionRepo.js";
import { isUuid } from "../utils/uuid.js";

const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);


export function extractRouter() {
  return async (req: Request, res: Response) => {
    const file = req.file;
    if (!file?.buffer) {
      res.status(400).json({ error: "Missing file field (multipart field name: file)" });
      return;
    }
    if (!ALLOWED.has(file.mimetype)) {
      res.status(400).json({ error: `Unsupported file type: ${file.mimetype}` });
      return;
    }

    let sessionId = typeof req.body.session_id === "string" ? req.body.session_id : undefined;
    if (sessionId && !isUuid(sessionId)) {
      res.status(400).json({ error: "Invalid session_id" });
      return;
    }
    if (!sessionId) {
      sessionId = await createSession();
    } else {
      try {
        await requireSession(sessionId);
      } catch (e) {
        const err = e as Error & { status?: number };
        res.status(err.status ?? 500).json({ error: err.message });
        return;
      }
    }

    const asyncMode = req.query.async !== "false";

    try {
      const result = await ingestExtract({
        sessionId,
        buffer: file.buffer,
        originalFilename: file.originalname || "upload",
        mimeType: file.mimetype,
        async: asyncMode,
      });

      if (asyncMode) {
        res.status(202).json({
          sessionId: result.sessionId,
          documentId: result.documentId,
          fileHash: result.fileHash,
          jobId: result.jobId,
          deduplicated: result.deduplicated,
          cacheStatus: result.cacheStatus,
          extraction: result.extraction,
          complianceIssues: result.complianceIssues,
          errorMessage: result.errorMessage,
        });
        return;
      }

      res.json({
        sessionId: result.sessionId,
        documentId: result.documentId,
        fileHash: result.fileHash,
        deduplicated: result.deduplicated,
        cacheStatus: result.cacheStatus,
        extraction: result.extraction,
        complianceIssues: result.complianceIssues,
        errorMessage: result.errorMessage,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  };
}
