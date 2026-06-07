-- ============================================================================
-- Nordic JobMatch AI — Migration: upsert_cv_profile RPC
-- Version:  00002
-- Date:     2026-05-31
-- ============================================================================
-- Adds an atomic upsert function for cv_profiles to avoid Supabase client
-- type inference issues with isOneToOne:true FK relationships.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_cv_profile(
  p_profile_id UUID,
  p_raw_text TEXT,
  p_structured_data JSONB,
  p_skills_embedding VECTOR(768)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.cv_profiles (profile_id, raw_text, structured_data, skills_embedding)
  VALUES (p_profile_id, p_raw_text, p_structured_data, p_skills_embedding)
  ON CONFLICT (profile_id)
  DO UPDATE SET
    raw_text = EXCLUDED.raw_text,
    structured_data = EXCLUDED.structured_data,
    skills_embedding = EXCLUDED.skills_embedding,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.upsert_cv_profile IS 'Atomic upsert for CV profiles. Inserts or updates raw_text, structured_data, and skills_embedding in a single operation. Uses SECURITY INVOKER so RLS policies on cv_profiles apply to the calling user.';

GRANT EXECUTE ON FUNCTION public.upsert_cv_profile TO authenticated;
