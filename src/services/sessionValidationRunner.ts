import { models } from "../models/index.js";
import { validateSessionDocuments } from "./llm.js";
import type { SessionValidationResult } from "../types.js";

export async function processSessionValidateJob(params: {
  jobId: string;
  sessionId: string;
}): Promise<void> {
  const { jobId, sessionId } = params;
  const docs = await models.Document.findAll({
    where: { sessionId },
    include: [
      {
        model: models.ExtractionCache,
        as: "cache",
        required: true,
        attributes: ["documentType", "extraction"],
      },
    ],
    order: [["createdAt", "ASC"]],
  });

  const payload = {
    documents: docs.map((d) => {
      const plain = d.get({ plain: true }) as {
        id: string;
        originalFilename: string;
        cache: { documentType: string | null; extraction: unknown };
      };
      return {
        id: plain.id,
        filename: plain.originalFilename,
        documentType: plain.cache.documentType,
        extraction: (plain.cache.extraction as Record<string, unknown> | null) ?? null,
      };
    }),
  };

  try {
    const result: SessionValidationResult = await validateSessionDocuments(payload);
    await models.SessionValidation.create({
      sessionId,
      result,
      errorMessage: null,
    });
    await models.Job.update(
      {
        status: "completed",
        completedAt: new Date(),
        result: { validation: result },
      },
      { where: { id: jobId } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await models.SessionValidation.create({
      sessionId,
      result: null,
      errorMessage: msg,
    });
    await models.Job.update(
      {
        status: "failed",
        completedAt: new Date(),
        errorMessage: msg,
      },
      { where: { id: jobId } }
    );
  }
}
