import type { Request, Response } from "express";
import { sequelize } from "../models/index.js";

export function healthHandler() {
  return async (_req: Request, res: Response) => {
    try {
      await sequelize.authenticate();
      res.json({
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(503).json({
        status: "degraded",
        database: "unavailable",
        error: message,
        timestamp: new Date().toISOString(),
      });
    }
  };
}
