import { readFile } from "node:fs/promises";
import type { Transaction } from "sequelize";
import { sequelize, models } from "../models/index.js";
import { pathForHash } from "./fileStorage.js";
import { extractFromContent, LlmJsonParseError, LlmTimeoutError } from "./llm.js";
import { extractPdfText } from "./pdfText.js";
import type { LlmExtractionResult } from "../types.js";

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function loadDocumentContent(params: {
  mimeType: string;
  buffer: Buffer;
}): Promise<{ text?: string; imageBase64?: { mime: string; b64: string } }> {
  if (params.mimeType === "application/pdf") {
    const text = await extractPdfText(params.buffer);
    if (!text.trim()) {
      throw new Error(
        "PDF has no extractable text. Upload page images or use a text-based PDF export."
      );
    }
    return { text };
  }
  if (IMAGE_MIME.has(params.mimeType)) {
    return {
      imageBase64: { mime: params.mimeType, b64: params.buffer.toString("base64") },
    };
  }
  throw new Error(`Unsupported MIME type for extraction: ${params.mimeType}`);
}

export async function runLlmOnFile(params: {
  mimeType: string;
  buffer: Buffer;
  fileName?: string;
}): Promise<{ result: LlmExtractionResult; rawLlmResponse: string }> {
  const content = await loadDocumentContent(params);
  const maybeFileName =
    params.fileName !== undefined ? { fileName: params.fileName } : {};
  return extractFromContent({
    ...content,
    mimeType: params.mimeType,
    ...maybeFileName,
  });
}

export async function finalizeCacheSuccess(
  t: Transaction,
  fileHash: string,
  result: LlmExtractionResult,
  rawLlmResponse: string,
  processingTimeMs: number
): Promise<void> {
  const payload = result.structuredData as Record<string, unknown>;
  const detection = (payload.detection ?? {}) as Record<string, unknown>;
  const holder = (payload.holder ?? {}) as Record<string, unknown>;
  const validity = (payload.validity ?? {}) as Record<string, unknown>;

  await models.ExtractionCache.update(
    {
      status: "completed",
      documentType: result.documentType,
      documentName:
        (typeof detection.documentName === "string"
          ? detection.documentName
          : null) ?? null,
      applicableRole:
        (typeof detection.applicableRole === "string"
          ? detection.applicableRole
          : null) ?? null,
      confidence:
        (typeof detection.confidence === "string"
          ? detection.confidence
          : null) ?? null,
      holderName:
        (typeof holder.fullName === "string" ? holder.fullName : null) ?? null,
      dateOfBirth:
        (typeof holder.dateOfBirth === "string" ? holder.dateOfBirth : null) ??
        null,
      sirbNumber:
        (typeof holder.sirbNumber === "string" ? holder.sirbNumber : null) ??
        null,
      passportNumber:
        (typeof holder.passportNumber === "string"
          ? holder.passportNumber
          : null) ?? null,
      isExpired: Boolean(validity.isExpired),
      summary: (typeof payload.summary === "string" ? payload.summary : null) ?? null,
      processingTimeMs,
      extraction: result.structuredData,
      complianceIssues: result.complianceIssues,
      rawLlmResponse,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    },
    { where: { fileHash }, transaction: t }
  );
}

export async function finalizeCacheFailure(
  t: Transaction,
  fileHash: string,
  errorCode: string,
  message: string,
  rawLlmResponse: string
): Promise<void> {
  await models.ExtractionCache.update(
    {
      status: "failed",
      errorCode,
      errorMessage: message,
      rawLlmResponse,
      updatedAt: new Date(),
    },
    { where: { fileHash }, transaction: t }
  );
}

export async function processExtractJob(params: {
  jobId: string;
  fileHash: string;
  mimeType: string;
}): Promise<void> {
  const { jobId, fileHash, mimeType } = params;
  await sequelize.transaction(async (t) => {
    const cache = await models.ExtractionCache.findByPk(fileHash, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!cache) {
      throw new Error(`Missing extraction_cache for ${fileHash}`);
    }
    const status = cache.get("status") as string;
    if (status === "completed" || status === "failed") {
      await models.Job.update(
        {
          status: "completed",
          completedAt: new Date(),
          result: { deduplicated: true, cacheStatus: status },
        },
        { where: { id: jobId }, transaction: t }
      );
      return;
    }
    await models.ExtractionCache.update(
      { status: "processing", updatedAt: new Date() },
      { where: { fileHash }, transaction: t }
    );
  });

  const buffer = await readFile(pathForHash(fileHash));
  let result: LlmExtractionResult;
  let rawLlmResponse = "";
  const startedAt = Date.now();
  try {
    const doc = await models.Document.findOne({
      where: { fileHash },
      order: [["createdAt", "ASC"]],
      attributes: ["originalFilename"],
    });
    const fileName = (doc?.get("originalFilename") as string | undefined) ?? undefined;
    const run = await runLlmOnFile({
      mimeType,
      buffer,
      ...(fileName !== undefined ? { fileName } : {}),
    });
    result = run.result;
    rawLlmResponse = run.rawLlmResponse;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    rawLlmResponse =
      rawLlmResponse ||
      (e instanceof LlmJsonParseError ? e.rawResponse : msg);
    const retryable = e instanceof LlmTimeoutError;
    const errorCode = e instanceof LlmTimeoutError
      ? "LLM_TIMEOUT"
      : e instanceof LlmJsonParseError
        ? "LLM_JSON_PARSE_FAIL"
        : "INTERNAL_ERROR";
    await sequelize.transaction(async (t) => {
      await finalizeCacheFailure(t, fileHash, errorCode, msg, rawLlmResponse);
      await models.Job.update(
        {
          status: "failed",
          completedAt: new Date(),
          errorCode,
          errorMessage: msg,
          result: { retryable },
        },
        { where: { id: jobId }, transaction: t }
      );
    });
    return;
  }

  await sequelize.transaction(async (t) => {
    await finalizeCacheSuccess(
      t,
      fileHash,
      result,
      rawLlmResponse,
      Date.now() - startedAt
    );
    await models.Job.update(
      {
        status: "completed",
        completedAt: new Date(),
        result: { extraction: result },
      },
      { where: { id: jobId }, transaction: t }
    );
  });
}
