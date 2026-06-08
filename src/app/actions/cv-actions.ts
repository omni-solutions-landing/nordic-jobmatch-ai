"use server";

/**
 * CV Actions — Server Action pipeline
 *
 * Functional programming implementation of the CV ingestion lifecycle:
 * Validation -> Auth -> Read -> Parse -> Embed -> Store.
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
import type { Json } from "@/lib/database.types";
import { Result, ok, fail } from "@/lib/fp/result";
import { ProfileId } from "@/lib/fp/branded";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["application/pdf"] as const;

// ─── Result Types ────────────────────────────────────────────────────────────

interface PipelineSuccess {
  readonly success: true;
  readonly data: {
    readonly structuredData: CvStructuredData;
    readonly confidence: number;
    readonly ambiguousSections: string[];
    readonly qualityNotes: string;
    readonly cvProfileId: string;
    readonly fileName: string;
  };
  readonly timing: {
    readonly parseMs: number;
    readonly embedMs: number;
    readonly storeMs: number;
    readonly totalMs: number;
  };
}

interface PipelineFailure {
  readonly success: false;
  readonly error: {
    readonly step: "validation" | "parse" | "embed" | "store" | "auth";
    readonly code: string;
    readonly message: string;
  };
}

export type CvPipelineResult = PipelineSuccess | PipelineFailure;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Pipeline Functions ──────────────────────────────────────────────────────

function validateFile(formData: FormData): Result<File, PipelineFailure["error"]> {
  const file = formData.get("cv");

  if (!file || !(file instanceof File)) {
    return fail({
      step: "validation",
      code: "NO_FILE",
      message: "No CV file was uploaded. Please select a PDF file.",
    });
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type as typeof ALLOWED_MIME_TYPES[number])) {
    return fail({
      step: "validation",
      code: "INVALID_FILE_TYPE",
      message: `Invalid file type: "${file.type}". Only PDF files are accepted.`,
    });
  }

  if (file.size === 0) {
    return fail({
      step: "validation",
      code: "EMPTY_FILE",
      message: "The uploaded file is empty.",
    });
  }

  if (file.size > MAX_FILE_SIZE) {
    return fail({
      step: "validation",
      code: "FILE_TOO_LARGE",
      message: `File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds the 4MB limit.`,
    });
  }

  return ok(file);
}

async function verifyAuth(
  profileId: ProfileId,
): Promise<Result<void, PipelineFailure["error"]>> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return fail({
      step: "auth",
      code: "UNAUTHENTICATED",
      message: "You must be signed in to upload a CV.",
    });
  }

  if (user.id !== profileId) {
    return fail({
      step: "auth",
      code: "FORBIDDEN",
      message: "You can only upload a CV for your own profile.",
    });
  }

  return ok(undefined);
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

export async function uploadAndProcessCv(
  formData: FormData,
  profileId: string,
): Promise<CvPipelineResult> {
  const pipelineStart = performance.now();
  const brandedProfileId = profileId as ProfileId;

  // 1. File Validation
  const fileResult = validateFile(formData);
  if (!fileResult.success) {
    return { success: false, error: fileResult.error };
  }
  const file = fileResult.value;
  const fileName = file.name;

  // 2. Auth Check
  const authResult = await verifyAuth(brandedProfileId);
  if (!authResult.success) {
    return { success: false, error: authResult.error };
  }

  // 3. Read Buffer
  const arrayBuffer = await file.arrayBuffer();
  const pdfBuffer = Buffer.from(arrayBuffer);

  // 4. Parse CV
  const parseStart = performance.now();
  let parseResult: CvParseResult;
  try {
    parseResult = await parseCvWithRetry(pdfBuffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CV parsing failed.";
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

  // 5. Generate Embedding
  const embedStart = performance.now();
  const embeddingText = stringifyCvForEmbedding(parseResult.data);
  let embedding: number[];
  try {
    embedding = await generateEmbedding(embeddingText, { taskType: "query" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Embedding generation failed.";
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

  // 6. Store in Supabase
  const storeStart = performance.now();
  const supabase = await createServerClient();
  const rpcArgs = {
    p_profile_id: brandedProfileId,
    p_filename: fileName,
    p_raw_text: parseResult.rawJson,
    p_structured_data: JSON.parse(JSON.stringify(parseResult.data)) as Json,
    p_skills_embedding: vectorToString(embedding),
  };

  const { data: cvProfileId, error: rpcError } = await supabase.rpc(
    "create_cv_profile",
    // @ts-expect-error create_cv_profile type fallback
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

  // 7. Success
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
      ambiguousSections: parseResult.data.extraction_metadata.ambiguous_sections,
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
 */
export async function activateCvAction(
  cvId: string,
): Promise<{ readonly success: boolean; readonly error?: string }> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
export async function deleteCvAction(
  cvId: string,
): Promise<{ readonly success: boolean; readonly error?: string }> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
