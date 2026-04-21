import { models } from "../models/index.js";
import { processSessionValidateJob } from "./sessionValidationRunner.js";

export async function enqueueSessionValidation(params: {
  sessionId: string;
  sync: boolean;
}): Promise<{ jobId: string }> {
  const { sessionId, sync } = params;
  if (sync) {
    const job = await models.Job.create({
      kind: "session_validate",
      sessionId,
      status: "running",
      startedAt: new Date(),
    });
    const jobId = job.get("id") as string;
    await processSessionValidateJob({ jobId, sessionId });
    return { jobId };
  }
  const job = await models.Job.create({
    kind: "session_validate",
    sessionId,
    status: "queued",
  });
  const jobId = job.get("id") as string;
  return { jobId };
}
