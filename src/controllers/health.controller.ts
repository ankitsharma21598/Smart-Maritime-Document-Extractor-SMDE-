import type { Request, Response } from "express";
import { sequelize } from "../models/index.js";
import { config } from "../config.js";

const APP_VERSION = "1.0.0";

export function getHealthController() {
  return async (_req: Request, res: Response) => {
    let database: "OK" | "DOWN" = "OK";
    let llmProvider: "OK" | "DOWN" = "OK";
    const queue: "OK" = "OK";

    try {
      await sequelize.authenticate();
    } catch (e) {
      database = "DOWN";
    }

    if (!config.groqApiKey) {
      llmProvider = "DOWN";
    }

    const overallStatus = database === "OK" && llmProvider === "OK" && queue === "OK" ? "OK" : "DEGRADED";
    const statusCode = overallStatus === "OK" ? 200 : 503;

    res.status(statusCode).json({
      status: overallStatus,
      version: APP_VERSION,
      uptime: Math.floor(process.uptime()),
      dependencies: {
        database,
        llmProvider,
        queue,
      },
      timestamp: new Date().toISOString(),
    });
  };
}
