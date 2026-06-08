"use server";

/**
 * CV Actions — Server Action pipeline
 *
 * Orchestrates the full CV ingestion lifecycle:
 *   FormData (PDF) → parseCv (multimodal) → stringifyCvForEmbedding → generateEmbedding → upsert via RPC
 *
 * This is a "succeed all or write nothing" pipeline: the database is only
 * touched after ALL AI steps complete successfully. If any step fails,
 * no partial data is written.
 *
 * The PDF is sent directly to Gemini via inlineData — no client-side text
 * extraction needed. Gemini reads the PDF natively, preserving layout,
 * tables, and formatting.
 *
 * @module Server Action — runs exclusively on the server.
 */

import { parseCvWithRetry, type CvParseResult } from "@/lib/ai/cv-parser";
import {
  generateEmbedding,
  stringifyCvForEmbedding,
} from "@/lib/ai/embeddings";
import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { CvStructuredData } from "@/lib/ai/cv-parser/schema";
import type { Database, Json } from "@/lib/database.types";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum PDF file size in bytes (4 MB). */
const MAX_FILE_SIZE = 4 * 1024 * 1024;

const ALLOWED_MIME_TYPES = ["application/pdf"] as const;

// ─── Result Types ────────────────────────────────────────────────────────────

interface PipelineSuccess {
  success: true;
  data: {
    /** Validated structured CV data */
    structuredData: CvStructuredData;
    /** Parser confidence score [0.0–1.0] */
    confidence: number;
    /** Sections the parser flagged as ambiguous */
    ambiguousSections: string[];
    /** CV quality notes from the parser */
    qualityNotes: string;
    /** UUID of the cv_profiles row */
    cvProfileId: string;
    /** Original filename */
    fileName: string;
  };
  timing: {
    /** Gemini parsing latency in ms */
    parseMs: number;
    /** Embedding generation latency in ms */
    embedMs: number;
    /** Supabase RPC upsert latency in ms */
    storeMs: number;
    /** Total pipeline latency in ms */
    totalMs: number;
  };
}

interface PipelineFailure {
  success: false;
  error: {
    /** Which pipeline step failed */
    step: "validation" | "parse" | "embed" | "store" | "auth";
    /** Error code from the underlying module */
    code: string;
    /** Human-readable error message */
    message: string;
  };
}

export type CvPipelineResult = PipelineSuccess | PipelineFailure;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Formats a vector as a pgvector-compatible string literal.
 */
