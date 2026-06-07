/**
 * Embeddings — Public API barrel export
 */

export {
  generateEmbedding,
  generateEmbeddingsBatch,
  EmbeddingError,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  MAX_BATCH_SIZE,
} from "./generator";
export type { EmbeddingOptions, EmbeddingTaskType } from "./generator";

export {
  stringifyCvForEmbedding,
  stringifyJobForEmbedding,
} from "./stringifiers";
export type { RawJobData } from "./stringifiers";
