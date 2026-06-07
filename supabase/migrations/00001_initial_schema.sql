-- ============================================================================
-- Nordic JobMatch AI — Initial Schema Migration
-- Version:  00001
-- Date:     2026-05-31
-- Requires: Supabase (PostgreSQL 15+)
-- ============================================================================
-- This migration establishes the core data model:
--   1. Extensions (pgvector, moddatetime)
--   2. Custom ENUM types for constrained columns
--   3. Tables: profiles, cv_profiles, job_postings, matches
--   4. HNSW vector indexes for cosine similarity search
--   5. Auto-updating timestamps via moddatetime triggers
--   6. Row Level Security (RLS) policies
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. EXTENSIONS
-- ──────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "vector"    WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "moddatetime" WITH SCHEMA "extensions";

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. ENUM TYPES
-- ──────────────────────────────────────────────────────────────────────────────

-- Nordic country codes (ISO 3166-1 alpha-2)
CREATE TYPE public.nordic_country AS ENUM ('SE', 'NO', 'DK', 'FI');

-- Profile status indicates the job seeker's current availability
CREATE TYPE public.profile_status AS ENUM (
  'actively_looking',
  'open_to_offers',
  'employed',
  'unavailable'
);

-- Match pipeline status tracks progression through the application funnel
CREATE TYPE public.match_status AS ENUM (
  'saved',
  'applied',
  'interview',
  'rejected',
  'offered',
  'withdrawn'
);

-- Supported source languages for job postings
CREATE TYPE public.source_language AS ENUM ('sv', 'no', 'da', 'fi', 'en');

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. TABLES
-- ──────────────────────────────────────────────────────────────────────────────

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ profiles                                                               ║
-- ║ One-to-one with auth.users. Stores identity and preferences.           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE public.profiles (
  id             UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name      TEXT        NOT NULL DEFAULT '',
  email          TEXT        NOT NULL,
  country_code   public.nordic_country NOT NULL DEFAULT 'SE',
  current_status public.profile_status NOT NULL DEFAULT 'actively_looking',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT profiles_email_format
    CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

COMMENT ON TABLE  public.profiles IS 'User identity and job-seeking preferences, linked 1:1 to auth.users.';
COMMENT ON COLUMN public.profiles.country_code IS 'Primary country of residence (SE/NO/DK/FI).';

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ cv_profiles                                                            ║
-- ║ Parsed CV data + vector embedding per user. One active CV per profile. ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE public.cv_profiles (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  raw_text         TEXT        NOT NULL DEFAULT '',
  structured_data  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  skills_embedding VECTOR(768),  -- Gemini text-embedding-004 output dimension
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce one active CV per profile. If multiple CV versions are needed
  -- later, replace this with a soft-delete / version column approach.
  CONSTRAINT cv_profiles_one_per_profile UNIQUE (profile_id)
);

COMMENT ON TABLE  public.cv_profiles IS 'Parsed CV: raw text, structured JSON (experiences, education, certs), and 768-d skill embedding.';
COMMENT ON COLUMN public.cv_profiles.structured_data IS 'JSON schema: { experiences: [], education: [], certificates: [], languages: [] }';
COMMENT ON COLUMN public.cv_profiles.skills_embedding IS '768-dimensional vector from Gemini text-embedding-004 for cosine similarity matching.';

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ job_postings                                                           ║
-- ║ Aggregated listings from all Nordic national job boards.               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE public.job_postings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT        NOT NULL,
  company           TEXT        NOT NULL DEFAULT '',
  description       TEXT        NOT NULL DEFAULT '',
  location          TEXT        NOT NULL DEFAULT '',
  country           public.nordic_country NOT NULL,
  source_url        TEXT        NOT NULL DEFAULT '',
  original_language public.source_language NOT NULL DEFAULT 'en',
  salary_info       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  hard_requirements TEXT[]      NOT NULL DEFAULT '{}',
  job_embedding     VECTOR(768),  -- Gemini text-embedding-004 output dimension
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,  -- Optional: auto-expire stale postings

  CONSTRAINT job_postings_source_url_unique UNIQUE (source_url)
);

