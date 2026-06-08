-- ============================================================================
-- Nordic JobMatch AI — Migration: GDPR Deletion Pipeline
-- Version:  00005
-- Date:     2026-06-08
-- ============================================================================
-- Implements GDPR Art. 17 cascading delete. Clears matches, CV profiles,
-- and profiles for the targeted user.
-- ============================================================================

CREATE OR REPLACE FUNCTION delete_user_data(target_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result JSONB;
  deleted_cv INT;
  deleted_matches INT;
  deleted_profile INT;
BEGIN
  -- Delete matches first (foreign key dependency)
  DELETE FROM public.matches WHERE profile_id = target_profile_id;
  GET DIAGNOSTICS deleted_matches = ROW_COUNT;

  -- Delete CV profiles (includes structured data + embedding)
  DELETE FROM public.cv_profiles WHERE profile_id = target_profile_id;
  GET DIAGNOSTICS deleted_cv = ROW_COUNT;

  -- Delete user profile
  DELETE FROM public.profiles WHERE id = target_profile_id;
  GET DIAGNOSTICS deleted_profile = ROW_COUNT;

  result := jsonb_build_object(
    'deleted_profiles', deleted_profile,
    'deleted_cv_profiles', deleted_cv,
    'deleted_matches', deleted_matches,
    'timestamp', now()::text
  );

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.delete_user_data IS 'GDPR Art. 17: Cascading deletion of user profile, CV profiles, and computed matches. Executed as SECURITY INVOKER so RLS is respected.';
