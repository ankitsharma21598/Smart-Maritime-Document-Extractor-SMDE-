import { QueryTypes } from "sequelize";
import { sequelize, models } from "../models/index.js";
import { processExtractJob } from "./extractionRunner.js";
import { processSessionValidateJob } from "./sessionValidationRunner.js";
import { config } from "../config.js";

let timer: ReturnType<typeof setInterval> | undefined;

export function startJobWorker(): void {
  if (timer) return;
  const tick = () => {
    void runOne().catch((e) => {
      console.error("[worker]", e);
    });
  };
  timer = setInterval(tick, config.workerPollMs);
  void tick();
}

export function stopJobWorker(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

type JobRow = {
  id: string;
  kind: string;
  file_hash: string | null;
  document_id: string | null;
  session_id: string | null;
};

async function claimNextJob(): Promise<JobRow | null> {
  return sequelize.transaction(async (t) => {
    const rows = await sequelize.query<JobRow>(
      `SELECT id, kind, file_hash, document_id, session_id
       FROM jobs
       WHERE status = 'queued'
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      { transaction: t, type: QueryTypes.SELECT }
    );
    const row = rows[0];
    if (!row) return null;
    await models.Job.update(
      { status: "running", startedAt: new Date() },
      { where: { id: row.id }, transaction: t }
    );
    return row;
  });
}

async function runOne(): Promise<void> {
  const row = await claimNextJob();
  if (!row) return;

  try {
    if (row.kind === "extract" && row.file_hash && row.document_id) {
      const doc = await models.Document.findByPk(row.document_id, {
        attributes: ["mimeType"],
      });
      const mt = doc?.get("mimeType") as string | undefined;
      if (!mt) throw new Error("Document missing mime_type");
      await processExtractJob({
        jobId: row.id,
        fileHash: row.file_hash,
        mimeType: mt,
      });
    } else if (row.kind === "session_validate" && row.session_id) {
      await processSessionValidateJob({
        jobId: row.id,
        sessionId: row.session_id,
      });
    } else {
      throw new Error(`Invalid job payload: ${JSON.stringify(row)}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await models.Job.update(
      {
        status: "failed",
        completedAt: new Date(),
        errorMessage: msg,
      },
      { where: { id: row.id } }
    ).catch(() => {});
  }
}
