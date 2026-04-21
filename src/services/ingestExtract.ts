import { Op, UniqueConstraintError } from "sequelize";
import { sequelize, models } from "../models/index.js";
import { saveUpload } from "./fileStorage.js";
import { sha256Hex } from "./fileHash.js";
import { processExtractJob } from "./extractionRunner.js";

export interface IngestExtractResult {
  sessionId: string;
  documentId: string;
  fileHash: string;
  cacheStatus: "pending" | "processing" | "completed" | "failed";
  deduplicated: boolean;
  jobId?: string;
  extraction?: unknown;
  complianceIssues?: unknown;
  errorMessage?: string;
  fileName: string;
  createdAt: Date;
  documentType?: string | null;
}

function isUniqueViolation(e: unknown): boolean {
  if (e instanceof UniqueConstraintError) return true;
  const err = e as { name?: string; parent?: { code?: string } };
  return err.parent?.code === "23505";
}

type TxOutcome =
  | { kind: "dedup"; result: IngestExtractResult }
  | { kind: "process"; base: IngestExtractResult; jobId?: string };

export async function ingestExtract(params: {
  sessionId: string;
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  async: boolean;
}): Promise<IngestExtractResult> {
  const { sessionId, buffer, originalFilename, mimeType } = params;
  const fileHash = sha256Hex(buffer);

  const existingDoc = await models.Document.findOne({
    where: { sessionId, fileHash },
    include: [
      {
        model: models.ExtractionCache,
        as: "cache",
        required: true,
        attributes: [
          "status",
          "extraction",
          "complianceIssues",
          "errorMessage",
          "documentType",
        ],
      },
    ],
    order: [["createdAt", "ASC"]],
  });

  if (existingDoc) {
    const plain = existingDoc.get({ plain: true }) as {
      id: string;
      sessionId: string;
      fileHash: string;
      originalFilename: string;
      createdAt: Date;
      cache: {
        status: string;
        extraction: unknown;
        complianceIssues: unknown;
        errorMessage: string | null;
        documentType: string | null;
      };
    };

    if (plain.cache.status === "completed" || plain.cache.status === "failed") {
      const dedup: IngestExtractResult = {
        sessionId: plain.sessionId,
        documentId: plain.id,
        fileHash: plain.fileHash,
        cacheStatus: plain.cache.status as "completed" | "failed",
        deduplicated: true,
        extraction: plain.cache.extraction,
        complianceIssues: plain.cache.complianceIssues,
        fileName: plain.originalFilename,
        createdAt: plain.createdAt,
        documentType: plain.cache.documentType,
      };
      if (plain.cache.errorMessage != null) {
        dedup.errorMessage = plain.cache.errorMessage;
      }
      return dedup;
    }
  }

  await saveUpload(fileHash, buffer);

  const outcome = await sequelize.transaction(async (t) => {
    await sequelize.query(
      `INSERT INTO extraction_cache (file_hash, status, updated_at)
       VALUES ($1, 'pending', now())
       ON CONFLICT (file_hash) DO NOTHING`,
      { bind: [fileHash], transaction: t },
    );

    const cache = await models.ExtractionCache.findByPk(fileHash, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!cache) throw new Error("Cache row missing after insert");

    const c = cache.get({ plain: true }) as {
      status: string;
      extraction: unknown;
      complianceIssues: unknown;
      errorMessage: string | null;
      documentType: string | null;
    };

    const doc = await models.Document.create(
      {
        sessionId,
        fileHash,
        originalFilename,
        mimeType,
        byteSize: buffer.byteLength,
      },
      { transaction: t },
    );

    const documentId = doc.get("id") as string;
    const createdAt = doc.get("createdAt") as Date;

    if (c.status === "completed" || c.status === "failed") {
      const result: IngestExtractResult = {
        sessionId,
        documentId,
        fileHash,
        cacheStatus: c.status as "completed" | "failed",
        deduplicated: false,
        extraction: c.extraction,
        complianceIssues: c.complianceIssues,
        fileName: originalFilename,
        createdAt,
        documentType: c.documentType,
      };
      if (c.errorMessage != null) {
        result.errorMessage = c.errorMessage;
      }
      return { kind: "dedup" as const, result };
    }

    let jobId: string | undefined;
    try {
      const job = await models.Job.create(
        {
          kind: "extract",
          fileHash,
          documentId,
          sessionId,
          status: "queued",
        },
        { transaction: t },
      );
      jobId = job.get("id") as string;
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        const existing = await models.Job.findOne({
          where: { fileHash, kind: "extract" },
          order: [["createdAt", "ASC"]],
          transaction: t,
        });
        jobId = existing?.get("id") as string | undefined;
      } else {
        throw e;
      }
    }

    const base: IngestExtractResult = {
      sessionId,
      documentId,
      fileHash,
      cacheStatus: c.status as "pending" | "processing",
      deduplicated: false,
      fileName: originalFilename,
      createdAt,
      documentType: c.documentType,
    };
    return { kind: "process" as const, base, jobId };
  });

  if (outcome.kind === "dedup") {
    return outcome.result;
  }

  const { base, jobId } = outcome;
  const out: IngestExtractResult = { ...base };
  if (jobId !== undefined) {
    out.jobId = jobId;
  }

  if (params.async && out.jobId === undefined) {
    const resolvedJobId = await ensureAsyncJobId({
      sessionId,
      documentId: out.documentId,
      fileHash,
    });
    if (resolvedJobId !== undefined) {
      out.jobId = resolvedJobId;
    }
  }

  if (!params.async) {
    if (jobId) {
      await processExtractJob({
        jobId,
        fileHash,
        mimeType,
      });
    } else {
      await waitForCacheTerminal(fileHash);
    }
    const latest = await models.ExtractionCache.findByPk(fileHash);
    const row = latest?.get({ plain: true }) as
      | {
          status: string;
          extraction: unknown;
          complianceIssues: unknown;
          errorMessage: string | null;
          documentType: string | null;
        }
      | undefined;
    const sync: IngestExtractResult = {
      ...out,
      cacheStatus: (row?.status ??
        out.cacheStatus) as IngestExtractResult["cacheStatus"],
      extraction: row?.extraction,
      complianceIssues: row?.complianceIssues,
    };
    if (row?.documentType !== undefined) {
      sync.documentType = row.documentType;
    } else if (out.documentType !== undefined) {
      sync.documentType = out.documentType;
    }
    if (row?.errorMessage != null) {
      sync.errorMessage = row.errorMessage;
    }
    return sync;
  }

  return out;
}

