/**
 * CV Parser — Main entry point
 *
 * Orchestrates the full CV parsing pipeline using Gemini's native multimodal
 * PDF processing. The PDF is sent directly to Gemini as base64 inlineData,
 * eliminating the need for a separate text extraction step.
 *
 * Pipeline:
 *   1. Accept raw PDF Buffer from the Server Action
 *   2. Encode as base64 and send to Gemini via inlineData
 *   3. Gemini reads the PDF natively (layout, formatting, tables preserved)
 *   4. Structured output mode enforces our 42-field Zod schema
 *   5. Validate the response against the Zod schema
 *   6. Return typed, validated CvStructuredData
 *
 * This module is designed to be called from a Next.js Server Action
 * or Route Handler — never from the client.
 */

import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import {
  CvStructuredDataSchema,
  zodToGeminiSchema,
  type CvStructuredData,
} from "./schema";
import { CV_PARSER_SYSTEM_PROMPT } from "./prompt";

// ─── Configuration ───────────────────────────────────────────────────────────

const GEMINI_MODEL = "gemini-2.5-flash";

/** Maximum PDF file size in bytes (4 MB). */
const MAX_PDF_SIZE_BYTES = 4 * 1024 * 1024;

/** Minimum PDF size — anything smaller is likely corrupt or empty. */
const MIN_PDF_SIZE_BYTES = 100;

/** PDF magic bytes: %PDF */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);

// ─── Error types ─────────────────────────────────────────────────────────────

export class CvParserError extends Error {
  constructor(
    message: string,
    public readonly code: CvParserErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CvParserError";
  }
}

export type CvParserErrorCode =
  | "INVALID_PDF"
  | "FILE_TOO_LARGE"
  | "FILE_TOO_SMALL"
  | "GEMINI_API_ERROR"
  | "SCHEMA_VALIDATION_FAILED"
  | "JSON_PARSE_FAILED"
  | "MISSING_API_KEY";

// ─── Result type ─────────────────────────────────────────────────────────────

export interface CvParseResult {
  /** Validated structured data, ready for DB insertion. */
  data: CvStructuredData;
  /** Raw JSON string from Gemini (useful for debugging). */
  rawJson: string;
  /** Time taken for the Gemini API call in milliseconds. */
  latencyMs: number;
  /** Gemini model that was used. */
  model: string;
  /** Size of the input PDF in bytes. */
  pdfSizeBytes: number;
}

// ─── Main parser function ────────────────────────────────────────────────────

/**
 * Parses a PDF CV using Gemini's native multimodal capabilities.
 *
 * The PDF is sent directly to Gemini as base64-encoded inline data.
 * Gemini reads the document natively, preserving layout, tables, and
 * formatting that text extraction would lose.
 *
 * @param pdfBuffer - Raw PDF file as a Node.js Buffer.
 * @param options - Optional overrides for model and API key.
 * @returns Validated CvParseResult.
 * @throws CvParserError on input validation, API, or schema errors.
 *
 * @example
 * ```ts
 * import { parseCv } from "@/lib/ai/cv-parser/parser";
 *
 * // In a Server Action:
 * const pdfBuffer = Buffer.from(await file.arrayBuffer());
 * const result = await parseCv(pdfBuffer);
 * // result.data is fully typed CvStructuredData
 * ```
 */
