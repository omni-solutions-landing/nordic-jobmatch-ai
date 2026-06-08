-- ============================================================================
-- Nordic JobMatch AI — Migration: Keyword-Filtered Semantic Job Matching RPC
-- Version:  00007
-- Date:     2026-06-08
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_jobs_with_keywords(
  query_embedding VECTOR(768),
  match_keywords  TEXT[],
  match_threshold FLOAT8 DEFAULT 0.5,
  match_count     INT    DEFAULT 20,
  filter_country  public.nordic_country DEFAULT NULL
)
RETURNS TABLE (
  id              UUID,
  title           TEXT,
  company         TEXT,
  country         public.nordic_country,
  location        TEXT,
  source_url      TEXT,
  similarity      FLOAT8
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    jp.id,
    jp.title,
    jp.company,
    jp.country,
    jp.location,
    jp.source_url,
    1 - (jp.job_embedding <=> query_embedding) AS similarity
  FROM public.job_postings jp
  WHERE
    jp.job_embedding IS NOT NULL
    AND (filter_country IS NULL OR jp.country = filter_country)
    AND 1 - (jp.job_embedding <=> query_embedding) >= match_threshold
    AND (jp.expires_at IS NULL OR jp.expires_at > now())
    AND (
      cardinality(match_keywords) = 0 OR
      EXISTS (
        SELECT 1 FROM unnest(match_keywords) kw
        WHERE jp.title ILIKE '%' || kw || '%' OR jp.description ILIKE '%' || kw || '%'
      )
    )
  ORDER BY jp.job_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION public.match_jobs_with_keywords IS 'Filtered semantic search: returns top-N jobs by cosine similarity that contain any of the specified keywords, with optional country filter and expiry check.';

GRANT EXECUTE ON FUNCTION public.match_jobs_with_keywords TO authenticated;