async function ensureAsyncJobId(params: {
  sessionId: string;
  documentId: string;
  fileHash: string;
}): Promise<string | undefined> {
  const { sessionId, documentId, fileHash } = params;

  const active = await models.Job.findOne({
    where: {
      kind: "extract",
      fileHash,
      status: { [Op.in]: ["queued", "running"] },
    },
    order: [["createdAt", "DESC"]],
    attributes: ["id"],
  });
  if (active) {
    return active.get("id") as string;
  }

  try {
    const job = await models.Job.create({
      kind: "extract",
      fileHash,
      documentId,
      sessionId,
      status: "queued",
    });
    return job.get("id") as string;
  } catch (e: unknown) {
    if (!isUniqueViolation(e)) {
      throw e;
    }
    const retried = await models.Job.findOne({
      where: {
        kind: "extract",
        fileHash,
        status: { [Op.in]: ["queued", "running"] },
      },
      order: [["createdAt", "DESC"]],
      attributes: ["id"],
    });
    return retried?.get("id") as string | undefined;
  }
}

async function waitForCacheTerminal(fileHash: string): Promise<void> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const r = await models.ExtractionCache.findByPk(fileHash, {
      attributes: ["status"],
    });
    const s = r?.get("status") as string | undefined;
    if (s === "completed" || s === "failed") return;
    await new Promise((res) => setTimeout(res, 400));
  }
  throw new Error("Timed out waiting for duplicate extraction job");
}
