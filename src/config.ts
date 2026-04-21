import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqBaseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  groqModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  groqVisionModel:
    process.env.GROQ_VISION_MODEL ??
    "meta-llama/llama-4-scout-17b-16e-instruct",
  uploadsDir: process.env.UPLOADS_DIR ?? "uploads",
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 30_000),
  llmMaxRetries: Number(process.env.LLM_MAX_RETRIES ?? 3),
  workerPollMs: Number(process.env.WORKER_POLL_MS ?? 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 10),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
};

export function assertServerConfig(): void {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!config.groqApiKey) {
    throw new Error("GROQ_API_KEY is required");
  }
}
