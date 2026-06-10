/**
 * Embedding Generator — Gemini gemini-embedding-001
 *
 * Generates 768-dimensional vector embeddings for semantic search and matching.
 *
 * MODEL NOTE (2026-06): Google retired text-embedding-004 on 2026-01-14.
 * The stable replacement is gemini-embedding-001, which outputs 3072 dimensions
 * by default but supports Matryoshka truncation via `outputDimensionality`.
 * We request 768 to stay compatible with the VECTOR(768) columns in Supabase.
 * Cosine similarity (used by the match_jobs RPCs) is scale-invariant, so the
 * truncated vectors work without manual re-normalization.
 *
 * ⚠️  If you ever change the embedding model, all stored embeddings
 * (cv_profiles.skills_embedding and job_postings.job_embedding) must be
 * regenerated — vectors from different models are not comparable.
 *
 * Two embedding modes via TaskType:
 *   - RETRIEVAL_DOCUMENT: Used when indexing content (job postings, CVs being stored)
 *   - RETRIEVAL_QUERY:    Used when searching (CV matching against stored jobs)
 *   - SEMANTIC_SIMILARITY: Used for direct pairwise comparison
 *
 * The match_jobs RPC treats job embeddings as "documents" and the CV embedding
 * as a "query", so we embed accordingly.
 */

import {
  GoogleGenerativeAI,
  TaskType,
  type EmbedContentRequest,
} from "@google/generative-ai";

// ─── Configuration ───────────────────────────────────────────────────────────

/** Stable Gemini embedding model. Overridable via GEMINI_EMBEDDING_MODEL. */
const EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

/** Gemini embedding API supports up to 100 texts per batch request. */
const MAX_BATCH_SIZE = 100;

/** Maximum input length per text (characters). gemini-embedding-001 handles ~2048 tokens. */
const MAX_TEXT_LENGTH = 10_000;

const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

// ─── Types ───────────────────────────────────────────────────────────────────

export type EmbeddingTaskType = "document" | "query" | "similarity";

/**
 * SDK 0.24 types lag the REST API: `outputDimensionality` is accepted by the
 * endpoint (Matryoshka truncation) but missing from EmbedContentRequest.
 */
type EmbedContentRequestWithDims = EmbedContentRequest & {
  outputDimensionality?: number;
};

export interface EmbeddingOptions {
  /** API key override (defaults to GEMINI_API_KEY env var) */
  apiKey?: string;
  /** How the embedding will be used — affects internal vector optimization */
  taskType?: EmbeddingTaskType;
  /** Max retry attempts for transient failures */
  maxRetries?: number;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly code: "MISSING_API_KEY" | "API_ERROR" | "INPUT_ERROR",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function resolveTaskType(taskType: EmbeddingTaskType = "document"): TaskType {
  const mapping: Record<EmbeddingTaskType, TaskType> = {
    document: TaskType.RETRIEVAL_DOCUMENT,
    query: TaskType.RETRIEVAL_QUERY,
    similarity: TaskType.SEMANTIC_SIMILARITY,
  };
  return mapping[taskType];
}

function getApiKey(override?: string): string {
  const key = override ?? process.env.GEMINI_API_KEY;
  if (!key) {
    throw new EmbeddingError(
      "GEMINI_API_KEY is not set. Provide it via environment variable or options.apiKey.",
      "MISSING_API_KEY",
    );
  }
  return key;
}

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text;
  // Truncate at word boundary to avoid splitting mid-word
  const truncated = text.slice(0, MAX_TEXT_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > MAX_TEXT_LENGTH * 0.8
    ? truncated.slice(0, lastSpace)
    : truncated;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  operationName: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        // Exponential backoff with jitter
        const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 200;
        await sleep(delay);
        continue;
      }
    }
  }

  throw new EmbeddingError(
    `${operationName} failed after ${maxRetries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    "API_ERROR",
    lastError,
  );
}

// ─── Core: Single Embedding ──────────────────────────────────────────────────

/**
 * Generates a single 768-dimensional embedding vector for the given text.
 *
 * @param text - Input text to embed. Automatically truncated if too long.
 * @param options - API key, task type, and retry configuration.
 * @returns 768-dimensional number array.
 *
 * @example
 * ```ts
 * // Embed a CV for matching against job postings
 * const cvEmbedding = await generateEmbedding(cvText, { taskType: "query" });
 *
 * // Embed a job posting for storage
 * const jobEmbedding = await generateEmbedding(jobText, { taskType: "document" });
 * ```
 */
export async function generateEmbedding(
  text: string,
  options: EmbeddingOptions = {},
): Promise<number[]> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new EmbeddingError(
      "Cannot generate embedding for empty text.",
      "INPUT_ERROR",
    );
  }

  const apiKey = getApiKey(options.apiKey);
  const taskType = resolveTaskType(options.taskType);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const processedText = truncateText(trimmed);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  const request: EmbedContentRequestWithDims = {
    content: { parts: [{ text: processedText }], role: "user" },
    taskType,
    outputDimensionality: EMBEDDING_DIMENSIONS,
  };

  const result = await withRetry(
    async () => {
      const response = await model.embedContent(request);
      return response.embedding.values;
    },
    maxRetries,
    "generateEmbedding",
  );

  if (result.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingError(
      `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${result.length}.`,
      "API_ERROR",
    );
  }

  return result;
}

// ─── Core: Batch Embedding ───────────────────────────────────────────────────

/**
 * Generates embeddings for multiple texts in batched API calls.
 *
 * Automatically chunks the input into groups of up to 100 (Gemini's batch limit)
 * and processes them with retry logic per chunk. Returns embeddings in the same
 * order as the input texts.
 *
 * @param texts - Array of input texts. Empty strings are replaced with
 *                a placeholder to maintain index alignment.
 * @param options - API key, task type, and retry configuration.
 * @returns Array of 768-dimensional vectors, one per input text.
 *
 * @example
 * ```ts
 * const jobTexts = jobs.map(j => stringifyJobForEmbedding(j));
 * const embeddings = await generateEmbeddingsBatch(jobTexts, {
 *   taskType: "document",
 * });
 * // embeddings[i] corresponds to jobTexts[i]
 * ```
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  options: EmbeddingOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = getApiKey(options.apiKey);
  const taskType = resolveTaskType(options.taskType);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  // Prepare all texts (truncate, handle empties)
  const processedTexts = texts.map((t) => {
    const trimmed = t.trim();
    return trimmed.length === 0 ? "[empty]" : truncateText(trimmed);
  });

  // Chunk into batches of MAX_BATCH_SIZE
  const chunks: string[][] = [];
  for (let i = 0; i < processedTexts.length; i += MAX_BATCH_SIZE) {
    chunks.push(processedTexts.slice(i, i + MAX_BATCH_SIZE));
  }

  const allEmbeddings: number[][] = [];

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex]!;

    const requests: EmbedContentRequestWithDims[] = chunk.map((text) => ({
      content: { parts: [{ text }], role: "user" },
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }));

    const chunkEmbeddings = await withRetry(
      async () => {
        const response = await model.batchEmbedContents({
          requests,
        });
        return response.embeddings.map((e) => e.values);
      },
      maxRetries,
      `generateEmbeddingsBatch (chunk ${chunkIndex + 1}/${chunks.length})`,
    );

    allEmbeddings.push(...chunkEmbeddings);

    // Rate limit: small delay between chunks to avoid 429s
    if (chunkIndex < chunks.length - 1) {
      await sleep(100);
    }
  }

  return allEmbeddings;
}

// ─── Export constants for testing / validation ───────────────────────────────

export { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, MAX_BATCH_SIZE };
