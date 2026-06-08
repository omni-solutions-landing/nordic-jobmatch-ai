-- ============================================================================
-- Nordic JobMatch AI — Migration: Fix match_jobs search path
-- Version:  00006
-- Date:     2026-06-08
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_jobs(
  query_embedding VECTOR(768),
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
  ORDER BY jp.job_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
