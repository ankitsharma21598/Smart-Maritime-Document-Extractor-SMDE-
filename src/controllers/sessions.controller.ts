import type { Request, Response } from "express";
import { models } from "../models/index.js";
import { requireSession } from "../services/sessionRepo.js";
import { enqueueSessionValidation } from "../services/sessionValidationEnqueue.js";
import { routeParamId } from "../utils/routeParams.js";
import { isUuid } from "../utils/uuid.js";
import { sendApiError } from "../utils/apiError.js";
import type { SessionValidationResult } from "../types.js";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

function normalizeSeverity(raw: unknown): Severity {
  const v = String(raw ?? "").toUpperCase();
  if (v === "CRITICAL") return "CRITICAL";
  if (v === "HIGH" || v === "WARNING") return "HIGH";
  if (v === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toBoolean(value: unknown): boolean {
  return Boolean(value);
}

export function getSessionByIdController() {
  return async (req: Request, res: Response) => {
    const id = routeParamId(req.params["id"]);
    if (id === undefined || !isUuid(id)) {
      sendApiError(res, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }
    try {
      await requireSession(id);
    } catch {
      sendApiError(res, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }

    const docs = await models.Document.findAll({
      where: { sessionId: id },
      include: [{ model: models.ExtractionCache, as: "cache", required: true }],
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
      const extracted = asRecord(plain.cache.extraction);
      const flags = Array.isArray(extracted.flags)
        ? (extracted.flags as Array<Record<string, unknown>>)
        : [];
      const complianceIssues = Array.isArray(plain.cache.complianceIssues)
        ? (plain.cache.complianceIssues as Array<Record<string, unknown>>)
        : [];
      const allFlags = [...flags, ...complianceIssues];
      const criticalFlagCount = allFlags.filter(
        (f) => normalizeSeverity(f.severity) === "CRITICAL",
      ).length;
      const flagCount = allFlags.length;
      const validity = asRecord(extracted.validity);
      const isExpired = toBoolean(validity.isExpired ?? extracted.isExpired);

      return {
        id: plain.id,
        fileName: plain.originalFilename,
        documentType: plain.cache.documentType,
        applicableRole: (extracted.applicableRole ?? null) as string | null,
        holderName: (extracted.holderName ?? null) as string | null,
        confidence: (extracted.confidence ?? null) as string | null,
        isExpired,
        flagCount,
        criticalFlagCount,
        createdAt: plain.createdAt.toISOString(),
      };
    });

    const roleFrequency = new Map<string, number>();
    let hasCritical = false;
    let hasWarn = false;
    for (const doc of documents) {
      if (doc.applicableRole) {
        roleFrequency.set(
          doc.applicableRole,
          (roleFrequency.get(doc.applicableRole) ?? 0) + 1,
        );
      }
      if (doc.criticalFlagCount > 0 || doc.isExpired) {
        hasCritical = true;
      } else if (doc.flagCount > 0) {
        hasWarn = true;
      }
    }
    let detectedRole: string | null = null;
    for (const [role, count] of roleFrequency.entries()) {
      if (
        detectedRole === null ||
        count > (roleFrequency.get(detectedRole) ?? 0)
      ) {
        detectedRole = role;
      }
    }
    const overallHealth = hasCritical ? "CRITICAL" : hasWarn ? "WARN" : "OK";

    const pendingJobs = await models.Job.findAll({
      where: { sessionId: id, status: ["queued", "running"] },
      order: [["createdAt", "ASC"]],
      attributes: ["id", "status", "kind", "createdAt", "startedAt"],
    });

    res.json({
      sessionId: id,
      documentCount: documents.length,
      detectedRole,
      overallHealth,
      documents,
      pendingJobs: pendingJobs.map((j) => {
        const p = j.get({ plain: true }) as {
          id: string;
          status: string;
          kind: string;
          createdAt: Date;
          startedAt: Date | null;
        };
        return {
          jobId: p.id,
          status: p.status.toUpperCase(),
          kind: p.kind,
          createdAt: p.createdAt.toISOString(),
          startedAt: p.startedAt ? p.startedAt.toISOString() : null,
        };
      }),
    });
  };
}

export function postSessionValidateController() {
  return async (req: Request, res: Response) => {
    const id = routeParamId(req.params["id"]);
    if (id === undefined || !isUuid(id)) {
      sendApiError(res, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }
    try {
      await requireSession(id);
    } catch {
      sendApiError(res, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }

    const docCount = await models.Document.count({ where: { sessionId: id } });
    if (docCount < 2) {
      sendApiError(
        res,
        400,
        "INSUFFICIENT_DOCUMENTS",
        "At least two documents are required for cross-document validation.",
      );
      return;
    }

    const mode = req.query.mode === "async" ? "async" : "sync";
    try {
      const { jobId } = await enqueueSessionValidation({
        sessionId: id,
        sync: mode === "sync",
      });
      if (mode === "async") {
        res.status(202).json({
          jobId,
          sessionId: id,
          status: "QUEUED",
          pollUrl: `/api/jobs/${jobId}`,
        });
        return;
      }

      const validation = await models.SessionValidation.findOne({
        where: { sessionId: id },
        order: [["createdAt", "DESC"]],
      });
      const plain = validation?.get({ plain: true }) as
        | {
            id: string;
            result: SessionValidationResult | null;
            errorMessage: string | null;
            createdAt: Date;
          }
        | undefined;

      if (!plain || plain.errorMessage || !plain.result) {
        sendApiError(
          res,
          500,
          "INTERNAL_ERROR",
          plain?.errorMessage ?? "Validation failed unexpectedly.",
        );
        return;
      }

      res.json({
        sessionId: id,
        holderProfile: plain.result.holderProfile,
        consistencyChecks: plain.result.consistencyChecks,
        missingDocuments: plain.result.missingDocuments,
        expiringDocuments: plain.result.expiringDocuments,
        medicalFlags: plain.result.medicalFlags,
        overallStatus: plain.result.overallStatus,
        overallScore: plain.result.overallScore,
        summary: plain.result.summary,
        recommendations: plain.result.recommendations,
        validatedAt: plain.createdAt.toISOString(),
      });
    } catch {
      sendApiError(res, 500, "INTERNAL_ERROR", "Unexpected server error.");
    }
  };
}

export function getSessionReportController() {
  return async (req: Request, res: Response) => {
    const id = routeParamId(req.params["id"]);
    if (id === undefined || !isUuid(id)) {
      sendApiError(res, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }
    try {
      await requireSession(id);
    } catch {
      sendApiError(res, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }

    const docs = await models.Document.findAll({
      where: { sessionId: id },
      include: [
        {
          model: models.ExtractionCache,
          as: "cache",
          required: true,
          attributes: ["documentType", "extraction", "complianceIssues", "status", "errorMessage"],
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
      const extraction = asRecord(plain.cache.extraction);
      const validity = asRecord(extraction.validity);
      const isExpired = toBoolean(validity.isExpired ?? extraction.isExpired);
      const daysUntilExpiry =
        typeof validity.daysUntilExpiry === "number"
          ? validity.daysUntilExpiry
          : null;
      return {
        id: plain.id,
        fileName: plain.originalFilename,
        mimeType: plain.mimeType,
        documentType: plain.cache.documentType,
        holderName: (extraction.holderName ?? null) as string | null,
        applicableRole: (extraction.applicableRole ?? null) as string | null,
        confidence: (extraction.confidence ?? null) as string | null,
        validity: {
          dateOfIssue: (validity.dateOfIssue ?? null) as string | null,
          dateOfExpiry: (validity.dateOfExpiry ?? null) as string | null,
          daysUntilExpiry,
          isExpired,
        },
        complianceIssues: plain.cache.complianceIssues,
        cacheStatus: plain.cache.status,
        errorMessage: plain.cache.errorMessage,
      };
    });

    const val = await models.SessionValidation.findOne({
      where: { sessionId: id },
      order: [["createdAt", "DESC"]],
    });

    const vPlain = val?.get({ plain: true }) as
      | { id: string; result: unknown; errorMessage: string | null; createdAt: Date }
      | undefined;

    res.json({
      sessionId: id,
      reportGeneratedAt: new Date().toISOString(),
      decisionView: {
        overallStatus:
          ((vPlain?.result as SessionValidationResult | undefined)?.overallStatus ??
            "CONDITIONAL") as "APPROVED" | "CONDITIONAL" | "REJECTED",
        overallScore:
          ((vPlain?.result as SessionValidationResult | undefined)?.overallScore ??
            null) as number | null,
        summary:
          ((vPlain?.result as SessionValidationResult | undefined)?.summary ??
            null) as string | null,
      },
      candidateProfile:
        ((vPlain?.result as SessionValidationResult | undefined)?.holderProfile ??
          null) as Record<string, unknown> | null,
      documents,
      riskSignals: {
        consistencyChecks:
          ((vPlain?.result as SessionValidationResult | undefined)
            ?.consistencyChecks ?? []) as Array<Record<string, unknown>>,
        medicalFlags:
          ((vPlain?.result as SessionValidationResult | undefined)?.medicalFlags ??
            []) as Array<Record<string, unknown>>,
        missingDocuments:
          ((vPlain?.result as SessionValidationResult | undefined)
            ?.missingDocuments ?? []) as Array<Record<string, unknown>>,
        expiringDocuments:
          ((vPlain?.result as SessionValidationResult | undefined)
            ?.expiringDocuments ?? []) as Array<Record<string, unknown>>,
      },
      recommendations:
        ((vPlain?.result as SessionValidationResult | undefined)
          ?.recommendations ?? []) as string[],
      latestValidation: vPlain
        ? {
            id: vPlain.id,
            validatedAt: vPlain.createdAt.toISOString(),
            errorMessage: vPlain.errorMessage,
          }
        : null,
    });
  };
}
