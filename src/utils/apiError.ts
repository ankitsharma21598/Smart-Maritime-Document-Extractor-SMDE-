import type { Response } from "express";

export type ApiErrorCode =
  | "UNSUPPORTED_FORMAT"
  | "INSUFFICIENT_DOCUMENTS"
  | "FILE_TOO_LARGE"
  | "SESSION_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "LLM_JSON_PARSE_FAIL"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ApiErrorOptions {
  extractionId?: string | null;
  retryAfterMs?: number | null;
}

export function sendApiError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  options?: ApiErrorOptions,
): void {
  res.status(status).json({
    error: code,
    message,
    extractionId: options?.extractionId ?? null,
    retryAfterMs: options?.retryAfterMs ?? null,
  });
}
