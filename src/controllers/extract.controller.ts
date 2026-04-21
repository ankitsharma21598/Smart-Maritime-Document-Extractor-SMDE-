import type { Request, Response } from "express";
import { ingestExtract, type IngestExtractResult } from "../services/ingestExtract.js";
import { createSession, requireSession } from "../services/sessionRepo.js";
import { isUuid } from "../utils/uuid.js";
import { sendApiError } from "../utils/apiError.js";

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png"]);

function toSyncResponse(result: IngestExtractResult, processingTimeMs: number) {
  const payload = (result.extraction as Record<string, unknown> | null) ?? {};
  const validity = (payload.validity as Record<string, unknown> | null) ?? {};
  const isExpired = Boolean(validity.isExpired ?? payload.isExpired ?? false);

  return {
    id: result.documentId,
    sessionId: result.sessionId,
    fileName: result.fileName,
    documentType: (result.documentType ?? payload.documentType ?? null) as string | null,
    documentName: (payload.documentName ?? null) as string | null,
    applicableRole: (payload.applicableRole ?? null) as string | null,
    category: (payload.category ?? null) as string | null,
    confidence: (payload.confidence ?? null) as string | null,
    holderName: (payload.holderName ?? null) as string | null,
    dateOfBirth: (payload.dateOfBirth ?? null) as string | null,
    sirbNumber: (payload.sirbNumber ?? null) as string | null,
    passportNumber: (payload.passportNumber ?? null) as string | null,
    fields: Array.isArray(payload.fields) ? payload.fields : [],
    validity: {
      dateOfIssue: (validity.dateOfIssue ?? null) as string | null,
      dateOfExpiry: (validity.dateOfExpiry ?? null) as string | null,
      isExpired,
      daysUntilExpiry: (validity.daysUntilExpiry ?? null) as number | null,
      revalidationRequired: Boolean(validity.revalidationRequired ?? false),
    },
    compliance: (payload.compliance ?? { issues: result.complianceIssues ?? [] }) as unknown,
    medicalData: (payload.medicalData ?? null) as unknown,
    flags: Array.isArray(payload.flags) ? payload.flags : [],
    isExpired,
    processingTimeMs,
    summary: (payload.summary ?? null) as string | null,
    createdAt: result.createdAt.toISOString(),
  };
}

function isLlmParseError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("LLM returned invalid JSON");
}

export function postExtractController() {
  return async (req: Request, res: Response) => {
    const startedAt = Date.now();

    const file = req.file;
    if (!file?.buffer) {
      sendApiError(res, 400, "UNSUPPORTED_FORMAT", "Missing multipart file field: document.");
      return;
    }
    if (!ALLOWED.has(file.mimetype)) {
      sendApiError(res, 400, "UNSUPPORTED_FORMAT", `Unsupported file type: ${file.mimetype}`);
      return;
    }

    const sessionInput =
      typeof req.body.sessionId === "string"
        ? req.body.sessionId
        : typeof req.body.session_id === "string"
          ? req.body.session_id
          : undefined;

    let sessionId = sessionInput;
    if (sessionId && !isUuid(sessionId)) {
      sendApiError(res, 404, "SESSION_NOT_FOUND", "Session ID is invalid or does not exist.");
      return;
    }
    if (!sessionId) {
      sessionId = await createSession();
    } else {
      try {
        await requireSession(sessionId);
      } catch {
        sendApiError(res, 404, "SESSION_NOT_FOUND", "Session ID does not exist.");
        return;
      }
    }

    const rawMode = Array.isArray(req.query.mode) ? req.query.mode[0] : req.query.mode;
    const mode = rawMode === "async" ? "async" : "sync";

    try {
      const result = await ingestExtract({
        sessionId,
        buffer: file.buffer,
        originalFilename: file.originalname || "upload",
        mimeType: file.mimetype,
        async: mode === "async",
      });

      const processingTimeMs = Date.now() - startedAt;

      if (result.deduplicated) {
        res.setHeader("X-Deduplicated", "true");
        res.status(200).json(toSyncResponse(result, processingTimeMs));
        return;
      }

      if (mode === "async") {
        if (!result.jobId) {
          sendApiError(
            res,
            500,
            "INTERNAL_ERROR",
            "Unable to enqueue extraction job. Please retry.",
          );
          return;
        }
        res.status(202).json({
          jobId: result.jobId,
          sessionId: result.sessionId,
          status: "QUEUED",
          pollUrl: `/api/jobs/${result.jobId}`,
          estimatedWaitMs: 6000,
        });
        return;
      }

      res.status(200).json(toSyncResponse(result, processingTimeMs));
    } catch (e) {
      if (isLlmParseError(e)) {
        sendApiError(
          res,
          422,
          "LLM_JSON_PARSE_FAIL",
          "Document extraction failed after retry. The raw response has been stored for review.",
          { extractionId: null },
        );
        return;
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Unexpected server error.");
    }
  };
}