function vectorToString(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function logStep(
  step: string,
  durationMs: number,
  details?: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      event: "cv_pipeline",
      step,
      duration_ms: durationMs,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

/**
 * Processes a PDF CV upload through the full AI pipeline and stores results.
 *
 * Pipeline:
 *   1. **Validate** — Check file exists, is PDF, is under 4MB
 *   2. **Auth** — Verify the caller owns the profile
 *   3. **Parse** — Gemini multimodal PDF → structured JSON (42-field schema)
 *   4. **Stringify** — Flatten to embedding-optimized text (bilingual anchors)
 *   5. **Embed** — Generate 768-d vector via text-embedding-004
 *   6. **Store** — Atomic upsert via `upsert_cv_profile` RPC
 *
 * The database write only occurs after all AI steps succeed.
 *
 * @param formData - FormData containing a "cv" field with the PDF file.
 * @param profileId - UUID of the authenticated user (must match auth.uid()).
 * @returns Pipeline result with structured data, timing, or error details.
 *
 * @example
 * ```tsx
 * // In a Client Component:
 * const formData = new FormData();
 * formData.append("cv", pdfFile);
 * const result = await uploadAndProcessCv(formData, user.id);
 *
 * if (result.success) {
 *   console.log("Confidence:", result.data.confidence);
 *   console.log("Parse time:", result.timing.parseMs, "ms");
 * } else {
 *   console.error(`Failed at ${result.error.step}: ${result.error.message}`);
 * }
 * ```
 */
export async function uploadAndProcessCv(
  formData: FormData,
  profileId: string,
): Promise<CvPipelineResult> {
  const pipelineStart = performance.now();

  // ── 0. File validation ────────────────────────────────────────────────────

  const file = formData.get("cv");

  if (!file || !(file instanceof File)) {
    return {
      success: false,
      error: {
        step: "validation",
        code: "NO_FILE",
        message: "No CV file was uploaded. Please select a PDF file.",
      },
    };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type as typeof ALLOWED_MIME_TYPES[number])) {
    return {
      success: false,
      error: {
        step: "validation",
        code: "INVALID_FILE_TYPE",
        message: `Invalid file type: "${file.type}". Only PDF files are accepted.`,
      },
    };
  }

  if (file.size === 0) {
    return {
      success: false,
      error: {
        step: "validation",
        code: "EMPTY_FILE",
        message: "The uploaded file is empty.",
      },
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      success: false,
      error: {
        step: "validation",
        code: "FILE_TOO_LARGE",
        message: `File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds the 4MB limit.`,
      },
    };
  }

  const fileName = file.name;

  // ── 1. Auth check ────────────────────────────────────────────────────────

  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: {
        step: "auth",
        code: "UNAUTHENTICATED",
        message: "You must be signed in to upload a CV.",
      },
    };
  }

  if (user.id !== profileId) {
    return {
      success: false,
      error: {
        step: "auth",
        code: "FORBIDDEN",
        message: "You can only upload a CV for your own profile.",
      },
    };
  }

  // ── 2. Convert File to Buffer ────────────────────────────────────────────

  const arrayBuffer = await file.arrayBuffer();
  const pdfBuffer = Buffer.from(arrayBuffer);

  // ── 3. Parse CV (Gemini multimodal PDF) ──────────────────────────────────

  let parseResult: CvParseResult;
  const parseStart = performance.now();

  try {
    parseResult = await parseCvWithRetry(pdfBuffer);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "CV parsing failed.";
    const code =
      error instanceof Error && "code" in error
        ? String((error as Record<string, unknown>).code)
        : "PARSE_ERROR";

    logStep("parse", Math.round(performance.now() - parseStart), {
      status: "error",
      code,
      file_name: fileName,
      file_size: file.size,
    });

    return {
      success: false,
      error: { step: "parse", code, message },
    };
  }

  const parseMs = Math.round(performance.now() - parseStart);
  logStep("parse", parseMs, {
    status: "ok",
    model: parseResult.model,
    file_name: fileName,
    file_size: file.size,
    pdf_size_bytes: parseResult.pdfSizeBytes,
    confidence: parseResult.data.extraction_metadata.overall_confidence,
    ambiguous_sections: parseResult.data.extraction_metadata.ambiguous_sections,
  });

  // ── 4. Stringify for embedding ───────────────────────────────────────────

  const embeddingText = stringifyCvForEmbedding(parseResult.data);

  // ── 5. Generate embedding ────────────────────────────────────────────────

  let embedding: number[];
  const embedStart = performance.now();

  try {
    embedding = await generateEmbedding(embeddingText, {
      taskType: "query",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Embedding generation failed.";
    const code =
      error instanceof Error && "code" in error
        ? String((error as Record<string, unknown>).code)
        : "EMBEDDING_ERROR";

    logStep("embed", Math.round(performance.now() - embedStart), {
      status: "error",
      code,
      text_length: embeddingText.length,
    });

    return {
      success: false,
      error: { step: "embed", code, message },
    };
  }

  const embedMs = Math.round(performance.now() - embedStart);
  logStep("embed", embedMs, {
    status: "ok",
    text_length: embeddingText.length,
    dimensions: embedding.length,
  });

  // ── 6. Store in Supabase via RPC ─────────────────────────────────────────

  const storeStart = performance.now();

  const rpcArgs = {
    p_profile_id: profileId,
    p_filename: fileName,
    p_raw_text: parseResult.rawJson,
    p_structured_data: JSON.parse(JSON.stringify(parseResult.data)) as Json,
    p_skills_embedding: vectorToString(embedding),
  };

  const { data: cvProfileId, error: rpcError } = await supabase.rpc(
    "create_cv_profile",
    // @ts-expect-error new create_cv_profile RPC is not yet in database.types.ts
    rpcArgs,
  );

  const storeMs = Math.round(performance.now() - storeStart);

  if (rpcError) {
    logStep("store", storeMs, {
      status: "error",
      code: rpcError.code,
      message: rpcError.message,
    });

    return {
      success: false,
      error: {
        step: "store",
        code: rpcError.code ?? "DB_ERROR",
        message: rpcError.message,
      },
    };
  }

  logStep("store", storeMs, { status: "ok", cv_profile_id: cvProfileId });

  // ── 7. Return success ───────────────────────────────────────────────────

  const totalMs = Math.round(performance.now() - pipelineStart);

  logStep("complete", totalMs, {
    status: "ok",
    file_name: fileName,
    parse_ms: parseMs,
    embed_ms: embedMs,
    store_ms: storeMs,
  });

  return {
    success: true,
    data: {
      structuredData: parseResult.data,
      confidence: parseResult.data.extraction_metadata.overall_confidence,
      ambiguousSections:
        parseResult.data.extraction_metadata.ambiguous_sections,
      qualityNotes: parseResult.data.extraction_metadata.cv_quality_notes,
      cvProfileId: cvProfileId ?? "",
      fileName,
    },
    timing: {
      parseMs,
      embedMs,
      storeMs,
      totalMs,
    },
  };
}

/**
 * Activates a specific CV profile for the authenticated user.
 * Deactivates all other CVs via DB trigger automatically.
 */
export async function activateCvAction(cvId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Inte inloggad." };
  }

  const { error } = await (supabase.from("cv_profiles") as any)
    .update({ is_active: true })
    .eq("id", cvId)
    .eq("profile_id", user.id);

  if (error) {
    console.error("Error activating CV:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/profile");
  revalidatePath("/matches");
  return { success: true };
}

/**
 * Deletes a specific CV profile for the authenticated user.
 */
export async function deleteCvAction(cvId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Inte inloggad." };
  }

  const { error } = await (supabase.from("cv_profiles") as any)
    .delete()
    .eq("id", cvId)
    .eq("profile_id", user.id);

  if (error) {
    console.error("Error deleting CV:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/profile");
  revalidatePath("/matches");
  return { success: true };
}