COMMENT ON TABLE  public.job_postings IS 'Unified job postings harvested from JobTech (SE), NAV (NO), STAR (DK), Työmarkkinatori (FI).';
COMMENT ON COLUMN public.job_postings.salary_info IS 'JSON schema: { currency: string, min: number, max: number, period: "monthly"|"yearly"|"hourly" }';
COMMENT ON COLUMN public.job_postings.hard_requirements IS 'Extracted mandatory qualifications (e.g., certifications, licenses, years of experience).';
COMMENT ON COLUMN public.job_postings.expires_at IS 'Optional expiry date; harvester sets this from source data when available.';

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ matches                                                                ║
-- ║ AI-computed match results linking profiles to job postings.            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE public.matches (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_posting_id  UUID          NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  match_score     FLOAT8        NOT NULL DEFAULT 0.0
                                CHECK (match_score >= 0.0 AND match_score <= 1.0),
  missing_skills  TEXT[]        NOT NULL DEFAULT '{}',
  status          public.match_status NOT NULL DEFAULT 'saved',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Prevent duplicate match rows for the same profile + job pair
  CONSTRAINT matches_unique_pair UNIQUE (profile_id, job_posting_id)
);

COMMENT ON TABLE  public.matches IS 'AI-generated match results with cosine similarity score and gap analysis.';
COMMENT ON COLUMN public.matches.match_score IS 'Cosine similarity ∈ [0.0, 1.0] between CV embedding and job embedding.';
COMMENT ON COLUMN public.matches.missing_skills IS 'Skills required by the job but absent from the applicant CV.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. INDEXES
-- ──────────────────────────────────────────────────────────────────────────────

-- HNSW indexes for approximate nearest-neighbor search using Cosine Distance.
-- Parameters tuned for medium-scale datasets (< 1M rows); revisit m/ef values
-- once data volume is established.

CREATE INDEX idx_cv_profiles_skills_embedding
  ON public.cv_profiles
  USING hnsw (skills_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_job_postings_job_embedding
  ON public.job_postings
  USING hnsw (job_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- B-tree indexes for common query patterns
CREATE INDEX idx_job_postings_country     ON public.job_postings (country);
CREATE INDEX idx_job_postings_created_at  ON public.job_postings (created_at DESC);
CREATE INDEX idx_job_postings_expires_at  ON public.job_postings (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX idx_matches_profile_id       ON public.matches (profile_id);
CREATE INDEX idx_matches_job_posting_id   ON public.matches (job_posting_id);
CREATE INDEX idx_matches_score            ON public.matches (match_score DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. TRIGGERS — auto-update `updated_at` columns
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER trg_cv_profiles_updated_at
  BEFORE UPDATE ON public.cv_profiles
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────────────────────

-- Enable RLS on every table. Without policies, all access is denied by default.
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cv_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches      ENABLE ROW LEVEL SECURITY;

-- ── profiles ────────────────────────────────────────────────────────────────

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_delete_own"
  ON public.profiles FOR DELETE
  USING (auth.uid() = id);

-- ── cv_profiles ─────────────────────────────────────────────────────────────

CREATE POLICY "cv_profiles_select_own"
  ON public.cv_profiles FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "cv_profiles_insert_own"
  ON public.cv_profiles FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "cv_profiles_update_own"
  ON public.cv_profiles FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "cv_profiles_delete_own"
  ON public.cv_profiles FOR DELETE
  USING (profile_id = auth.uid());

-- ── job_postings ────────────────────────────────────────────────────────────
-- Publicly readable by any authenticated user.
-- Write access restricted to service_role (server-side harvesters).

CREATE POLICY "job_postings_select_authenticated"
  ON public.job_postings FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies for authenticated users.
-- Harvesters use the service_role key which bypasses RLS entirely.

-- ── matches ─────────────────────────────────────────────────────────────────

CREATE POLICY "matches_select_own"
  ON public.matches FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "matches_insert_own"
  ON public.matches FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "matches_update_own"
  ON public.matches FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "matches_delete_own"
  ON public.matches FOR DELETE
  USING (profile_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. HELPER FUNCTION — Cosine similarity search for job matching
-- ──────────────────────────────────────────────────────────────────────────────

-- Returns the top N most similar job postings for a given embedding vector,
-- optionally filtered by country. Used by the matching engine.

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
SET search_path = ''
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

COMMENT ON FUNCTION public.match_jobs IS 'ANN search: returns top-N jobs by cosine similarity against a 768-d query embedding, with optional country filter and expiry check.';

-- Grant execution to authenticated users (RLS on job_postings still applies)
GRANT EXECUTE ON FUNCTION public.match_jobs TO authenticated;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