export async function parseCv(
  pdfBuffer: Buffer,
  options?: {
    apiKey?: string;
    model?: string;
  },
): Promise<CvParseResult> {
  // ── 1. Input validation ──────────────────────────────────────────────────

  if (pdfBuffer.length < MIN_PDF_SIZE_BYTES) {
    throw new CvParserError(
      `PDF is too small (${pdfBuffer.length} bytes). Minimum is ${MIN_PDF_SIZE_BYTES} bytes.`,
      "FILE_TOO_SMALL",
    );
  }

  if (pdfBuffer.length > MAX_PDF_SIZE_BYTES) {
    throw new CvParserError(
      `PDF exceeds maximum size of ${MAX_PDF_SIZE_BYTES / (1024 * 1024)}MB (received ${(pdfBuffer.length / (1024 * 1024)).toFixed(1)}MB).`,
      "FILE_TOO_LARGE",
    );
  }

  // Verify PDF magic bytes
  if (!pdfBuffer.subarray(0, 4).equals(PDF_MAGIC)) {
    throw new CvParserError(
      "File does not appear to be a valid PDF (missing %PDF header).",
      "INVALID_PDF",
    );
  }

  // ── 2. API key ───────────────────────────────────────────────────────────

  const apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new CvParserError(
      "GEMINI_API_KEY is not set. Provide it via environment variable or options.apiKey.",
      "MISSING_API_KEY",
    );
  }

  // ── 3. Initialize Gemini ─────────────────────────────────────────────────

  const modelName = options?.model ?? GEMINI_MODEL;
  const genAI = new GoogleGenerativeAI(apiKey);

  const generationConfig: GenerationConfig = {
    responseMimeType: "application/json",
    responseSchema: zodToGeminiSchema(CvStructuredDataSchema) as unknown as GenerationConfig["responseSchema"],
    temperature: 0.1,    // Low temperature for deterministic extraction
    topP: 0.95,
    maxOutputTokens: 8192,
  };

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: CV_PARSER_SYSTEM_PROMPT,
    generationConfig,
  });

  // ── 4. Call Gemini with native PDF ───────────────────────────────────────
  // Gemini accepts PDFs natively via inlineData. This preserves document
  // layout, tables, headers, and formatting that text extraction would lose.

  const pdfBase64 = pdfBuffer.toString("base64");
  const startTime = performance.now();

  let rawJson: string;
  try {
    const result = await model.generateContent([
      {
        inlineData: {
          data: pdfBase64,
          mimeType: "application/pdf",
        },
      },
      {
        text: "Parse this CV/resume PDF into structured JSON according to your instructions. Return the structured JSON output now.",
      },
    ]);
    const response = result.response;
    rawJson = response.text();
  } catch (error) {
    throw new CvParserError(
      `Gemini API call failed: ${error instanceof Error ? error.message : String(error)}`,
      "GEMINI_API_ERROR",
      error,
    );
  }

  const latencyMs = Math.round(performance.now() - startTime);

  // ── 5. Parse JSON ────────────────────────────────────────────────────────

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new CvParserError(
      `Gemini returned invalid JSON: ${rawJson.slice(0, 200)}...`,
      "JSON_PARSE_FAILED",
      error,
    );
  }

  // ── 6. Validate against Zod schema ───────────────────────────────────────

  const validation = CvStructuredDataSchema.safeParse(parsed);

  if (!validation.success) {
    const issues = validation.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    throw new CvParserError(
      `Schema validation failed after Gemini extraction:\n${issues}`,
      "SCHEMA_VALIDATION_FAILED",
      validation.error,
    );
  }

  // ── 7. Return validated result ───────────────────────────────────────────

  return {
    data: validation.data,
    rawJson,
    latencyMs,
    model: modelName,
    pdfSizeBytes: pdfBuffer.length,
  };
}

// ─── Convenience: parse with retry ───────────────────────────────────────────

/**
 * Wraps `parseCv` with exponential backoff retry logic.
 * Retries only on transient GEMINI_API_ERROR failures.
 *
 * @param pdfBuffer - Raw PDF file as a Node.js Buffer.
 * @param maxRetries - Maximum retry attempts (default: 3).
 * @returns Validated CvParseResult.
 */
export async function parseCvWithRetry(
  pdfBuffer: Buffer,
  maxRetries = 3,
  options?: {
    apiKey?: string;
    model?: string;
  },
): Promise<CvParseResult> {
  let lastError: CvParserError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await parseCv(pdfBuffer, options);
    } catch (error) {
      if (
        error instanceof CvParserError &&
        error.code === "GEMINI_API_ERROR" &&
        attempt < maxRetries
      ) {
        lastError = error;
        const delayMs = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }

  // Unreachable, but satisfies TypeScript
  throw lastError;
}
