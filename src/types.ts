export type ExtractionCacheStatus = "pending" | "processing" | "completed" | "failed";

export type JobKind = "extract" | "session_validate";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface LlmExtractionResult {
  documentType: string;
  structuredData: Record<string, unknown>;
  complianceIssues: Array<{
    code: string;
    severity: "info" | "warning" | "critical";
    message: string;
    reference?: string;
  }>;
}

export interface SessionValidationResult {
  holderProfile: Record<string, unknown>;
  consistencyChecks: Array<Record<string, unknown>>;
  missingDocuments: Array<Record<string, unknown>>;
  expiringDocuments: Array<Record<string, unknown>>;
  medicalFlags: Array<Record<string, unknown>>;
  overallStatus: "APPROVED" | "CONDITIONAL" | "REJECTED";
  overallScore: number;
  summary: string;
  recommendations: string[];
}
