import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { config } from "./config.js";
import { getHealthController } from "./controllers/health.controller.js";
import { postExtractController } from "./controllers/extract.controller.js";
import { getJobByIdController } from "./controllers/jobs.controller.js";
import {
  getSessionByIdController,
  postSessionValidateController,
  getSessionReportController,
} from "./controllers/sessions.controller.js";
import { sendApiError } from "./utils/apiError.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export function createApp(): express.Express {
  const app = express();

  app.use(cors());
  app.get("/health", getHealthController());
  app.get("/api/health", getHealthController());

  const extractLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const rl = (req as { rateLimit?: { resetTime?: Date } }).rateLimit;
      const resetMs = rl?.resetTime
        ? Math.max(0, rl.resetTime.getTime() - Date.now())
        : 60_000;
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil(resetMs / 1000))),
      );
      sendApiError(
        res,
        429,
        "RATE_LIMITED",
        "Too many requests — see rate limiting section.",
        { retryAfterMs: resetMs },
      );
    },
  });

  app.post(
    "/api/extract",
    extractLimiter,
    upload.single("document"),
    postExtractController(),
  );
  app.get("/api/jobs/:id", getJobByIdController());
  app.get("/api/sessions/:id", getSessionByIdController());
  app.post("/api/sessions/:id/validate", postSessionValidateController());
  app.get("/api/sessions/:id/report", getSessionReportController());

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        sendApiError(res, 413, "FILE_TOO_LARGE", "File exceeds 10MB.");
        return;
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Unexpected server error.");
    },
  );

  return app;
}
