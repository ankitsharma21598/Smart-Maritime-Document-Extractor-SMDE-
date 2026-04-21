import { config } from "../config.js";
import type { LlmExtractionResult, SessionValidationResult } from "../types.js";

const LLM_TIMEOUT_MS = 30_000;

export class LlmTimeoutError extends Error {
  constructor(message = "LLM request timed out after 30 seconds.") {
    super(message);
    this.name = "LlmTimeoutError";
  }
}

export class LlmJsonParseError extends Error {
  rawResponse: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = "LlmJsonParseError";
    this.rawResponse = rawResponse;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/m.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export function parseLlmJson<T>(raw: string): T {
  const slice = extractJsonObject(raw);
  try {
    return JSON.parse(slice) as T;
  } catch {
    throw new Error(`LLM returned invalid JSON: ${slice.slice(0, 400)}`);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new LlmTimeoutError();
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function callChatCompletionJson(params: {
  system: string;
  userParts: Array<
    | { type: "text"; text: string }
    | {
        type: "image_url";
        image_url: { url: string; detail?: "low" | "high" | "auto" };
      }
  >;
  model?: string;
}): Promise<string> {
  const usesImage = params.userParts.some((p) => p.type === "image_url");
  const model =
    params.model ?? (usesImage ? config.groqVisionModel : config.groqModel);
  const url = `${config.groqBaseUrl}/chat/completions`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < config.llmMaxRetries; attempt++) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.groqApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: params.system },
              {
                role: "user",
                content: params.userParts,
              },
            ],
          }),
        },
        LLM_TIMEOUT_MS,
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 500)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty completion content");
      return content;
    } catch (e) {
      lastErr = e;
      const backoff = 400 * 2 ** attempt + Math.floor(Math.random() * 200);
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const EXTRACTION_SYSTEM = `You are an expert maritime document analyst with deep knowledge of STCW, MARINA, IMO, and international seafarer certification standards.

A document has been provided. Perform the following in a single pass:
1. IDENTIFY the document type from the taxonomy below
2. DETERMINE if this belongs to a DECK officer, ENGINE officer, BOTH, or is role-agnostic (N/A)
3. EXTRACT all fields that are meaningful for this specific document type
4. FLAG any compliance issues, anomalies, or concerns

Document type taxonomy (use these exact codes):
COC | COP_BT | COP_PSCRB | COP_AFF | COP_MEFA | COP_MECA | COP_SSO | COP_SDSD |
ECDIS_GENERIC | ECDIS_TYPE | SIRB | PASSPORT | PEME | DRUG_TEST | YELLOW_FEVER |
ERM | MARPOL | SULPHUR_CAP | BALLAST_WATER | HATCH_COVER | BRM_SSBT |
TRAIN_TRAINER | HAZMAT | FLAG_STATE | OTHER

Return ONLY a valid JSON object. No markdown. No code fences. No preamble.

{
  "detection": {
    "documentType": "SHORT_CODE",
    "documentName": "Full human-readable document name",
    "category": "IDENTITY | CERTIFICATION | STCW_ENDORSEMENT | MEDICAL | TRAINING | FLAG_STATE | OTHER",
    "applicableRole": "DECK | ENGINE | BOTH | N/A",
    "isRequired": true,
    "confidence": "HIGH | MEDIUM | LOW",
    "detectionReason": "One sentence explaining how you identified this document"
  },
  "holder": {
    "fullName": "string or null",
    "dateOfBirth": "DD/MM/YYYY or null",
    "nationality": "string or null",
    "passportNumber": "string or null",
    "sirbNumber": "string or null",
    "rank": "string or null",
    "photo": "PRESENT | ABSENT"
  },
  "fields": [
    {
      "key": "snake_case_key",
      "label": "Human-readable label",
      "value": "extracted value as string",
      "importance": "CRITICAL | HIGH | MEDIUM | LOW",
      "status": "OK | EXPIRED | WARNING | MISSING | N/A"
    }
  ],
  "validity": {
    "dateOfIssue": "string or null",
    "dateOfExpiry": "string | 'No Expiry' | 'Lifetime' | null",
    "isExpired": false,
    "daysUntilExpiry": null,
    "revalidationRequired": null
  },
  "compliance": {
    "issuingAuthority": "string",
    "regulationReference": "e.g. STCW Reg VI/1 or null",
    "imoModelCourse": "e.g. IMO 1.22 or null",
    "recognizedAuthority": true,
    "limitations": "string or null"
  },
  "medicalData": {
    "fitnessResult": "FIT | UNFIT | N/A",
    "drugTestResult": "NEGATIVE | POSITIVE | N/A",
    "restrictions": "string or null",
    "specialNotes": "string or null",
    "expiryDate": "string or null"
  },
  "flags": [
    {
      "severity": "CRITICAL | HIGH | MEDIUM | LOW",
      "message": "Description of issue or concern"
    }
  ],
  "summary": "Two-sentence plain English summary of what this document confirms about the holder."
}`;

const EXTRACTION_REPAIR_SYSTEM = `You repair malformed JSON output.
Return ONLY one valid JSON object.
No markdown, no comments, no explanations, no code fences.`;

type ExtractionPayload = {
  detection?: {
    documentType?: string;
    confidence?: string;
  };
  flags?: Array<{
    severity?: string;
    message?: string;
  }>;
} & Record<string, unknown>;

const CONFIDENCE_SCORE: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

function mapExtractionPayload(payload: ExtractionPayload): LlmExtractionResult {
  const flags = Array.isArray(payload.flags) ? payload.flags : [];
  return {
    documentType: payload.detection?.documentType ?? "OTHER",
    structuredData: payload,
    complianceIssues: flags.map((f) => ({
      code: "DOCUMENT_FLAG",
      severity:
        String(f.severity ?? "").toUpperCase() === "CRITICAL"
          ? "critical"
          : String(f.severity ?? "").toUpperCase() === "HIGH" ||
              String(f.severity ?? "").toUpperCase() === "MEDIUM"
            ? "warning"
            : "info",
      message: String(f.message ?? "Flagged issue"),
    })),
  };
}

function readConfidence(payload: ExtractionPayload): "LOW" | "MEDIUM" | "HIGH" {
  const raw = String(payload.detection?.confidence ?? "LOW").toUpperCase();
  if (raw === "HIGH" || raw === "MEDIUM") return raw;
  return "LOW";
}

async function parseWithRepair(
  raw: string,
): Promise<{ parsed: ExtractionPayload; repairedRaw?: string }> {
  try {
    return { parsed: parseLlmJson<ExtractionPayload>(raw) };
  } catch {
    const repairedRaw = await callChatCompletionJson({
      system: EXTRACTION_REPAIR_SYSTEM,
      userParts: [
        {
          type: "text",
          text: `Fix this and return only valid JSON:\n\n${raw.slice(0, 120_000)}`,
        },
      ],
    });
    try {
      return { parsed: parseLlmJson<ExtractionPayload>(repairedRaw), repairedRaw };
    } catch {
      throw new LlmJsonParseError(
        "LLM returned invalid JSON after repair attempt.",
        `${raw}\n\n---REPAIR_ATTEMPT---\n${repairedRaw}`,
      );
    }
  }
}

export async function extractFromContent(params: {
  text?: string;
  imageBase64?: { mime: string; b64: string };
  fileName?: string;
  mimeType?: string;
}): Promise<{ result: LlmExtractionResult; rawLlmResponse: string }> {
  const parts: Array<
    | { type: "text"; text: string }
    | {
        type: "image_url";
        image_url: { url: string; detail?: "low" | "high" | "auto" };
      }
  > = [];
  if (params.text?.trim()) {
    parts.push({
      type: "text",
      text: `Document text:\n${params.text.slice(0, 120_000)}`,
    });
  }
  if (params.imageBase64) {
    const url = `data:${params.imageBase64.mime};base64,${params.imageBase64.b64}`;
    parts.push({
      type: "image_url",
      image_url: { url, detail: "high" },
    });
  }
  if (parts.length === 0) {
    throw new Error(
      "No content to send to the model (empty PDF text and no image).",
    );
  }
  const rawPrimary = await callChatCompletionJson({
    system: EXTRACTION_SYSTEM,
    userParts: parts,
  });

  const first = await parseWithRepair(rawPrimary);
  let bestParsed = first.parsed;
  let bestConfidence = readConfidence(bestParsed);
  let rawBundle = first.repairedRaw
    ? `${rawPrimary}\n\n---REPAIRED---\n${first.repairedRaw}`
    : rawPrimary;

  if (bestConfidence === "LOW") {
    const retryHint = `Focused retry. File name: ${params.fileName ?? "unknown"}. MIME type: ${
      params.mimeType ?? "unknown"
    }.
Increase confidence in detection and field extraction while preserving factual integrity.`;
    const retryRaw = await callChatCompletionJson({
      system: EXTRACTION_SYSTEM,
      userParts: [{ type: "text", text: retryHint }, ...parts],
    });
    const retry = await parseWithRepair(retryRaw);
    const retryConfidence = readConfidence(retry.parsed);

    rawBundle += retry.repairedRaw
      ? `\n\n---LOW_CONFIDENCE_RETRY---\n${retryRaw}\n\n---LOW_CONFIDENCE_RETRY_REPAIRED---\n${retry.repairedRaw}`
      : `\n\n---LOW_CONFIDENCE_RETRY---\n${retryRaw}`;

    if (
      (CONFIDENCE_SCORE[retryConfidence] ?? 0) >
      (CONFIDENCE_SCORE[bestConfidence] ?? 0)
    ) {
      bestParsed = retry.parsed;
      bestConfidence = retryConfidence;
    }
  }

  void bestConfidence;
  return { result: mapExtractionPayload(bestParsed), rawLlmResponse: rawBundle };
}

const VALIDATION_SYSTEM = `You are a maritime crewing compliance analyst reviewing a seafarer candidate packet.
Given heterogeneous extracted documents, perform cross-document checks and return ONLY one JSON object with this exact structure:
{
  "holderProfile": {
    "fullName": string | null,
    "sirbNumber": string | null,
    "passportNumber": string | null,
    "dateOfBirth": string | null,
    "nationality": string | null,
    "detectedRole": string | null
  },
  "consistencyChecks": [
    {
      "check": string,
      "status": "PASS" | "WARN" | "FAIL",
      "details": string,
      "documents": string[]
    }
  ],
  "missingDocuments": [
    {
      "documentType": string,
      "reason": string,
      "severity": "LOW" | "MEDIUM" | "HIGH"
    }
  ],
  "expiringDocuments": [
    {
      "documentType": string,
      "documentId": string | null,
      "dateOfExpiry": string | null,
      "daysUntilExpiry": number | null,
      "severity": "LOW" | "MEDIUM" | "HIGH"
    }
  ],
  "medicalFlags": [
    {
      "flag": string,
      "severity": "LOW" | "MEDIUM" | "HIGH",
      "notes": string
    }
  ],
  "overallStatus": "APPROVED" | "CONDITIONAL" | "REJECTED",
  "overallScore": number,
  "summary": string,
  "recommendations": string[]
}

Rules:
- Penalize hard inconsistencies in identity fields across docs.
- Mark REJECTED for severe compliance risks, failed required checks, or disqualifying medical findings.
- Mark CONDITIONAL when acceptable with follow-ups/expiring docs/missing non-critical docs.
- Keep recommendations actionable for a manning agent.`;

export async function validateSessionDocuments(input: {
  documents: Array<{
    id: string;
    filename: string;
    documentType: string | null;
    extraction: Record<string, unknown> | null;
  }>;
}): Promise<SessionValidationResult> {
  const raw = await callChatCompletionJson({
    system: VALIDATION_SYSTEM,
    userParts: [
      {
        type: "text",
        text: `Session documents (JSON):\n${JSON.stringify(input.documents).slice(0, 120_000)}`,
      },
    ],
  });
  const parsed = parseLlmJson<SessionValidationResult>(raw);
  return {
    holderProfile:
      parsed.holderProfile && typeof parsed.holderProfile === "object"
        ? parsed.holderProfile
        : {},
    consistencyChecks: Array.isArray(parsed.consistencyChecks)
      ? parsed.consistencyChecks
      : [],
    missingDocuments: Array.isArray(parsed.missingDocuments)
      ? parsed.missingDocuments
      : [],
    expiringDocuments: Array.isArray(parsed.expiringDocuments)
      ? parsed.expiringDocuments
      : [],
    medicalFlags: Array.isArray(parsed.medicalFlags) ? parsed.medicalFlags : [],
    overallStatus:
      parsed.overallStatus === "APPROVED" ||
      parsed.overallStatus === "CONDITIONAL" ||
      parsed.overallStatus === "REJECTED"
        ? parsed.overallStatus
        : "CONDITIONAL",
    overallScore:
      typeof parsed.overallScore === "number"
        ? Math.max(0, Math.min(100, Math.round(parsed.overallScore)))
        : 50,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations
      : [],
  };
}
